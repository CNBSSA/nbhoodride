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
import { driverCarAssignments, driverRentCharges, rentalBookings, rentalCars, users, vehicles, walletTransactions, type DriverCarAssignment } from "@shared/schema";
import {
  ASSIGNMENT_OPEN, RENT_CHARGE_LEAD_MS, WEEK_MS, driverLateFee, fleetDriverMayDrive, money, qualificationProblems, quoteDriverAssignment, rentalsOverlap, settleReturn,
  splitFromEarnings,
} from "@shared/rental";
import { stripeService, stripeSaidNo } from "../stripeService";
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
    // The driver's written agreement (the sentence shown beside the box) to pay rent from earnings first.
    rentFromEarningsAgreedAt: body?.rentFromEarnings === true ? now : null,
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
  // A hand-over that failed may already have taken the first week from the
  // driver's earnings; cancelling before collection is free, so it goes back
  // (code review 2026-10-06). A charge still in flight is left to the
  // hand-over, which gives it back itself when it finds the request cancelled.
  await giveBackUnusedRent(a, "driver cancelled before collection", { skipInFlight: true });
  return a;
}

/**
 * Give back everything taken for an assignment's rent that the driver never
 * drove for: each week row not yet given back is claimed (status refunded)
 * before anything moves, so two callers cannot both refund it; a paid card
 * charge is refunded; a charge whose answer was lost is looked up on Stripe
 * and refunded if it went through; what came from earnings is credited back
 * once. Anything that cannot be given back is paged (code review 2026-10-06).
 */
async function giveBackUnusedRent(a: DriverCarAssignment, why: string, opts: { skipInFlight?: boolean } = {}): Promise<boolean> {
  const rows = await db.select().from(driverRentCharges).where(eq(driverRentCharges.assignmentId, a.id));
  let allBack = true;
  for (const row of rows) {
    if (row.status === "refunded") continue;
    const inFlight = row.status === "charging" && !row.error && Date.now() - new Date(row.updatedAt).getTime() <= CHARGING_STALE_MS;
    if (inFlight && opts.skipInFlight) continue;
    const [claimed] = await db.update(driverRentCharges).set({ status: "refunded", updatedAt: new Date() })
      .where(and(eq(driverRentCharges.id, row.id), eq(driverRentCharges.status, row.status))).returning();
    if (!claimed) continue;
    const problems: string[] = [];
    let intentId = row.status === "paid" ? row.stripePaymentIntentId : null;
    if (row.status === "charging") {
      try {
        const card = await driverCard(a.driverUserId);
        const found = card && stripeService.isEnabled ? await stripeService.findRentalCharge(card.customerId, a.id, "driver_rent", String(new Date(row.periodStart).getTime())) : null;
        if (found?.status === "succeeded") intentId = found.id;
      } catch (err) {
        problems.push(`could not ask Stripe whether the card was charged (${errText(err)})`);
      }
    }
    if (intentId) {
      try { await stripeService.refundPaymentIntent(intentId, why); } catch (err) { problems.push(`card refund failed (${errText(err)})`); }
    }
    if (Number(row.fromEarnings ?? 0) > 0) {
      try { await creditBackOnce(a.driverUserId, Number(row.fromEarnings), row.id); } catch (err) { problems.push(`earnings not credited back (${errText(err)})`); }
    }
    if (problems.length) {
      allBack = false;
      await db.update(driverRentCharges).set({ error: `Give-back incomplete: ${problems.join("; ")}`.slice(0, 300) }).where(eq(driverRentCharges.id, row.id));
      opsAlert(formatOpsAlert("💳 Driver car refund FAILED", [["Assignment", a.id.slice(0, 8)], ["Week from", new Date(row.periodStart).toISOString().slice(0, 10)], ["From earnings", money(row.fromEarnings ?? 0)], ["Reason", problems.join("; ")], ["Next", "Refund it by hand in Stripe and credit the driver's balance"]]));
    }
  }
  return allBack;
}

