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

// ── Slice 2: a fleet's cars ──────────────────────────────────────────────────
//
// A fleet's car is checked like any car on PG Ride: the same age, seats,
// VIN, photo and paper rules as a rental car (shared/rental.ts), plus PG
// Ride's own check of the papers before the car may carry riders. "Ready"
// means checked and qualified — the only state in which a car may be given to
// a driver (slice 3). Changing what the car IS sends it back to be checked;
// the hourly sweep parks a car the hour a paper lapses, warning ahead.

import { MAX_CAR_AGE_YEARS, MAX_SEATS, MIN_PHOTOS, isPlausibleVin } from "./rental";

export const FLEET_CAR_STATUSES = ["parked", "ready"] as const;
export type FleetCarStatus = (typeof FLEET_CAR_STATUSES)[number];

export const FLEET_CAR_REVIEW_STATUSES = ["pending", "approved", "rejected"] as const;

/** Fields whose change sends a fleet car back to PG Ride to be checked. A colour or a photo does not. */
export const FLEET_CAR_REVIEWED_FIELDS = [
  "make", "model", "year", "licensePlate", "vin", "seats", "vehicleType",
  "registrationDocUrl", "insuranceDocUrl", "inspectionDocUrl",
  "inspectionExpires", "registrationExpires", "insuranceExpires",
] as const;

export interface FleetCarForCheck {
  year: number | null | undefined;
  seats: number | null | undefined;
  licensePlate: string | null | undefined;
  vin: string | null | undefined;
  photos: unknown;
  registrationDocUrl?: string | null;
  insuranceDocUrl?: string | null;
  inspectionDocUrl?: string | null;
  inspectionExpires: Date | string | null | undefined;
  registrationExpires: Date | string | null | undefined;
  insuranceExpires: Date | string | null | undefined;
  reviewStatus?: string | null;
}

const inDate = (d: Date | string | null | undefined, now: Date): boolean => {
  if (!d) return false;
  const t = new Date(d).getTime();
  return Number.isFinite(t) && t > now.getTime();
};

/**
 * Why a fleet car may not carry riders, in words the owner can act on. Empty
 * = ready. A car is ready only while this is empty; the sweep parks it the
 * hour it stops being so.
 */
export function fleetCarProblems(car: FleetCarForCheck, now: Date = new Date()): string[] {
  const out: string[] = [];
  const year = Number(car.year);
  if (!Number.isInteger(year)) out.push("Model year is missing.");
  else if (year < now.getUTCFullYear() - MAX_CAR_AGE_YEARS) out.push(`The car is more than ${MAX_CAR_AGE_YEARS} model years old.`);
  const seats = Number(car.seats);
  if (!Number.isInteger(seats) || seats < 2) out.push("Number of seats is missing.");
  else if (seats > MAX_SEATS) out.push(`The car seats more than ${MAX_SEATS} including the driver.`);
  if (!String(car.licensePlate ?? "").trim()) out.push("Licence plate is missing.");
  if (!isPlausibleVin(car.vin)) out.push("VIN is missing or not 17 valid characters.");
  const photos = Array.isArray(car.photos) ? car.photos.filter((p) => typeof p === "string" && p) : [];
  if (photos.length < MIN_PHOTOS) out.push(`At least ${MIN_PHOTOS} photos of the car are needed (${photos.length} on file).`);
  const docs: Array<[string, unknown]> = [
    ["registration card", car.registrationDocUrl], ["insurance card (commercial or rideshare cover)", car.insuranceDocUrl], ["inspection certificate", car.inspectionDocUrl],
  ];
  for (const [name, url] of docs) if (!url) out.push(`A photo of the ${name} is missing.`);
  if (!inDate(car.inspectionExpires, now)) out.push("Safety inspection is missing or expired.");
  if (!inDate(car.registrationExpires, now)) out.push("Registration is missing or expired.");
  if (!inDate(car.insuranceExpires, now)) out.push("Insurance is missing or expired.");
  if (car.reviewStatus === "rejected") out.push("PG Ride could not accept the papers; see the note, fix them and send again.");
  else if (car.reviewStatus !== "approved") out.push("PG Ride has not checked the papers yet.");
  return out;
}

export const FLEET_CAR_STATUS_WORDS: Record<FleetCarStatus, string> = {
  parked: "Parked: not on the road",
  ready: "Ready: may carry riders",
};

