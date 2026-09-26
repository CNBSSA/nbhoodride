/**
 * Every booking is priced by the server.
 *
 * The fare a rider confirms at booking is the fare charged at completion
 * (shared/farePolicy.ts), so the number written on the ride can never be
 * one the app chose. Until 2026-09-16 a standard ride stored whatever
 * estimatedFare the app sent; from then the ordinary booking door floored
 * the app's number at the server's own quote, but the multi-stop and
 * coworker-group doors still stored the app's number as sent, and the
 * multi-stop sheet priced with a tariff nothing else used (corporate audit
 * #379, 2026-09-26).
 *
 * Now one rule for every door:
 *
 *   - The ride's road figures are the app's when they could be true (a road
 *     route is never shorter than the straight line, nobody averages over
 *     70 mph door to door — shared/routeEstimate.ts), the server's own
 *     estimate otherwise. The app's figures are its Mapbox route, which is
 *     better than the straight-line estimate made here, and are what the
 *     rider was shown.
 *   - The fare is the server's quote for those figures on the live rate
 *     card and the requested vehicle class. Always. An app that priced the
 *     same figures on the same rate card sends the same number, so a rider
 *     on a current bundle sees no difference.
 *   - The app's number is compared, not trusted: well below the quote it
 *     is a tampered app and ops are told; well above it is a stale rate
 *     card on an old bundle and ops are told, and the rider pays the rate
 *     card, not the stale number.
 *
 * Distance, duration and fare on a ride are therefore always one coherent
 * triple priced by the server.
 */

import { estimateRoute, roadFiguresPlausible, type RoutePoint } from "./routeEstimate";

/** The app's number this far under the server's quote was not measured, it was typed. */
export const LOWBALL_RATIO = 0.8;
/** The app's number this far over the server's quote came from a rate card that is not the live one. */
export const STALE_ABOVE_RATIO = 1.25;

export interface RouteFigures {
  miles: number;
  minutes: number;
  straightLineMiles: number;
}

/**
 * The road figures a booking is priced on: the app's when plausible for
 * these points, the server's own estimate otherwise.
 */
export function bookingRouteFigures(
  points: RoutePoint[],
  clientMiles: unknown,
  clientMinutes: unknown,
): RouteFigures & { source: "app" | "server" } {
  const estimate = estimateRoute(points);
  const miles = Number(clientMiles);
  const minutes = Number(clientMinutes);
  const inRange = Number.isFinite(miles) && miles > 0 && miles < 500 && Number.isFinite(minutes) && minutes > 0 && minutes < 1440;
  if (inRange && roadFiguresPlausible(miles, minutes, estimate.straightLineMiles)) {
    return { miles, minutes: Math.round(minutes), straightLineMiles: estimate.straightLineMiles, source: "app" };
  }
  return { ...estimate, source: "server" };
}

export type FareGap = "matches" | "lowball" | "below" | "above" | "stale_above" | "missing";

export interface FareJudgement {
  /** What the ride is booked at: always the server's quote. */
  fare: number;
  /** What the app said, for the record, or null when it sent nothing usable. */
  appFare: number | null;
  gap: FareGap;
  /** Whether ops should hear about the gap. */
  alert: boolean;
}

/**
 * Compare the app's number with the server's quote. The fare is the quote;
 * the comparison only decides what ops are told.
 */
export function judgeBookingFare(appFare: unknown, serverQuote: number): FareJudgement {
  const fare = Math.round(serverQuote * 100) / 100;
  const app = Number(appFare);
  if (!Number.isFinite(app) || app <= 0) return { fare, appFare: null, gap: "missing", alert: false };
  if (Math.abs(app - fare) <= 0.01) return { fare, appFare: app, gap: "matches", alert: false };
  if (app < fare * LOWBALL_RATIO) return { fare, appFare: app, gap: "lowball", alert: true };
  if (app < fare) return { fare, appFare: app, gap: "below", alert: false };
  if (app > fare * STALE_ABOVE_RATIO) return { fare, appFare: app, gap: "stale_above", alert: true };
  return { fare, appFare: app, gap: "above", alert: false };
}

/** One line for the ops alert when the app's number was far from the quote. */
export function describeFareGap(j: FareJudgement): string {
  if (j.gap === "lowball") return "Server quote applied — the app's number was far below it (tampered or broken app?)";
  if (j.gap === "stale_above") return "Server quote applied — the app's number was far above it (stale rate card on an old bundle?)";
  return "Server quote applied";
}

/**
 * A list of points the app claims a route passes through: every one needs
 * real coordinates and an address, or the route cannot be priced or driven.
 */
export function validateRoutePoints(raw: unknown, max: number): { ok: true; points: Array<RoutePoint & { address: string }> } | { ok: false; error: string } {
  const list = Array.isArray(raw) ? raw : [];
  if (list.length > max) return { ok: false, error: `You can add up to ${max} stops to a ride.` };
  const points: Array<RoutePoint & { address: string }> = [];
  for (const s of list) {
    const lat = Number((s as any)?.lat);
    const lng = Number((s as any)?.lng);
    const address = String((s as any)?.address ?? "").trim().slice(0, 200);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || !address) {
      return { ok: false, error: "Each stop needs a full address. Pick one from the suggestions." };
    }
    points.push({ lat, lng, address });
  }
  return { ok: true, points };
}
