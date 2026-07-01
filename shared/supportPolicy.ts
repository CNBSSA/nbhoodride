/** E1 — Support auto-resolve policy (≤$25 per resolution, ≤$50 per rider per 30 days). */

export const SUPPORT_AUTO_RESOLVE_MAX_USD = 25;
/**
 * Cumulative cap on auto-credit per reporter within a rolling 30-day window.
 * Without this, a rider could re-file disputes against the same or different
 * rides to repeatedly extract the $25 single-resolution cap with no human
 * review. Anything above this rolls into manual-review even if individual
 * caps would have passed.
 */
export const SUPPORT_AUTO_RESOLVE_30D_MAX_USD = 50;

/** Every issueType the client may submit. Anything else → 400. */
export const ALL_ISSUE_TYPES = [
  "fare_dispute",
  "short_wait",
  "wrong_route",
  "lost_item_minor",
  "promo_not_applied",
  "duplicate_charge",
  "driver_no_show",
  "safety",
  "other",
] as const;
export type IssueType = (typeof ALL_ISSUE_TYPES)[number];

export const AUTO_RESOLVABLE_ISSUE_TYPES = new Set([
  "fare_dispute",
  "short_wait",
  "wrong_route",
  "lost_item_minor",
  "promo_not_applied",
  "duplicate_charge",
]);

export function canAutoResolveSupport(opts: {
  issueType: string;
  requestedRefund: number;
  rideFare?: number;
}): boolean {
  if (!AUTO_RESOLVABLE_ISSUE_TYPES.has(opts.issueType)) return false;
  const cap = Math.min(
    SUPPORT_AUTO_RESOLVE_MAX_USD,
    opts.rideFare != null ? opts.rideFare : SUPPORT_AUTO_RESOLVE_MAX_USD,
  );
  return opts.requestedRefund > 0 && opts.requestedRefund <= cap;
}

export function suggestRefundAmount(issueType: string, rideFare: number): number {
  if (issueType === "promo_not_applied") return Math.min(5, rideFare);
  if (issueType === "short_wait") return Math.min(3, rideFare);
  if (issueType === "duplicate_charge") return Math.min(rideFare, SUPPORT_AUTO_RESOLVE_MAX_USD);
  return Math.min(Math.round(rideFare * 0.25 * 100) / 100, SUPPORT_AUTO_RESOLVE_MAX_USD);
}
