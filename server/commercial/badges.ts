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
import { opsAlert, formatOpsAlert } from "../telegramOps";
import { haversineMiles } from "../rideWorkflowService";
import { PROOF_DISTANCE_FLAG_METERS, handoverOf, proofComplete, proofRequirement, proofSatisfies, type DeliveryProof } from "@shared/deliveries";
import { commercialJobs, driverProfiles, organizations, rides, storedObjects, users } from "@shared/schema";
import { badgeRefusalMessage, driverMayTake, normalizeBadges, type DriverBadge } from "@shared/driverBadges";
import { kindOfJob, type JobKind } from "@shared/commercial";
import { isHeld } from "@shared/recipientApproval";
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
  const [held] = await db.select({ recipientApproval: commercialJobs.recipientApproval }).from(commercialJobs).where(eq(commercialJobs.rideId, rideId));
  if (held && isHeld(held)) throw new CommercialError("This delivery is waiting for the recipient to approve the fee; it opens to drivers once they do, or once the shop sends it anyway.", 409);
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
/**
 * A proof photo must be an object the DRIVER uploaded through PG Ride's own
 * database-backed store, and it must be an image. The shape of a path is
 * not enough (post-implementation audit, 2026-09-17): a driver could name
 * someone else's object and hand their organization read access to it, or
 * upload text/html and have the desk open it same-origin.
 */
