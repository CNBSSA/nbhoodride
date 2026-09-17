/**
 * Invitations — how a person without a PG Ride account joins an
 * organization (shared/invitations.ts has the rules and the words).
 *
 * The token in the link is random and only its hash is stored, so a copy of
 * the database cannot be used to join anything. Accepting creates the
 * account, attaches the membership and marks the invitation used, in one
 * transaction. An invited desk user is approved on acceptance: the
 * organization's owner vouched for them, and they are here to book for the
 * organization, not to ride.
 */
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { organizationInvitations, organizationMembers, organizations, users } from "@shared/schema";
import { isOrgRole, type OrgRole } from "@shared/commercial";
import { invitationExpiresAt, invitationRefusal, invitationState, INVITATION_DAYS, type InvitationState } from "@shared/invitations";
import { normalizePhone } from "@shared/smsMessages";
import { validatePasswordComplexity } from "../passwordPolicy";
import { CommercialError } from "./organizations";

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const clean = (v: unknown, max: number) => String((v as any) ?? "").trim().slice(0, max);

export interface InvitationSummary {
  id: string;
  email: string;
  role: OrgRole;
  expiresAt: Date;
  createdAt: Date;
  state: InvitationState;
}

export interface CreatedInvitation extends InvitationSummary {
  /** The link, made once; the token inside it is not stored. */
  link: string;
  organizationName: string;
}

/** Invite an email that holds no account. Re-inviting the same email issues a fresh link. */
export async function inviteByEmail(organizationId: string, email: string, role: OrgRole, invitedBy: string, appUrl: string, now: Date = new Date()): Promise<CreatedInvitation> {
  if (!isOrgRole(role)) throw new CommercialError("Role must be owner, requester or billing.");
  const addr = clean(email, 200).toLowerCase();
  if (!addr || !addr.includes("@")) throw new CommercialError("An email is needed.");
  const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId));
  if (!org) throw new CommercialError("Organization not found.", 404);
  const token = randomBytes(24).toString("hex");
  const expiresAt = invitationExpiresAt(now);
  const [row] = await db.insert(organizationInvitations)
    .values({ organizationId, email: addr, role, tokenHash: hashToken(token), invitedBy, expiresAt })
    .onConflictDoUpdate({
      target: [organizationInvitations.organizationId, organizationInvitations.email],
      set: { role, tokenHash: hashToken(token), invitedBy, expiresAt, acceptedAt: null, acceptedUserId: null, createdAt: now },
    })
    .returning();
  return {
    id: row.id, email: row.email, role, expiresAt: row.expiresAt, createdAt: row.createdAt, state: "open",
    link: `${appUrl}/org/join/${token}`, organizationName: org.name,
  };
}

export async function listOpenInvitations(organizationId: string, now: Date = new Date()): Promise<InvitationSummary[]> {
  const rows = await db.select().from(organizationInvitations)
    .where(and(eq(organizationInvitations.organizationId, organizationId), isNull(organizationInvitations.acceptedAt)))
    .orderBy(desc(organizationInvitations.createdAt));
  return rows.map((r) => ({ id: r.id, email: r.email, role: r.role as OrgRole, expiresAt: r.expiresAt, createdAt: r.createdAt, state: invitationState(r, now) }))
    .filter((r) => r.state === "open");
}

export async function revokeInvitation(organizationId: string, id: string): Promise<boolean> {
  const gone = await db.delete(organizationInvitations)
    .where(and(eq(organizationInvitations.organizationId, organizationId), eq(organizationInvitations.id, id), isNull(organizationInvitations.acceptedAt)))
    .returning({ id: organizationInvitations.id });
  return gone.length > 0;
}

async function byToken(token: string) {
  const t = clean(token, 200);
  if (!/^[0-9a-f]{48}$/.test(t)) return null;
  const [row] = await db.select({ inv: organizationInvitations, org: organizations }).from(organizationInvitations)
    .innerJoin(organizations, eq(organizations.id, organizationInvitations.organizationId))
    .where(eq(organizationInvitations.tokenHash, hashToken(t)));
  return row ?? null;
}

