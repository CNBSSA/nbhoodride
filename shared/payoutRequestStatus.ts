/**
 * A driver's payout request moves one way only (code review 2026-10-06).
 *
 * The amount left the driver's balance when they asked, so the request is
 * money held on their behalf: `paid` means it was sent, `rejected` means it
 * went back to their balance. Neither may ever change again, or a rejected
 * request could later be marked paid (the driver paid twice, the refund
 * kept) and a paid one rejected (refunded after it was sent).
 */
export const PAYOUT_STATUSES = ["pending", "processing", "paid", "rejected"] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

/** The statuses an admin may move a request INTO, and from which. */
export const PAYOUT_TRANSITIONS: Record<"processing" | "paid" | "rejected", readonly PayoutStatus[]> = {
  processing: ["pending"],
  paid: ["pending", "processing"],
  rejected: ["pending", "processing"],
};

export function isPayoutTarget(status: unknown): status is keyof typeof PAYOUT_TRANSITIONS {
  return status === "processing" || status === "paid" || status === "rejected";
}

/** Which statuses a request may be in for a move to `to`. */
export function payoutFromStatuses(to: keyof typeof PAYOUT_TRANSITIONS): readonly PayoutStatus[] {
  return PAYOUT_TRANSITIONS[to];
}

/** Plain words for a move that is not allowed from where the request is. */
export function payoutTransitionRefusal(from: string | null | undefined, to: string): string {
  const current = from || "pending";
  if (current === "paid") return "This payout was already paid. It cannot be changed.";
  if (current === "rejected") return "This payout was already rejected and the money returned to the driver's balance. It cannot be changed.";
  if (current === to) return `This payout is already ${to}.`;
  return `A payout that is ${current} cannot be marked ${to}.`;
}
