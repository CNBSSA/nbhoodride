/**
 * Standing weekly ride plan — "same route, same time, every weekday".
 *
 * A plan is a promise, not a prepayment: PG Ride books each day's ride for
 * the rider ahead of time as an ordinary scheduled ride, at a per-ride fare
 * locked when the plan is created. Every ride is charged on its own at
 * completion, exactly like any other ride (see shared/farePolicy.ts). No
 * stored value, nothing paid up front — that keeps the plan inside the
 * card-only posture the business page describes to payment reviewers.
 *
 * Shared by the booking sheet (price preview, day picker) and the server
 * (occurrence generation, fare lock).
 */

/** Plan rides are this much cheaper than the same trip booked one-off. */
export const WEEKLY_PLAN_DISCOUNT = 0.10;

/** Rides are booked this far ahead, rolling; the sweep tops the window up. */
export const PLAN_BOOK_AHEAD_DAYS = 7;

/** A plan needs at least this much notice before its first ride (matches scheduling). */
export const PLAN_MIN_LEAD_HOURS = 3;

/** Every rider in the service area is on US Eastern time. */
export const PLAN_TIMEZONE = "America/New_York";

export const PLAN_DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const WEEKDAYS = [1, 2, 3, 4, 5] as const;

export interface PlanSchedule {
  /** Days of the week the ride runs, 0 = Sunday … 6 = Saturday. */
  days: number[];
  departureHour: number; // 0–23, local to `timezone`
  departureMinute: number; // 0–59
  timezone?: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Per-ride fare on the plan, and what the rider saves per ride. */
export function planFare(quotedTotal: number): { perRide: number; savings: number } {
  const quoted = Number.isFinite(quotedTotal) ? Math.max(0, quotedTotal) : 0;
  const perRide = round2(quoted * (1 - WEEKLY_PLAN_DISCOUNT));
  return { perRide, savings: round2(quoted - perRide) };
}

export function weeklyTotal(perRide: number, dayCount: number): number {
  return round2(perRide * dayCount);
}

/** Sorted, de-duplicated, valid days; empty when nothing usable was given. */
export function normalizePlanDays(days: unknown): number[] {
  if (!Array.isArray(days)) return [];
  const set = new Set<number>();
  for (const d of days) {
    const n = Number(d);
    if (Number.isInteger(n) && n >= 0 && n <= 6) set.add(n);
  }
  return Array.from(set).sort((a, b) => a - b);
}

export function validatePlanSchedule(s: PlanSchedule): { valid: true } | { valid: false; error: string } {
  const days = normalizePlanDays(s.days);
  if (days.length === 0) return { valid: false, error: "Pick at least one day of the week for your plan." };
  if (!Number.isInteger(s.departureHour) || s.departureHour < 0 || s.departureHour > 23)
    return { valid: false, error: "Pick a departure time." };
  if (!Number.isInteger(s.departureMinute) || s.departureMinute < 0 || s.departureMinute > 59)
    return { valid: false, error: "Pick a departure time." };
  return { valid: true };
}

/** "Mon–Fri", "Mon, Wed, Fri", "Every day". */
export function describePlanDays(days: number[]): string {
  const d = normalizePlanDays(days);
  if (d.length === 7) return "Every day";
  if (d.length === 5 && d.join() === "1,2,3,4,5") return "Mon–Fri";
  return d.map((i) => PLAN_DAY_LABELS[i]).join(", ");
}

export function describePlanTime(hour: number, minute: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

// ── Time-zone arithmetic without a library ────────────────────────────────
// Wall-clock parts of an instant in a zone, and the reverse: the instant a
// given wall-clock time in a zone refers to (DST-correct, because the offset
// is measured at the target instant itself).

function partsInZone(instant: Date, timeZone: string): { y: number; m: number; d: number; h: number; min: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23",
    year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short",
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(instant)) p[part.type] = part.value;
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, min: Number(p.minute), weekday };
}

/** The instant at which the wall clock in `timeZone` reads y-m-d h:min. */
export function zonedDateTime(y: number, m: number, d: number, h: number, min: number, timeZone: string = PLAN_TIMEZONE): Date {
  // First guess: treat the wall time as UTC, then correct by the zone's
  // offset at that guess; a second pass settles the DST edge.
  let guess = Date.UTC(y, m - 1, d, h, min, 0, 0);
  for (let i = 0; i < 2; i++) {
    const p = partsInZone(new Date(guess), timeZone);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, 0, 0);
    guess += Date.UTC(y, m - 1, d, h, min, 0, 0) - asUtc;
  }
  return new Date(guess);
}

/**
 * Every departure the plan calls for in (from + lead, until], in order.
 * Walks calendar days in the plan's zone so a Mon–Fri plan means Monday to
 * Friday on the rider's clock, not the server's.
 */
export function planOccurrences(
  schedule: PlanSchedule,
  from: Date,
  until: Date,
  leadHours: number = PLAN_MIN_LEAD_HOURS,
): Date[] {
  const days = normalizePlanDays(schedule.days);
  if (days.length === 0) return [];
  const tz = schedule.timezone || PLAN_TIMEZONE;
  const earliest = from.getTime() + leadHours * 3_600_000;
  const out: Date[] = [];
  const start = partsInZone(from, tz);
  // Step by calendar day using UTC-noon anchors (immune to DST hour shifts).
  const anchor = Date.UTC(start.y, start.m - 1, start.d, 12, 0, 0, 0);
  const dayCount = Math.ceil((until.getTime() - from.getTime()) / 86_400_000) + 1;
  for (let i = 0; i <= dayCount; i++) {
    const dayAnchor = new Date(anchor + i * 86_400_000);
    const y = dayAnchor.getUTCFullYear(), m = dayAnchor.getUTCMonth() + 1, d = dayAnchor.getUTCDate();
    const weekday = dayAnchor.getUTCDay();
    if (!days.includes(weekday)) continue;
    const at = zonedDateTime(y, m, d, schedule.departureHour, schedule.departureMinute, tz);
    if (at.getTime() <= earliest) continue;
    if (at.getTime() > until.getTime()) break;
    out.push(at);
  }
  return out;
}

/** The next departure after `from`, honoring the lead time. */
export function nextPlanOccurrence(schedule: PlanSchedule, from: Date = new Date()): Date | undefined {
  const until = new Date(from.getTime() + (PLAN_BOOK_AHEAD_DAYS + 1) * 86_400_000);
  return planOccurrences(schedule, from, until)[0];
}
