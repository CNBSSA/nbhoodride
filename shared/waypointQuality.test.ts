import { describe, expect, it } from "vitest";
import { scoreWaypointQuality } from "./waypointQuality";

describe("waypointQuality", () => {
  it("scores first sample at full quality", () => {
    const result = scoreWaypointQuality(null, { lat: 38.9, lng: -76.8, timestamp: 1000 });
    expect(result.qualityScore).toBe(1);
    expect(result.speedAnomaly).toBe(false);
    expect(result.eventType).toBe("waypoint_sample");
  });

  it("flags impossible speed as anomaly", () => {
    const prev = { lat: 38.9, lng: -76.8, timestamp: 1000 };
    const curr = { lat: 39.5, lng: -76.2, timestamp: 2000 };
    const result = scoreWaypointQuality(prev, curr);
    expect(result.speedAnomaly).toBe(true);
    expect(result.eventType).toBe("speed_anomaly");
    expect(result.qualityScore).toBeLessThan(0.2);
  });

  it("accepts normal driving speed", () => {
    const prev = { lat: 38.9, lng: -76.8, timestamp: 0 };
    const curr = { lat: 38.901, lng: -76.799, timestamp: 5000 };
    const result = scoreWaypointQuality(prev, curr);
    expect(result.speedAnomaly).toBe(false);
    expect(result.qualityScore).toBeGreaterThan(0.5);
  });
});
