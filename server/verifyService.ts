/**
 * Twilio Verify — one-time codes by SMS for password reset.
 *
 * Verify is used instead of a plain SMS for two reasons. It sends from
 * Twilio's own pre-approved senders, so it works before this account's
 * toll-free verification / A2P registration clears; and Twilio holds the
 * code and its expiry, so nothing secret is stored here.
 *
 * Inert unless TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and
 * TWILIO_VERIFY_SERVICE_SID (a Verify Service created in the Twilio
 * console, starts with "VA") are all set.
 */
import twilio from "twilio";

function config() {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  const service = process.env.TWILIO_VERIFY_SERVICE_SID?.trim();
  return sid && token && service ? { sid, token, service } : null;
}

export function isVerifyConfigured(): boolean {
  return config() !== null;
}

/** Send a code to an E.164 number. Throws on provider failure. */
export async function startPhoneVerification(to: string): Promise<void> {
  const cfg = config();
  if (!cfg) throw new Error("Twilio Verify is not configured");
  await twilio(cfg.sid, cfg.token).verify.v2.services(cfg.service).verifications.create({ to, channel: "sms" });
}

/** True only when Twilio reports the code approved for that number. */
export async function checkPhoneVerification(to: string, code: string): Promise<boolean> {
  const cfg = config();
  if (!cfg) throw new Error("Twilio Verify is not configured");
  const result = await twilio(cfg.sid, cfg.token).verify.v2.services(cfg.service).verificationChecks.create({ to, code });
  return result.status === "approved";
}
