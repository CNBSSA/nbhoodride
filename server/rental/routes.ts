/**
 * Car rental routes — one door (PG Ride Car Rental Master Plan, phase 1).
 *
 *   /api/rent/*          a signed-in renter: find a car, quote, request, see
 *                        and cancel their own rentals. Nothing reads across
 *                        renters.
 *   /api/admin/rental/*  the operator: fleet cars, confirm and decline,
 *                        hand over, take back, settle, run the sweep.
 *
 * The whole surface answers 404 while RENTAL_ENABLED is off.
 */
import type { Express, NextFunction, Request, Response } from "express";
import { featureFlags } from "../featureFlags";
import { RentalError, createFleetCar, listAllCars, listAvailableCars, updateFleetCar } from "./cars";
import {
  cancelRental, collectRental, confirmRental, declineRental, listAllBookings, listRenterBookings,
  quoteFor, renterView, requestRental, returnRental, settleRental,
} from "./bookings";
import { runRentalSweep } from "./sweep";
import {
  assignFleetCar, cancelFleetRequest, chargeDamage, chargeDueWeek, declineFleetRequest, extendFleetCar, handOverFleetCar,
  listAssignments, listFleetCarsForDrivers, myFleetCar, requestFleetCar, runDriverRentSweep, takeBackFleetCar,
} from "./drivers";
import { DRIVER_RENT_SENTENCE, MAX_DRIVER_WEEKS } from "@shared/rental";
import { RENTAL_TERMS_SENTENCE, MAX_RENTAL_DAYS } from "@shared/rental";

type Handler = (req: Request, res: Response, next: NextFunction) => unknown;

export interface RentalDeps {
  isAuthenticated: Handler;
  isAdminOrSessionAuth: Handler;
}

const userIdOf = (req: any): string => req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;

const fail = (res: Response, err: unknown, fallback: string) => {
  if (err instanceof RentalError) return res.status(err.status).json({ message: err.message, ...(err.problems ? { problems: err.problems } : {}) });
  console.error(fallback, err);
  return res.status(500).json({ message: fallback });
};

const windowOf = (q: any): { startsAt: Date; endsAt: Date } | undefined => {
  if (!q?.from || !q?.to) return undefined;
  const startsAt = new Date(String(q.from)), endsAt = new Date(String(q.to));
  return Number.isFinite(startsAt.getTime()) && Number.isFinite(endsAt.getTime()) && endsAt > startsAt ? { startsAt, endsAt } : undefined;
};

