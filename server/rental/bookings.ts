/**
 * Rental bookings: request, confirm, hand over, take back, settle.
 *
 * Money moves only at the desk, never at booking (shared/rental.ts):
 *   - collection charges the rental price and holds the deposit;
 *   - return settles the deposit (part taken for extras, the rest released)
 *     and charges anything owed beyond it.
 * Each Stripe call is idempotency-keyed per booking and purpose, and a charge
 * already recorded on the booking is never made again, so a retried
 * collection or settlement cannot charge twice. A failed payment never
 * strands the car or the renter: collection refuses and says why; a return
 * is recorded whatever the card does, and the settlement is retried by hand.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { driverCarAssignments, rentalBookings, rentalCars, rentalRenters, type RentalBooking } from "@shared/schema";
import { HOLDS_THE_CAR, RENTER_MAY_CANCEL, ageOn, drivingRecordCurrent, money, qualificationProblems, quoteRental, rentalsOverlap, renterProblems, settleReturn } from "@shared/rental";
import { saveRenterFacts } from "./renters";
import { stripeService, stripeSaidNo } from "../stripeService";
import { storage } from "../storage";
import { opsAlert, formatOpsAlert } from "../telegramOps";
import { riderBookingBlock } from "../rideWorkflowService";
import { RentalError, getListedCar, holdingBookings, publicCar, verifiedPhotoList } from "./cars";

const clean = (v: unknown, max = 80) => String(v ?? "").trim().slice(0, max);
const errText = (err: any) => String(err?.message ?? err ?? "unknown error").slice(0, 300);

async function load(bookingId: string): Promise<RentalBooking> {
  const [b] = await db.select().from(rentalBookings).where(eq(rentalBookings.id, bookingId));
  if (!b) throw new RentalError("Booking not found.", 404);
  return b;
}

async function renterCard(renterId: string): Promise<{ customerId: string; paymentMethodId: string } | null> {
  const u = await storage.getUser(renterId);
  if (!u?.stripeCustomerId || !u?.stripePaymentMethodId) return null;
  return { customerId: u.stripeCustomerId, paymentMethodId: u.stripePaymentMethodId };
}

/**
 * Price a stay. With the renter's date of birth (given, or on file), the
 * young-renter fee is in the price; without it the quote says the age is
 * not known yet.
 */
export async function quoteFor(carId: string, startsAt: unknown, endsAt: unknown, now: Date = new Date(), dateOfBirth?: unknown) {
  const car = await getListedCar(carId, now);
  const first = quoteRental(car, startsAt, endsAt, now);
  if (!first.ok) throw new RentalError(first.error);
  const age = dateOfBirth ? ageOn(dateOfBirth, first.quote.startsAt) : null;
  const q = age === null ? first : quoteRental(car, startsAt, endsAt, now, age);
  if (!q.ok) throw new RentalError(q.error);
  const held = await holdingBookings(car.id);
  const free = !held.some((b: any) => rentalsOverlap(b, q.quote));
  return { car: publicCar(car), quote: q.quote, available: free, ageKnown: age !== null };
}

