import { describe, expect, it } from "vitest";
import {
  CASH_DISCONTINUED_MESSAGE,
  PAYMENT_METHODS_ACCEPTED,
  PAYMENT_METHODS_DISCONTINUED,
  isDiscontinuedPaymentMethod,
  mayCreateWithPaymentMethod,
  settlesInCash,
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

describe("settlesInCash", () => {
  it("is true for a cash ride", () => {
    expect(settlesInCash("cash")).toBe(true);
  });

  it("is true for a ride from back then with nothing recorded, so its driver can still confirm the money", () => {
    expect(settlesInCash(null)).toBe(true);
    expect(settlesInCash(undefined)).toBe(true);
    expect(settlesInCash("")).toBe(true);
    expect(settlesInCash("   ")).toBe(true);
  });

  it("is false for a ride that pays itself", () => {
    expect(settlesInCash("card")).toBe(false);
    expect(settlesInCash("invoice")).toBe(false);
  });
});
