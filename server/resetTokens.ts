/**
 * Password-reset tokens at rest (reliability audit 2026-09-29; priority 4).
 *
 * The emailed token used to be stored in plain text, so a read of the users
 * table (a backup, a query in the wrong hands) was a one-hour takeover of
 * any account with a reset in flight. Now only its SHA-256 is stored, as
 * the organization invitation links already do (shared/invitations.ts):
 * the email carries the raw token, the row carries the hash, and a lookup
 * hashes what the rider sent. A row written before this change still
 * carries a plain token for the hour it lives; the lookup accepts that too,
 * so a link emailed just before the deploy still works.
 */
import { createHash } from "node:crypto";

export function hashResetToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

/** Does a stored value look like a hash (64 hex chars) rather than a plain token? */
export function looksHashed(stored: string | null | undefined): boolean {
  return typeof stored === "string" && /^[0-9a-f]{64}$/.test(stored);
}
