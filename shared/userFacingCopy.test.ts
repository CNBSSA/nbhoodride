import { describe, expect, it } from "vitest";
import { humanizePaymentStatus, parseBookingErrorMessage } from "./userFacingCopy";

describe("userFacingCopy", () => {
  it("humanizes payment status", () => {
    expect(humanizePaymentStatus("completed")).toBe("Paid");
    expect(humanizePaymentStatus("authorized")).toContain("Authorized");
  });

  it("parses booking errors", () => {
    // Card-only (lean) copy: a balance/insufficient-funds error is surfaced as a
    // plain card-charge failure — no wallet/stored-value wording.
    expect(parseBookingErrorMessage("Insufficient balance")).toMatch(/card/i);
  });
});
