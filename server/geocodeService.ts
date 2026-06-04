/**
 * Geocoding service — server-side proxy with provider abstraction and caching.
 *
 * Why this exists:
 *   - The booking modals previously fetched nominatim.openstreetmap.org
 *     directly from the browser. Browsers silently strip the User-Agent
 *     header (it's on the forbidden header list), which violates Nominatim's
 *     usage policy and led to the shared app IP getting throttled / blocked.
 *     Symptom: "Address Not Found" toast on real, valid addresses.
 *   - limit=1 also discarded valid candidates in positions 2-5, so common
 *     queries like "Walmart Hyattsville" failed even when matches existed.
 *
 * What this does:
 *   - Server-side fetch with a real User-Agent identifier.
 *   - In-memory LRU cache (10k entries, 24h TTL). A second rider typing the
 *     same address hits cache, not the upstream API.
 *   - Provider abstraction: prefers Mapbox (much better US matching,
 *     especially for POIs / business names) when MAPBOX_TOKEN is set;
 *     falls back to Nominatim with proper UA otherwise.
 *   - Returns top 5 candidates so the client can show a dropdown.
 */

type Coords = { lat: number; lng: number };
export type GeocodeCandidate = {
  /** Human-readable address as returned by the provider. */
  label: string;
  lat: number;
  lng: number;
  /** "mapbox" | "nominatim" — primarily for logging / debugging. */
  source: string;
};

type CacheEntry = { value: GeocodeCandidate[]; expiresAt: number };

const CACHE_MAX = 10_000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

function cacheGet(key: string): GeocodeCandidate[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  // Touch for LRU ordering.
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}

function cacheSet(key: string, value: GeocodeCandidate[]): void {
  if (cache.size >= CACHE_MAX) {
    // Evict the oldest entry — Map preserves insertion order.
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

const USER_AGENT = "PGRide-Community-Rideshare/1.0 (contact: support@pgride.app)";

async function fetchMapbox(query: string, limit: number): Promise<GeocodeCandidate[]> {
  const token = process.env.MAPBOX_TOKEN;
  if (!token) return [];
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
    `?access_token=${encodeURIComponent(token)}` +
    `&country=us&autocomplete=true&limit=${limit}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    console.warn(`[geocode] mapbox HTTP ${res.status} for query "${query}"`);
    return [];
  }
  const body: any = await res.json();
  const features = Array.isArray(body?.features) ? body.features : [];
  return features
    .filter((f: any) => Array.isArray(f?.center) && f.center.length === 2)
    .map((f: any) => ({
      label: String(f.place_name ?? query),
      lng: Number(f.center[0]),
      lat: Number(f.center[1]),
      source: "mapbox",
    }))
    .filter((c: GeocodeCandidate) => Number.isFinite(c.lat) && Number.isFinite(c.lng));
}

async function fetchNominatim(query: string, limit: number): Promise<GeocodeCandidate[]> {
  const url =
    `https://nominatim.openstreetmap.org/search` +
    `?format=json&q=${encodeURIComponent(query)}&limit=${limit}&countrycodes=us&addressdetails=1`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    console.warn(`[geocode] nominatim HTTP ${res.status} for query "${query}"`);
    return [];
  }
  const body: any = await res.json();
  if (!Array.isArray(body)) return [];
  return body
    .map((r: any) => ({
      label: String(r.display_name ?? query),
      lat: Number(r.lat),
      lng: Number(r.lon),
      source: "nominatim",
    }))
    .filter((c: GeocodeCandidate) => Number.isFinite(c.lat) && Number.isFinite(c.lng));
}

/**
 * Return up to `limit` geocoding candidates for a free-text query.
 * Always tries Mapbox first when configured; falls back to Nominatim
 * either when Mapbox isn't configured or when it returns zero results.
 */
export async function geocodeSuggest(query: string, limit = 5): Promise<GeocodeCandidate[]> {
  const trimmed = query.trim();
  if (trimmed.length < 3) return [];
  const cacheKey = `${limit}::${trimmed.toLowerCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  let results: GeocodeCandidate[] = [];
  if (process.env.MAPBOX_TOKEN) {
    try {
      results = await fetchMapbox(trimmed, limit);
    } catch (err) {
      console.warn(`[geocode] mapbox threw for "${trimmed}":`, err);
    }
  }
  if (results.length === 0) {
    try {
      results = await fetchNominatim(trimmed, limit);
    } catch (err) {
      console.warn(`[geocode] nominatim threw for "${trimmed}":`, err);
    }
  }

  // Only cache non-empty results. Empty results are usually transient
  // (rate-limit or network); caching them would extend the "address not
  // found" misery across the TTL window.
  if (results.length > 0) cacheSet(cacheKey, results);
  return results;
}

/** Convenience wrapper for callers that only want the single best match. */
export async function geocodeForward(query: string): Promise<GeocodeCandidate | null> {
  const candidates = await geocodeSuggest(query, 1);
  return candidates[0] ?? null;
}
