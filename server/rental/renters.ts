/**
 * Renters: who may rent, and PG Ride's driving-record check (industry rules
 * adopted 2026-09-28; the rules themselves are in shared/rental.ts).
 *
 * A renter's facts — date of birth, licence number, issue and expiry dates,
 * licence photo — are kept on one row per person and reused between rentals.
 * A changed licence or date of birth sends the driving-record check back to
 * pending, so a clearance always belongs to the licence it was made on. Only
 * the desk records a check's result; no rental is confirmed without a
 * current clearance.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { rentalBookings, rentalRenters, users, type RentalRenter } from "@shared/schema";
import { DRIVING_RECORD_STANDARD, DRIVING_RECORD_VALID_DAYS, dayOf, drivingRecordCurrent } from "@shared/rental";
import { RentalError, verifiedStorePath } from "./cars";

const clean = (v: unknown, max = 80) => String(v ?? "").trim().slice(0, max);

export async function getRenter(userId: string): Promise<RentalRenter | null> {
  const [r] = await db.select().from(rentalRenters).where(eq(rentalRenters.userId, userId));
  return r ?? null;
}

/** What a renter sees of their own row. */
export function renterSelfView(r: RentalRenter | null) {
  if (!r) return null;
  return {
    dateOfBirth: r.dateOfBirth, licenceNumber: r.licenceNumber, licenceIssuedOn: r.licenceIssuedOn, licenceExpiresOn: r.licenceExpiresOn,
    licenceImageUrl: r.licenceImageUrl, recordStatus: r.recordStatus, recordCheckedAt: r.recordCheckedAt,
    recordNote: r.recordStatus === "refused" ? r.recordNote : null,
  };
}

/**
 * Save the facts a rental request carries. Each may be left out when it is
 * already on file. The licence photo must be the renter's own upload.
 */
export async function saveRenterFacts(userId: string, body: any): Promise<RentalRenter> {
  const existing = await getRenter(userId);
  const numberRaw = clean(body?.licenceNumber, 20).toUpperCase();
  const licenceNumber = numberRaw || existing?.licenceNumber || "";
  if (!/^[A-Z0-9-]{4,20}$/.test(licenceNumber)) throw new RentalError("Enter your driving licence number as it is on the card.");
  const imageRaw = clean(body?.licenceImageUrl, 600);
  const licenceImageUrl = imageRaw
    ? (existing && imageRaw === existing.licenceImageUrl ? imageRaw : await verifiedStorePath(imageRaw, userId, { allowPdf: true, what: "licence photo" }))
    : existing?.licenceImageUrl ?? await verifiedStorePath("", userId, { what: "licence photo" });
  const pick = (k: "dateOfBirth" | "licenceIssuedOn" | "licenceExpiresOn", words: string) => {
    const given = body?.[k];
    if (given === undefined || given === null || given === "") {
      if (existing?.[k]) return existing[k];
      throw new RentalError(`Enter ${words}.`);
    }
    const d = dayOf(given);
    if (!d) throw new RentalError(`Enter ${words} as a date.`);
    return d;
  };
  const dateOfBirth = pick("dateOfBirth", "your date of birth");
  const licenceIssuedOn = pick("licenceIssuedOn", "the date your licence was first issued");
  const licenceExpiresOn = pick("licenceExpiresOn", "the date your licence expires");
  const now = new Date();
  const changed = !existing || existing.licenceNumber !== licenceNumber || existing.dateOfBirth !== dateOfBirth
    || existing.licenceIssuedOn !== licenceIssuedOn || existing.licenceExpiresOn !== licenceExpiresOn;
  const facts = { dateOfBirth, licenceNumber, licenceIssuedOn, licenceExpiresOn, licenceImageUrl, updatedAt: now };
  // A new licence is a new check: the old clearance was made on the old one.
  const recheck = changed ? { recordStatus: "pending", recordNote: null, recordCheckedAt: null, recordCheckedBy: null } : {};
  const [row] = await db.insert(rentalRenters).values({ userId, ...facts, recordStatus: "pending" })
    .onConflictDoUpdate({ target: rentalRenters.userId, set: { ...facts, ...recheck } }).returning();
  return row;
}

/** Renters the desk has to check: pending, or cleared but lapsing, with a request waiting. */
export async function listRentersToCheck(now: Date = new Date()) {
  const rows = await db.select({ r: rentalRenters, u: users }).from(rentalRenters)
    .innerJoin(users, eq(users.id, rentalRenters.userId)).orderBy(desc(rentalRenters.updatedAt)).limit(200);
  const waiting = await db.select({ renterId: rentalBookings.renterId, startsAt: rentalBookings.startsAt }).from(rentalBookings)
    .where(inArray(rentalBookings.status, ["requested", "confirmed"]));
  const firstStart = new Map<string, Date>();
  for (const w of waiting) {
    const prev = firstStart.get(w.renterId);
    if (!prev || w.startsAt < prev) firstStart.set(w.renterId, w.startsAt);
  }
  return {
    standard: DRIVING_RECORD_STANDARD,
    validDays: DRIVING_RECORD_VALID_DAYS,
    renters: rows.map(({ r, u }) => {
      const nextStart = firstStart.get(r.userId) ?? null;
      return {
        userId: r.userId, name: `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email || r.userId,
        dateOfBirth: r.dateOfBirth, licenceNumber: r.licenceNumber, licenceIssuedOn: r.licenceIssuedOn, licenceExpiresOn: r.licenceExpiresOn,
        licenceImageUrl: r.licenceImageUrl, recordStatus: r.recordStatus, recordNote: r.recordNote, recordCheckedAt: r.recordCheckedAt,
        nextStart,
        needsCheck: r.recordStatus === "pending" || (!!nextStart && r.recordStatus === "cleared" && !drivingRecordCurrent(r, nextStart)),
      };
    }),
  };
}

/** The desk records the driving-record check: cleared, or refused with the reason the renter is shown. */
export async function recordDrivingRecord(userId: string, actorId: string, body: any): Promise<RentalRenter> {
  const result = body?.result === "cleared" ? "cleared" : body?.result === "refused" ? "refused" : null;
  if (!result) throw new RentalError("Record the check as cleared or refused.");
  const note = clean(body?.note, 300);
  if (result === "refused" && !note) throw new RentalError("Say why the record does not clear: the renter is shown it.");
  const [row] = await db.update(rentalRenters).set({
    recordStatus: result, recordNote: note || null, recordCheckedAt: new Date(), recordCheckedBy: actorId, updatedAt: new Date(),
  }).where(eq(rentalRenters.userId, userId)).returning();
  if (!row) throw new RentalError("Renter not found.", 404);
  if (result === "refused") {
    // Nothing waiting on this licence is confirmed after a refusal.
    await db.update(rentalBookings).set({ status: "declined", cancelReason: `Driving record: ${note}`, updatedAt: new Date() })
      .where(and(eq(rentalBookings.renterId, userId), eq(rentalBookings.status, "requested")));
  }
  return row;
}
