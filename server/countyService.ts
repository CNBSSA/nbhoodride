import { MD_COUNTIES, type MdCounty } from "../shared/schema";

// Nominatim county name → our canonical county name
// Nominatim sometimes returns slightly different forms
const COUNTY_ALIASES: Record<string, MdCounty> = {
  "Prince George's County":    "Prince George's County",
  "Prince Georges County":     "Prince George's County",
  "Anne Arundel County":       "Anne Arundel County",
  "Baltimore County":          "Baltimore County",
  "Baltimore City":            "Baltimore City",
  "Baltimore":                 "Baltimore City",
  "Montgomery County":         "Montgomery County",
  "Howard County":             "Howard County",
  "Frederick County":          "Frederick County",
  "Harford County":            "Harford County",
  "Carroll County":            "Carroll County",
  "Charles County":            "Charles County",
  "St. Mary's County":         "St. Mary's County",
  "Saint Mary's County":       "St. Mary's County",
  "Calvert County":            "Calvert County",
  "Cecil County":              "Cecil County",
  "Washington County":         "Washington County",
  "Allegany County":           "Allegany County",
  "Garrett County":            "Garrett County",
  "Wicomico County":           "Wicomico County",
  "Worcester County":          "Worcester County",
  "Somerset County":           "Somerset County",
  "Dorchester County":         "Dorchester County",
  "Talbot County":             "Talbot County",
  "Queen Anne's County":       "Queen Anne's County",
  "Queen Annes County":        "Queen Anne's County",
  "Caroline County":           "Caroline County",
  "Kent County":               "Kent County",
};

// Simple in-process cache: "lat,lng" → county name. Avoids repeated Nominatim calls.
const cache = new Map<string, string>();

/**
 * Reverse-geocode a coordinate pair to a Maryland county name.
 * Returns null if outside Maryland or lookup fails.
 */
export async function getCountyFromCoords(lat: number, lng: number): Promise<MdCounty | null> {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (cache.has(key)) {
    return (cache.get(key) as MdCounty) || null;
  }

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`;
    const resp = await fetch(url, {
      headers: { "User-Agent": "PGRide/1.0 (thrynovainsights@gmail.com)" },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return null;

    const data = await resp.json() as { address?: Record<string, string> };
    const addr = data.address || {};

    // Try county first, then city (Baltimore City comes back as city)
    const raw = addr.county || addr.city || "";
    const normalized = COUNTY_ALIASES[raw] ?? null;

    cache.set(key, normalized ?? "");
    return normalized;
  } catch {
    return null;
  }
}

/**
 * Check whether a driver should receive a ride notification.
 * An empty acceptedCounties array means the driver accepts all Maryland counties.
 */
export function driverCoversCounty(acceptedCounties: string[], pickupCounty: string | null): boolean {
  if (!pickupCounty) return true; // county unknown — notify all drivers
  if (acceptedCounties.length === 0) return true; // driver accepts all counties
  return acceptedCounties.includes(pickupCounty);
}

export { MD_COUNTIES };