/** A renter asks for a car. Nothing is charged; PG Ride confirms. */
export async function requestRental(renterId: string, body: any, now: Date = new Date()): Promise<RentalBooking> {
  const block = await riderBookingBlock(renterId);
  if (block) throw new RentalError(block, 403);
  if (stripeService.isEnabled && !(await renterCard(renterId))) throw new RentalError("Add a payment card in Profile first: the rental and the deposit go on your card at collection.");
  const renter = await saveRenterFacts(renterId, body);
  if (renter.recordStatus === "refused") throw new RentalError(`PG Ride cannot rent a car to you on your driving record${renter.recordNote ? `: ${renter.recordNote}` : "."} If your licence has changed, enter the new one.`, 403);
  const { car, quote, available } = await quoteFor(clean(body?.carId, 64), body?.startsAt, body?.endsAt, now, renter.dateOfBirth);
  const problems = renterProblems(renter, quote.startsAt, quote.endsAt);
  if (problems.length) throw new RentalError(problems.join(" "), 400, problems);
  if (!available) throw new RentalError("That car is already booked for some of those days. Try other dates.", 409);
  const [full] = await db.select().from(rentalCars).where(eq(rentalCars.id, car.id));
  const [booking] = await db.insert(rentalBookings).values({
    carId: car.id, renterId, startsAt: quote.startsAt, endsAt: quote.endsAt, days: quote.days,
    dailyPrice: quote.dailyPrice.toFixed(2), youngRenterFee: quote.youngRenterFee.toFixed(2), rentalTotal: quote.rentalTotal.toFixed(2), deposit: quote.deposit.toFixed(2),
    milesAllowed: quote.milesAllowed, extraMileFee: full.extraMileFee, lateHourFee: full.lateHourFee,
    status: "requested", licenceNumber: renter.licenceNumber, licenceImageUrl: renter.licenceImageUrl,
  }).returning();
  const recordReady = drivingRecordCurrent(renter, quote.startsAt);
  const young: Array<[string, string]> = quote.youngRenterFee > 0 ? [["Young-renter fee", money(quote.youngRenterFee)]] : [];
  opsAlert(formatOpsAlert("🔑 Car rental requested", [
    ["Car", `${car.year} ${car.make} ${car.model}`], ["From", quote.startsAt.toISOString()], ["Days", quote.days],
    ["Rental", money(quote.rentalTotal)], ...young, ["Deposit", money(quote.deposit)],
    ["Driving record", recordReady ? "cleared" : "NOT CHECKED: check it in Admin, Car rental, Renters before confirming"],
    ["Next", car.ownerKind === "private" ? "The owner accepts or declines in My cars" : "Confirm or decline in Admin, Car rental"],
  ]));
  return booking;
}

export async function listRenterBookings(renterId: string) {
  const rows = await db.select({ b: rentalBookings, c: rentalCars }).from(rentalBookings)
    .innerJoin(rentalCars, eq(rentalCars.id, rentalBookings.carId))
    .where(eq(rentalBookings.renterId, renterId)).orderBy(desc(rentalBookings.createdAt));
  return rows.map(({ b, c }) => ({ ...renterView(b), car: publicCar(c) }));
}

/** A booking as its renter sees it: no payment ids. */
export function renterView(b: RentalBooking) {
  const { chargeIntentId, depositIntentId, beyondDepositIntentId, ...rest } = b;
  return rest;
}

export async function listAllBookings() {
  const rows = await db.select({ b: rentalBookings, c: rentalCars }).from(rentalBookings)
    .innerJoin(rentalCars, eq(rentalCars.id, rentalBookings.carId)).orderBy(desc(rentalBookings.createdAt)).limit(200);
  return rows.map(({ b, c }) => ({ ...b, car: { id: c.id, make: c.make, model: c.model, year: c.year, licensePlate: c.licensePlate } }));
}

/**
 * Confirm: the car is now held for those days. Checked and written in one
 * transaction with the car's row locked, so two admins confirming
 * overlapping requests at once cannot both win.
 */
