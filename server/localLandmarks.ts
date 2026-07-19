/**
 * Curated local landmarks for the address-suggest endpoint.
 *
 * Geocoders know official names ("The Mall at Prince George's") but not the
 * names locals actually type ("PG Mall", "PG Plaza", "UMD"). This is a small,
 * hand-maintained alias layer for the service area — matches here are
 * prepended to whatever the geocoding provider returns, so a colloquial name
 * always resolves even when the provider whiffs entirely.
 *
 * Coordinates are curated to street-level accuracy (the rider is choosing a
 * well-known destination, not a rooftop). Add entries freely; keep aliases
 * lowercase.
 */

export interface Landmark {
  label: string;
  aliases: string[];
  lat: number;
  lng: number;
}

export const LOCAL_LANDMARKS: Landmark[] = [
  // ── Malls & shopping ──────────────────────────────────────────────────
  { label: "The Mall at Prince George's (PG Mall), Hyattsville, MD", aliases: ["pg mall", "pg plaza", "prince georges plaza", "prince george's plaza", "mall at prince george"], lat: 38.968, lng: -76.9541 },
  { label: "Iverson Mall, Temple Hills, MD", aliases: ["iverson mall", "iverson"], lat: 38.8443, lng: -76.9541 },
  { label: "Bowie Town Center, Bowie, MD", aliases: ["bowie town center", "bowie mall"], lat: 38.9445, lng: -76.733 },
  { label: "Woodmore Towne Centre, Glenarden, MD", aliases: ["woodmore", "woodmore towne centre", "wegmans glenarden"], lat: 38.9218, lng: -76.8462 },
  { label: "Tanger Outlets National Harbor, MD", aliases: ["tanger", "tanger outlets"], lat: 38.7856, lng: -77.0091 },

  // ── Destinations & venues ─────────────────────────────────────────────
  { label: "National Harbor, MD", aliases: ["national harbor"], lat: 38.7825, lng: -77.0164 },
  { label: "MGM National Harbor, Oxon Hill, MD", aliases: ["mgm", "mgm national harbor", "mgm casino"], lat: 38.7963, lng: -77.0085 },
  { label: "Northwest Stadium (FedExField), Landover, MD", aliases: ["fedex field", "fedexfield", "northwest stadium", "commanders stadium"], lat: 38.9076, lng: -76.8645 },
  { label: "Six Flags America, Bowie, MD", aliases: ["six flags"], lat: 38.9024, lng: -76.7708 },
  { label: "University of Maryland, College Park, MD", aliases: ["umd", "university of maryland", "maryland university", "college park campus"], lat: 38.9869, lng: -76.9426 },
  { label: "Prince George's Community College, Largo, MD", aliases: ["pgcc", "prince georges community college"], lat: 38.889, lng: -76.8253 },

  // ── Hospitals ─────────────────────────────────────────────────────────
  { label: "UM Capital Region Medical Center, Largo, MD", aliases: ["capital region medical", "um capital region", "largo hospital"], lat: 38.8998, lng: -76.841 },
  { label: "Luminis Health Doctors Community Medical Center, Lanham, MD", aliases: ["doctors community hospital", "doctors hospital lanham"], lat: 38.9663, lng: -76.8523 },
  { label: "MedStar Southern Maryland Hospital Center, Clinton, MD", aliases: ["southern maryland hospital"], lat: 38.7552, lng: -76.904 },

  // ── Metro stations ────────────────────────────────────────────────────
  { label: "New Carrollton Metro Station, MD", aliases: ["new carrollton metro", "new carrollton station"], lat: 38.9481, lng: -76.8719 },
  { label: "Greenbelt Metro Station, MD", aliases: ["greenbelt metro", "greenbelt station"], lat: 39.0111, lng: -76.9111 },
  { label: "College Park–U of Md Metro Station, MD", aliases: ["college park metro"], lat: 38.9784, lng: -76.9281 },
  { label: "Hyattsville Crossing Metro Station, MD", aliases: ["hyattsville crossing", "pg plaza metro"], lat: 38.9652, lng: -76.956 },
  { label: "West Hyattsville Metro Station, MD", aliases: ["west hyattsville metro"], lat: 38.9546, lng: -76.9694 },
  { label: "Downtown Largo Metro Station, MD", aliases: ["largo metro", "downtown largo", "largo town center"], lat: 38.9008, lng: -76.8447 },
  { label: "Morgan Boulevard Metro Station, MD", aliases: ["morgan blvd metro", "morgan boulevard"], lat: 38.8929, lng: -76.8681 },
  { label: "Addison Road Metro Station, MD", aliases: ["addison road metro"], lat: 38.8867, lng: -76.8933 },
  { label: "Capitol Heights Metro Station, MD", aliases: ["capitol heights metro"], lat: 38.8891, lng: -76.913 },
  { label: "Cheverly Metro Station, MD", aliases: ["cheverly metro"], lat: 38.9165, lng: -76.9155 },
  { label: "Landover Metro Station, MD", aliases: ["landover metro"], lat: 38.9339, lng: -76.8917 },
  { label: "Suitland Metro Station, MD", aliases: ["suitland metro"], lat: 38.844, lng: -76.932 },
  { label: "Branch Avenue Metro Station, MD", aliases: ["branch ave metro", "branch avenue metro"], lat: 38.8267, lng: -76.9125 },
  { label: "Naylor Road Metro Station, MD", aliases: ["naylor road metro"], lat: 38.8514, lng: -76.9565 },
  { label: "Southern Avenue Metro Station, MD", aliases: ["southern ave metro", "southern avenue metro"], lat: 38.841, lng: -76.9752 },

  // ── Airports & rail hubs ──────────────────────────────────────────────
  { label: "BWI Airport (Baltimore/Washington International)", aliases: ["bwi", "bwi airport", "baltimore airport"], lat: 39.1774, lng: -76.6684 },
  { label: "Reagan National Airport (DCA), Arlington, VA", aliases: ["dca", "reagan airport", "reagan national", "national airport"], lat: 38.8512, lng: -77.0402 },
  { label: "Union Station, Washington, DC", aliases: ["union station"], lat: 38.8973, lng: -77.0063 },

  // ── Washington DC destinations (drop-off only — pickups are MD-only,
  //    enforced at booking, so listing these never enables a DC origin) ──
  { label: "The White House, Washington, DC", aliases: ["white house", "whitehouse", "1600 pennsylvania"], lat: 38.8977, lng: -77.0365 },
  { label: "U.S. Capitol, Washington, DC", aliases: ["us capitol", "capitol building", "capitol hill"], lat: 38.8899, lng: -77.0091 },
  { label: "National Mall / Smithsonian, Washington, DC", aliases: ["national mall", "smithsonian"], lat: 38.8893, lng: -77.0261 },
  { label: "Nationals Park, Washington, DC", aliases: ["nationals park", "nats park"], lat: 38.8730, lng: -77.0074 },
  { label: "Capital One Arena, Washington, DC", aliases: ["capital one arena", "verizon center"], lat: 38.8981, lng: -77.0209 },
  { label: "MedStar Washington Hospital Center, DC", aliases: ["washington hospital center", "medstar washington"], lat: 38.9296, lng: -77.0146 },
  { label: "Howard University, Washington, DC", aliases: ["howard university", "howard u"], lat: 38.9227, lng: -77.0194 },
  { label: "Georgetown, Washington, DC", aliases: ["georgetown"], lat: 38.9096, lng: -77.0654 },

  // ── Northern Virginia destinations (drop-off only) ────────────────────
  { label: "The Pentagon, Arlington, VA", aliases: ["pentagon"], lat: 38.8719, lng: -77.0563 },
  { label: "Pentagon City, Arlington, VA", aliases: ["pentagon city", "fashion centre"], lat: 38.8629, lng: -77.0596 },
  { label: "Crystal City / Amazon HQ2, Arlington, VA", aliases: ["crystal city", "amazon hq2", "national landing"], lat: 38.8567, lng: -77.0506 },
  { label: "Old Town Alexandria, VA", aliases: ["old town alexandria", "alexandria old town"], lat: 38.8048, lng: -77.0430 },
  { label: "Tysons Corner Center, Tysons, VA", aliases: ["tysons", "tysons corner"], lat: 38.9187, lng: -77.2311 },
];

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/**
 * Nearest curated landmark within maxMiles of a point, or null. Used as the
 * reverse-geocode fallback so the app can still say "Near The Mall at
 * Prince George's" when the geocoding provider is down.
 */