/** Credit back what a week took from earnings, once: the ledger is checked under the balance's lock. */
async function creditBackOnce(driverUserId: string, amount: number, rowId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [u] = await tx.select({ balance: users.virtualCardBalance }).from(users).where(eq(users.id, driverUserId)).for("update");
    if (!u) throw new Error("driver not found");
    const [done] = await tx.select({ id: walletTransactions.id }).from(walletTransactions)
      .where(and(eq(walletTransactions.rideId, rowId), eq(walletTransactions.reason, RENT_REFUND_REASON))).limit(1);
    if (done) return;
    const after = (Number(u.balance ?? 0) + amount).toFixed(2);
    await tx.update(users).set({ virtualCardBalance: after, updatedAt: new Date() }).where(eq(users.id, driverUserId));
    await tx.insert(walletTransactions).values({ userId: driverUserId, amount: amount.toFixed(2), balanceAfter: after, reason: RENT_REFUND_REASON, rideId: rowId });
  });
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
    const [car] = await tx.select().from(rentalCars).where(eq(rentalCars.id, a.carId)).for("update");
    // A car whose papers lapsed is not promised to anyone (code review 2026-10-06).
    const gaps = car ? qualificationProblems(car, new Date()) : ["The car is gone."];
    if (gaps.length) throw new RentalError(`This car does not qualify to go out: ${gaps.join(" ")}`, 409, gaps);
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
 * The driver agrees, or withdraws their agreement, to rent (and anything owed
 * at return) being taken from their earnings first. Withdrawing takes effect
 * from the next week not yet charged.
 */
export async function setRentFromEarnings(driverUserId: string, agree: unknown): Promise<DriverCarAssignment> {
  const [a] = await db.update(driverCarAssignments).set({ rentFromEarningsAgreedAt: agree === true ? new Date() : null, updatedAt: new Date() })
    .where(and(eq(driverCarAssignments.driverUserId, driverUserId), inArray(driverCarAssignments.status, [...ASSIGNMENT_OPEN]))).returning();
  if (!a) throw new RentalError("You have no PG Ride car or request for one.", 404);
  return a;
}

/** Ledger reasons for money a driver pays from earnings for a PG Ride car. */
export const RENT_FROM_EARNINGS_REASON = "driver_car_rent";
export const RETURN_FROM_EARNINGS_REASON = "driver_car_return";
export const RENT_REFUND_REASON = "driver_car_rent_refund";

/**
 * Take up to `amount` from the driver's balance, once per (reason, ref): the
 * balance is locked, the ledger row written in the same transaction, and a
 * ledger row already there for this ref means it was taken before. Returns
 * what was taken.
 */
async function takeFromEarnings(driverUserId: string, amount: number, reason: string, refId: string): Promise<number> {
  return db.transaction(async (tx) => {
    const [u] = await tx.select({ balance: users.virtualCardBalance }).from(users).where(eq(users.id, driverUserId)).for("update");
    if (!u) return 0;
    const [done] = await tx.select({ amount: walletTransactions.amount }).from(walletTransactions)
      .where(and(eq(walletTransactions.rideId, refId), eq(walletTransactions.reason, reason))).limit(1);
    if (done) return Math.abs(Number(done.amount));
    const { fromEarnings } = splitFromEarnings(amount, u.balance);
    if (fromEarnings <= 0) return 0;
    const after = (Number(u.balance ?? 0) - fromEarnings).toFixed(2);
    await tx.update(users).set({ virtualCardBalance: after, updatedAt: new Date() }).where(eq(users.id, driverUserId));
    await tx.insert(walletTransactions).values({ userId: driverUserId, amount: (-fromEarnings).toFixed(2), balanceAfter: after, reason, rideId: refId });
    return fromEarnings;
  });
}

/** An answer from Stripe (or from us before Stripe was called): nothing was charged, and the next try is a new attempt. */
class Declined extends Error {}

