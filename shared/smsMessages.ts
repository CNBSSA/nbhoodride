/**
 * Outbound SMS copy and phone normalization, shared so the templates can be
 * unit-tested and reviewed in one place (carriers also require the exact
 * message templates during A2P 10DLC registration).
 *
 * Every message identifies the sender and carries opt-out language, which is
 * both a TCPA expectation and a carrier filtering criterion.
 */

export const SMS_BRAND = "PG Ride";

/** E.164 for US numbers; returns null when the input can't be a phone number. */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  // Already-international values (e.g. +44…) pass through when plausible.
  const trimmed = String(phone).trim();
  if (trimmed.startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}

/** STOP/START/HELP keyword classification for inbound messages. */
export type SmsKeyword = "stop" | "start" | "help" | null;

export function classifyKeyword(body: string | null | undefined): SmsKeyword {
  const word = String(body ?? "").trim().toLowerCase().replace(/[^a-z]/g, "");
  if (["stop", "stopall", "unsubscribe", "cancel", "end", "quit"].includes(word)) return "stop";
  if (["start", "unstop", "yes"].includes(word)) return "start";
  if (["help", "info"].includes(word)) return "help";
  return null;
}

const OPT_OUT_SUFFIX = "Reply STOP to opt out.";

export interface FriendRideSmsContext {
  passengerName?: string | null;
  bookerName?: string | null;
  driverName?: string | null;
  vehicle?: string | null;
  trackingUrl?: string | null;
  fare?: string | null;
}

/** Driver assigned — the passenger's first contact from us. */
export function friendRideAssignedSms(ctx: FriendRideSmsContext): string {
  const who = ctx.bookerName ? `${ctx.bookerName} booked` : "Someone booked";
  const driver = ctx.driverName ? `${ctx.driverName}` : "Your driver";
  const vehicle = ctx.vehicle ? ` (${ctx.vehicle})` : "";
  const track = ctx.trackingUrl ? ` Track the ride: ${ctx.trackingUrl}` : "";
  return `${SMS_BRAND}: ${who} a ride for you. ${driver}${vehicle} is on the way.${track} ${OPT_OUT_SUFFIX}`;
}

/** Driver has arrived at the pickup point. */
export function friendRideArrivedSms(ctx: FriendRideSmsContext): string {
  const driver = ctx.driverName ? `${ctx.driverName}` : "Your driver";
  const vehicle = ctx.vehicle ? ` (${ctx.vehicle})` : "";
  return `${SMS_BRAND}: ${driver}${vehicle} has arrived at your pickup point. ${OPT_OUT_SUFFIX}`;
}

/** Ride complete. */
export function friendRideCompletedSms(ctx: FriendRideSmsContext): string {
  const name = ctx.passengerName ? `${ctx.passengerName}, ` : "";
  return `${SMS_BRAND}: ${name}your ride is complete. Thanks for riding with us. ${OPT_OUT_SUFFIX}`;
}

/** Reply to an inbound HELP keyword. Carriers require a HELP response. */
export function helpReplySms(supportPhone: string, supportEmail: string): string {
  return `${SMS_BRAND} support: text ${supportPhone} or email ${supportEmail}. Msg&data rates may apply. Reply STOP to opt out.`;
}

/** Confirmation sent when someone opts out. */
export function optOutConfirmationSms(): string {
  return `${SMS_BRAND}: You have been unsubscribed and will get no further texts. Reply START to resubscribe.`;
}
