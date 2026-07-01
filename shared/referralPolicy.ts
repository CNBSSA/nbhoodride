/** Community referral credit rules (C4 / growth lane). */

export const DEFAULT_REFERRAL_CREDIT = 5;

export const REFERRAL_CREDIT_REASONS = {
  referrer: "referral_credit_referrer",
  redeemer: "referral_credit_redeemed",
} as const;

/** Parse stored decimal credit_amount; falls back to default. */
export function parseReferralCreditAmount(value: string | null | undefined): number {
  if (!value) return DEFAULT_REFERRAL_CREDIT;
  const parsed = parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100) {
    return DEFAULT_REFERRAL_CREDIT;
  }
  return Number(parsed.toFixed(2));
}