export async function confirmRental(bookingId: string): Promise<RentalBooking> {
  return db.transaction(async (tx) => {
    const [b] = await tx.select().from(rentalBookings).where(eq(rentalBookings.id, bookingId)).for("update");
    if (!b) throw new RentalError("Booking not found.", 404);
    if (b.status !== "requested") throw new RentalError(`This booking is ${b.status}; only a request can be confirmed.`, 409);
    // No rental is confirmed without a current driving-record clearance (industry practice, 2026-09-28).
    const [renter] = await tx.select().from(rentalRenters).where(eq(rentalRenters.userId, b.renterId));
    if (!drivingRecordCurrent(renter, b.startsAt)) {
      throw new RentalError(renter?.recordStatus === "refused"
        ? "This renter's driving record did not clear. Decline the request."
        : "PG Ride has not cleared this renter's driving record yet. It is checked in Admin, Car rental, Renters; confirm once it is cleared.", 409);
    }
    const [car] = await tx.select().from(rentalCars).where(eq(rentalCars.id, b.carId)).for("update");
    // A car whose papers lapsed since the request is not promised to anyone (code review 2026-10-06).
    const gaps = car ? qualificationProblems(car, new Date()) : ["The car is gone."];
    if (gaps.length) throw new RentalError(`This car does not qualify to go out: ${gaps.join(" ")}`, 409, gaps);
    const held = await holdingBookings(b.carId, tx);
    if (held.some((h: any) => h.id !== b.id && rentalsOverlap(h, b))) throw new RentalError("The car is already confirmed for some of those days. Decline this request.", 409);
    const [updated] = await tx.update(rentalBookings).set({ status: "confirmed", updatedAt: new Date() }).where(eq(rentalBookings.id, bookingId)).returning();
    return updated;
  });
}

/**
 * Decline a request. The desk (`opts.confirmed`) may also call off a
 * CONFIRMED rental before collection — a car whose papers lapsed, a renter
 * whose record did not clear — and anything a failed hand-over charged is
 * given back (code review 2026-10-06). An owner declines requests only.
 */
export async function declineRental(bookingId: string, reason: unknown, opts: { confirmed?: boolean } = {}): Promise<RentalBooking> {
  const may = opts.confirmed ? ["requested", "confirmed"] : ["requested"];
  const [updated] = await db.update(rentalBookings).set({ status: "declined", cancelReason: clean(reason, 200) || "Not available", updatedAt: new Date() })
    .where(and(eq(rentalBookings.id, bookingId), inArray(rentalBookings.status, may))).returning();
  if (!updated) throw new RentalError(opts.confirmed ? "Only a request or a confirmed rental not yet collected can be declined." : "Only a request can be declined.", 409);
  if (updated.chargeIntentId || updated.depositIntentId) await undoCollectionMoney(updated.id, updated.chargeIntentId, updated.depositIntentId);
  return updated;
}

/**
 * The renter cancels before collection: free. A collection that charged the
 * rental but could not hold the deposit left a charge on the booking; it is
 * refunded here, and a refund that fails pages ops.
 */
export async function cancelRental(bookingId: string, renterId: string, reason: unknown): Promise<RentalBooking> {
  const b = await load(bookingId);
  if (b.renterId !== renterId) throw new RentalError("Booking not found.", 404);
  if (!(RENTER_MAY_CANCEL as readonly string[]).includes(b.status)) throw new RentalError("This rental can no longer be cancelled here. Call PG Ride.", 409);
  const [updated] = await db.update(rentalBookings).set({ status: "cancelled", cancelReason: clean(reason, 200) || "Cancelled by the renter", updatedAt: new Date() })
    .where(and(eq(rentalBookings.id, bookingId), inArray(rentalBookings.status, [...RENTER_MAY_CANCEL]))).returning();
  if (!updated) throw new RentalError("This rental changed just now. Refresh and try again.", 409);
  if (updated.chargeIntentId || updated.depositIntentId) {
    try {
      // A deposit held by a hand-over that could not finish is let go too (code review 2026-10-06).
      if (updated.depositIntentId) await stripeService.cancelPaymentIntent(updated.depositIntentId);
      if (updated.chargeIntentId) await stripeService.refundPaymentIntent(updated.chargeIntentId, "rental cancelled before collection");
      await db.update(rentalBookings).set({ paymentStatus: "refunded", paymentError: null }).where(eq(rentalBookings.id, bookingId));
    } catch (err) {
      await db.update(rentalBookings).set({ paymentStatus: "failed", paymentError: `Refund failed: ${errText(err)}` }).where(eq(rentalBookings.id, bookingId));
      opsAlert(formatOpsAlert("💳 Rental refund FAILED", [["Booking", bookingId.slice(0, 8)], ["Amount", money(b.rentalTotal)], ["Reason", errText(err)], ["Next", "Refund it by hand in Stripe"]]));
    }
  }
  return updated;
}