export function registerRentalRoutes(app: Express, deps: RentalDeps): void {
  const { isAuthenticated, isAdminOrSessionAuth } = deps;
  const gate: Handler = (_req, res, next) => {
    if (!featureFlags.rentalEnabled) return res.status(404).json({ message: "Not found" });
    next();
  };

  // ── Renters ────────────────────────────────────────────────────────────────
  app.get("/api/rent/terms", gate, isAuthenticated, (_req, res) => {
    res.json({ terms: RENTAL_TERMS_SENTENCE, maxDays: MAX_RENTAL_DAYS });
  });

  app.get("/api/rent/cars", gate, isAuthenticated, async (req, res) => {
    try { res.json(await listAvailableCars(windowOf(req.query))); } catch (err) { fail(res, err, "Could not load cars"); }
  });

  app.post("/api/rent/quote", gate, isAuthenticated, async (req, res) => {
    try {
      const { car, quote, available } = await quoteFor(String(req.body?.carId ?? ""), req.body?.startsAt, req.body?.endsAt);
      res.json({ car, quote, available });
    } catch (err) { fail(res, err, "Could not price that rental"); }
  });

  app.post("/api/rent/bookings", gate, isAuthenticated, async (req, res) => {
    try { res.json(renterView(await requestRental(userIdOf(req), req.body ?? {}))); } catch (err) { fail(res, err, "Could not request that rental"); }
  });

  app.get("/api/rent/bookings", gate, isAuthenticated, async (req, res) => {
    try { res.json(await listRenterBookings(userIdOf(req))); } catch (err) { fail(res, err, "Could not load your rentals"); }
  });

  app.post("/api/rent/bookings/:id/cancel", gate, isAuthenticated, async (req, res) => {
    try { res.json(renterView(await cancelRental(String(req.params.id), userIdOf(req), req.body?.reason))); } catch (err) { fail(res, err, "Could not cancel that rental"); }
  });

  // ── Operator ───────────────────────────────────────────────────────────────
  app.get("/api/admin/rental/cars", gate, isAdminOrSessionAuth, async (_req, res) => {
    try { res.json(await listAllCars()); } catch (err) { fail(res, err, "Could not load rental cars"); }
  });

  app.post("/api/admin/rental/cars", gate, isAdminOrSessionAuth, async (req, res) => {
    try { res.json(await createFleetCar(req.body ?? {}, userIdOf(req))); } catch (err) { fail(res, err, "Could not add the car"); }
  });

  app.patch("/api/admin/rental/cars/:id", gate, isAdminOrSessionAuth, async (req, res) => {
    try { res.json(await updateFleetCar(String(req.params.id), req.body ?? {}, userIdOf(req))); } catch (err) { fail(res, err, "Could not update the car"); }
  });

  app.get("/api/admin/rental/bookings", gate, isAdminOrSessionAuth, async (_req, res) => {
    try { res.json(await listAllBookings()); } catch (err) { fail(res, err, "Could not load rentals"); }
  });

  app.post("/api/admin/rental/bookings/:id/confirm", gate, isAdminOrSessionAuth, async (req, res) => {
    try { res.json(await confirmRental(String(req.params.id))); } catch (err) { fail(res, err, "Could not confirm the rental"); }
  });

  app.post("/api/admin/rental/bookings/:id/decline", gate, isAdminOrSessionAuth, async (req, res) => {
    try { res.json(await declineRental(String(req.params.id), req.body?.reason)); } catch (err) { fail(res, err, "Could not decline the rental"); }
  });

  app.post("/api/admin/rental/bookings/:id/collect", gate, isAdminOrSessionAuth, async (req, res) => {
    try { res.json(await collectRental(String(req.params.id), userIdOf(req), req.body ?? {})); } catch (err) { fail(res, err, "Could not hand the car over"); }
  });

  app.post("/api/admin/rental/bookings/:id/return", gate, isAdminOrSessionAuth, async (req, res) => {
    try { res.json(await returnRental(String(req.params.id), userIdOf(req), req.body ?? {})); } catch (err) { fail(res, err, "Could not take the car back"); }
  });

  app.post("/api/admin/rental/bookings/:id/settle", gate, isAdminOrSessionAuth, async (req, res) => {
    try { res.json(await settleRental(String(req.params.id))); } catch (err) { fail(res, err, "Could not settle the rental"); }
  });

  // ── Drivers: PG Ride fleet cars to earn with (phase 3) ─────────────────────
  app.get("/api/driver/fleet-cars", gate, isAuthenticated, async (req, res) => {
    try { res.json({ cars: await listFleetCarsForDrivers(windowOf(req.query)), terms: DRIVER_RENT_SENTENCE, maxWeeks: MAX_DRIVER_WEEKS }); } catch (err) { fail(res, err, "Could not load cars"); }
  });

  app.get("/api/driver/fleet-car", gate, isAuthenticated, async (req, res) => {
    try { res.json(await myFleetCar(userIdOf(req))); } catch (err) { fail(res, err, "Could not load your car"); }
  });

  app.post("/api/driver/fleet-car/request", gate, isAuthenticated, async (req, res) => {
    try { res.json(await requestFleetCar(userIdOf(req), req.body ?? {})); } catch (err) { fail(res, err, "Could not ask for that car"); }
  });

  app.post("/api/driver/fleet-car/cancel", gate, isAuthenticated, async (req, res) => {
    try { res.json(await cancelFleetRequest(userIdOf(req))); } catch (err) { fail(res, err, "Could not cancel"); }
  });

  app.get("/api/admin/rental/assignments", gate, isAdminOrSessionAuth, async (_req, res) => {
    try { res.json(await listAssignments()); } catch (err) { fail(res, err, "Could not load driver cars"); }
  });

  const adminAct = (path: string, fn: (id: string, req: any) => Promise<unknown>, fallback: string) =>
    app.post(`/api/admin/rental/assignments/:id/${path}`, gate, isAdminOrSessionAuth, async (req: any, res) => {
      try { res.json(await fn(String(req.params.id), req)); } catch (err) { fail(res, err, fallback); }
    });
  adminAct("assign", (id) => assignFleetCar(id), "Could not assign the car");
  adminAct("decline", (id, req) => declineFleetRequest(id, req.body?.reason), "Could not decline");
  adminAct("handover", (id, req) => handOverFleetCar(id, userIdOf(req), req.body ?? {}), "Could not hand the car over");
  adminAct("takeback", (id, req) => takeBackFleetCar(id, userIdOf(req), req.body ?? {}), "Could not take the car back");
  adminAct("extend", (id, req) => extendFleetCar(id, req.body?.weeks), "Could not extend");
  adminAct("charge-rent", (id) => chargeDueWeek(id), "Could not charge the rent");
  adminAct("charge-damage", async (id) => {
    const { db } = await import("../db");
    const { driverCarAssignments } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const [a] = await db.select().from(driverCarAssignments).where(eq(driverCarAssignments.id, id));
    if (!a) throw new RentalError("Not found.", 404);
    return chargeDamage(a);
  }, "Could not charge the damage");

  app.post("/api/admin/analytics/driver-rent-sweep", gate, isAdminOrSessionAuth, async (_req, res) => {
    try { res.json(await runDriverRentSweep()); } catch (err) { fail(res, err, "Could not run the rent sweep"); }
  });

  app.post("/api/admin/analytics/rental-sweep", gate, isAdminOrSessionAuth, async (req, res) => {
    try { res.json(await runRentalSweep(new Date(), { warnings: !!req.body?.warnings })); } catch (err) { fail(res, err, "Could not run the rental sweep"); }
  });
}
