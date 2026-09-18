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
 *
 * Which discounts are PG Ride's (rates audit, 2026-09-18, industry practice):
 *
 *   welcome credit / promo   PG Ride's — a promotion to win a rider.
 *   weekly plan (10%)        PG Ride's — a loyalty rate, the same as a
 *                            membership discount; the driver drives one
 *                            ordinary trip and is paid on the full fare.
 *   coworker group / shared  a RATE, not a discount. A shared trip is priced
 *   ride (30%)               per rider on the shared price everywhere in the
 *                            industry; the driver is paid 85% of each seat,
 *                            and carries several seats in one drive.
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

/** Ride types whose rate discount is PG Ride's to absorb (see the header). */
export const PLATFORM_ABSORBED_RATE_TYPES: ReadonlySet<string> = new Set(["weekly_plan"]);

export function platformAbsorbsRate(rideType: string | null | undefined): boolean {
  return !!rideType && PLATFORM_ABSORBED_RATE_TYPES.has(rideType);
}

export interface DriverBasisInput {
  /** What the rider is charged for the ride, after every discount. */
  charged: number;
  /** How that fare was arrived at (shared/farePolicy.ts). */
  basis: "explicit" | "quoted" | "metered";
  /** The fare quoted at booking: after any rate discount, before any promo. */
  quotedFare: number | string | null | undefined;
  /** The fare before any rate discount (group, shared, plan), when one applied. */
  originalFare?: number | string | null;
  rideType?: string | null;
  /** The welcome credit or promotion taken off at accept time. */
  promoDiscount?: number | string | null;
  /** GPS-metered fare after the rate discount was re-applied, before the promo. */
  meteredGross?: number;
  /** GPS-metered fare before any rate discount was re-applied. */
  meteredUnscaled?: number;
}

/**
 * The fare the driver is paid on. Equal to what the rider was charged unless
 * a discount that is PG Ride's came off it; then it is the fare before that
 * discount, never more than the rider was ever quoted, and never less than
 * what the rider paid. An explicit fare is what an admin says the ride cost,
 * discount and all, so it is taken at face value.
 */
export function driverBasisFor(input: DriverBasisInput): number {
  const charged = round2(num(input.charged));
  if (input.basis === "explicit") return charged;
  const quoted = round2(num(input.quotedFare));
  const original = round2(num(input.originalFare));
  const planDiscount = platformAbsorbsRate(input.rideType) && original > quoted ? round2(original - quoted) : 0;
  const promo = round2(num(input.promoDiscount));
  if (promo + planDiscount <= 0) return charged;
  // What the rider was quoted before anything PG Ride absorbs came off.
  const quotedGross = round2(quoted + planDiscount);
  let grossOfBasis = quotedGross;
  if (input.basis === "metered") {
    const metered = planDiscount > 0 && input.meteredUnscaled !== undefined ? input.meteredUnscaled : input.meteredGross;
    if (metered !== undefined && Number.isFinite(metered)) grossOfBasis = round2(metered);
  }
  // A metered fare is capped at the quote, so the basis is capped with it —
  // the driver is never paid on more than the rider was ever quoted.
  const capped = quotedGross > 0 ? Math.min(grossOfBasis, quotedGross) : grossOfBasis;
  return Math.max(charged, round2(capped));
}
