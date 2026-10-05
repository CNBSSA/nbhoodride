/**
 * Admin → Reports (2026-10-05, the Chairman's request): two read-only views of
 * production data that until now needed someone to run SQL in Railway's
 * database console — which neither Festie nor a working session can reach.
 *
 * 1. Reliability timeline: what the server itself recorded in a time window
 *    (reliability_events), counted by kind and by hour, with the hourly
 *    "watch ran" heartbeats listed. A heartbeat recorded inside the window
 *    means the server was alive and working; heartbeats that stop mean it
 *    was not. Built to settle the 2026-09-30 outage.
 * 2. Rider balances: riders (not drivers, not car owners, not deleted) who
 *    still hold money in the balance the Virtual PG Card used to show, how
 *    much, and what put it there (wallet_transactions by reason). Built for
 *    work order #451.
 *
 * Nothing here writes. Both are admin-only (the routes sit behind
 * isAdminOrSessionAuth) and bounded: a window of at most 7 days and at most
 * 500 events; at most 200 riders listed, while the count and total cover all.
 */
import { sql } from "drizzle-orm";
import { db } from "./db";

export const REPORT_MAX_WINDOW_DAYS = 7;
export const REPORT_MAX_EVENTS = 500;
export const REPORT_MAX_RIDERS = 200;

export class ReportError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : r?.rows ?? []);
const num = (v: unknown) => Math.round(Number(v ?? 0) * 100) / 100;

/** Parse the window; default the last 24 hours. Times are UTC. */
export function reportWindow(fromRaw: unknown, toRaw: unknown, now: Date = new Date()): { from: Date; to: Date } {
  const to = toRaw ? new Date(String(toRaw)) : now;
  const from = fromRaw ? new Date(String(fromRaw)) : new Date(to.getTime() - 24 * 3600_000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new ReportError("Give the window as dates and times, like 2026-09-30T03:00Z.");
  if (from >= to) throw new ReportError("The window's start must be before its end.");
  if (to.getTime() - from.getTime() > REPORT_MAX_WINDOW_DAYS * 86400_000) throw new ReportError(`Choose a window of at most ${REPORT_MAX_WINDOW_DAYS} days.`);
  return { from, to };
}

export async function reliabilityTimeline(fromRaw: unknown, toRaw: unknown, now: Date = new Date()) {
  const { from, to } = reportWindow(fromRaw, toRaw, now);
  const byKind = rowsOf(await db.execute(sql`
    SELECT kind, count(*)::int AS count FROM reliability_events
    WHERE created_at >= ${from} AND created_at < ${to}
    GROUP BY kind ORDER BY count DESC, kind`));
  const byHour = rowsOf(await db.execute(sql`
    SELECT to_char(date_trunc('hour', created_at), 'YYYY-MM-DD"T"HH24:00"Z"') AS hour,
           count(*)::int AS count,
           count(*) FILTER (WHERE kind = 'watch_ran')::int AS heartbeats
    FROM reliability_events
    WHERE created_at >= ${from} AND created_at < ${to}
    GROUP BY 1 ORDER BY 1`));
  const events = rowsOf(await db.execute(sql`
    SELECT kind, page, left(coalesce(message, ''), 300) AS message,
           to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at
    FROM reliability_events
    WHERE created_at >= ${from} AND created_at < ${to}
    ORDER BY created_at LIMIT ${REPORT_MAX_EVENTS}`));
  const total = byKind.reduce((s, r) => s + Number(r.count), 0);
  // The last heartbeat over the WHOLE window, not over the listed events: the
  // list stops at the first 500, and a later heartbeat must still show
  // (Cursor Bugbot on #458).
  const [hb] = rowsOf(await db.execute(sql`
    SELECT to_char(max(created_at), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at
    FROM reliability_events
    WHERE kind = 'watch_ran' AND created_at >= ${from} AND created_at < ${to}`));
  const lastHeartbeat: string | null = hb?.at ?? null;
  return {
    from: from.toISOString(), to: to.toISOString(), total,
    byKind: byKind.map((r) => ({ kind: r.kind, count: Number(r.count) })),
    byHour: byHour.map((r) => ({ hour: r.hour, count: Number(r.count), heartbeats: Number(r.heartbeats) })),
    lastHeartbeat,
    events: events.map((e) => ({ at: e.at, kind: e.kind, page: e.page, message: e.message })),
    truncated: total > events.length,
  };
}

export async function riderBalances() {
  // A rider: not deleted, no driver profile and no car-owner profile — the
  // same rule the Friday payday uses to tell riders from people who are paid.
  const riderFilter = sql`
    CAST(COALESCE(u.virtual_card_balance, '0') AS numeric) > 0
    AND u.deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM driver_profiles d WHERE d.user_id = u.id)
    AND NOT EXISTS (SELECT 1 FROM rental_owner_profiles o WHERE o.user_id = u.id)`;
  const [summary] = rowsOf(await db.execute(sql`
    SELECT count(*)::int AS riders, COALESCE(sum(CAST(u.virtual_card_balance AS numeric)), 0) AS total
    FROM users u WHERE ${riderFilter}`));
  const bySource = rowsOf(await db.execute(sql`
    SELECT wt.reason, count(*)::int AS entries, COALESCE(sum(CAST(wt.amount AS numeric)), 0) AS amount
    FROM wallet_transactions wt JOIN users u ON u.id = wt.user_id
    WHERE ${riderFilter} AND CAST(wt.amount AS numeric) > 0
    GROUP BY wt.reason ORDER BY amount DESC`));
  const riders = rowsOf(await db.execute(sql`
    SELECT u.id, u.first_name, u.last_name, u.email, u.virtual_card_balance AS balance,
           (SELECT wt.reason FROM wallet_transactions wt WHERE wt.user_id = u.id AND CAST(wt.amount AS numeric) > 0 ORDER BY wt.created_at DESC LIMIT 1) AS last_credit,
           (SELECT to_char(wt.created_at, 'YYYY-MM-DD') FROM wallet_transactions wt WHERE wt.user_id = u.id AND CAST(wt.amount AS numeric) > 0 ORDER BY wt.created_at DESC LIMIT 1) AS last_credit_on
    FROM users u WHERE ${riderFilter}
    ORDER BY CAST(u.virtual_card_balance AS numeric) DESC LIMIT ${REPORT_MAX_RIDERS}`));
  return {
    riders: Number(summary?.riders ?? 0),
    total: num(summary?.total),
    bySource: bySource.map((r) => ({ reason: r.reason, entries: Number(r.entries), amount: num(r.amount) })),
    list: riders.map((r) => ({
      userId: r.id, name: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || "(no name)", email: r.email,
      balance: num(r.balance), lastCredit: r.last_credit ?? null, lastCreditOn: r.last_credit_on ?? null,
    })),
    listed: Math.min(Number(summary?.riders ?? 0), REPORT_MAX_RIDERS),
  };
}
