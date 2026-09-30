/**
 * A fleet's cars (PG Ride Fleet Management Accounts Plan, slice 2).
 *
 * The owner or a manager adds a car with its photos and papers; PG Ride
 * checks the papers and approves the car or sends it back with a note;
 * "ready" means checked and qualified (shared/fleet.ts fleetCarProblems), the
 * only state in which a car may carry riders — slice 3 gives it to one of the
 * fleet's drivers. Changing what the car IS sends it back to be checked. The
 * hourly sweep parks a ready car the hour a paper lapses and pages ops,
 * warning 30 and 7 days ahead once a day, exactly as for rental cars.
 *
 * Every photo and paper must be the uploader's own upload to PG Ride's own
 * store (server/rental/cars.ts verifiedStorePath), and is visible to the
 * fleet's desk and to admins, nobody else.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { fleetCars, organizationMembers, organizations, type FleetCar } from "@shared/schema";
import { FLEET_CAR_REVIEWED_FIELDS, canManageFleet, canSeeFleetDesk, fleetCarProblems } from "@shared/fleet";
import { expiryWarnings } from "@shared/rental";
import { VEHICLE_TYPES } from "@shared/vehicleTypes";
import { opsAlert, formatOpsAlert } from "../telegramOps";
import { verifiedStorePath } from "../rental/cars";
import { FleetError, fleetRole } from "./accounts";

const clean = (v: unknown, max = 80) => String(v ?? "").trim().slice(0, max);
const intOr = (v: unknown, fallback: number | null) => {
  if (v === undefined || v === null || v === "") return fallback;
  const n = Number(v);
  return Number.isInteger(n) ? n : NaN;
};
const dateOr = (v: unknown): Date | null | "bad" => {
  if (v === undefined || v === null || v === "") return null;
  const d = new Date(String(v));
  return Number.isFinite(d.getTime()) ? d : "bad";
};
const carLabel = (c: FleetCar) => `${c.year} ${c.make} ${c.model} (${c.licensePlate})`;

/** The fields a fleet may set on a car, validated; photos and papers checked against the acting user's uploads. */
async function carFields(body: any, actorId: string, existing?: FleetCar): Promise<Partial<typeof fleetCars.$inferInsert>> {
  const out: Partial<typeof fleetCars.$inferInsert> = {};
  const has = (k: string) => body && Object.prototype.hasOwnProperty.call(body, k);
  for (const k of ["make", "model", "color"] as const) {
    if (has(k)) { const v = clean(body[k], 40); if (!v) throw new FleetError(`${k[0].toUpperCase()}${k.slice(1)} is required.`); out[k] = v; }
  }
  if (has("licensePlate")) { const v = clean(body.licensePlate, 12).toUpperCase(); if (!/^[A-Z0-9\- ]{2,10}$/.test(v)) throw new FleetError("Licence plate must be 2 to 10 letters or digits."); out.licensePlate = v; }
  if (has("vin")) out.vin = clean(body.vin, 17).toUpperCase() || null;
  if (has("year")) { const v = intOr(body.year, null); const max = new Date().getUTCFullYear() + 1; if (!Number.isInteger(v) || (v as number) < 1990 || (v as number) > max) throw new FleetError(`Model year must be between 1990 and ${max}.`); out.year = v as number; }
  if (has("seats")) { const v = intOr(body.seats, null); if (!Number.isInteger(v) || (v as number) < 2 || (v as number) > 15) throw new FleetError("Seats must be a whole number."); out.seats = v as number; }
  if (has("vehicleType")) { const v = clean(body.vehicleType, 20); if (!(VEHICLE_TYPES as readonly string[]).includes(v)) throw new FleetError("Unknown vehicle class."); out.vehicleType = v; }
  for (const k of ["registrationDocUrl", "insuranceDocUrl", "inspectionDocUrl"] as const) {
    if (!has(k)) continue;
    const v = clean(body[k], 600);
    if (!v) { out[k] = null; continue; }
    // A paper already on the car is kept whoever uploaded it; a new one must be the acting user's own upload.
    out[k] = existing && existing[k] === v ? v : await verifiedStorePath(v, actorId, { allowPdf: true, what: "document" });
  }
  for (const k of ["inspectionExpires", "registrationExpires", "insuranceExpires"] as const) {
    if (has(k)) { const v = dateOr(body[k]); if (v === "bad") throw new FleetError("Expiry dates must be dates."); out[k] = v; }
  }
  if (has("photos")) {
    const kept = new Set(existing?.photos ?? []);
    const list = Array.isArray(body.photos) ? body.photos.slice(0, 12) : [];
    const photos: string[] = [];
    for (const p of list) {
      const s = clean(p, 600);
      if (kept.has(s)) { if (!photos.includes(s)) photos.push(s); continue; }
      const path = await verifiedStorePath(s, actorId, { what: "car photo" });
      if (!photos.includes(path)) photos.push(path);
    }
    out.photos = photos;
  }
  return out;
}

