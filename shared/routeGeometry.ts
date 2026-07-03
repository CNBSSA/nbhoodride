/**
 * Pure mapper that normalizes a routing-provider response (Mapbox Directions
 * or OSRM — both return GeoJSON `driving` routes with the same shape) into
 * the format the in-app driver map consumes: a list of [lat, lng] points
 * plus distance/duration. Kept in shared/ so it's unit-testable without an
 * HTTP harness (the route in server/routes.ts calls this).
 *
 * GeoJSON coordinates are [lng, lat]; Leaflet wants [lat, lng], so we flip.
 */

export interface RouteResult {
  /** Ordered [lat, lng] points along the driving route. */
  coordinates: Array<[number, number]>;
  distanceMeters: number;
  durationSeconds: number;
}

export function mapRouteResponse(raw: unknown): RouteResult | null {
  const route = (raw as any)?.routes?.[0];
  const coords = route?.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;

  const coordinates: Array<[number, number]> = [];
  for (const c of coords) {
    if (!Array.isArray(c) || c.length < 2) continue;
    const lng = Number(c[0]);
    const lat = Number(c[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) coordinates.push([lat, lng]);
  }
  if (coordinates.length < 2) return null;

  return {
    coordinates,
    distanceMeters: Number.isFinite(route?.distance) ? Number(route.distance) : 0,
    durationSeconds: Number.isFinite(route?.duration) ? Number(route.duration) : 0,
  };
}

/** Meters → miles, rounded to 1 decimal. */
export function metersToMiles(m: number): number {
  return Math.round((m / 1609.344) * 10) / 10;
}

/** Seconds → minutes, at least 1. */
export function secondsToMinutes(s: number): number {
  return Math.max(1, Math.round(s / 60));
}
