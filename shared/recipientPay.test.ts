import { describe, expect, it } from "vitest";
import { describePayer, heldJobExpired, isHeld, paidByRecipient, payerOf, recipientNudgeDue, recipientPayStateFromIntent, recipientPayText, shopDecisionDue } from "./recipientPay";

describe("a job the recipient pays for", () => {
  const now = new Date("2026-09-17T12:00:00Z");
  it("is held until paid, and only then", () => {
    expect(isHeld({ payer: "recipient", recipientPaymentStatus: "awaiting" })).toBe(true);
    expect(isHeld({ payer: "recipient", recipientPaymentStatus: "declined" })).toBe(true);
    expect(isHeld({ payer: "recipient", recipientPaymentStatus: "paid" })).toBe(false);
    expect(isHeld({ payer: "organization" })).toBe(false);
    expect(isHeld({ payer: null })).toBe(false);
  });
  it("is paid by the recipient only when it says so", () => {
    expect(paidByRecipient({ payer: "recipient", recipientPaymentStatus: "paid" })).toBe(true);
    expect(paidByRecipient({ payer: "organization", recipientPaymentStatus: "paid" })).toBe(false);
  });
  it("defaults the payer to the organization", () => {
    expect(payerOf(undefined)).toBe("organization");
    expect(payerOf("recipient")).toBe("recipient");
    expect(payerOf("mum")).toBe("organization");
  });
  it("tells the desk where the money stands", () => {
    expect(describePayer({ payer: "organization" })).toBeNull();
    expect(describePayer({ payer: "recipient", recipientPaymentStatus: "awaiting" })).toMatch(/Awaiting/);
    expect(describePayer({ payer: "recipient", recipientPaymentStatus: "paid" })).toBe("Paid by the recipient");
  });
  it("reads a Stripe intent the same way statements do", () => {
    expect(recipientPayStateFromIntent("succeeded")).toBe("paid");
    expect(recipientPayStateFromIntent("requires_payment_method")).toBe("failed");
    expect(recipientPayStateFromIntent("processing")).toBeNull();
  });
  it("nudges once, fifteen minutes in, while unpaid", () => {
    const base = { payer: "recipient", recipientPaymentStatus: "awaiting", createdAt: new Date("2026-09-17T11:40:00Z") };
    expect(recipientNudgeDue(base, now)).toBe(true);
    expect(recipientNudgeDue({ ...base, createdAt: new Date("2026-09-17T11:50:00Z") }, now)).toBe(false);
    expect(recipientNudgeDue({ ...base, recipientNudgedAt: now }, now)).toBe(false);
    expect(recipientNudgeDue({ ...base, recipientPaymentStatus: "paid" }, now)).toBe(false);
  });
  it("asks the shop to decide once the parcel is ready and nobody paid", () => {
    expect(shopDecisionDue({ payer: "recipient", recipientPaymentStatus: "awaiting", windowStart: new Date("2026-09-17T11:59:00Z") }, now)).toBe(true);
    expect(shopDecisionDue({ payer: "recipient", recipientPaymentStatus: "awaiting", windowStart: new Date("2026-09-17T12:01:00Z") }, now)).toBe(false);
    expect(shopDecisionDue({ payer: "recipient", recipientPaymentStatus: "awaiting", windowStart: new Date("2026-09-17T11:59:00Z"), shopAskedAt: now }, now)).toBe(false);
  });
  it("gives up a held job when its window closes", () => {
    expect(heldJobExpired({ payer: "recipient", recipientPaymentStatus: "awaiting", windowEnd: new Date("2026-09-17T11:59:00Z") }, now)).toBe(true);
    expect(heldJobExpired({ payer: "recipient", recipientPaymentStatus: "paid", windowEnd: new Date("2026-09-17T11:59:00Z") }, now)).toBe(false);
  });
  it("texts the recipient the shop, the fee and the link — never the food price", () => {
    const t = recipientPayText({ shopName: "Mama's Kitchen", fee: 11.8, windowText: "Ready 5:00 PM, deliver by 7:00 PM", link: "https://x/pay/abc" });
    expect(t).toMatch(/Mama's Kitchen/); expect(t).toMatch(/\$11\.80/); expect(t).toMatch(/https:\/\/x\/pay\/abc/);
  });
});