/** What the desk sees: the car, why it is not ready, and any warning ahead. */
function deskView(car: FleetCar, now: Date) {
  return { ...car, problems: fleetCarProblems(car, now), warnings: expiryWarnings(car, now) };
}

export async function listFleetCars(userId: string, orgId: string) {
  const { role } = await fleetRole(userId, orgId);
  if (!canSeeFleetDesk(role)) throw new FleetError("The fleet desk is for the fleet's owner and managers.", 403);
  const rows = await db.select().from(fleetCars).where(eq(fleetCars.organizationId, orgId)).orderBy(desc(fleetCars.createdAt));
  const now = new Date();
  return rows.map((c) => deskView(c, now));
}

/** The owner or a manager adds a car. It starts parked, waiting for PG Ride's check. */
export async function createFleetCar(userId: string, orgId: string, body: any): Promise<ReturnType<typeof deskView>> {
  const { org, role } = await fleetRole(userId, orgId);
  if (!canManageFleet(role)) throw new FleetError("Only the fleet's owner or a manager can add a car.", 403);
  if (org.status !== "active") throw new FleetError("PG Ride has not approved this fleet yet. Cars are added once it is.", 409);
  const required = ["make", "model", "year", "color", "licensePlate"];
  const missing = required.filter((k) => body?.[k] === undefined || body?.[k] === null || body?.[k] === "");
  if (missing.length) throw new FleetError(`Missing: ${missing.join(", ")}.`);
  const fields = await carFields(body, userId);
  const now = new Date();
  const [car] = await db.insert(fleetCars).values({
    organizationId: orgId, status: "parked", reviewStatus: "pending", createdBy: userId, ...(fields as any),
  }).returning();
  const problems = fleetCarProblems(car, now);
  const [stamped] = await db.update(fleetCars).set({ parkedReason: problems.join(" ") }).where(eq(fleetCars.id, car.id)).returning();
  opsAlert(formatOpsAlert("🚗 A fleet car to check", [
    ["Fleet", org.name], ["Car", carLabel(car)],
    ["Papers", [car.registrationDocUrl && "registration", car.insuranceDocUrl && "insurance", car.inspectionDocUrl && "inspection"].filter(Boolean).join(", ") || "none yet"],
    ["Next", "Check its papers in Admin, Organizations, and approve or send back"],
  ]));
  return deskView(stamped, now);
}

/**
 * Edit a car. Changing what the car IS sends it back to PG Ride to be
 * checked; a colour or photo change does not. A car with a driver cannot
 * change what it is under them (slice 3).
 */
export async function updateFleetCar(userId: string, orgId: string, carId: string, body: any, now: Date = new Date()): Promise<ReturnType<typeof deskView>> {
  const { org, role } = await fleetRole(userId, orgId);
  if (!canManageFleet(role)) throw new FleetError("Only the fleet's owner or a manager can change a car.", 403);
  const [car] = await db.select().from(fleetCars).where(and(eq(fleetCars.id, carId), eq(fleetCars.organizationId, orgId)));
  if (!car) throw new FleetError("Car not found.", 404);
  const fields = await carFields(body, userId, car);
  const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? ""));
  const changed = FLEET_CAR_REVIEWED_FIELDS.some((k) => k in fields && norm((fields as any)[k]) !== norm((car as any)[k]));
  if (changed) {
    if (car.driverUserId) throw new FleetError("The car is with a driver. Change what it is when it is back.", 409);
    fields.reviewStatus = "pending"; fields.reviewNote = null;
  }
  const next = { ...car, ...fields } as FleetCar;
  const problems = fleetCarProblems(next, now);
  const [updated] = await db.update(fleetCars).set({
    ...(fields as any), status: problems.length ? "parked" : "ready", parkedReason: problems.length ? problems.join(" ") : null, updatedAt: now,
  }).where(eq(fleetCars.id, carId)).returning();
  if (changed && car.reviewStatus === "approved") {
    opsAlert(formatOpsAlert("🚗 A fleet car changed: check it again", [["Fleet", org.name], ["Car", carLabel(updated)], ["Next", "Admin, Organizations"]]));
  }
  return deskView(updated, now);
}

export async function listFleetCarsForAdmin(orgId: string) {
  const rows = await db.select().from(fleetCars).where(eq(fleetCars.organizationId, orgId)).orderBy(desc(fleetCars.createdAt));
  const now = new Date();
  return rows.map((c) => deskView(c, now));
}

