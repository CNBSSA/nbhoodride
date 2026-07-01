import { describe, expect, it } from "vitest";
import {
  getMobilityIntentPurgeCutoff,
  MOBILITY_INTENT_RETENTION_DAYS,
} from "./mobilityIntentRetention";

describe("getMobilityIntentPurgeCutoff", () => {
  it("defaults to 90 days before reference time", () => {
    const now = new Date("2026-07-01T12:00:00Z");
    const cutoff = getMobilityIntentPurgeCutoff(now);
    const expected = new Date(now);
    expected.setUTCDate(expected.getUTCDate() - MOBILITY_INTENT_RETENTION_DAYS);
    expect(cutoff.toISOString()).toBe(expected.toISOString());
  });

  it("accepts custom retention window", () => {
    const now = new Date("2026-07-01T00:00:00Z");
    const cutoff = getMobilityIntentPurgeCutoff(now, 30);
    expect(cutoff.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });
});
