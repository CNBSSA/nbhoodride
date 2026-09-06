import { describe, expect, it } from "vitest";
import {
  normalizeDisputeIssueType,
  canAutoResolveSupport,
  suggestRefundAmount,
  SUPPORT_AUTO_RESOLVE_MAX_USD,
} from "./supportPolicy";

describe("supportPolicy", () => {
  it("allows auto-resolve within cap", () => {
    expect(
      canAutoResolveSupport({
        issueType: "fare_dispute",
        requestedRefund: 20,
        rideFare: 30,
      }),
    ).toBe(true);
  });

  it("blocks amounts over $25", () => {
    expect(
      canAutoResolveSupport({
        issueType: "fare_dispute",
        requestedRefund: 26,
        rideFare: 40,
      }),
    ).toBe(false);
  });

  it("blocks non-auto issue types", () => {
    expect(
      canAutoResolveSupport({
        issueType: "assault",
        requestedRefund: 10,
        rideFare: 20,
      }),
    ).toBe(false);
  });

  it("suggests bounded refunds", () => {
    expect(suggestRefundAmount("promo_not_applied", 12)).toBeLessThanOrEqual(5);
    expect(suggestRefundAmount("fare_dispute", 100)).toBeLessThanOrEqual(
      SUPPORT_AUTO_RESOLVE_MAX_USD,
    );
  });
});

describe("normalizeDisputeIssueType", () => {
  it("maps the ids the Report Issue sheet used to send", () => {
    expect(normalizeDisputeIssueType("fare-dispute")).toBe("fare_dispute");
    expect(normalizeDisputeIssueType("route-issue")).toBe("wrong_route");
    expect(normalizeDisputeIssueType("safety-concern")).toBe("safety");
    expect(normalizeDisputeIssueType("lost-item")).toBe("lost_item_minor");
    expect(normalizeDisputeIssueType("other")).toBe("other");
  });
  it("passes canonical values through, case-insensitively", () => {
    expect(normalizeDisputeIssueType("fare_dispute")).toBe("fare_dispute");
    expect(normalizeDisputeIssueType(" Wrong_Route ")).toBe("wrong_route");
  });
  it("leaves unknown values for validation to reject", () => {
    expect(normalizeDisputeIssueType("nonsense")).toBe("nonsense");
    expect(normalizeDisputeIssueType(undefined)).toBeUndefined();
  });
});
