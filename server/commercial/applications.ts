/**
 * Self-serve organization applications (shared/orgApplication.ts).
 *
 * A person applies from their PG Ride account with the organization's
 * details; the application is an organization in status "pending" with the
 * applicant as its owner. PG Ride approves it (active) or sends it back with
 * a note the owner sees (rejected); the owner corrects it and sends it again.
 * Nothing about an approved account changes: the operator's own creation in
 * Admin → Organizations still makes an active account at once.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { organizationMembers, organizations, users, type Organization } from "@shared/schema";
import { DEFAULT_FACILITY_FEE, CATEGORY_LABELS, isCategory } from "@shared/commercial";
import { checkOrgApplication, maskEin, orgApprovalProblems } from "@shared/orgApplication";
import { opsAlert, formatOpsAlert } from "../telegramOps";
import { CommercialError, getOrganization, membershipRole } from "./organizations";

export class ApplicationError extends CommercialError {
  constructor(message: string, status = 400, public problems?: string[]) { super(message, status); }
}

const clean = (v: unknown, max = 400) => String(v ?? "").trim().slice(0, max);

/** A person applies for a booking account. One waiting application per owner at a time. */
export async function applyForOrganization(userId: string, body: any): Promise<Organization> {
  const checked = checkOrgApplication(body);
  if (!checked.ok) throw new ApplicationError(checked.problems.join(" "), 400, checked.problems);
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user || user.deletedAt) throw new ApplicationError("Sign in again.", 401);
  const waiting = await db.select({ id: organizations.id }).from(organizations)
    .innerJoin(organizationMembers, eq(organizationMembers.organizationId, organizations.id))
    .where(and(eq(organizationMembers.userId, userId), eq(organizationMembers.role, "owner"), eq(organizations.status, "pending"), inArray(organizations.category, ["medical", "business", "food"])))
    .limit(1);
  if (waiting.length) throw new ApplicationError("You already have an account application waiting for PG Ride. It is on your desk.", 409);
  const a = checked.value;
  const org = await db.transaction(async (tx) => {
    const [row] = await tx.insert(organizations).values({
      name: a.name, category: a.category, status: "pending", facilityFee: DEFAULT_FACILITY_FEE[a.category].toFixed(2),
      contactName: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || null, contactEmail: user.email?.toLowerCase() ?? null, contactPhone: a.contactPhone,
      address: a.address ? { address: a.address } : null,
      businessDetails: { legalName: a.legalName, ein: a.ein, businessType: a.businessType },
    }).returning();
    await tx.insert(organizationMembers).values({ organizationId: row.id, userId, role: "owner" });
    return row;
  });
  opsAlert(formatOpsAlert("🏢 Organization application", [
    ["Account", org.name], ["Kind", CATEGORY_LABELS[a.category]], ["Business", `${a.legalName} (${a.businessType}), EIN ${maskEin(a.ein)}`],
    ["Owner", `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.email || userId], ["Phone", a.contactPhone],
    ["Next", "Check it in Admin, Organizations, and approve or send back"],
  ]));
  return org;
}

/** The owner corrects a sent-back application and sends it again. */
export async function resubmitOrganization(userId: string, orgId: string, body: any): Promise<Organization> {
  const org = await getOrganization(orgId);
  if (!org || !isCategory(org.category)) throw new ApplicationError("Organization not found.", 404);
  const role = await membershipRole(userId, orgId);
  if (role !== "owner") throw new ApplicationError("Only the account's owner can change the application.", 403);
  if (org.status !== "rejected" && org.status !== "pending") throw new ApplicationError("This account is already approved. Call PG Ride to change its business details.", 409);
  const checked = checkOrgApplication({
    name: org.name, category: org.category, legalName: org.businessDetails?.legalName, ein: org.businessDetails?.ein,
    businessType: org.businessDetails?.businessType, contactPhone: org.contactPhone, address: org.address?.address, ...body,
  });
  if (!checked.ok) throw new ApplicationError(checked.problems.join(" "), 400, checked.problems);
  const a = checked.value;
  const [row] = await db.update(organizations).set({
    name: a.name, category: a.category, contactPhone: a.contactPhone, address: a.address ? { ...(org.address ?? {}), address: a.address } : org.address,
    businessDetails: { legalName: a.legalName, ein: a.ein, businessType: a.businessType },
    status: "pending", reviewNote: null, updatedAt: new Date(),
  }).where(and(eq(organizations.id, orgId), inArray(organizations.status, ["pending", "rejected"]))).returning();
  if (!row) throw new ApplicationError("This account changed just now. Refresh and try again.", 409);
  if (org.status === "rejected") opsAlert(formatOpsAlert("🏢 Organization application sent again", [["Account", row.name], ["Next", "Check it in Admin, Organizations"]]));
  return row;
}

/** What the desk shows of the application: the status, the note, and the business with its EIN masked. */
export function applicationView(org: Organization) {
  if (!org.businessDetails) return null;
  return {
    legalName: org.businessDetails.legalName, businessType: org.businessDetails.businessType, ein: maskEin(org.businessDetails.ein),
    reviewNote: org.status === "rejected" ? org.reviewNote : null,
  };
}

/** PG Ride's check: approve, or send back with a note the owner sees. */
export async function reviewOrganization(orgId: string, body: any): Promise<Organization> {
  const org = await getOrganization(orgId);
  if (!org || !isCategory(org.category)) throw new ApplicationError("Organization not found.", 404);
  const decision = body?.decision === "approve" ? "approve" : body?.decision === "reject" ? "reject" : null;
  if (!decision) throw new ApplicationError("Approve or send back.");
  if (decision === "approve") {
    const problems = orgApprovalProblems(org);
    if (problems.length) throw new ApplicationError(problems.join(" "), 409, problems);
    const [row] = await db.update(organizations).set({ status: "active", reviewNote: null, updatedAt: new Date() })
      .where(and(eq(organizations.id, orgId), eq(organizations.status, "pending"))).returning();
    if (!row) throw new ApplicationError("This application changed just now. Refresh and check it again.", 409);
    console.log(`[commercial] account approved :: ${row.name}`);
    return row;
  }
  const note = clean(body?.note);
  if (!note) throw new ApplicationError("Say what is wrong so the owner can fix it.");
  if (org.status !== "pending") throw new ApplicationError(`This account is ${org.status}; only an application waiting for a check can be sent back.`, 409);
  const [row] = await db.update(organizations).set({ status: "rejected", reviewNote: note, updatedAt: new Date() })
    .where(and(eq(organizations.id, orgId), eq(organizations.status, "pending"))).returning();
  if (!row) throw new ApplicationError("This application changed just now. Refresh and check it again.", 409);
  return row;
}
