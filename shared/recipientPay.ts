/**
 * Recipient pays — the delivery fee goes to the person receiving the parcel,
 * not the shop that sent it (Festus, 2026-09-16: an African food shop will
 * offer delivery but will not carry its cost).
 *
 * The shop books the delivery with the recipient's phone. The job is HELD:
 * it is not on the claim board and no driver is asked, until the recipient
 * has paid the fee from a text with a link. "Approved" means paid, because
 * the recipient holds no account and cannot be billed later. Nothing here
 * touches the food price; PG Ride collects the delivery fee only.
 *
 * Defaults taken 2026-09-17 (not yet confirmed by Festus): the recipient
 * pays the tariff as is, with no service fee; a held job waits until its
 * ready time, with one nudge to the recipient after 15 minutes; a shop may
 * set recipient-pays as its default.
 */

export const PAYERS = ["organization", "recipient"] as const;
export type Payer = (typeof PAYERS)[number];
export const isPayer = (v: unknown): v is Payer => PAYERS.includes(v as Payer);
export const payerOf = (v: unknown): Payer => (isPayer(v) ? v : "organization");

export const RECIPIENT_PAY_STATES = ["awaiting", "paid", "declined", "refunded", "refund_pending", "expired"] as const;
export type RecipientPayState = (typeof RECIPIENT_PAY_STATES)[number];

/** One nudge to a recipient who has not paid, this long after the text. */
export const RECIPIENT_NUDGE_MINUTES = 15;

export interface RecipientPayJob {
  payer?: string | null;
  recipientPaymentStatus?: string | null;
}

/** Held: booked, but not released to drivers until the recipient pays. */
export function isHeld(job: RecipientPayJob): boolean {
  return payerOf(job.payer) === "recipient" && job.recipientPaymentStatus !== "paid";
}

export function paidByRecipient(job: RecipientPayJob): boolean {
  return payerOf(job.payer) === "recipient" && job.recipientPaymentStatus === "paid";
}

/** What the desk reads on the job row; null for an ordinary account-paid job. */
export function describePayer(job: RecipientPayJob): string | null {
  if (payerOf(job.payer) !== "recipient") return null;
  switch (job.recipientPaymentStatus) {
    case "awaiting": return "Awaiting the recipient's payment";
    case "paid": return "Paid by the recipient";
    case "declined": return "The recipient declined";
    case "refunded": return "Refunded to the recipient";
    case "refund_pending": return "Refund to the recipient pending";
    case "expired": return "Not paid in time";
    default: return "Recipient pays";
  }
}

/** What a Stripe intent status means for a held job. */
export function recipientPayStateFromIntent(status: string | null | undefined): "paid" | "failed" | null {
  if (status === "succeeded") return "paid";
  if (status === "canceled" || status === "requires_payment_method") return "failed";
  return null;
}

/** When the sweep nudges: once, this long after booking, still unpaid. */
export function recipientNudgeDue(job: RecipientPayJob & { createdAt: Date | string; recipientNudgedAt?: Date | string | null }, now: Date = new Date()): boolean {
  if (!isHeld(job) || job.recipientPaymentStatus !== "awaiting" || job.recipientNudgedAt) return false;
  return now.getTime() - new Date(job.createdAt).getTime() >= RECIPIENT_NUDGE_MINUTES * 60_000;
}

/** When the shop is asked to decide: the parcel is ready and nobody has paid. */
export function shopDecisionDue(job: RecipientPayJob & { windowStart?: Date | string | null; shopAskedAt?: Date | string | null }, now: Date = new Date()): boolean {
  if (!isHeld(job) || job.recipientPaymentStatus !== "awaiting" || job.shopAskedAt || !job.windowStart) return false;
  return new Date(job.windowStart).getTime() <= now.getTime();
}

/** When a held job is given up: the window has closed and nobody paid. */
export function heldJobExpired(job: RecipientPayJob & { windowEnd?: Date | string | null }, now: Date = new Date()): boolean {
  if (!isHeld(job) || !job.windowEnd) return false;
  return new Date(job.windowEnd).getTime() <= now.getTime();
}

const money = (n: number | string) => `$${Number(n).toFixed(2)}`;

export function recipientPayText(p: { shopName: string; fee: number | string; windowText: string | null; link: string }): string {
  return `${p.shopName} is sending you an order by PG Ride. Delivery is ${money(p.fee)}${p.windowText ? `, ${p.windowText.toLowerCase()}` : ""}. Approve and pay here: ${p.link}`;
}
export function recipientNudgeText(p: { shopName: string; fee: number | string; link: string }): string {
  return `Reminder: ${p.shopName}'s delivery (${money(p.fee)}) is waiting for your approval. Pay here: ${p.link} — or reply to the shop if you no longer want it.`;
}
export function recipientPaidText(p: { shopName: string; jobLabel: string }): string {
  return `Paid, thank you. A PG Ride driver will bring your order from ${p.shopName} (${p.jobLabel}). You will get a text when it is on its way.`;
}
export function shopPaidText(p: { recipientName: string; jobLabel: string; fee: number | string }): string {
  return `PG Ride: ${p.recipientName} paid ${money(p.fee)} for delivery ${p.jobLabel}. It is now open for a driver.`;
}
export function shopDeclinedText(p: { recipientName: string; jobLabel: string }): string {
  return `PG Ride: ${p.recipientName} declined to pay for delivery ${p.jobLabel}. Open your desk to pay it yourself or cancel it.`;
}
export function shopDecisionText(p: { recipientName: string; jobLabel: string }): string {
  return `PG Ride: delivery ${p.jobLabel} is ready but ${p.recipientName} has not paid. Open your desk to pay it yourself or cancel it.`;
}
export function recipientRefundedText(p: { shopName: string; fee: number | string }): string {
  return `PG Ride: your ${money(p.fee)} delivery fee for the order from ${p.shopName} has been refunded. Nothing more to do.`;
}
export function recipientExpiredText(p: { shopName: string }): string {
  return `PG Ride: the delivery window for your order from ${p.shopName} has passed without payment, so it was not sent. Contact the shop if you still want it.`;
}
