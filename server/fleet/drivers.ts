/**
 * A fleet's drivers and who has which car (PG Ride Fleet Management Accounts
 * Plan, slice 3).
 *
 * The owner or a manager invites a driver by email through the ordinary
 * organization invitation (role "driver"); the invitee accepts from the link.
 * PG Ride alone approves a driver — as a person and as a driver — exactly as
 * any driver is approved: a fleet can never approve its own. A driver drives
 * for one fleet at a time (enforced where a membership is written:
 * server/commercial/organizations.ts and invitations.ts).
 *
 * The owner or a manager gives one of the fleet's ready cars to one of its
 * approved drivers — one car per driver (a unique index on
 * fleet_cars.driver_user_id) and one driver per car — and the car is copied
 * into the driver's vehicles (vehicles.fleet_car_id) so riders and dispatch
 * see it like an owned car; server/fleet/cars.ts keeps the copy true and
 * removes it the moment the car is parked. Taking the car back, or removing
 * the driver, is refused while the driver is on a ride. No money moves here:
 * the 25/75 split is slice 4. Rules in shared/fleet.ts.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { driverProfiles, fleetCars, organizationInvitations, organizationMembers, organizations, users } from "@shared/schema";
import { assignProblems, canManageFleet, canSeeFleetDesk, driverApprovalWords, fleetCarMayDrive } from "@shared/fleet";
import { INVITATION_DAYS, invitationState } from "@shared/invitations";
import { opsAlert, formatOpsAlert } from "../telegramOps";
import { sendOrganizationInviteEmail } from "../emailService";
import { storage } from "../storage";
import { CommercialError, removeMember } from "../commercial/organizations";
import { inviteByEmail } from "../commercial/invitations";
import { FleetError, fleetRole } from "./accounts";
import { carLabelOf, syncFleetCarVehicle } from "./cars";

const clean = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);
const nameOf = (u: { firstName: string | null; lastName: string | null } | undefined | null) => `${u?.firstName ?? ""} ${u?.lastName ?? ""}`.trim() || "A driver";

async function managerOf(userId: string, orgId: string, what: string) {
  const { org, role } = await fleetRole(userId, orgId);
  if (!canManageFleet(role)) throw new FleetError(`Only the fleet's owner or a manager can ${what}.`, 403);
  return org;
}

/**
 * The Drivers view: each driver's name, whether PG Ride has approved them
 * as a driver, and the car they have — never a rider's name, phone or
 * address, and not the driver's own contact details either — plus the
 * driver invitations still open.
 */
export async function listFleetDrivers(userId: string, orgId: string, now: Date = new Date()) {
  const { role } = await fleetRole(userId, orgId);
  if (!canSeeFleetDesk(role)) throw new FleetError("The fleet desk is for the fleet's owner and managers.", 403);
  const rows = await db.select({
    userId: organizationMembers.userId, joinedAt: organizationMembers.createdAt,
    firstName: users.firstName, lastName: users.lastName,
    approvalStatus: driverProfiles.approvalStatus, suspended: driverProfiles.isSuspended,
  }).from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .leftJoin(driverProfiles, eq(driverProfiles.userId, organizationMembers.userId))
    .where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.role, "driver")))
    .orderBy(desc(organizationMembers.createdAt));
  const cars = await db.select().from(fleetCars).where(eq(fleetCars.organizationId, orgId));
  const drivers = rows.map((r) => {
    const car = cars.find((c) => c.driverUserId === r.userId);
    const approved = r.approvalStatus === "approved" && !r.suspended;
    return {
      userId: r.userId, name: nameOf(r), joinedAt: r.joinedAt,
      approvedByPgRide: approved, approvalStatus: r.approvalStatus ?? null,
      approvalText: r.suspended ? "Suspended by PG Ride" : driverApprovalWords(r.approvalStatus),
      car: car ? { id: car.id, label: carLabelOf(car), status: car.status } : null,
    };
  });
  const invites = await db.select().from(organizationInvitations)
    .where(and(eq(organizationInvitations.organizationId, orgId), eq(organizationInvitations.role, "driver"), isNull(organizationInvitations.acceptedAt)))
    .orderBy(desc(organizationInvitations.createdAt));
  const invitations = invites.filter((i) => invitationState(i, now) === "open").map((i) => ({ id: i.id, email: i.email, expiresAt: i.expiresAt }));
  return { drivers, invitations };
}

/**
 * Invite a driver. Always by a link the person opens themselves — even when
 * they already hold a PG Ride account — because joining a fleet changes how
 * their earnings are shared (slice 4), so it is theirs to accept.
 */
