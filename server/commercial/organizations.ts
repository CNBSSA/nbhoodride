/**
 * Organizations and their members — the account side of commercial riders.
 *
 * An organization is the customer: it books for other people and is billed.
 * A member is a PG Ride user attached to it with a role (owner, requester,
 * billing; rules in shared/commercial.ts). Every query here takes the
 * organization id explicitly; nothing reads across organizations.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { commercialJobs, organizationMembers, organizations, users, type Organization } from "@shared/schema";
import { DEFAULT_FACILITY_FEE, isCategory, isOrgRole, type CommercialCategory, type OrgRole } from "@shared/commercial";
import { orgTerms, sanitizeTermsPatch } from "@shared/commercialTerms";

export class CommercialError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export interface OrganizationInput {
  name: string;
  category: CommercialCategory;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  address?: { lat?: number; lng?: number; address?: string } | null;
  notes?: string | null;
  /** Defaults to the category's fee (medical $4). */
  facilityFee?: number | null;
}

const clean = (v: unknown, max = 200): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, max) : null;
};

export async function createOrganization(input: OrganizationInput): Promise<Organization> {
  const name = clean(input.name, 120);
  if (!name) throw new CommercialError("The organization needs a name.");
  if (!isCategory(input.category)) throw new CommercialError("Category must be medical, business or food.");
  const fee = input.facilityFee === null || input.facilityFee === undefined ? DEFAULT_FACILITY_FEE[input.category] : Number(input.facilityFee);
  if (!Number.isFinite(fee) || fee < 0 || fee > 100) throw new CommercialError("Facility fee must be between $0 and $100.");
  const [row] = await db.insert(organizations).values({
    name,
    category: input.category,
    facilityFee: fee.toFixed(2),
    contactName: clean(input.contactName, 120),
    contactEmail: clean(input.contactEmail, 200)?.toLowerCase() ?? null,
    contactPhone: clean(input.contactPhone, 40),
    address: input.address ?? null,
    notes: clean(input.notes, 2000),
  }).returning();
  return row;
}

export interface OrganizationSummary extends Organization {
  memberCount: number;
  jobCount: number;
}

export async function listOrganizations(): Promise<OrganizationSummary[]> {
  const rows = await db.execute(sql`
    SELECT o.*,
      (SELECT count(*)::int FROM organization_members m WHERE m.organization_id = o.id) AS member_count,
      (SELECT count(*)::int FROM commercial_jobs j WHERE j.organization_id = o.id) AS job_count
    FROM organizations o
    ORDER BY o.created_at DESC
  `);
  return (rows.rows as any[]).map((r) => ({
    id: r.id, name: r.name, category: r.category, status: r.status, billingMode: r.billing_mode,
    facilityFee: r.facility_fee, contactName: r.contact_name, contactEmail: r.contact_email, contactPhone: r.contact_phone,
    address: r.address, notes: r.notes, stripeCustomerId: r.stripe_customer_id, terms: r.terms,
    defaultPaymentMethodId: r.default_payment_method_id, defaultPaymentMethodKind: r.default_payment_method_kind,
    createdAt: r.created_at, updatedAt: r.updated_at,
    memberCount: Number(r.member_count ?? 0), jobCount: Number(r.job_count ?? 0),
  }));
}

export async function getOrganization(id: string): Promise<Organization | undefined> {
  const [row] = await db.select().from(organizations).where(eq(organizations.id, id));
  return row;
}

