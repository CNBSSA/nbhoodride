/**
 * The one place the base map is configured.
 *
 * It used to be four places, all hardcoded to OpenStreetMap's volunteer
 * tile servers. Their usage policy does not allow a production app to draw
 * from them, and on 2026-09-12 they blocked us: every tile returned 403 and
 * the rider's map became a wall of "Access blocked" images. Four copies
 * meant four things to fix and nothing to stop it happening again.
 *
 * Tiles now come from our own server (server/mapTiles.ts), which fetches
 * them with the Mapbox token the geocoder already uses. When the server
 * says tiles are unavailable we draw nothing rather than falling back to a
 * service that has told us to stop.
 */
import L from "leaflet";

export interface MapTileConfig {
  available: boolean;
  tileUrl: string | null;
  attribution: string;
  maxZoom: number;
}

const FALLBACK: MapTileConfig = {
  available: false, tileUrl: null, attribution: "© Mapbox © OpenStreetMap", maxZoom: 19,
};

let cached: Promise<MapTileConfig> | null = null;

export function getMapTileConfig(): Promise<MapTileConfig> {
  if (!cached) {
    cached = fetch("/api/map/config", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : FALLBACK))
      .then((c: MapTileConfig) => (c && typeof c.tileUrl !== "undefined" ? c : FALLBACK))
      .catch(() => FALLBACK);
  }
  return cached;
}

/** Exposed for tests. */
export function _resetMapTileConfig(): void { cached = null; }

/**
 * Add the base layer to a Leaflet map. Resolves true when tiles were added.
 * Never throws: a map without a basemap still shows markers and the route,
 * which is more useful to a rider than a blank screen or a crash.
 */
export async function addBaseLayer(map: L.Map): Promise<boolean> {
  try {
    const cfg = await getMapTileConfig();
    if (!cfg.available || !cfg.tileUrl) return false;
    L.tileLayer(cfg.tileUrl, { attribution: cfg.attribution, maxZoom: cfg.maxZoom }).addTo(map);
    return true;
  } catch {
    return false;
  }
}

/** Same, for the pages that use the Leaflet global rather than the import. */
export async function addBaseLayerTo(LGlobal: any, map: any): Promise<boolean> {
  try {
    const cfg = await getMapTileConfig();
    if (!cfg.available || !cfg.tileUrl) return false;
    LGlobal.tileLayer(cfg.tileUrl, { attribution: cfg.attribution, maxZoom: cfg.maxZoom }).addTo(map);
    return true;
  } catch {
    return false;
  }
}
