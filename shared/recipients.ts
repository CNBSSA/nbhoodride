/**
 * The recipient book — "the house is the house" (Festus, 2026-09-16).
 *
 * A delivery account sends to the same people again and again: a saved
 * recipient is a name, a phone, an address, how the parcel changes hands
 * and a note. The parcel drawer fills itself from one; a past job offers
 * "Send again". A recipient is saved from the booking itself (the desk
 * ticks "remember"), edits never rewrite past jobs (each job keeps its own
 * snapshot), and removing one hides it without touching history.
 */
import { handoverOf } from "./deliveries";

export interface RecipientInput {
  name?: unknown;
  phone?: unknown;
  address?: { lat?: unknown; lng?: unknown; address?: unknown } | null;
  handover?: unknown;
  note?: unknown;
}

export interface Recipient {
  name: string;
  phone: string | null;
  address: { lat: number; lng: number; address: string };
  handover: string;
  note: string | null;
}

/** Digits only, so the same person typed two ways is one entry. */
export function recipientPhoneKey(phone: unknown): string | null {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits.length === 10 ? digits : null;
}

const clean = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

export function normalizeRecipient(input: RecipientInput): { valid: true; recipient: Recipient } | { valid: false; error: string } {
  const name = clean(input.name, 120);
  if (!name) return { valid: false, error: "The recipient needs a name." };
  const rawPhone = clean(input.phone, 40);
  const phone = rawPhone ? recipientPhoneKey(rawPhone) : null;
  if (rawPhone && !phone) return { valid: false, error: "The phone must be a 10-digit US number." };
  const lat = Number(input.address?.lat), lng = Number(input.address?.lng);
  const addr = clean(input.address?.address, 200);
  if (!addr || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return { valid: false, error: "Pick the recipient's address from the suggestions." };
  return { valid: true, recipient: { name, phone, address: { lat, lng, address: addr }, handover: handoverOf(input.handover), note: clean(input.note, 200) || null } };
}
