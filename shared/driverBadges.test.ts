import { describe, expect, it } from "vitest";
import { badgeRefusalMessage, describeBadges, driverMayTake, normalizeBadges, requiredBadge } from "./driverBadges";

describe("what a job needs", () => {
  it("medical work needs the medical badge; both deliveries share one", () => {
    expect(requiredBadge("medical")).toBe("medical");
    expect(requiredBadge("business")).toBe("delivery");
    expect(requiredBadge("food")).toBe("delivery");
  });
  it("an ordinary rider's trip needs no badge at all", () => {
    expect(requiredBadge(null)).toBeNull();
    expect(requiredBadge(undefined)).toBeNull();
    expect(requiredBadge("solo")).toBeNull();
    expect(driverMayTake([], null)).toBe(true);
  });
});

describe("who may take it", () => {
  it("only a driver holding the badge", () => {
    expect(driverMayTake(["medical"], "medical")).toBe(true);
    expect(driverMayTake(["delivery"], "medical")).toBe(false);
    expect(driverMayTake([], "medical")).toBe(false);
    expect(driverMayTake(["medical", "delivery"], "food")).toBe(true);
  });
  it("junk in the column never grants anything", () => {
    expect(driverMayTake(null, "medical")).toBe(false);
    expect(driverMayTake("medical", "medical")).toBe(false);
    expect(driverMayTake(["MEDICAL"], "medical")).toBe(false);
    expect(driverMayTake(["medical", "wizard"], "medical")).toBe(true);
  });
  it("normalizing keeps only known badges, once, in a stable order", () => {
    expect(normalizeBadges(["delivery", "medical", "delivery", "nonsense"])).toEqual(["medical", "delivery"]);
    expect(normalizeBadges("medical")).toEqual([]);
  });
});

describe("what people are told", () => {
  it("the refusal names the badge and how to get it", () => {
    const m = badgeRefusalMessage("medical");
    expect(m).toContain("Medical transport");
    expect(m).toContain("passenger-assistance training");
    expect(m).toContain("Ask PG Ride");
    expect(badgeRefusalMessage("business")).toContain("Deliveries");
  });
  it("a driver's badges read as words", () => {
    expect(describeBadges([])).toBe("Ordinary rides only");
    expect(describeBadges(["medical"])).toBe("Medical transport");
    expect(describeBadges(["delivery", "medical"])).toBe("Medical transport · Deliveries");
  });
});
