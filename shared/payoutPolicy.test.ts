import { describe, expect, it } from "vitest";
import { DRIVER_SHARE, PLATFORM_SHARE, splitFare } from "./payoutPolicy";

describe("splitFare", () => {
  it("is 85 / 15 on the fare", () => {
    expect(PLATFORM_SHARE).toBe(0.15);
    expect(DRIVER_SHARE).toBeCloseTo(0.85, 10);
    expect(splitFare(23.21)).toEqual({ fare: 23.21, platformFee: 3.48, driverFareShare: 19.73, tip: 0, driverEarnings: 19.73 });
  });

  it("gives the driver 100% of the tip", () => {
    const s = splitFare("18.21", "5.00");
    expect(s.platformFee).toBe(2.73);
    expect(s.driverFareShare).toBe(15.48);
    expect(s.tip).toBe(5);
    expect(s.driverEarnings).toBe(20.48);
  });

  it("always reconciles to the cent: driver share + platform fee = fare", () => {
    for (const fare of [7.65, 7.12, 10.01, 12.34, 99.99, 100, 0.01]) {
      const s = splitFare(fare);
      expect(Math.round((s.driverFareShare + s.platformFee) * 100)).toBe(Math.round(fare * 100));
    }
  });

  it("treats missing or bad amounts as zero", () => {
    expect(splitFare(null)).toEqual({ fare: 0, platformFee: 0, driverFareShare: 0, tip: 0, driverEarnings: 0 });
    expect(splitFare("abc", -3).driverEarnings).toBe(0);
  });
});

describe("a discount is PG Ride's, not the driver's", () => {
  it("pays the driver on the fare before a welcome credit", () => {
    // $23 quoted, $5 welcome credit: the rider pays $18, the driver drove
    // exactly the same trip and keeps 85% of $23.
    const s = splitFare(18, 0, { driverBasis: 23 });
    expect(s.fare).toBe(18);
    expect(s.driverFareShare).toBe(19.55);
    expect(s.driverEarnings).toBe(19.55);
  });

  it("takes the discount out of PG Ride's share, showing what the rider cost", () => {
    // PG Ride's 15% of $23 is $3.45; a $5 credit is more than that, so the
    // ride runs $1.55 out of pocket. That is the acquisition cost, stated.
    expect(splitFare(18, 0, { driverBasis: 23 }).platformFee).toBe(-1.55);
    // A discount inside its share simply shrinks it, never the driver's.
    expect(splitFare(21, 0, { driverBasis: 23 }).platformFee).toBe(1.45);
    expect(splitFare(21, 0, { driverBasis: 23 }).driverFareShare).toBe(19.55);
  });

  it("still reconciles to the cent against what the rider actually paid", () => {
    for (const [charged, basis] of [[18, 23], [21, 23], [7.12, 12.12], [0.01, 5.01]] as const) {
      const s = splitFare(charged, 0, { driverBasis: basis });
      expect(Math.round((s.driverFareShare + s.platformFee) * 100)).toBe(Math.round(charged * 100));
    }
  });

  it("never pays the driver on less than the rider paid", () => {
    expect(splitFare(23, 0, { driverBasis: 10 })).toEqual(splitFare(23));
    expect(splitFare(23, 0, { driverBasis: null })).toEqual(splitFare(23));
    expect(splitFare(23, 0, { driverBasis: "abc" })).toEqual(splitFare(23));
  });

  it("leaves an ordinary ride exactly as it was", () => {
    for (const fare of [7.65, 7.12, 10.01, 12.34, 99.99, 100, 0.01]) {
      expect(splitFare(fare, 3, { driverBasis: fare })).toEqual(splitFare(fare, 3));
    }
  });

  it("gives the driver the whole tip on a promo ride too", () => {
    const s = splitFare(18, "5.00", { driverBasis: 23 });
    expect(s.tip).toBe(5);
    expect(s.driverEarnings).toBe(24.55);
  });
});
