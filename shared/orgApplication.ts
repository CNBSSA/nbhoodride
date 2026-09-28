/**
 * Self-serve organization applications (Festus 2026-09-28, from the product
 * feedback: "org onboarding is manual — email to you; systematize early").
 *
 * A clinic, an office or a restaurant opens its own booking account: it
 * applies from the app with the business's details, PG Ride approves it in
 * Admin → Organizations or sends it back with a note, and the desk opens.
 * Modelled on the fleet application (shared/fleet.ts); the same legal
 * details (legal name, EIN, kind of business), plus the category and the
 * account's address. Until approved, the account can book nothing.
 */
import { isCategory, type CommercialCategory } from "./commercial";
import { BUSINESS_TYPES, normalizeEin, type BusinessType } from "./fleet";

export { BUSINESS_TYPES, BUSINESS_TYPE_LABELS, maskEin, normalizeEin } from "./fleet";

/** A booking account's life: applied (pending) → active, or sent back (rejected) → pending again; active ↔ paused. */
export const ORG_APPLICATION_STATUSES = ["pending", "active", "paused", "rejected"] as const;
export type OrgApplicationStatus = (typeof ORG_APPLICATION_STATUSES)[number];

export const ORG_STATUS_WORDS: Record<OrgApplicationStatus, string> = {
  pending: "Waiting for PG Ride to approve your account",
  active: "Approved: your desk is open",
  paused: "Paused by PG Ride",
  rejected: "Sent back by PG Ride: see the note, correct it and send it again",
};

/** Why an account that is not active cannot book, in words that say which state it is in. */
export function bookingRefusal(status: string | null | undefined): string {
  switch (status) {
    case "pending": return "PG Ride has not approved this account yet; nothing can be booked until it is.";
    case "rejected": return "This account's application was sent back; correct it on the desk and send it again before booking.";
    default: return "This organization is paused; nothing can be booked for it until it is active again.";
  }
}

export interface OrgApplication {
  name: string;
  category: CommercialCategory;
  legalName: string;
  ein: string;
  businessType: BusinessType;
  contactPhone: string;
  address: string | null;
}

const clean = (v: unknown, max: number) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);

/** Check an application; every problem is named so the form can say all of them at once. */
export function checkOrgApplication(body: any): { ok: true; value: OrgApplication } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const name = clean(body?.name, 80);
  const category = String(body?.category ?? "");
  const legalName = clean(body?.legalName, 120);
  const ein = normalizeEin(body?.ein);
  const businessType = String(body?.businessType ?? "");
  const phoneDigits = String(body?.contactPhone ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  const address = clean(body?.address, 200) || null;
  if (name.length < 2) problems.push("Give the account a name your staff will see.");
  if (!isCategory(category)) problems.push("Say what kind of organization it is: medical transportation, business, or food deliveries.");
  if (legalName.length < 2) problems.push("Enter the organization's legal name, as registered.");
  if (!ein) problems.push("Enter the organization's EIN: nine digits, like 12-3456789.");
  if (!(BUSINESS_TYPES as readonly string[]).includes(businessType)) problems.push("Say what kind of business it is.");
  if (!/^\d{10}$/.test(phoneDigits)) problems.push("Enter a 10-digit phone number PG Ride can call.");
  if (problems.length) return { ok: false, problems };
  return { ok: true, value: { name, category: category as CommercialCategory, legalName, ein: ein!, businessType: businessType as BusinessType, contactPhone: phoneDigits, address } };
}

/** What stops PG Ride approving a booking account: empty means it may be approved. */
export function orgApprovalProblems(org: { status?: string | null; category?: string | null; businessDetails?: { legalName?: string; ein?: string } | null }): string[] {
  const out: string[] = [];
  if (org.status !== "pending") out.push(`This account is ${org.status ?? "unknown"}; only an application waiting for a check can be approved.`);
  if (!isCategory(org.category)) out.push("This is not a booking account.");
  if (!org.businessDetails?.legalName || !normalizeEin(org.businessDetails?.ein)) out.push("The application is missing the organization's legal name or EIN.");
  return out;
}

export const ORG_APPLY_SENTENCE =
  "Book rides and deliveries for your patients, staff or customers and be billed weekly. PG Ride checks the organization before the desk opens; you then add the people who may book, and a bank account or card for the weekly statement.";
