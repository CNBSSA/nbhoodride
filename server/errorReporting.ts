/**
 * Error reporting to Sentry (work order, Chairman 2026-10-27).
 *
 * Opt-in twice over: nothing happens unless SENTRY_ENABLED=true AND a valid
 * SENTRY_DSN is set. The key alone does nothing, so deploying this code never
 * starts sending anything; the operator turns it on deliberately.
 *
 * What is sent is decided by shared/errorScrub.ts: a stack trace, a scrubbed
 * message, an opaque user id and four tags. No request data, cookies, headers,
 * breadcrumbs, local variables, source lines, performance traces, profiles or
 * session replays — the SDK is started with no default integrations, so none
 * of them are even collected.
 *
 * It must never hurt the server it watches: every call here is wrapped, the
 * SDK is imported lazily so a failure to load it is only a log line, reports
 * are rate-limited, and a crash waits at most two seconds for its report.
 * The existing Telegram alerts and reliability events are untouched; this
 * adds stack traces beside them and removes nothing.
 */
import { BUILD_ID } from "./buildInfo";
import { isExpectedError, safeTags, safeUserId, scrubEvent } from "@shared/errorScrub";

type SentryModule = typeof import("@sentry/node");

let sentry: SentryModule | null = null;
let enabled = false;

/** At most this many reports a minute; a crash loop must not become a flood. */
export const MAX_REPORTS_PER_MINUTE = 30;
let windowStart = 0;
let inWindow = 0;
let dropped = 0;

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** The DSN's host when it is one we will send to; null otherwise. */
export function acceptableDsnHost(dsn: string | undefined): string | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    if (!u.username) return null;
    if (u.protocol === "https:") return u.hostname;
    // Plain http only to this machine, so a journey can catch what is sent.
    if (u.protocol === "http:" && LOOPBACK.has(u.hostname)) return u.hostname;
    return null;
  } catch {
    return null;
  }
}

/** Start error reporting if, and only if, it was asked for. Never throws. */
export async function initErrorReporting(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (env.SENTRY_ENABLED !== "true") {
    if (env.SENTRY_DSN) console.log("[sentry] a key is set but SENTRY_ENABLED is not 'true': error reporting is off");
    return false;
  }
  const host = acceptableDsnHost(env.SENTRY_DSN);
  if (!host) {
    console.error("[sentry] SENTRY_ENABLED is 'true' but SENTRY_DSN is missing or not an https address: error reporting is off");
    return false;
  }
  try {
    const mod = await import("@sentry/node");
    mod.init({
      dsn: env.SENTRY_DSN,
      environment: env.SENTRY_ENVIRONMENT || env.NODE_ENV || "production",
      release: BUILD_ID,
      serverName: "pgride",
      // Nothing is collected by default: no HTTP, console, database or
      // process-handler instrumentation. Our own handlers report explicitly.
      defaultIntegrations: false,
      integrations: [
        mod.inboundFiltersIntegration(),
        mod.functionToStringIntegration(),
        mod.linkedErrorsIntegration(),
        mod.dedupeIntegration(),
      ],
      skipOpenTelemetrySetup: true,
      sendDefaultPii: false,
      maxBreadcrumbs: 0,
      maxValueLength: 1000,
      sampleRate: 1,
      shutdownTimeout: 2000,
      beforeSend: (event) => scrubEvent(event as any) as any,
    });
    sentry = mod;
    enabled = true;
    console.log(`[sentry] error reporting is ON for build ${BUILD_ID} (sending to ${host})`);
    return true;
  } catch (err) {
    sentry = null;
    enabled = false;
    console.error("[sentry] could not start; error reporting is off:", (err as Error)?.message ?? err);
    return false;
  }
}

export function errorReportingEnabled(): boolean {
  return enabled;
}

/**
 * Report an error. Returns true when it was handed to the SDK. A client's
 * mistake (4xx) is not reported, and nothing here ever throws.
 */
export function reportError(
  err: unknown,
  context: { kind?: string; route?: string; job?: string; source?: string; userId?: unknown } = {},
): boolean {
  if (!enabled || !sentry) return false;
  try {
    if (isExpectedError(err)) return false;
    const now = Date.now();
    if (now - windowStart > 60_000) { windowStart = now; inWindow = 0; }
    if (inWindow >= MAX_REPORTS_PER_MINUTE) { dropped += 1; return false; }
    inWindow += 1;
    const error = err instanceof Error ? err : new Error(typeof err === "string" ? err : "Non-error thrown");
    const { userId, ...tags } = context;
    const id = safeUserId(userId);
    sentry.captureException(error, { tags: safeTags(tags), ...(id ? { user: { id } } : {}) });
    return true;
  } catch {
    return false;
  }
}

/** Wait (at most `timeoutMs`) for queued reports to go out. Never throws. */
export async function flushErrorReports(timeoutMs = 2000): Promise<void> {
  if (!enabled || !sentry) return;
  try {
    await Promise.race([
      sentry.flush(timeoutMs),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs + 200).unref?.()),
    ]);
  } catch { /* a report that cannot go out is not worth a second failure */ }
}

/** Reports dropped by the rate limit since start (for the test event's answer). */
export function droppedReports(): number {
  return dropped;
}