/**
 * Charge one week of rent, at most once. The week's row is written first
 * (unique per assignment and week); a week already paid is not charged
 * again, a week whose charge is still in flight is refused, and a week
 * whose charge failed is tried again. When the driver agreed to it, the
 * week is taken from their earnings first, once, and the card is charged
 * only the rest — the same rest on every retry, so a retry is the same
 * Stripe request.
 *
 * `periodStart` names the week (the first week is named by the assignment's
 * own start, so every hand-over attempt is the same week, the same row and
 * the same Stripe key); `paidFrom` is when the paid week begins (the
 * hand-over itself for the first week). A charge whose answer was lost stays
 * "charging" with the reason, and the next try asks Stripe before repeating
 * it under the same key; only a recorded decline makes the next try a new
 * attempt with a new key (code review 2026-10-06).
 */
export async function chargeWeek(a: DriverCarAssignment, periodStart: Date, paidFrom: Date = periodStart): Promise<{ ok: true } | { ok: false; error: string }> {
  const amount = a.weeklyRent;
  const keyPart = String(periodStart.getTime());
  const [fresh] = await db.insert(driverRentCharges).values({ assignmentId: a.id, periodStart, amount, status: "charging" })
    .onConflictDoNothing().returning();
  let row = fresh;
  if (!row) {
    const [existing] = await db.select().from(driverRentCharges).where(and(eq(driverRentCharges.assignmentId, a.id), eq(driverRentCharges.periodStart, periodStart)));
    if (!existing) return { ok: false, error: "This week's rent could not be found. Try again." };
    if (existing.status === "paid") return markWeekPaid(a, existing.id, existing.stripePaymentIntentId, paidFrom);
    if (existing.status === "refunded") return { ok: false, error: "This week's rent was given back. Ask the driver to request the car again." };
    // A charge whose answer was lost stays "charging": with the reason
    // recorded it may be taken up at once (the same key replays it); with
    // none (the process stopped mid-call) only after CHARGING_STALE_MS.
    const unanswered = existing.status === "charging" && !!existing.error;
    const stale = existing.status === "charging" && Date.now() - new Date(existing.updatedAt).getTime() > CHARGING_STALE_MS;
    if (existing.status === "charging" && !unanswered && !stale) return { ok: false, error: "This week's rent is being charged right now." };
    const [claimed] = await db.update(driverRentCharges).set({ status: "charging", error: null, updatedAt: new Date() })
      .where(and(eq(driverRentCharges.id, existing.id), existing.status === "failed"
        ? eq(driverRentCharges.status, "failed")
        : and(eq(driverRentCharges.status, "charging"), unanswered
          ? isNotNull(driverRentCharges.error)
          : lte(driverRentCharges.updatedAt, new Date(Date.now() - CHARGING_STALE_MS))))).returning();
    if (!claimed) return { ok: false, error: "This week's rent is being charged right now." };
    row = claimed;
    // Every retry asks Stripe first: a charge that went through is adopted, never repeated.
    try {
      const card = await driverCard(a.driverUserId);
      const found = card && stripeService.isEnabled ? await stripeService.findRentalCharge(card.customerId, a.id, "driver_rent", keyPart) : null;
      if (found?.status === "succeeded") return markWeekPaid(a, row.id, found.id, paidFrom);
    } catch (err) {
      // Put it back as it was; nothing was charged here.
      await db.update(driverRentCharges).set(existing.status === "failed"
        ? { status: "failed", error: `Could not check Stripe: ${errText(err)}`, updatedAt: new Date() }
        : { status: "charging", error: `Could not check Stripe: ${errText(err)}`, updatedAt: new Date() }).where(eq(driverRentCharges.id, row.id));
      return { ok: false, error: `Could not check with Stripe whether this week was already charged (${errText(err)}). Nothing was charged.` };
    }
    // After a recorded decline the next try is a new attempt (a new key);
    // after a lost answer it is the same attempt, replayed.
    if (existing.status === "failed") {
      const [bumped] = await db.update(driverRentCharges).set({ attempt: existing.attempt + 1 }).where(eq(driverRentCharges.id, row.id)).returning();
      row = bumped;
    }
  }
  let fromEarnings = row.fromEarnings === null ? null : Number(row.fromEarnings);
  try {
    // Earnings first, decided once per week (0 when the driver has not agreed).
    if (fromEarnings === null) {
      const [agreed] = await db.select({ at: driverCarAssignments.rentFromEarningsAgreedAt }).from(driverCarAssignments).where(eq(driverCarAssignments.id, a.id));
      fromEarnings = agreed?.at ? await takeFromEarnings(a.driverUserId, Number(amount), RENT_FROM_EARNINGS_REASON, row.id) : 0;
      await db.update(driverRentCharges).set({ fromEarnings: fromEarnings.toFixed(2), updatedAt: new Date() }).where(eq(driverRentCharges.id, row.id));
    }
    const fromCard = Math.round((Number(amount) - fromEarnings) * 100) / 100;
    if (fromCard <= 0) return markWeekPaid(a, row.id, null, paidFrom);
    if (!stripeService.isEnabled) throw new Declined(fromEarnings > 0 ? `${money(fromEarnings)} was taken from earnings; card payments are not set up on this deployment for the other ${money(fromCard)}` : "card payments are not set up on this deployment");
    const card = await driverCard(a.driverUserId);
    if (!card) throw new Declined(fromEarnings > 0 ? `${money(fromEarnings)} was taken from earnings and the driver has no card on file for the other ${money(fromCard)}` : "the driver has no card on file");
    let pi;
    try {
      pi = await stripeService.chargeRental({ amount: fromCard, ...card, bookingId: a.id, renterId: a.driverUserId, purpose: "driver_rent", keyPart, attempt: row.attempt });
    } catch (err) {
      if (stripeSaidNo(err)) throw new Declined(errText(err));
      throw err;
    }
    if (pi.status !== "succeeded") throw new Declined(`the card answered ${pi.status}`);
    return markWeekPaid(a, row.id, pi.id, paidFrom);
  } catch (err) {
    if (err instanceof Declined || fromEarnings === null) {
      await db.update(driverRentCharges).set({ status: "failed", error: errText(err), updatedAt: new Date() }).where(eq(driverRentCharges.id, row.id));
      return { ok: false, error: errText(err) };
    }
    // No verdict from Stripe: the card may have been charged. The week stays
    // "charging" on this attempt so the next try asks Stripe and repeats it
    // under the same key, never a second charge.
    const reason = `No answer from Stripe (${errText(err)}). Trying again repeats this charge; it cannot charge twice.`;
    await db.update(driverRentCharges).set({ status: "charging", error: reason.slice(0, 300), updatedAt: new Date() }).where(eq(driverRentCharges.id, row.id));
    return { ok: false, error: reason };
  }
}

