/**
 * Payday — when a driver is paid, without having to ask.
 *
 * Before this, earnings landed in a driver's balance the moment a job
 * finished and then sat there until they opened the app, tapped Request
 * payout, and waited for someone to action it by hand. There was no payday:
 * the honest answer to "when do I get paid" was "whenever the founder gets
 * to his phone". A better rate paid on an unpredictable day is a weaker
 * offer than it sounds, and it does not scale past a handful of drivers.
 *
 * So: one run, Friday morning Eastern, every driver with a balance and a
 * payout method on file. Friday because drivers plan a weekend around it,
 * and because it leaves the working week to fund it.
 *
 * The whole balance is paid, not "everything earned before a cut-off". The
 * balance is a running figure that also carries tips, adjustments and
 * refunds, so reconstructing it as at some earlier moment would be a
 * reliable source of wrong numbers. What a driver has on Friday morning is
 * what a driver is paid.
 */

import { PLAN_TIMEZONE, zonedParts } from "./weeklyPlan";

/** Friday. */
export const PAYDAY_WEEKDAY = 5;
/** 9 AM Eastern — a driver waking up to it, and a business day to send it. */
export const PAYDAY_HOUR_LOCAL = 9;
/** Below this a balance rides to next Friday rather than making a payment. */
export const MINIMUM_PAYDAY_AMOUNT = 5;

const pad = (n: number) => String(n).padStart(2, "0");

/** The Eastern date of the payday `instant` belongs to, "YYYY-MM-DD". */
export function paydayKeyOf(instant: Date, timeZone: string = PLAN_TIMEZONE): string {
  const p = zonedParts(instant, timeZone);
  // Anchor at UTC noon so no DST hour can shift the date underneath us.
  const anchor = Date.UTC(p.y, p.m - 1, p.d, 12);
  // Step back to the most recent Friday (today, if today is Friday).
  const back = (p.weekday - PAYDAY_WEEKDAY + 7) % 7;
  const friday = new Date(anchor - back * 86_400_000);
  return `${friday.getUTCFullYear()}-${pad(friday.getUTCMonth() + 1)}-${pad(friday.getUTCDate())}`;
}

/** Is a payday run due? Friday, from 9 AM Eastern onward. */
export function paydayRunDue(now: Date = new Date(), timeZone: string = PLAN_TIMEZONE): boolean {
  const p = zonedParts(now, timeZone);
  return p.weekday === PAYDAY_WEEKDAY && p.h >= PAYDAY_HOUR_LOCAL;
}

export interface PaydayDecision {
  /** What to pay, to the cent. Zero when nothing should move. */
  amount: number;
  pay: boolean;
  /** Said plainly, because it is shown to the operator and sometimes the driver. */
  reason: string;
}

/**
 * What a single driver gets this payday. Pure: given a balance and whether
 * a payout method is on file, decide. Never pays more than the balance and
 * never pays a driver with nowhere to send it.
 */
export function paydayFor(
  balance: number | string | null | undefined,
  hasPayoutMethod: boolean,
): PaydayDecision {
  const n = typeof balance === "number" ? balance : parseFloat(String(balance ?? "0"));
  const amount = Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;

  if (amount <= 0) return { amount: 0, pay: false, reason: "Nothing owed" };
  if (!hasPayoutMethod) {
    return { amount: 0, pay: false, reason: "No payout method on file — the driver sets one in the app" };
  }
  if (amount < MINIMUM_PAYDAY_AMOUNT) {
    return { amount: 0, pay: false, reason: `Under the $${MINIMUM_PAYDAY_AMOUNT} minimum; rides to next Friday` };
  }
  return { amount, pay: true, reason: "Paid on the weekly run" };
}

/** "Fri 13 Sep" — for the operator's summary and the driver's notification. */
export function paydayLabel(paydayKey: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(paydayKey);
  if (!m) return paydayKey;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `Fri ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
