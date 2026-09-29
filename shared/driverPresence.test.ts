import { describe, it, expect } from "vitest";
import { DRIVER_DROP_GRACE_MS, dropHasExpired, DRIVER_DROP_WORDS } from "./driverPresence";

describe("a driver's socket going quiet", () => {
  const now = new Date("2026-09-29T12:00:00Z");
  it("is not a drop until the grace has run out", () => {
    expect(dropHasExpired(new Date(now.getTime() - 3000), now)).toBe(false);
    expect(dropHasExpired(new Date(now.getTime() - DRIVER_DROP_GRACE_MS + 1), now)).toBe(false);
    expect(dropHasExpired(new Date(now.getTime() - DRIVER_DROP_GRACE_MS), now)).toBe(true);
    expect(dropHasExpired(new Date(now.getTime() - DRIVER_DROP_GRACE_MS - 60_000).toISOString(), now)).toBe(true);
  });
  it("a driver who came back, or was never dropped, is never released", () => {
    expect(dropHasExpired(null, now)).toBe(false);
    expect(dropHasExpired(undefined, now)).toBe(false);
    expect(dropHasExpired("not a date", now)).toBe(false);
  });
  it("tells the driver how long they were gone and where the pickup was", () => {
    expect(DRIVER_DROP_WORDS.driver("12 Oak St", 6)).toMatch(/6 minutes.*12 Oak St/);
    expect(DRIVER_DROP_WORDS.driver("", 6)).toMatch(/the pickup/);
  });
});
