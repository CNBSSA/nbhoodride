import { describe, it, expect } from "vitest";
import { findFrequentDestination } from "./frequentTrip";

const WORK = { lat: 38.9, lng: -76.9, address: "123 Office Way, Lanham, MD" };
const WORK_SLIGHTLY_DIFFERENT_LABEL = { lat: 38.9001, lng: -76.9001, address: "123 Office Way #2, Lanham, MD" };
const MALL = { lat: 38.95, lng: -76.95, address: "PG Mall, MD" };
const NOW = new Date("2026-07-27T12:00:00.000Z");

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
}

describe("findFrequentDestination", () => {
  it("returns null with fewer than 2 matching rides", () => {
    const result = findFrequentDestination(
      [{ destinationLocation: WORK, completedAt: daysAgo(1) }],
      NOW,
    );
    expect(result).toBeNull();
  });

  it("returns the destination once it appears 2+ times within 30 days", () => {
    const result = findFrequentDestination(
      [
        { destinationLocation: WORK, completedAt: daysAgo(1) },
        { destinationLocation: WORK, completedAt: daysAgo(10) },
      ],
      NOW,
    );
    expect(result).not.toBeNull();
    expect(result!.rideCount).toBe(2);
    expect(result!.destinationLocation.address).toBe(WORK.address);
  });

  it("treats near-identical coordinates as the same place despite label differences", () => {
    const result = findFrequentDestination(
      [
        { destinationLocation: WORK, completedAt: daysAgo(1) },
        { destinationLocation: WORK_SLIGHTLY_DIFFERENT_LABEL, completedAt: daysAgo(5) },
      ],
      NOW,
    );
    expect(result).not.toBeNull();
    expect(result!.rideCount).toBe(2);
  });

  it("ignores rides older than the 30-day lookback window", () => {
    const result = findFrequentDestination(
      [
        { destinationLocation: WORK, completedAt: daysAgo(1) },
        { destinationLocation: WORK, completedAt: daysAgo(45) },
      ],
      NOW,
    );
    expect(result).toBeNull();
  });

  it("picks the most-visited destination when several qualify", () => {
    const result = findFrequentDestination(
      [
        { destinationLocation: WORK, completedAt: daysAgo(1) },
        { destinationLocation: WORK, completedAt: daysAgo(2) },
        { destinationLocation: WORK, completedAt: daysAgo(3) },
        { destinationLocation: MALL, completedAt: daysAgo(1) },
        { destinationLocation: MALL, completedAt: daysAgo(2) },
      ],
      NOW,
    );
    expect(result!.destinationLocation.address).toBe(WORK.address);
    expect(result!.rideCount).toBe(3);
  });

  it("skips rides with no destination or completedAt", () => {
    const result = findFrequentDestination(
      [
        { destinationLocation: null, completedAt: daysAgo(1) },
        { destinationLocation: WORK, completedAt: null },
      ],
      NOW,
    );
    expect(result).toBeNull();
  });

  it("returns null for an empty ride list", () => {
    expect(findFrequentDestination([], NOW)).toBeNull();
  });
});
