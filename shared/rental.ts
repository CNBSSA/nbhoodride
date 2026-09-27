/**
 * Car rental — the rules, in one place (PG Ride Car Rental Master Plan,
 * phase 1: PG Ride's own fleet, rented by the public).
 *
 * Nothing here touches the database or Stripe: the server module
 * (server/rental/) asks these functions what is allowed and what it costs,
 * and the page shows the same words the server uses.
 *
 * Decisions taken here that Festus may change (named in the plan):
 *   - MAX_RENTAL_DAYS = 6. A deposit is held on the renter's card, and a card
 *     hold lasts seven days; a longer rental would outlive its own deposit.
 *     Weekly rentals for drivers come with phase 3 and are paid differently.
 *   - MAX_CAR_AGE_YEARS = 12. The Maryland rideshare vehicle limit as found
 *     in research, to be confirmed by counsel; applied to every listed car so
 *     "listed" always means "qualified".
 *   - Cancelling is free until the car is collected: no money moves before
 *     collection, so there is nothing to keep.
 *   - LATE_GRACE_MINUTES = 59: the first hour late is not charged.
 */

export const RENTAL_OWNER_KINDS = ["fleet", "private"] as const;
export type RentalOwnerKind = (typeof RENTAL_OWNER_KINDS)[number];

export const RENTAL_CAR_STATUSES = ["hidden", "listed"] as const;
export type RentalCarStatus = (typeof RENTAL_CAR_STATUSES)[number];

/** requested → confirmed → collected → returned → closed; or declined / cancelled. */
export const RENTAL_BOOKING_STATUSES = ["requested", "confirmed", "collected", "returned", "closed", "declined", "cancelled"] as const;
export type RentalBookingStatus = (typeof RENTAL_BOOKING_STATUSES)[number];

/** Statuses that hold the car: no other booking may overlap one of these. */
export const HOLDS_THE_CAR: readonly RentalBookingStatus[] = ["confirmed", "collected", "returned"];
/** Statuses a renter may still cancel from. */
export const RENTER_MAY_CANCEL: readonly RentalBookingStatus[] = ["requested", "confirmed"];

export const MAX_RENTAL_DAYS = 6;
export const MIN_LEAD_MINUTES = 60;
export const MAX_BOOK_AHEAD_DAYS = 90;
export const MAX_CAR_AGE_YEARS = 12;
export const MAX_SEATS = 8;
export const MIN_PHOTOS = 4;
export const LATE_GRACE_MINUTES = 59;
export const EXPIRY_WARNING_DAYS = [30, 7] as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : NaN;
};

// ── Qualification ────────────────────────────────────────────────────────────

export interface CarForQualification {
  year: number | null | undefined;
  seats: number | null | undefined;
  licensePlate: string | null | undefined;
  vin: string | null | undefined;
  photos: unknown;
  dailyPrice: unknown;
  deposit: unknown;
  pickupLocation: { lat?: unknown; lng?: unknown; address?: unknown } | null | undefined;
  inspectionExpires: Date | string | null | undefined;
  registrationExpires: Date | string | null | undefined;
  insuranceExpires: Date | string | null | undefined;
}

/** A VIN is 17 characters, letters and digits, never I, O or Q. */
export function isPlausibleVin(vin: unknown): boolean {
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(String(vin ?? "").trim().toUpperCase());
}

const expiresAfter = (d: Date | string | null | undefined, now: Date): boolean => {
  if (!d) return false;
  const t = new Date(d).getTime();
  return Number.isFinite(t) && t > now.getTime();
};

/**
 * Why a car may not be listed, in words an admin can act on. Empty = qualified.
 * A car is listed only while this is empty, and the sweep hides it the day it
 * stops being so.
 */
