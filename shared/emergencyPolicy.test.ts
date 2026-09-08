import { describe, expect, it } from "vitest";
import { EMERGENCY_SHARE_GRACE_HOURS, emergencyShareLinkOpen } from "./emergencyPolicy";

const now = new Date("2026-09-08T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

describe("emergencyShareLinkOpen", () => {
  it("stays open while the incident is active or acknowledged", () => {
    expect(emergencyShareLinkOpen({ status: "active", createdAt: hoursAgo(100) }, now)).toBe(true);
    expect(emergencyShareLinkOpen({ status: "acknowledged", createdAt: hoursAgo(100) }, now)).toBe(true);
  });
  it("stays open for the grace period after resolution, then closes", () => {
    expect(emergencyShareLinkOpen({ status: "resolved", resolvedAt: hoursAgo(1) }, now)).toBe(true);
    expect(emergencyShareLinkOpen({ status: "resolved", resolvedAt: hoursAgo(EMERGENCY_SHARE_GRACE_HOURS - 0.01) }, now)).toBe(true);
    expect(emergencyShareLinkOpen({ status: "resolved", resolvedAt: hoursAgo(EMERGENCY_SHARE_GRACE_HOURS) }, now)).toBe(false);
    expect(emergencyShareLinkOpen({ status: "resolved", resolvedAt: hoursAgo(400) }, now)).toBe(false);
  });
  it("falls back to updatedAt, then createdAt, when resolvedAt was never stamped", () => {
    expect(emergencyShareLinkOpen({ status: "resolved", resolvedAt: null, updatedAt: hoursAgo(2) }, now)).toBe(true);
    expect(emergencyShareLinkOpen({ status: "resolved", resolvedAt: null, updatedAt: hoursAgo(30) }, now)).toBe(false);
    expect(emergencyShareLinkOpen({ status: "resolved", createdAt: hoursAgo(30) }, now)).toBe(false);
  });
  it("a resolved incident with no timestamps at all is closed, not open forever", () => {
    expect(emergencyShareLinkOpen({ status: "resolved" }, now)).toBe(false);
  });
  it("accepts ISO strings as well as Dates", () => {
    expect(emergencyShareLinkOpen({ status: "resolved", resolvedAt: hoursAgo(1).toISOString() }, now)).toBe(true);
  });
});
