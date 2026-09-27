/**
 * Rental cars: what PG Ride lists, whether each one qualifies, and what a
 * renter is shown. Rules in shared/rental.ts; nothing here decides a rule.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { driverCarAssignments, rentalBookings, rentalCars, storedObjects, users, vehicles, type RentalCar } from "@shared/schema";
import { ASSIGNMENT_HOLDS_THE_CAR, HOLDS_THE_CAR, REVIEWED_FIELDS, qualificationProblems, rentalsOverlap } from "@shared/rental";
import { VEHICLE_TYPES } from "@shared/vehicleTypes";

export class RentalError extends Error {
  constructor(message: string, public status = 400, public problems?: string[]) { super(message); }
}

const clean = (v: unknown, max = 80) => String(v ?? "").trim().slice(0, max);
const intOr = (v: unknown, fallback: number | null) => {
  if (v === undefined || v === null || v === "") return fallback;
  const n = Number(v);
  return Number.isInteger(n) ? n : NaN;
};
const moneyOr = (v: unknown, fallback: string | null) => {
  if (v === undefined || v === null || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100000) return "bad";
  return n.toFixed(2);
};
const dateOr = (v: unknown): Date | null | "bad" => {
  if (v === undefined || v === null || v === "") return null;
  const d = new Date(String(v));
  return Number.isFinite(d.getTime()) ? d : "bad";
};

/**
 * A path in PG Ride's own store that the given user uploaded, and that is a
 * photo (or, where allowed, a PDF). A path's shape is not enough: naming
 * someone else's object would hand them read access to it.
 */
export async function verifiedStorePath(raw: unknown, ownerUserId: string, opts: { allowPdf?: boolean; what: string }): Promise<string> {
  const text = clean(raw, 600);
  if (!text) throw new RentalError(`The ${opts.what} did not upload. Try again.`);
  let parsed: URL;
  try { parsed = new URL(text, "http://pgride.local"); } catch { throw new RentalError(`That ${opts.what} is not a file PG Ride uploaded.`); }
  const m = /^\/api\/objects\/db-upload\/([0-9a-f-]{36})$/i.exec(parsed.pathname);
  if (!m) throw new RentalError(`That ${opts.what} is not a file PG Ride uploaded.`);
  const [obj] = await db.select({ id: storedObjects.id, ownerUserId: storedObjects.ownerUserId, contentType: storedObjects.contentType }).from(storedObjects).where(eq(storedObjects.id, m[1]));
  if (!obj) throw new RentalError(`The ${opts.what} did not upload. Try again.`);
  if (obj.ownerUserId !== ownerUserId) throw new RentalError(`That ${opts.what} is not yours.`, 403);
  const ok = /^image\/(jpeg|png|webp|heic|gif)$/i.test(obj.contentType) || (opts.allowPdf && obj.contentType === "application/pdf");
  if (!ok) throw new RentalError(`The ${opts.what} must be a photo${opts.allowPdf ? " or a PDF" : ""}.`);
  return `/api/objects/db-upload/${obj.id}`;
}

async function verifiedPhotoList(raw: unknown, ownerUserId: string, what: string, max = 12): Promise<string[]> {
  if (!Array.isArray(raw)) throw new RentalError(`Add the ${what}.`);
  const out: string[] = [];
  for (const p of raw.slice(0, max)) {
    const path = await verifiedStorePath(p, ownerUserId, { what });
    if (!out.includes(path)) out.push(path);
  }
  return out;
}

