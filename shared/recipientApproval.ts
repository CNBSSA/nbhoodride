/**
 * Recipient approval — the shop passes the delivery cost on to its customer
 * and wants the customer's yes before the parcel is sent (Festus,
 * 2026-09-17: "the recipient has to approve"; the shop always pays PG Ride
 * and collects from the customer itself).
 *
 * The shop books the delivery with the recipient's phone and asks for
 * approval. The job is HELD — not on the claim board, no driver asked —
 * until the recipient approves from a text with a link, or the shop sends
 * it anyway. No money moves here: the fee stays on the shop's statement
 * exactly as for any delivery, and nothing about the goods is shown.
 *
 * Defaults taken 2026-09-17: a held job waits until its ready time, with one
 * nudge to the recipient after 15 minutes; a shop may make "ask first" its
 * default.
 */

export const APPROVAL_STATES = ["none", "awaiting", "approved", "declined", "expired", "cancelled"] as const;
export type ApprovalState = (typeof APPROVAL_STATES)[number];
export const approvalOf = (v: unknown): ApprovalState => (APPROVAL_STATES.includes(v as ApprovalState) ? (v as ApprovalState) : "none");

/** One nudge to a recipient who has not answered, this long after the text. */
export const RECIPIENT_NUDGE_MINUTES = 15;

export interface ApprovalJob { recipientApproval?: string | null }

/** Held: booked, but not released to drivers until the recipient approves or the shop sends it anyway. */
export function isHeld(job: ApprovalJob): boolean {
  const s = approvalOf(job.recipientApproval);
  return s === "awaiting" || s === "declined";
}

/** The link can still be answered. */
export function isOpenForAnswer(job: ApprovalJob): boolean {
  return isHeld(job);
}

/** What the desk reads on the job row; null when nobody was asked. */
export function describeApproval(job: ApprovalJob): string | null {
  switch (approvalOf(job.recipientApproval)) {
    case "awaiting": return "Awaiting the recipient's approval";
    case "approved": return "Approved by the recipient";
    case "declined": return "The recipient declined";
    case "expired": return "Not approved in time";
    case "cancelled": return "Cancelled before approval";
    default: return null;
  }
}

export function recipientNudgeDue(job: ApprovalJob & { createdAt: Date | string; recipientNudgedAt?: Date | string | null }, now: Date = new Date()): boolean {
  if (approvalOf(job.recipientApproval) !== "awaiting" || job.recipientNudgedAt) return false;
  return now.getTime() - new Date(job.createdAt).getTime() >= RECIPIENT_NUDGE_MINUTES * 60_000;
}

export function shopDecisionDue(job: ApprovalJob & { windowStart?: Date | string | null; shopAskedAt?: Date | string | null }, now: Date = new Date()): boolean {
  if (!isHeld(job) || job.shopAskedAt || !job.windowStart) return false;
  return new Date(job.windowStart).getTime() <= now.getTime();
}

export function heldJobExpired(job: ApprovalJob & { windowEnd?: Date | string | null }, now: Date = new Date()): boolean {
  if (!isHeld(job) || !job.windowEnd) return false;
  return new Date(job.windowEnd).getTime() <= now.getTime();
}

const money = (n: number | string) => `$${Number(n).toFixed(2)}`;

export function approvalText(p: { shopName: string; fee: number | string; windowText: string | null; link: string }): string {
  return `${p.shopName} is sending you an order by PG Ride. Delivery is ${money(p.fee)}, which ${p.shopName} adds to your bill${p.windowText ? `; ${p.windowText.toLowerCase()}` : ""}. Approve here: ${p.link}`;
}
export function nudgeText(p: { shopName: string; fee: number | string; link: string }): string {
  return `Reminder: ${p.shopName}'s delivery (${money(p.fee)}) is waiting for your approval: ${p.link} — or tell the shop if you no longer want it.`;
}
export function recipientApprovedText(p: { shopName: string; jobLabel: string }): string {
  return `Thank you. A PG Ride driver will bring your order from ${p.shopName} (${p.jobLabel}). You will get a text when it is on its way.`;
}
export function shopApprovedText(p: { recipientName: string; jobLabel: string }): string {
  return `PG Ride: ${p.recipientName} approved the delivery fee for ${p.jobLabel}. It is now open for a driver.`;
}
export function shopDeclinedText(p: { recipientName: string; jobLabel: string }): string {
  return `PG Ride: ${p.recipientName} declined the delivery fee for ${p.jobLabel}. Open your desk to send it anyway or cancel it.`;
}
export function shopDecisionText(p: { recipientName: string; jobLabel: string }): string {
  return `PG Ride: delivery ${p.jobLabel} is ready but ${p.recipientName} has not approved the fee. Open your desk to send it anyway or cancel it.`;
}
export function recipientExpiredText(p: { shopName: string }): string {
  return `PG Ride: the delivery window for your order from ${p.shopName} has passed without your approval, so it was not sent. Contact the shop if you still want it.`;
}
