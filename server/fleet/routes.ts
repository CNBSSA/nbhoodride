/**
 * Fleet routes — one door (PG Ride Fleet Management Accounts Plan).
 *
 *   /api/fleet/*              a signed-in investor: apply, the fleet desk, the
 *                             payout method. Every desk route loads the caller's
 *                             role in THAT fleet (server/fleet/accounts.ts).
 *   /api/admin/fleets/:id/*   the operator: approve or send back.
 *
 * The whole surface answers 404 while FLEET_ENABLED is off. Fleets also show
 * in Admin → Organizations and in the /org portal list (server/commercial).
 */
import type { Express, NextFunction, Request, Response } from "express";
import { featureFlags } from "../featureFlags";
import { FLEET_TERMS_SENTENCE } from "@shared/fleet";
import { FleetError, applyForFleet, fleetDesk, myFleets, resubmitFleet, reviewFleet, saveFleetPayout } from "./accounts";
import { CommercialError } from "../commercial/organizations";

type Handler = (req: Request, res: Response, next: NextFunction) => unknown;

export interface FleetDeps {
  isAuthenticated: Handler;
  isAdminOrSessionAuth: Handler;
}

const userIdOf = (req: any): string => req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;

const fail = (res: Response, err: unknown, fallback: string) => {
  if (err instanceof FleetError) return res.status(err.status).json({ message: err.message, ...(err.problems ? { problems: err.problems } : {}) });
  if (err instanceof CommercialError) return res.status(err.status).json({ message: err.message });
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

  // ── Operator ──
  app.post("/api/admin/fleets/:id/review", gate, isAdminOrSessionAuth, async (req, res) => {
    try { res.json(await reviewFleet(String(req.params.id), req.body ?? {})); } catch (err) { fail(res, err, "Could not record the check"); }
  });
}