/** A charge row older than this in "charging" had its answer lost; it may be taken up again. */
export const CHARGING_STALE_MS = 10 * 60 * 1000;

async function markWeekPaid(a: DriverCarAssignment, chargeRowId: string, intentId: string | null, paidFrom: Date): Promise<{ ok: true }> {
  await db.update(driverRentCharges).set({ status: "paid", stripePaymentIntentId: intentId, error: null, updatedAt: new Date() }).where(eq(driverRentCharges.id, chargeRowId));
  const paidThrough = new Date(paidFrom.getTime() + WEEK_MS);
  await db.update(driverCarAssignments).set({ paidThrough, paymentStatus: "paid", paymentError: null, updatedAt: new Date() })
    .where(and(eq(driverCarAssignments.id, a.id), sql`(${driverCarAssignments.paidThrough} IS NULL OR ${driverCarAssignments.paidThrough} < ${paidThrough})`));
  return { ok: true };
}

/** Why a car cannot leave the lot right now, or null. Read inside the caller's transaction when it holds the car's lock. */
async function carIsOut(carId: string, assignmentId: string, executor: any = db): Promise<string | null> {
  const [stillOut] = await executor.select({ id: driverCarAssignments.id }).from(driverCarAssignments)
    .where(and(eq(driverCarAssignments.carId, carId), eq(driverCarAssignments.status, "active"))).limit(1);
  if (stillOut && stillOut.id !== assignmentId) return "This car is still with another driver. Take it back first.";
  const [rentedOut] = await executor.select({ id: rentalBookings.id }).from(rentalBookings)
    .where(and(eq(rentalBookings.carId, carId), eq(rentalBookings.status, "collected"))).limit(1);
  if (rentedOut) return "This car is still out on a rental. Take it back first.";
  const [c] = await executor.select({ off: rentalCars.engineCutOffAt, on: rentalCars.engineRestoredAt }).from(rentalCars).where(eq(rentalCars.id, carId));
  if (c?.off && !c?.on) return "This car's engine is recorded as cut off. Restore it before handing it over.";
  return null;
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
  // A car whose papers lapsed after it was assigned does not leave the lot (code review 2026-10-06).
  const [carNow] = await db.select().from(rentalCars).where(eq(rentalCars.id, a.carId));
  const gaps = carNow ? qualificationProblems(carNow, now) : ["The car is gone."];
  if (gaps.length) throw new RentalError(`This car does not qualify to go out: ${gaps.join(" ")}`, 409, gaps);
  const out = await carIsOut(a.carId, a.id);
  if (out) throw new RentalError(out, 409);
  // The weeks run from the hand-over (code review 2026-10-06: an EARLY
  // hand-over moves the end earlier too, so the weeks paid are the weeks
  // had, and the late fee starts when they end). Early, the car must be
  // free from now until the driver's own start.
  const reanchored = new Date(now.getTime() + a.weeks * WEEK_MS);
  if (now < a.startsAt) {
    const held = await holdingBookings(a.carId);
    if (held.some((h) => h.id !== a.id && rentalsOverlap(h, { startsAt: now, endsAt: a.startsAt }))) throw new RentalError("The car is booked before this driver's start. Hand it over at the start.", 409);
  }
  // The first week is named by the assignment's start, so every attempt at
  // this hand-over is one row and one Stripe key (code review 2026-10-06).
  const charged = await chargeWeek(a, a.startsAt, now);
  if (!charged.ok) {
    await db.update(driverCarAssignments).set({ paymentError: `First week's rent declined: ${charged.error}` }).where(eq(driverCarAssignments.id, id));
    opsAlert(formatOpsAlert("💳 Driver car rent declined at hand-over", [["Assignment", id.slice(0, 8)], ["Rent", money(a.weeklyRent)], ["Reason", charged.error], ["Effect", "Car not handed over"]]));
    throw new RentalError(`The first week's rent could not be charged (${charged.error}). The car stays here.`, 402);
  }
  // The car row is locked while "is it out?" is asked again and the hand-over
  // written, as confirmRental does, so two desks handing over two requests
  // for one car cannot both win (code review 2026-10-06).
  const result = await db.transaction(async (tx) => {
    const [cur] = await tx.select().from(driverCarAssignments).where(eq(driverCarAssignments.id, id)).for("update");
    const [car] = await tx.select().from(rentalCars).where(eq(rentalCars.id, a.carId)).for("update");
    if (cur.status === "active") return { kind: "already" as const, row: cur };
    if (cur.status !== "assigned") return { kind: "gone" as const, row: cur };
    const busy = await carIsOut(a.carId, a.id, tx);
    if (busy) return { kind: "busy" as const, row: cur, why: busy };
    let endsAt = reanchored;
    if (reanchored > a.endsAt) {
      const held = await holdingBookings(a.carId, tx);
      if (held.some((h) => h.id !== a.id && rentalsOverlap(h, { startsAt: a.endsAt, endsAt: reanchored }))) endsAt = a.endsAt;
    }
    const [vehicle] = await tx.insert(vehicles).values({
      driverProfileId: profile.id, make: car.make, model: car.model, year: car.year, color: car.color,
      licensePlate: car.licensePlate, photos: car.photos ?? [], vehicleType: car.vehicleType, rentalCarId: car.id,
    }).returning();
    const [u] = await tx.update(driverCarAssignments).set({
      status: "active", collectedAt: now, collectOdometer: odometer, collectPhotos: photos, vehicleId: vehicle.id, endsAt, updatedAt: now,
    }).where(eq(driverCarAssignments.id, id)).returning();
    return { kind: "done" as const, row: u };
  });
  // A second hand-over of the same request got there first: the same week,
  // the same row, the same charge. Nothing to undo.
  if (result.kind === "done" || result.kind === "already") return result.row;
  if (result.kind === "busy") {
    // The week stays paid on the request: a hand-over once the car is back
    // uses it, and a cancel gives it back.
    throw new RentalError(`${result.why} The first week is paid and is kept for this hand-over.`, 409);
  }
  // Cancelled while the desk was charging: the week is given back.
  const refunded = await giveBackUnusedRent(a, "driver cancelled during hand-over");
  throw new RentalError(refunded ? "The driver cancelled while the car was being handed over. The first week was given back." : "The driver cancelled while the car was being handed over. Refund the first week in Stripe.", 409);
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
  // Kept past the end of the weeks: every hour started, at the weekly rent / 168 (industry practice, 2026-09-28).
  const late = driverLateFee(a.weeklyRent, a.endsAt, now);
  const [u] = await db.update(driverCarAssignments).set({
    status: "ended", returnedAt: now, returnOdometer: odometer, returnPhotos: photos,
    damageAmount: damage > 0 ? damage.toFixed(2) : null, damageNote: clean(body?.damageNote, 500) || null,
    lateHours: late.lateHours, lateCharge: late.lateCharge > 0 ? late.lateCharge.toFixed(2) : null, updatedAt: now,
  }).where(and(eq(driverCarAssignments.id, id), eq(driverCarAssignments.status, "active"))).returning();
  if (!u) throw new RentalError("This changed just now. Refresh and try again.", 409);
  if (a.vehicleId) await db.delete(vehicles).where(and(eq(vehicles.id, a.vehicleId), isNotNull(vehicles.rentalCarId)));
  const profile = await storage.getDriverProfile(a.driverUserId);
  const left = profile ? await storage.getVehiclesByDriverId(profile.id) : [];
  if (!left.length) await storage.toggleDriverOnlineStatus(a.driverUserId, false).catch(() => {});
  if (damage > 0 || late.lateCharge > 0) return chargeDamage(u);
  return u;
}

