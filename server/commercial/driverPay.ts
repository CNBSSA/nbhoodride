/**
 * Paying the driver for commercial work.
 *
 * A card ride settles at the kerb and a cash ride needs no settling — the
 * driver is holding the money. A commercial job is neither: the organization
 * is billed weekly and PG Ride collects, so unless the driver is paid here,
 * they do the work and nothing ever reaches their wallet.
 *
 * The driver is paid when the work is done, not when the organization pays.
 * Their money must never wait on someone else's payment terms, so PG Ride
 * carries up to a week of float between paying the driver and collecting the
 * statement. That float is the real cost of offering businesses an invoice.
 *
 * What the driver is paid for:
 *
 *   the fare      85%, exactly as on any other ride
 *   waiting       85% — the minutes at the door are the driver's time, and
 *                 the organization is already charged for them
 *   a no-show     the ordinary fee split (routed by the caller), because the
 *                 driver drove there and waited either way
 *   facility fee  nothing. It pays for the account, the desk portal and the
 *                 statement — office work, not driving.
 */

import { splitFare } from "@shared/payoutPolicy";
import type { Ride } from "@shared/schema";
import type { IStorage } from "../storage";

/** Ledger reason for the driver's share of waiting at the door. */
export const WAITING_REASON = "commercial_waiting";

const money = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "0"));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Credit the driver for a finished commercial job. Idempotent: the ledger
 * carries one `ride_earnings` row per ride, so a retried completion pays
 * once. Returns what was credited, or 0 if it was already paid.
 */
export async function payDriverForCompletedJob(storage: IStorage, ride: Ride): Promise<number> {
  if (ride.paymentMethod !== "invoice" || !ride.driverId) return 0;
  // completeRide fixes the split on the ride; fall back to computing it only
  // for a row written before the split was recorded.
  const amount = money(ride.driverEarnings)
    || splitFare(ride.actualFare ?? ride.estimatedFare, ride.tipAmount).driverEarnings;
  if (amount <= 0) return 0;
  const credited = await storage.creditDriverEarningsOnce(ride.id, ride.driverId, amount);
  if (credited) console.log(`[commercial] driver paid :: ride ${ride.id.slice(0, 8)} | $${amount.toFixed(2)}`);
  return credited ? amount : 0;
}

/**
 * Credit the driver their share of the waiting the organization was charged
 * for. Guarded on the ledger so a retried completion pays once.
 */
export async function payDriverForWaiting(storage: IStorage, ride: Ride, waitFee: number): Promise<number> {
  if (ride.paymentMethod !== "invoice" || !ride.driverId) return 0;
  const fee = money(waitFee);
  if (fee <= 0) return 0;
  if (await storage.hasWalletTransaction(ride.id, WAITING_REASON)) return 0;
  const driverCut = splitFare(fee).driverFareShare;
  if (driverCut <= 0) return 0;
  await storage.addVirtualCardBalance(ride.driverId, driverCut, WAITING_REASON, ride.id);
  console.log(`[commercial] driver paid for waiting :: ride ${ride.id.slice(0, 8)} | $${driverCut.toFixed(2)} of $${fee.toFixed(2)}`);
  return driverCut;
}
