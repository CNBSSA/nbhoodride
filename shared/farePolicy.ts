/**
 * What a rider pays when a ride completes.
 *
 * PG Ride quotes the fare up front: the number the rider confirms at booking
 * (and the driver sees when accepting) is the number charged. Re-pricing the
 * trip from the driver phone's GPS breadcrumbs at completion looked fair on
 * paper but is wrong in practice — a web app in a car mount stops reporting
 * location the moment the screen locks or the driver switches to navigation,
 * so the recorded track is a fraction of the real drive. The very first PG
 * Ride trip was quoted $23.21 and charged $7.12 for exactly that reason.
 *
 * Rules, in order:
 *   1. An explicit fare (driver/admin supplied) wins.
 *   2. "quoted" pricing (normal completion): estimatedFare minus any promo
 *      recorded on the ride.
 *   3. "metered" pricing (ride ended early, mid-trip): the GPS-based fare,
 *      but never more than the quote — an early end can't cost more than the
 *      full trip would have.
 *   4. With nothing to go on, undefined; the caller keeps whatever it had.
 */

export type FarePricing = "quoted" | "metered";
export type FareBasis = "explicit" | "quoted" | "metered";

export interface ResolveFareInput {
  pricing?: FarePricing;
  explicit?: number;
  /** Fare shown to the rider at booking (pre-promo). */
  quotedFare?: number | string | null;
  /** Promo discount recorded on the ride at accept time. */
  promoDiscount?: number | string | null;
  /** GPS-derived fare, already discounted, if the caller computed one. */
  metered?: number;
}

const num = (v: number | string | null | undefined): number => {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

export function resolveCompletedFare(input: ResolveFareInput): { fare: number; basis: FareBasis } | undefined {
  const pricing = input.pricing ?? "quoted";
  if (input.explicit !== undefined && Number.isFinite(input.explicit) && input.explicit > 0) {
    return { fare: round2(input.explicit), basis: "explicit" };
  }

  const quotedGross = num(input.quotedFare);
  const promo = Math.max(0, num(input.promoDiscount));
  const quoted = quotedGross > 0 ? round2(Math.max(0, quotedGross - promo)) : undefined;

  if (pricing === "quoted") {
    if (quoted !== undefined) return { fare: quoted, basis: "quoted" };
    if (input.metered !== undefined && Number.isFinite(input.metered)) return { fare: round2(input.metered), basis: "metered" };
    return undefined;
  }

  // metered
  if (input.metered !== undefined && Number.isFinite(input.metered)) {
    const capped = quoted !== undefined ? Math.min(input.metered, quoted) : input.metered;
    return { fare: round2(Math.max(0, capped)), basis: "metered" };
  }
  if (quoted !== undefined) return { fare: quoted, basis: "quoted" };
  return undefined;
}
