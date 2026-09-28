/**
 * Fleet accounts (PG Ride Fleet Management Accounts Plan, slice 1).
 *
 * An investor applies from their PG Ride account with the business's details;
 * the application is a fleet organization in status "pending" with the
 * applicant as its owner. The owner puts a payout method on file (an account
 * in the business's name); PG Ride approves the application (it becomes
 * active) or sends it back with a note the owner sees, and the owner may
 * correct it and send it again. Rules in shared/fleet.ts.
 *
 * A fleet never books and is never billed; nothing here touches jobs or
 * statements. Cars (slice 2), drivers (slice 3) and money (slice 4) follow.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { fleetCars, organizationMembers, organizations, users, type Organization } from "@shared/schema";
import {
  FLEET_CATEGORY, FLEET_PAYOUT_METHODS, FLEET_STATUS_WORDS, FLEET_TERMS_SENTENCE, approvalProblems, canManageFleetMoney,
  canSeeFleetDesk, checkFleetApplication, maskEin, type FleetStatus,
} from "@shared/fleet";
import type { OrgRole } from "@shared/commercial";
import { opsAlert, formatOpsAlert } from "../telegramOps";
import { CommercialError, listMembers, membershipRole } from "../commercial/organizations";

export class FleetError extends CommercialError {
  constructor(message: string, status = 400, public problems?: string[]) { super(message, status); }
}

const clean = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);

async function loadFleet(orgId: string): Promise<Organization> {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
  if (!org || org.category !== FLEET_CATEGORY) throw new FleetError("Fleet not found.", 404);
  return org;
}

/** The caller's role in a fleet, or a 403/404 that says why. */
export async function fleetRole(userId: string, orgId: string): Promise<{ org: Organization; role: OrgRole }> {
  const org = await loadFleet(orgId);
  const role = await membershipRole(userId, orgId);
  if (!role) throw new FleetError("You are not part of this fleet.", 403);
  return { org, role };
}

