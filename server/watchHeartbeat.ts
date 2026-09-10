/**
 * A watchdog on the watchdogs.
 *
 * Every check that is meant to run overnight leaves a heartbeat, and the
 * 4:00 AM Rider Promise Review says which ones did. This is the answer to
 * the failure that already bit us once: the production watch shipped as
 * invalid YAML, never ran for a day, and nothing said so — a check that
 * dies quietly is worse than no check, because it buys false confidence.
 *
 * The two GitHub checks cannot reach the database, so they mark themselves
 * by adding `?probe=<name>` to the health endpoint they already call. No
 * new secret, no new endpoint, nothing to keep in step.
 *
 * Heartbeats are throttled to one an hour per watch: enough to prove a
 * check is alive through the night, cheap enough to run from a sweep that
 * fires every minute.
 */

import { sql } from "drizzle-orm";
import { db } from "./db";

export const WATCHES = {
  "minute-sweep": "Minute sweep",
  "dependency-watch": "Database and Stripe watch",
  "ride-risk": "Ride-risk paging",
  "production-watch": "Production watch (outside)",
  "daily-reliability": "Daily reliability report",
} as const;
export type WatchName = keyof typeof WATCHES;

export const isWatchName = (v: unknown): v is WatchName => typeof v === "string" && v in WATCHES;

/** Watches the review expects to see overnight. */
export const OVERNIGHT_WATCHES: WatchName[] = ["minute-sweep", "dependency-watch", "production-watch"];

const HEARTBEAT_EVERY_MS = 60 * 60 * 1000;
const lastWritten = new Map<string, number>();

/** Exposed for tests. */
export function _resetHeartbeats(): void {
  lastWritten.clear();
}

/**
 * Note that a watch ran. Fire and forget, throttled per watch; a heartbeat
 * that cannot be written must never disturb the check it belongs to.
 */
export function noteWatchRan(name: string, now: Date = new Date()): void {
  if (!isWatchName(name)) return;
  const previous = lastWritten.get(name) ?? 0;
  if (now.getTime() - previous < HEARTBEAT_EVERY_MS) return;
  lastWritten.set(name, now.getTime());
  db.execute(sql`
    INSERT INTO reliability_events (kind, page, message, created_at)
    VALUES ('watch_ran', ${name}, ${WATCHES[name]}, ${now})
  `).catch((err) => {
    lastWritten.delete(name);
    console.error(`[heartbeat] ${name} not recorded:`, err instanceof Error ? err.message : err);
  });
}

export interface WatchReport {
  name: WatchName;
  label: string;
  beats: number;
  lastAt: Date | null;
}

/** Which watches left a heartbeat in the window, and when they were last seen. */
export async function watchesInWindow(start: Date, end: Date): Promise<WatchReport[]> {
  const rows = await db.execute(sql`
    SELECT page AS name, count(*)::int AS beats, max(created_at) AS last_at
    FROM reliability_events
    WHERE kind = 'watch_ran' AND created_at >= ${start} AND created_at < ${end}
    GROUP BY page
  `);
  const seen = new Map<string, { beats: number; lastAt: Date | null }>();
  for (const r of (rows.rows ?? []) as any[]) {
    seen.set(String(r.name), { beats: Number(r.beats ?? 0), lastAt: r.last_at ? new Date(r.last_at) : null });
  }
  return OVERNIGHT_WATCHES.map((name) => ({
    name,
    label: WATCHES[name],
    beats: seen.get(name)?.beats ?? 0,
    lastAt: seen.get(name)?.lastAt ?? null,
  }));
}
