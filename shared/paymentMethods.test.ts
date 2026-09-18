import { describe, expect, it } from "vitest";
import {
  CASH_DISCONTINUED_MESSAGE,
  PAYMENT_METHODS_ACCEPTED,
  PAYMENT_METHODS_DISCONTINUED,
  isDiscontinuedPaymentMethod,
  mayCreateWithPaymentMethod,
} from "./paymentMethods";

describe("cash is discontinued", () => {
  it("a new ride may be paid by card or billed to an organization, and nothing else", () => {
    expect([...PAYMENT_METHODS_ACCEPTED]).toEqual(["card", "invoice"]);
    expect(mayCreateWithPaymentMethod("card")).toBe(true);
    expect(mayCreateWithPaymentMethod("invoice")).toBe(true);
  });

  it("refuses cash, and anything that is not a way of paying at all", () => {
    expect(mayCreateWithPaymentMethod("cash")).toBe(false);
    for (const nonsense of [null, undefined, "", "CASH", "bitcoin", "  cash  "]) {
      expect(mayCreateWithPaymentMethod(nonsense as any)).toBe(false);
    }
  });

  it("knows a ride booked when cash was taken", () => {
    expect([...PAYMENT_METHODS_DISCONTINUED]).toEqual(["cash"]);
    expect(isDiscontinuedPaymentMethod("cash")).toBe(true);
    expect(isDiscontinuedPaymentMethod("card")).toBe(false);
    expect(isDiscontinuedPaymentMethod(null)).toBe(false);
  });

  it("says so in words a rider can read", () => {
    expect(CASH_DISCONTINUED_MESSAGE).toMatch(/no longer takes cash/i);
  });
});
