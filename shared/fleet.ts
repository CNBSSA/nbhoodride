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

// ── Slice 4: the 25/75 split and the Friday payout ───────────────────────────
//
// PG Ride keeps its 15% of every fare as on any ride. On a ride driven in a
// fleet's car the driver's 85% of the FARE is shared: 25% to the fleet owner,
// 75% to the driver (fleetSplit above). A tip is never shared. The driver's
// cut of a waiting charge, a cancellation fee or a no-show fee earned in a
// fleet car is shared the same way, because the car earned it. Anything
// earned in the driver's own car is theirs alone. Each split is written once,
// whatever retries happen; the fleet's money waits in fleet_earnings until
// the Friday payday sends it to the fleet's own account.
//
// Tax forms: PG Ride pays a fleet as a business, so it will owe the fleet a
// year-end information return (1099). How and by whom is to be settled with
// Festus's accountant BEFORE fleet money moves in production: FLEET_ENABLED
// stays off there until that decision. The admin's yearly total per fleet
// (legal name, EIN, paid in the year) is the record the accountant files from.

import { paydayFor, type PaydayDecision } from "./paydayCycle";
import { settlesInCash } from "./paymentMethods";

/** What a fleet can earn from, one row per ride and kind (fleet_earnings.kind). */
export const FLEET_EARNING_KINDS = ["fare", "waiting", "cancel_fee", "no_show_fee"] as const;
export type FleetEarningKind = (typeof FLEET_EARNING_KINDS)[number];

export const FLEET_EARNING_KIND_WORDS: Record<FleetEarningKind, string> = {
  fare: "Ride",
  waiting: "Waiting at the door",
  cancel_fee: "Late cancel fee",
  no_show_fee: "No-show fee",
};

export interface VehicleForFleetRide { fleetCarId?: string | null }
export interface FleetCarForRide { id: string; organizationId: string; driverUserId: string | null }
export interface FleetForRide { id: string; category: string | null; status: string | null }

/**
 * Was this ride driven in a fleet's car? Rides do not record a vehicle, so
 * the rule follows what the rider was shown: the driver's FIRST vehicle in
 * the order riders and dispatch read (their own cars first, then a PG Ride
 * rental or fleet copy; storage.getVehiclesByDriverId). It is a fleet ride
 * when fleets are switched on, that first vehicle is a fleet car's copy, the
 * car is still with this driver, and its fleet is open. A driver with a car
 * of their own drives it first, so nothing they earn is shared. A ride taken
 * in cash (before cash was discontinued) is never split: the fleet's share
 * would be in the driver's pocket, and there is nothing to credit.
 */
export function fleetRideFor(input: {
  enabled: boolean;
  driverUserId: string | null | undefined;
  paymentMethod?: string | null;
  vehiclesInOrder: VehicleForFleetRide[];
  car: FleetCarForRide | null | undefined;
  fleet: FleetForRide | null | undefined;
}): { fleetCarId: string; fleetOrgId: string } | null {
  if (!input.enabled || !input.driverUserId) return null;
  if (input.paymentMethod !== undefined && settlesInCash(input.paymentMethod)) return null;
  const first = input.vehiclesInOrder[0];
  if (!first?.fleetCarId) return null;
  const car = input.car;
  if (!car || car.id !== first.fleetCarId || car.driverUserId !== input.driverUserId) return null;
  const fleet = input.fleet;
  if (!fleet || fleet.id !== car.organizationId || fleet.category !== "fleet" || fleet.status !== "active") return null;
  return { fleetCarId: car.id, fleetOrgId: fleet.id };
}

const cents = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
};

/**
 * A completed fleet ride's figures. `driverFareShare` is the driver's 85%
 * (shared/payoutPolicy.ts splitFare); the tip rides beside it untouched.
 * driverEarnings is what the driver is credited (their 75% plus the whole
 * tip) and fleetShare the fleet's 25%, so driverEarnings + fleetShare + PG
 * Ride's 15% accounts for every cent of the fare and the tip.
 */
export function fleetRideSplit(driverFareShare: unknown, tip: unknown): { gross: number; fleetShare: number; driverKeeps: number; tip: number; driverEarnings: number } {
  const gross = cents(driverFareShare) / 100;
  const t = cents(tip);
  const { fleetShare, driverKeeps } = fleetSplit(gross);
  return { gross, fleetShare, driverKeeps, tip: t / 100, driverEarnings: (Math.round(driverKeeps * 100) + t) / 100 };
}

/** The driver's cut of a fee earned in a fleet car: shared 25/75 like the fare. */
export function fleetFeeSplit(driverCut: unknown): { gross: number; fleetShare: number; driverKeeps: number } {
  const gross = cents(driverCut) / 100;
  return { gross, ...fleetSplit(gross) };
}

/**
 * What a fleet is paid on Friday: everything credited to it and not yet
 * paid, when it is open and has an account on file, and at least the
 * payday minimum (a smaller sum rides to next Friday, as for drivers).
 */
export function fleetPaydayFor(input: { owed: unknown; status: string | null | undefined; payoutMethod?: string | null; payoutDetails?: string | null }): PaydayDecision {
  const owed = cents(input.owed) / 100;
  if (owed <= 0) return { amount: 0, pay: false, reason: "Nothing owed" };
  if (input.status !== "active") return { amount: 0, pay: false, reason: `The fleet is ${input.status ?? "not open"}; PG Ride decides by hand` };
  const d = paydayFor(owed, !!(input.payoutMethod && input.payoutDetails));
  if (!d.pay && /payout method/i.test(d.reason)) return { ...d, reason: "No payout method on file — the fleet's owner adds one on the fleet desk" };
  return d;
}