/** PG Ride's check of a car's papers: approve (the car is ready if everything else holds) or send back with a note the fleet sees. */
export async function reviewFleetCar(orgId: string, carId: string, body: any, now: Date = new Date()): Promise<ReturnType<typeof deskView>> {
  const decision = body?.decision === "approve" ? "approved" : body?.decision === "reject" ? "rejected" : null;
  if (!decision) throw new FleetError("Approve or send back.");
  const note = clean(body?.note, 300);
  if (decision === "rejected" && !note) throw new FleetError("Say what is wrong so the fleet can fix it.");
  const [car] = await db.select().from(fleetCars).where(and(eq(fleetCars.id, carId), eq(fleetCars.organizationId, orgId)));
  if (!car) throw new FleetError("Car not found.", 404);
  const next = { ...car, reviewStatus: decision } as FleetCar;
  const problems = fleetCarProblems(next, now);
  const [updated] = await db.update(fleetCars).set({
    reviewStatus: decision, reviewNote: note || null, status: problems.length ? "parked" : "ready", parkedReason: problems.length ? problems.join(" ") : null, updatedAt: now,
  }).where(eq(fleetCars.id, carId)).returning();
  console.log(`[fleet] car ${decision} :: ${carLabel(updated)} :: ${problems.length ? problems.join(" ") : "ready"}`);
  return deskView(updated, now);
}

/**
 * The hourly sweep: a ready car whose paper lapsed (or that stops qualifying
 * for any reason) is parked at once and ops are told which fleet and car;
 * once a day, 30 and 7 days before a paper expires, ops are warned so the
 * fleet is told in time. The desk shows the same warnings itself.
 */
export async function runFleetCarSweep(now: Date = new Date(), opts: { warnings?: boolean } = {}): Promise<{ parked: number; warned: number }> {
  let parked = 0, warned = 0;
  const ready = await db.select({ car: fleetCars, orgName: organizations.name }).from(fleetCars)
    .innerJoin(organizations, eq(organizations.id, fleetCars.organizationId)).where(eq(fleetCars.status, "ready"));
  for (const { car, orgName } of ready) {
    const problems = fleetCarProblems(car, now);
    if (!problems.length) continue;
    const [done] = await db.update(fleetCars).set({ status: "parked", parkedReason: problems.join(" "), updatedAt: now })
      .where(and(eq(fleetCars.id, car.id), eq(fleetCars.status, "ready"))).returning({ id: fleetCars.id });
    if (!done) continue;
    parked++;
    console.log(`[fleet] car parked :: ${orgName} :: ${carLabel(car)} :: ${problems.join(" ")}`);
    opsAlert(formatOpsAlert("🚗 Fleet car taken off the road", [
      ["Fleet", orgName], ["Car", carLabel(car)], ["Why", problems.join(" ")],
      ["Driver", car.driverUserId ? "a driver has this car — they cannot go online in it until it is put right" : "none"],
    ]));
  }
  if (opts.warnings) {
    const all = await db.select({ car: fleetCars, orgName: organizations.name }).from(fleetCars)
      .innerJoin(organizations, eq(organizations.id, fleetCars.organizationId));
    for (const { car, orgName } of all) {
      for (const w of expiryWarnings(car, now)) {
        warned++;
        opsAlert(formatOpsAlert("🚗 Fleet car document expiring", [["Fleet", orgName], ["Car", carLabel(car)], ["Document", w.document], ["Days left", w.daysLeft]]));
      }
    }
  }
  return { parked, warned };
}

/** May this signed-in user see this stored file because it is a fleet car's photo or paper? The fleet's desk only. */
export async function fleetPhotoVisibleTo(userId: string, objectId: string): Promise<boolean> {
  const path = `/api/objects/db-upload/${objectId}`;
  const [row] = await db.select({ id: fleetCars.id }).from(fleetCars)
    .innerJoin(organizationMembers, and(eq(organizationMembers.organizationId, fleetCars.organizationId), eq(organizationMembers.userId, userId)))
    .where(sql`(${fleetCars.photos} @> ${JSON.stringify([path])}::jsonb OR ${fleetCars.registrationDocUrl} = ${path} OR ${fleetCars.insuranceDocUrl} = ${path} OR ${fleetCars.inspectionDocUrl} = ${path})`)
    .limit(1);
  if (!row) return false;
  const [m] = await db.select({ role: organizationMembers.role }).from(organizationMembers)
    .innerJoin(fleetCars, eq(fleetCars.organizationId, organizationMembers.organizationId))
    .where(and(eq(organizationMembers.userId, userId), eq(fleetCars.id, row.id))).limit(1);
  return canSeeFleetDesk(m?.role as any);
}