/** What the join page shows: who invited, for what, and whether the link still works. */
export async function describeInvitation(token: string, now: Date = new Date()) {
  const row = await byToken(token);
  if (!row) throw new CommercialError("This invitation link is not valid.", 404);
  const state = invitationState(row.inv, now);
  const [existing] = await db.select({ id: users.id }).from(users).where(and(eq(users.email, row.inv.email), isNull(users.deletedAt)));
  return {
    organizationId: row.org.id, organizationName: row.org.name, email: row.inv.email, role: row.inv.role as OrgRole,
    state, refusal: invitationRefusal(state, row.org.name), expiresAt: row.inv.expiresAt, days: INVITATION_DAYS,
    hasAccount: !!existing,
  };
}

export interface AcceptInput {
  firstName?: unknown; lastName?: unknown; phone?: unknown; password?: unknown;
  termsAccepted?: unknown; privacyAccepted?: unknown;
}

/**
 * Accept: an existing account with that email is attached and told to sign
 * in; otherwise the account is created, approved, attached and signed in
 * by the caller. Returns the user to sign in, or null when they already had one.
 */
export async function acceptInvitation(token: string, input: AcceptInput, now: Date = new Date()): Promise<{ organizationId: string; organizationName: string; userId: string; existing: boolean }> {
  const row = await byToken(token);
  if (!row) throw new CommercialError("This invitation link is not valid.", 404);
  const state = invitationState(row.inv, now);
  const refusal = invitationRefusal(state, row.org.name);
  if (refusal) throw new CommercialError(refusal, 410);
  const role = isOrgRole(row.inv.role) ? row.inv.role : "requester";

  const [existing] = await db.select().from(users).where(and(eq(users.email, row.inv.email), isNull(users.deletedAt)));
  if (existing) {
    await db.transaction(async (tx) => {
      await tx.insert(organizationMembers).values({ organizationId: row.org.id, userId: existing.id, role })
        .onConflictDoUpdate({ target: [organizationMembers.organizationId, organizationMembers.userId], set: { role } });
      await tx.update(organizationInvitations).set({ acceptedAt: now, acceptedUserId: existing.id }).where(eq(organizationInvitations.id, row.inv.id));
    });
    return { organizationId: row.org.id, organizationName: row.org.name, userId: existing.id, existing: true };
  }

  const firstName = clean(input.firstName, 50);
  const lastName = clean(input.lastName, 50);
  if (!firstName || !lastName) throw new CommercialError("Your first and last name are needed.");
  const phoneRaw = clean(input.phone, 30);
  const digits = phoneRaw.replace(/\D/g, "");
  if (!(digits.length === 10 || (digits.length === 11 && digits.startsWith("1")))) throw new CommercialError("Phone number must be a valid 10-digit US number (e.g. 301-555-1234).");
  const password = typeof input.password === "string" ? input.password : "";
  const policy = validatePasswordComplexity(password);
  if (!policy.valid) throw new CommercialError(`Password must contain: ${policy.feedback.join(", ")}.`);
  if (input.termsAccepted !== true || input.privacyAccepted !== true) throw new CommercialError("Please accept the Terms of Service and Privacy Policy.");
  const hashed = await bcrypt.hash(password, 12);

  const userId = await db.transaction(async (tx) => {
    const [user] = await tx.insert(users).values({
      email: row.inv.email, password: hashed, firstName, lastName, phone: normalizePhone(phoneRaw) ?? phoneRaw,
      isApproved: true, approvedBy: `organization:${row.org.id}`,
      virtualCardBalance: "0.00", promoRidesRemaining: 0,
      termsAcceptedAt: now, privacyAcceptedAt: now, registrationCompletedAt: now,
    } as any).returning({ id: users.id });
    await tx.insert(organizationMembers).values({ organizationId: row.org.id, userId: user.id, role });
    await tx.update(organizationInvitations).set({ acceptedAt: now, acceptedUserId: user.id }).where(eq(organizationInvitations.id, row.inv.id));
    return user.id;
  });
  console.log(`[AUDIT] invitation_accepted org=${row.org.id} userId=${userId} email=${row.inv.email} role=${role}`);
  return { organizationId: row.org.id, organizationName: row.org.name, userId, existing: false };
}
