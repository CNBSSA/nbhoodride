import { describe, expect, it } from "vitest";
import { roadFiguresPlausible } from "./routeEstimate";

describe("road figures an app reports are believed only when they could be true", () => {
  it("accepts a Mapbox route a little longer than the straight line at road speed", () => {
    expect(roadFiguresPlausible(17.3, 42, 15.4)).toBe(true);
  });
  it("refuses a route shorter than the straight line — nobody drove that", () => {
    expect(roadFiguresPlausible(1, 2, 15.4)).toBe(false);
  });
  it("refuses a route driven faster than 70 mph door to door", () => {
    expect(roadFiguresPlausible(20, 10, 15.4)).toBe(false);
  });
  it("refuses missing or zero figures", () => {
    expect(roadFiguresPlausible(NaN, 42, 15.4)).toBe(false);
    expect(roadFiguresPlausible(17.3, 0, 15.4)).toBe(false);
  });
  it("refuses figures far above the road: a short trip cannot be priced as a long one", () => {
    // 1 mile apart, app claims 489 miles / 420 minutes: passes the floors, not the ceilings.
    expect(roadFiguresPlausible(489, 420, 1)).toBe(false);
    expect(roadFiguresPlausible(4.1, 12, 1)).toBe(false);
    expect(roadFiguresPlausible(3.9, 12, 1)).toBe(true);
    // 15.4 miles apart: 17.3 miles in 42 minutes is a real drive; 17.3 miles in 5 hours is not.
    expect(roadFiguresPlausible(17.3, 300, 15.4)).toBe(false);
    expect(roadFiguresPlausible(17.3, 100, 15.4)).toBe(true);
  });
});