export async function updateOrganization(id: string, patch: Partial<OrganizationInput> & { status?: string; billingMode?: string; terms?: unknown }): Promise<Organization> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) { const n = clean(patch.name, 120); if (!n) throw new CommercialError("The organization needs a name."); set.name = n; }
  if (patch.category !== undefined) { if (!isCategory(patch.category)) throw new CommercialError("Category must be medical, business or food."); set.category = patch.category; }
  if (patch.status !== undefined) { if (!["active", "paused"].includes(patch.status)) throw new CommercialError("Status must be active or paused."); set.status = patch.status; }
  if (patch.billingMode !== undefined) { if (!["weekly_debit", "net_terms"].includes(patch.billingMode)) throw new CommercialError("Billing must be weekly_debit or net_terms."); set.billingMode = patch.billingMode; }
  if (patch.facilityFee !== undefined && patch.facilityFee !== null) { const f = Number(patch.facilityFee); if (!Number.isFinite(f) || f < 0 || f > 100) throw new CommercialError("Facility fee must be between $0 and $100."); set.facilityFee = f.toFixed(2); }
  if (patch.contactName !== undefined) set.contactName = clean(patch.contactName, 120);
  if (patch.contactEmail !== undefined) set.contactEmail = clean(patch.contactEmail, 200)?.toLowerCase() ?? null;
  if (patch.contactPhone !== undefined) set.contactPhone = clean(patch.contactPhone, 40);
  if (patch.notes !== undefined) set.notes = clean(patch.notes, 2000);
  if (patch.address !== undefined) set.address = patch.address;
  if (patch.terms !== undefined) {
    // Only the known keys, clamped; the agreement's numbers, not free JSON.
    const current = await getOrganization(id);
    if (!current) throw new CommercialError("Organization not found.", 404);
    set.terms = { ...orgTerms(current.terms), ...sanitizeTermsPatch(patch.terms) };
  }
  const [row] = await db.update(organizations).set(set as any).where(eq(organizations.id, id)).returning();
  if (!row) throw new CommercialError("Organization not found.", 404);
  return row;
}

export interface MemberRow {
  userId: string;
  role: OrgRole;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  createdAt: Date;
}

export async function listMembers(organizationId: string): Promise<MemberRow[]> {
  const rows = await db
    .select({
      userId: organizationMembers.userId, role: organizationMembers.role, createdAt: organizationMembers.createdAt,
      firstName: users.firstName, lastName: users.lastName, email: users.email, phone: users.phone,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(eq(organizationMembers.organizationId, organizationId))
    .orderBy(desc(organizationMembers.createdAt));
  return rows.map((r) => ({ ...r, role: r.role as OrgRole }));
}

/** Attach an existing PG Ride user by email. Re-adding changes the role. */
export async function addMemberByEmail(organizationId: string, email: string, role: OrgRole): Promise<MemberRow> {
  if (!isOrgRole(role)) throw new CommercialError("Role must be owner, requester or billing.");
  const addr = clean(email, 200)?.toLowerCase();
  if (!addr) throw new CommercialError("An email is needed.");
  const [user] = await db.select().from(users).where(eq(users.email, addr));
  if (!user || user.deletedAt) throw new CommercialError("No PG Ride account has that email. They need to sign up first.", 404);
  await db.insert(organizationMembers)
    .values({ organizationId, userId: user.id, role })
    .onConflictDoUpdate({ target: [organizationMembers.organizationId, organizationMembers.userId], set: { role } });
  return { userId: user.id, role, firstName: user.firstName, lastName: user.lastName, email: user.email, phone: user.phone, createdAt: new Date() };
}

export async function removeMember(organizationId: string, userId: string): Promise<boolean> {
  const gone = await db.delete(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, userId)))
    .returning({ id: organizationMembers.id });
  return gone.length > 0;
}

/** The role a user holds in an organization, or null: the one check every member route makes. */
export async function membershipRole(userId: string, organizationId: string): Promise<OrgRole | null> {
  const [row] = await db.select({ role: organizationMembers.role }).from(organizationMembers)
    .where(and(eq(organizationMembers.userId, userId), eq(organizationMembers.organizationId, organizationId)));
  return row && isOrgRole(row.role) ? row.role : null;
}

export async function organizationsForUser(userId: string): Promise<Array<{ organization: Organization; role: OrgRole }>> {
  const rows = await db.select({ organization: organizations, role: organizationMembers.role })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(eq(organizationMembers.userId, userId))
    .orderBy(organizations.name);
  return rows.filter((r) => isOrgRole(r.role)).map((r) => ({ organization: r.organization, role: r.role as OrgRole }));
}

/** Someone who can book for the organization, for admin bookings made on its behalf. */
export async function firstBookingMember(organizationId: string): Promise<string | null> {
  const rows = await db.select({ userId: organizationMembers.userId, role: organizationMembers.role })
    .from(organizationMembers)
    .where(eq(organizationMembers.organizationId, organizationId))
    .orderBy(organizationMembers.createdAt);
  const owner = rows.find((r) => r.role === "owner") ?? rows.find((r) => r.role === "requester");
  return owner?.userId ?? null;
}

export async function jobCount(organizationId: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(commercialJobs).where(eq(commercialJobs.organizationId, organizationId));
  return Number(row?.n ?? 0);
}
