/**
 * Map tiles, served through us.
 *
 * The app used to point Leaflet straight at {s}.tile.openstreetmap.org.
 * Those are OpenStreetMap's volunteer-run servers, and their tile usage
 * policy does not permit a production app to draw from them. On
 * 2026-09-12 they blocked us: every tile came back 403 "Access blocked"
 * and the rider's map turned into a wall of error images — on the booking
 * screen, the live-ride screen, the emergency tracking page and the
 * requester portal at once.
 *
 * Tiles now come from Mapbox through this endpoint, using the same
 * MAPBOX_TOKEN the geocoder already uses, so no new secret is needed and
 * the token never reaches the browser. Responses are cached hard: tiles
 * for a fixed z/x/y never change, so the browser and any CDN in front of
 * us should keep them.
 *
 * With no token configured the endpoint answers 503 and says why, and the
 * client draws an honest "map unavailable" background instead of hammering
 * a service that has already told us to stop.
 */

import type { Express, Request, Response } from "express";

/** Mapbox raster style used for the base map. */
const STYLE = "mapbox/streets-v12";

export const MAP_TILES_UNAVAILABLE =
  "Map tiles are not configured on this deployment. Set MAPBOX_TOKEN in Railway → Variables.";

export function mapTilesConfigured(): boolean {
  return !!process.env.MAPBOX_TOKEN;
}

const numeric = (v: string, max: number): number | null => {
  // Up to 7 digits: at zoom 19 a tile index reaches 524287, and an earlier
  // 3-digit cap here would have rejected every tile above zoom 3 — i.e.
  // every view a rider actually uses.
  if (!/^\d{1,7}$/.test(v)) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= max ? n : null;
};

export function registerMapTileRoutes(app: Express): void {
  /** What the client should draw with. Public: the map is on the front page. */
  app.get("/api/map/config", (_req: Request, res: Response) => {
    res.set("Cache-Control", "public, max-age=300");
    res.json({
      available: mapTilesConfigured(),
      tileUrl: mapTilesConfigured() ? "/api/map/tiles/{z}/{x}/{y}" : null,
      attribution: "© Mapbox © OpenStreetMap",
      maxZoom: 19,
      message: mapTilesConfigured() ? null : MAP_TILES_UNAVAILABLE,
    });
  });

  app.get("/api/map/tiles/:z/:x/:y", async (req: Request, res: Response) => {
    // Bounded, integer-only path segments: this endpoint must never be a way
    // to make the server fetch an arbitrary URL. Validated BEFORE the token
    // check, so a malformed request is refused the same way whether or not
    // this deployment happens to have tiles configured.
    const z = numeric(String(req.params.z), 22);
    const x = numeric(String(req.params.x), 2 ** 22);
    const y = numeric(String(req.params.y), 2 ** 22);
    if (z === null || x === null || y === null) {
      return res.status(400).json({ message: "Bad tile coordinates." });
    }

    const token = process.env.MAPBOX_TOKEN;
    if (!token) return res.status(503).json({ message: MAP_TILES_UNAVAILABLE });

    const scale = req.query["2x"] !== undefined ? "@2x" : "";
    const url = `https://api.mapbox.com/styles/v1/${STYLE}/tiles/256/${z}/${x}/${y}${scale}`
      + `?access_token=${encodeURIComponent(token)}`;

    try {
      const upstream = await fetch(url);
      if (!upstream.ok) {
        console.error(`[map] tile ${z}/${x}/${y} upstream ${upstream.status}`);
        return res.status(502).json({ message: "Map provider did not return a tile." });
      }
      const buf = Buffer.from(await upstream.arrayBuffer());
      // A tile at a fixed z/x/y is immutable; let it be cached hard.
      res.set("Content-Type", upstream.headers.get("content-type") ?? "image/png");
      res.set("Cache-Control", "public, max-age=604800, immutable");
      res.send(buf);
    } catch (err) {
      console.error(`[map] tile ${z}/${x}/${y} failed:`, err instanceof Error ? err.message : err);
      res.status(502).json({ message: "Map provider unreachable." });
    }
  });
}