async function verifiedProofPhotoPath(raw: unknown, driverUserId: string): Promise<string> {
  const text = String(raw ?? "").trim().slice(0, 600);
  if (!text) throw new CommercialError("The photo did not upload. Try again.");
  let parsed: URL;
  try { parsed = new URL(text, "http://pgride.local"); } catch { throw new CommercialError("That is not a photo PG Ride uploaded."); }
  const m = /^\/api\/objects\/db-upload\/([0-9a-f-]{36})$/i.exec(parsed.pathname);
  if (!m) throw new CommercialError("That is not a photo PG Ride uploaded.");
  const [obj] = await db.select({ id: storedObjects.id, ownerUserId: storedObjects.ownerUserId, contentType: storedObjects.contentType }).from(storedObjects).where(eq(storedObjects.id, m[1]));
  if (!obj) throw new CommercialError("The photo did not upload. Try again.");
  if (obj.ownerUserId !== driverUserId) throw new CommercialError("That photo is not yours.", 403);
  // A photo, and only a raster one: an SVG is a document that can carry a script.
  if (!/^image\/(jpeg|jpg|png|webp|heic|heif|gif)$/i.test(obj.contentType)) throw new CommercialError("The proof must be a photo (JPEG, PNG, WebP or HEIC).");
  const path = `/api/objects/db-upload/${obj.id}`;
  // One upload proves one job: a photo shared between jobs would be retired from under the younger one.
  const [used] = await db.select({ id: commercialJobs.id }).from(commercialJobs).where(sql`${commercialJobs.proof}->>'photoUrl' = ${path}`).limit(1);
  if (used) throw new CommercialError("That photo is already the proof for another job. Take a new one.");
  return path;
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
 *
 * Rules (post-implementation audit, 2026-09-17): a proof is first recorded
 * while the trip is on the road; after completion only the photo that was
 * pending may follow; the time of the handover is the first signing and is
 * never rewritten; a photo, once recorded, is not replaced.
 */
export async function recordProof(rideId: string, driverUserId: string, input: ProofInput, now: Date = new Date()): Promise<DeliveryProof> {
  const [row] = await db.select({ job: commercialJobs, ride: rides }).from(commercialJobs)
    .innerJoin(rides, eq(rides.id, commercialJobs.rideId))
    .where(eq(commercialJobs.rideId, rideId));
  if (!row) throw new CommercialError("This trip is not a commercial job.", 404);
  if (row.ride.driverId !== driverUserId) throw new CommercialError("This is not your job.", 403);
  const handover = row.job.parcelSize ? handoverOf(row.job.handover) : "person";
  const need = proofRequirement(handover);
  const previous = (row.job.proof ?? null) as DeliveryProof | null;
  const onTheRoad = row.ride.status === "in_progress" || row.ride.status === "driver_arriving";
  const followUpPhotoOnly = !!previous?.signedAt && row.ride.status === "completed";

  if (!previous?.signedAt && !onTheRoad) throw new CommercialError("Record the handover once you are on the road with it.", 409);
  if (followUpPhotoOnly) {
    // After completion only the photo that was pending may arrive; nothing else moves.
    if (!previous?.photoPending && !previous?.photoNeverArrived) throw new CommercialError("This job is complete and its handover is recorded.", 409);
    if (!input.photoUrl) throw new CommercialError("Only the pending photo can be added now.", 409);
  } else if (previous?.photoUrl && input.photoUrl) {
    throw new CommercialError("This handover already has its photo.", 409);
  }

  const receivedBy = followUpPhotoOnly ? previous?.receivedBy ?? null : (String(input.receivedBy ?? "").trim().slice(0, 120) || previous?.receivedBy || null);
  // The name comes first: a photo alone is not a handover where someone signs.
  if (need.needsName && !receivedBy) throw new CommercialError(row.job.parcelSize ? "Type who received the parcel." : "Type who received the passenger.");
  const photoUrl = input.photoUrl ? await verifiedProofPhotoPath(input.photoUrl, driverUserId) : previous?.photoUrl ?? null;
  const photoPending = !photoUrl && need.needsPhoto && (input.photoPending === true || (!!previous?.photoPending && followUpPhotoOnly));
  const lat = Number(input.lat), lng = Number(input.lng);
  const hasPosition = !followUpPhotoOnly && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const drop = row.ride.destinationLocation as { lat?: number; lng?: number } | null;
  const distanceFromDropMeters = hasPosition && drop && Number.isFinite(drop.lat) && Number.isFinite(drop.lng)
    ? Math.round(haversineMiles(lat, lng, Number(drop.lat), Number(drop.lng)) * 1609.34)
    : previous?.distanceFromDropMeters ?? null;

  const proof: DeliveryProof = {
    ...(previous ?? {}),
    receivedBy,
    photoUrl,
    photoPending,
    note: followUpPhotoOnly ? previous?.note ?? null : (input.note ? String(input.note).trim().slice(0, 300) : previous?.note ?? null),
    signedAt: previous?.signedAt ?? now.toISOString(),
    signedBy: previous?.signedBy ?? driverUserId,
    photoUploadedAt: photoUrl && !previous?.photoUrl ? now.toISOString() : previous?.photoUploadedAt ?? null,
    photoNeverArrived: photoUrl ? false : previous?.photoNeverArrived ?? false,
    lat: hasPosition ? lat : previous?.lat ?? null,
    lng: hasPosition ? lng : previous?.lng ?? null,
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
 * person in it completes as it always did. Throws on a database error: the
 * caller must fail closed, never complete a parcel it could not check.
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
  if (!/^[0-9a-f-]{36}$/i.test(objectId)) return false;
  const rows = await db.execute(sql`
    SELECT 1 FROM commercial_jobs cj
    JOIN organization_members om ON om.organization_id = cj.organization_id
    WHERE om.user_id = ${userId} AND cj.proof->>'photoUrl' = ${"/api/objects/db-upload/" + objectId}
    LIMIT 1`);
  return ((rows as any).rows ?? rows).length > 0;
}

/**
 * A photo that never arrived is not silence. Six hours after a handover was
 * recorded with the photo still on the phone, ops is paged once; after a day
 * the proof says "photo never arrived" and ops is paged again. Runs hourly.
 */
export async function sweepPendingProofPhotos(now: Date = new Date()): Promise<{ paged: number; expired: number }> {
  const out = { paged: 0, expired: 0 };
  const rows = await db.select({ job: commercialJobs, org: organizations }).from(commercialJobs)
    .innerJoin(organizations, eq(organizations.id, commercialJobs.organizationId))
    .where(sql`${commercialJobs.proof}->>'photoPending' = 'true'`);
  for (const { job, org } of rows) {
    const proof = (job.proof ?? {}) as DeliveryProof & { photoPendingPagedAt?: string | null; photoNeverArrived?: boolean };
    const signed = proof.signedAt ? new Date(proof.signedAt).getTime() : NaN;
    if (!Number.isFinite(signed)) continue;
    const hours = (now.getTime() - signed) / 3_600_000;
    const fields: Array<[string, string]> = [["Account", org.name], ["Job", formatJobNumber(job.jobNumber)], ["Handover", proof.signedAt ?? ""]];
    if (hours >= 24) {
      await db.update(commercialJobs).set({ proof: { ...proof, photoPending: false, photoNeverArrived: true } as Record<string, unknown> }).where(eq(commercialJobs.id, job.id));
      opsAlert(formatOpsAlert("📷 Proof photo never arrived", [...fields, ["Effect", "The job reads 'photo never arrived'; ask the driver"]]));
      out.expired += 1;
    } else if (hours >= 6 && !proof.photoPendingPagedAt) {
      await db.update(commercialJobs).set({ proof: { ...proof, photoPendingPagedAt: now.toISOString() } as Record<string, unknown> }).where(eq(commercialJobs.id, job.id));
      opsAlert(formatOpsAlert("📷 Proof photo still on the driver's phone", [...fields, ["Since", `${Math.floor(hours)} h`]]));
      out.paged += 1;
    }
  }
  return out;
}
