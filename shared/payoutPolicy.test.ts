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