/** The fields an admin may set on a fleet car, validated. Photos are checked against the acting admin's uploads. */
export async function carFields(body: any, actorId: string, existing?: RentalCar, opts: { allowDriverRent?: boolean } = { allowDriverRent: true }): Promise<Partial<typeof rentalCars.$inferInsert>> {
  const out: Partial<typeof rentalCars.$inferInsert> = {};
  const has = (k: string) => body && Object.prototype.hasOwnProperty.call(body, k);
  for (const k of ["make", "model", "color"] as const) {
    if (has(k)) { const v = clean(body[k], 40); if (!v) throw new RentalError(`${k[0].toUpperCase()}${k.slice(1)} is required.`); out[k] = v; }
  }
  if (has("licensePlate")) { const v = clean(body.licensePlate, 12).toUpperCase(); if (!/^[A-Z0-9\- ]{2,10}$/.test(v)) throw new RentalError("Licence plate must be 2 to 10 letters or digits."); out.licensePlate = v; }
  if (has("vin")) out.vin = clean(body.vin, 17).toUpperCase() || null;
  if (has("year")) { const v = intOr(body.year, null); const max = new Date().getUTCFullYear() + 1; if (!Number.isInteger(v) || (v as number) < 1990 || (v as number) > max) throw new RentalError(`Model year must be between 1990 and ${max}.`); out.year = v as number; }
  if (has("seats")) { const v = intOr(body.seats, null); if (!Number.isInteger(v) || (v as number) < 2 || (v as number) > 15) throw new RentalError("Seats must be a whole number."); out.seats = v as number; }
  if (has("vehicleType")) { const v = clean(body.vehicleType, 20); if (!(VEHICLE_TYPES as readonly string[]).includes(v)) throw new RentalError("Unknown vehicle class."); out.vehicleType = v; }
  if (has("milesPerDay")) { const v = intOr(body.milesPerDay, 0); if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 2000) throw new RentalError("Miles per day must be a whole number, 0 for unlimited."); out.milesPerDay = v as number; }
  // A private owner's papers: a photo or PDF each, the owner's own upload
  // (one already on the car is kept whoever uploaded it).
  for (const k of ["registrationDocUrl", "insuranceDocUrl", "inspectionDocUrl", "ownershipDocUrl"] as const) {
    if (!has(k)) continue;
    const v = clean(body[k], 600);
    if (!v) { out[k] = null; continue; }
    out[k] = existing && (existing as any)[k] === v ? v : await verifiedStorePath(v, actorId, { allowPdf: true, what: "document" });
  }
  if (has("weeklyDriverRent") && opts.allowDriverRent === false) throw new RentalError("Only PG Ride's own cars are offered to drivers.", 403);
  if (has("weeklyDriverRent")) {
    const v = moneyOr(body.weeklyDriverRent, null);
    if (v === "bad") throw new RentalError("Weekly rent for a driver must be an amount in dollars, or blank.");
    out.weeklyDriverRent = v === null || Number(v) === 0 ? null : v;
  }
  for (const k of ["dailyPrice", "deposit", "extraMileFee", "lateHourFee"] as const) {
    if (has(k)) { const v = moneyOr(body[k], k === "dailyPrice" ? null : "0.00"); if (v === "bad" || v === null) throw new RentalError(`${k === "dailyPrice" ? "Daily price" : k === "deposit" ? "Deposit" : k === "extraMileFee" ? "Extra-mile fee" : "Late-hour fee"} must be an amount in dollars.`); out[k] = v; }
  }
  if (has("pickupLocation")) {
    const p = body.pickupLocation;
    if (p === null) out.pickupLocation = null;
    else {
      const lat = Number(p?.lat), lng = Number(p?.lng), address = clean(p?.address, 200);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || !address) throw new RentalError("Pick-up place needs a full address. Pick one from the suggestions.");
      out.pickupLocation = { lat, lng, address };
    }
  }
  for (const k of ["inspectionExpires", "registrationExpires", "insuranceExpires"] as const) {
    if (has(k)) { const v = dateOr(body[k]); if (v === "bad") throw new RentalError("Expiry dates must be dates."); out[k] = v; }
  }
  if (has("photos")) {
    // Photos already on the car stay allowed whoever uploaded them; a new
    // photo must be the acting admin's own upload.
    const kept = new Set(existing?.photos ?? []);
    const list = Array.isArray(body.photos) ? body.photos.slice(0, 12) : [];
    const out2: string[] = [];
    for (const p of list) {
      const s = clean(p, 600);
      if (kept.has(s)) { if (!out2.includes(s)) out2.push(s); continue; }
      const path = await verifiedStorePath(s, actorId, { what: "car photo" });
      if (!out2.includes(path)) out2.push(path);
    }
    out.photos = out2;
  }
  return out;
}

