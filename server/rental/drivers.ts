/**
 * PG Ride fleet cars assigned to drivers (Car Rental Master Plan, phase 3).
 *
 * Only fleet cars are ever assigned (Festus, 2026-09-27). A driver asks for
 * a car by the week; an admin assigns it and hands it over, and the first
 * week's rent is charged then; the car is copied into the driver's vehicles
 * so riders and dispatch see it exactly like an owned car; rent is charged a
 * week at a time in advance by the sweep; the driver may go online in it
 * only while the rent is paid; at the end the car is taken back and the copy
 * removed. Rules in shared/rental.ts.
 *
 * Money: one driver_rent_charges row per week is written BEFORE the card is
 * charged, unique per (assignment, week), so a week is charged at most once
 * however often the sweep or the desk asks.
 */
import { and, desc, eq, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { driverCarAssignments, driverRentCharges, rentalBookings, rentalCars, vehicles, type DriverCarAssignment } from "@shared/schema";
import {
  ASSIGNMENT_OPEN, RENT_CHARGE_LEAD_MS, WEEK_MS, fleetDriverMayDrive, money, qualificationProblems, quoteDriverAssignment, rentalsOverlap, settleReturn,
} from "@shared/rental";
import { stripeService } from "../stripeService";
import { storage } from "../storage";
import { opsAlert, formatOpsAlert } from "../telegramOps";
import { RentalError, holdingBookings, verifiedPhotoList } from "./cars";

const clean = (v: unknown, max = 80) => String(v ?? "").trim().slice(0, max);
const errText = (err: any) => String(err?.message ?? err ?? "unknown error").slice(0, 300);

async function load(id: string): Promise<DriverCarAssignment> {
  const [a] = await db.select().from(driverCarAssignments).where(eq(driverCarAssignments.id, id));
  if (!a) throw new RentalError("Not found.", 404);
  return a;
}

async function driverCard(userId: string) {
  const u = await storage.getUser(userId);
  return u?.stripeCustomerId && u?.stripePaymentMethodId ? { customerId: u.stripeCustomerId, paymentMethodId: u.stripePaymentMethodId } : null;
}

/** What a driver sees about a fleet car offered to drivers. */
function driverCarView(car: typeof rentalCars.$inferSelect) {
  return {
    id: car.id, make: car.make, model: car.model, year: car.year, color: car.color, seats: car.seats,
    vehicleType: car.vehicleType, photos: car.photos ?? [], weeklyRent: car.weeklyDriverRent,
    pickupAddress: car.pickupLocation?.address ?? null,
  };
}

async function offeredCar(carId: string, now: Date) {
  const [car] = await db.select().from(rentalCars).where(eq(rentalCars.id, carId));
  if (!car || car.ownerKind !== "fleet" || car.status !== "listed" || !(Number(car.weeklyDriverRent) > 0) || qualificationProblems(car, now).length) {
    throw new RentalError("That car is not offered to drivers.", 404);
  }
  return car;
}

export async function listFleetCarsForDrivers(window?: { startsAt: Date; endsAt: Date }, now: Date = new Date()) {
  const cars = await db.select().from(rentalCars).where(and(eq(rentalCars.ownerKind, "fleet"), eq(rentalCars.status, "listed"), isNotNull(rentalCars.weeklyDriverRent)));
  const out = [];
  for (const car of cars) {
    if (!(Number(car.weeklyDriverRent) > 0) || qualificationProblems(car, now).length) continue;
    if (window) {
      const held = await holdingBookings(car.id);
      if (held.some((h) => rentalsOverlap(h, window))) continue;
    }
    out.push(driverCarView(car));
  }
  return out;
}

/** The driver's current (open) assignment with its car, or null. */
export async function myFleetCar(driverUserId: string) {
  const [row] = await db.select({ a: driverCarAssignments, c: rentalCars }).from(driverCarAssignments)
    .innerJoin(rentalCars, eq(rentalCars.id, driverCarAssignments.carId))
    .where(and(eq(driverCarAssignments.driverUserId, driverUserId), inArray(driverCarAssignments.status, [...ASSIGNMENT_OPEN])))
    .orderBy(desc(driverCarAssignments.createdAt)).limit(1);
  if (!row) return null;
  const { damageIntentId, ...a } = row.a;
  return { ...a, car: { ...driverCarView(row.c), licensePlate: row.a.status === "active" ? row.c.licensePlate : undefined } };
}

/** A driver asks for a PG Ride car. Nothing is charged until hand-over. */
export async function requestFleetCar(driverUserId: string, body: any, now: Date = new Date()): Promise<DriverCarAssignment> {
  const profile = await storage.getDriverProfile(driverUserId);
  if (!profile) throw new RentalError("Apply to drive first: a PG Ride car is for PG Ride drivers.", 403);
  if (profile.isSuspended) throw new RentalError("Your driver account is suspended. Contact support.", 403);
  if (!profile.licenseImageUrl) throw new RentalError("Upload your driving licence in your driver documents first.", 400);
  if (stripeService.isEnabled && !(await driverCard(driverUserId))) throw new RentalError("Add a payment card in Profile first: the weekly rent goes on your card.");
  const [open] = await db.select({ id: driverCarAssignments.id }).from(driverCarAssignments)
    .where(and(eq(driverCarAssignments.driverUserId, driverUserId), inArray(driverCarAssignments.status, [...ASSIGNMENT_OPEN]))).limit(1);
  if (open) throw new RentalError("You already have a PG Ride car, or a request for one. Cancel it first to ask for another.", 409);
  const car = await offeredCar(clean(body?.carId, 64), now);
  const q = quoteDriverAssignment(car, body?.startsAt, body?.weeks, now);
  if (!q.ok) throw new RentalError(q.error);
  const held = await holdingBookings(car.id);
  if (held.some((h) => rentalsOverlap(h, q.quote))) throw new RentalError("That car is already out for some of those days. Pick another car or another start.", 409);
  const [a] = await db.insert(driverCarAssignments).values({
    carId: car.id, driverUserId, status: "requested", startsAt: q.quote.startsAt, weeks: q.quote.weeks, endsAt: q.quote.endsAt,
    weeklyRent: q.quote.weeklyRent.toFixed(2),
  }).returning();
  opsAlert(formatOpsAlert("🔑 A driver asks for a PG Ride car", [
    ["Car", `${car.year} ${car.make} ${car.model} (${car.licensePlate})`], ["From", q.quote.startsAt.toISOString()], ["Weeks", q.quote.weeks],
    ["Rent", `${money(q.quote.weeklyRent)} a week`], ["Driver approved", profile.approvalStatus === "approved" ? "yes" : `no (${profile.approvalStatus})`],
    ["Next", "Assign or decline in Admin, Car rental"],
  ]));
  return a;
}

export async function cancelFleetRequest(driverUserId: string): Promise<DriverCarAssignment> {
  const [a] = await db.update(driverCarAssignments).set({ status: "cancelled", cancelReason: "Cancelled by the driver", updatedAt: new Date() })
    .where(and(eq(driverCarAssignments.driverUserId, driverUserId), inArray(driverCarAssignments.status, ["requested", "assigned"]))).returning();
  if (!a) throw new RentalError("There is no request to cancel. A car you have collected is returned at the PG Ride lot.", 409);
  return a;
}

export async function listAssignments() {
  const rows = await db.select({ a: driverCarAssignments, c: rentalCars }).from(driverCarAssignments)
    .innerJoin(rentalCars, eq(rentalCars.id, driverCarAssignments.carId)).orderBy(desc(driverCarAssignments.createdAt)).limit(200);
  const out = [];
  for (const { a, c } of rows) {
    const u = await storage.getUser(a.driverUserId);
    const p = await storage.getDriverProfile(a.driverUserId);
    out.push({ ...a, car: { id: c.id, make: c.make, model: c.model, year: c.year, licensePlate: c.licensePlate },
      driver: { name: `${u?.firstName ?? ""} ${u?.lastName ?? ""}`.trim() || a.driverUserId, approvalStatus: p?.approvalStatus ?? "missing" } });
  }
  return out;
}

/** Assign: the car is held for the driver's weeks. The car row is locked so two assignments or a rental cannot both win. */
export async function assignFleetCar(id: string): Promise<DriverCarAssignment> {
  return db.transaction(async (tx) => {
    const [a] = await tx.select().from(driverCarAssignments).where(eq(driverCarAssignments.id, id)).for("update");
    if (!a) throw new RentalError("Not found.", 404);
    if (a.status !== "requested") throw new RentalError(`This is ${a.status}; only a request can be assigned.`, 409);
    await tx.select({ id: rentalCars.id }).from(rentalCars).where(eq(rentalCars.id, a.carId)).for("update");
    const held = await holdingBookings(a.carId, tx);
    if (held.some((h) => h.id !== a.id && rentalsOverlap(h, a))) throw new RentalError("The car is already out for some of those days. Decline this request.", 409);
    const [u] = await tx.update(driverCarAssignments).set({ status: "assigned", updatedAt: new Date() }).where(eq(driverCarAssignments.id, id)).returning();
    return u;
  });
}

export async function declineFleetRequest(id: string, reason: unknown): Promise<DriverCarAssignment> {
  const [u] = await db.update(driverCarAssignments).set({ status: "declined", cancelReason: clean(reason, 200) || "Not available", updatedAt: new Date() })
    .where(and(eq(driverCarAssignments.id, id), eq(driverCarAssignments.status, "requested"))).returning();
  if (!u) throw new RentalError("Only a request can be declined.", 409);
  return u;
}

/**
 * Charge one week of rent, at most once. The week's row is written first
 * (unique per assignment and week); a week already paid is not charged
 * again, a week whose charge is still in flight is refused, and a week
 * whose charge failed is tried again.
 */
export async function chargeWeek(a: DriverCarAssignment, periodStart: Date): Promise<{ ok: true } | { ok: false; error: string }> {
  const amount = a.weeklyRent;
  const [fresh] = await db.insert(driverRentCharges).values({ assignmentId: a.id, periodStart, amount, status: "charging" })
    .onConflictDoNothing().returning();
  let row = fresh;
  if (!row) {
    const [existing] = await db.select().from(driverRentCharges).where(and(eq(driverRentCharges.assignmentId, a.id), eq(driverRentCharges.periodStart, periodStart)));
    if (existing?.status === "paid") return { ok: true };
    // A charge whose answer was lost (the process stopped mid-call) stays
    // "charging"; after CHARGING_STALE_MS it may be taken up again, and
    // Stripe is asked first whether the charge went through.
    const stale = existing?.status === "charging" && Date.now() - new Date(existing.updatedAt).getTime() > CHARGING_STALE_MS;
    if (existing?.status === "charging" && !stale) return { ok: false, error: "This week's rent is being charged right now." };
    const [claimed] = await db.update(driverRentCharges).set({ status: "charging", error: null, updatedAt: new Date() })
      .where(and(eq(driverRentCharges.id, existing!.id), stale
        ? and(eq(driverRentCharges.status, "charging"), lte(driverRentCharges.updatedAt, new Date(Date.now() - CHARGING_STALE_MS)))
        : eq(driverRentCharges.status, "failed"))).returning();
    if (!claimed) return { ok: false, error: "This week's rent is being charged right now." };
    row = claimed;
    if (stale) {
      try {
        const card = await driverCard(a.driverUserId);
        const found = card && stripeService.isEnabled ? await stripeService.findRentalCharge(card.customerId, a.id, "driver_rent", String(periodStart.getTime())) : null;
        if (found?.status === "succeeded") return markWeekPaid(a, row.id, found.id, periodStart);
      } catch (err) {
        // Leave it stale so the next try asks Stripe again; nothing was charged here.
        await db.update(driverRentCharges).set({ status: "charging", error: `Could not check Stripe: ${errText(err)}`, updatedAt: new Date(Date.now() - CHARGING_STALE_MS - 1000) }).where(eq(driverRentCharges.id, row.id));
        return { ok: false, error: `Could not check with Stripe whether this week was already charged (${errText(err)}). Nothing was charged.` };
      }
    }
  }
  try {
    if (!stripeService.isEnabled) throw new Error("card payments are not set up on this deployment");
    const card = await driverCard(a.driverUserId);
    if (!card) throw new Error("the driver has no card on file");
    const pi = await stripeService.chargeRental({ amount: Number(amount), ...card, bookingId: a.id, renterId: a.driverUserId, purpose: "driver_rent", keyPart: String(periodStart.getTime()) });
    if (pi.status !== "succeeded") throw new Error(`the card answered ${pi.status}`);
    return markWeekPaid(a, row.id, pi.id, periodStart);
  } catch (err) {
    await db.update(driverRentCharges).set({ status: "failed", error: errText(err), updatedAt: new Date() }).where(eq(driverRentCharges.id, row.id));
    return { ok: false, error: errText(err) };
  }
}

/** A charge row older than this in "charging" had its answer lost; it may be taken up again. */
export const CHARGING_STALE_MS = 10 * 60 * 1000;

async function markWeekPaid(a: DriverCarAssignment, chargeRowId: string, intentId: string, periodStart: Date): Promise<{ ok: true }> {
  await db.update(driverRentCharges).set({ status: "paid", stripePaymentIntentId: intentId, error: null, updatedAt: new Date() }).where(eq(driverRentCharges.id, chargeRowId));
  const paidThrough = new Date(periodStart.getTime() + WEEK_MS);
  await db.update(driverCarAssignments).set({ paidThrough, paymentStatus: "paid", paymentError: null, updatedAt: new Date() })
    .where(and(eq(driverCarAssignments.id, a.id), sql`(${driverCarAssignments.paidThrough} IS NULL OR ${driverCarAssignments.paidThrough} < ${paidThrough})`));
  return { ok: true };
}

/** Hand the car over: the first week is charged; the car becomes the driver's vehicle. */
export async function handOverFleetCar(id: string, actorId: string, body: any, now: Date = new Date()): Promise<DriverCarAssignment> {
  const a = await load(id);
  if (a.status !== "assigned") throw new RentalError(`This is ${a.status}; only an assigned car can be handed over.`, 409);
  const profile = await storage.getDriverProfile(a.driverUserId);
  if (!profile) throw new RentalError("The driver has no driver profile.", 409);
  const odometer = Number(body?.odometer);
  if (!Number.isInteger(odometer) || odometer < 0 || odometer > 2_000_000) throw new RentalError("Enter the odometer reading at hand-over.");
  const photos = await verifiedPhotoList(body?.photos, actorId, "hand-over photo");
  if (photos.length < 4) throw new RentalError("Take at least 4 photos of the car at hand-over: front, back and both sides.");
  const [stillOut] = await db.select({ id: driverCarAssignments.id }).from(driverCarAssignments)
    .where(and(eq(driverCarAssignments.carId, a.carId), eq(driverCarAssignments.status, "active"))).limit(1);
  if (stillOut) throw new RentalError("This car is still with another driver. Take it back first.", 409);
  const [rentedOut] = await db.select({ id: rentalBookings.id }).from(rentalBookings)
    .where(and(eq(rentalBookings.carId, a.carId), eq(rentalBookings.status, "collected"))).limit(1);
  if (rentedOut) throw new RentalError("This car is still out on a rental. Take it back first.", 409);
  const charged = await chargeWeek(a, now);
  if (!charged.ok) {
    await db.update(driverCarAssignments).set({ paymentError: `First week's rent declined: ${charged.error}` }).where(eq(driverCarAssignments.id, id));
    opsAlert(formatOpsAlert("💳 Driver car rent declined at hand-over", [["Assignment", id.slice(0, 8)], ["Rent", money(a.weeklyRent)], ["Reason", charged.error], ["Effect", "Car not handed over"]]));
    throw new RentalError(`The first week's rent could not be charged (${charged.error}). The car stays here.`, 402);
  }
  const [car] = await db.select().from(rentalCars).where(eq(rentalCars.id, a.carId));
  const [vehicle] = await db.insert(vehicles).values({
    driverProfileId: profile.id, make: car.make, model: car.model, year: car.year, color: car.color,
    licensePlate: car.licensePlate, photos: car.photos ?? [], vehicleType: car.vehicleType, rentalCarId: car.id,
  }).returning();
  // The weeks run from the hand-over: a car handed over late still gives the
  // driver every week they asked for, if the car is free for the extra days.
  let endsAt = a.endsAt;
  const reanchored = new Date(now.getTime() + a.weeks * WEEK_MS);
  if (reanchored > a.endsAt) {
    const held = await holdingBookings(a.carId);
    if (!held.some((h) => h.id !== a.id && rentalsOverlap(h, { startsAt: a.endsAt, endsAt: reanchored }))) endsAt = reanchored;
  }
  const [u] = await db.update(driverCarAssignments).set({
    status: "active", collectedAt: now, collectOdometer: odometer, collectPhotos: photos, vehicleId: vehicle.id, endsAt, updatedAt: now,
  }).where(and(eq(driverCarAssignments.id, id), eq(driverCarAssignments.status, "assigned"))).returning();
  if (!u) {
    // Cancelled while the desk was charging: the copy goes and the week is given back.
    await db.delete(vehicles).where(eq(vehicles.id, vehicle.id));
    const [week] = await db.select().from(driverRentCharges).where(and(eq(driverRentCharges.assignmentId, id), eq(driverRentCharges.status, "paid"))).limit(1);
    let refunded = false;
    if (week?.stripePaymentIntentId) {
      try {
        await stripeService.refundPaymentIntent(week.stripePaymentIntentId, "driver cancelled during hand-over");
        await db.update(driverRentCharges).set({ status: "refunded", updatedAt: new Date() }).where(eq(driverRentCharges.id, week.id));
        refunded = true;
      } catch (err) {
        opsAlert(formatOpsAlert("💳 Driver car refund FAILED", [["Assignment", id.slice(0, 8)], ["Reason", errText(err)], ["Next", "Refund the first week by hand in Stripe"]]));
      }
    }
    throw new RentalError(refunded ? "The driver cancelled while the car was being handed over. The first week was given back." : "The driver cancelled while the car was being handed over. Refund the first week in Stripe.", 409);
  }
  return u;
}

/** Take the car back. Any damage is charged to the card; the car stops being the driver's vehicle. */
export async function takeBackFleetCar(id: string, actorId: string, body: any, now: Date = new Date()): Promise<DriverCarAssignment> {
  const a = await load(id);
  if (a.status !== "active") throw new RentalError(`This is ${a.status}; only a car a driver has can be taken back.`, 409);
  const onRide = await storage.getActiveRidesForDriver(a.driverUserId).catch(() => []);
  if (onRide.length) throw new RentalError("The driver is on a ride in this car. Take it back when the ride ends.", 409);
  const odometer = Number(body?.odometer);
  if (!Number.isInteger(odometer) || (a.collectOdometer !== null && odometer < a.collectOdometer)) throw new RentalError("Enter the odometer reading at return; it cannot be lower than at hand-over.");
  const photos = await verifiedPhotoList(body?.photos, actorId, "return photo");
  if (photos.length < 4) throw new RentalError("Take at least 4 photos of the car at return: front, back and both sides.");
  const s = settleReturn({ milesAllowed: Number.MAX_SAFE_INTEGER, collectOdometer: a.collectOdometer ?? odometer, returnOdometer: odometer, extraMileFee: 0, endsAt: now, returnedAt: now, lateHourFee: 0, damageAmount: body?.damageAmount, deposit: 0 });
  if (!s.ok) throw new RentalError(s.error);
  const damage = s.settlement.damage;
  if (damage > 0 && !clean(body?.damageNote, 500)) throw new RentalError("Say what the damage is: the driver is shown it.");
  const [u] = await db.update(driverCarAssignments).set({
    status: "ended", returnedAt: now, returnOdometer: odometer, returnPhotos: photos,
    damageAmount: damage > 0 ? damage.toFixed(2) : null, damageNote: clean(body?.damageNote, 500) || null, updatedAt: now,
  }).where(and(eq(driverCarAssignments.id, id), eq(driverCarAssignments.status, "active"))).returning();
  if (!u) throw new RentalError("This changed just now. Refresh and try again.", 409);
  if (a.vehicleId) await db.delete(vehicles).where(and(eq(vehicles.id, a.vehicleId), isNotNull(vehicles.rentalCarId)));
  const profile = await storage.getDriverProfile(a.driverUserId);
  const left = profile ? await storage.getVehiclesByDriverId(profile.id) : [];
  if (!left.length) await storage.toggleDriverOnlineStatus(a.driverUserId, false).catch(() => {});
  if (damage > 0) return chargeDamage(u);
  return u;
}

export async function chargeDamage(a: DriverCarAssignment): Promise<DriverCarAssignment> {
  if (!a.damageAmount || a.damageIntentId) return a;
  try {
    if (!stripeService.isEnabled) throw new Error("card payments are not set up on this deployment");
    const card = await driverCard(a.driverUserId);
    if (!card) throw new Error("the driver has no card on file");
    const pi = await stripeService.chargeRental({ amount: Number(a.damageAmount), ...card, bookingId: a.id, renterId: a.driverUserId, purpose: "driver_damage" });
    if (pi.status !== "succeeded") throw new Error(`the card answered ${pi.status}`);
    const [u] = await db.update(driverCarAssignments).set({ damageIntentId: pi.id, paymentError: null }).where(eq(driverCarAssignments.id, a.id)).returning();
    return u;
  } catch (err) {
    const [u] = await db.update(driverCarAssignments).set({ paymentError: `Damage charge failed: ${errText(err)}` }).where(eq(driverCarAssignments.id, a.id)).returning();
    opsAlert(formatOpsAlert("💳 Driver car damage charge FAILED", [["Assignment", a.id.slice(0, 8)], ["Amount", money(a.damageAmount)], ["Reason", errText(err)], ["Next", "Retry from Admin, Car rental"]]));
    return u;
  }
}

/** More weeks, if the car is free for them. */
export async function extendFleetCar(id: string, weeksRaw: unknown): Promise<DriverCarAssignment> {
  const add = Number(weeksRaw);
  if (!Number.isInteger(add) || add < 1 || add > 12) throw new RentalError("Add between 1 and 12 weeks.");
  return db.transaction(async (tx) => {
    const [a] = await tx.select().from(driverCarAssignments).where(eq(driverCarAssignments.id, id)).for("update");
    if (!a || !["assigned", "active"].includes(a.status)) throw new RentalError("Only a car assigned to or with a driver can be extended.", 409);
    await tx.select({ id: rentalCars.id }).from(rentalCars).where(eq(rentalCars.id, a.carId)).for("update");
    const next = { startsAt: a.endsAt, endsAt: new Date(a.endsAt.getTime() + add * WEEK_MS) };
    const held = await holdingBookings(a.carId, tx);
    if (held.some((h) => h.id !== a.id && rentalsOverlap(h, next))) throw new RentalError("The car is booked for some of those days.", 409);
    const [u] = await tx.update(driverCarAssignments).set({ weeks: a.weeks + add, endsAt: next.endsAt, updatedAt: new Date() }).where(eq(driverCarAssignments.id, id)).returning();
    return u;
  });
}

/** Charge the week that is due now for one assignment (the sweep, or the desk's retry). */
export async function chargeDueWeek(id: string, now: Date = new Date()): Promise<DriverCarAssignment> {
  const a = await load(id);
  if (a.status !== "active") throw new RentalError("Only a car a driver has is charged rent.", 409);
  const periodStart = a.paidThrough ?? a.collectedAt ?? now;
  if (periodStart.getTime() >= a.endsAt.getTime()) return a;
  const r = await chargeWeek(a, periodStart);
  if (!r.ok) {
    const [u] = await db.update(driverCarAssignments).set({ paymentStatus: "due", paymentError: `Rent for the week from ${periodStart.toISOString().slice(0, 10)} failed: ${r.error}`, updatedAt: new Date() })
      .where(eq(driverCarAssignments.id, id)).returning();
    opsAlert(formatOpsAlert("💳 Driver car rent FAILED", [["Assignment", id.slice(0, 8)], ["Week from", periodStart.toISOString().slice(0, 10)], ["Rent", money(a.weeklyRent)], ["Reason", r.error], ["Effect", "The driver cannot go online in this car until it is paid"], ["Next", "Retry from Admin, Car rental"]]));
    return u;
  }
  return load(id);
}

/** The hourly rent sweep: charge the next week for every car whose paid week is about to run out. */
export async function runDriverRentSweep(now: Date = new Date()): Promise<{ charged: number; failed: number }> {
  const due = await db.select().from(driverCarAssignments).where(and(
    eq(driverCarAssignments.status, "active"),
    lte(driverCarAssignments.paidThrough, new Date(now.getTime() + RENT_CHARGE_LEAD_MS)),
    sql`${driverCarAssignments.paidThrough} < ${driverCarAssignments.endsAt}`,
  ));
  let charged = 0, failed = 0;
  for (const a of due) {
    const after = await chargeDueWeek(a.id, now).catch(() => null);
    if (after && after.paymentStatus === "paid" && after.paidThrough && after.paidThrough > (a.paidThrough ?? now)) charged++; else failed++;
  }
  // A driver whose only car is a PG Ride car and whose rent has run out is
  // taken offline, unless they are on a ride (they finish it; going online
  // again is refused until the rent is paid).
  const lapsed = await db.select().from(driverCarAssignments).where(and(eq(driverCarAssignments.status, "active"), lte(driverCarAssignments.paidThrough, now)));
  for (const a of lapsed) {
    const block = await fleetDriveBlock(a.driverUserId, now).catch(() => null);
    if (!block) continue;
    const onRide = await storage.getActiveRidesForDriver(a.driverUserId).catch(() => [1]);
    if (!onRide.length) await storage.toggleDriverOnlineStatus(a.driverUserId, false).catch(() => {});
  }
  return { charged, failed };
}

/** The go-online check (server/routes.ts toggle-status). Null means go ahead. */
export async function fleetDriveBlock(driverUserId: string, now: Date = new Date()): Promise<string | null> {
  const profile = await storage.getDriverProfile(driverUserId);
  if (!profile) return null;
  const cars = await storage.getVehiclesByDriverId(profile.id);
  const ownCars = cars.filter((v: any) => !v.rentalCarId).length;
  const fleetCars = cars.length - ownCars;
  const [a] = await db.select().from(driverCarAssignments)
    .where(and(eq(driverCarAssignments.driverUserId, driverUserId), eq(driverCarAssignments.status, "active"))).limit(1);
  // A driver approved on a PG Ride car alone (no insurance or car photos of
  // their own) has nothing to drive once it goes back.
  const ownPapers = !!profile.insuranceImageUrl || (Array.isArray((profile as any).vehiclePhotoUrls) && (profile as any).vehiclePhotoUrls.length > 0);
  if (!cars.length && !ownPapers) return "You have no car at the moment. Ask for a PG Ride car on your Profile, or add your own car in Driver Documents.";
  const verdict = fleetDriverMayDrive({ ownCars, fleetCars, assignment: a ?? null, now });
  return verdict.ok ? null : verdict.reason;
}

/** For the approval check: does this driver have a PG Ride car assigned or in hand? */
export async function hasFleetCar(driverUserId: string): Promise<boolean> {
  const [a] = await db.select({ id: driverCarAssignments.id }).from(driverCarAssignments)
    .where(and(eq(driverCarAssignments.driverUserId, driverUserId), inArray(driverCarAssignments.status, ["assigned", "active"]))).limit(1);
  return !!a;
}

export { isNull };
