/**
 * Driver badges, the passenger's tracking text, and the signature at the
 * facility — the driver's side of commercial work (rules in
 * shared/driverBadges.ts).
 *
 * Three jobs:
 *   - say what a ride needs and what a driver holds, so the claim board can
 *     hide work a driver is not cleared for and the claim route can refuse
 *     it outright;
 *   - text the passenger, who has no account, the driver's name and a
 *     tracking link once a driver is holding their trip;
 *   - record who received the passenger at the far end.
 */

import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { haversineMiles } from "../rideWorkflowService";
import { ObjectStorageService } from "../objectStorage";
import { PROOF_DISTANCE_FLAG_METERS, handoverOf, proofComplete, proofRequirement, proofSatisfies, type DeliveryProof } from "@shared/deliveries";
import { commercialJobs, driverProfiles, organizations, rides, users } from "@shared/schema";
import { badgeRefusalMessage, driverMayTake, normalizeBadges, type DriverBadge } from "@shared/driverBadges";
import { kindOfJob, type JobKind } from "@shared/commercial";
import { isHeld } from "@shared/recipientPay";
import { formatJobNumber } from "@shared/commercial";
import { createTrackingLink } from "../agents/smsBooking";
import { sendSms } from "../smsService";
import { resolveAppUrl } from "../appUrl";
import type { IStorage } from "../storage";
import { CommercialError } from "./organizations";

/** The badges a driver holds. Junk in the column grants nothing. */
export async function badgesFor(userId: string): Promise<DriverBadge[]> {
  const [row] = await db.select({ badges: driverProfiles.badges }).from(driverProfiles).where(eq(driverProfiles.userId, userId));
  return normalizeBadges(row?.badges);
}

export async function setBadges(userId: string, badges: unknown): Promise<DriverBadge[]> {
  const next = normalizeBadges(badges);
  const [row] = await db.update(driverProfiles).set({ badges: next, updatedAt: new Date() })
    .where(eq(driverProfiles.userId, userId)).returning({ badges: driverProfiles.badges });
  if (!row) throw new CommercialError("That driver has no profile yet.", 404);
  return normalizeBadges(row.badges);
}

/** The commercial category of a ride, or null when it is an ordinary trip. */
export async function categoryOfRide(rideId: string): Promise<string | null> {
  const [row] = await db.select({ category: commercialJobs.category }).from(commercialJobs).where(eq(commercialJobs.rideId, rideId));
  return row?.category ?? null;
}

/** The work a ride is: its account's category and whether it carries a parcel or a person. */
export async function workOfRide(rideId: string): Promise<{ category: string; kind: JobKind } | null> {
  const [row] = await db
    .select({ category: commercialJobs.category, parcelSize: commercialJobs.parcelSize })
    .from(commercialJobs)
    .where(eq(commercialJobs.rideId, rideId));
  return row ? { category: row.category, kind: kindOfJob(row) } : null;
}

/**
 * Refuse the claim when the driver is not cleared for the work. Called by
 * the claim and accept routes; the board hides these jobs anyway, so this
 * is the belt to that pair of braces.
 */
export async function assertDriverMayTakeRide(userId: string, rideId: string): Promise<void> {
  const work = await workOfRide(rideId);
  if (!work) return;
  const [held] = await db.select({ payer: commercialJobs.payer, status: commercialJobs.recipientPaymentStatus }).from(commercialJobs).where(eq(commercialJobs.rideId, rideId));
  if (held && isHeld(held)) throw new CommercialError("This delivery is waiting for the recipient to pay; it opens to drivers once paid.", 409);
  if (!driverMayTake(await badgesFor(userId), work.category, work.kind)) {
    throw new CommercialError(badgeRefusalMessage(work.category, work.kind), 403);
  }
}

/**
 * Tell the passenger, who holds no account, that a driver is coming: the
 * driver's first name, when, and a link that shows the car on a map. Best
 * effort — a text that does not send never blocks a claim.
 */
export async function textPassengerTrackingLink(storage: IStorage, rideId: string): Promise<boolean> {
  const [row] = await db
    .select({ job: commercialJobs, ride: rides, org: organizations })
    .from(commercialJobs)
    .innerJoin(rides, eq(rides.id, commercialJobs.rideId))
    .innerJoin(organizations, eq(organizations.id, commercialJobs.organizationId))
    .where(eq(commercialJobs.rideId, rideId));
  if (!row || !row.ride.passengerPhone || !row.ride.driverId) return false;

  const [driver] = await db.select({ firstName: users.firstName }).from(users).where(eq(users.id, row.ride.driverId));
  const when = row.ride.scheduledAt
    ? new Date(row.ride.scheduledAt).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" })
    : "shortly";
  const token = await createTrackingLink(storage, row.ride.riderId, rideId, "Passenger");
  const base = resolveAppUrl("https://pgride.app");
  const message = `PG Ride: ${driver?.firstName ?? "Your driver"} is booked to pick you up ${when} for ${row.org.name}. Track the car: ${base}/guardian/${token}. No app needed.`;
  const sent = await sendSms(row.ride.passengerPhone, message);
  const ok = sent.sent === true;
  // The message is logged either way: when Twilio is unreachable this is the
  // only record that the passenger should have been told, and by what words.
  console.log(`[commercial] passenger texted :: ${row.org.name} | ${formatJobNumber(row.job.jobNumber)} | ${ok ? "sent" : `not sent (${(sent as any).reason ?? "unknown"})`} :: ${message}`);
  return ok;
}


/**
 * The signature at the facility: the driver types who received the
 * passenger. Stored on the job so the statement and the desk can show it,
 * and so a dispute has an answer.
 */
