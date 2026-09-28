/**
 * Private owners (Car Rental Master Plan, phase 2; Festus 2026-09-27: owners
 * are paid weekly, PG Ride keeps 10% of every transaction, the owner the rest).
 *
 * An owner lists their own car with its papers; PG Ride checks the papers
 * before it lists; the owner accepts requests and hands the car over and
 * back through the same bookings code as a fleet car, so money moves the
 * same way. When a rental on a private car closes, the owner's 90% of what
 * it collected is credited to their balance once, and the Friday payday
 * pays it out with the drivers'. Private cars are never offered to drivers.
 */
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db";
import { rentalBookings, rentalCars, rentalOwnerProfiles, rentalRenters, type RentalBooking } from "@shared/schema";
import { OWNER_PAYOUT_METHODS, drivingRecordCurrent, money, ownerSplit, qualificationProblems } from "@shared/rental";
import { storage } from "../storage";
import { opsAlert, formatOpsAlert } from "../telegramOps";
import { riderBookingBlock } from "../rideWorkflowService";
import { RentalError, carFields, updateCar } from "./cars";
import { collectRental, confirmRental, declineRental, returnRental, settleRental } from "./bookings";

export const OWNER_EARNINGS_REASON = "rental_owner_earnings";
const clean = (v: unknown, max = 80) => String(v ?? "").trim().slice(0, max);

export async function getOwnerPayout(userId: string) {
  const [p] = await db.select().from(rentalOwnerProfiles).where(eq(rentalOwnerProfiles.userId, userId));
  return p ? { payoutMethod: p.payoutMethod, payoutDetails: p.payoutDetails } : null;
}

export async function saveOwnerPayout(userId: string, body: any) {
  const method = clean(body?.payoutMethod, 20).toLowerCase();
  const details = clean(body?.payoutDetails, 120);
  if (!(OWNER_PAYOUT_METHODS as readonly string[]).includes(method)) throw new RentalError(`Pay me by: ${OWNER_PAYOUT_METHODS.join(", ")}.`);
  if (details.length < 3) throw new RentalError("Say where the money goes: the Zelle email or phone, the $cashtag, the PayPal email, or the mailing address for a cheque.");
  await db.insert(rentalOwnerProfiles).values({ userId, payoutMethod: method, payoutDetails: details })
    .onConflictDoUpdate({ target: rentalOwnerProfiles.userId, set: { payoutMethod: method, payoutDetails: details, updatedAt: new Date() } });
  return getOwnerPayout(userId);
}

export async function createOwnerCar(ownerId: string, body: any) {
  const block = await riderBookingBlock(ownerId);
  if (block) throw new RentalError(block, 403);
  const required = ["make", "model", "year", "color", "licensePlate", "dailyPrice"];
  const missing = required.filter((k) => body?.[k] === undefined || body?.[k] === null || body?.[k] === "");
  if (missing.length) throw new RentalError(`Missing: ${missing.join(", ")}.`);
  const fields = await carFields(body, ownerId, undefined, { allowDriverRent: false });
  const [car] = await db.insert(rentalCars).values({
    ...(fields as any), ownerKind: "private", ownerUserId: ownerId, reviewStatus: "pending", status: "hidden",
    hiddenReason: "Waiting for PG Ride to check the papers.", createdBy: ownerId, weeklyDriverRent: null,
  }).returning();
  const u = await storage.getUser(ownerId);
  opsAlert(formatOpsAlert("🔑 A private car to check", [
    ["Owner", `${u?.firstName ?? ""} ${u?.lastName ?? ""}`.trim() || ownerId], ["Car", `${car.year} ${car.make} ${car.model} (${car.licensePlate})`],
    ["Next", "Check its papers in Admin, Car rental, and approve or send back"],
  ]));
  return car;
}

/** An owner's edit: listing needs a payout method; changing what the car is sends it back to be checked. */
export async function updateOwnerCar(ownerId: string, carId: string, body: any) {
  if (body?.status === "listed" && !(await getOwnerPayout(ownerId))) throw new RentalError("Add how you want to be paid before listing your car.", 409);
  const before = (await db.select({ reviewStatus: rentalCars.reviewStatus }).from(rentalCars).where(eq(rentalCars.id, carId)))[0];
  const car = await updateCar(carId, body, ownerId, { ownerId });
  if (before && before.reviewStatus === "approved" && car.reviewStatus === "pending") {
    opsAlert(formatOpsAlert("🔑 A private car changed: check it again", [["Car", `${car.year} ${car.make} ${car.model} (${car.licensePlate})`], ["Next", "Admin, Car rental"]]));
  }
  return car;
}

export async function listOwnerCars(ownerId: string) {
  const cars = await db.select().from(rentalCars).where(and(eq(rentalCars.ownerKind, "private"), eq(rentalCars.ownerUserId, ownerId))).orderBy(desc(rentalCars.createdAt));
  const now = new Date();
  return cars.map((c) => ({ ...c, problems: qualificationProblems(c, now) }));
}

