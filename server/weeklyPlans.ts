/**
 * Standing weekly ride plans — booking engine.
 *
 * A plan (shared/weeklyPlan.ts) says "pickup → destination at 5:30 PM,
 * Mon–Fri". This module turns that into real scheduled rides, a rolling
 * PLAN_BOOK_AHEAD_DAYS ahead, so every plan ride:
 *   - sits on the driver board like any scheduled ride (claim, confirm,
 *     reminders, re-broadcasts all come for free from the scheduled-ride
 *     sweep),
 *   - carries the plan's locked per-ride fare as its quote, and
 *   - settles on its own at completion — nothing is prepaid.
 *
 * Idempotent: a departure that already has a ride for this plan (any
 * status — a day the rider cancelled stays cancelled) is skipped, and the
 * database also carries a unique (plan_id, scheduled_at) index.
 */

import type { IStorage } from "./storage";
import type { WeeklyRidePlan } from "@shared/schema";
import { PLAN_BOOK_AHEAD_DAYS, planOccurrences } from "@shared/weeklyPlan";
import { logRideAudit } from "./rideWorkflowService";

export interface MaterializeResult {
  planId: string;
  bookedRideIds: string[];
  skipped: number;
}

export async function materializeWeeklyPlan(
  storage: IStorage,
  plan: WeeklyRidePlan,
  now: Date = new Date(),
): Promise<MaterializeResult> {
  const result: MaterializeResult = { planId: plan.id, bookedRideIds: [], skipped: 0 };
  if (!plan.isActive) return result;

  const until = new Date(now.getTime() + PLAN_BOOK_AHEAD_DAYS * 86_400_000);
  const wanted = planOccurrences(
    { days: plan.days ?? [], departureHour: plan.departureHour, departureMinute: plan.departureMinute ?? 0, timezone: plan.timezone ?? undefined },
    now,
    until,
  );
  if (wanted.length === 0) return result;

  const existing = new Set((await storage.getPlanRideDepartures(plan.id)).map((d) => d.getTime()));
  let latest = plan.bookedThrough ? new Date(plan.bookedThrough).getTime() : 0;

  for (const at of wanted) {
    if (existing.has(at.getTime())) { result.skipped++; continue; }
    try {
      const ride = await storage.createRide({
        riderId: plan.riderId,
        driverId: plan.preferredDriverId ?? undefined,
        pickupLocation: plan.pickup,
        destinationLocation: plan.destination,
        stops: plan.stops && plan.stops.length > 0 ? plan.stops : undefined,
        pickupInstructions: plan.pickupInstructions ?? undefined,
        estimatedFare: plan.perRideFare,
        originalFare: plan.fullFare,
        distance: plan.quotedMiles ?? undefined,
        duration: plan.quotedMinutes ?? undefined,
        scheduledAt: at,
        status: "pending",
        paymentMethod: "card",
        rideType: "weekly_plan",
        planId: plan.id,
        pickupCounty: plan.pickupCounty ?? undefined,
      });
      result.bookedRideIds.push(ride.id);
      latest = Math.max(latest, at.getTime());
      logRideAudit({
        rideId: ride.id,
        event: "ride_created",
        actorId: plan.riderId,
        details: { source: "weekly_plan", planId: plan.id, scheduledAt: at.toISOString(), perRideFare: plan.perRideFare },
      }).catch(() => {});
    } catch (err: any) {
      // A concurrent sweep may have booked the same departure — the unique
      // index says so and the next pass sees it as existing.
      if (err?.code === "23505") { result.skipped++; continue; }
      throw err;
    }
  }

  if (latest > 0 && latest !== (plan.bookedThrough ? new Date(plan.bookedThrough).getTime() : 0)) {
    await storage.updateWeeklyRidePlan(plan.id, { bookedThrough: new Date(latest) });
  }
  return result;
}

/** Top up every active plan's booking window. Run from the minute sweep. */
export async function materializeAllWeeklyPlans(storage: IStorage, now: Date = new Date()): Promise<{ plans: number; booked: number }> {
  const plans = await storage.getActiveWeeklyRidePlans();
  let booked = 0;
  for (const plan of plans) {
    try {
      const r = await materializeWeeklyPlan(storage, plan, now);
      booked += r.bookedRideIds.length;
    } catch (err) {
      console.error(`weekly plan ${plan.id}: booking sweep failed`, err);
    }
  }
  return { plans: plans.length, booked };
}