/** Why this car cannot leave the lot for this booking right now, or null. Read inside the caller's transaction when it holds the car's lock. */
async function carIsOutFor(b: RentalBooking, executor: any = db): Promise<string | null> {
  // The car is only one car: a rental that came back late on paper is still
  // out in fact until it is taken back.
  const [stillOut] = await executor.select({ id: rentalBookings.id }).from(rentalBookings)
    .where(and(eq(rentalBookings.carId, b.carId), eq(rentalBookings.status, "collected"))).limit(1);
  if (stillOut && stillOut.id !== b.id) return "This car is still out on the previous rental. Take it back first.";
  const [withDriver] = await executor.select({ id: driverCarAssignments.id }).from(driverCarAssignments)
    .where(and(eq(driverCarAssignments.carId, b.carId), eq(driverCarAssignments.status, "active"))).limit(1);
  if (withDriver) return "This car is still with a PG Ride driver. Take it back from them first.";
  const [engine] = await executor.select({ off: rentalCars.engineCutOffAt, on: rentalCars.engineRestoredAt }).from(rentalCars).where(eq(rentalCars.id, b.carId));
  if (engine?.off && !engine?.on) return "This car's engine is recorded as cut off. Restore it before handing it over.";
  return null;
}

/** The attempt number Stripe's key carries for one purpose on a booking (code review 2026-10-06). */
const attemptOf = (b: RentalBooking, purpose: string): number => Number((b.paymentAttempts as Record<string, number> | null)?.[purpose] ?? 1) || 1;

/** After a recorded decline, the next try is a new attempt with a new key. Conditional, so two failures bump it once. */
async function nextAttempt(b: RentalBooking, purpose: string): Promise<void> {
  const n = attemptOf(b, purpose);
  await db.update(rentalBookings).set({ paymentAttempts: sql`jsonb_set(COALESCE(${rentalBookings.paymentAttempts}, '{}'::jsonb), ${`{${purpose}}`}::text[], to_jsonb(${n + 1}::int))` })
    .where(and(eq(rentalBookings.id, b.id), sql`COALESCE((${rentalBookings.paymentAttempts}->>${purpose})::int, 1) = ${n}`));
}

/**
 * One rental charge or hold under the booking's current attempt: a retry
 * after a decline asks Stripe first and adopts what went through; a decline
 * moves the booking to its next attempt; a lost answer does not, so the next
 * try replays it under the same key and cannot charge twice (code review 2026-10-06).
 */
async function rentalPayment(b: RentalBooking, purpose: "rental" | "deposit" | "extras", card: { customerId: string; paymentMethodId: string }, amount: number): Promise<string> {
  const attempt = attemptOf(b, purpose);
  const wanted = purpose === "deposit" ? "requires_capture" : "succeeded";
  if (attempt > 1) {
    const found = await stripeService.findRentalCharge(card.customerId, b.id, purpose);
    if (found?.status === wanted) return found.id;
  }
  let pi;
  try {
    pi = purpose === "deposit"
      ? await stripeService.holdRentalDeposit({ amount, ...card, bookingId: b.id, renterId: b.renterId, attempt })
      : await stripeService.chargeRental({ amount, ...card, bookingId: b.id, renterId: b.renterId, purpose, attempt });
  } catch (err) {
    if (stripeSaidNo(err)) await nextAttempt(b, purpose);
    throw err;
  }
  if (pi.status !== wanted) {
    await nextAttempt(b, purpose);
    throw new Error(`the card answered ${pi.status}`);
  }
  return pi.id;
}

/**
 * Hand the car over. The rental is charged and the deposit held first; if
 * either fails the car stays confirmed and does not leave the lot.
 */