export function qualificationProblems(car: CarForQualification, now: Date = new Date()): string[] {
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
  const daily = num(car.dailyPrice);
  if (!(daily > 0)) out.push("Daily price is missing.");
  const deposit = num(car.deposit);
  if (!(deposit >= 0)) out.push("Deposit is missing.");
  const p = car.pickupLocation;
  if (!p || !Number.isFinite(Number(p.lat)) || !Number.isFinite(Number(p.lng)) || !String(p.address ?? "").trim()) out.push("Pick-up place is missing.");
  if (!expiresAfter(car.inspectionExpires, now)) out.push("Safety inspection is missing or expired.");
  if (!expiresAfter(car.registrationExpires, now)) out.push("Registration is missing or expired.");
  if (!expiresAfter(car.insuranceExpires, now)) out.push("Insurance is missing or expired.");
  return out;
}

/** The expiry dates that fall on one of the warning days, for the owner's reminder. */
export function expiryWarnings(car: Pick<CarForQualification, "inspectionExpires" | "registrationExpires" | "insuranceExpires">, now: Date = new Date()): Array<{ document: string; daysLeft: number }> {
  const out: Array<{ document: string; daysLeft: number }> = [];
  const docs: Array<[string, Date | string | null | undefined]> = [
    ["safety inspection", car.inspectionExpires], ["registration", car.registrationExpires], ["insurance", car.insuranceExpires],
  ];
  for (const [document, d] of docs) {
    if (!d) continue;
    const daysLeft = Math.ceil((new Date(d).getTime() - now.getTime()) / DAY_MS);
    if ((EXPIRY_WARNING_DAYS as readonly number[]).includes(daysLeft)) out.push({ document, daysLeft });
  }
  return out;
}

// ── Quote ────────────────────────────────────────────────────────────────────

export interface RentalQuote {
  startsAt: Date;
  endsAt: Date;
  days: number;
  dailyPrice: number;
  rentalTotal: number;
  deposit: number;
  milesAllowed: number;
}

export type QuoteResult = { ok: true; quote: RentalQuote } | { ok: false; error: string };

/**
 * What a rental costs, from the car's own prices — never from the page.
 * A day is 24 hours from collection; part of a day counts as a day.
 */
export function quoteRental(
  car: { dailyPrice: unknown; deposit: unknown; milesPerDay: unknown },
  startsAtRaw: unknown,
  endsAtRaw: unknown,
  now: Date = new Date(),
): QuoteResult {
  const startsAt = new Date(String(startsAtRaw ?? ""));
  const endsAt = new Date(String(endsAtRaw ?? ""));
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime())) return { ok: false, error: "Pick when you collect the car and when you bring it back." };
  if (endsAt.getTime() <= startsAt.getTime()) return { ok: false, error: "The return has to be after the collection." };
  if (startsAt.getTime() < now.getTime() + MIN_LEAD_MINUTES * 60_000) return { ok: false, error: `Collection has to be at least ${MIN_LEAD_MINUTES} minutes from now.` };
  if (startsAt.getTime() > now.getTime() + MAX_BOOK_AHEAD_DAYS * DAY_MS) return { ok: false, error: `Rentals can be booked up to ${MAX_BOOK_AHEAD_DAYS} days ahead.` };
  const days = Math.max(1, Math.ceil((endsAt.getTime() - startsAt.getTime()) / DAY_MS));
  if (days > MAX_RENTAL_DAYS) return { ok: false, error: `A rental can be up to ${MAX_RENTAL_DAYS} days for now.` };
  const dailyPrice = num(car.dailyPrice);
  const deposit = num(car.deposit);
  const milesPerDay = num(car.milesPerDay);
  if (!(dailyPrice > 0) || !(deposit >= 0)) return { ok: false, error: "This car has no price yet." };
  return {
    ok: true,
    quote: {
      startsAt, endsAt, days,
      dailyPrice: round2(dailyPrice),
      rentalTotal: round2(dailyPrice * days),
      deposit: round2(deposit),
      milesAllowed: milesPerDay > 0 ? Math.round(milesPerDay * days) : 0,
    },
  };
}