export function nearestLandmarkLabel(lat: number, lng: number, maxMiles: number): string | null {
  const R = 3958.8;
  let best: { label: string; d: number } | null = null;
  for (const lm of LOCAL_LANDMARKS) {
    const dLat = ((lm.lat - lat) * Math.PI) / 180;
    const dLng = ((lm.lng - lng) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos((lat * Math.PI) / 180) * Math.cos((lm.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    const d = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    if (d <= maxMiles && (!best || d < best.d)) best = { label: lm.label, d };
  }
  return best?.label ?? null;
}

/**
 * Match a query against the landmark aliases. A landmark matches when the
 * normalized query contains an alias or an alias contains the query (so
 * "pg ma" already surfaces PG Mall while typing). Results keep list order.
 */
export function matchLocalLandmarks(query: string, limit: number): Array<{ label: string; lat: number; lng: number }> {
  const q = normalize(query);
  if (q.length < 2) return [];
  const out: Array<{ label: string; lat: number; lng: number }> = [];
  for (const lm of LOCAL_LANDMARKS) {
    const hit = lm.aliases.some((a) => a.includes(q) || q.includes(a)) ||
      normalize(lm.label).includes(q);
    if (hit) {
      out.push({ label: lm.label, lat: lm.lat, lng: lm.lng });
      if (out.length >= limit) break;
    }
  }
  return out;
}
