/**
 * Fleet routes — one door (PG Ride Fleet Management Accounts Plan).
 *
 *   /api/fleet/*              a signed-in investor: apply, the fleet desk, the
 *                             payout method. Every desk route loads the caller's
 *                             role in THAT fleet (server/fleet/accounts.ts).
 *   /api/admin/fleets/:id/*   the operator: approve or send back, the cars,
 *                             the fleet's payouts and its yearly total.
 *   /api/admin/fleet-payouts  the operator marks a Friday payout sent.
 *
 * The whole surface answers 404 while FLEET_ENABLED is off. Fleets also show
 * in Admin → Organizations and in the /org portal list (server/commercial).
 */
import type { Express, NextFunction, Request, Response } from "express";
import { featureFlags } from "../featureFlags";
import { FLEET_TERMS_SENTENCE } from "@shared/fleet";
import { FleetError, applyForFleet, fleetDesk, myFleets, resubmitFleet, reviewFleet, saveFleetPayout } from "./accounts";
import { createFleetCar, listFleetCars, listFleetCarsForAdmin, reviewFleetCar, runFleetCarSweep, updateFleetCar } from "./cars";
import { assignFleetCarToDriver, inviteFleetDriver, listFleetDrivers, removeFleetDriver, sweepRevokedFleetDrivers, takeBackFleetCarFromDriver } from "./drivers";
import { CommercialError } from "../commercial/organizations";
import { resolveAppUrl } from "../appUrl";
import { RentalError } from "../rental/cars";
import { fleetEarningsView, fleetPayoutsView, fleetYearTotal, listFleetPayoutsForAdmin, markFleetPayoutSent } from "./money";

type Handler = (req: Request, res: Response, next: NextFunction) => unknown;

export interface FleetDeps {
  isAuthenticated: Handler;
  isAdminOrSessionAuth: Handler;
}

const userIdOf = (req: any): string => req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;

const fail = (res: Response, err: unknown, fallback: string) => {
  if (err instanceof FleetError) return res.status(err.status).json({ message: err.message, ...(err.problems ? { problems: err.problems } : {}) });
  if (err instanceof CommercialError) return res.status(err.status).json({ message: err.message });
  // A photo or paper refused by PG Ride's store (not the uploader's own, not a photo) says so with its status.
  if (err instanceof RentalError) return res.status(err.status).json({ message: err.message });
  console.error(fallback, err);
  return res.status(500).json({ message: fallback });
};

