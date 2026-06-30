/** F1 — L4 readiness waypoint quality scoring (research only; no robotaxi). */

export interface WaypointSample {
  lat: number;
  lng: number;
  timestamp: number;
}

export interface WaypointQualityResult {
  qualityScore: number;
  speedMph: number | null;
  speedAnomaly: boolean;
  eventType: "waypoint_sample" | "speed_anomaly";
  metadata: Record<string, unknown>;
}

const MAX_SPEED_MPH = 90;
const MIN_INTERVAL_MS = 500;
const EARTH_RADIUS_MILES = 3959;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function haversineMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_MILES * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Score a GPS waypoint against the previous sample for L4 research logging. */
export function scoreWaypointQuality(
  prev: WaypointSample | null,
  curr: WaypointSample,
): WaypointQualityResult {
  if (!prev) {
    return {
      qualityScore: 1,
      speedMph: null,
      speedAnomaly: false,
      eventType: "waypoint_sample",
      metadata: { firstSample: true },
    };
  }

  const dtMs = curr.timestamp - prev.timestamp;
  if (dtMs < MIN_INTERVAL_MS) {
    return {
      qualityScore: 0.5,
      speedMph: null,
      speedAnomaly: false,
      eventType: "waypoint_sample",
      metadata: { duplicateIntervalMs: dtMs },
    };
  }

  const distMiles = haversineMiles(prev.lat, prev.lng, curr.lat, curr.lng);
  const speedMph = distMiles / (dtMs / 3_600_000);
  const speedAnomaly = speedMph > MAX_SPEED_MPH;

  let qualityScore = 1;
  if (speedAnomaly) qualityScore = 0.1;
  else if (speedMph > 75) qualityScore = 0.6;
  else if (dtMs > 30_000) qualityScore = 0.7;

  return {
    qualityScore,
    speedMph: Math.round(speedMph * 100) / 100,
    speedAnomaly,
    eventType: speedAnomaly ? "speed_anomaly" : "waypoint_sample",
    metadata: { dtMs, distMiles: Math.round(distMiles * 1000) / 1000 },
  };
}

export type DisengagementReason = "manual" | "attention_lapse" | "gps_loss";

export function buildDisengagementMetadata(reason: DisengagementReason, note?: string) {
  return { reason, note: note ?? null, loggedAt: new Date().toISOString() };
}
