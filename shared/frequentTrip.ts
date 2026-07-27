/**
 * "Quick Rebook" — detects a rider's repeated destination from recent
 * completed rides so Home can offer a one-tap "book again" instead of
 * making a returning rider retype the same address every time.
 */

export interface CompletedRideForTrip {
  destinationLocation: { lat: number; lng: number; address: string } | null;
  completedAt: Date | string | null;
}

export interface FrequentTrip {
  destinationLocation: { lat: number; lng: number; address: string };
  rideCount: number;
  lastRideAt: string;
}

const MIN_RIDE_COUNT = 2;
const LOOKBACK_DAYS = 30;
// ~111m precision — treats geocodes of "the same place" as identical even
// when two lookups (or providers) disagree slightly on the exact rooftop
// coordinate, or the address string formatting differs between rides.
const COORD_PRECISION = 3;

function roundCoord(n: number): number {
  return Math.round(n * 10 ** COORD_PRECISION) / 10 ** COORD_PRECISION;
}

/**
 * Returns the rider's most frequent recent destination if it appears at
 * least MIN_RIDE_COUNT times within the last LOOKBACK_DAYS, else null.
 * `now` is injectable for deterministic tests.
 */
export function findFrequentDestination(
  rides: CompletedRideForTrip[],
  now: Date = new Date(),
): FrequentTrip | null {
  const cutoff = now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

  const groups = new Map<
    string,
    { destinationLocation: FrequentTrip["destinationLocation"]; count: number; lastRideAt: Date }
  >();

  for (const ride of rides) {
    if (!ride.destinationLocation || !ride.completedAt) continue;
    const completedAt = new Date(ride.completedAt);
    if (completedAt.getTime() < cutoff) continue;

    const key = `${roundCoord(ride.destinationLocation.lat)},${roundCoord(ride.destinationLocation.lng)}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      if (completedAt > existing.lastRideAt) {
        existing.lastRideAt = completedAt;
        existing.destinationLocation = ride.destinationLocation;
      }
    } else {
      groups.set(key, {
        destinationLocation: ride.destinationLocation,
        count: 1,
        lastRideAt: completedAt,
      });
    }
  }

  let best: { destinationLocation: FrequentTrip["destinationLocation"]; count: number; lastRideAt: Date } | null = null;
  for (const group of Array.from(groups.values())) {
    if (group.count < MIN_RIDE_COUNT) continue;
    if (!best || group.count > best.count || (group.count === best.count && group.lastRideAt > best.lastRideAt)) {
      best = group;
    }
  }

  if (!best) return null;
  return {
    destinationLocation: best.destinationLocation,
    rideCount: best.count,
    lastRideAt: best.lastRideAt.toISOString(),
  };
}