export async function createFleetCar(body: any, actorId: string): Promise<RentalCar> {
  const required = ["make", "model", "year", "color", "licensePlate", "dailyPrice"];
  const missing = required.filter((k) => body?.[k] === undefined || body?.[k] === null || body?.[k] === "");
  if (missing.length) throw new RentalError(`Missing: ${missing.join(", ")}.`);
  const fields = await carFields(body, actorId);
  const [car] = await db.insert(rentalCars).values({
    ownerKind: "fleet", ownerUserId: null, status: "hidden", hiddenReason: "Not listed yet.",
    createdBy: actorId, ...(fields as any),
  }).returning();
  return car;
}

/** Edit a car; `status: "listed"` lists it only if it qualifies. Any edit that breaks a listed car hides it. */
export async function updateFleetCar(carId: string, body: any, actorId: string, now: Date = new Date()): Promise<RentalCar> {
  return updateCar(carId, body, actorId, {}, now);
}

/**
 * Edit a car. An admin may edit any car (they are the reviewer). A private
 * owner (opts.ownerId) may edit only their own, may not offer it to drivers,
 * and changing what the car IS sends it back to PG Ride to be checked.
 */
export async function updateCar(carId: string, body: any, actorId: string, opts: { ownerId?: string }, now: Date = new Date()): Promise<RentalCar> {
  const [car] = await db.select().from(rentalCars).where(eq(rentalCars.id, carId));
  if (!car) throw new RentalError("Car not found.", 404);
  if (opts.ownerId && (car.ownerKind !== "private" || car.ownerUserId !== opts.ownerId)) throw new RentalError("Car not found.", 404);
  const fields = await carFields(body, actorId, car, { allowDriverRent: !opts.ownerId && car.ownerKind === "fleet" });
  if (opts.ownerId) {
    const changed = REVIEWED_FIELDS.some((k) => k in fields && String((fields as any)[k] ?? "") !== String((car as any)[k] ?? ""));
    if (changed) {
      // What a renter has in their hands cannot change under them.
      const [out] = await db.select({ id: rentalBookings.id }).from(rentalBookings)
        .where(and(eq(rentalBookings.carId, carId), eq(rentalBookings.status, "collected"))).limit(1);
      if (out) throw new RentalError("The car is out on a rental. Change its details when it is back.", 409);
      fields.reviewStatus = "pending"; fields.reviewNote = null;
    }
  }
  const next = { ...car, ...fields } as RentalCar;
  const wants = body?.status === "listed" ? "listed" : body?.status === "hidden" ? "hidden" : car.status;
  const problems = qualificationProblems(next, now);
  if (wants === "listed" && problems.length) {
    if (body?.status === "listed") throw new RentalError("This car cannot be listed yet.", 409, problems);
  }
  const status = wants === "listed" && !problems.length ? "listed" : "hidden";
  const hiddenReason = status === "listed" ? null : body?.status === "hidden" ? clean(body?.hiddenReason, 200) || (opts.ownerId ? "Hidden by the owner." : "Hidden by an admin.") : problems.length ? problems.join(" ") : car.hiddenReason;
  const [updated] = await db.update(rentalCars).set({ ...(fields as any), status, hiddenReason, updatedAt: now }).where(eq(rentalCars.id, carId)).returning();
  // A car with a driver is also that driver's vehicle: what riders and
  // dispatch see follows the edit.
  await db.update(vehicles).set({
    make: updated.make, model: updated.model, year: updated.year, color: updated.color, licensePlate: updated.licensePlate,
    vehicleType: updated.vehicleType, photos: updated.photos ?? [], updatedAt: now,
  }).where(eq(vehicles.rentalCarId, carId));
  return updated;
}

export async function listAllCars(): Promise<Array<RentalCar & { problems: string[] }>> {
  const cars = await db.select().from(rentalCars).orderBy(desc(rentalCars.createdAt));
  const now = new Date();
  return cars.map((c) => ({ ...c, problems: qualificationProblems(c, now) }));
}