// ── Slice 3: drivers and cars ────────────────────────────────────────────────
//
// A fleet invites its drivers; PG Ride alone approves a driver (a fleet can
// never approve its own); a driver drives for one fleet at a time; the owner
// or a manager gives a ready car to one of the fleet's approved drivers, one
// car per driver and one driver per car, and takes it back. While a driver
// has a car it is copied into their vehicles so riders and dispatch see it
// like an owned car; a car that is parked stops being drivable at once.

/** A driver drives for one fleet at a time (Festus, 2026-09-28). */
export const ONE_FLEET_RULE = "A driver drives for one fleet at a time.";

/** What the inviting fleet is told: it never learns which other fleet. */
export const OTHER_FLEET_FOR_DESK = `That person already drives for another fleet on PG Ride. ${ONE_FLEET_RULE} They leave that fleet first.`;

/** What the driver is told when they try to join a second fleet. */
export function otherFleetForDriver(otherFleetName: string): string {
  return `You already drive for ${otherFleetName}. ${ONE_FLEET_RULE} Ask ${otherFleetName} to remove you first, then open this invitation again.`;
}

/** PG Ride's driver approval, in words the fleet desk shows. A fleet never changes it. */
export function driverApprovalWords(approvalStatus: string | null | undefined): string {
  switch (approvalStatus) {
    case "approved": return "Approved by PG Ride";
    case "pending": return "Waiting for PG Ride to check their documents";
    case "background_check_pending": return "Background check under way";
    case "rejected": return "Not approved by PG Ride";
    case "suspended": return "Suspended by PG Ride";
    case null: case undefined: case "": return "Has not applied to drive yet";
    default: return `PG Ride: ${approvalStatus}`;
  }
}

export interface AssignCheck {
  car: FleetCarForCheck & { status?: string | null; driverUserId?: string | null; organizationId?: string | null };
  fleetId: string;
  fleetStatus: string | null | undefined;
  /** The driver's role in THIS fleet, or null. */
  driverRole: OrgRole | null | undefined;
  /** driver_profiles.approval_status, or null when they never applied. */
  driverApproval: string | null | undefined;
  driverSuspended?: boolean | null;
  /** Another car of this fleet the driver already has, or null. */
  driverHasCarId?: string | null;
  now?: Date;
}

/**
 * Why a car may not be given to a driver, in words the desk can act on.
 * Empty = it may. The car must be the fleet's, ready (checked and
 * qualified) and free; the driver the fleet's own driver, approved by PG
 * Ride and not suspended, without another of the fleet's cars.
 */
export function assignProblems(input: AssignCheck): string[] {
  const out: string[] = [];
  const now = input.now ?? new Date();
  if (input.fleetStatus !== "active") out.push("PG Ride has not approved this fleet, or it is paused: cars are given to drivers only while it is open.");
  if (input.car.organizationId && input.car.organizationId !== input.fleetId) out.push("That car is not this fleet's.");
  const carProblems = fleetCarProblems(input.car, now);
  if (input.car.status !== "ready" || carProblems.length) out.push(`The car is not ready to carry riders${carProblems.length ? `: ${carProblems.join(" ")}` : "."}`);
  if (input.car.driverUserId) out.push("The car is already with a driver. Take it back first.");
  if (input.driverRole !== "driver") out.push("That person is not one of this fleet's drivers. Invite them as a driver first.");
  if (input.driverApproval !== "approved") out.push(`PG Ride has not approved them as a driver (status: ${driverApprovalWords(input.driverApproval)}). A fleet cannot approve its own drivers: they finish PG Ride's driver application and PG Ride checks it.`);
  else if (input.driverSuspended) out.push("PG Ride has suspended them as a driver.");
  if (input.driverHasCarId) out.push("They already have one of the fleet's cars. One car per driver: take that one back first.");
  return out;
}

/**
 * May a driver go online, as far as fleet cars go? `otherCars` counts every
 * vehicle of theirs that is not a fleet car's copy (their own, or a PG Ride
 * rental, which has its own check). A driver whose only car is a fleet car
 * drives it only while it is ready.
 */
export function fleetCarMayDrive(input: {
  otherCars: number;
  fleetCar: { label: string; status: string; parkedReason?: string | null } | null;
  hasFleetCopy: boolean;
}): { ok: true } | { ok: false; reason: string } {
  if (input.otherCars > 0) return { ok: true };
  if (input.fleetCar && input.fleetCar.status === "ready" && input.hasFleetCopy) return { ok: true };
  if (input.fleetCar) {
    return { ok: false, reason: `Your fleet car ${input.fleetCar.label} is parked${input.fleetCar.parkedReason ? `: ${input.fleetCar.parkedReason}` : "."} You can go online in it once your fleet puts it right.` };
  }
  return { ok: true };
}