/** The photo must have come through PG Ride's own upload; nothing else is a proof. */
function normalizeProofPhotoUrl(raw: unknown): string {
  const text = String(raw ?? "").trim().slice(0, 600);
  if (!text) throw new CommercialError("The photo did not upload. Try again.");
  let parsed: URL;
  try { parsed = new URL(text, "http://pgride.local"); } catch { throw new CommercialError("That is not a photo PG Ride uploaded."); }
  if (/^\/api\/objects\/db-upload\/[0-9a-f-]{36}$/i.test(parsed.pathname)) return parsed.pathname;
  if (/^\/objects\//.test(parsed.pathname)) return parsed.pathname;
  if (parsed.hostname.endsWith("storage.googleapis.com")) return new ObjectStorageService().normalizeObjectEntityPath(text);
  throw new CommercialError("That is not a photo PG Ride uploaded.");
}

export interface ProofInput {
  receivedBy?: unknown;
  photoUrl?: unknown;
  /** The photo is on the phone and will follow: allowed only where a photo is required. */
  photoPending?: unknown;
  note?: unknown;
  lat?: unknown;
  lng?: unknown;
}

/**
 * Record who took the parcel (or the passenger) and, where nobody signs, the
 * photo of where it was left. The handover kind on the job decides what is
 * required (shared/deliveries.ts); a ride without a parcel needs a name, as
 * before. The driver's position is recorded and compared with the drop
 * address: far away is flagged to the desk, never refused — GPS indoors lies.
 */
export async function recordProof(rideId: string, driverUserId: string, input: ProofInput, now: Date = new Date()): Promise<DeliveryProof> {
  const [row] = await db.select({ job: commercialJobs, ride: rides }).from(commercialJobs)
    .innerJoin(rides, eq(rides.id, commercialJobs.rideId))
    .where(eq(commercialJobs.rideId, rideId));
  if (!row) throw new CommercialError("This trip is not a commercial job.", 404);
  if (row.ride.driverId !== driverUserId) throw new CommercialError("This is not your job.", 403);
  const handover = row.job.parcelSize ? handoverOf(row.job.handover) : "person";
  const need = proofRequirement(handover);
  const previous = (row.job.proof ?? {}) as DeliveryProof;

  const receivedBy = String(input.receivedBy ?? "").trim().slice(0, 120) || previous.receivedBy || null;
  const photoUrl = input.photoUrl ? normalizeProofPhotoUrl(input.photoUrl) : previous.photoUrl ?? null;
  const photoPending = !photoUrl && need.needsPhoto && input.photoPending === true;
  const lat = Number(input.lat), lng = Number(input.lng);
  const hasPosition = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const drop = row.ride.destinationLocation as { lat?: number; lng?: number } | null;
  const distanceFromDropMeters = hasPosition && drop && Number.isFinite(drop.lat) && Number.isFinite(drop.lng)
    ? Math.round(haversineMiles(lat, lng, Number(drop.lat), Number(drop.lng)) * 1609.34)
    : previous.distanceFromDropMeters ?? null;

  const proof: DeliveryProof = {
    ...previous,
    receivedBy,
    photoUrl,
    photoPending,
    note: input.note ? String(input.note).trim().slice(0, 300) : previous.note ?? null,
    signedAt: now.toISOString(),
    signedBy: driverUserId,
    lat: hasPosition ? lat : previous.lat ?? null,
    lng: hasPosition ? lng : previous.lng ?? null,
    distanceFromDropMeters,
    farFromDrop: distanceFromDropMeters !== null && distanceFromDropMeters > PROOF_DISTANCE_FLAG_METERS,
  };
  const verdict = proofSatisfies(handover, proof);
  if (!verdict.ok) {
    if (need.needsName && !receivedBy) throw new CommercialError(row.job.parcelSize ? "Type who received the parcel." : "Type who received the passenger.");
    throw new CommercialError(`This handover needs ${verdict.missing}.`);
  }
  await db.update(commercialJobs).set({ proof: proof as Record<string, unknown> }).where(eq(commercialJobs.id, row.job.id));
  console.log(`[commercial] proof recorded :: job ${row.job.jobNumber} | ${handover} | ${receivedBy ?? "nobody signed"} | ${photoUrl ? "photo" : photoPending ? "photo pending" : "no photo"}${proof.farFromDrop ? ` | ${distanceFromDropMeters} m from the drop` : ""}`);
  return proof;
}

/**
 * Why a parcel cannot be completed yet, or null. A delivery is not finished
 * until its handover is proven the way the desk asked for; a ride with a
 * person in it completes as it always did.
 */
export async function proofGateForRide(rideId: string): Promise<string | null> {
  const [job] = await db.select({ parcelSize: commercialJobs.parcelSize, handover: commercialJobs.handover, proof: commercialJobs.proof })
    .from(commercialJobs).where(eq(commercialJobs.rideId, rideId));
  if (!job || !job.parcelSize) return null;
  const proof = (job.proof ?? null) as DeliveryProof | null;
  if (proofComplete(proof, job.handover)) return null;
  const verdict = proofSatisfies(job.handover, proof);
  return `Record the handover first: this delivery needs ${verdict.ok ? "the handover recorded" : verdict.missing}.`;
}

/** A member of the organization a proof photo belongs to may see it; so may the driver who took it and an admin. */
export async function userMaySeeProofPhoto(userId: string, objectId: string): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT 1 FROM commercial_jobs cj
    JOIN organization_members om ON om.organization_id = cj.organization_id
    WHERE om.user_id = ${userId} AND cj.proof->>'photoUrl' LIKE ${"%/" + objectId}
    LIMIT 1`);
  return ((rows as any).rows ?? rows).length > 0;
}
