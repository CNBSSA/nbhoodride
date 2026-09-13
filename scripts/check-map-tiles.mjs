// No third-party tile or geocoding service may be called straight from a
// rider's browser. OpenStreetMap's volunteer servers blocked us on
// 2026-09-12 for exactly that, and every map in the app broke at once:
// booking, live ride, emergency tracking and the requester portal.
// Tiles go through /api/map/tiles; geocoding goes through /api/geocode/*.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const BANNED = [
  [/tile\.openstreetmap\.org/, "OpenStreetMap volunteer tile servers (they blocked us once already)"],
  [/nominatim\.openstreetmap\.org/, "OpenStreetMap's Nominatim geocoder — use /api/geocode/*"],
  [/\btile\.osm\.org/, "OpenStreetMap tile servers"],
];

const offences = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { walk(full); continue; }
    if (!/\.(ts|tsx|js|jsx)$/.test(name)) continue;
    const text = readFileSync(full, "utf8");
    text.split("\n").forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // comments may name it
      for (const [re, why] of BANNED) {
        if (re.test(line)) offences.push(`${full}:${i + 1} — ${why}`);
      }
    });
  }
};
walk("client/src");

if (offences.length) {
  console.error("[map-tiles] a rider's browser must not call these directly:\n  " + offences.join("\n  "));
  process.exit(1);
}
console.log("[map-tiles] OK — no third-party tile or geocoding calls from the browser");
