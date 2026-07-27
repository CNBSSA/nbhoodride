import { describe, it, expect } from "vitest";
import {
  EMAIL_VERIFICATION_MANDATORY_AFTER,
  isEmailVerificationMandatory,
} from "./emailVerificationPolicy";

describe("emailVerificationPolicy", () => {
  it("is not mandatory before the grace deadline", () => {
    const before = new Date(EMAIL_VERIFICATION_MANDATORY_AFTER.getTime() - 1000);
    expect(isEmailVerificationMandatory(before)).toBe(false);
  });

  it("is mandatory on or after the grace deadline", () => {
    expect(isEmailVerificationMandatory(EMAIL_VERIFICATION_MANDATORY_AFTER)).toBe(true);
    const after = new Date(EMAIL_VERIFICATION_MANDATORY_AFTER.getTime() + 60_000);
    expect(isEmailVerificationMandatory(after)).toBe(true);
  });
});
