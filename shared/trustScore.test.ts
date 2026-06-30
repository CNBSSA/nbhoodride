import { describe, expect, it } from "vitest";
import {
  buildMatchReason,
  computeTrustScore,
  passesSeparationFilter,
  rankDriversByTrustAndEta,
} from "./trustScore";

describe("trustScore", () => {
  it("scores favorites and ride history higher", () => {
    const base = computeTrustScore({
      rideCount: 0,
      isFavorite: false,
      avgRating: 5,
      isVerifiedNeighbor: false,
      hasOwnership: false,
      separationDegrees: 0,
    });
    const favored = computeTrustScore({
      rideCount: 3,
      isFavorite: true,
      avgRating: 5,
      isVerifiedNeighbor: true,
      hasOwnership: false,
      separationDegrees: 1,
    });
    expect(favored).toBeGreaterThan(base);
    expect(favored).toBeLessThanOrEqual(100);
  });

  it("builds human-readable match reason", () => {
    const reason = buildMatchReason({
      trustScore: 72,
      rideCount: 2,
      isFavorite: false,
      separationDegrees: 1,
      isVerifiedNeighbor: true,
    });
    expect(reason).toContain("ridden together");
    expect(reason).toContain("72");
  });

  it("filters by separation degrees", () => {
    expect(passesSeparationFilter(2, 1)).toBe(false);
    expect(passesSeparationFilter(1, 2)).toBe(true);
    expect(passesSeparationFilter(0, 1)).toBe(true);
  });

  it("prefers trust when gap is large", () => {
    const ranked = rankDriversByTrustAndEta([
      { distanceMiles: 1, isOnline: true, trustScore: 30 },
      { distanceMiles: 3, isOnline: true, trustScore: 85 },
    ]);
    expect(ranked[0]?.trustScore).toBe(85);
  });
});
