/**
 * Tipping the driver after a card ride (rates audit, 2026-09-18).
 *
 * Until now a tip could only be handed over in cash and entered by the
 * driver; a card rider had no way to tip at all, though the app told the
 * driver "tips on card rides are added by the rider". This is that door.
 *
 * Rules, in line with how ride apps do it:
 *   - the rider tips once, after the ride is completed, within TIP_WINDOW_DAYS
 *     (Uber allows 30 days, Lyft 72 hours; a week is long enough to remember
 *     the ride and short enough that the card on file is still the card);
 *   - presets or any amount from TIP_MIN to TIP_MAX, whole cents;
 *   - the tip is charged to the card on file as its own payment, never
 *     folded into the fare, and 100% of it goes to the driver
 *     (shared/payoutPolicy.ts); PG Ride pays the card fee on it.
 */

export const TIP_PRESETS = [2, 3, 5] as const;
export const TIP_MIN = 1;
export const TIP_MAX = 100;
export const TIP_WINDOW_DAYS = 7;

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface TippableRide {
  status?: string | null;
  paymentMethod?: string | null;
  /** The fare must have settled (paid_card) before a tip is taken on top of it. */
  paymentStatus?: string | null;
  completedAt?: Date | string | null;
  tipAmount?: number | string | null;
  driverId?: string | null;
  /** A ride refunded after a dispute is not tipped. */
  refundedAmount?: number | string | null;
}

export type TipRefusal =
  | "not_completed"
  | "not_card"
  | "no_driver"
  | "not_settled"
  | "refunded"
  | "already_tipped"
  | "window_closed";

const money = (v: number | string | null | undefined): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "0"));
  return Number.isFinite(n) ? n : 0;
};

/** Why a tip cannot be added to this ride, or null when it can. */
export function tipRefusal(ride: TippableRide, now: Date = new Date()): TipRefusal | null {
  if (ride.status !== "completed") return "not_completed";
  if (ride.paymentMethod !== "card") return "not_card";
  if (!ride.driverId) return "no_driver";
  // Only a settled fare takes a tip on top: a ride whose settlement failed
  // or is disputed is the operator's to sort out first, and a tip's own
  // charge must never be mistaken for the fare's.
  if (ride.paymentStatus !== "paid_card") return "not_settled";
  if (money(ride.refundedAmount) > 0) return "refunded";
  if (money(ride.tipAmount) > 0) return "already_tipped";
  const completed = ride.completedAt ? new Date(ride.completedAt).getTime() : NaN;
  if (!Number.isFinite(completed) || now.getTime() - completed > TIP_WINDOW_DAYS * 86_400_000) return "window_closed";
  return null;
}

export function describeTipRefusal(why: TipRefusal): string {
  switch (why) {
    case "not_completed": return "You can tip once the ride is completed.";
    case "not_card": return "Tips on a cash ride are handed to the driver.";
    case "no_driver": return "This ride had no driver to tip.";
    case "not_settled": return "This ride's payment is still being sorted out. You can tip once it has gone through.";
    case "refunded": return "This ride was refunded, so it does not take a tip.";
    case "already_tipped": return "You already tipped for this ride. Thank you.";
    case "window_closed": return `Tips can be added up to ${TIP_WINDOW_DAYS} days after a ride.`;
  }
}

/** A tip amount in dollars, or null when it is not one PG Ride takes. */
export function normalizeTip(input: unknown): number | null {
  const n = typeof input === "number" ? input : parseFloat(String(input ?? ""));
  if (!Number.isFinite(n)) return null;
  const amount = round2(n);
  if (amount < TIP_MIN || amount > TIP_MAX) return null;
  return amount;
}
