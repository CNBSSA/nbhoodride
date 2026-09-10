/**
 * Commercial riders — the pure rules.
 *
 * A commercial rider is an organization (a dialysis center, a law office, a
 * restaurant) that books rides and deliveries for other people and is billed
 * for them, instead of a person paying by card at the end of a ride. The
 * business places every order; the person served never holds an account and
 * never pays PG Ride.
 *
 * What lives here is shared by the server (booking, statements, paging) and
 * the admin console, and is unit-tested without a database: categories and
 * roles, what each role may do, the facility fee per category, how a job is
 * totalled, how a month's statement is summed and rendered as CSV, and what
 * an at-risk commercial job is allowed to say in a Telegram page (the
 * account and the job number, never the passenger).
 */

import { PLAN_TIMEZONE, zonedDateTime, zonedParts } from "./weeklyPlan";

export const COMMERCIAL_CATEGORIES = ["medical", "business", "food"] as const;
export type CommercialCategory = (typeof COMMERCIAL_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<CommercialCategory, string> = {
  medical: "Medical transportation",
  business: "Business deliveries",
  food: "Food deliveries",
};

/** What the organization is charged on top of the fare, per job, by default. */
export const DEFAULT_FACILITY_FEE: Record<CommercialCategory, number> = {
  medical: 4,
  business: 0,
  food: 0,
};

export const ORG_ROLES = ["owner", "requester", "billing"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const ORG_STATUSES = ["active", "paused"] as const;
export type OrgStatus = (typeof ORG_STATUSES)[number];

export const BILLING_MODES = ["weekly_debit", "net_terms"] as const;
export type BillingMode = (typeof BILLING_MODES)[number];

export const isCategory = (v: unknown): v is CommercialCategory => COMMERCIAL_CATEGORIES.includes(v as CommercialCategory);
export const isOrgRole = (v: unknown): v is OrgRole => ORG_ROLES.includes(v as OrgRole);

/** Owners and requesters book; billing sees money; owners do everything. */
export function canBook(role: OrgRole | null | undefined): boolean {
  return role === "owner" || role === "requester";
}
export function canSeeStatement(role: OrgRole | null | undefined): boolean {
  return role === "owner" || role === "billing";
}
export function canManageMembers(role: OrgRole | null | undefined): boolean {
  return role === "owner";
}

/** "J-00042": stable, short, safe to say aloud on a phone. */
export function formatJobNumber(n: number | string): string {
  return `J-${String(n).padStart(5, "0")}`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: number | string | null | undefined): number => {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

export interface JobCharges {
  fare: number | string | null | undefined;
  facilityFee?: number | string | null;
  waitFee?: number | string | null;
  cancellationFee?: number | string | null;
}

/** What a completed job costs the organization; a cancelled job is only its cancellation fee. */
export function jobTotal(status: string, c: JobCharges): number {
  if (status === "completed") return round2(num(c.fare) + num(c.facilityFee) + num(c.waitFee));
  if (status === "cancelled" || status === "no_show") return round2(num(c.cancellationFee));
  return 0;
}

export interface StatementLine extends JobCharges {
  jobNumber: number | string;
  /** Service time, ISO. */
  at: string;
  passenger: string;
  from: string;
  to: string;
  status: string;
}

export interface StatementTotals {
  jobs: number;
  completed: number;
  cancelled: number;
  fares: number;
  facilityFees: number;
  waitFees: number;
  cancellationFees: number;
  total: number;
}

export function statementTotals(lines: StatementLine[]): StatementTotals {
  const t: StatementTotals = { jobs: lines.length, completed: 0, cancelled: 0, fares: 0, facilityFees: 0, waitFees: 0, cancellationFees: 0, total: 0 };
  for (const l of lines) {
    if (l.status === "completed") {
      t.completed += 1;
      t.fares += num(l.fare);
      t.facilityFees += num(l.facilityFee);
      t.waitFees += num(l.waitFee);
    } else if (l.status === "cancelled" || l.status === "no_show") {
      t.cancelled += 1;
      t.cancellationFees += num(l.cancellationFee);
    }
    t.total += jobTotal(l.status, l);
  }
  for (const k of ["fares", "facilityFees", "waitFees", "cancellationFees", "total"] as const) t[k] = round2(t[k]);
  return t;
}

export interface StatementWindow {
  monthKey: string;
  label: string;
  start: Date;
  end: Date;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The Eastern calendar month "YYYY-MM" as an instant range. */
export function statementMonthWindow(monthKey: string, timeZone: string = PLAN_TIMEZONE): StatementWindow {
  const m = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!m) throw new Error("month must be YYYY-MM");
  const y = Number(m[1]), mo = Number(m[2]);
  if (mo < 1 || mo > 12) throw new Error("month must be 01..12");
  const start = zonedDateTime(y, mo, 1, 0, 0, timeZone);
  const end = mo === 12 ? zonedDateTime(y + 1, 1, 1, 0, 0, timeZone) : zonedDateTime(y, mo + 1, 1, 0, 0, timeZone);
  return { monthKey, label: `${MONTHS[mo - 1]} ${y}`, start, end };
}

/** The current Eastern month as "YYYY-MM". */
export function currentMonthKey(now: Date = new Date(), timeZone: string = PLAN_TIMEZONE): string {
  const p = zonedParts(now, timeZone);
  return `${p.y}-${String(p.m).padStart(2, "0")}`;
}

/**
 * One CSV cell. Text that starts like a formula (=, +, -, @, tab) is prefixed
 * with an apostrophe so a spreadsheet shows it instead of running it: names
 * and addresses on a statement are typed by requesters, not by us.
 */
const csvCell = (v: unknown): string => {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const money = (n: number) => n.toFixed(2);

/** A statement as CSV: one header, one line per job, one totals line. */
export function statementCsv(orgName: string, window: StatementWindow, lines: StatementLine[]): string {
  const rows: string[][] = [
    ["Job", "Date", "Passenger", "From", "To", "Status", "Fare", "Facility fee", "Waiting", "Cancellation fee", "Total"],
  ];
  for (const l of lines) {
    rows.push([
      formatJobNumber(l.jobNumber), l.at, l.passenger, l.from, l.to, l.status,
      money(l.status === "completed" ? num(l.fare) : 0), money(l.status === "completed" ? num(l.facilityFee) : 0),
      money(l.status === "completed" ? num(l.waitFee) : 0), money(l.status === "completed" ? 0 : num(l.cancellationFee)),
      money(jobTotal(l.status, l)),
    ]);
  }
  const t = statementTotals(lines);
  rows.push(["Total", window.label, orgName, "", "", `${t.completed} completed, ${t.cancelled} cancelled`, money(t.fares), money(t.facilityFees), money(t.waitFees), money(t.cancellationFees), money(t.total)]);
  return rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

/**
 * What an at-risk commercial job may say in a Telegram page. The account and
 * the job number identify it to the operator; the passenger's name and phone
 * never leave the app.
 */
export function commercialPagingFields(job: { orgName: string; jobNumber: number | string; category?: string | null }): Array<[string, string]> {
  const out: Array<[string, string]> = [["Account", job.orgName], ["Job", formatJobNumber(job.jobNumber)]];
  if (job.category && isCategory(job.category)) out.push(["Work", CATEGORY_LABELS[job.category]]);
  return out;
}
