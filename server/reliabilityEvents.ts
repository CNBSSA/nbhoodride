/**
 * Reliability events — the durable side of rider alerts. Telegram tells the
 * operator now; this table lets the Rider Promise Review say the next
 * morning how many errors reached how many people, and lets the sweep's
 * ride-risk pages be counted against what was delivered.
 *
 * Every write is fire-and-forget: an alert path must never fail or slow a
 * request because bookkeeping failed.
 */

import { sql } from "drizzle-orm";
import { db } from "./db";
import type { RiderAlertKind, RiderAlertRecorder } from "./riderAlerts";

/** Alert kinds that mean "a person was handed an error by the app". */
export const APP_ERROR_KINDS: RiderAlertKind[] = ["client_error", "client_crash", "push_subscribe_failed"];
export const SERVER_ERROR_KINDS: RiderAlertKind[] = ["server_error"];

const field = (fields: Array<[string, unknown]>, label: string): string | null => {
  const hit = fields.find(([l]) => l === label);
  const v = hit?.[1];
  return v === null || v === undefined || String(v).trim() === "" ? null : String(v).slice(0, 300);
};

export async function recordReliabilityEvent(input: { kind: string; userId?: string | null; page?: string | null; message?: string | null }): Promise<void> {
  await db.execute(sql`
    INSERT INTO reliability_events (kind, user_id, page, message)
    VALUES (${input.kind}, ${input.userId ?? null}, ${input.page ?? null}, ${input.message ?? null})
  `);
}

/**
 * The recorder the server registers with riderAlerts: pulls the user id,
 * page/route and error text out of the alert's own fields. The dedup key
 * carries the user id for client errors ("<userId>:<message>") and for the
 * ride watch the ride id; "User id" as an explicit field wins when present.
 */
export const reliabilityEventRecorder: RiderAlertRecorder = ({ kind, key, fields }) => {
  const userId = field(fields, "User id") ?? (/^[0-9a-f-]{20,}|^e2e-/.test(key) ? key.split(":")[0] : null);
  recordReliabilityEvent({
    kind,
    userId,
    page: field(fields, "Page") ?? field(fields, "Route") ?? field(fields, "Ride"),
    message: field(fields, "Error") ?? field(fields, "Reason") ?? field(fields, "Why") ?? null,
  }).catch((err) => console.error("[reliability-events] write failed:", err instanceof Error ? err.message : err));
};
