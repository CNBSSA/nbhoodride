import { describe, expect, it } from "vitest";
import {
  DRIVER_FAR_MILES,
  DRIVER_LOCATION_STALE_MINUTES,
  describeDriverRisk,
  driverPickupCheck,
  haversineMiles,
  unclaimedPageDue,
} from "./rideRisk";

const now = new Date("2026-09-09T20:00:00Z");
const pickup = { lat: 38.9073, lng: -76.7781 }; // Bowie
const nearby = { lat: 38.92, lng: -76.79 }; // ~1.2 mi
const farAway = { lat: 38.7823, lng: -77.0166 }; // National Harbor, ~16 mi
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

describe("unclaimedPageDue", () => {
  it("pages at two hours, then again at fifteen minutes", () => {
    expect(unclaimedPageDue(200, {})).toBeNull();
    expect(unclaimedPageDue(119, {})?.stage).toBe("o120");
    expect(unclaimedPageDue(119, { o120: "x" })).toBeNull();
    expect(unclaimedPageDue(14, { o120: "x" })?.stage).toBe("o15");
    expect(unclaimedPageDue(14, { o120: "x", o15: "x" })).toBeNull();
  });
  it("a ride booked at the last minute gets one page, not two", () => {
    const due = unclaimedPageDue(10, {});
    expect(due?.stage).toBe("o15");
    expect(due?.stampAll).toEqual(["o15", "o120"]);
  });
  it("never pages a ride whose departure has passed", () => {
    expect(unclaimedPageDue(-1, {})).toBeNull();
  });
});

describe("driverPickupCheck", () => {
  it("only runs inside the T-10 window and only once", () => {
    expect(driverPickupCheck({ minutesToDeparture: 30, stamps: {}, pickup, driverLocation: nearby, driverLocationAt: now }, now).checked).toBe(false);
    expect(driverPickupCheck({ minutesToDeparture: 10, stamps: { o10: "x" }, pickup, driverLocation: nearby, driverLocationAt: now }, now).checked).toBe(false);
    expect(driverPickupCheck({ minutesToDeparture: 10, stamps: {}, pickup, driverLocation: nearby, driverLocationAt: now }, now).checked).toBe(true);
  });
  it("a driver close by with a fresh position is fine", () => {
    const r = driverPickupCheck({ minutesToDeparture: 9, stamps: {}, pickup, driverLocation: nearby, driverLocationAt: minutesAgo(2) }, now);
    expect(r.reason).toBeNull();
    expect(r.milesAway).toBeLessThan(DRIVER_FAR_MILES);
  });
  it("a driver far away is paged with the distance", () => {
    const r = driverPickupCheck({ minutesToDeparture: 9, stamps: {}, pickup, driverLocation: farAway, driverLocationAt: minutesAgo(1) }, now);
    expect(r.reason).toBe("far");
    expect(r.milesAway).toBeGreaterThan(10);
    expect(describeDriverRisk(r, 9)).toMatch(/^Driver is \d+(\.\d)? miles from the pickup · 9 min to departure$/);
  });
  it("a stale or missing position is paged, not trusted", () => {
    const stale = driverPickupCheck({ minutesToDeparture: 9, stamps: {}, pickup, driverLocation: nearby, driverLocationAt: minutesAgo(DRIVER_LOCATION_STALE_MINUTES + 5) }, now);
    expect(stale.reason).toBe("stale_location");
    expect(describeDriverRisk(stale, 9)).toContain("min old");
    const none = driverPickupCheck({ minutesToDeparture: 9, stamps: {}, pickup, driverLocation: null, driverLocationAt: null }, now);
    expect(none.reason).toBe("no_location");
    const noStamp = driverPickupCheck({ minutesToDeparture: 9, stamps: {}, pickup, driverLocation: nearby, driverLocationAt: null }, now);
    expect(noStamp.reason).toBe("stale_location");
  });
});

describe("haversineMiles", () => {
  it("Bowie to National Harbor is about sixteen miles", () => {
    const d = haversineMiles(pickup.lat, pickup.lng, farAway.lat, farAway.lng);
    expect(d).toBeGreaterThan(14);
    expect(d).toBeLessThan(18);
  });
});
