import { describe, expect, it } from "vitest";
import { chargeAttemptKey, settlementDecision } from "./billingCycle";

describe("chargeAttemptKey", () => {
  it("is one key per attempt, so a retry after a failure is a new request and a retry of an unfinished one is the same", () => {
    expect(chargeAttemptKey("st1", 1)).toBe("commercial-statement-st1-attempt-1");
    expect(chargeAttemptKey("st1", 2)).not.toBe(chargeAttemptKey("st1", 1));
    expect(chargeAttemptKey("st1", 2)).toBe(chargeAttemptKey("st1", 2));
  });
});

describe("settlementDecision", () => {
  const charging = { status: "charging", stripePaymentIntentId: "pi_current" };

  it("applies a success or failure about the statement's current attempt", () => {
    expect(settlementDecision(charging, { id: "pi_current", status: "succeeded" })).toMatchObject({ action: "paid", adopts: false });
    expect(settlementDecision(charging, { id: "pi_current", status: "requires_payment_method" })).toMatchObject({ action: "failed", adopts: false });
    expect(settlementDecision(charging, { id: "pi_current", status: "canceled" })).toMatchObject({ action: "failed", adopts: false });
  });

  it("leaves a debit still clearing alone", () => {
    expect(settlementDecision(charging, { id: "pi_current", status: "processing" }).action).toBe("undecided");
    expect(settlementDecision(charging, { id: "pi_current", status: "requires_action" }).action).toBe("undecided");
  });

  it("ignores an event about a superseded attempt, whatever it says", () => {
    const stale = settlementDecision(charging, { id: "pi_old", status: "succeeded" });
    expect(stale.action).toBe("ignore");
    expect(stale.reason).toMatch(/pi_old/);
    expect(settlementDecision(charging, { id: "pi_old", status: "requires_payment_method" }).action).toBe("ignore");
  });

  it("never moves a statement that is already paid or void", () => {
    expect(settlementDecision({ status: "paid", stripePaymentIntentId: "pi_current" }, { id: "pi_current", status: "requires_payment_method" }).action).toBe("ignore");
    expect(settlementDecision({ status: "void", stripePaymentIntentId: null }, { id: "pi_x", status: "succeeded" }).action).toBe("ignore");
  });

  it("adopts the intent when the statement has none recorded: the request died before the id came back", () => {
    const d = settlementDecision({ status: "charging", stripePaymentIntentId: null }, { id: "pi_new", status: "succeeded" });
    expect(d).toMatchObject({ action: "paid", adopts: true });
    expect(settlementDecision({ status: "failed", stripePaymentIntentId: null }, { id: "pi_new", status: "processing" })).toMatchObject({ action: "undecided", adopts: true });
  });

  it("never adopts an earlier attempt's failure as the answer to the open attempt (code review 2026-10-06)", () => {
    const open = { status: "charging", stripePaymentIntentId: null, attempts: 2 };
    expect(settlementDecision(open, { id: "pi_1", status: "requires_payment_method", metadata: { attempt: "1" } }).action).toBe("ignore");
    expect(settlementDecision(open, { id: "pi_2", status: "processing", metadata: { attempt: "2" } })).toMatchObject({ action: "undecided", adopts: true });
    expect(settlementDecision(open, { id: "pi_2", status: "requires_payment_method", metadata: { attempt: "2" } })).toMatchObject({ action: "failed", adopts: true });
    // A debit that did go through is never ignored, whichever attempt raised it.
    expect(settlementDecision(open, { id: "pi_1", status: "succeeded", metadata: { attempt: "1" } })).toMatchObject({ action: "paid" });
    // From before attempts were numbered: no attempt on the intent, adopted as before.
    expect(settlementDecision(open, { id: "pi_x", status: "requires_payment_method" }).action).toBe("failed");
  });
});