/** Do two stays on the same car overlap? Touching end to start does not. */
export function rentalsOverlap(a: { startsAt: Date | string; endsAt: Date | string }, b: { startsAt: Date | string; endsAt: Date | string }): boolean {
  return new Date(a.startsAt).getTime() < new Date(b.endsAt).getTime() && new Date(b.startsAt).getTime() < new Date(a.endsAt).getTime();
}

// ── Return and settlement ────────────────────────────────────────────────────

export interface ReturnInput {
  milesAllowed: number;
  collectOdometer: number;
  returnOdometer: number;
  extraMileFee: unknown;
  endsAt: Date | string;
  returnedAt: Date | string;
  lateHourFee: unknown;
  damageAmount?: unknown;
  deposit: unknown;
}

export interface ReturnSettlement {
  milesDriven: number;
  extraMiles: number;
  extraMilesCharge: number;
  lateHours: number;
  lateCharge: number;
  damage: number;
  extrasTotal: number;
  /** Taken from the deposit hold. */
  fromDeposit: number;
  /** Released back to the renter. */
  depositReleased: number;
  /** Owed beyond the deposit: charged to the card on file. */
  beyondDeposit: number;
}

export type SettlementResult = { ok: true; settlement: ReturnSettlement } | { ok: false; error: string };

/** What the renter owes on return, and how much of the deposit goes back. */
export function settleReturn(input: ReturnInput): SettlementResult {
  const out = Number(input.collectOdometer);
  const back = Number(input.returnOdometer);
  if (!Number.isFinite(out) || !Number.isFinite(back) || out < 0 || back < 0) return { ok: false, error: "Both odometer readings are needed." };
  if (back < out) return { ok: false, error: "The return odometer reading is lower than at collection." };
  const milesDriven = Math.round(back - out);
  const extraMiles = Math.max(0, milesDriven - Math.max(0, Number(input.milesAllowed) || 0));
  const mileFee = Math.max(0, num(input.extraMileFee) || 0);
  const extraMilesCharge = round2(extraMiles * mileFee);
  const lateMinutes = (new Date(input.returnedAt).getTime() - new Date(input.endsAt).getTime()) / 60_000;
  const lateHours = lateMinutes > LATE_GRACE_MINUTES ? Math.ceil(lateMinutes / 60) : 0;
  const lateCharge = round2(lateHours * Math.max(0, num(input.lateHourFee) || 0));
  const damageRaw = input.damageAmount === undefined || input.damageAmount === null || input.damageAmount === "" ? 0 : num(input.damageAmount);
  if (!(damageRaw >= 0)) return { ok: false, error: "Damage has to be an amount in dollars, or nothing." };
  const damage = round2(damageRaw);
  const extrasTotal = round2(extraMilesCharge + lateCharge + damage);
  const deposit = Math.max(0, num(input.deposit) || 0);
  const fromDeposit = round2(Math.min(extrasTotal, deposit));
  return {
    ok: true,
    settlement: {
      milesDriven, extraMiles, extraMilesCharge, lateHours, lateCharge, damage, extrasTotal,
      fromDeposit,
      depositReleased: round2(deposit - fromDeposit),
      beyondDeposit: round2(extrasTotal - fromDeposit),
    },
  };
}

// ── Words ────────────────────────────────────────────────────────────────────

export const RENTAL_STATUS_WORDS: Record<RentalBookingStatus, string> = {
  requested: "Waiting for PG Ride to confirm",
  confirmed: "Confirmed — collect the car at the pick-up place",
  collected: "On the road",
  returned: "Returned — settling the deposit",
  closed: "Closed",
  declined: "Not available — nothing was charged",
  cancelled: "Cancelled — nothing was charged",
};

export const RENTAL_TERMS_SENTENCE =
  `Rentals run up to ${MAX_RENTAL_DAYS} days. Nothing is charged until you collect the car: then the rental is charged and the deposit is held on your card. ` +
  `On return, extra miles, lateness beyond the first hour and any damage come out of the deposit, and the rest is released. Cancelling before collection is free.`;

export function money(n: unknown): string {
  const v = num(n);
  return `$${(Number.isFinite(v) ? v : 0).toFixed(2)}`;
}
