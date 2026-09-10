/**
 * An organization's terms — what a cancellation, a no-show and waiting at
 * the door cost it, and how a standing order repeats.
 *
 * Riders cancel under a ladder written for people (shared/legalContent.ts).
 * A facility signs an agreement instead, and the app enforces it or nobody
 * will: these are the numbers in that agreement, with the defaults the plan
 * proposed. Stored per organization in `organizations.terms`; anything
 * missing falls back to the default.
 *
 * Pure: shared by the server (cancel, no-show, completion) and the portal
 * (the terms shown to the desk), unit-tested without a database.
 */

import { PLAN_TIMEZONE, normalizePlanDays, planOccurrences, type PlanSchedule } from "./weeklyPlan";

export interface OrgTerms {
  /** Cancelling at least this many hours before pickup costs nothing. */
  freeCancelHours: number;
  /** Cancelling inside that window, once a driver holds the job. */
  lateCancelFee: number;
  /** The passenger was not there after the driver waited. */
  noShowFee: number;
  /** Minutes at the door that cost nothing. */
  waitFreeMinutes: number;
  /** Each minute after that. */
  waitFeePerMinute: number;
  /** A will-call return is dispatched this many minutes out at the least. */
  willCallLeadMinutes: number;
}

export const DEFAULT_ORG_TERMS: OrgTerms = {
  freeCancelHours: 2,
  lateCancelFee: 7,
  noShowFee: 10,
  waitFreeMinutes: 10,
  waitFeePerMinute: 0.5,
  willCallLeadMinutes: 20,
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const numOr = (v: unknown, def: number, min: number, max: number): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
};

/** The organization's terms with every gap filled from the defaults, clamped to sane ranges. */
export function orgTerms(raw: unknown): OrgTerms {
  const t = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    freeCancelHours: numOr(t.freeCancelHours, DEFAULT_ORG_TERMS.freeCancelHours, 0, 72),
    lateCancelFee: round2(numOr(t.lateCancelFee, DEFAULT_ORG_TERMS.lateCancelFee, 0, 100)),
    noShowFee: round2(numOr(t.noShowFee, DEFAULT_ORG_TERMS.noShowFee, 0, 100)),
    waitFreeMinutes: Math.round(numOr(t.waitFreeMinutes, DEFAULT_ORG_TERMS.waitFreeMinutes, 0, 120)),
    waitFeePerMinute: round2(numOr(t.waitFeePerMinute, DEFAULT_ORG_TERMS.waitFeePerMinute, 0, 5)),
    willCallLeadMinutes: Math.round(numOr(t.willCallLeadMinutes, DEFAULT_ORG_TERMS.willCallLeadMinutes, 10, 120)),
  };
}

/** Only the known keys, validated, for storing a PATCH. */
export function sanitizeTermsPatch(raw: unknown): Partial<OrgTerms> {
  const full = orgTerms(raw);
  const t = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Partial<OrgTerms> = {};
  for (const k of Object.keys(DEFAULT_ORG_TERMS) as Array<keyof OrgTerms>) if (k in t) out[k] = full[k];
  return out;
}

/**
 * What cancelling a job costs the organization now. Nothing while no driver
 * holds it (nobody is harmed), nothing at or beyond the free window, the
 * late fee inside it.
 */
export function organizationCancellationFee(
  job: { scheduledAt: Date | string | null | undefined; driverId: string | null | undefined },
  terms: OrgTerms,
  now: Date = new Date(),
): { fee: number; reason: string } {
  if (!job.driverId) return { fee: 0, reason: "No driver held the job yet" };
  const at = job.scheduledAt ? new Date(job.scheduledAt).getTime() : NaN;
  if (!Number.isFinite(at)) return { fee: round2(terms.lateCancelFee), reason: "Cancelled after a driver was assigned" };
  const hoursAhead = (at - now.getTime()) / 3_600_000;
  if (hoursAhead >= terms.freeCancelHours) return { fee: 0, reason: `Cancelled ${Math.floor(hoursAhead)}h ahead, within the free window` };
  return { fee: round2(terms.lateCancelFee), reason: `Cancelled less than ${terms.freeCancelHours}h before pickup with a driver assigned` };
}

