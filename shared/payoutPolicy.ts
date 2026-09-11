/**
 * How a completed ride's money is divided (founder decision, 2026-09-06):
 *
 *   - 85% of the fare to the driver, 15% to PG Ride.
 *   - 100% of any tip to the driver.
 *   - PG Ride pays the card-processing fees out of its own share; nothing
 *     is deducted from the driver for them.
 *
 * Applied once, at completion, and recorded on the ride (platform_fee,
 * driver_earnings) so earnings, payouts and admin revenue all read the
 * same numbers. Rides completed before this policy existed have no
 * recorded split; the driver was credited the full fare on those.
 *
 * A discount is PG Ride's, not the driver's (founder decision, 2026-09-10).
 * A welcome credit or a promotion is what PG Ride spends to win a rider;
 * the driver drove the same miles either way, so they are paid on the fare
 * before the discount and PG Ride's own share absorbs it. On a large enough
 * discount that share goes negative — which is simply what buying a rider
 * cost, recorded honestly instead of quietly taken out of the driver's pay.
 */

export const PLATFORM_SHARE = 0.15;
export const DRIVER_SHARE = 1 - PLATFORM_SHARE;

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: number | string | null | undefined): number => {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export interface SplitOptions {
  /**
   * The fare the driver is paid on, when it differs from what the rider was
   * charged — the pre-discount fare on a promo ride. Never below the charged
   * fare: a driver is not paid less than the rider paid.
   */
  driverBasis?: number | string | null;
}

export interface FareSplit {
  /** What the rider paid for the ride, excluding tip. */
  fare: number;
  /** PG Ride's share of the fare. */
  platformFee: number;
  /** The driver's share of the fare (fare − platformFee, so cents always reconcile). */
  driverFareShare: number;
  /** Tip, all of it to the driver. */
  tip: number;
  /** driverFareShare + tip — the amount credited to the driver. */
  driverEarnings: number;
}

export function splitFare(
  fare: number | string | null | undefined,
  tip: number | string | null | undefined = 0,
  opts: SplitOptions = {},
): FareSplit {
  const f = round2(num(fare));
  const t = round2(num(tip));
  // Without a basis of its own this is the charged fare, so an ordinary ride
  // splits exactly as it always did.
  const basis = Math.max(f, round2(num(opts.driverBasis)));
  const driverFareShare = round2(basis - round2(basis * PLATFORM_SHARE));
  // What is left of what the rider actually paid. Negative when a discount
  // was larger than PG Ride's share of the full fare.
  const platformFee = round2(f - driverFareShare);
  return { fare: f, platformFee, driverFareShare, tip: t, driverEarnings: round2(driverFareShare + t) };
}
