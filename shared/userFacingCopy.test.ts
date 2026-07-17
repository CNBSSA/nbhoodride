import { describe, expect, it } from "vitest";
import { humanizePaymentStatus, parseBookingErrorMessage } from "./userFacingCopy";

describe("userFacingCopy", () => {
  it("humanizes payment status", () => {
    expect(humanizePaymentStatus("completed")).toBe("Paid");
    expect(humanizePaymentStatus("authorized")).toContain("Authorized");
  });

  it("parses booking errors", () => {
    expect(parseBookingErrorMessage("Insufficient balance")).toMatch(/PG Card/);
  });
});
