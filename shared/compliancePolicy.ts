/** E2 — Compliance record status helpers. */

export type ComplianceStatus = "missing" | "on_file" | "expiring_soon" | "expired";
export type TaxCompliancePath = "path_a_stripe" | "path_b_tax1099" | "path_c_manual";

export const TAX_PATH_LABELS: Record<TaxCompliancePath, string> = {
  path_a_stripe: "Stripe Connect (W-9 + 1099)",
  path_b_tax1099: "Tax1099 API + own W-9 UI",
  path_c_manual: "Manual W-9 PDF + admin filing",
};

export function complianceStatusFromExpiry(
  expiresAt: Date | null | undefined,
  now = new Date(),
): ComplianceStatus {
  if (!expiresAt) return "missing";
  const ms = expiresAt.getTime() - now.getTime();
  const days = ms / (24 * 60 * 60 * 1000);
  if (days < 0) return "expired";
  if (days <= 30) return "expiring_soon";
  return "on_file";
}

export function shouldBlockDriving(status: ComplianceStatus): boolean {
  return status === "expired" || status === "missing";
}