/** Waiting at the door: minutes past the free allowance, and what they cost. */
export function waitingCharge(
  stamps: { arrivedAt: Date | string | null | undefined; startedAt: Date | string | null | undefined },
  terms: OrgTerms,
): { waitMinutes: number; waitFee: number; billableMinutes: number } {
  const a = stamps.arrivedAt ? new Date(stamps.arrivedAt).getTime() : NaN;
  const s = stamps.startedAt ? new Date(stamps.startedAt).getTime() : NaN;
  if (!Number.isFinite(a) || !Number.isFinite(s) || s <= a) return { waitMinutes: 0, waitFee: 0, billableMinutes: 0 };
  const waitMinutes = Math.round((s - a) / 60_000);
  const billableMinutes = Math.max(0, waitMinutes - terms.waitFreeMinutes);
  return { waitMinutes, waitFee: round2(billableMinutes * terms.waitFeePerMinute), billableMinutes };
}

/** One sentence for the desk and the agreement. */
export function describeTerms(t: OrgTerms): string {
  const fee = (n: number) => `$${n.toFixed(2)}`;
  return `Cancel free up to ${t.freeCancelHours} hour${t.freeCancelHours === 1 ? "" : "s"} before pickup, or any time before a driver is assigned; ${fee(t.lateCancelFee)} after that. No-show ${fee(t.noShowFee)}. Waiting is free for ${t.waitFreeMinutes} minutes, then ${fee(t.waitFeePerMinute)} a minute. A will-call return is dispatched at least ${t.willCallLeadMinutes} minutes out.`;
}

// ── Standing orders ──

export const RETURN_MODES = ["none", "fixed", "will_call"] as const;
export type ReturnMode = (typeof RETURN_MODES)[number];
export const isReturnMode = (v: unknown): v is ReturnMode => RETURN_MODES.includes(v as ReturnMode);

/** How far ahead standing orders are booked. */
export const STANDING_ORDER_BOOK_AHEAD_DAYS = 7;

export interface StandingSchedule {
  days: number[];
  departureHour: number;
  departureMinute: number;
  returnMode: ReturnMode;
  returnHour?: number | null;
  returnMinute?: number | null;
}

export function validateStandingSchedule(s: StandingSchedule): { valid: true } | { valid: false; error: string } {
  const days = normalizePlanDays(s.days);
  if (days.length === 0) return { valid: false, error: "Pick at least one day of the week." };
  const h = Number(s.departureHour), m = Number(s.departureMinute);
  if (!Number.isInteger(h) || h < 0 || h > 23 || !Number.isInteger(m) || m < 0 || m > 59) return { valid: false, error: "The pickup time must be a time of day." };
  if (!isReturnMode(s.returnMode)) return { valid: false, error: "Return must be none, fixed or will_call." };
  if (s.returnMode === "fixed") {
    const rh = Number(s.returnHour), rm = Number(s.returnMinute);
    if (!Number.isInteger(rh) || rh < 0 || rh > 23 || !Number.isInteger(rm) || rm < 0 || rm > 59) return { valid: false, error: "A fixed return needs a time of day." };
    if (rh * 60 + rm <= h * 60 + m) return { valid: false, error: "The return must be later in the day than the pickup." };
  }
  return { valid: true };
}

/**
 * The service dates (Eastern) and instants a standing order should have
 * jobs for between now and the horizon: the outbound pickup and, for a fixed
 * return, the return pickup. Each carries the Eastern date "YYYY-MM-DD" so
 * a job is booked once per order, date and leg.
 */
export function standingOccurrences(
  s: StandingSchedule,
  from: Date,
  horizonDays: number = STANDING_ORDER_BOOK_AHEAD_DAYS,
  leadHours: number = 3,
): Array<{ serviceDate: string; leg: "out" | "return"; at: Date }> {
  const until = new Date(from.getTime() + horizonDays * 86_400_000);
  const out: Array<{ serviceDate: string; leg: "out" | "return"; at: Date }> = [];
  const dateKey = (d: Date) => {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: PLAN_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
    const get = (t: string) => p.find((x) => x.type === t)!.value;
    return `${get("year")}-${get("month")}-${get("day")}`;
  };
  const outbound: PlanSchedule = { days: s.days, departureHour: s.departureHour, departureMinute: s.departureMinute, timezone: PLAN_TIMEZONE } as PlanSchedule;
  for (const at of planOccurrences(outbound, from, until, leadHours)) out.push({ serviceDate: dateKey(at), leg: "out", at });
  if (s.returnMode === "fixed" && s.returnHour != null && s.returnMinute != null) {
    const ret: PlanSchedule = { days: s.days, departureHour: s.returnHour, departureMinute: s.returnMinute, timezone: PLAN_TIMEZONE } as PlanSchedule;
    for (const at of planOccurrences(ret, from, until, leadHours)) out.push({ serviceDate: dateKey(at), leg: "return", at });
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}