/** What a driver owes when the car comes back: damage plus the late fee. */
export function returnOwed(a: Pick<DriverCarAssignment, "damageAmount" | "lateCharge">): number {
  return Math.round((Number(a.damageAmount ?? 0) + Number(a.lateCharge ?? 0)) * 100) / 100;
}

/**
 * Charge what is owed at return (damage and the late fee), once: from the
 * driver's earnings first when they agreed to it (decided once, stored), the
 * card for the rest under one key. Safe to retry from the desk.
 */
export async function chargeDamage(a: DriverCarAssignment): Promise<DriverCarAssignment> {
  const owed = returnOwed(a);
  if (!(owed > 0) || a.damageIntentId) return a;
  let fromEarnings = a.returnFromEarnings === null ? null : Number(a.returnFromEarnings);
  if (fromEarnings !== null && owed - fromEarnings <= 0) return a;
  try {
    if (fromEarnings === null) {
      fromEarnings = a.rentFromEarningsAgreedAt ? await takeFromEarnings(a.driverUserId, owed, RETURN_FROM_EARNINGS_REASON, a.id) : 0;
      const [u] = await db.update(driverCarAssignments).set({ returnFromEarnings: fromEarnings.toFixed(2), paymentError: null }).where(eq(driverCarAssignments.id, a.id)).returning();
      a = u;
    }
    const fromCard = Math.round((owed - fromEarnings) * 100) / 100;
    if (fromCard <= 0) return a;
    if (!stripeService.isEnabled) throw new Error("card payments are not set up on this deployment");
    const card = await driverCard(a.driverUserId);
    if (!card) throw new Error("the driver has no card on file");
    // A retry after a recorded decline is a new attempt (a new key), asked of
    // Stripe first; a lost answer is repeated under its own key (code review 2026-10-06).
    if (a.returnAttempt > 1) {
      const found = await stripeService.findRentalCharge(card.customerId, a.id, "driver_return");
      if (found?.status === "succeeded") {
        const [u] = await db.update(driverCarAssignments).set({ damageIntentId: found.id, paymentError: null }).where(eq(driverCarAssignments.id, a.id)).returning();
        return u;
      }
    }
    let pi;
    try {
      pi = await stripeService.chargeRental({ amount: fromCard, ...card, bookingId: a.id, renterId: a.driverUserId, purpose: "driver_return", attempt: a.returnAttempt });
    } catch (err) {
      if (stripeSaidNo(err)) throw new Declined(errText(err));
      throw err;
    }
    if (pi.status !== "succeeded") throw new Declined(`the card answered ${pi.status}`);
    const [u] = await db.update(driverCarAssignments).set({ damageIntentId: pi.id, paymentError: null }).where(eq(driverCarAssignments.id, a.id)).returning();
    return u;
  } catch (err) {
    if (err instanceof Declined) await db.update(driverCarAssignments).set({ returnAttempt: sql`${driverCarAssignments.returnAttempt} + 1` }).where(and(eq(driverCarAssignments.id, a.id), eq(driverCarAssignments.returnAttempt, a.returnAttempt)));
    const taken = fromEarnings && fromEarnings > 0 ? ` (${money(fromEarnings)} was taken from earnings)` : "";
    const [u] = await db.update(driverCarAssignments).set({ paymentError: `Return charge failed${taken}: ${errText(err)}` }).where(eq(driverCarAssignments.id, a.id)).returning();
    opsAlert(formatOpsAlert("💳 Driver car return charge FAILED", [
      ["Assignment", a.id.slice(0, 8)], ["Damage", money(a.damageAmount ?? 0)], ["Late", `${a.lateHours ?? 0} h, ${money(a.lateCharge ?? 0)}`],
      ["From earnings", money(fromEarnings ?? 0)], ["Reason", errText(err)], ["Next", "Retry from Admin, Car rental"],
    ]));
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
    // New weeks, new end: if the car is late again after them, ops are paged again.
    const [u] = await tx.update(driverCarAssignments).set({ weeks: a.weeks + add, endsAt: next.endsAt, overduePagedAt: null, updatedAt: new Date() }).where(eq(driverCarAssignments.id, id)).returning();
    return u;
  });
}