export async function collectRental(bookingId: string, actorId: string, body: any, now: Date = new Date()): Promise<RentalBooking> {
  const b = await load(bookingId);
  if (b.status !== "confirmed") throw new RentalError(`This booking is ${b.status}; only a confirmed rental can be collected.`, 409);
  const odometer = Number(body?.odometer);
  if (!Number.isInteger(odometer) || odometer < 0 || odometer > 2_000_000) throw new RentalError("Enter the odometer reading at collection.");
  const photos = await verifiedPhotoList(body?.photos, actorId, "collection photo");
  if (photos.length < 4) throw new RentalError("Take at least 4 photos of the car at collection: front, back and both sides.");
  // A car whose papers lapsed after it was confirmed does not leave the lot,
  // and nor does a renter whose driving record is no longer cleared (code review 2026-10-06).
  const [carNow] = await db.select().from(rentalCars).where(eq(rentalCars.id, b.carId));
  const gaps = carNow ? qualificationProblems(carNow, now) : ["The car is gone."];
  if (gaps.length) throw new RentalError(`This car does not qualify to go out: ${gaps.join(" ")} Fix it, or decline the rental.`, 409, gaps);
  const [renter] = await db.select().from(rentalRenters).where(eq(rentalRenters.userId, b.renterId));
  if (!drivingRecordCurrent(renter, now)) {
    throw new RentalError(renter?.recordStatus === "refused"
      ? "This renter's driving record did not clear. The car cannot be handed over; decline the rental."
      : "This renter's driving record is not currently cleared by PG Ride. Check it in Admin, Car rental, Renters before handing the car over.", 409);
  }
  const out = await carIsOutFor(b);
  if (out) throw new RentalError(out, 409);
  if (!stripeService.isEnabled) throw new RentalError("Card payments are not set up on this deployment, so the deposit cannot be held. The car cannot be handed over.", 503);
  const card = await renterCard(b.renterId);
  if (!card) throw new RentalError("The renter has no card on file. They add one in Profile, then try again.", 409);

  let chargeIntentId = b.chargeIntentId;
  try {
    if (!chargeIntentId) {
      chargeIntentId = await rentalPayment(b, "rental", card, Number(b.rentalTotal));
      await db.update(rentalBookings).set({ chargeIntentId, paymentStatus: "charged", paymentError: null }).where(eq(rentalBookings.id, b.id));
    }
  } catch (err) {
    await db.update(rentalBookings).set({ paymentError: `Rental charge declined: ${errText(err)}` }).where(eq(rentalBookings.id, b.id));
    opsAlert(formatOpsAlert("💳 Rental charge declined at collection", [["Booking", b.id.slice(0, 8)], ["Amount", money(b.rentalTotal)], ["Reason", errText(err)], ["Effect", "Car not handed over"]]));
    throw new RentalError(`The rental could not be charged to the renter's card (${errText(err)}). The car stays here.`, 402);
  }

  let depositIntentId = b.depositIntentId;
  if (Number(b.deposit) > 0 && !depositIntentId) {
    try {
      depositIntentId = await rentalPayment(b, "deposit", card, Number(b.deposit));
      // Recorded at once, so a hand-over that cannot finish keeps it and a cancel releases it.
      await db.update(rentalBookings).set({ depositIntentId }).where(eq(rentalBookings.id, b.id));
    } catch (err) {
      await db.update(rentalBookings).set({ paymentError: `Deposit hold declined: ${errText(err)}` }).where(eq(rentalBookings.id, b.id));
      opsAlert(formatOpsAlert("💳 Rental deposit hold declined", [["Booking", b.id.slice(0, 8)], ["Deposit", money(b.deposit)], ["Reason", errText(err)], ["Effect", "Rental charged, car not handed over. The renter can retry with another card, or cancel for a refund"]]));
      throw new RentalError(`The rental was charged but the deposit could not be held (${errText(err)}). The car stays here; try again, or the renter can cancel for a full refund.`, 402);
    }
  }

  // The car row is locked while "is it out?" is asked again and the
  // hand-over written, as confirmRental does, so two desks handing over two
  // rentals of one car cannot both win (code review 2026-10-06).
  const result = await db.transaction(async (tx) => {
    const [cur] = await tx.select().from(rentalBookings).where(eq(rentalBookings.id, b.id)).for("update");
    await tx.select({ id: rentalCars.id }).from(rentalCars).where(eq(rentalCars.id, b.carId)).for("update");
    if (cur.status !== "confirmed") return { kind: "changed" as const, row: cur };
    const busy = await carIsOutFor(b, tx);
    if (busy) return { kind: "busy" as const, row: cur, why: busy };
    const [updated] = await tx.update(rentalBookings).set({
      status: "collected", collectedAt: now, collectOdometer: odometer, collectPhotos: photos,
      depositIntentId, paymentStatus: "charged", paymentError: null, updatedAt: now,
    }).where(eq(rentalBookings.id, b.id)).returning();
    return { kind: "done" as const, row: updated };
  });
  if (result.kind === "done") return result.row;
  if (result.kind === "busy") {
    throw new RentalError(`${result.why} The rental is charged and the deposit held on this booking; hand it over once the car is back, or decline it to give them back.`, 409);
  }
  const now2 = result.row;
  // A second hand-over of the same booking (a double press, two desks, a
  // retried request) got there first: it charged the same card under the
  // same keys, so these are the same payments. Nothing to undo.
  if (now2.status === "collected") return now2;
  // The renter cancelled while the desk was charging: nothing charged here
  // may stay charged. Give the rental back and let the deposit go.
  if (now2.status === "cancelled" || now2.status === "declined") {
    await undoCollectionMoney(b.id, chargeIntentId, depositIntentId);
    throw new RentalError("The renter cancelled this rental while it was being handed over. The charge and the deposit were given back.", 409);
  }
  throw new RentalError(`This booking is now ${now2.status}. Refresh and check it before doing anything else.`, 409);
}