export async function inviteFleetDriver(userId: string, orgId: string, body: any, appUrl: string) {
  const org = await managerOf(userId, orgId, "invite a driver");
  if (org.status !== "active") throw new FleetError("PG Ride has not approved this fleet yet. Drivers are invited once it is.", 409);
  const email = clean(body?.email, 200).toLowerCase();
  if (!email || !email.includes("@")) throw new FleetError("Enter the driver's email.");
  const [existing] = await db.select({ id: users.id }).from(users).where(and(eq(users.email, email), isNull(users.deletedAt)));
  if (existing) {
    const [member] = await db.select({ role: organizationMembers.role }).from(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.userId, existing.id)));
    if (member?.role === "driver") throw new FleetError("They already drive for this fleet.", 409);
    if (member) throw new FleetError(`They are already ${member.role} of this fleet.`, 409);
  }
  const inv = await inviteByEmail(orgId, email, "driver", userId, appUrl);
  let emailSent = false;
  try {
    const inviter = await storage.getUser(userId);
    await sendOrganizationInviteEmail({ email: inv.email, organizationName: inv.organizationName, inviterName: inviter?.firstName ?? null, link: inv.link, days: INVITATION_DAYS });
    emailSent = true;
  } catch (err) {
    console.error(`[fleet] driver invitation email to ${inv.email} not sent; the desk gets the link to send itself:`, (err as any)?.message ?? err);
  }
  console.log(`[fleet] driver invited :: ${org.name} :: ${inv.email}`);
  return { invited: true, id: inv.id, email: inv.email, expiresAt: inv.expiresAt, link: inv.link, emailSent };
}

/** Give one of the fleet's ready cars to one of its approved drivers. */
export async function assignFleetCarToDriver(userId: string, orgId: string, carId: string, body: any, now: Date = new Date()) {
  const org = await managerOf(userId, orgId, "give a car to a driver");
  const driverUserId = clean(body?.driverUserId, 64);
  if (!driverUserId) throw new FleetError("Choose the driver.");
  await db.transaction(async (tx) => {
    // The car row is locked, so two desks cannot give it to two drivers at once.
    const [car] = await tx.select().from(fleetCars).where(and(eq(fleetCars.id, carId), eq(fleetCars.organizationId, orgId))).for("update");
    if (!car) throw new FleetError("Car not found.", 404);
    const [member] = await tx.select({ role: organizationMembers.role }).from(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.userId, driverUserId)));
    const [profile] = await tx.select({ approvalStatus: driverProfiles.approvalStatus, isSuspended: driverProfiles.isSuspended }).from(driverProfiles).where(eq(driverProfiles.userId, driverUserId));
    const [other] = await tx.select({ id: fleetCars.id }).from(fleetCars).where(eq(fleetCars.driverUserId, driverUserId)).limit(1);
    const problems = assignProblems({
      car, fleetId: orgId, fleetStatus: org.status, driverRole: (member?.role as any) ?? null,
      driverApproval: profile?.approvalStatus ?? null, driverSuspended: profile?.isSuspended ?? false,
      driverHasCarId: other && other.id !== car.id ? other.id : null, now,
    });
    if (problems.length) throw new FleetError(problems.join(" "), 409, problems);
    const [done] = await tx.update(fleetCars).set({ driverUserId, updatedAt: now })
      .where(and(eq(fleetCars.id, carId), isNull(fleetCars.driverUserId), eq(fleetCars.status, "ready"))).returning({ id: fleetCars.id });
    if (!done) throw new FleetError("The car changed just now. Refresh and try again.", 409);
  }).catch((err: any) => {
    // The unique index on fleet_cars.driver_user_id: another desk gave them a car at the same moment.
    if (err?.code === "23505") throw new FleetError("They already have one of the fleet's cars. One car per driver: take that one back first.", 409);
    throw err;
  });
  await syncFleetCarVehicle(carId, now);
  const [car] = await db.select().from(fleetCars).where(eq(fleetCars.id, carId));
  const driver = await storage.getUser(driverUserId);
  console.log(`[fleet] car assigned :: ${org.name} :: ${carLabelOf(car)} :: driver ${driverUserId}`);
  opsAlert(formatOpsAlert("🚗 Fleet car given to a driver", [["Fleet", org.name], ["Car", carLabelOf(car)], ["Driver", nameOf(driver)]]));
  return { ...car, driverName: nameOf(driver) };
}

