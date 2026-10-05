import { describe, it, expect } from "vitest";
import { reconnectDelayMs, positionIsFresh, WS_RECONNECT_MAX_MS, DRIVER_LOCATION_STALE_MS } from "./liveLocation";

describe("reconnecting a dropped socket", () => {
  it("backs off 3, 6, 12, 24 seconds and then holds at 30", () => {
    expect([1, 2, 3, 4, 5, 9].map((a) => reconnectDelayMs(a, 0))).toEqual([3000, 6000, 12000, 24000, 30000, 30000]);
  });
  it("adds up to 30% jitter so a fleet of phones does not reconnect in step", () => {
    expect(reconnectDelayMs(1, 0.5)).toBe(3450);
    expect(reconnectDelayMs(5, 0.999)).toBeLessThan(WS_RECONNECT_MAX_MS * 1.3 + 1);
    expect(reconnectDelayMs(0, 0)).toBe(3000);
  });
});

describe("a driver position", () => {
  const now = Date.parse("2026-09-29T12:00:00Z");
  it("is fresh within the stale window and stale after it", () => {
    expect(positionIsFresh(now - 10_000, now)).toBe(true);
    expect(positionIsFresh(new Date(now - DRIVER_LOCATION_STALE_MS + 1), now)).toBe(true);
    expect(positionIsFresh(new Date(now - DRIVER_LOCATION_STALE_MS).toISOString(), now)).toBe(false);
  });
  it("never counts a missing or unreadable stamp as fresh", () => {
    expect(positionIsFresh(null, now)).toBe(false);
    expect(positionIsFresh(undefined, now)).toBe(false);
    expect(positionIsFresh("nope", now)).toBe(false);
  });
});