/** Charge the week that is due now for one assignment (the sweep, or the desk's retry). */
export async function chargeDueWeek(id: string, now: Date = new Date()): Promise<DriverCarAssignment> {
  const a = await load(id);
  if (a.status !== "active") throw new RentalError("Only a car a driver has is charged rent.", 409);
  const periodStart = a.paidThrough ?? a.collectedAt ?? now;
  // Rent is charged by the whole week, never for a period shorter than one,
  // and never for days past the end of the weeks (code review 2026-10-06).
  if (periodStart.getTime() + WEEK_MS > a.endsAt.getTime()) return a;
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
    sql`${driverCarAssignments.paidThrough} + interval '7 days' <= ${driverCarAssignments.endsAt}`,
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
  // A car of the driver's own counts only with the driver's own insurance on
  // file: anyone can type a car into POST /api/vehicles, so a typed-in car
  // alone must not let a driver whose PG Ride car's rent ran out go online
  // (code review 2026-10-06). A fleet account's car (fleetCarId) is that
  // fleet's, papers checked by PG Ride, and counts as it always did.
  const fleetCars = cars.filter((v: any) => !!v.rentalCarId).length;
  const ownCars = cars.filter((v: any) => !v.rentalCarId && (!!v.fleetCarId || !!profile.insuranceImageUrl)).length;
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
