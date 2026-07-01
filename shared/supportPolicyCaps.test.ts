/**
 * Pins the auto-resolve caps and issue-type enum that the supervisor
 * review of Phase E flagged as missing.
 *
 * These are pure-function tests (no DB) — they cover the constants and
 * `canAutoResolveSupport` decision logic that gate every dispute the
 * Support Agent might attempt to auto-credit. If any of these caps move
 * silently in the future (e.g. someone bumps the per-resolution cap to
 * $100 without thinking through the cumulative window), this file fails
 * the test suite.
 */
import { describe, it, expect } from "vitest";
import {
  SUPPORT_AUTO_RESOLVE_MAX_USD,
  SUPPORT_AUTO_RESOLVE_30D_MAX_USD,
  AUTO_RESOLVABLE_ISSUE_TYPES,
  ALL_ISSUE_TYPES,
  canAutoResolveSupport,
  suggestRefundAmount,
} from "./supportPolicy";

describe("support auto-resolve caps (post-supervisor review)", () => {
  it("per-resolution cap is $25 — bumping requires deliberate code change + this test update", () => {
    expect(SUPPORT_AUTO_RESOLVE_MAX_USD).toBe(25);
  });

  it("rolling-30d cumulative cap is $50 — same rule for changing it", () => {
    expect(SUPPORT_AUTO_RESOLVE_30D_MAX_USD).toBe(50);
  });

  it("the cumulative cap is greater than the per-resolution cap (otherwise riders get 1 credit max)", () => {
    expect(SUPPORT_AUTO_RESOLVE_30D_MAX_USD).toBeGreaterThan(SUPPORT_AUTO_RESOLVE_MAX_USD);
  });

  it("auto-resolvable types are a strict subset of all issue types — UI can't submit auto-credit for a manually-only type", () => {
    for (const t of Array.from(AUTO_RESOLVABLE_ISSUE_TYPES)) {
      expect(ALL_ISSUE_TYPES).toContain(t as (typeof ALL_ISSUE_TYPES)[number]);
    }
  });

  it("safety + driver_no_show + other are NOT auto-resolvable (those need humans)", () => {
    expect(AUTO_RESOLVABLE_ISSUE_TYPES.has("safety")).toBe(false);
    expect(AUTO_RESOLVABLE_ISSUE_TYPES.has("driver_no_show")).toBe(false);
    expect(AUTO_RESOLVABLE_ISSUE_TYPES.has("other")).toBe(false);
  });

  it("canAutoResolveSupport rejects unknown issue types", () => {
    expect(
      canAutoResolveSupport({ issueType: "made_up_type", requestedRefund: 5, rideFare: 20 }),
    ).toBe(false);
  });

  it("canAutoResolveSupport rejects when refund exceeds the per-resolution cap", () => {
    expect(
      canAutoResolveSupport({ issueType: "fare_dispute", requestedRefund: 26, rideFare: 100 }),
    ).toBe(false);
  });

  it("canAutoResolveSupport rejects when refund exceeds the ride fare (no over-refund)", () => {
    expect(
      canAutoResolveSupport({ issueType: "fare_dispute", requestedRefund: 15, rideFare: 10 }),
    ).toBe(false);
  });

  it("suggestRefundAmount caps duplicate_charge at the per-resolution cap, never above", () => {
    expect(suggestRefundAmount("duplicate_charge", 1000)).toBe(SUPPORT_AUTO_RESOLVE_MAX_USD);
    expect(suggestRefundAmount("duplicate_charge", 10)).toBe(10);
  });
});
