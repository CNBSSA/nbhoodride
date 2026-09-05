import { describe, expect, it } from "vitest";
import { resolveCompletedFare } from "./farePolicy";

describe("resolveCompletedFare", () => {
  it("charges the quoted fare on a normal completion even when the GPS track is short", () => {
    // The first PG Ride trip: quoted $23.21, GPS-metered $7.12.
    expect(resolveCompletedFare({ quotedFare: "23.21", metered: 7.12 })).toEqual({ fare: 23.21, basis: "quoted" });
  });

  it("does not charge more than the quote when the metered fare is higher", () => {
    expect(resolveCompletedFare({ quotedFare: 23.21, metered: 31.5 })).toEqual({ fare: 23.21, basis: "quoted" });
  });

  it("subtracts a promo recorded on the ride from the quote", () => {
    expect(resolveCompletedFare({ quotedFare: "23.21", promoDiscount: "5.00" })).toEqual({ fare: 18.21, basis: "quoted" });
    expect(resolveCompletedFare({ quotedFare: 3, promoDiscount: 5 })).toEqual({ fare: 0, basis: "quoted" });
  });

  it("lets an explicit fare win over everything", () => {
    expect(resolveCompletedFare({ explicit: 30, quotedFare: 23.21, metered: 7.12 })).toEqual({ fare: 30, basis: "explicit" });
    expect(resolveCompletedFare({ explicit: 0, quotedFare: 23.21 })).toEqual({ fare: 23.21, basis: "quoted" });
  });

  it("uses the metered fare for an early end, capped at the quote", () => {
    expect(resolveCompletedFare({ pricing: "metered", quotedFare: 23.21, metered: 7.12 })).toEqual({ fare: 7.12, basis: "metered" });
    expect(resolveCompletedFare({ pricing: "metered", quotedFare: 23.21, metered: 40 })).toEqual({ fare: 23.21, basis: "metered" });
    expect(resolveCompletedFare({ pricing: "metered", quotedFare: 23.21 })).toEqual({ fare: 23.21, basis: "quoted" });
  });

  it("falls back to the metered fare when there was no quote", () => {
    expect(resolveCompletedFare({ quotedFare: null, metered: 9.4 })).toEqual({ fare: 9.4, basis: "metered" });
    expect(resolveCompletedFare({ quotedFare: "0", metered: 9.4 })).toEqual({ fare: 9.4, basis: "metered" });
  });

  it("returns undefined when there is nothing to price from", () => {
    expect(resolveCompletedFare({})).toBeUndefined();
    expect(resolveCompletedFare({ quotedFare: "not a number" })).toBeUndefined();
  });
});
