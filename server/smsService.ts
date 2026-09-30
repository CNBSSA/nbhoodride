/**
 * Outbound SMS with opt-out enforcement.
 *
 * Every ride-related text goes through here so that three rules hold without
 * each caller having to remember them:
 *   1. Nothing is sent to a number that replied STOP (TCPA — the opt-out
 *      registry is checked on every send, not just at subscribe time).
 *   2. A Twilio outage or misconfiguration never fails the ride operation
 *      that triggered the message — sends are best-effort and log instead.
 *   3. Numbers are normalized once, centrally, so the registry and Twilio
 *      always agree on what "this number" means.
 *
 * Inert unless TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER
 * are set.
 */

import twilio from "twilio";
import { normalizePhone } from "@shared/smsMessages";
import { storage } from "./storage";

export type SmsSendResult =
  | { sent: true; to: string }
  | { sent: false; reason: "not_configured" | "invalid_number" | "opted_out" | "send_failed"; detail?: string };

function twilioConfig(): { sid: string; token: string; from: string } | null {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  const from = process.env.TWILIO_PHONE_NUMBER?.trim();
  return sid && token && from ? { sid, token, from } : null;
}

export function isSmsConfigured(): boolean {
  return twilioConfig() !== null;
}

/**
 * Send one SMS, honouring the opt-out registry. Awaited by callers that want
 * the result; use sendSmsBestEffort() from request paths.
 */
export async function sendSms(rawTo: string | null | undefined, body: string): Promise<SmsSendResult> {
  const cfg = twilioConfig();
  if (!cfg) return { sent: false, reason: "not_configured" };

  const to = normalizePhone(rawTo);
  if (!to) return { sent: false, reason: "invalid_number" };

  try {
    if (await storage.isPhoneOptedOut(to)) {
      return { sent: false, reason: "opted_out" };
    }
  } catch (err) {
    // A registry lookup failure must not become an accidental send to someone
    // who opted out — fail closed.
    console.error("[sms] opt-out lookup failed, refusing to send:", err);
    return { sent: false, reason: "send_failed", detail: "opt-out lookup failed" };
  }

  try {
    await twilio(cfg.sid, cfg.token).messages.create({ to, from: cfg.from, body });
    return { sent: true, to };
  } catch (err: any) {
    console.error(`[sms] send failed to ${to}: ${err?.message ?? err}`);
    return { sent: false, reason: "send_failed", detail: err?.message };
  }
}

/**
 * Fire-and-forget send for request handlers: never throws, never blocks the
 * response. `context` only labels the log line.
 */
export function sendSmsBestEffort(to: string | null | undefined, body: string, context: string): void {
  sendSms(to, body)
    .then((result) => {
      if (!result.sent && result.reason !== "not_configured") {
        console.log(`[sms] ${context}: not sent (${result.reason}${result.detail ? `: ${result.detail}` : ""})`);
      }
    })
    .catch((err) => console.error(`[sms] ${context}: unexpected error`, err));
}