export interface FleetEarningLine {
  kind: string;
  fleetCarId: string;
  carLabel: string;
  driverUserId: string;
  driverName: string;
  /** The ride's fare (0 on a fee). */
  fare: number;
  gross: number;
  fleetShare: number;
  driverKeeps: number;
}

export interface FleetEarningTotals { rides: number; fares: number; gross: number; fleetShare: number; driversShare: number }

const add = (a: number, b: number) => Math.round((a + b) * 100) / 100;
const emptyTotals = (): FleetEarningTotals => ({ rides: 0, fares: 0, gross: 0, fleetShare: 0, driversShare: 0 });
const addLine = (t: FleetEarningTotals, l: FleetEarningLine) => {
  if (l.kind === "fare") { t.rides += 1; t.fares = add(t.fares, l.fare); }
  t.gross = add(t.gross, l.gross); t.fleetShare = add(t.fleetShare, l.fleetShare); t.driversShare = add(t.driversShare, l.driverKeeps);
};

/**
 * The fleet desk's Earnings view: the week's totals, per car and per
 * driver. Rides counts completed fares only (a fee is not a ride); the
 * drivers' share is their 75%, never their tips, which are not the fleet's
 * business.
 */
export function groupFleetEarnings(lines: FleetEarningLine[]): {
  totals: FleetEarningTotals;
  byCar: Array<FleetEarningTotals & { fleetCarId: string; carLabel: string }>;
  byDriver: Array<FleetEarningTotals & { driverUserId: string; driverName: string }>;
} {
  const totals = emptyTotals();
  const cars = new Map<string, FleetEarningTotals & { fleetCarId: string; carLabel: string }>();
  const drivers = new Map<string, FleetEarningTotals & { driverUserId: string; driverName: string }>();
  for (const l of lines) {
    addLine(totals, l);
    if (!cars.has(l.fleetCarId)) cars.set(l.fleetCarId, { fleetCarId: l.fleetCarId, carLabel: l.carLabel, ...emptyTotals() });
    addLine(cars.get(l.fleetCarId)!, l);
    if (!drivers.has(l.driverUserId)) drivers.set(l.driverUserId, { driverUserId: l.driverUserId, driverName: l.driverName, ...emptyTotals() });
    addLine(drivers.get(l.driverUserId)!, l);
  }
  const byShare = <T extends FleetEarningTotals>(a: T, b: T) => b.fleetShare - a.fleetShare;
  return { totals, byCar: Array.from(cars.values()).sort(byShare), byDriver: Array.from(drivers.values()).sort(byShare) };
}

export const FLEET_PAYOUT_STATUS_WORDS: Record<string, string> = {
  requested: "Waiting for PG Ride to send it",
  sent: "Sent by PG Ride",
};

// ── Slice 3, finished (2026-09-30): telling the driver, and approval revoked ──
//
// Giving a driver a car, or taking it back, used to page ops and change the
// car riders see without a word to the driver: they found out when the app
// would not let them go online. Now the driver is told in the app each time,
// in the words below.
//
// A fleet car is only ever with a driver PG Ride has approved. Assigning
// checks it (assignProblems); until now nothing checked it again, so a
// driver whose approval PG Ride revoked, or who was suspended, kept the
// fleet's car and its copy in their vehicles. `fleetCarHoldProblem` is the
// rule for "may this person still hold a fleet car", applied when PG Ride
// changes a driver or an account and again by the hourly sweep as a net for
// any door that changes them some other way.

export interface FleetCarHolder {
  approvalStatus: string | null | undefined;
  driverSuspended: boolean | null | undefined;
  accountApproved: boolean | null | undefined;
  accountSuspended: boolean | null | undefined;
  deleted?: boolean | null;
}

/** Why this person may no longer hold a fleet car, or null when they still may. */
export function fleetCarHoldProblem(h: FleetCarHolder): string | null {
  if (h.deleted) return "The PG Ride account was closed.";
  if (h.accountSuspended) return "The PG Ride account is suspended.";
  if (h.accountApproved === false) return "The PG Ride account is no longer approved.";
  if (h.approvalStatus !== "approved") return `Driver approval is no longer in place (status: ${driverApprovalWords(h.approvalStatus)}).`;
  if (h.driverSuspended) return "Driving is suspended by PG Ride.";
  return null;
}

/** The in-app notice a driver gets when their fleet gives them a car. */
export function fleetCarGivenNotice(fleetName: string, carLabel: string): { title: string; body: string } {
  return {
    title: `${fleetName} gave you a car`,
    body: `${carLabel} is now your car on PG Ride: riders see it when you drive. On rides in it your 85% of the fare is shared 75% to you and 25% to ${fleetName}, and every tip is yours.`,
  };
}

/**
 * The in-app notice when the car goes back. `why` is PG Ride's reason when
 * PG Ride took it (approval revoked); a fleet taking its car back gives none.
 */
export function fleetCarTakenBackNotice(fleetName: string, carLabel: string, opts: { hasOtherCar: boolean; why?: string | null }): { title: string; body: string } {
  const who = opts.why ? `PG Ride took ${carLabel} back for ${fleetName}. Reason: ${opts.why}` : `${fleetName} took ${carLabel} back.`;
  const next = opts.hasOtherCar
    ? "You can still drive in your own car."
    : "You have no car on PG Ride now, so you cannot go online until you have one.";
  return { title: `${carLabel} is no longer yours to drive`, body: `${who} ${next}` };
}
