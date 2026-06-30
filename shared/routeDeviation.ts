/** D7 — Route deviation helpers (miles). */

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function haversineMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 3959;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Perpendicular distance from point to great-circle segment (approximation). */
export function deviationMilesFromSegment(
  point: { lat: number; lng: number },
  start: { lat: number; lng: number },
  end: { lat: number; lng: number },
): number {
  const total = haversineMiles(start.lat, start.lng, end.lat, end.lng);
  if (total < 0.05) {
    return haversineMiles(point.lat, point.lng, start.lat, start.lng);
  }
  const toStart = haversineMiles(point.lat, point.lng, start.lat, start.lng);
  const toEnd = haversineMiles(point.lat, point.lng, end.lat, end.lng);
  return Math.min(toStart, toEnd, (toStart + toEnd - total) / 2);
}

export function isRouteDeviation(
  deviationMiles: number,
  thresholdMiles = 0.75,
): boolean {
  return deviationMiles > thresholdMiles;
}
