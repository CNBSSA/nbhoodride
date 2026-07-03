import { describe, it, expect } from "vitest";
import { mapRouteResponse, metersToMiles, secondsToMinutes } from "./routeGeometry";

describe("mapRouteResponse", () => {
  it("flips [lng,lat] geojson to [lat,lng] and reads distance/duration", () => {
    const raw = {
      routes: [
        {
          distance: 3218.6,
          duration: 480,
          geometry: {
            coordinates: [
              [-76.95, 38.96],
              [-76.94, 38.965],
              [-76.93, 38.97],
            ],
          },
        },
      ],
    };
    expect(mapRouteResponse(raw)).toEqual({
      coordinates: [
        [38.96, -76.95],
        [38.965, -76.94],
        [38.97, -76.93],
      ],
      distanceMeters: 3218.6,
      durationSeconds: 480,
    });
  });

  it("returns null when fewer than 2 points", () => {
    expect(mapRouteResponse({ routes: [{ geometry: { coordinates: [[-76.9, 38.9]] } }] })).toBeNull();
  });

  it("returns null for missing/invalid shapes", () => {
    expect(mapRouteResponse(null)).toBeNull();
    expect(mapRouteResponse({})).toBeNull();
    expect(mapRouteResponse({ routes: [] })).toBeNull();
    expect(mapRouteResponse({ routes: [{ geometry: {} }] })).toBeNull();
  });

  it("skips malformed coordinate pairs but keeps valid ones", () => {
    const raw = {
      routes: [
        {
          distance: 100,
          duration: 60,
          geometry: {
            coordinates: [
              [-76.9, 38.9],
              ["bad", 38.9],
              [-76.8, 38.8],
            ],
          },
        },
      ],
    };
    const out = mapRouteResponse(raw);
    expect(out?.coordinates).toEqual([
      [38.9, -76.9],
      [38.8, -76.8],
    ]);
  });

  it("defaults distance/duration to 0 when absent", () => {
    const raw = { routes: [{ geometry: { coordinates: [[-76.9, 38.9], [-76.8, 38.8]] } }] };
    const out = mapRouteResponse(raw);
    expect(out?.distanceMeters).toBe(0);
    expect(out?.durationSeconds).toBe(0);
  });
});

describe("unit conversions", () => {
  it("metersToMiles", () => {
    expect(metersToMiles(1609.344)).toBe(1);
    expect(metersToMiles(4828)).toBe(3);
  });
  it("secondsToMinutes floors at 1", () => {
    expect(secondsToMinutes(0)).toBe(1);
    expect(secondsToMinutes(480)).toBe(8);
  });
});
