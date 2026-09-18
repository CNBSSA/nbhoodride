/**
 * How a PG Ride ride is paid for (founder decision, 2026-09-18: "cash ride to
 * be discontinued").
 *
 * Cash is no longer taken. A rider pays by card; an organization is billed on
 * its statement. Booking had already been card-only for some time — every
 * booking door writes `card`, and `POST /api/rides` refuses anything else —
 * but the ride table still defaulted to cash, so a row written without a
 * payment method was born a cash ride. That door is closed here, and nothing
 * in the product creates a cash ride any more: `storage.createRide` refuses
 * it, and so does the one write that cannot go through it (a commercial job,
 * which shares its transaction).
 *
 * What is NOT removed: every screen and route that handles a cash ride keeps
 * working, because rides taken before today still have to be finished, paid,
 * receipted and reported. A driver can still confirm the money for one and
 * enter the tip that came with it; the receipt still reads "Cash"; the
 * earnings and the operator's figures still count them. Those paths simply
 * run out of rides to serve as the last of them settle.
 */

export type RidePaymentMethod = "card" | "cash" | "invoice";

/** What a new ride may be paid by. Cash is not on this list any more. */
export const PAYMENT_METHODS_ACCEPTED: readonly RidePaymentMethod[] = ["card", "invoice"];

/** Paid for by somebody who is no longer offered that way of paying. */
export const PAYMENT_METHODS_DISCONTINUED: readonly RidePaymentMethod[] = ["cash"];

/** True when a new ride may be created with this payment method. */
export function mayCreateWithPaymentMethod(method: string | null | undefined): boolean {
  return PAYMENT_METHODS_ACCEPTED.includes(String(method ?? "") as RidePaymentMethod);
}

/** True for a ride paid a way PG Ride has stopped taking. */
export function isDiscontinuedPaymentMethod(method: string | null | undefined): boolean {
  return PAYMENT_METHODS_DISCONTINUED.includes(String(method ?? "") as RidePaymentMethod);
}

/**
 * True for a ride whose money the driver took in hand, so it is settled by the
 * driver confirming it rather than by a card.
 *
 * A ride with no payment method recorded counts: the column is nullable and
 * defaulted to cash for as long as cash was taken, so a row from back then
 * with nothing in it was a cash ride in practice, and its driver could always
 * confirm the money. Discontinuing cash must not stand between them and that.
 */
export function settlesInCash(method: string | null | undefined): boolean {
  if (method === null || method === undefined || String(method).trim() === "") return true;
  return isDiscontinuedPaymentMethod(method);
}

/** What to tell whoever tried to pay a way PG Ride no longer takes. */
export const CASH_DISCONTINUED_MESSAGE = "PG Ride no longer takes cash. Rides are paid by card.";

