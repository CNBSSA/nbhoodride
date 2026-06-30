/** E1 — Support auto-resolve policy (≤$25). */

export const SUPPORT_AUTO_RESOLVE_MAX_USD = 25;

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