async function undoCollectionMoney(bookingId: string, chargeIntentId: string | null, depositIntentId: string | null): Promise<void> {
  try {
    if (depositIntentId) await stripeService.cancelPaymentIntent(depositIntentId);
    if (chargeIntentId) await stripeService.refundPaymentIntent(chargeIntentId, "rental cancelled during hand-over");
    await db.update(rentalBookings).set({ paymentStatus: "refunded", paymentError: null }).where(eq(rentalBookings.id, bookingId));
  } catch (err) {
    await db.update(rentalBookings).set({ paymentStatus: "failed", paymentError: `Refund after a cancelled hand-over failed: ${errText(err)}` }).where(eq(rentalBookings.id, bookingId));
    opsAlert(formatOpsAlert("💳 Rental refund FAILED", [["Booking", bookingId.slice(0, 8)], ["Reason", errText(err)], ["Next", "Refund the rental and release the deposit by hand in Stripe"]]));
  }
}

/**
 * Take the car back. The return is recorded whatever the card does next;
 * the settlement follows, and a settlement that fails is paged and retried
 * by hand, never lost.
 */
export async function returnRental(bookingId: string, actorId: string, body: any, now: Date = new Date()): Promise<RentalBooking> {
  const b = await load(bookingId);
  if (b.status !== "collected") throw new RentalError(`This booking is ${b.status}; only a car on the road can be returned.`, 409);
  const odometer = Number(body?.odometer);
  if (!Number.isInteger(odometer)) throw new RentalError("Enter the odometer reading at return.");
  const photos = await verifiedPhotoList(body?.photos, actorId, "return photo");
  if (photos.length < 4) throw new RentalError("Take at least 4 photos of the car at return: front, back and both sides.");
  const s = settleReturn({
    milesAllowed: b.milesAllowed, collectOdometer: b.collectOdometer ?? NaN, returnOdometer: odometer,
    extraMileFee: b.extraMileFee, endsAt: b.endsAt, returnedAt: now, lateHourFee: b.lateHourFee,
    damageAmount: body?.damageAmount, deposit: b.deposit,
  });
  if (!s.ok) throw new RentalError(s.error);
  if (s.settlement.damage > 0 && !clean(body?.damageNote, 500)) throw new RentalError("Say what the damage is: the renter is shown it.");
  const [updated] = await db.update(rentalBookings).set({
    status: "returned", returnedAt: now, returnOdometer: odometer, returnPhotos: photos,
    settlement: s.settlement as any, damageNote: clean(body?.damageNote, 500) || null, updatedAt: now,
  }).where(and(eq(rentalBookings.id, b.id), eq(rentalBookings.status, "collected"))).returning();
  if (!updated) throw new RentalError("This booking changed just now. Refresh and try again.", 409);
  return settleRental(b.id);
}

