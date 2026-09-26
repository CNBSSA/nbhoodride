/**
 * The billing week — when an organization is charged, and for what.
 *
 * The plan's cash-flow section settled this: monthly invoicing at net 30
 * would have PG Ride carrying six weeks of driver pay for every facility.
 * Weekly bank debit for last week's work bounds that to about two weeks and
 * needs no invoice chasing, so it is the default; net terms are the
 * exception, offered against a deposit, and are never charged automatically.
 *
 * A week runs Monday to Monday in Eastern time and is named by the date of
 * its Monday ("2026-09-07"), which reads plainly on a statement and avoids
 * the ISO week-number edge cases entirely. Last week is charged the
 * following Monday morning.
 */

import { PLAN_TIMEZONE, zonedDateTime, zonedParts } from "./weeklyPlan";
import { statementTotals, type StatementLine, type StatementTotals } from "./commercial";

/** Monday. Last week's work is charged on this day. */
export const BILLING_WEEKDAY = 1;
/** 9 AM Eastern: after the weekend, inside business hours for a bank debit. */
export const BILLING_HOUR_LOCAL = 9;
/** A week that comes to less than this is carried into the next one, not charged. */
export const MINIMUM_CHARGE = 1;

export type BillingStatus = "open" | "charging" | "paid" | "failed" | "void";
export const BILLING_STATUSES: BillingStatus[] = ["open", "charging", "paid", "failed", "void"];

const pad = (n: number) => String(n).padStart(2, "0");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface BillingWeek {
  /** The Eastern date of the week's Monday, "YYYY-MM-DD". */
  weekKey: string;
  /** "Sep 7–13, 2026" */
  label: string;
  start: Date;
  end: Date;
}

/** The Eastern date of the Monday that starts the week `instant` falls in. */
export function weekKeyOf(instant: Date, timeZone: string = PLAN_TIMEZONE): string {
  const p = zonedParts(instant, timeZone);
  // Step back to Monday through a UTC-noon anchor, which has no DST hour to trip on.
  const anchor = Date.UTC(p.y, p.m - 1, p.d, 12);
  const back = (p.weekday + 6) % 7; // Sunday(0) → 6, Monday(1) → 0
  const monday = new Date(anchor - back * 86_400_000);
  return `${monday.getUTCFullYear()}-${pad(monday.getUTCMonth() + 1)}-${pad(monday.getUTCDate())}`;
}

/** The week named by that Monday, as an instant range and a label. */
export function billingWeekWindow(weekKey: string, timeZone: string = PLAN_TIMEZONE): BillingWeek {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(weekKey);
  if (!m) throw new Error("week must be YYYY-MM-DD (the Monday it starts)");
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const start = zonedDateTime(y, mo, d, 0, 0, timeZone);
  if (Number.isNaN(start.getTime())) throw new Error("week must be a real date");
  const endAnchor = new Date(Date.UTC(y, mo - 1, d, 12) + 7 * 86_400_000);
  const end = zonedDateTime(endAnchor.getUTCFullYear(), endAnchor.getUTCMonth() + 1, endAnchor.getUTCDate(), 0, 0, timeZone);
  const lastAnchor = new Date(Date.UTC(y, mo - 1, d, 12) + 6 * 86_400_000);
  const sameMonth = lastAnchor.getUTCMonth() === mo - 1;
  const label = sameMonth
    ? `${MONTHS[mo - 1]} ${d}–${lastAnchor.getUTCDate()}, ${y}`
    : `${MONTHS[mo - 1]} ${d} – ${MONTHS[lastAnchor.getUTCMonth()]} ${lastAnchor.getUTCDate()}, ${lastAnchor.getUTCFullYear()}`;
  return { weekKey, label, start, end };
}

/** The week that is finished and due to be charged as of `now`. */
export function previousBillingWeek(now: Date = new Date(), timeZone: string = PLAN_TIMEZONE): BillingWeek {
  const thisWeek = billingWeekWindow(weekKeyOf(now, timeZone), timeZone);
  const back = new Date(thisWeek.start.getTime() - 3 * 86_400_000); // safely inside the week before
  return billingWeekWindow(weekKeyOf(back, timeZone), timeZone);
}

/** True on the Monday morning run, at or after the billing hour, Eastern. */
export function billingRunDue(now: Date = new Date(), timeZone: string = PLAN_TIMEZONE): boolean {
  const p = zonedParts(now, timeZone);
  return p.weekday === BILLING_WEEKDAY && p.h >= BILLING_HOUR_LOCAL;
}

