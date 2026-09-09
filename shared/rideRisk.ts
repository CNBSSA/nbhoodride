/**
 * Ride-risk paging — the operator hears about a ride in trouble before the
 * rider does.
 *
 * The scheduled-ride sweep already warns the rider ("no driver yet") and
 * re-broadcasts to the driver board at T-2h, T-1h and T-15m. Until now none
 * of that reached the operator's phone, so the rider was told a ride was at
 * risk before the person who could fix it. The rule:
 *
 *   - A scheduled ride still unclaimed at T-2h pages ops, and again at
 *     T-15m if it is still unclaimed.
 *   - At T-10m a ride with a driver is checked once: if the driver has no
 *     known position, a stale one, or is farther than DRIVER_FAR_MILES from
 *     the pickup, ops is paged with how far away they are.
 *
 * Each stage is stamped in reminder_stamps (o120 / o15 / o10) so it fires
 * exactly once per ride, and the Rider Promise Review counts the stamps
 * as "paged before departure".
 *
 * Pure rules and formatting live here; the query, the Telegram send and the
 * stamps live in server/rideRiskWatch.ts.
 */

export const UNCLAIMED_PAGE_STAGES = [
  { stamp: "o120", withinMinutes: 122, label: "2 hours" },
  { stamp: "o15", withinMinutes: 17, label: "15 minutes" },
] as const;

export const DRIVER_CHECK_STAMP = "o10";
export const DRIVER_CHECK_WITHIN_MINUTES = 12;
/** A driver farther than this from the pickup at T-10 is not going to make it on time. */
export const DRIVER_FAR_MILES = 4;
/** A position older than this says nothing about where the driver is now. */
export const DRIVER_LOCATION_STALE_MINUTES = 20;

/** Every stamp the watch can write; the review counts rides carrying any of them. */
export const RISK_STAMPS = ["o120", "o15", "o10"] as const;
export type RiskStamp = (typeof RISK_STAMPS)[number];

type Stamps = Record<string, unknown> | null | undefined;
const has = (stamps: Stamps, key: string) => !!(stamps ?? {})[key];

/**
 * Which unclaimed-ride page is due, if any. The most urgent due stage wins;
 * firing it also covers the milder ones (a ride booked 30 minutes ahead gets
 * one page at T-15, not two). Returns the stamps to write.
 */
export function unclaimedPageDue(minutesToDeparture: number, stamps: Stamps): { stage: "o120" | "o15"; label: string; stampAll: string[] } | null {
  if (minutesToDeparture < 0) return null;
  if (minutesToDeparture <= 17 && !has(stamps, "o15")) return { stage: "o15", label: "15 minutes", stampAll: ["o15", "o120"] };
  if (minutesToDeparture <= 122 && !has(stamps, "o120")) return { stage: "o120", label: "2 hours", stampAll: ["o120"] };
  return null;
}

export function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export type DriverRiskReason = "no_location" | "stale_location" | "far";

export interface DriverCheckInput {
  minutesToDeparture: number;
  stamps: Stamps;
  pickup: { lat: number; lng: number } | null | undefined;
  driverLocation: { lat: number; lng: number } | null | undefined;
  /** When the driver's position was last written. */
  driverLocationAt: Date | string | null | undefined;
}

export interface DriverCheckResult {
  /** True when the check ran (and its stamp should be written), whether or not it paged. */
  checked: boolean;
  reason: DriverRiskReason | null;
  milesAway: number | null;
  minutesSinceLocation: number | null;
}

/**
 * The one-time T-10 check on a ride that has a driver. `checked` is false
 * outside the window or when already stamped; `reason` is null when the
 * driver looks fine.
 */
export function driverPickupCheck(input: DriverCheckInput, now: Date = new Date()): DriverCheckResult {
  const none: DriverCheckResult = { checked: false, reason: null, milesAway: null, minutesSinceLocation: null };
  if (input.minutesToDeparture < 0 || input.minutesToDeparture > DRIVER_CHECK_WITHIN_MINUTES) return none;
  if (has(input.stamps, DRIVER_CHECK_STAMP)) return none;

  const loc = input.driverLocation;
  if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) {
    return { checked: true, reason: "no_location", milesAway: null, minutesSinceLocation: null };
  }
  const at = input.driverLocationAt ? new Date(input.driverLocationAt).getTime() : NaN;
  const minutesSince = Number.isFinite(at) ? Math.max(0, (now.getTime() - at) / 60_000) : null;
  if (minutesSince === null || minutesSince > DRIVER_LOCATION_STALE_MINUTES) {
    return { checked: true, reason: "stale_location", milesAway: null, minutesSinceLocation: minutesSince === null ? null : Math.round(minutesSince) };
  }
  if (!input.pickup) return { checked: true, reason: null, milesAway: null, minutesSinceLocation: Math.round(minutesSince) };
  const miles = haversineMiles(loc.lat, loc.lng, input.pickup.lat, input.pickup.lng);
  return {
    checked: true,
    reason: miles > DRIVER_FAR_MILES ? "far" : null,
    milesAway: Math.round(miles * 10) / 10,
    minutesSinceLocation: Math.round(minutesSince),
  };
}

/** One line for the page, e.g. "3.2 miles from the pickup, 10 minutes out". */
export function describeDriverRisk(r: DriverCheckResult, minutesToDeparture: number): string {
  const mins = `${Math.max(0, Math.round(minutesToDeparture))} min to departure`;
  switch (r.reason) {
    case "no_location": return `Driver has never shared a position · ${mins}`;
    case "stale_location": return `Driver's last position is ${r.minutesSinceLocation ?? "?"} min old · ${mins}`;
    case "far": return `Driver is ${r.milesAway} miles from the pickup · ${mins}`;
    default: return mins;
  }
}
