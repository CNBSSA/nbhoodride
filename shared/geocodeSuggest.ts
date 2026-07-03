/**
 * Pure mappers that normalize geocoding-provider responses into the
 * { label, lat, lng } shape the address autocomplete returns. Kept in
 * shared/ so they're unit-testable without an HTTP harness (the route in
 * server/routes.ts calls these).
 */

export interface AddressSuggestion {
  label: string;
  lat: number;
  lng: number;
}

/** Nominatim /search results → suggestions. Drops rows with bad coords. */
export function mapNominatimResults(raw: unknown): AddressSuggestion[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((d: any) => ({
      label: String(d?.display_name ?? ""),
      lat: parseFloat(d?.lat),
      lng: parseFloat(d?.lon),
    }))
    .filter((s) => s.label.length > 0 && Number.isFinite(s.lat) && Number.isFinite(s.lng));
}

/** Mapbox geocoding features → suggestions. center is [lng, lat]. */
export function mapMapboxResults(raw: unknown): AddressSuggestion[] {
  const features = (raw as any)?.features;
  if (!Array.isArray(features)) return [];
  return features
    .map((f: any) => ({
      label: String(f?.place_name ?? ""),
      lat: Array.isArray(f?.center) ? Number(f.center[1]) : NaN,
      lng: Array.isArray(f?.center) ? Number(f.center[0]) : NaN,
    }))
    .filter((s) => s.label.length > 0 && Number.isFinite(s.lat) && Number.isFinite(s.lng));
}
