/**
 * Admin → Reports → Payouts this year (issue #33, AH-060 #4): who PG Ride has
 * paid in a tax year and who has crossed the 1099-NEC threshold, so nobody
 * finds out in January. Rules and words in shared/taxReporting.ts.
 *
 * Read-only and admin-only. Where a payout was to be sent (an account number,
 * a phone, an address) never leaves the server; only the method does, and a
 * fleet's EIN is masked.
 */
import { sql } from "drizzle-orm";
import { db } from "./db";
import { maskEin } from "@shared/fleet";
import {
  currentTaxYear, parseTaxYear, reportingThreshold, taxYearWindow, thresholdStatus,
  type PayeeKind, type YtdPayeeRow,
} from "@shared/taxReporting";

export class TaxReportError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : r?.rows ?? []);
const money = (v: unknown) => Math.round(Number(v ?? 0) * 100) / 100;

export interface YtdReport {
  year: number;
  threshold: number;
  from: string;
  to: string;
  payees: (YtdPayeeRow & { id: string })[];
  totals: { paid: number; pending: number; payees: number; over: number; near: number };
  w9Collected: boolean;
}

export async function yearToDatePayouts(rawYear: unknown, now: Date = new Date()): Promise<YtdReport> {
  const year = parseTaxYear(rawYear, now);
  if (year === null) throw new TaxReportError(`Choose a year from 2024 to ${currentTaxYear(now)}.`);
  const { from, to } = taxYearWindow(year);
  const threshold = reportingThreshold(year);
  // What is asked for but not yet paid only matters for the year still running.
  const withPending = year === currentTaxYear(now);

  const people = rowsOf(await db.execute(sql`
    SELECT u.id, u.first_name, u.last_name, u.email,
           EXISTS (SELECT 1 FROM driver_profiles d WHERE d.user_id = u.id) AS is_driver,
           EXISTS (SELECT 1 FROM rental_owner_profiles o WHERE o.user_id = u.id) AS is_owner,
           COALESCE(SUM(CAST(pr.amount AS numeric)) FILTER (
             WHERE pr.status = 'paid' AND COALESCE(pr.processed_at, pr.updated_at) >= ${from} AND COALESCE(pr.processed_at, pr.updated_at) < ${to}), 0) AS paid,
           COUNT(*) FILTER (
             WHERE pr.status = 'paid' AND COALESCE(pr.processed_at, pr.updated_at) >= ${from} AND COALESCE(pr.processed_at, pr.updated_at) < ${to})::int AS payouts,
           COALESCE(SUM(CAST(pr.amount AS numeric)) FILTER (
             WHERE ${withPending}::boolean AND pr.status IN ('pending', 'processing')), 0) AS pending,
           array_remove(array_agg(DISTINCT pr.payout_method) FILTER (
             WHERE pr.status = 'paid' AND COALESCE(pr.processed_at, pr.updated_at) >= ${from} AND COALESCE(pr.processed_at, pr.updated_at) < ${to}), NULL) AS methods
    FROM payout_requests pr JOIN users u ON u.id = pr.driver_id
    GROUP BY u.id`));

  const fleets = rowsOf(await db.execute(sql`
    SELECT o.id, o.name, o.fleet_details,
           COALESCE(SUM(CAST(fp.amount AS numeric)) FILTER (
             WHERE fp.status = 'sent' AND fp.sent_at >= ${from} AND fp.sent_at < ${to}), 0) AS paid,
           COUNT(*) FILTER (WHERE fp.status = 'sent' AND fp.sent_at >= ${from} AND fp.sent_at < ${to})::int AS payouts,
           COALESCE(SUM(CAST(fp.amount AS numeric)) FILTER (WHERE ${withPending}::boolean AND fp.status = 'requested'), 0) AS pending,
           array_remove(array_agg(DISTINCT fp.payout_method) FILTER (
             WHERE fp.status = 'sent' AND fp.sent_at >= ${from} AND fp.sent_at < ${to}), NULL) AS methods
    FROM fleet_payouts fp JOIN organizations o ON o.id = fp.organization_id
    GROUP BY o.id`));

  const payees: YtdReport["payees"] = [];
  for (const p of people) {
    const paid = money(p.paid), pending = money(p.pending);
    if (paid <= 0 && pending <= 0) continue;
    const kind: PayeeKind = p.is_driver ? "driver" : p.is_owner ? "car_owner" : "driver";
    payees.push({
      id: p.id, kind, name: `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "(no name)", email: p.email ?? null,
      methods: p.methods ?? [], paid, pending, payouts: Number(p.payouts), status: thresholdStatus(paid, pending, threshold),
    });
  }
  for (const f of fleets) {
    const paid = money(f.paid), pending = money(f.pending);
    if (paid <= 0 && pending <= 0) continue;
    const d = f.fleet_details ?? {};
    payees.push({
      id: f.id, kind: "fleet", name: f.name, email: null, legalName: d.legalName ?? null,
      ein: d.ein ? maskEin(d.ein) : null, businessType: d.businessType ?? null,
      methods: f.methods ?? [], paid, pending, payouts: Number(f.payouts), status: thresholdStatus(paid, pending, threshold),
    });
  }
  const rank = { over: 0, near: 1, under: 2 } as Record<string, number>;
  payees.sort((a, b) => rank[a.status] - rank[b.status] || b.paid - a.paid || a.name.localeCompare(b.name));

  return {
    year, threshold, from: from.toISOString(), to: to.toISOString(), payees,
    totals: {
      paid: money(payees.reduce((s, p) => s + p.paid, 0)),
      pending: money(payees.reduce((s, p) => s + p.pending, 0)),
      payees: payees.length,
      over: payees.filter((p) => p.status === "over").length,
      near: payees.filter((p) => p.status === "near").length,
    },
    // No W-9 is collected anywhere yet (server/agents/compliance.ts marks every
    // driver's "missing"); the report says so rather than implying otherwise.
    w9Collected: false,
  };
}
