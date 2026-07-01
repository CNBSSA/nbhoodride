import { describe, expect, it } from "vitest";
import { computeDriverProTier } from "./driverProTier";

describe("computeDriverProTier", () => {
  it("defaults to community for new drivers", () => {
    expect(computeDriverProTier({ totalRides: 0, avgRating: 5 })).toBe("community");
  });

  it("promotes to pro on volume and rating", () => {
    expect(computeDriverProTier({ totalRides: 30, avgRating: 4.6 })).toBe("pro");
  });

  it("promotes to pro on qualifying weeks", () => {
    expect(computeDriverProTier({ totalRides: 10, avgRating: 4.8, qualifyingWeeks: 4 })).toBe("pro");
  });

  it("requires verified neighbor for elite", () => {
    expect(
      computeDriverProTier({ totalRides: 120, avgRating: 4.9, isVerifiedNeighbor: false }),
    ).toBe("pro");
    expect(
      computeDriverProTier({ totalRides: 120, avgRating: 4.9, isVerifiedNeighbor: true }),
    ).toBe("elite");
  });
});