export interface WeekCharge {
  totals: StatementTotals;
  /** What will actually be taken; zero when the week is under the minimum. */
  amount: number;
  chargeable: boolean;
  reason: string;
}

/** What a week comes to, and whether it is worth a bank debit. */
export function weekCharge(lines: StatementLine[]): WeekCharge {
  const totals = statementTotals(lines);
  if (totals.jobs === 0) return { totals, amount: 0, chargeable: false, reason: "No billable jobs this week" };
  if (totals.total < MINIMUM_CHARGE) return { totals, amount: 0, chargeable: false, reason: `Under the ${MINIMUM_CHARGE.toFixed(2)} minimum; carried into next week` };
  return { totals, amount: totals.total, chargeable: true, reason: `${totals.completed} completed, ${totals.cancelled} cancelled` };
}

/** Whether an organization on these terms is charged automatically at all. */
export function autoCharges(billingMode: string | null | undefined): boolean {
  return (billingMode ?? "weekly_debit") === "weekly_debit";
}

/** What the desk is told about a statement's state. */
export function describeBillingStatus(status: string, amount: number | string, label: string): string {
  const money = `$${Number(amount ?? 0).toFixed(2)}`;
  switch (status) {
    case "paid": return `${money} for ${label}, paid`;
    case "charging": return `${money} for ${label}, payment in progress`;
    case "failed": return `${money} for ${label} could not be collected`;
    case "void": return `${label} was cancelled`;
    default: return `${money} for ${label}, not yet collected`;
  }
}

/**
 * What a Stripe PaymentIntent status means for a statement. Only a decided
 * intent moves a statement; "processing" (a bank debit clearing over days)
 * and "requires_*" are still undecided and return null.
 */
export function statementStatusFromIntent(status: string): "paid" | "failed" | null {
  if (status === "succeeded") return "paid";
  if (status === "canceled" || status === "requires_payment_method") return "failed";
  return null;
}

/**
 * The Stripe idempotency key for one attempt at collecting a statement.
 *
 * One key per attempt, not per statement (corporate audit, #382): the key
 * makes Stripe replay the SAME result for a repeated request, which is what
 * you want while an attempt's outcome is unknown (a network timeout mid
 * request) and exactly what you do not want after an attempt has failed —
 * the old key replayed the failure for a day, so an operator's retry could
 * not succeed. The attempt number is bumped and stored BEFORE Stripe is
 * called, so a retry of an unfinished attempt reuses its key and a retry
 * after a recorded failure gets a fresh one.
 */
export function chargeAttemptKey(statementId: string, attempt: number): string {
  return `commercial-statement-${statementId}-attempt-${attempt}`;
}

export type SettlementAction = "paid" | "failed" | "undecided" | "ignore";

export interface SettlementDecision {
  action: SettlementAction;
  /** Why, in words an operator can read in a log line. */
  reason: string;
  /** True when the statement had no intent recorded and this one is adopted as its attempt. */
  adopts: boolean;
}

/**
 * What a Stripe event about a PaymentIntent means for a statement.
 *
 * An event is trusted only when the intent is the statement's CURRENT
 * attempt (corporate audit, #382): a late event about a superseded attempt
 * — a failure arriving after a later attempt paid, or a success for an
 * attempt the operator gave up on — is ignored, never applied. A statement
 * that is charging with no intent recorded (the request to Stripe died
 * before the id came back) adopts the intent the event names, since the
 * event's metadata proves it was raised for this statement.
 */
export function settlementDecision(
  statement: { status: string; stripePaymentIntentId: string | null },
  intent: { id: string; status: string },
): SettlementDecision {
  if (statement.status === "paid" || statement.status === "void") {
    return { action: "ignore", reason: `statement already ${statement.status}`, adopts: false };
  }
  const current = statement.stripePaymentIntentId;
  if (current && current !== intent.id) {
    return { action: "ignore", reason: `event is about ${intent.id}, the statement's current attempt is ${current}`, adopts: false };
  }
  const adopts = !current;
  const next = statementStatusFromIntent(intent.status);
  if (next === "paid") return { action: "paid", reason: "Paid", adopts };
  if (next === "failed") return { action: "failed", reason: `Bank debit ${intent.status}`, adopts };
  return { action: "undecided", reason: `Bank debit ${intent.status}; nothing to do yet`, adopts };
}
