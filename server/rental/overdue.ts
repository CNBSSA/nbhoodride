/**
 * Overdue cars and the engine cut-off (Festus, 2026-09-27: "No grace for
 * late returns, we cut off the engine remotely").
 *
 * Every minute while RENTAL_ENABLED is on: a car out on a public rental past
 * its return time, or with a driver past the end of their weeks, pages ops
 * once — which car, its plate, who has it and their phone, how late — so
 * the engine can be cut off. The desk records the cut-off and the restore
 * on the car (Admin → Car rental). No tracker is connected yet
 * (`server/rental/tracker.ts`): until one is, the cut-off itself is made in
 * the tracker's own app and recorded here.
 */
import { and, eq, isNull, lt } from "drizzle-orm";
import { db } from "../db";
import { driverCarAssignments, rentalBookings, rentalCars } from "@shared/schema";
import { minutesOverdue } from "@shared/rental";
import { storage } from "../storage";
import { opsAlert, formatOpsAlert } from "../telegramOps";
import { RentalError } from "./cars";
import { cutEngine, restoreEngine, trackerName } from "./tracker";

async function who(userId: string) {
  const u = await storage.getUser(userId);
  return { name: `${u?.firstName ?? ""} ${u?.lastName ?? ""}`.trim() || userId, phone: u?.phone ?? "—" };
}

export async function runOverdueWatch(now: Date = new Date()): Promise<{ paged: number }> {
  let paged = 0;
  const rentals = await db.select({ b: rentalBookings, c: rentalCars }).from(rentalBookings)
    .innerJoin(rentalCars, eq(rentalCars.id, rentalBookings.carId))
    .where(and(eq(rentalBookings.status, "collected"), lt(rentalBookings.endsAt, now), isNull(rentalBookings.overduePagedAt)));
  for (const { b, c } of rentals) {
    const [stamped] = await db.update(rentalBookings).set({ overduePagedAt: now })
      .where(and(eq(rentalBookings.id, b.id), isNull(rentalBookings.overduePagedAt))).returning({ id: rentalBookings.id });
    if (!stamped) continue;
    const r = await who(b.renterId);
    paged++;
    opsAlert(formatOpsAlert("🚨 Rental car OVERDUE: cut off the engine", [
      ["Car", `${c.year} ${c.make} ${c.model} (${c.licensePlate})`], ["Whose", c.ownerKind === "private" ? "a private owner's" : "PG Ride's"],
      ["Renter", `${r.name} · ${r.phone}`], ["Was due", b.endsAt.toISOString()], ["Late by", `${minutesOverdue(b.endsAt, now)} min`],
      ["Next", `Cut off the engine${trackerName() ? "" : " in the tracker's app"}, then record it in Admin, Car rental`],
    ]));
  }
  const drivers = await db.select({ a: driverCarAssignments, c: rentalCars }).from(driverCarAssignments)
    .innerJoin(rentalCars, eq(rentalCars.id, driverCarAssignments.carId))
    .where(and(eq(driverCarAssignments.status, "active"), lt(driverCarAssignments.endsAt, now), isNull(driverCarAssignments.overduePagedAt)));
  for (const { a, c } of drivers) {
    const [stamped] = await db.update(driverCarAssignments).set({ overduePagedAt: now })
      .where(and(eq(driverCarAssignments.id, a.id), isNull(driverCarAssignments.overduePagedAt))).returning({ id: driverCarAssignments.id });
    if (!stamped) continue;
    const d = await who(a.driverUserId);
    paged++;
    opsAlert(formatOpsAlert("🚨 Driver's PG Ride car OVERDUE: cut off the engine", [
      ["Car", `${c.year} ${c.make} ${c.model} (${c.licensePlate})`], ["Driver", `${d.name} · ${d.phone}`],
      ["Weeks ended", a.endsAt.toISOString()], ["Late by", `${minutesOverdue(a.endsAt, now)} min`],
      ["Next", `Cut off the engine${trackerName() ? "" : " in the tracker's app"} once the car is stopped, then record it in Admin, Car rental`],
    ]));
  }
  return { paged };
}

/** The desk cuts off (or records cutting off) a car's engine. */
export async function recordEngineCutOff(carId: string, actorId: string, now: Date = new Date()) {
  const [car] = await db.select().from(rentalCars).where(eq(rentalCars.id, carId));
  if (!car) throw new RentalError("Car not found.", 404);
  if (car.engineCutOffAt && !car.engineRestoredAt) throw new RentalError("The engine is already recorded as cut off.", 409);
  const sent = await cutEngine(car);
  const [u] = await db.update(rentalCars).set({ engineCutOffAt: now, engineCutOffBy: actorId, engineRestoredAt: null, engineRestoredBy: null, updatedAt: now }).where(eq(rentalCars.id, carId)).returning();
  console.log(`[rental] engine cut off :: ${car.year} ${car.make} ${car.model} ${car.licensePlate} :: by ${actorId} :: ${sent.sent ? "sent to the tracker" : sent.reason}`);
  opsAlert(formatOpsAlert("🔒 Rental car engine cut off", [["Car", `${car.year} ${car.make} ${car.model} (${car.licensePlate})`], ["Tracker", sent.sent ? "command sent" : sent.reason]]));
  return { car: u, tracker: sent };
}

export async function recordEngineRestored(carId: string, actorId: string, now: Date = new Date()) {
  const [car] = await db.select().from(rentalCars).where(eq(rentalCars.id, carId));
  if (!car) throw new RentalError("Car not found.", 404);
  if (!car.engineCutOffAt || car.engineRestoredAt) throw new RentalError("The engine is not recorded as cut off.", 409);
  const sent = await restoreEngine(car);
  const [u] = await db.update(rentalCars).set({ engineRestoredAt: now, engineRestoredBy: actorId, updatedAt: now }).where(eq(rentalCars.id, carId)).returning();
  console.log(`[rental] engine restored :: ${car.licensePlate} :: by ${actorId} :: ${sent.sent ? "sent to the tracker" : sent.reason}`);
  return { car: u, tracker: sent };
}