/**
 * Settle a returned rental's money: take from the deposit what is owed and
 * release the rest; charge what is owed beyond it. Safe to repeat: each step
 * checks what Stripe already did before doing it.
 */
export async function settleRental(bookingId: string): Promise<RentalBooking> {
  const b = await load(bookingId);
  if (b.status !== "returned") throw new RentalError(`This booking is ${b.status}; only a returned rental is settled.`, 409);
  const s = (b.settlement ?? {}) as Record<string, number>;
  const fromDeposit = Number(s.fromDeposit ?? 0);
  let beyond = Number(s.beyondDeposit ?? 0);
  try {
    if (b.depositIntentId) {
      const pi = await stripeService.getPaymentIntent(b.depositIntentId);
      if (pi.status === "requires_capture") {
        if (fromDeposit > 0) await stripeService.capturePaymentIntent(b.depositIntentId, fromDeposit);
        else await stripeService.cancelPaymentIntent(b.depositIntentId);
      } else if (pi.status === "canceled" && fromDeposit > 0) {
        // The hold ran out before the return: what it was to cover is charged instead.
        beyond += fromDeposit;
      }
    } else if (fromDeposit > 0) {
      beyond += fromDeposit;
    }
    if (beyond > 0 && !b.beyondDepositIntentId) {
      const card = await renterCard(b.renterId);
      if (!card) throw new Error("the renter has no card on file");
      const intentId = await rentalPayment(b, "extras", card, beyond);
      await db.update(rentalBookings).set({ beyondDepositIntentId: intentId }).where(eq(rentalBookings.id, b.id));
    }
  } catch (err) {
    // Only a booking still waiting to settle is marked failed: a second
    // settlement that already closed it is never overwritten (code review 2026-10-06).
    const [failed] = await db.update(rentalBookings).set({ paymentStatus: "failed", paymentError: `Settlement failed: ${errText(err)}`, updatedAt: new Date() })
      .where(and(eq(rentalBookings.id, b.id), eq(rentalBookings.status, "returned"))).returning();
    if (!failed) return load(b.id);
    opsAlert(formatOpsAlert("💳 Rental settlement FAILED", [["Booking", b.id.slice(0, 8)], ["From deposit", money(fromDeposit)], ["Beyond deposit", money(s.beyondDeposit ?? 0)], ["Reason", errText(err)], ["Next", "Retry from Admin, Car rental; the car is back"]]));
    return failed;
  }
  const [closed] = await db.update(rentalBookings).set({ status: "closed", paymentStatus: "settled", paymentError: null, updatedAt: new Date() })
    .where(and(eq(rentalBookings.id, b.id), eq(rentalBookings.status, "returned"))).returning();
  // A private owner's car: their 90% of what the rental collected, once.
  if (closed) await import("./owners").then((m) => m.creditOwnerForClosedRental(closed.id)).catch((err) => console.error("owner credit failed:", err));
  return load(b.id);
}