/** What a renter sees about a car: no VIN, no plate, no internal notes. */
export function publicCar(car: RentalCar) {
  return {
    id: car.id, ownerKind: car.ownerKind, make: car.make, model: car.model, year: car.year, color: car.color,
    seats: car.seats, vehicleType: car.vehicleType, photos: car.photos ?? [],
    dailyPrice: car.dailyPrice, deposit: car.deposit, milesPerDay: car.milesPerDay,
    extraMileFee: car.extraMileFee, lateHourFee: car.lateHourFee,
    pickupAddress: car.pickupLocation?.address ?? null,
  };
}


/**
 * Everything that holds a car, for overlap checks: public rentals that are
 * confirmed or out, and driver assignments that are assigned or active. One
 * car, one set of days, whichever door it went out of.
 */
export async function holdingBookings(carId: string, executor: any = db): Promise<Array<{ id: string; startsAt: Date; endsAt: Date }>> {
  const rentals = await executor.select({ id: rentalBookings.id, startsAt: rentalBookings.startsAt, endsAt: rentalBookings.endsAt })
    .from(rentalBookings)
    .where(and(eq(rentalBookings.carId, carId), inArray(rentalBookings.status, [...HOLDS_THE_CAR])));
  const assigned = await executor.select({ id: driverCarAssignments.id, startsAt: driverCarAssignments.startsAt, endsAt: driverCarAssignments.endsAt })
    .from(driverCarAssignments)
    .where(and(eq(driverCarAssignments.carId, carId), inArray(driverCarAssignments.status, [...ASSIGNMENT_HOLDS_THE_CAR])));
  return [...rentals, ...assigned];
}

/** Listed, still-qualified cars; with dates, only those free for the whole stay. */
export async function listAvailableCars(window?: { startsAt: Date; endsAt: Date }, now: Date = new Date()) {
  const cars = await db.select().from(rentalCars).where(eq(rentalCars.status, "listed"));
  const out = [];
  for (const car of cars) {
    if (qualificationProblems(car, now).length) continue;
    if (window) {
      const held = await holdingBookings(car.id);
      if (held.some((b: any) => rentalsOverlap(b, window))) continue;
    }
    out.push(publicCar(car));
  }
  return out;
}

export async function getListedCar(carId: string, now: Date = new Date()): Promise<RentalCar> {
  const [car] = await db.select().from(rentalCars).where(eq(rentalCars.id, carId));
  if (!car || car.status !== "listed" || qualificationProblems(car, now).length) throw new RentalError("That car is not available.", 404);
  return car;
}

/**
 * May this signed-in user see this stored photo because of car rental? A
 * listed car's photos are for every signed-in renter; a booking's licence
 * and handover photos are for its renter (admins see everything already).
 */
export async function rentalPhotoVisibleTo(userId: string, objectId: string): Promise<boolean> {
  const path = `/api/objects/db-upload/${objectId}`;
  const [car] = await db.select({ id: rentalCars.id }).from(rentalCars)
    .where(and(eq(rentalCars.status, "listed"), sql`${rentalCars.photos} @> ${JSON.stringify([path])}::jsonb`)).limit(1);
  if (car) return true;
  const [booking] = await db.select({ id: rentalBookings.id }).from(rentalBookings)
    .where(and(eq(rentalBookings.renterId, userId), sql`(${rentalBookings.licenceImageUrl} = ${path} OR COALESCE(${rentalBookings.collectPhotos}, '[]'::jsonb) @> ${JSON.stringify([path])}::jsonb OR COALESCE(${rentalBookings.returnPhotos}, '[]'::jsonb) @> ${JSON.stringify([path])}::jsonb)`)).limit(1);
  if (booking) return true;
  const [asOwner] = await db.select({ id: rentalBookings.id }).from(rentalBookings)
    .innerJoin(rentalCars, eq(rentalCars.id, rentalBookings.carId))
    .where(and(eq(rentalCars.ownerUserId, userId), sql`(${rentalBookings.licenceImageUrl} = ${path} OR COALESCE(${rentalBookings.collectPhotos}, '[]'::jsonb) @> ${JSON.stringify([path])}::jsonb OR COALESCE(${rentalBookings.returnPhotos}, '[]'::jsonb) @> ${JSON.stringify([path])}::jsonb)`)).limit(1);
  return !!asOwner;
}

export { verifiedPhotoList, users };
