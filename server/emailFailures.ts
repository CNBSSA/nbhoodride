/**
 * What happens when an email cannot be sent (reliability audit 2026-09-29).
 *
 * Every user-facing email failure used to be swallowed to console.error and
 * nothing else, so an approval notice or a password-reset link that never
 * left (Gmail auth revoked, quota hit, SMTP down) was invisible to the
 * operator — against the rule that the operator hears before the rider.
 *
 * The email module reports each final failure through a recorder; this is
 * the recorder the server registers: one ops page per kind of email and
 * class of reason per hour (an outage sends hundreds of failures, the
 * operator needs one line, not a flood), and a reliability_events row for
 * every failure so the Rider Promise Review can count them the next morning.
 */
import { opsAlert, formatOpsAlert } from "./telegramOps";
import { recordReliabilityEvent } from "./reliabilityEvents";
import type { EmailFailureRecorder } from "./emailService";

export const EMAIL_FAILURE_PAGE_WINDOW_MS = 60 * 60 * 1000;

/** The part of an SMTP reason that names the class of failure, not the message. */
export function emailFailureClass(reason: string): string {
  const r = reason.toLowerCase();
  if (/not configured|smtp_pass/.test(r)) return "not_configured";
  if (/daily user sending limit|sending limit|quota|too many/.test(r)) return "quota";
  if (/invalid login|username and password not accepted|authentication|auth/.test(r)) return "auth";
  if (/recipient|mailbox|550|553/.test(r)) return "recipient";
  if (/timeout|etimedout|econnrefused|econnreset|greeting|connection/.test(r)) return "connection";
  return "other";
}

const lastPaged = new Map<string, number>();

/** Page for this (subject, class) at most once per window. Exported for the unit test. */
export function shouldPageEmailFailure(subject: string, reason: string, now = Date.now()): boolean {
  const key = `${subject}|${emailFailureClass(reason)}`;
  const last = lastPaged.get(key);
  if (last !== undefined && now - last < EMAIL_FAILURE_PAGE_WINDOW_MS) return false;
  lastPaged.set(key, now);
  return true;
}

export function _resetEmailFailureState(): void {
  lastPaged.clear();
}

export const emailFailureRecorder: EmailFailureRecorder = ({ to, subject, reason, attempts }) => {
  const cls = emailFailureClass(reason);
  if (shouldPageEmailFailure(subject, reason)) {
    opsAlert(formatOpsAlert("📧 Email FAILED to send", [
      ["Email", subject],
      ["To", to],
      ["Reason", reason],
      ["Class", cls],
      ["Attempts", attempts],
      ["Note", "more of this kind in the next hour are counted, not paged; see reliability_events kind email_failed"],
    ]));
  }
  recordReliabilityEvent({ kind: "email_failed", page: subject, message: `${cls}: ${reason}`.slice(0, 300) }).catch((err) =>
    console.error("[EMAIL] could not record failure:", err),
  );
};
