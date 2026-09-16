import { describe, expect, it } from "vitest";
import { badgeRefusalMessage, describeBadges, driverMayTake, normalizeBadges, requiredBadge } from "./driverBadges";

describe("what a job needs", () => {
  it("a medical account's passenger needs the medical badge; a parcel needs delivery whoever sends it", () => {
    expect(requiredBadge("medical")).toBe("medical");
    expect(requiredBadge("business", "delivery")).toBe("delivery");
    expect(requiredBadge("food", "delivery")).toBe("delivery");
    // A business or food account's PASSENGER is an ordinary ride. This used
    // to read "delivery" for every business job, rides included.
    expect(requiredBadge("business")).toBeNull();
    expect(requiredBadge("food")).toBeNull();
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
    expect(badgeRefusalMessage("business", "delivery")).toContain("Deliveries");
  });
  it("a driver's badges read as words", () => {
    expect(describeBadges([])).toBe("Ordinary rides only");
    expect(describeBadges(["medical"])).toBe("Medical transport");
    expect(describeBadges(["delivery", "medical"])).toBe("Medical transport · Deliveries");
  });
});

describe("the badge follows what the job is, not only who booked it", () => {
  it("a business account's passenger ride is an ordinary ride — no badge", () => {
    expect(requiredBadge("business", "ride")).toBeNull();
    expect(requiredBadge("food", "ride")).toBeNull();
    expect(driverMayTake([], "business", "ride")).toBe(true);
  });
  it("a parcel needs the delivery badge whoever sends it", () => {
    expect(requiredBadge("business", "delivery")).toBe("delivery");
    expect(requiredBadge("food", "delivery")).toBe("delivery");
    expect(driverMayTake([], "business", "delivery")).toBe(false);
    expect(driverMayTake(["delivery"], "business", "delivery")).toBe(true);
  });
  it("a medical account's passenger still needs the medical badge", () => {
    expect(requiredBadge("medical", "ride")).toBe("medical");
    expect(driverMayTake(["delivery"], "medical", "ride")).toBe(false);
  });
  it("the refusal names the badge the JOB needs", () => {
    expect(badgeRefusalMessage("business", "delivery")).toContain("Deliveries");
  });
});
