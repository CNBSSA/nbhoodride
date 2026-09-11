/**
 * Rider Promise Review — the 4:00 AM Eastern Telegram report on whether
 * riders got where they were going yesterday (shared/riderPromise.ts has
 * the definitions and the message format).
 *
 * Runs inside the server, from the minute sweep, so it needs nothing the
 * app doesn't already have: the rides table and the Telegram ops hook.
 * Sends once per local day — the first sweep at or after the review hour
 * claims the day through the same claim-once table the webhook handlers
 * use, so restarts and multiple instances can't send it twice. Nothing is
 * created on days the review does not run; a missed 4:00 sweep sends at
 * 4:01.
 */

import { sql } from "drizzle-orm";
import { db } from "./db";
import type { IStorage } from "./storage";
import { opsAlert } from "./telegramOps";
import { APP_ERROR_KINDS, SERVER_ERROR_KINDS } from "./reliabilityEvents";
import { RISK_STAMPS } from "@shared/rideRisk";
import { watchesInWindow } from "./watchHeartbeat";
import {
  DANGER_WINDOW_HOURS,
  LATE_PICKUP_MINUTES,
  formatRiderPromiseReview,
  isReviewDue,
  localDayKey,
  reviewWindow,
  type RiderPromiseMetrics,
  type ReviewWindow,
} from "@shared/riderPromise";

const CLAIM_PROVIDER = "rider_promise_review";

/** `a, b, c` as bound parameters (drizzle expands a bare array into a row, not a list). */
const list = (values: readonly string[]) => sql.join(values.map((v) => sql`${v}`), sql`, `);

const n = (v: unknown): number => {
  const x = typeof v === "number" ? v : parseFloat(String(v ?? "0"));
  return Number.isFinite(x) ? x : 0;
};

