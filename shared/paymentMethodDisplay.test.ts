import { describe, it, expect } from "vitest";
import { formatMaskedCardLine } from "./paymentMethodDisplay";

describe("paymentMethodDisplay", () => {
  it("masks all but last four digits", () => {
    expect(formatMaskedCardLine("4242")).toBe("•••• •••• •••• 4242");
  });
});
