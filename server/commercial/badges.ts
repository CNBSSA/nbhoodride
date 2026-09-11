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

import { eq } from "drizzle-orm";
import { db } from "../db";
import { commercialJobs, driverProfiles, organizations, rides, users } from "@shared/schema";
import { badgeRefusalMessage, driverMayTake, normalizeBadges, type DriverBadge } from "@shared/driverBadges";
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

/**
 * Refuse the claim when the driver is not cleared for the work. Called by
 * the claim and accept routes; the board hides these jobs anyway, so this
 * is the belt to that pair of braces.
 */
export async function assertDriverMayTakeRide(userId: string, rideId: string): Promise<void> {
  const category = await categoryOfRide(rideId);
  if (!category) return;
  if (!driverMayTake(await badgesFor(userId), category)) {
    throw new CommercialError(badgeRefusalMessage(category), 403);
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

export interface ProofInput {
  /** Who received the passenger, or took the parcel, at the far end. */
  receivedBy: string;
  note?: string | null;
  /** A delivery's photo of the handover. */
  photoUrl?: string | null;
}

/**
 * The signature at the facility: the driver types who received the
 * passenger. Stored on the job so the statement and the desk can show it,
 * and so a dispute has an answer.
 */
export async function recordProof(rideId: string, driverUserId: string, input: ProofInput, now: Date = new Date()): Promise<Record<string, unknown>> {
  const [row] = await db.select({ job: commercialJobs, ride: rides }).from(commercialJobs)
    .innerJoin(rides, eq(rides.id, commercialJobs.rideId))
    .where(eq(commercialJobs.rideId, rideId));
  if (!row) throw new CommercialError("This trip is not a commercial job.", 404);
  if (row.ride.driverId !== driverUserId) throw new CommercialError("This is not your job.", 403);
  const receivedBy = String(input.receivedBy ?? "").trim().slice(0, 120);
  if (!receivedBy) throw new CommercialError("Type who received the passenger.");
  const proof = {
    ...(row.job.proof ?? {}),
    receivedBy,
    photoUrl: input.photoUrl ? String(input.photoUrl).trim().slice(0, 500) : (row.job.proof as any)?.photoUrl,
    note: input.note ? String(input.note).trim().slice(0, 300) : undefined,
    signedAt: now.toISOString(),
    signedBy: driverUserId,
  };
  await db.update(commercialJobs).set({ proof }).where(eq(commercialJobs.id, row.job.id));
  return proof;
}