/** An investor applies. One open application or fleet per owner at a time is enough to start. */
export async function applyForFleet(userId: string, body: any): Promise<Organization> {
  const checked = checkFleetApplication(body);
  if (!checked.ok) throw new FleetError(checked.problems.join(" "), 400, checked.problems);
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user || user.deletedAt) throw new FleetError("Sign in again.", 401);
  const waiting = await db.select({ id: organizations.id }).from(organizations)
    .innerJoin(organizationMembers, eq(organizationMembers.organizationId, organizations.id))
    .where(and(eq(organizationMembers.userId, userId), eq(organizationMembers.role, "owner"), eq(organizations.category, FLEET_CATEGORY), eq(organizations.status, "pending")))
    .limit(1);
  if (waiting.length) throw new FleetError("You already have a fleet application waiting for PG Ride. It is on your fleet desk.", 409);
  const a = checked.value;
  const org = await db.transaction(async (tx) => {
    const [row] = await tx.insert(organizations).values({
      name: a.name, category: FLEET_CATEGORY, status: "pending", facilityFee: "0.00",
      contactName: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || null, contactEmail: user.email?.toLowerCase() ?? null, contactPhone: a.contactPhone,
      fleetDetails: { legalName: a.legalName, ein: a.ein, businessType: a.businessType },
    }).returning();
    await tx.insert(organizationMembers).values({ organizationId: row.id, userId, role: "owner" });
    return row;
  });
  opsAlert(formatOpsAlert("🚗 Fleet application", [
    ["Fleet", org.name], ["Business", `${a.legalName} (${a.businessType}), EIN ${maskEin(a.ein)}`],
    ["Owner", `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.email || userId], ["Phone", a.contactPhone],
    ["Next", "Check it in Admin, Organizations, and approve or send back"],
  ]));
  return org;
}

/** The owner corrects a sent-back application and sends it again. */
export async function resubmitFleet(userId: string, orgId: string, body: any): Promise<Organization> {
  const { org, role } = await fleetRole(userId, orgId);
  if (!canManageFleetMoney(role)) throw new FleetError("Only the fleet's owner can change the application.", 403);
  if (org.status !== "rejected" && org.status !== "pending") throw new FleetError("This fleet is already approved. Call PG Ride to change its business details.", 409);
  const checked = checkFleetApplication({ name: org.name, legalName: org.fleetDetails?.legalName, ein: org.fleetDetails?.ein, businessType: org.fleetDetails?.businessType, contactPhone: org.contactPhone, ...body });
  if (!checked.ok) throw new FleetError(checked.problems.join(" "), 400, checked.problems);
  const a = checked.value;
  const [row] = await db.update(organizations).set({
    name: a.name, contactPhone: a.contactPhone, fleetDetails: { legalName: a.legalName, ein: a.ein, businessType: a.businessType },
    status: "pending", reviewNote: null, updatedAt: new Date(),
  }).where(and(eq(organizations.id, orgId), inArray(organizations.status, ["pending", "rejected"]))).returning();
  if (!row) throw new FleetError("This fleet changed just now. Refresh and try again.", 409);
  if (org.status === "rejected") opsAlert(formatOpsAlert("🚗 Fleet application sent again", [["Fleet", row.name], ["Next", "Check it in Admin, Organizations"]]));
  return row;
}

/** Where the fleet is paid: the owner alone, allowed while the application waits. */
export async function saveFleetPayout(userId: string, orgId: string, body: any): Promise<Organization> {
  const { role } = await fleetRole(userId, orgId);
  if (!canManageFleetMoney(role)) throw new FleetError("Only the fleet's owner can say how the fleet is paid.", 403);
  const method = clean(body?.payoutMethod, 20).toLowerCase();
  const details = clean(body?.payoutDetails, 200);
  if (!(FLEET_PAYOUT_METHODS as readonly string[]).includes(method)) throw new FleetError(`Pay the fleet by: ${FLEET_PAYOUT_METHODS.join(", ")}.`);
  if (details.length < 3) throw new FleetError(method === "check" ? "Enter the business's mailing address for checks." : "Enter the business's account (email, phone or handle) to be paid to.");
  const [row] = await db.update(organizations).set({ payoutMethod: method, payoutDetails: details, updatedAt: new Date() }).where(eq(organizations.id, orgId)).returning();
  return row;
}

/** What the fleet desk shows. Money and the payout method only to the owner. */
export async function fleetDesk(userId: string, orgId: string) {
  const { org, role } = await fleetRole(userId, orgId);
  if (!canSeeFleetDesk(role)) throw new FleetError("The fleet desk is for the fleet's owner and managers. Your fleet car is in the driver app.", 403);
  const owner = canManageFleetMoney(role);
  const members = await listMembers(orgId);
  const [cars] = await db.select({ n: sql<number>`count(*)::int`, ready: sql<number>`count(*) filter (where ${fleetCars.status} = 'ready')::int` }).from(fleetCars).where(eq(fleetCars.organizationId, orgId));
  return {
    id: org.id, name: org.name, status: org.status as FleetStatus, statusText: FLEET_STATUS_WORDS[org.status as FleetStatus] ?? org.status,
    reviewNote: org.status === "rejected" ? org.reviewNote : null, role,
    business: { legalName: org.fleetDetails?.legalName ?? "", businessType: org.fleetDetails?.businessType ?? "", ein: maskEin(org.fleetDetails?.ein) },
    contactPhone: org.contactPhone,
    payout: owner ? { payoutMethod: org.payoutMethod, payoutDetails: org.payoutDetails } : { onFile: !!org.payoutMethod },
    counts: { cars: Number(cars?.n ?? 0), carsReady: Number(cars?.ready ?? 0), drivers: members.filter((m) => m.role === "driver").length },
    people: members.filter((m) => m.role !== "driver").map((m) => ({ userId: m.userId, role: m.role, name: `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() || m.email })),
    terms: FLEET_TERMS_SENTENCE,
  };
}

/** The fleets a user belongs to, for the desk and Profile. */
export async function myFleets(userId: string) {
  const rows = await db.select({ org: organizations, role: organizationMembers.role }).from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(and(eq(organizationMembers.userId, userId), eq(organizations.category, FLEET_CATEGORY)));
  return rows.map(({ org, role }) => ({ id: org.id, name: org.name, status: org.status, role }));
}

/** PG Ride's check of an application: approve, or send back with a note the owner sees. */
export async function reviewFleet(orgId: string, body: any): Promise<Organization> {
  const org = await loadFleet(orgId);
  const decision = body?.decision === "approve" ? "approve" : body?.decision === "reject" ? "reject" : null;
  if (!decision) throw new FleetError("Approve or send back.");
  if (decision === "approve") {
    const problems = approvalProblems(org);
    if (problems.length) throw new FleetError(problems.join(" "), 409, problems);
    const [row] = await db.update(organizations).set({ status: "active", reviewNote: null, updatedAt: new Date() })
      .where(and(eq(organizations.id, orgId), eq(organizations.status, "pending"))).returning();
    if (!row) throw new FleetError("This application changed just now. Refresh and check it again.", 409);
    console.log(`[fleet] approved :: ${row.name}`);
    return row;
  }
  const note = clean(body?.note, 400);
  if (!note) throw new FleetError("Say what is wrong so the owner can fix it.");
  if (org.status !== "pending") throw new FleetError(`This fleet is ${org.status}; only an application waiting for a check can be sent back.`, 409);
  const [row] = await db.update(organizations).set({ status: "rejected", reviewNote: note, updatedAt: new Date() })
    .where(and(eq(organizations.id, orgId), eq(organizations.status, "pending"))).returning();
  if (!row) throw new FleetError("This application changed just now. Refresh and check it again.", 409);
  return row;
}