/** Rentals on the owner's cars: what the owner needs to hand the car over, nothing about payment ids. */
export async function listOwnerBookings(ownerId: string) {
  const rows = await db.select({ b: rentalBookings, c: rentalCars }).from(rentalBookings)
    .innerJoin(rentalCars, eq(rentalCars.id, rentalBookings.carId))
    .where(eq(rentalCars.ownerUserId, ownerId)).orderBy(desc(rentalBookings.createdAt)).limit(200);
  const out = [];
  for (const { b, c } of rows) {
    const renter = await storage.getUser(b.renterId);
    const [facts] = await db.select({ recordStatus: rentalRenters.recordStatus, recordCheckedAt: rentalRenters.recordCheckedAt }).from(rentalRenters).where(eq(rentalRenters.userId, b.renterId));
    const { chargeIntentId, depositIntentId, beyondDepositIntentId, ...rest } = b;
    // The owner is told whether PG Ride has cleared the renter's driving record, never what is on it.
    const drivingRecord = drivingRecordCurrent(facts, b.startsAt) ? "cleared" : facts?.recordStatus === "refused" ? "refused" : "being checked";
    out.push({ ...rest, drivingRecord, renter: { firstName: renter?.firstName ?? "Renter" }, car: { id: c.id, make: c.make, model: c.model, year: c.year, licensePlate: c.licensePlate } });
  }
  return out;
}

async function ownersBooking(ownerId: string, bookingId: string): Promise<RentalBooking> {
  const [row] = await db.select({ b: rentalBookings, c: rentalCars }).from(rentalBookings)
    .innerJoin(rentalCars, eq(rentalCars.id, rentalBookings.carId)).where(eq(rentalBookings.id, bookingId));
  if (!row || row.c.ownerKind !== "private" || row.c.ownerUserId !== ownerId) throw new RentalError("Booking not found.", 404);
  return row.b;
}

/** An owner acts on a rental of their own car, through the same code the desk uses. */
export async function ownerAct(ownerId: string, bookingId: string, action: string, body: any) {
  await ownersBooking(ownerId, bookingId);
  switch (action) {
    case "confirm": return confirmRental(bookingId);
    case "decline": return declineRental(bookingId, body?.reason);
    case "collect": return collectRental(bookingId, ownerId, body ?? {});
    case "return": return returnRental(bookingId, ownerId, body ?? {});
    case "settle": return settleRental(bookingId);
    default: throw new RentalError("Unknown action.", 404);
  }
}

/** PG Ride's check of a private owner's papers. */
export async function reviewOwnerCar(carId: string, body: any) {
  const decision = body?.decision === "approve" ? "approved" : body?.decision === "reject" ? "rejected" : null;
  if (!decision) throw new RentalError("Approve or send back.");
  const note = clean(body?.note, 300);
  if (decision === "rejected" && !note) throw new RentalError("Say what is wrong so the owner can fix it.");
  const [car] = await db.update(rentalCars).set({
    reviewStatus: decision, reviewNote: note || null, updatedAt: new Date(),
    ...(decision === "rejected" ? { status: "hidden", hiddenReason: `Sent back by PG Ride: ${note}` } : {}),
  }).where(and(eq(rentalCars.id, carId), eq(rentalCars.ownerKind, "private"))).returning();
  if (!car) throw new RentalError("Private car not found.", 404);
  return car;
}

/**
 * Credit the owner their 90% of a closed rental, once. The booking is
 * stamped first (conditional on not being stamped), then the balance is
 * credited; the ledger reason is checked too, so neither a retried close nor
 * the catch-up sweep can pay twice. A credit that fails un-stamps the booking
 * so the sweep tries again, and pages ops.
 */
export async function creditOwnerForClosedRental(bookingId: string): Promise<number> {
  const [row] = await db.select({ b: rentalBookings, c: rentalCars }).from(rentalBookings)
    .innerJoin(rentalCars, eq(rentalCars.id, rentalBookings.carId)).where(eq(rentalBookings.id, bookingId));
  if (!row || row.c.ownerKind !== "private" || !row.c.ownerUserId || row.b.status !== "closed" || row.b.ownerCreditedAt) return 0;
  const split = ownerSplit(row.b.rentalTotal, row.b.settlement as any, row.b.youngRenterFee);
  const [stamped] = await db.update(rentalBookings).set({ ownerCreditedAt: new Date(), ownerShare: split.ownerShare.toFixed(2), platformShare: split.platformShare.toFixed(2) })
    .where(and(eq(rentalBookings.id, bookingId), isNull(rentalBookings.ownerCreditedAt))).returning({ id: rentalBookings.id });
  if (!stamped) return 0;
  try {
    if (await storage.hasWalletTransaction(bookingId, OWNER_EARNINGS_REASON)) return 0;
    if (split.ownerShare > 0) await storage.addVirtualCardBalance(row.c.ownerUserId, split.ownerShare, OWNER_EARNINGS_REASON, bookingId);
    console.log(`[rental] owner credited :: booking ${bookingId.slice(0, 8)} | ${money(split.ownerShare)} of ${money(split.collected)}`);
    return split.ownerShare;
  } catch (err) {
    await db.update(rentalBookings).set({ ownerCreditedAt: null }).where(eq(rentalBookings.id, bookingId));
    opsAlert(formatOpsAlert("💳 Car owner credit FAILED", [["Booking", bookingId.slice(0, 8)], ["Owner's share", money(split.ownerShare)], ["Reason", String((err as any)?.message ?? err).slice(0, 200)], ["Next", "The rental sweep retries it within the hour"]]));
    return 0;
  }
}

/** Catch-up for the sweep: every closed private rental whose owner was not yet credited. */
export async function creditOwedOwners(): Promise<number> {
  const owed = await db.select({ id: rentalBookings.id }).from(rentalBookings)
    .innerJoin(rentalCars, eq(rentalCars.id, rentalBookings.carId))
    .where(and(eq(rentalCars.ownerKind, "private"), eq(rentalBookings.status, "closed"), isNull(rentalBookings.ownerCreditedAt)));
  let n = 0;
  for (const o of owed) if ((await creditOwnerForClosedRental(o.id)) > 0) n++;
  return n;
}

export { inArray };