/** The numbers for a window, straight from the rides table. */
export async function collectRiderPromiseMetrics(window: ReviewWindow, now: Date = new Date()): Promise<RiderPromiseMetrics> {
  const { start, end } = window;

  // A ride's service time: the scheduled departure, or when it was
  // requested for ride-now.
  const yesterday = await db.execute(sql`
    SELECT
      count(*)::int AS booked,
      count(*) FILTER (WHERE status = 'completed')::int AS delivered,
      count(*) FILTER (
        WHERE (status IN ('cancelled', 'no_show') AND COALESCE(cancelled_by_role, '') IN ('driver', 'system'))
           OR (status IN ('pending', 'accepted', 'driver_arriving', 'in_progress'))
      )::int AS failed,
      count(*) FILTER (WHERE status = 'cancelled' AND cancelled_by_role = 'rider')::int AS rider_cancelled,
      count(*) FILTER (
        WHERE scheduled_at IS NOT NULL AND reminder_stamps ? 'w5' AND status <> 'completed'
      )::int AS strandings,
      count(*) FILTER (
        WHERE scheduled_at IS NOT NULL AND reminder_stamps ? 'w5' AND status = 'completed'
      )::int AS near_misses,
      count(*) FILTER (
        WHERE scheduled_at IS NOT NULL AND arrived_at IS NOT NULL
          AND arrived_at > scheduled_at + make_interval(mins => ${LATE_PICKUP_MINUTES})
      )::int AS late_pickups,
      COALESCE(max(
        CASE WHEN scheduled_at IS NOT NULL AND arrived_at IS NOT NULL
             THEN EXTRACT(EPOCH FROM (arrived_at - scheduled_at)) / 60 END
      ), 0)::float AS worst_late_minutes
    FROM rides
    WHERE COALESCE(scheduled_at, created_at) >= ${start} AND COALESCE(scheduled_at, created_at) < ${end}
  `);
  const y = (yesterday.rows?.[0] ?? {}) as Record<string, unknown>;

  // Fare accuracy: what was charged versus the quote less any promo. A ride
  // the driver or rider ended early is metered on purpose and excluded.
  const deviations = await db.execute(sql`
    SELECT id, estimated_fare, actual_fare, COALESCE(promo_discount_applied, 0) AS promo
    FROM rides
    WHERE status = 'completed'
      AND cancelled_by IS NULL
      AND actual_fare IS NOT NULL AND estimated_fare IS NOT NULL AND estimated_fare > 0
      AND ABS(actual_fare - GREATEST(0, estimated_fare - COALESCE(promo_discount_applied, 0))) > 0.01
      AND COALESCE(scheduled_at, created_at) >= ${start} AND COALESCE(scheduled_at, created_at) < ${end}
    ORDER BY COALESCE(scheduled_at, created_at)
    LIMIT 20
  `);

  const horizon = new Date(now.getTime() + 24 * 3_600_000);
  const danger = new Date(now.getTime() + DANGER_WINDOW_HOURS * 3_600_000);
  const ahead = await db.execute(sql`
    SELECT
      count(*)::int AS unclaimed_24h,
      count(*) FILTER (WHERE scheduled_at <= ${danger})::int AS unclaimed_danger,
      count(*) FILTER (WHERE plan_id IS NOT NULL)::int AS unclaimed_plan
    FROM rides
    WHERE status = 'pending' AND driver_id IS NULL
      AND scheduled_at IS NOT NULL AND scheduled_at > ${now} AND scheduled_at <= ${horizon}
  `);
  const a = (ahead.rows?.[0] ?? {}) as Record<string, unknown>;
  const plans = await db.execute(sql`SELECT count(*)::int AS n FROM weekly_ride_plans WHERE is_active`);

  // "All features, menus and buttons work": what reached a person yesterday.
  const health = await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE kind IN (${list(APP_ERROR_KINDS)}))::int AS app_errors,
      count(*) FILTER (WHERE kind = 'client_crash')::int AS crashes,
      count(*) FILTER (WHERE kind IN (${list(SERVER_ERROR_KINDS)}))::int AS server_errors,
      count(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL AND kind IN (${list([...APP_ERROR_KINDS, ...SERVER_ERROR_KINDS])}))::int AS people
    FROM reliability_events
    WHERE created_at >= ${start} AND created_at < ${end}
  `);
  const hh = (health.rows?.[0] ?? {}) as Record<string, unknown>;

  // Outages the server's own dependency watch saw: each "down" paired with
  // the next "up" for the same dependency; unpaired means still down at the
  // window's end (or the server restarted before it recovered).
  const outageRows = await db.execute(sql`
    SELECT kind, page AS name, message, created_at
    FROM reliability_events
    WHERE kind IN ('dependency_down', 'dependency_up') AND created_at >= ${start} AND created_at < ${end}
    ORDER BY created_at
  `);
  const outages: RiderPromiseMetrics["appHealth"]["outages"] = [];
  const open = new Map<string, number>();
  const label = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);
  for (const r of (outageRows.rows ?? []) as any[]) {
    const name = String(r.name ?? "unknown");
    if (r.kind === "dependency_down") {
      if (!open.has(name)) open.set(name, outages.push({ name: label(name), minutes: null }) - 1);
    } else {
      const idx = open.get(name);
      const mins = Number((String(r.message ?? "").match(/after (\d+) min/) ?? [])[1]);
      if (idx !== undefined) { outages[idx].minutes = Number.isFinite(mins) ? mins : null; open.delete(name); }
      else outages.push({ name: label(name), minutes: Number.isFinite(mins) ? mins : null });
    }
  }

  // Rides the watch paged ops about before departure, and whether they still happened.
  const paged = await db.execute(sql`
    SELECT count(*)::int AS paged, count(*) FILTER (WHERE status = 'completed')::int AS delivered
    FROM rides
    WHERE scheduled_at >= ${start} AND scheduled_at < ${end}
      AND reminder_stamps ?| ARRAY[${list([...RISK_STAMPS])}]::text[]
  `);
  const pg = (paged.rows?.[0] ?? {}) as Record<string, unknown>;

  // Which overnight checks were alive. A check that stopped quietly is the
  // thing this review exists to catch.
  const watches = await watchesInWindow(start, end);

  return {
    booked: n(y.booked),
    delivered: n(y.delivered),
    failed: n(y.failed),
    riderCancelled: n(y.rider_cancelled),
    strandings: n(y.strandings),
    nearMisses: n(y.near_misses),
    fareDeviations: (deviations.rows ?? []).map((r: any) => ({
      rideId: String(r.id),
      quoted: Math.round(Math.max(0, n(r.estimated_fare) - n(r.promo)) * 100) / 100,
      charged: n(r.actual_fare),
    })),
    latePickups: n(y.late_pickups),
    worstLateMinutes: Math.round(n(y.worst_late_minutes)),
    appHealth: {
      appErrors: n(hh.app_errors),
      crashes: n(hh.crashes),
      serverErrors: n(hh.server_errors),
      peopleAffected: n(hh.people),
      outages,
    },
    overnight: watches.map((w) => ({ label: w.label, beats: w.beats, ran: w.beats > 0 })),
    pagedAhead: { paged: n(pg.paged), delivered: n(pg.delivered) },
    ahead: {
      unclaimedNext24h: n(a.unclaimed_24h),
      unclaimedInDangerWindow: n(a.unclaimed_danger),
      unclaimedPlanRides: n(a.unclaimed_plan),
      activePlans: n((plans.rows?.[0] as any)?.n),
    },
  };
}

export async function buildRiderPromiseReview(now: Date = new Date()): Promise<{ window: ReviewWindow; metrics: RiderPromiseMetrics; text: string }> {
  const window = reviewWindow(now);
  const metrics = await collectRiderPromiseMetrics(window, now);
  return { window, metrics, text: formatRiderPromiseReview(window, metrics) };
}

export type SendResult =
  | { sent: true; dayKey: string; text: string; metrics: RiderPromiseMetrics }
  | { sent: false; reason: "not_due" | "already_sent"; dayKey: string };

/**
 * Send today's review if it is due and has not gone out yet. Safe to call
 * every minute from any number of instances.
 */
export async function maybeSendRiderPromiseReview(storage: IStorage, now: Date = new Date()): Promise<SendResult> {
  const dayKey = localDayKey(now);
  if (!isReviewDue(now)) return { sent: false, reason: "not_due", dayKey };
  const claimed = await storage.claimWebhookEvent(CLAIM_PROVIDER, dayKey, "daily");
  if (!claimed) return { sent: false, reason: "already_sent", dayKey };
  try {
    const { window, metrics, text } = await buildRiderPromiseReview(now);
    opsAlert(text);
    console.log(`[rider-promise-review] sent for ${window.dayKey}: booked=${metrics.booked} delivered=${metrics.delivered} failed=${metrics.failed} strandings=${metrics.strandings} fareMismatches=${metrics.fareDeviations.length}`);
    return { sent: true, dayKey, text, metrics };
  } catch (err) {
    // Give the next sweep another go rather than swallowing the day.
    await storage.releaseWebhookEvent(CLAIM_PROVIDER, dayKey).catch(() => {});
    throw err;
  }
}