/** Take a car back from its driver. Refused while they are on a ride. */
export async function takeBackFleetCarFromDriver(userId: string, orgId: string, carId: string, now: Date = new Date()) {
  const org = await managerOf(userId, orgId, "take a car back");
  const [car] = await db.select().from(fleetCars).where(and(eq(fleetCars.id, carId), eq(fleetCars.organizationId, orgId)));
  if (!car) throw new FleetError("Car not found.", 404);
  if (!car.driverUserId) throw new FleetError("Nobody has this car.", 409);
  const driverUserId = car.driverUserId;
  const onRide = await storage.getActiveRidesForDriver(driverUserId).catch(() => [1]);
  if (onRide.length) throw new FleetError("The driver is on a ride. Take the car back when the ride ends.", 409);
  const [done] = await db.update(fleetCars).set({ driverUserId: null, updatedAt: now })
    .where(and(eq(fleetCars.id, carId), eq(fleetCars.driverUserId, driverUserId))).returning();
  if (!done) throw new FleetError("The car changed just now. Refresh and try again.", 409);
  await syncFleetCarVehicle(carId, now);
  const driver = await storage.getUser(driverUserId);
  console.log(`[fleet] car taken back :: ${org.name} :: ${carLabelOf(done)} :: driver ${driverUserId}`);
  opsAlert(formatOpsAlert("🚗 Fleet car taken back", [["Fleet", org.name], ["Car", carLabelOf(done)], ["From", nameOf(driver)]]));
  return { ...done, driverName: null };
}

/**
 * Remove a driver from the fleet: their car is taken back first (with the
 * same ride check). They keep their PG Ride account and driver approval.
 */
export async function removeFleetDriver(userId: string, orgId: string, driverUserId: string, now: Date = new Date()) {
  const org = await managerOf(userId, orgId, "remove a driver");
  const [member] = await db.select({ role: organizationMembers.role }).from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.userId, driverUserId)));
  if (!member) throw new FleetError("They are not part of this fleet.", 404);
  if (member.role !== "driver") throw new FleetError("Only drivers are removed here.", 409);
  const [car] = await db.select({ id: fleetCars.id }).from(fleetCars).where(and(eq(fleetCars.organizationId, orgId), eq(fleetCars.driverUserId, driverUserId)));
  if (car) await takeBackFleetCarFromDriver(userId, orgId, car.id, now);
  try {
    await removeMember(orgId, driverUserId);
  } catch (err) {
    if (err instanceof CommercialError) throw new FleetError(err.message, err.status);
    throw err;
  }
  console.log(`[fleet] driver removed :: ${org.name} :: ${driverUserId}`);
  return { removed: true };
}

/**
 * The go-online check for fleet cars (server/routes.ts toggle-status). Null
 * means go ahead. A driver whose only car is a fleet car drives it only
 * while it is ready; a driver with no car at all is told so.
 */
export async function fleetCarDriveBlock(driverUserId: string): Promise<string | null> {
  const profile = await storage.getDriverProfile(driverUserId);
  if (!profile) return null;
  const cars = await storage.getVehiclesByDriverId(profile.id);
  const [car] = await db.select().from(fleetCars).where(eq(fleetCars.driverUserId, driverUserId)).limit(1);
  const otherCars = cars.filter((v: any) => !v.fleetCarId).length;
  const hasFleetCopy = !!car && cars.some((v: any) => v.fleetCarId === car.id);
  const verdict = fleetCarMayDrive({ otherCars, fleetCar: car ? { label: carLabelOf(car), status: car.status, parkedReason: car.parkedReason } : null, hasFleetCopy });
  if (!verdict.ok) return verdict.reason;
  if (!cars.length && !car) {
    // Approved on a fleet's cars alone and none given (or taken back, or they left the fleet): nothing to drive.
    const ownPapers = !!profile.insuranceImageUrl || (Array.isArray((profile as any).vehiclePhotoUrls) && (profile as any).vehiclePhotoUrls.length > 0);
    if (!ownPapers) return "You have no car at the moment. Your fleet gives you one of its cars from its desk, or add your own car in Driver Documents.";
  }
  return null;
}

/** Is this person one of an open fleet's drivers? (The approval check lets an open fleet's cars stand in for their own.) */
export async function isFleetDriver(userId: string): Promise<boolean> {
  const [row] = await db.select({ id: organizationMembers.id }).from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(and(eq(organizationMembers.userId, userId), eq(organizationMembers.role, "driver"), eq(organizations.category, "fleet"), eq(organizations.status, "active")))
    .limit(1);
  return !!row;
}
