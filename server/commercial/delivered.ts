/**
 * After the handover: the receiver is texted that it was delivered, with a
 * link to the proof; and proof photos are kept 90 days, the record forever
 * (standard practice, decided 2026-09-17).
 *
 * The delivered page is public through a token the job carries; it shows the
 * shop, when, how it was handed over and the photo — never the goods.
 */
import { randomBytes } from "node:crypto";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "../db";
import { commercialJobs, organizations, rides, storedObjects } from "@shared/schema";
import { sendSms } from "../smsService";
import { formatJobNumber } from "@shared/commercial";
import { describeProof, handoverOf, type DeliveryProof } from "@shared/deliveries";
import { CommercialError } from "./organizations";

export const PROOF_PHOTO_RETENTION_DAYS = 90;

type Row = { job: typeof commercialJobs.$inferSelect; ride: typeof rides.$inferSelect; org: typeof organizations.$inferSelect };
const jobLabel = (job: { jobNumber: number }) => formatJobNumber(job.jobNumber);
const clock = (d: Date | string) => new Date(d).toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });

async function load(where: any): Promise<Row | null> {
  const [row] = await db.select({ job: commercialJobs, ride: rides, org: organizations }).from(commercialJobs)
    .innerJoin(rides, eq(rides.id, commercialJobs.rideId))
    .innerJoin(organizations, eq(organizations.id, commercialJobs.organizationId))
    .where(where);
  return row ?? null;
}
const byToken = (token: string) => (/^[0-9a-f]{48}$/.test(token) ? load(eq(commercialJobs.proofShareToken, token)) : Promise.resolve(null));

/** One line for the text: how it was handed over. */
function handoverLine(proof: DeliveryProof | null, handover: unknown): string {
  if (proof?.receivedBy) return `received by ${proof.receivedBy}`;
  if (handoverOf(handover) === "unattended") return "left at the door";
  return "handed over";
}

/** Text the receiver that the parcel was delivered, with a link to the proof. Best effort; logged verbatim. */
export async function notifyDelivered(rideId: string, appUrl: string, now: Date = new Date()): Promise<{ token: string; link: string; textSent: boolean } | null> {
  const row = await load(eq(commercialJobs.rideId, rideId));
  if (!row || !row.job.parcelSize) return null;
  // Once: the stamp lives in the proof, so a retry of the complete route or a
  // second caller never texts the receiver twice.
  const stamped = (row.job.proof ?? {}) as Record<string, unknown>;
  if (stamped.deliveredTextedAt) return null;
  await db.update(commercialJobs).set({ proof: { ...stamped, deliveredTextedAt: now.toISOString() } as Record<string, unknown> }).where(eq(commercialJobs.id, row.job.id));
  let token = row.job.proofShareToken;
  if (!token) {
    token = randomBytes(24).toString("hex");
    await db.update(commercialJobs).set({ proofShareToken: token }).where(eq(commercialJobs.id, row.job.id));
  }
  const link = `${appUrl}/delivered/${token}`;
  const proof = (row.job.proof ?? null) as DeliveryProof | null;
  const when = clock(row.ride.completedAt ?? now);
  const body = `PG Ride: your order from ${row.org.name} was delivered at ${when}, ${handoverLine(proof, row.job.handover)}. See the proof: ${link}`;
  const to = row.job.dropContact?.phone ?? null;
  console.log(`[delivered] ${jobLabel(row.job)} → ${to ?? "no number"}: ${body}`);
  if (!to) return { token, link, textSent: false };
  const r = await sendSms(to, body).catch(() => ({ sent: false as const, reason: "send_failed" as const }));
  if (!r.sent && r.reason !== "not_configured") console.log(`[delivered] ${jobLabel(row.job)}: not sent (${r.reason})`);
  return { token, link, textSent: r.sent };
}

export interface DeliveredView {
  shopName: string; jobLabel: string; deliveredAt: string | null; handoverText: string | null;
  hasPhoto: boolean; photoPending: boolean; photoRetired: boolean; dropAddress: string | null;
}

