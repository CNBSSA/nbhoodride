/**
 * Cross-platform geographic helpers shared by client and server.
 *
 * All of these were previously copy-pasted across 6 client booking flows
 * (RideBookingModal, ScheduleRideModal, SharedScheduleSheet,
 * JoinScheduleModal, MultiStopBookingSheet, RiderDashboard) and 2-3 server
 * paths — with subtly different constants (3958.8 vs 3959 for Earth's
 * radius in miles, sometimes a 1.3 detour factor applied at the wrong
 * level). Consolidating here so the client preview and server billing
 * see the same numbers.
 */

/**
 * Great-circle distance between two (lat, lng) points in MILES.
 * Earth radius rounded to 3959 mi — same constant used by the server's
 * rideWorkflowService.haversineMiles to keep client preview consistent.
 */
export function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Multiplier applied to straight-line distance to approximate road distance.
 * 1.3 = 30% extra to account for non-straight routing. Documented here so
 * changes propagate to every caller (previously inlined as `* 1.3` in six
 * places with at least one site applying it twice).
 */
export const ROAD_DISTANCE_FACTOR = 1.3;

/** Default cruising speed assumption in MPH for ETA estimates. */
export const AVERAGE_SPEED_MPH = 25;

/**
 * Estimate distance + duration for a single-leg ride. Returns the canonical
 * distance in miles (rounded to 0.1) and an integer ETA in minutes.
 * Distance is straight-line × ROAD_DISTANCE_FACTOR; duration is distance ÷
 * AVERAGE_SPEED_MPH × 60.
 */
export function estimateRouteMetrics(
  pickup: { lat: number; lng: number },
  destination: { lat: number; lng: number },
): { distanceMiles: number; durationMinutes: number } {
  const straightLine = haversineMiles(pickup.lat, pickup.lng, destination.lat, destination.lng);
  const distanceMiles = Math.round(straightLine * ROAD_DISTANCE_FACTOR * 10) / 10;
  const durationMinutes = Math.round((distanceMiles / AVERAGE_SPEED_MPH) * 60);
  return { distanceMiles, durationMinutes };
}

/**
 * Sum the haversine distances along an ordered list of waypoints (no road
 * factor applied — callers that need road miles multiply by
 * ROAD_DISTANCE_FACTOR or call estimateRouteForWaypoints).
 */
export function totalWaypointMiles(points: Array<{ lat: number; lng: number }>): number {
  if (points.length < 2) return 0;
  let dist = 0;
  for (let i = 0; i < points.length - 1; i++) {
    dist += haversineMiles(points[i].lat, points[i].lng, points[i + 1].lat, points[i + 1].lng);
  }
  return dist;
}

/**
 * Multi-stop variant of estimateRouteMetrics. Same constants applied, so
 * the multi-stop booking modal's fare preview matches single-stop math.
 */
export function estimateRouteForWaypoints(
  points: Array<{ lat: number; lng: number }>,
): { distanceMiles: number; durationMinutes: number } {
  const roadMiles = totalWaypointMiles(points) * ROAD_DISTANCE_FACTOR;
  const distanceMiles = Math.round(roadMiles * 10) / 10;
  const durationMinutes = Math.round((distanceMiles / AVERAGE_SPEED_MPH) * 60);
  return { distanceMiles, durationMinutes };
}
