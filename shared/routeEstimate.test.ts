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
});
