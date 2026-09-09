/**
 * Rider Promise Review — what "reliable" means for PG Ride, as numbers.
 *
 * The promise: a rider who books a ride gets picked up, on time, at the
 * price they were quoted — every time. The daily code-health report
 * (build, tests, probes) says whether the app compiled; this review says
 * whether riders got where they were going. At today's volume it counts
 * failures rather than rates: with ten rides a week, "95% delivered" is
 * one person left standing outside, which is an incident, not a score.
 *
 * Pure definitions and formatting live here (shared, unit-tested); the
 * queries and the 4:00 AM Eastern send live in server/riderPromiseReview.ts.
 */

import { PLAN_TIMEZONE, zonedDateTime, zonedParts } from "./weeklyPlan";

export const REVIEW_NAME = "Rider Promise Review";
export const REVIEW_TIMEZONE = PLAN_TIMEZONE;
/** Sent once a day, the first sweep at or after this hour, Eastern time. */
export const REVIEW_HOUR_LOCAL = 4;
/** A pickup later than this many minutes after the scheduled time is "late". */
export const LATE_PICKUP_MINUTES = 5;
/** Unclaimed scheduled rides inside this window are strandings waiting to happen. */
export const DANGER_WINDOW_HOURS = 12;

export interface FareDeviation {
  rideId: string;
  quoted: number;
  charged: number;
}

export interface RiderPromiseMetrics {
  /** Rides whose service time fell in the window. */
  booked: number;
  delivered: number;
  /** Cancelled by the driver or by the system, or never resolved: the promise was broken. */
  failed: number;
  /** The rider chose not to ride; not a reliability failure. */
  riderCancelled: number;
  /** Scheduled rides that reached departure with no driver and never completed. */
  strandings: number;
  /** Reached departure with no driver, but a driver still came through. */
  nearMisses: number;
  fareDeviations: FareDeviation[];
  latePickups: number;
  /** Worst late pickup in the window, minutes past the scheduled time. */
  worstLateMinutes: number;
  /**
   * "All features, menus and buttons work": errors that reached a person in
   * the window (from reliability_events), and how many people hit one.
   */
  appHealth: {
    /** JavaScript errors reported from the app, crashes included. */
    appErrors: number;
    /** Of those, render crashes that showed the error screen. */
    crashes: number;
    /** 5xx responses a user actually received. */
    serverErrors: number;
    /** Distinct signed-in users who hit any of the above. */
    peopleAffected: number;
    /** Dependency outages (database, Stripe) the server's own watch saw. */
    outages: Array<{ name: string; minutes: number | null }>;
  };
  /** Rides the watch paged ops about before departure (o120 / o15 / o10 stamps). */
  pagedAhead: {
    paged: number;
    /** Of those, still delivered. */
    delivered: number;
  };
  /** Looking ahead from now. */
  ahead: {
    unclaimedNext24h: number;
    unclaimedInDangerWindow: number;
    unclaimedPlanRides: number;
    activePlans: number;
  };
}

export interface ReviewWindow {
  /** ISO date of the day reviewed, in the review time zone (e.g. "2026-09-06"). */
  dayKey: string;
  /** Human label, e.g. "Sat, Sep 6". */
  dayLabel: string;
  start: Date;
  end: Date;
}

