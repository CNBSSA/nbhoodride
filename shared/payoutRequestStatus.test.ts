import { describe, expect, it } from "vitest";
import { isPayoutTarget, payoutFromStatuses, payoutTransitionRefusal } from "./payoutRequestStatus";

describe("payout request moves", () => {
  it("never leaves paid or rejected", () => {
    for (const to of ["processing", "paid", "rejected"] as const) {
      expect(payoutFromStatuses(to)).not.toContain("paid");
      expect(payoutFromStatuses(to)).not.toContain("rejected");
    }
  });
  it("lets a pending or processing request be paid or rejected, and only a pending one be processing", () => {
    expect(payoutFromStatuses("paid")).toEqual(["pending", "processing"]);
    expect(payoutFromStatuses("rejected")).toEqual(["pending", "processing"]);
    expect(payoutFromStatuses("processing")).toEqual(["pending"]);
  });
  it("only names the three targets", () => {
    expect(isPayoutTarget("paid")).toBe(true);
    expect(isPayoutTarget("pending")).toBe(false);
    expect(isPayoutTarget(undefined)).toBe(false);
  });
  it("says why in plain words", () => {
    expect(payoutTransitionRefusal("rejected", "paid")).toMatch(/already rejected/);
    expect(payoutTransitionRefusal("paid", "rejected")).toMatch(/already paid/);
    expect(payoutTransitionRefusal("processing", "processing")).toMatch(/already processing/);
  });
});
