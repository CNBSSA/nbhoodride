/**
 * Year-to-date payouts for 1099 reporting (issue #33, AH-060 #4).
 *
 * PG Ride pays people three ways, all by hand today: drivers and private car
 * owners through `payout_requests` (Zelle, CashApp, PayPal, check — there is
 * no Stripe Connect, so Stripe files nothing for them), and fleets through
 * `fleet_payouts`. A 1099-NEC reports what was PAID in a calendar year, so
 * this counts payouts marked paid (or a fleet's marked sent) inside the year,
 * and shows what is asked for but not yet paid beside it.
 *
 * The threshold is the federal one for payments made in that year. It was
 * $600 through 2025; the 2025 tax law raised it to $2,000 for payments made
 * from 2026 (to be indexed for inflation later). Festus's CPA confirms the
 * figure and decides who is exempt (a fleet that is a corporation, say);
 * this report only shows who crossed it.
 */

export const TAX_REPORTING_TIMEZONE = "America/New_York";
export const EARLIEST_TAX_YEAR = 2024;

/** The 1099-NEC reporting threshold for payments made in `year`, in dollars. */
export function reportingThreshold(year: number): number {
  return year >= 2026 ? 2000 : 600;
}

/**
 * The instants a tax year runs between, as UTC. PG Ride is in Maryland, so a
 * year starts at midnight Eastern on 1 January — always EST (UTC-5), since
 * daylight time never runs in January.
 */
export function taxYearWindow(year: number): { from: Date; to: Date } {
  return {
    from: new Date(Date.UTC(year, 0, 1, 5)),
    to: new Date(Date.UTC(year + 1, 0, 1, 5)),
  };
}

/** The current tax year in Eastern time. */
export function currentTaxYear(now: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: TAX_REPORTING_TIMEZONE, year: "numeric" }).format(now));
}

/** A year asked for, or null when it is not one this report covers. */
export function parseTaxYear(raw: unknown, now: Date = new Date()): number | null {
  if (raw === undefined || raw === null || raw === "") return currentTaxYear(now);
  const s = String(raw).trim();
  if (!/^\d{4}$/.test(s)) return null;
  const y = Number(s);
  return y >= EARLIEST_TAX_YEAR && y <= currentTaxYear(now) ? y : null;
}

export type PayeeKind = "driver" | "car_owner" | "fleet";

/** Where a payee stands against the year's threshold. */
export function thresholdStatus(paid: number, pending: number, threshold: number): "over" | "near" | "under" {
  if (paid >= threshold) return "over";
  if (paid + pending >= threshold || paid >= threshold * 0.75) return "near";
  return "under";
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // A leading = + - @ would be read as a formula by a spreadsheet.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export interface YtdPayeeRow {
  name: string; email: string | null; kind: PayeeKind; legalName?: string | null; ein?: string | null;
  businessType?: string | null; methods: string[]; paid: number; pending: number; payouts: number; status: string;
}

/** The report as CSV, for the CPA. */
export function ytdCsv(year: number, rows: YtdPayeeRow[]): string {
  const head = ["Year", "Payee", "Email", "Kind", "Legal name", "EIN (masked)", "Business type", "Paid in year", "Asked for, not yet paid", "Payouts", "Methods", "Against threshold"];
  const lines = rows.map((r) => [year, r.name, r.email, r.kind, r.legalName, r.ein, r.businessType, r.paid.toFixed(2), r.pending.toFixed(2), r.payouts, r.methods.join(" / "), r.status].map(csvCell).join(","));
  return [head.join(","), ...lines].join("\n") + "\n";
}
