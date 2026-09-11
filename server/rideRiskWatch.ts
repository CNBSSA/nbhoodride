/**
 * Ride-risk watch — pages the operator about a scheduled ride in trouble
 * before the rider finds out (rules in shared/rideRisk.ts).
 *
 * Runs from the minute sweep. One query over the next ~2 hours of pending
 * and accepted scheduled rides, joined to the driver's last position, then
 * per ride: an unclaimed page at T-2h and T-15m, and a single T-10 check
 * that the driver is actually near the pickup. Stamps go into
 * reminder_stamps next to the rider-facing ones so nothing fires twice and
 * the Rider Promise Review can count them.
 */

import { sql } from "drizzle-orm";
import { db } from "./db";
import { riderAlert } from "./riderAlerts";
import { PLAN_TIMEZONE, zonedParts } from "@shared/weeklyPlan";
import { describeDriverRisk, driverPickupCheck, unclaimedPageDue } from "@shared/rideRisk";
import { commercialPagingFields } from "@shared/commercial";
import { noteWatchRan } from "./watchHeartbeat";

export interface RiskPage {
  rideId: string;
  stage: "o120" | "o15" | "o10";
  kind: "ride_unclaimed" | "driver_far_from_pickup" | "driver_ok";
}

const HORIZON_MINUTES = 125;

function localClock(d: Date): string {
  const p = zonedParts(d, PLAN_TIMEZONE);
  const h12 = p.h % 12 === 0 ? 12 : p.h % 12;
  return `${h12}:${String(p.min).padStart(2, "0")} ${p.h < 12 ? "AM" : "PM"}`;
}

const short = (addr: unknown) => (typeof addr === "string" ? addr.split(",").slice(0, 2).join(",").trim() : "");

async function stampRide(rideId: string, keys: string[], now: Date): Promise<void> {
  const patch: Record<string, string> = {};
  for (const k of keys) patch[k] = now.toISOString();
  await db.execute(sql`
    UPDATE rides SET reminder_stamps = COALESCE(reminder_stamps, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb
    WHERE id = ${rideId}
  `);
}

/** One pass. Returns what it paged (and the drivers it checked and found fine). */
export async function pageAtRiskRides(now: Date = new Date()): Promise<RiskPage[]> {
  const horizon = new Date(now.getTime() + HORIZON_MINUTES * 60_000);
  const rows = await db.execute(sql`
    SELECT r.id, r.status, r.driver_id, r.scheduled_at, r.reminder_stamps, r.pickup_location, r.destination_location,
           r.estimated_fare, r.plan_id,
           ru.first_name AS rider_first, ru.last_name AS rider_last, ru.phone AS rider_phone,
           du.first_name AS driver_first, du.last_name AS driver_last,
           dp.current_location AS driver_location, dp.updated_at AS driver_location_at,
           o.name AS org_name, cj.job_number, cj.category AS job_category
    FROM rides r
    JOIN users ru ON ru.id = r.rider_id
    LEFT JOIN users du ON du.id = r.driver_id
    LEFT JOIN driver_profiles dp ON dp.user_id = r.driver_id
    LEFT JOIN commercial_jobs cj ON cj.ride_id = r.id
    LEFT JOIN organizations o ON o.id = cj.organization_id
    WHERE r.scheduled_at IS NOT NULL
      AND r.scheduled_at >= ${now} AND r.scheduled_at <= ${horizon}
      AND r.status IN ('pending', 'accepted')
    ORDER BY r.scheduled_at
  `);

  noteWatchRan("ride-risk", now);
  const out: RiskPage[] = [];
  for (const r of (rows.rows ?? []) as any[]) {
    const departure = new Date(r.scheduled_at);
    const mins = (departure.getTime() - now.getTime()) / 60_000;
    const stamps = (r.reminder_stamps ?? {}) as Record<string, unknown>;
    const pickup = r.pickup_location as { lat?: number; lng?: number; address?: string } | null;
    const rider = `${r.rider_first ?? ""} ${r.rider_last ?? ""}`.trim() || "Rider";
    // A commercial job is paged by account and job number; the passenger's
    // name and phone never leave the app (shared/commercial.ts).
    const who: Array<[string, string | number | null | undefined]> = r.org_name
      ? commercialPagingFields({ orgName: r.org_name, jobNumber: r.job_number, category: r.job_category })
      : [["Rider", rider], ["Phone", r.rider_phone]];
    const common: Array<[string, string | number | null | undefined]> = [
      ...who,
      ["Leaves", `${localClock(departure)} (${Math.max(0, Math.round(mins))} min)`],
      ["Pickup", short(pickup?.address)],
      ["To", short((r.destination_location as any)?.address)],
      ["Fare", r.estimated_fare != null ? `$${Number(r.estimated_fare).toFixed(2)}` : null],
      ["Ride", String(r.id)],
    ];

    if (r.status === "pending" && !r.driver_id) {
      const due = unclaimedPageDue(mins, stamps);
      if (!due) continue;
      riderAlert("ride_unclaimed", `${r.id}:${due.stage}`, [
        ...common,
        ["Why", `No driver has claimed this ride with ${due.label} to go${r.plan_id ? " (weekly plan ride)" : ""}`],
      ]);
      await stampRide(r.id, due.stampAll, now);
      out.push({ rideId: r.id, stage: due.stage, kind: "ride_unclaimed" });
      continue;
    }

    if (r.driver_id) {
      const loc = r.driver_location as { lat?: number; lng?: number } | null;
      const check = driverPickupCheck({
        minutesToDeparture: mins,
        stamps,
        pickup: pickup && Number.isFinite(pickup.lat) && Number.isFinite(pickup.lng) ? { lat: pickup.lat!, lng: pickup.lng! } : null,
        driverLocation: loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng) ? { lat: loc.lat!, lng: loc.lng! } : null,
        driverLocationAt: r.driver_location_at,
      }, now);
      if (!check.checked) continue;
      await stampRide(r.id, ["o10"], now);
      if (check.reason) {
        riderAlert("driver_far_from_pickup", r.id, [
          ["Driver", `${r.driver_first ?? ""} ${r.driver_last ?? ""}`.trim() || r.driver_id],
          ...common,
          ["Why", describeDriverRisk(check, mins) + (r.status === "pending" ? " · driver has not confirmed" : "")],
        ]);
        out.push({ rideId: r.id, stage: "o10", kind: "driver_far_from_pickup" });
      } else {
        out.push({ rideId: r.id, stage: "o10", kind: "driver_ok" });
      }
    }
  }
  return out;
}