const pad = (n: number) => String(n).padStart(2, "0");
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The local calendar date `now` falls on, as "YYYY-MM-DD" in the review zone. */
export function localDayKey(now: Date, timeZone: string = REVIEW_TIMEZONE): string {
  const p = zonedParts(now, timeZone);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/** The previous local calendar day: the day the 4 AM review looks back on. */
export function reviewWindow(now: Date, timeZone: string = REVIEW_TIMEZONE): ReviewWindow {
  const today = zonedParts(now, timeZone);
  const todayStart = zonedDateTime(today.y, today.m, today.d, 0, 0, timeZone);
  // Step back one calendar day via a UTC-noon anchor (DST-safe), then
  // resolve that day's local midnight.
  const anchor = new Date(Date.UTC(today.y, today.m - 1, today.d, 12) - 86_400_000);
  const y = anchor.getUTCFullYear(), m = anchor.getUTCMonth() + 1, d = anchor.getUTCDate();
  const start = zonedDateTime(y, m, d, 0, 0, timeZone);
  return {
    dayKey: `${y}-${pad(m)}-${pad(d)}`,
    dayLabel: `${DAY_NAMES[anchor.getUTCDay()]}, ${MONTH_NAMES[m - 1]} ${d}`,
    start,
    end: todayStart,
  };
}

/** True once the local clock has reached the review hour. */
export function isReviewDue(now: Date, timeZone: string = REVIEW_TIMEZONE, hour: number = REVIEW_HOUR_LOCAL): boolean {
  return zonedParts(now, timeZone).h >= hour;
}

export type ReviewVerdict = "kept" | "broken" | "quiet";

/** "kept" when every promise held, "broken" on any failure, "quiet" on a day with no rides. */
export function reviewVerdict(m: RiderPromiseMetrics): ReviewVerdict {
  if (m.failed > 0 || m.strandings > 0 || m.fareDeviations.length > 0) return "broken";
  if (m.booked === 0) return "quiet";
  return "kept";
}

const money = (n: number) => `$${n.toFixed(2)}`;

/** "none" or "Stripe 12 min, Database (still down)". */
export function describeOutages(outages: RiderPromiseMetrics["appHealth"]["outages"]): string {
  if (outages.length === 0) return "none";
  return outages.map((o) => `${o.name} ${o.minutes === null ? "(still down)" : `${o.minutes} min`}`).join(", ");
}

/** "no errors reached anyone" or "2 app errors (1 crash), 1 server error · 2 people affected". */
export function describeAppHealth(h: RiderPromiseMetrics["appHealth"]): string {
  if (h.appErrors === 0 && h.serverErrors === 0) return "no errors reached anyone";
  const parts: string[] = [];
  if (h.appErrors > 0) parts.push(`${h.appErrors} app error${h.appErrors === 1 ? "" : "s"}${h.crashes > 0 ? ` (${h.crashes} crash${h.crashes === 1 ? "" : "es"})` : ""}`);
  if (h.serverErrors > 0) parts.push(`${h.serverErrors} server error${h.serverErrors === 1 ? "" : "s"}`);
  const who = h.peopleAffected === 0 ? "nobody signed in was affected" : `${h.peopleAffected} ${h.peopleAffected === 1 ? "person" : "people"} affected`;
  return `${parts.join(", ")} · ${who}`;
}

/**
 * The Telegram message: a verdict line, the four numbers, and what is at
 * risk in the coming day. Plain text, under Telegram's 4096-char cap.
 */
export function formatRiderPromiseReview(window: ReviewWindow, m: RiderPromiseMetrics): string {
  const verdict = reviewVerdict(m);
  const appIssues = m.appHealth.appErrors + m.appHealth.serverErrors;
  const head =
    verdict === "kept" ? (appIssues === 0 ? "🟢 Every promise kept." : `🟡 Every ride promise kept, but ${appIssues} app error${appIssues === 1 ? "" : "s"} reached ${m.appHealth.peopleAffected === 1 ? "someone" : "people"}.`)
    : verdict === "quiet" ? "⚪ No rides. Nothing to judge."
    : `🔴 ${m.failed + m.strandings + m.fareDeviations.length} promise${m.failed + m.strandings + m.fareDeviations.length === 1 ? "" : "s"} broken.`;

  const lines: string[] = [
    `🚦 ${REVIEW_NAME} — ${window.dayLabel}`,
    head,
    "",
    `Rides: ${m.booked} booked · ${m.delivered} delivered · ${m.failed} failed · ${m.riderCancelled} cancelled by rider`,
    `Strandings: ${m.strandings}${m.nearMisses > 0 ? ` (${m.nearMisses} near-miss${m.nearMisses === 1 ? "" : "es"}: no driver at T-5, driver still came)` : ""}`,
    `Fare accuracy: ${m.fareDeviations.length === 0 ? "every charge matched its quote" : `${m.fareDeviations.length} mismatch${m.fareDeviations.length === 1 ? "" : "es"}`}`,
  ];
  for (const d of m.fareDeviations.slice(0, 5)) {
    lines.push(`  • ride ${d.rideId.slice(0, 8)}: quoted ${money(d.quoted)}, charged ${money(d.charged)}`);
  }
  lines.push(
    `On time: ${m.latePickups === 0 ? `every pickup within ${LATE_PICKUP_MINUTES} min` : `${m.latePickups} late pickup${m.latePickups === 1 ? "" : "s"}, worst ${m.worstLateMinutes} min`}`,
    `App health: ${describeAppHealth(m.appHealth)}`,
    `Outages: ${describeOutages(m.appHealth.outages)}`,
    `Paged ahead: ${m.pagedAhead.paged === 0 ? "no ride needed a page before departure" : `${m.pagedAhead.paged} ride${m.pagedAhead.paged === 1 ? "" : "s"} flagged before departure, ${m.pagedAhead.delivered} still delivered`}`,
    "",
    "Next 24 hours:",
    `  ${m.ahead.unclaimedNext24h} scheduled ride${m.ahead.unclaimedNext24h === 1 ? "" : "s"} still need a driver` +
      (m.ahead.unclaimedInDangerWindow > 0 ? ` — ${m.ahead.unclaimedInDangerWindow} inside ${DANGER_WINDOW_HOURS}h ⚠️` : ""),
    `  ${m.ahead.activePlans} weekly plan${m.ahead.activePlans === 1 ? "" : "s"} active` +
      (m.ahead.unclaimedPlanRides > 0 ? `, ${m.ahead.unclaimedPlanRides} plan ride${m.ahead.unclaimedPlanRides === 1 ? "" : "s"} unclaimed` : ""),
  );
  return lines.join("\n");
}