export async function deliveredView(token: string): Promise<DeliveredView> {
  const row = await byToken(token);
  if (!row) throw new CommercialError("This link is not valid.", 404);
  const proof = (row.job.proof ?? null) as (DeliveryProof & { photoRetired?: boolean }) | null;
  return {
    shopName: row.org.name, jobLabel: jobLabel(row.job), deliveredAt: row.ride.completedAt ? new Date(row.ride.completedAt).toISOString() : null,
    handoverText: describeProof(proof, row.job.handover), hasPhoto: !!proof?.photoUrl, photoPending: !!proof?.photoPending, photoRetired: !!proof?.photoRetired,
    dropAddress: row.ride.destinationLocation?.address ?? null,
  };
}

/** The photo bytes for the delivered page, while the photo is kept. */
export async function deliveredPhoto(token: string): Promise<{ contentType: string; bytes: Buffer } | null> {
  const row = await byToken(token);
  if (!row) throw new CommercialError("This link is not valid.", 404);
  const proof = (row.job.proof ?? null) as DeliveryProof | null;
  const m = /^\/api\/objects\/db-upload\/([0-9a-f-]{36})$/i.exec(proof?.photoUrl ?? "");
  if (!m) return null;
  const [obj] = await db.select().from(storedObjects).where(eq(storedObjects.id, m[1]));
  if (!obj || !/^image\//i.test(obj.contentType)) return null;
  return { contentType: obj.contentType, bytes: Buffer.from(obj.dataBase64, "base64") };
}

/** Photos older than the retention period are deleted; the proof keeps everything else and says the photo was retired. */
export async function retireOldProofPhotos(now: Date = new Date(), days: number = PROOF_PHOTO_RETENTION_DAYS): Promise<{ retired: number }> {
  const cutoff = now.getTime() - days * 86_400_000;
  // Candidates are compared in code, not by casting in SQL: one odd signedAt
  // must not abort the whole sweep for every job.
  const candidates = await db.select({ id: commercialJobs.id, jobNumber: commercialJobs.jobNumber, proof: commercialJobs.proof }).from(commercialJobs)
    .where(and(isNotNull(commercialJobs.proof), sql`${commercialJobs.proof}->>'photoUrl' IS NOT NULL`, sql`COALESCE(${commercialJobs.proof}->>'photoRetired', 'false') <> 'true'`));
  const rows = candidates.filter((r) => { const t = Date.parse(String((r.proof as any)?.signedAt ?? "")); return Number.isFinite(t) && t < cutoff; });
  let retired = 0;
  for (const row of rows) {
    const proof = (row.proof ?? {}) as DeliveryProof & { photoRetired?: boolean; photoRetiredAt?: string };
    const m = /^\/api\/objects\/db-upload\/([0-9a-f-]{36})$/i.exec(proof.photoUrl ?? "");
    try {
      await db.transaction(async (tx) => {
        // The object goes only when no other job's proof still points at it.
        if (m) {
          const [shared] = await tx.select({ id: commercialJobs.id }).from(commercialJobs).where(and(sql`${commercialJobs.id} <> ${row.id}`, sql`${commercialJobs.proof}->>'photoUrl' = ${proof.photoUrl}`)).limit(1);
          if (!shared) await tx.delete(storedObjects).where(eq(storedObjects.id, m[1]));
        }
        await tx.update(commercialJobs).set({ proof: { ...proof, photoUrl: null, photoRetired: true, photoRetiredAt: now.toISOString() } as Record<string, unknown> }).where(eq(commercialJobs.id, row.id));
      });
      retired += 1;
      console.log(`[delivered] ${formatJobNumber(row.jobNumber)}: proof photo retired after ${days} days; the record stays`);
    } catch (err) {
      console.error(`[delivered] could not retire the photo for ${formatJobNumber(row.jobNumber)}:`, err);
    }
  }
  return { retired };
}
