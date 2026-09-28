/**
 * Fleet management accounts — the pure rules (PG Ride Fleet Management
 * Accounts Plan, Festus 2026-09-28).
 *
 * A fleet is PG Ride's fourth kind of organization, beside medical, business
 * and food: an investor's cars, driven by PG Ride drivers, with the driver's
 * share of every ride split 25% to the fleet owner and 75% to the driver
 * ("25/75 of the driver's 85%", Festus 2026-09-28). A fleet never books rides
 * and is never billed; it is paid.
 *
 * Slice 1 (this file's first part): an investor applies with the business's
 * details, PG Ride approves or sends the application back, and the owner puts
 * a payout method on file. The split itself moves money only in slice 4; its
 * arithmetic lives here so it is decided once and tested.
 *
 * Adopted by industry practice (2026-09-28, changeable here): a fleet is a
 * registered business or sole proprietor with an EIN; it is paid into an
 * account in its own name; there is no minimum number of cars.
 */
import { FLEET_ROLES, type OrgRole } from "./commercial";

export { FLEET_ROLES, FLEET_CATEGORY, isFleetCategory } from "./commercial";

export const FLEET_LABEL = "Fleet management";

/**
 * A fleet account's life: an application is pending until PG Ride approves
 * it (active) or sends it back (rejected, with a note the owner sees, and
 * the owner may correct and send it again). An active fleet may be paused.
 */
export const FLEET_STATUSES = ["pending", "active", "paused", "rejected"] as const;
export type FleetStatus = (typeof FLEET_STATUSES)[number];

export const FLEET_STATUS_WORDS: Record<FleetStatus, string> = {
  pending: "Waiting for PG Ride to check your application",
  active: "Approved: your fleet is open",
  paused: "Paused by PG Ride",
  rejected: "Sent back by PG Ride: see the note, correct it and send it again",
};

export const BUSINESS_TYPES = ["llc", "corporation", "partnership", "sole_proprietor"] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];
export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  llc: "LLC",
  corporation: "Corporation",
  partnership: "Partnership",
  sole_proprietor: "Sole proprietor",
};

/** How a fleet is paid; the account must be in the business's own name. Same doors as drivers and car owners. */
export const FLEET_PAYOUT_METHODS = ["zelle", "cashapp", "paypal", "check"] as const;
export type FleetPayoutMethod = (typeof FLEET_PAYOUT_METHODS)[number];

// ── Who may do what ───────────────────────────────────────────────────────────

export const isFleetRole = (v: unknown): v is (typeof FLEET_ROLES)[number] => (FLEET_ROLES as readonly string[]).includes(v as string);
/** Everyone in the fleet but its drivers sees the desk. */
export function canSeeFleetDesk(role: OrgRole | null | undefined): boolean {
  return role === "owner" || role === "manager" || role === "viewer";
}
/** Cars and drivers: the owner and managers. */
export function canManageFleet(role: OrgRole | null | undefined): boolean {
  return role === "owner" || role === "manager";
}
/** Money and people: the owner alone. */
export function canManageFleetMoney(role: OrgRole | null | undefined): boolean {
  return role === "owner";
}

// ── The application ──────────────────────────────────────────────────────────

export interface FleetApplication {
  name: string;
  legalName: string;
  ein: string;
  businessType: BusinessType;
  contactPhone: string;
}

const clean = (v: unknown, max: number) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);

/** An EIN is nine digits, written XX-XXXXXXX. */
export function normalizeEin(v: unknown): string | null {
  const digits = String(v ?? "").replace(/[\s-]/g, "");
  if (!/^\d{9}$/.test(digits) || /^0+$/.test(digits)) return null;
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

/** What the desk and the admin list show of an EIN: the last four digits. */
export function maskEin(ein: string | null | undefined): string {
  const digits = String(ein ?? "").replace(/\D/g, "");
  return digits.length === 9 ? `XX-XXX${digits.slice(5)}` : "";
}

/** Check an application; every problem is named so the form can say all of them at once. */
export function checkFleetApplication(body: any): { ok: true; value: FleetApplication } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const name = clean(body?.name, 80);
  const legalName = clean(body?.legalName, 120);
  const ein = normalizeEin(body?.ein);
  const businessType = String(body?.businessType ?? "");
  const phoneDigits = String(body?.contactPhone ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (name.length < 2) problems.push("Give the fleet a name riders and drivers will see.");
  if (legalName.length < 2) problems.push("Enter the business's legal name, as registered.");
  if (!ein) problems.push("Enter the business's EIN: nine digits, like 12-3456789.");
  if (!(BUSINESS_TYPES as readonly string[]).includes(businessType)) problems.push("Say what kind of business it is.");
  if (!/^\d{10}$/.test(phoneDigits)) problems.push("Enter a 10-digit phone number PG Ride can call.");
  if (problems.length) return { ok: false, problems };
  return { ok: true, value: { name, legalName, ein: ein!, businessType: businessType as BusinessType, contactPhone: phoneDigits } };
}

/** What stops PG Ride approving a fleet: empty means it may be approved. */
export function approvalProblems(fleet: { status?: string | null; payoutMethod?: string | null; payoutDetails?: string | null; fleetDetails?: { legalName?: string; ein?: string } | null }): string[] {
  const out: string[] = [];
  if (fleet.status !== "pending") out.push(`This fleet is ${fleet.status ?? "unknown"}; only an application waiting for a check can be approved.`);
  if (!fleet.fleetDetails?.legalName || !normalizeEin(fleet.fleetDetails?.ein)) out.push("The application is missing the business's legal name or EIN.");
  if (!fleet.payoutMethod || !fleet.payoutDetails) out.push("The fleet has not said how it is paid yet: a payout method in the business's name is needed first.");
  return out;
}

// ── The split (money moves with it in slice 4) ───────────────────────────────

/** The fleet owner's part of the driver's share on a fleet car (Festus: "25/75 of the driver's 85%"). */
export const FLEET_OWNER_SHARE = 0.25;

/**
 * Split the driver's share of a ride between the fleet owner and the driver.
 * The fleet's 25% is rounded to the cent and the driver keeps the rest, so the
 * two always add up to the driver's share exactly. Tips are never passed in.
 */
export function fleetSplit(driverShare: unknown): { fleetShare: number; driverKeeps: number } {
  const n = typeof driverShare === "number" ? driverShare : parseFloat(String(driverShare ?? ""));
  const cents = Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
  const fleetCents = Math.round(cents * FLEET_OWNER_SHARE);
  return { fleetShare: fleetCents / 100, driverKeeps: (cents - fleetCents) / 100 };
}

export const FLEET_TERMS_SENTENCE =
  "PG Ride keeps its 15% of every fare as on every ride. The driver's 85% is shared: 25% to the fleet owner and 75% to the driver, and every tip is the driver's. PG Ride pays the fleet owner and each driver directly, every Friday. A fleet never sees a rider's name, phone or address.";
