import { describe, expect, it } from "vitest";
import { mergeHeatmapWithForecast, predictRideCount } from "./demandForecast";

describe("demandForecast", () => {
  it("boosts rush-hour predictions", () => {
    const offPeak = predictRideCount(10, 2, 14);
    const rush = predictRideCount(10, 2, 8);
    expect(rush.predicted).toBeGreaterThan(offPeak.predicted);
  });

  it("raises confidence with more history", () => {
    const low = predictRideCount(2, 3, 10);
    const high = predictRideCount(20, 3, 10);
    expect(high.confidence).toBeGreaterThan(low.confidence);
  });

  it("merges forecast onto heatmap cells", () => {
    const merged = mergeHeatmapWithForecast([
      { rideCount: 5, hourOfDay: 8, dayOfWeek: 1 },
    ]);
    expect(merged[0]?.predictedRides).toBeGreaterThan(0);
    expect(merged[0]?.forecastConfidence).toBeGreaterThan(0);
  });
});
