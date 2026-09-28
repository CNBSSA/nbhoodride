/**
 * The rental sweep, hourly from the minute sweep while RENTAL_ENABLED is on:
 *   - a listed car whose inspection, registration or insurance has lapsed
 *     (or that stops qualifying for any other reason) is hidden at once, and
 *     ops are told which car and why, including any confirmed rental on it;
 *   - once a day, 30 and 7 days before a document expires, ops are warned.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { rentalBookings, rentalCars } from "@shared/schema";
import { expiryWarnings, qualificationProblems } from "@shared/rental";
import { opsAlert, formatOpsAlert } from "../telegramOps";

export async function runRentalSweep(now: Date = new Date(), opts: { warnings?: boolean } = {}): Promise<{ hidden: number; warned: number }> {
  let hidden = 0, warned = 0;
  const listed = await db.select().from(rentalCars).where(eq(rentalCars.status, "listed"));
  for (const car of listed) {
    const problems = qualificationProblems(car, now);
    if (!problems.length) continue;
    const [done] = await db.update(rentalCars).set({ status: "hidden", hiddenReason: problems.join(" "), updatedAt: now })
      .where(and(eq(rentalCars.id, car.id), eq(rentalCars.status, "listed"))).returning({ id: rentalCars.id });
    if (!done) continue;
    hidden++;
    const upcoming = await db.select({ id: rentalBookings.id }).from(rentalBookings)
      .where(and(eq(rentalBookings.carId, car.id), inArray(rentalBookings.status, ["confirmed", "collected"])));
    console.log(`[rental] car hidden :: ${car.year} ${car.make} ${car.model} ${car.licensePlate} :: ${problems.join(" ")}`);
    opsAlert(formatOpsAlert("🔑 Rental car taken off the list", [
      ["Car", `${car.year} ${car.make} ${car.model} (${car.licensePlate})`], ["Why", problems.join(" ")],
      ["Rentals on it", upcoming.length ? `${upcoming.length} confirmed or on the road — check them` : "none"],
    ]));
  }
  if (opts.warnings) {
    // PG Ride's cars and private owners' alike: ops tell an owner in time.
    const all = await db.select().from(rentalCars);
    for (const car of all) {
      for (const w of expiryWarnings(car, now)) {
        warned++;
        opsAlert(formatOpsAlert("🔑 Rental car document expiring", [["Car", `${car.year} ${car.make} ${car.model} (${car.licensePlate})`], ["Whose", car.ownerKind === "private" ? "a private owner's — tell them" : "PG Ride's"], ["Document", w.document], ["Days left", w.daysLeft]]));
      }
    }
  }
  // Owners whose closed rental was not credited (a credit that failed) are paid now.
  await import("./owners").then((m) => m.creditOwedOwners()).catch((err) => console.error("owner credit catch-up failed:", err));
  return { hidden, warned };
}
