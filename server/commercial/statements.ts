/**
 * Monthly statements — what an organization owes for a month, as JSON for
 * the console, CSV for their bookkeeper, and a printable page.
 *
 * A statement is built from the jobs whose service time fell in the Eastern
 * calendar month: completed jobs at fare plus facility fee plus waiting,
 * cancelled jobs at their cancellation fee. Nothing is written; slice 5
 * turns a month into a charge.
 */

import { CATEGORY_LABELS, formatJobNumber, isCategory, statementCsv, statementMonthWindow, statementTotals, type StatementLine, type StatementTotals, type StatementWindow } from "@shared/commercial";
import { BRAND } from "@shared/branding";
import { CommercialError, getOrganization } from "./organizations";
import { listJobs } from "./jobs";

export interface Statement {
  organization: { id: string; name: string; category: string; contactName: string | null; contactEmail: string | null };
  window: { monthKey: string; label: string; start: string; end: string };
  lines: StatementLine[];
  totals: StatementTotals;
}

const BILLABLE = new Set(["completed", "cancelled", "no_show"]);

export async function buildStatement(organizationId: string, monthKey: string): Promise<Statement> {
  const org = await getOrganization(organizationId);
  if (!org) throw new CommercialError("Organization not found.", 404);
  let window: StatementWindow;
  try { window = statementMonthWindow(monthKey); } catch (e) { throw new CommercialError((e as Error).message); }
  const jobs = await listJobs(organizationId, { from: window.start, to: window.end, limit: 1000 });
  const lines: StatementLine[] = jobs
    .filter((j) => BILLABLE.has(j.status))
    .sort((a, b) => new Date(a.scheduledAt ?? a.createdAt).getTime() - new Date(b.scheduledAt ?? b.createdAt).getTime())
    .map((j) => ({
      jobNumber: j.jobNumber,
      at: new Date(j.scheduledAt ?? j.createdAt).toISOString(),
      passenger: j.passengerName ?? "",
      from: j.pickup?.address ?? "",
      to: j.destination?.address ?? "",
      status: j.status,
      fare: j.actualFare ?? j.estimatedFare,
      facilityFee: j.facilityFee,
      waitFee: j.waitFee,
      cancellationFee: j.cancellationFee,
    }));
  return {
    organization: { id: org.id, name: org.name, category: org.category, contactName: org.contactName, contactEmail: org.contactEmail },
    window: { monthKey: window.monthKey, label: window.label, start: window.start.toISOString(), end: window.end.toISOString() },
    lines,
    totals: statementTotals(lines),
  };
}

export function statementToCsv(s: Statement): string {
  return statementCsv(s.organization.name, { ...s.window, start: new Date(s.window.start), end: new Date(s.window.end) }, s.lines);
}

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const money = (n: number | string | null | undefined) => `$${Number(n ?? 0).toFixed(2)}`;
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** A printable statement: plain HTML, no scripts, fits a sheet of paper. */
export function statementToHtml(s: Statement): string {
  const category = isCategory(s.organization.category) ? CATEGORY_LABELS[s.organization.category] : s.organization.category;
  const rows = s.lines.map((l) => {
    const completed = l.status === "completed";
    return `<tr>
      <td>${esc(formatJobNumber(l.jobNumber))}</td><td>${esc(when(l.at))}</td><td>${esc(l.passenger)}</td>
      <td>${esc(l.from)}<br><span class="to">to ${esc(l.to)}</span></td><td>${esc(l.status)}</td>
      <td class="n">${completed ? money(l.fare) : ""}</td><td class="n">${completed ? money(l.facilityFee) : ""}</td>
      <td class="n">${completed ? money(l.waitFee) : ""}</td><td class="n">${completed ? "" : money(l.cancellationFee)}</td>
      <td class="n">${money(completed ? Number(l.fare ?? 0) + Number(l.facilityFee ?? 0) + Number(l.waitFee ?? 0) : l.cancellationFee)}</td>
    </tr>`;
  }).join("\n");
  const t = s.totals;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(BRAND.appName)} statement — ${esc(s.organization.name)} — ${esc(s.window.label)}</title>
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#17233a;margin:0;padding:32px;background:#fff}
  h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;font-weight:600;margin:0 0 20px;color:#5a6577}
  .head{display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap;border-bottom:2px solid #17233a;padding-bottom:12px;margin-bottom:20px}
  .head p{margin:2px 0;font-size:14px}
  table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;vertical-align:top;padding:8px 8px;border-bottom:1px solid #d8dee8}
  th{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#5a6577}
  td.n,th.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.to{color:#5a6577}
  tfoot td{font-weight:600;border-top:2px solid #17233a;border-bottom:0}
  .note{font-size:12px;color:#5a6577;margin-top:24px}
  @media print{body{padding:0}}
</style></head><body>
<div class="head">
  <div><h1>${esc(BRAND.appName)} statement</h1><h2>${esc(s.window.label)}</h2></div>
  <div><p><strong>${esc(s.organization.name)}</strong></p><p>${esc(category)}</p>${s.organization.contactName ? `<p>${esc(s.organization.contactName)}</p>` : ""}${s.organization.contactEmail ? `<p>${esc(s.organization.contactEmail)}</p>` : ""}</div>
</div>
<table>
  <thead><tr><th>Job</th><th>When</th><th>Passenger</th><th>Trip</th><th>Status</th><th class="n">Fare</th><th class="n">Facility fee</th><th class="n">Waiting</th><th class="n">Cancellation</th><th class="n">Total</th></tr></thead>
  <tbody>${rows || `<tr><td colspan="10">No billable jobs in ${esc(s.window.label)}.</td></tr>`}</tbody>
  <tfoot><tr><td colspan="5">${t.completed} completed · ${t.cancelled} cancelled</td><td class="n">${money(t.fares)}</td><td class="n">${money(t.facilityFees)}</td><td class="n">${money(t.waitFees)}</td><td class="n">${money(t.cancellationFees)}</td><td class="n">${money(t.total)}</td></tr></tfoot>
</table>
<p class="note">Fares are the amounts quoted when each job was booked. Times are Eastern. Questions: ${esc(BRAND.supportEmail ?? "")}</p>
</body></html>`;
}