export function registerFleetRoutes(app: Express, deps: FleetDeps): void {
  const { isAuthenticated, isAdminOrSessionAuth } = deps;
  const gate: Handler = (_req, res, next) => {
    if (!featureFlags.fleetEnabled) return res.status(404).json({ message: "Not found" });
    next();
  };

  app.get("/api/fleet/terms", gate, isAuthenticated, (_req, res) => { res.json({ terms: FLEET_TERMS_SENTENCE }); });
  app.get("/api/fleet/mine", gate, isAuthenticated, async (req, res) => {
    try { res.json(await myFleets(userIdOf(req))); } catch (err) { fail(res, err, "Could not load your fleets"); }
  });
  app.post("/api/fleet/apply", gate, isAuthenticated, async (req, res) => {
    try { res.status(201).json(await applyForFleet(userIdOf(req), req.body ?? {})); } catch (err) { fail(res, err, "Could not send the application"); }
  });
  app.get("/api/fleet/:orgId", gate, isAuthenticated, async (req, res) => {
    try { res.json(await fleetDesk(userIdOf(req), String(req.params.orgId))); } catch (err) { fail(res, err, "Could not load the fleet"); }
  });
  app.patch("/api/fleet/:orgId/application", gate, isAuthenticated, async (req, res) => {
    try { res.json(await resubmitFleet(userIdOf(req), String(req.params.orgId), req.body ?? {})); } catch (err) { fail(res, err, "Could not send the application again"); }
  });
  app.put("/api/fleet/:orgId/payout", gate, isAuthenticated, async (req, res) => {
    try {
      const org = await saveFleetPayout(userIdOf(req), String(req.params.orgId), req.body ?? {});
      res.json({ payoutMethod: org.payoutMethod, payoutDetails: org.payoutDetails });
    } catch (err) { fail(res, err, "Could not save how the fleet is paid"); }
  });

  // ── The fleet's cars (slice 2) ──
  app.get("/api/fleet/:orgId/cars", gate, isAuthenticated, async (req, res) => {
    try { res.json(await listFleetCars(userIdOf(req), String(req.params.orgId))); } catch (err) { fail(res, err, "Could not load the fleet's cars"); }
  });
  app.post("/api/fleet/:orgId/cars", gate, isAuthenticated, async (req, res) => {
    try { res.status(201).json(await createFleetCar(userIdOf(req), String(req.params.orgId), req.body ?? {})); } catch (err) { fail(res, err, "Could not add the car"); }
  });
  app.patch("/api/fleet/:orgId/cars/:carId", gate, isAuthenticated, async (req, res) => {
    try { res.json(await updateFleetCar(userIdOf(req), String(req.params.orgId), String(req.params.carId), req.body ?? {})); } catch (err) { fail(res, err, "Could not update the car"); }
  });

  // ── The fleet's drivers and who has which car (slice 3) ──
  app.get("/api/fleet/:orgId/drivers", gate, isAuthenticated, async (req, res) => {
    try { res.json(await listFleetDrivers(userIdOf(req), String(req.params.orgId))); } catch (err) { fail(res, err, "Could not load the fleet's drivers"); }
  });
  app.post("/api/fleet/:orgId/drivers", gate, isAuthenticated, async (req, res) => {
    try {
      const appUrl = resolveAppUrl(`${req.protocol}://${req.get("host")}`);
      res.status(202).json(await inviteFleetDriver(userIdOf(req), String(req.params.orgId), req.body ?? {}, appUrl));
    } catch (err) { fail(res, err, "Could not invite the driver"); }
  });
  app.delete("/api/fleet/:orgId/drivers/:userId", gate, isAuthenticated, async (req, res) => {
    try { res.json(await removeFleetDriver(userIdOf(req), String(req.params.orgId), String(req.params.userId))); } catch (err) { fail(res, err, "Could not remove the driver"); }
  });
  app.post("/api/fleet/:orgId/cars/:carId/assign", gate, isAuthenticated, async (req, res) => {
    try { res.json(await assignFleetCarToDriver(userIdOf(req), String(req.params.orgId), String(req.params.carId), req.body ?? {})); } catch (err) { fail(res, err, "Could not give the car to the driver"); }
  });
  app.post("/api/fleet/:orgId/cars/:carId/take-back", gate, isAuthenticated, async (req, res) => {
    try { res.json(await takeBackFleetCarFromDriver(userIdOf(req), String(req.params.orgId), String(req.params.carId))); } catch (err) { fail(res, err, "Could not take the car back"); }
  });

  // ── The fleet's money (slice 4): what its cars earned, and each Friday's payout ──
  app.get("/api/fleet/:orgId/earnings", gate, isAuthenticated, async (req, res) => {
    try { res.json(await fleetEarningsView(userIdOf(req), String(req.params.orgId), String(req.query.week ?? "this"))); } catch (err) { fail(res, err, "Could not load the fleet's earnings"); }
  });
  app.get("/api/fleet/:orgId/payouts", gate, isAuthenticated, async (req, res) => {
    try { res.json(await fleetPayoutsView(userIdOf(req), String(req.params.orgId))); } catch (err) { fail(res, err, "Could not load the fleet's payouts"); }
  });

  // ── Operator ──
  app.get("/api/admin/fleets/:id/payouts", gate, isAdminOrSessionAuth, async (req, res) => {
    try { res.json(await listFleetPayoutsForAdmin(String(req.params.id))); } catch (err) { fail(res, err, "Could not load the fleet's payouts"); }
  });
  app.post("/api/admin/fleet-payouts/:id/sent", gate, isAdminOrSessionAuth, async (req: any, res) => {
    try { res.json(await markFleetPayoutSent(String(req.params.id), req.adminUser?.id ?? userIdOf(req))); } catch (err) { fail(res, err, "Could not mark the payout sent"); }
  });
  // 1099 support, records only: the fleet's legal name, full EIN and what was sent to it in the year.
  app.get("/api/admin/fleets/:id/earnings-by-year", gate, isAdminOrSessionAuth, async (req, res) => {
    try { res.json(await fleetYearTotal(String(req.params.id), Number(req.query.year ?? new Date().getUTCFullYear()))); } catch (err) { fail(res, err, "Could not total the fleet's year"); }
  });
  app.post("/api/admin/fleets/:id/review", gate, isAdminOrSessionAuth, async (req, res) => {
    try { res.json(await reviewFleet(String(req.params.id), req.body ?? {})); } catch (err) { fail(res, err, "Could not record the check"); }
  });
  app.get("/api/admin/fleets/:id/cars", gate, isAdminOrSessionAuth, async (req, res) => {
    try { res.json(await listFleetCarsForAdmin(String(req.params.id))); } catch (err) { fail(res, err, "Could not load the fleet's cars"); }
  });
  app.post("/api/admin/fleets/:id/cars/:carId/review", gate, isAdminOrSessionAuth, async (req, res) => {
    try { res.json(await reviewFleetCar(String(req.params.id), String(req.params.carId), req.body ?? {})); } catch (err) { fail(res, err, "Could not record the check"); }
  });
  app.post("/api/admin/analytics/fleet-car-sweep", gate, isAdminOrSessionAuth, async (req, res) => {
    try { const now = new Date(); const cars = await runFleetCarSweep(now, { warnings: !!req.body?.warnings }); res.json({ ...cars, ...(await sweepRevokedFleetDrivers(now)) }); } catch (err) { fail(res, err, "Could not run the fleet car sweep"); }
  });
}
