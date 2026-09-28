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
 *   - No grace for a late return (Festus, 2026-09-27): every hour started
 *     late is charged, and a car not back on time may be stopped remotely.
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
/** No grace for a late return (Festus, 2026-09-27): from the first minute, every hour started. */
export const LATE_GRACE_MINUTES = 0;
export const EXPIRY_WARNING_DAYS = [30, 7] as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : NaN;
};

// ── Qualification ────────────────────────────────────────────────────────────

export interface CarForQualification {
  ownerKind?: string | null;
  reviewStatus?: string | null;
  registrationDocUrl?: string | null;
  insuranceDocUrl?: string | null;
  inspectionDocUrl?: string | null;
  ownershipDocUrl?: string | null;
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
  const depositWrong = depositProblem(car.deposit);
  if (depositWrong) out.push(depositWrong);
  const p = car.pickupLocation;
  if (!p || !Number.isFinite(Number(p.lat)) || !Number.isFinite(Number(p.lng)) || !String(p.address ?? "").trim()) out.push("Pick-up place is missing.");
  if (!expiresAfter(car.inspectionExpires, now)) out.push("Safety inspection is missing or expired.");
  if (!expiresAfter(car.registrationExpires, now)) out.push("Registration is missing or expired.");
  if (!expiresAfter(car.insuranceExpires, now)) out.push("Insurance is missing or expired.");
  if (car.ownerKind === "private") {
    const docs: Array<[string, unknown]> = [
      ["registration card", car.registrationDocUrl], ["insurance card", car.insuranceDocUrl],
      ["inspection certificate", car.inspectionDocUrl], ["proof of ownership or the owner's permission", car.ownershipDocUrl],
    ];
    for (const [name, url] of docs) if (!url) out.push(`A photo of the ${name} is missing.`);
    if (car.reviewStatus === "rejected") out.push("PG Ride could not accept the papers; see the note, fix them and send again.");
    else if (car.reviewStatus !== "approved") out.push("PG Ride has not checked the papers yet.");
  }
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
  /** Under 25: $25 a day, PG Ride's. Included in rentalTotal. */
  youngRenterFee: number;
  /** The car's price for the days plus the young-renter fee: what is charged at collection. */
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
  renterAge: number | null = null,
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
  const young = youngRenterFee(renterAge, days);
  return {
    ok: true,
    quote: {
      startsAt, endsAt, days,
      dailyPrice: round2(dailyPrice),
      youngRenterFee: young,
      rentalTotal: round2(dailyPrice * days + young),
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
  `On return, extra miles, every hour late (from the first minute) and any damage come out of the deposit, and the rest is released. A car not back on time may be stopped remotely. Cancelling before collection is free. ` +
  `Renters are 21 or older, have held a licence for at least a year (two under 25) and pass a driving-record check; under 25, a young-renter fee of $25 a day is added.`;

export function money(n: unknown): string {
  const v = num(n);
  return `$${(Number.isFinite(v) ? v : 0).toFixed(2)}`;
}

// ── Phase 3: PG Ride fleet cars assigned to drivers ─────────────────────────
//
// Only fleet cars are ever assigned to drivers (Festus, 2026-09-27). A driver
// asks for a car by the week; an admin assigns it and hands it over; rent is
// charged to the driver's card a week at a time, in advance, and the driver
// may drive the car on PG Ride only while the rent is paid. No deposit: a
// card hold cannot outlast a week. Decisions Festus may change: rent taken
// from earnings instead of the card; a deposit; MAX_DRIVER_WEEKS.

export const DRIVER_ASSIGNMENT_STATUSES = ["requested", "assigned", "active", "ended", "declined", "cancelled"] as const;
export type DriverAssignmentStatus = (typeof DRIVER_ASSIGNMENT_STATUSES)[number];
/** Statuses that hold the car against other assignments and public rentals. */
export const ASSIGNMENT_HOLDS_THE_CAR: readonly DriverAssignmentStatus[] = ["assigned", "active"];
/** Statuses a driver may have only one of at a time. */
export const ASSIGNMENT_OPEN: readonly DriverAssignmentStatus[] = ["requested", "assigned", "active"];
export const MAX_DRIVER_WEEKS = 12;
export const WEEK_MS = 7 * DAY_MS;
/** Rent for the next week is charged this long before the paid week runs out. */
export const RENT_CHARGE_LEAD_MS = 60 * 60 * 1000;

export type DriverQuoteResult =
  | { ok: true; quote: { startsAt: Date; endsAt: Date; weeks: number; weeklyRent: number; total: number } }
  | { ok: false; error: string };

export function quoteDriverAssignment(car: { weeklyDriverRent: unknown; ownerKind?: string | null }, startsAtRaw: unknown, weeksRaw: unknown, now: Date = new Date()): DriverQuoteResult {
  if (car.ownerKind && car.ownerKind !== "fleet") return { ok: false, error: "Only PG Ride's own cars are offered to drivers." };
  const weeklyRent = num(car.weeklyDriverRent);
  if (!(weeklyRent > 0)) return { ok: false, error: "This car is not offered to drivers." };
  const startsAt = new Date(String(startsAtRaw ?? ""));
  if (!Number.isFinite(startsAt.getTime())) return { ok: false, error: "Pick when you want to collect the car." };
  if (startsAt.getTime() < now.getTime() + MIN_LEAD_MINUTES * 60_000) return { ok: false, error: `Collection has to be at least ${MIN_LEAD_MINUTES} minutes from now.` };
  if (startsAt.getTime() > now.getTime() + MAX_BOOK_AHEAD_DAYS * DAY_MS) return { ok: false, error: `A car can be asked for up to ${MAX_BOOK_AHEAD_DAYS} days ahead.` };
  const weeks = Number(weeksRaw);
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > MAX_DRIVER_WEEKS) return { ok: false, error: `Ask for between 1 and ${MAX_DRIVER_WEEKS} weeks.` };
  const endsAt = new Date(startsAt.getTime() + weeks * WEEK_MS);
  return { ok: true, quote: { startsAt, endsAt, weeks, weeklyRent: round2(weeklyRent), total: round2(weeklyRent * weeks) } };
}

/**
 * May a driver go online? A driver with a car of their own is not this
 * rule's business. A driver whose only car is a PG Ride car may drive while
 * the car is theirs (active) and its rent is paid through now.
 */
export function fleetDriverMayDrive(input: {
  ownCars: number;
  fleetCars: number;
  assignment: { status: string; paidThrough: Date | string | null; endsAt: Date | string } | null;
  now?: Date;
}): { ok: true } | { ok: false; reason: string } {
  const now = input.now ?? new Date();
  if (input.ownCars > 0 || input.fleetCars === 0) return { ok: true };
  const a = input.assignment;
  if (!a || a.status !== "active") return { ok: false, reason: "You have no PG Ride car at the moment. Ask for one on your Profile, or add your own car." };
  const paid = a.paidThrough ? new Date(a.paidThrough).getTime() : 0;
  if (paid <= now.getTime()) return { ok: false, reason: "This week's rent for your PG Ride car has not been paid. Update your card in Profile; PG Ride will retry it." };
  return { ok: true };
}

export const DRIVER_ASSIGNMENT_WORDS: Record<DriverAssignmentStatus, string> = {
  requested: "Asked for — PG Ride will confirm",
  assigned: "Confirmed — collect it at the pick-up place",
  active: "Yours to drive",
  ended: "Returned",
  declined: "Not available",
  cancelled: "Cancelled",
};

export const DRIVER_RENT_SENTENCE =
  "Rent is paid a week at a time, in advance, starting when you collect the car: from your PG Ride earnings first if you agree to it, otherwise from your card. You can drive it on PG Ride while the rent is paid. Every hour started after the end of your weeks is charged at the weekly rent divided by 168, from the first minute, and a car not back may be stopped remotely. Cancelling before collection is free.";


// ── Phase 2: private owners (Festus, 2026-09-27) ────────────────────────────
//
// A private owner's car lists only once PG Ride has checked its papers, and
// changing what the car IS (make, model, year, plate, VIN, papers, expiry
// dates) sends it back to be checked. The owner accepts requests and hands
// the car over; money moves exactly as for a fleet car. When a rental on a
// private car closes, PG Ride keeps 10% of everything it collected and the
// owner is credited the rest, paid weekly by the Friday payday.

export const RENTAL_PLATFORM_SHARE = 0.10;

/** Fields whose change sends a private owner's car back to be checked. */
export const REVIEWED_FIELDS = [
  "make", "model", "year", "licensePlate", "vin", "seats", "vehicleType",
  "registrationDocUrl", "insuranceDocUrl", "inspectionDocUrl", "ownershipDocUrl",
  "inspectionExpires", "registrationExpires", "insuranceExpires",
] as const;

/**
 * What a closed rental collected, and how it splits. Collected = the rental
 * charged at collection + what the deposit covered + anything charged beyond
 * it. A deposit that was released is not revenue. The young-renter fee is
 * PG Ride's alone (it pays for the risk of a young driver), so the owner's
 * 90% is of everything else.
 */
export function ownerSplit(rentalTotal: unknown, settlement: { fromDeposit?: unknown; beyondDeposit?: unknown } | null | undefined, youngFee: unknown = 0): { collected: number; ownerShare: number; platformShare: number } {
  const collected = round2((num(rentalTotal) || 0) + (num(settlement?.fromDeposit) || 0) + (num(settlement?.beyondDeposit) || 0));
  const young = Math.min(collected, Math.max(0, num(youngFee) || 0));
  const cut = round2((collected - young) * RENTAL_PLATFORM_SHARE);
  const ownerShare = round2(collected - young - cut);
  return { collected, platformShare: round2(collected - ownerShare), ownerShare };
}

export const OWNER_PAYOUT_METHODS = ["zelle", "cashapp", "paypal", "check"] as const;

export const OWNER_TERMS_SENTENCE =
  "PG Ride checks your car's papers before it is listed. You accept each request and hand the car over yourself. When a rental closes, PG Ride keeps 10% of everything it collected and you are credited the rest, paid every Friday to the payout method you choose.";


// ── Overdue cars and the engine cut-off (Festus, 2026-09-27) ───────────────
//
// "No grace for late returns, we cut off the engine remotely." The moment a
// car is past its return time and not back, ops are paged to cut off its
// engine; the desk records when it was cut off and restored. Which tracker
// does the cutting is not connected yet: until it is, the page and the
// record are the whole of it, and the cut-off is made in the tracker's app.
// Renters and drivers are told up front that a late car may be stopped.

/** Is this car overdue: out, and past the time it was due back? */
export function isOverdue(endsAt: Date | string, now: Date = new Date()): boolean {
  return new Date(endsAt).getTime() < now.getTime();
}

/** Minutes a car is overdue, rounded up; 0 when it is not. */
export function minutesOverdue(endsAt: Date | string, now: Date = new Date()): number {
  const ms = now.getTime() - new Date(endsAt).getTime();
  return ms > 0 ? Math.ceil(ms / 60_000) : 0;
}


// ── Industry-standard rental rules (adopted 2026-09-28, changeable) ─────────
//
// Festus: "just copy industry standards and practices." Each figure below is
// the common practice of car-sharing and rideshare rental programmes, named
// in the Car Rental Master Plan's decisions, and may be changed here alone.
//   - A renter is at least 21 when the rental starts; under 25 pays a
//     young-renter fee per day, which is PG Ride's (it pays for the risk),
//     never the private owner's.
//   - A licence held at least 1 year (2 under 25), valid through the return.
//   - A driving-record check before the first rental, good for a year:
//     PG Ride records the result; no rental is confirmed without it.
//   - A deposit between $100 and $1,000, $250 unless the lister sets it.
//   - A driver may agree to have weekly rent taken from their earnings first,
//     the card covering only what the earnings do not.
//   - A driver who keeps a PG Ride car past its weeks pays the weekly rent pro
//     rata for every hour started, no grace, as a public renter does.

export const MIN_RENTER_AGE = 21;
export const YOUNG_RENTER_AGE = 25;
export const YOUNG_RENTER_FEE_PER_DAY = 25;
export const MIN_LICENCE_YEARS = 1;
export const MIN_LICENCE_YEARS_YOUNG = 2;
/** A driving-record check is good for this long. */
export const DRIVING_RECORD_VALID_DAYS = 365;
export const DEPOSIT_MIN = 100;
export const DEPOSIT_MAX = 1000;
export const DEPOSIT_DEFAULT = 250;
export const HOURS_IN_A_WEEK = 7 * 24;

export const DRIVING_RECORD_STATUSES = ["pending", "cleared", "refused"] as const;
export type DrivingRecordStatus = (typeof DRIVING_RECORD_STATUSES)[number];

/** What PG Ride looks for on a driving record, shown to the desk beside Cleared / Refused. */
export const DRIVING_RECORD_STANDARD =
  "Clear when the renter's driving record shows no DUI or DWI in 7 years, no more than 2 moving violations and no at-fault accident in 3 years, and no suspension or revocation now.";

const dateOnly = (v: unknown): Date | null => {
  const s = v instanceof Date ? v.toISOString() : String(v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const d = new Date(`${s.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(d.getTime()) ? d : null;
};

/** A date the renter typed, as YYYY-MM-DD, or null. */
export function dayOf(v: unknown): string | null {
  const d = dateOnly(v);
  return d ? d.toISOString().slice(0, 10) : null;
}

/** Whole years from `from` to `to`, calendar-correct (a birthday counts on the day). */
export function wholeYears(from: Date, to: Date): number {
  let years = to.getUTCFullYear() - from.getUTCFullYear();
  const m = to.getUTCMonth() - from.getUTCMonth();
  if (m < 0 || (m === 0 && to.getUTCDate() < from.getUTCDate())) years--;
  return years;
}

export interface RenterFacts {
  dateOfBirth: unknown;
  licenceIssuedOn: unknown;
  licenceExpiresOn: unknown;
}

/**
 * May this person rent for these dates? Empty = yes. Age and licence tenure
 * are taken at the start of the rental; the licence must still be valid at
 * its end.
 */
export function renterProblems(facts: RenterFacts, startsAt: Date, endsAt: Date): string[] {
  const out: string[] = [];
  const dob = dateOnly(facts.dateOfBirth);
  const issued = dateOnly(facts.licenceIssuedOn);
  const expires = dateOnly(facts.licenceExpiresOn);
  if (!dob) out.push("Enter your date of birth.");
  if (!issued) out.push("Enter the date your licence was first issued.");
  if (!expires) out.push("Enter the date your licence expires.");
  if (out.length) return out;
  const age = wholeYears(dob!, startsAt);
  if (age > 110 || dob! > startsAt) return ["Check your date of birth."];
  if (issued! > startsAt || issued! < dob!) return ["Check the date your licence was issued."];
  if (age < MIN_RENTER_AGE) out.push(`Renters have to be at least ${MIN_RENTER_AGE} on the day the rental starts.`);
  const needYears = age < YOUNG_RENTER_AGE ? MIN_LICENCE_YEARS_YOUNG : MIN_LICENCE_YEARS;
  if (wholeYears(issued!, startsAt) < needYears) {
    out.push(age < YOUNG_RENTER_AGE
      ? `Under ${YOUNG_RENTER_AGE}, you need to have held your licence for at least ${MIN_LICENCE_YEARS_YOUNG} years.`
      : `You need to have held your licence for at least ${MIN_LICENCE_YEARS} year.`);
  }
  // A licence is good through the whole of the day it expires.
  if (expires!.getTime() + DAY_MS <= endsAt.getTime()) out.push("Your licence expires before the rental ends. Renew it first.");
  return out;
}

/** Age on a day, or null when the date of birth is not a date. */
export function ageOn(dateOfBirth: unknown, on: Date): number | null {
  const dob = dateOnly(dateOfBirth);
  return dob ? wholeYears(dob, on) : null;
}

/** The young-renter fee for a rental, 0 from 25 on or when the age is unknown. */
export function youngRenterFee(age: number | null | undefined, days: number): number {
  return age !== null && age !== undefined && age < YOUNG_RENTER_AGE ? round2(YOUNG_RENTER_FEE_PER_DAY * days) : 0;
}

/** Is a driving-record result still good for a rental starting then? */
export function drivingRecordCurrent(record: { recordStatus?: string | null; recordCheckedAt?: Date | string | null } | null | undefined, startsAt: Date): boolean {
  if (!record || record.recordStatus !== "cleared" || !record.recordCheckedAt) return false;
  return new Date(record.recordCheckedAt).getTime() + DRIVING_RECORD_VALID_DAYS * DAY_MS > startsAt.getTime();
}

/** A deposit a lister may set, or the reason it may not. */
export function depositProblem(deposit: unknown): string | null {
  const d = num(deposit);
  if (!Number.isFinite(d)) return "Deposit must be an amount in dollars.";
  if (d < DEPOSIT_MIN || d > DEPOSIT_MAX) return `Deposit has to be between ${money(DEPOSIT_MIN)} and ${money(DEPOSIT_MAX)}.`;
  return null;
}

/**
 * Late fee for a PG Ride car a driver kept past the end of their weeks: the
 * weekly rent pro rata, every hour started, from the first minute.
 */
export function driverLateFee(weeklyRent: unknown, endsAt: Date | string, returnedAt: Date | string): { lateHours: number; hourlyRate: number; lateCharge: number } {
  const hourlyRate = round2((num(weeklyRent) || 0) / HOURS_IN_A_WEEK);
  const lateMinutes = (new Date(returnedAt).getTime() - new Date(endsAt).getTime()) / 60_000;
  const lateHours = lateMinutes > LATE_GRACE_MINUTES ? Math.ceil(lateMinutes / 60) : 0;
  return { lateHours, hourlyRate, lateCharge: round2(lateHours * hourlyRate) };
}

/** How an amount is paid when the driver agreed to pay from earnings: the balance first, the card for the rest. */
export function splitFromEarnings(amount: unknown, balance: unknown): { fromEarnings: number; fromCard: number } {
  const a = Math.max(0, num(amount) || 0);
  const b = Math.max(0, num(balance) || 0);
  const fromEarnings = round2(Math.min(a, b));
  return { fromEarnings, fromCard: round2(a - fromEarnings) };
}

export const RENTER_RULES_SENTENCE =
  `Renters are ${MIN_RENTER_AGE} or older and have held a licence for at least ${MIN_LICENCE_YEARS} year (${MIN_LICENCE_YEARS_YOUNG} under ${YOUNG_RENTER_AGE}). ` +
  `Under ${YOUNG_RENTER_AGE}, a young-renter fee of ${money(YOUNG_RENTER_FEE_PER_DAY)} a day is added. PG Ride checks your driving record before your first rental; the check lasts a year.`;

export const RENT_FROM_EARNINGS_SENTENCE =
  "I agree that PG Ride takes each week's rent for this car, and anything owed when I return it, from my PG Ride earnings before they are paid out, and charges my card only for what my earnings do not cover. I can withdraw this at any time from my Profile.";
