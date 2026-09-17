import { describe, expect, it } from "vitest";
import { approvalText, approvalOf, describeApproval, heldJobExpired, isHeld, recipientNudgeDue, shopDecisionDue } from "./recipientApproval";

describe("a delivery the recipient must approve", () => {
  const now = new Date("2026-09-17T12:00:00Z");
  it("is held while awaiting or declined, and only then", () => {
    expect(isHeld({ recipientApproval: "awaiting" })).toBe(true);
    expect(isHeld({ recipientApproval: "declined" })).toBe(true);
    expect(isHeld({ recipientApproval: "approved" })).toBe(false);
    expect(isHeld({ recipientApproval: "none" })).toBe(false);
    expect(isHeld({ recipientApproval: null })).toBe(false);
    expect(isHeld({ recipientApproval: "expired" })).toBe(false);
  });
  it("reads an unknown state as nobody asked", () => {
    expect(approvalOf(undefined)).toBe("none");
    expect(approvalOf("paid")).toBe("none");
  });
  it("tells the desk where the answer stands", () => {
    expect(describeApproval({ recipientApproval: "none" })).toBeNull();
    expect(describeApproval({ recipientApproval: "awaiting" })).toMatch(/Awaiting/);
    expect(describeApproval({ recipientApproval: "approved" })).toBe("Approved by the recipient");
  });
  it("nudges once, fifteen minutes in, while unanswered", () => {
    const base = { recipientApproval: "awaiting", createdAt: new Date("2026-09-17T11:40:00Z") };
    expect(recipientNudgeDue(base, now)).toBe(true);
    expect(recipientNudgeDue({ ...base, createdAt: new Date("2026-09-17T11:50:00Z") }, now)).toBe(false);
    expect(recipientNudgeDue({ ...base, recipientNudgedAt: now }, now)).toBe(false);
    expect(recipientNudgeDue({ ...base, recipientApproval: "approved" }, now)).toBe(false);
  });
  it("asks the shop once the parcel is ready and nobody answered", () => {
    expect(shopDecisionDue({ recipientApproval: "awaiting", windowStart: new Date("2026-09-17T11:59:00Z") }, now)).toBe(true);
    expect(shopDecisionDue({ recipientApproval: "awaiting", windowStart: new Date("2026-09-17T12:01:00Z") }, now)).toBe(false);
    expect(shopDecisionDue({ recipientApproval: "awaiting", windowStart: new Date("2026-09-17T11:59:00Z"), shopAskedAt: now }, now)).toBe(false);
  });
  it("gives up a held job when its window closes", () => {
    expect(heldJobExpired({ recipientApproval: "awaiting", windowEnd: new Date("2026-09-17T11:59:00Z") }, now)).toBe(true);
    expect(heldJobExpired({ recipientApproval: "approved", windowEnd: new Date("2026-09-17T11:59:00Z") }, now)).toBe(false);
  });
  it("texts the recipient the shop, the fee and the link — never the goods", () => {
    const t = approvalText({ shopName: "Mama's Kitchen", fee: 11.8, windowText: "Ready 5:00 PM, deliver by 7:00 PM", link: "https://x/approve/abc" });
    expect(t).toMatch(/Mama's Kitchen adds to your bill/); expect(t).toMatch(/\$11\.80/); expect(t).toMatch(/https:\/\/x\/approve\/abc/);
  });
});
