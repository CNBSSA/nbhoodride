import { describe, expect, it } from "vitest";
import { deviationMilesFromSegment, isRouteDeviation } from "./routeDeviation";

describe("routeDeviation", () => {
  it("flags large deviation from straight segment", () => {
    const start = { lat: 38.9, lng: -76.8 };
    const end = { lat: 38.95, lng: -76.75 };
    const onRoute = { lat: 38.925, lng: -76.775 };
    const offRoute = { lat: 38.92, lng: -76.65 };
    const onDev = deviationMilesFromSegment(onRoute, start, end);
    const offDev = deviationMilesFromSegment(offRoute, start, end);
    expect(offDev).toBeGreaterThan(onDev);
    expect(isRouteDeviation(offDev)).toBe(true);
    expect(isRouteDeviation(onDev, 2)).toBe(false);
  });
});
