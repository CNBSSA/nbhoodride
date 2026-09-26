import { describe, it, expect } from "vitest";
import { bookingRouteFigures, judgeBookingFare, validateRoutePoints, LOWBALL_RATIO, STALE_ABOVE_RATIO } from "./bookingQuote";

const A = { lat: 38.98, lng: -76.94 };
const B = { lat: 38.90, lng: -76.85 };

describe("bookingRouteFigures", () => {
  it("takes the app's figures when they could be true", () => {
    const f = bookingRouteFigures([A, B], 9.4, 21);
    expect(f.source).toBe("app");
    expect(f.miles).toBe(9.4);
    expect(f.minutes).toBe(21);
  });
  it("replaces figures shorter than the straight line or faster than 70 mph", () => {
    const typed = bookingRouteFigures([A, B], 1, 2);
    expect(typed.source).toBe("server");
    expect(typed.miles).toBeGreaterThan(typed.straightLineMiles);
    const fast = bookingRouteFigures([A, B], 9.4, 3);
    expect(fast.source).toBe("server");
  });
  it("replaces figures far above the road, so a short trip is never priced as a long one", () => {
    const inflated = bookingRouteFigures([A, B], 489, 420);
    expect(inflated.source).toBe("server");
    expect(inflated.miles).toBeLessThan(30);
  });
  it("replaces figures that are missing, negative or absurd", () => {
    expect(bookingRouteFigures([A, B], undefined, undefined).source).toBe("server");
    expect(bookingRouteFigures([A, B], -5, 20).source).toBe("server");
    expect(bookingRouteFigures([A, B], 900, 2000).source).toBe("server");
    expect(bookingRouteFigures([A, B], "abc", "x").source).toBe("server");
  });
  it("prices the whole route through every stop", () => {
    const direct = bookingRouteFigures([A, B], undefined, undefined);
    const viaStop = bookingRouteFigures([A, { lat: 38.95, lng: -76.75 }, B], undefined, undefined);
    expect(viaStop.miles).toBeGreaterThan(direct.miles);
  });
});

describe("judgeBookingFare", () => {
  it("the fare is always the server's quote", () => {
    for (const app of [undefined, null, "", 0, -3, 1, 19.99, 20, 20.005, 24, 26, 500, "abc"]) {
      expect(judgeBookingFare(app, 20).fare).toBe(20);
    }
  });
  it("an app that priced the same figures on the same rate card matches", () => {
    const j = judgeBookingFare("20.00", 20.004);
    expect(j.gap).toBe("matches");
    expect(j.alert).toBe(false);
  });
  it("well below the quote is a lowball that ops hear about", () => {
    const j = judgeBookingFare(20 * LOWBALL_RATIO - 0.01, 20);
    expect(j.gap).toBe("lowball");
    expect(j.alert).toBe(true);
    expect(judgeBookingFare(1, 23.21).gap).toBe("lowball");
  });
  it("a little below is noted, not paged", () => {
    const j = judgeBookingFare(19, 20);
    expect(j.gap).toBe("below");
    expect(j.alert).toBe(false);
  });
  it("well above the quote is a stale rate card that ops hear about, and the rider pays the quote", () => {
    const j = judgeBookingFare(20 * STALE_ABOVE_RATIO + 0.01, 20);
    expect(j.gap).toBe("stale_above");
    expect(j.alert).toBe(true);
    expect(j.fare).toBe(20);
  });
  it("a little above is noted, not paged", () => {
    expect(judgeBookingFare(22, 20).gap).toBe("above");
    expect(judgeBookingFare(22, 20).alert).toBe(false);
  });
  it("nothing usable from the app is missing, never an alert", () => {
    for (const app of [undefined, null, "", 0, -1, "abc", NaN]) {
      const j = judgeBookingFare(app, 20);
      expect(j.gap).toBe("missing");
      expect(j.appFare).toBeNull();
      expect(j.alert).toBe(false);
    }
  });
});

describe("validateRoutePoints", () => {
  it("accepts real points and trims the address", () => {
    const r = validateRoutePoints([{ lat: "38.9", lng: -76.9, address: "  1 Main St  " }], 3);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.points[0]).toEqual({ lat: 38.9, lng: -76.9, address: "1 Main St" });
  });
  it("refuses a point without coordinates or an address, and too many points", () => {
    expect(validateRoutePoints([{ address: "no coordinates" }], 3).ok).toBe(false);
    expect(validateRoutePoints([{ lat: 38.9, lng: -76.9 }], 3).ok).toBe(false);
    expect(validateRoutePoints([{ lat: 95, lng: -76.9, address: "x" }], 3).ok).toBe(false);
    expect(validateRoutePoints([A, A, A, A].map((p) => ({ ...p, address: "x" })), 3).ok).toBe(false);
  });
  it("nothing is an empty route, not an error", () => {
    const r = validateRoutePoints(undefined, 3);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.points).toEqual([]);
  });
});
