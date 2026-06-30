import { describe, expect, it } from "vitest";
import { complianceStatusFromExpiry, shouldBlockDriving } from "./compliancePolicy";

describe("compliancePolicy", () => {
  it("flags expiring within 30 days", () => {
    const soon = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    expect(complianceStatusFromExpiry(soon)).toBe("expiring_soon");
  });

  it("flags expired documents", () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    expect(complianceStatusFromExpiry(past)).toBe("expired");
    expect(shouldBlockDriving("expired")).toBe(true);
  });
});
