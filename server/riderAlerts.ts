/**
 * Rider-trouble alerts — the operator hears about a rider's problem the
 * moment it happens, not when the rider texts about it.
 *
 * Every alert goes to Telegram through opsAlert AND is mirrored to the server
 * log as [rider-alert], so Railway logs carry the same record when Telegram
 * is unreachable.
 *
 * De-duplication: the same (kind, key) — e.g. the same rider retrying a login
 * that is blocked for the same reason — is sent once per window; further
 * occurrences are counted and summarised on the next send. That keeps one
 * stuck rider from producing thirty pings while still making it obvious the
 * problem is continuing.
 */

import { opsAlert, formatOpsAlert } from "./telegramOps";

export type RiderAlertKind =
  | "login_pending_approval"
  | "login_suspended"
  | "login_locked_out"
  | "login_wrong_password"
  | "signup_failed"
  | "booking_refused"
  | "payment_auth_failed"
  | "settlement_failed"
  | "no_driver_found"
  | "server_error"
  | "client_error"
  | "push_subscribe_failed";

const TITLES: Record<RiderAlertKind, string> = {
  login_pending_approval: "⏳ Rider waiting on approval — tried to log in",
  login_suspended: "🚫 Suspended account tried to log in",
  login_locked_out: "🔒 Account locked after repeated wrong passwords",
  login_wrong_password: "🔑 Rider struggling with password",
  signup_failed: "❗ Signup failed",
  booking_refused: "🛑 Ride request refused",
  payment_auth_failed: "💳 Card authorization failed at accept",
  settlement_failed: "💳 Card settlement failed at completion",
  no_driver_found: "🚗 No driver found — ride cancelled",
  server_error: "🔥 Server error hit by a user",
  client_error: "📱 App error on a rider's phone",
  push_subscribe_failed: "🔔 Notifications failed to enable",
};

/** Seconds during which repeats of the same (kind,key) are folded together. */
export const DEDUP_WINDOW_SECONDS = 15 * 60;

interface DedupEntry { lastSentAt: number; suppressed: number }
const recent = new Map<string, DedupEntry>();

/** Exposed for tests. */
export function _resetRiderAlertState(): void {
  recent.clear();
}

/**
 * Decide whether to send now. Returns the number of suppressed repeats to
 * mention (0 on a first send), or null when this occurrence should be folded.
 */
export function shouldSend(kind: RiderAlertKind, key: string, now = Date.now()): number | null {
  const id = `${kind}:${key}`;
  const entry = recent.get(id);
  if (!entry || now - entry.lastSentAt >= DEDUP_WINDOW_SECONDS * 1000) {
    const suppressed = entry?.suppressed ?? 0;
    recent.set(id, { lastSentAt: now, suppressed: 0 });
    return suppressed;
  }
  entry.suppressed += 1;
  return null;
}

/**
 * Fire-and-forget. `key` scopes de-duplication — usually the user id or email,
 * or the route for server errors. `fields` are plain label/value pairs.
 */
export function riderAlert(
  kind: RiderAlertKind,
  key: string,
  fields: Array<[label: string, value: string | number | null | undefined]>,
): void {
  const suppressed = shouldSend(kind, key);
  if (suppressed === null) return;
  const extra: typeof fields = suppressed > 0 ? [["Repeats since last alert", suppressed]] : [];
  const text = formatOpsAlert(TITLES[kind], [...fields, ...extra]);
  console.warn(`[rider-alert] ${kind} key=${key} :: ${text.replace(/\n/g, " | ")}`);
  opsAlert(text);
}
