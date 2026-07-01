import { describe, expect, it } from "vitest";
import { DEFAULT_REFERRAL_CREDIT, parseReferralCreditAmount } from "./referralPolicy";

describe("parseReferralCreditAmount", () => {
  it("defaults when missing or invalid", () => {
    expect(parseReferralCreditAmount(undefined)).toBe(DEFAULT_REFERRAL_CREDIT);
    expect(parseReferralCreditAmount("")).toBe(DEFAULT_REFERRAL_CREDIT);
    expect(parseReferralCreditAmount("nope")).toBe(DEFAULT_REFERRAL_CREDIT);
    expect(parseReferralCreditAmount("-1")).toBe(DEFAULT_REFERRAL_CREDIT);
  });

  it("parses valid amounts", () => {
    expect(parseReferralCreditAmount("5.00")).toBe(5);
    expect(parseReferralCreditAmount("10")).toBe(10);
  });

  it("caps excessive promo amounts", () => {
    expect(parseReferralCreditAmount("500")).toBe(DEFAULT_REFERRAL_CREDIT);
  });
});
