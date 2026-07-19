/**
 * Service-area policy (regulatory):
 *
 *   PICKUPS  — Maryland ONLY. No DC, no Virginia pickups: PG Ride is not
 *              authorized to originate trips in those jurisdictions.
 *   DROP-OFFS — Maryland, Washington DC, and (northern) Virginia are all
 *              allowed. Riders commute across these lines constantly; only
 *              the trip ORIGIN is regulated.
 *
 * The pickup test is pure offline geometry — a simplified Maryland boundary
 * polygon walked point-in-polygon. It deliberately does NOT depend on any
 * geocoding provider: a regulatory gate can't fail open (or closed) because
 * a free reverse-geocoder is throttling us.
 *
 * Precision notes:
 * - The DC boundary uses the District's actual surveyed corner stones, so
 *   the diamond cut-out is exact where it matters most (the MD/DC seam runs
 *   through dense neighborhoods — Silver Spring, Takoma, Capitol Heights).
 * - The Potomac stretch (the MD/VA line) traces mid-river waypoints chosen
 *   so that National Harbor, Oxon Hill, and Fort Washington (MD, east bank)
 *   test inside while Arlington, Alexandria, and Mount Vernon (VA, west
 *   bank) test outside.
 * - The far-western panhandle and Eastern Shore edges are coarser — a few
 *   hundred meters of slack against PA/WV/DE farmland, where nothing is at
 *   stake regulatorily per the founder's directive (DC and VA are the
 *   regulated geographies).
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Simplified Maryland boundary, walked clockwise from the northwest corner.
 * The DC diamond is excluded by routing the boundary around its NW→N→E→S
 * corners (Maryland wraps the District's north-east side).
 */
export const MARYLAND_BOUNDARY: LatLng[] = [
  // ── Mason-Dixon line (PA border), west → east ──
  { lat: 39.7229, lng: -79.4767 },
  { lat: 39.7229, lng: -75.7887 },
  // ── Delaware west line straight south, then the Transpeninsular line east ──
  { lat: 38.4513, lng: -75.7887 },
  { lat: 38.4513, lng: -75.0490 },
  // ── Atlantic coast (Ocean City sits on the barrier island ≈ -75.084) ──
  { lat: 38.3200, lng: -75.0800 },
  { lat: 38.0270, lng: -75.2400 },
  // ── MD/VA Eastern Shore line, east → west to the Chesapeake ──
  { lat: 37.9700, lng: -75.6500 },
  { lat: 38.0280, lng: -76.0500 },
  // ── Across the bay mouth toward the Potomac mouth ──
  { lat: 37.9500, lng: -76.3000 },
  // ── Up the Potomac (MD/VA line): waypoints biased slightly toward the
  //    Maryland shore in rural reaches (fail-closed for the regulatory
  //    gate), precisely mid-river in the populated DC-metro corridor.
  //    Anchors: Piney Pt/St. George Is. MD in, Coles Pt VA out ──
  { lat: 38.1300, lng: -76.5600 },
  //    St. Clements Is. MD in ──
  { lat: 38.1700, lng: -76.7800 },
  //    Cobb Is. MD in, Colonial Beach VA out ──
  { lat: 38.2600, lng: -76.9300 },
  //    Newburg MD in, Dahlgren VA out (301 bridge) ──
  { lat: 38.3400, lng: -77.0000 },
  { lat: 38.3800, lng: -77.2300 },
  //    Widewater reach ──
  { lat: 38.4400, lng: -77.2800 },
  //    Quantico VA out ──
  { lat: 38.5200, lng: -77.2700 },
  //    Indian Head MD in ──
  { lat: 38.6000, lng: -77.1800 },
  //    Mason Neck VA (east tip -77.168) out; Mattawoman MD shore in ──
  { lat: 38.6600, lng: -77.1400 },
  //    Fort Washington MD in, Mount Vernon VA out ──
  { lat: 38.7000, lng: -77.0550 },
  //    National Harbor MD in, Alexandria VA out ──
  { lat: 38.7350, lng: -77.0450 },
  // ── Washington DC diamond: wrap the District's MD-facing edges using the
  //    surveyed corner stones. South (Jones Point) → East → North → then the
  //    NW edge back to the Potomac at Dalecarlia/Little Falls. ──
  { lat: 38.7904, lng: -77.0390 },
  { lat: 38.8930, lng: -76.9094 },
  { lat: 38.9959, lng: -77.0410 },
  { lat: 38.9360, lng: -77.1190 },
  // ── Potomac above DC (McLean/Great Falls VA out) ──
  { lat: 38.9600, lng: -77.1500 },
  { lat: 38.9900, lng: -77.2500 },
  { lat: 39.0700, lng: -77.3300 },
  { lat: 39.0700, lng: -77.4600 },
  { lat: 39.1500, lng: -77.5200 },
  { lat: 39.2700, lng: -77.5400 },
  // ── Harpers Ferry tri-state, then the WV Potomac line ──
  { lat: 39.3200, lng: -77.7300 },
  { lat: 39.4300, lng: -77.8000 },
  { lat: 39.6000, lng: -77.8200 },
  { lat: 39.6100, lng: -78.0000 },
  { lat: 39.7000, lng: -78.1800 },
  { lat: 39.5500, lng: -78.4000 },
  { lat: 39.6200, lng: -78.7700 },
  { lat: 39.4800, lng: -79.0600 },
  // ── SW corner (Fairfax Stone) and back up the west line ──
  { lat: 39.1958, lng: -79.4870 },
];

/** Standard ray-casting point-in-polygon. */
export function pointInPolygon(point: LatLng, polygon: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const yi = polygon[i].lat, xi = polygon[i].lng;
    const yj = polygon[j].lat, xj = polygon[j].lng;
    const intersects =
      (yi > point.lat) !== (yj > point.lat) &&
      point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Trip ORIGIN rule: Maryland only. */
export function isAllowedPickup(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  // Cheap outer-box reject before the polygon walk.
  if (lat < 37.88 || lat > 39.73 || lng < -79.49 || lng > -74.98) return false;
  return pointInPolygon({ lat, lng }, MARYLAND_BOUNDARY);
}

/** Trip DESTINATION rule: Maryland, DC, and northern Virginia. */
export function isAllowedDestination(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  // Generous DMV box: all of Maryland, the District, and Virginia within
  // realistic trip range (the 50-mile ride cap bounds it in practice).
  return lat >= 37.9 && lat <= 39.75 && lng >= -79.5 && lng <= -74.98;
}

export const PICKUP_OUTSIDE_MD_MESSAGE =
  "Pickups are currently available in Maryland only — we can drop you off in DC or Virginia, but trips must start in Maryland.";

export const DESTINATION_OUTSIDE_AREA_MESSAGE =
  "That destination is outside our service area (Maryland, Washington DC, and northern Virginia).";
