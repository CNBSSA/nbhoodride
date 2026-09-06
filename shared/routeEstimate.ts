/**
 * Route estimate shared by the booking UI and the server: road miles and
 * minutes for pickup → (stops…) → destination. Straight-line legs scaled by a
 * road factor, at an average urban speed — the same arithmetic the single-leg
 * quote has always used, extended to any number of legs so a ride with stops
 * is quoted on the whole route.
 */

export interface RoutePoint {
  lat: number;
  lng: number;
}

export const ROAD_FACTOR = 1.3;
export const AVERAGE_MPH = 25;
/** Stops a rider may add between pickup and destination. */
export const MAX_RIDE_STOPS = 2;

export function haversineMiles(a: RoutePoint, b: RoutePoint): number {
  const R = 3959;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Road miles (1 decimal) and minutes over every leg of the route. */
export function estimateRoute(points: RoutePoint[]): { miles: number; minutes: number } {
  let straight = 0;
  for (let i = 1; i < points.length; i++) straight += haversineMiles(points[i - 1], points[i]);
  const miles = Math.round(straight * ROAD_FACTOR * 10) / 10;
  const minutes = Math.round((miles / AVERAGE_MPH) * 60);
  return { miles, minutes };
}
