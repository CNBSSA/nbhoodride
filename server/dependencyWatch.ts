/**
 * Dependency watch — the server checks its own lifelines every ten minutes
 * and pages the operator the moment one fails, and again when it recovers.
 *
 * Production used to be probed once a day (the Daily Audit Gate) and once
 * after each deploy. Between those, a Stripe key rejected at 2 PM or a
 * database pool that stopped answering was found by the next rider to tap
 * Confirm. This is the in-process half of the watch: it sees what only the
 * server can see (its own database connection, its own Stripe key). The
 * outside half, .github/workflows/production-watch.yml, sees what the
 * server cannot: the server being down.
 *
 * Transitions, not states, are alerted: one "down" page (repeated hourly
 * while it stays down), one "recovered" page with the outage length. Both
 * are written to reliability_events so the Rider Promise Review can say
 * "Outages: Stripe, 12 min" the next morning.
 */

import { pool } from "./db";
import { stripe } from "./stripeService";
import { opsAlert, telegramOpsEnabled } from "./telegramOps";
import { recordReliabilityEvent } from "./reliabilityEvents";

export type DependencyName = "database" | "stripe";

export interface DependencyStatus {
  ok: boolean;
  /** Round-trip in milliseconds when the check ran. */
  ms: number;
  /** Why it failed, or a note ("not configured"). Never a secret. */
  detail?: string;
  /** False when the dependency is not configured, so "ok" means nothing. */
  configured: boolean;
}

export interface DependencyReport {
  checkedAt: string;
  deps: Record<DependencyName, DependencyStatus>;
  /** Names of configured dependencies that failed. */
  down: DependencyName[];
}

/** How often the sweep runs the check. */
export const DEPENDENCY_CHECK_EVERY_MINUTES = 10;
/** While something stays down, remind at most this often. */
export const STILL_DOWN_REMINDER_MINUTES = 60;
const CHECK_TIMEOUT_MS = 8_000;

const LABELS: Record<DependencyName, string> = { database: "Database", stripe: "Stripe" };

function withTimeout<T>(p: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} did not answer within ${CHECK_TIMEOUT_MS / 1000}s`)), CHECK_TIMEOUT_MS);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

const errText = (e: unknown) => String((e as any)?.message ?? e).replace(/sk_(live|test)_[A-Za-z0-9]+/g, "sk_***").slice(0, 200);

async function timed(configured: boolean, run: () => Promise<void>, notConfigured: string): Promise<DependencyStatus> {
  if (!configured) return { ok: true, ms: 0, configured: false, detail: notConfigured };
  const t0 = Date.now();
  try {
    await run();
    return { ok: true, ms: Date.now() - t0, configured: true };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, configured: true, detail: errText(e) };
  }
}

/** One check of every dependency. Never throws. */
export async function checkDependencies(now: Date = new Date()): Promise<DependencyReport> {
  const [database, stripeStatus] = await Promise.all([
    timed(true, async () => { await withTimeout(pool.query("SELECT 1"), "Database"); }, ""),
    timed(!!stripe, async () => { await withTimeout(stripe!.balance.retrieve({}, { timeout: CHECK_TIMEOUT_MS }), "Stripe"); }, "STRIPE_SECRET_KEY not set"),
  ]);
  const deps = { database, stripe: stripeStatus };
  const down = (Object.keys(deps) as DependencyName[]).filter((k) => deps[k].configured && !deps[k].ok);
  return { checkedAt: now.toISOString(), deps, down };
}

interface DownState { since: Date; lastPagedAt: Date; detail: string }
const downSince = new Map<DependencyName, DownState>();
let last: DependencyReport | null = null;

/** The most recent report, for /health/deps. Null until the first check has run. */
export function lastDependencyReport(): DependencyReport | null {
  return last;
}

/** Exposed for tests. */
export function _resetDependencyWatch(): void {
  downSince.clear();
  last = null;
}

export interface WatchOutcome {
  report: DependencyReport;
  paged: Array<{ dep: DependencyName; event: "down" | "still_down" | "up"; minutes?: number }>;
}

/**
 * Run the check and alert on transitions. Safe to call from any number of
 * places; state is per process, so a restart re-pages a dependency that is
 * still down (which is what you want after a restart).
 */
export async function runDependencyWatch(now: Date = new Date()): Promise<WatchOutcome> {
  const report = await checkDependencies(now);
  last = report;
  const paged: WatchOutcome["paged"] = [];

  for (const dep of Object.keys(report.deps) as DependencyName[]) {
    const s = report.deps[dep];
    const wasDown = downSince.get(dep);
    if (s.configured && !s.ok) {
      const detail = s.detail ?? "failed";
      if (!wasDown) {
        downSince.set(dep, { since: now, lastPagedAt: now, detail });
        const text = `🔴 ${LABELS[dep]} unreachable from the PG Ride server\nSince: ${now.toISOString()}\nError: ${detail}\nRiders will see failures until this recovers. Checked again every ${DEPENDENCY_CHECK_EVERY_MINUTES} min.`;
        console.error(`[dependency-watch] ${dep} down :: ${detail}`);
        opsAlert(text);
        recordReliabilityEvent({ kind: "dependency_down", page: dep, message: detail }).catch(() => {});
        paged.push({ dep, event: "down" });
      } else if (now.getTime() - wasDown.lastPagedAt.getTime() >= STILL_DOWN_REMINDER_MINUTES * 60_000) {
        wasDown.lastPagedAt = now;
        wasDown.detail = detail;
        const minutes = Math.round((now.getTime() - wasDown.since.getTime()) / 60_000);
        console.error(`[dependency-watch] ${dep} still down after ${minutes} min :: ${detail}`);
        opsAlert(`🔴 ${LABELS[dep]} still unreachable after ${minutes} min\nError: ${detail}`);
        paged.push({ dep, event: "still_down", minutes });
      }
    } else if (wasDown) {
      downSince.delete(dep);
      const minutes = Math.max(1, Math.round((now.getTime() - wasDown.since.getTime()) / 60_000));
      console.warn(`[dependency-watch] ${dep} recovered after ${minutes} min`);
      opsAlert(`🟢 ${LABELS[dep]} reachable again after ${minutes} min`);
      recordReliabilityEvent({ kind: "dependency_up", page: dep, message: `recovered after ${minutes} min` }).catch(() => {});
      paged.push({ dep, event: "up", minutes });
    }
  }
  if (!telegramOpsEnabled() && paged.length > 0) {
    console.warn("[dependency-watch] Telegram ops is not configured; the pages above went to the log only");
  }
  return { report, paged };
}

/** True on the sweep minutes the watch should run. */
export function dependencyCheckDue(now: Date): boolean {
  return now.getMinutes() % DEPENDENCY_CHECK_EVERY_MINUTES === 0;
}
