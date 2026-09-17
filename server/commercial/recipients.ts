/**
 * The recipient book, server side (rules in shared/recipients.ts). One book
 * per organization; every route is scoped by requireMember. A recipient with
 * a phone is one entry however often it is saved; removing one archives it.
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { organizationRecipients } from "@shared/schema";
import { normalizeRecipient, type RecipientInput } from "@shared/recipients";
import { CommercialError } from "./organizations";

export type SavedRecipient = typeof organizationRecipients.$inferSelect;

export async function listRecipients(organizationId: string): Promise<SavedRecipient[]> {
  return db.select().from(organizationRecipients)
    .where(and(eq(organizationRecipients.organizationId, organizationId), isNull(organizationRecipients.archivedAt)))
    .orderBy(desc(organizationRecipients.updatedAt));
}

/** Save or refresh a recipient. The same phone is the same person; without a phone, the same name and address. */
export async function saveRecipient(organizationId: string, input: RecipientInput, byUserId: string, now: Date = new Date()): Promise<SavedRecipient> {
  const checked = normalizeRecipient(input);
  if (!checked.valid) throw new CommercialError(checked.error);
  const r = checked.recipient;
  const [existing] = await db.select().from(organizationRecipients).where(and(
    eq(organizationRecipients.organizationId, organizationId),
    r.phone ? eq(organizationRecipients.phone, r.phone) : and(eq(organizationRecipients.name, r.name), sql`${organizationRecipients.address}->>'address' = ${r.address.address}`),
  ));
  if (existing) {
    const [row] = await db.update(organizationRecipients)
      .set({ name: r.name, phone: r.phone, address: r.address, handover: r.handover, note: r.note, archivedAt: null, updatedAt: now })
      .where(eq(organizationRecipients.id, existing.id)).returning();
    return row;
  }
  const [row] = await db.insert(organizationRecipients)
    .values({ organizationId, name: r.name, phone: r.phone, address: r.address, handover: r.handover, note: r.note, createdBy: byUserId, createdAt: now, updatedAt: now })
    .returning();
  return row;
}

/** Hide a recipient from the book. Past jobs keep their own copy of the details. */
export async function archiveRecipient(organizationId: string, id: string, now: Date = new Date()): Promise<boolean> {
  const rows = await db.update(organizationRecipients).set({ archivedAt: now, updatedAt: now })
    .where(and(eq(organizationRecipients.organizationId, organizationId), eq(organizationRecipients.id, id), isNull(organizationRecipients.archivedAt)))
    .returning({ id: organizationRecipients.id });
  return rows.length > 0;
}
