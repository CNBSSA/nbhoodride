/**
 * A rider asking to send a parcel (Festus 2026-09-28, from the product
 * feedback: "typing 'send a package' just becomes a ride request; if
 * consumers shouldn't send parcels, don't let the UI promise it").
 *
 * PG Ride carries parcels for businesses only (shared/deliveries.ts: a
 * business or food account books a parcel from its desk). A rider's own
 * words asking for a delivery are recognised here, once, so the intent box,
 * the assistant and the SMS agent all give the same honest answer and point
 * to the business door instead of quietly booking a ride.
 */

/** Where a business opens its account (self-serve organization applications). */
export const BUSINESS_DOOR_PATH = "/org/apply";

const PARCEL_WORDS = /\b(package|packages|parcel|parcels|courier|deliver(?:y|ies|ed|ing)?|drop\s*off|drop-off|ship(?:ping)?|send(?:ing)?\s+(?:a|an|my|this|the|some)\s+(?:box|boxes|item|items|envelope|envelopes|letter|letters|document|documents|bag|bags|food|order|orders|groceries|package|parcel|gift|gifts)|pick\s*up\s+(?:a|an|my|the|some)\s+(?:package|parcel|order|delivery|food|groceries))\b/i;

/** "Deliver me to …" is a ride; "deliver a package" is not. */
const RIDE_NOT_PARCEL = /\b(deliver(?:y)?\s+me\b|drop\s*(?:me|us|him|her|them)\s+off|pick\s*(?:me|us|him|her|them)\s+up)/i;

/** Does this text ask PG Ride to move a thing rather than a person? */
export function isParcelAsk(text: unknown): boolean {
  const s = String(text ?? "").trim();
  if (!s) return false;
  if (RIDE_NOT_PARCEL.test(s) && !/\b(package|parcel|courier)\b/i.test(s)) return false;
  return PARCEL_WORDS.test(s);
}

/** The one answer, everywhere. */
export const PARCEL_REFUSAL = {
  title: "PG Ride carries parcels for businesses",
  message: "Riders book rides for people. A shop, office or clinic sends parcels from its own business account, billed weekly, with proof of delivery.",
  action: "Run a business? Open an account",
  path: BUSINESS_DOOR_PATH,
};

/** The same answer as one text, for SMS and the assistant. */
export function parcelRefusalText(appUrl: string): string {
  return `${PARCEL_REFUSAL.title}. ${PARCEL_REFUSAL.message} ${PARCEL_REFUSAL.action}: ${appUrl.replace(/\/$/, "")}${BUSINESS_DOOR_PATH}`;
}
