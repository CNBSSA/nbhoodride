/**
 * Recipient approval — the server side (rules and words in
 * shared/recipientApproval.ts). A held job is booked like any other but not
 * released: the claim board, the scheduled-ride sweep, the ride-risk watch
 * and the claim itself skip it until the recipient has approved from the
 * link they were texted, or the shop sends it anyway. No money moves here.
 */
import { randomBytes } from "node:crypto";
import { and, eq, isNull, inArray } from "drizzle-orm";
import { db } from "../db";
import { commercialJobs, organizations, rides } from "@shared/schema";
import { sendSms } from "../smsService";
import { opsAlert, formatOpsAlert } from "../telegramOps";
import { formatJobNumber } from "@shared/commercial";
import { PARCEL_LABELS, describeWindow, isParcelSize } from "@shared/deliveries";
import {
  approvalOf, approvalText, heldJobExpired, isHeld, isOpenForAnswer, nudgeText, recipientApprovedText, recipientExpiredText,
  recipientNudgeDue, shopApprovedText, shopDecisionDue, shopDecisionText, shopDeclinedText,
} from "@shared/recipientApproval";
import { CommercialError } from "./organizations";

type Row = { job: typeof commercialJobs.$inferSelect; ride: typeof rides.$inferSelect; org: typeof organizations.$inferSelect };

/** Set by the routes: what to do when a held job is released (tell drivers). */
let releaseHook: ((ride: typeof rides.$inferSelect, pickupCounty: string | null) => void) | null = null;
export function setReleaseHook(fn: typeof releaseHook): void { releaseHook = fn; }

const parcelLabel = (size: string | null | undefined) => (size && isParcelSize(size) ? PARCEL_LABELS[size] : "Parcel");
const windowText = (job: { windowStart?: Date | null; windowEnd?: Date | null }) => job.windowStart && job.windowEnd ? describeWindow({ start: job.windowStart, end: job.windowEnd }) : null;
const jobLabel = (job: { jobNumber: number }) => formatJobNumber(job.jobNumber);

/** Every text to a recipient or a shop is logged verbatim, so it is auditable when Twilio is unreachable. */
async function text(to: string | null | undefined, body: string, context: string): Promise<boolean> {
  console.log(`[recipient-approval] ${context} → ${to ?? "no number"}: ${body}`);
  if (!to) return false;
  const r = await sendSms(to, body).catch(() => ({ sent: false as const, reason: "send_failed" as const }));
  if (!r.sent && r.reason !== "not_configured") console.log(`[recipient-approval] ${context}: not sent (${r.reason})`);
  return r.sent;
}

async function load(where: any): Promise<Row | null> {
  const [row] = await db.select({ job: commercialJobs, ride: rides, org: organizations }).from(commercialJobs)
    .innerJoin(rides, eq(rides.id, commercialJobs.rideId))
    .innerJoin(organizations, eq(organizations.id, commercialJobs.organizationId))
    .where(where);
  return row ?? null;
}
const byToken = (token: string) => (/^[0-9a-f]{48}$/.test(token) ? load(eq(commercialJobs.recipientApprovalToken, token)) : Promise.resolve(null));
const byJob = (orgId: string, jobId: string) => load(and(eq(commercialJobs.id, jobId), eq(commercialJobs.organizationId, orgId)));

export const approvalLink = (appUrl: string, token: string) => `${appUrl}/approve/${token}`;

/** Text the recipient the link. The hold itself was written with the parcel at booking (deliveries.ts). */
export async function startRecipientApproval(jobId: string, appUrl: string): Promise<{ token: string; link: string; textSent: boolean }> {
  const row = await load(eq(commercialJobs.id, jobId));
  if (!row) throw new CommercialError("Job not found.", 404);
  const phone = row.job.dropContact?.phone;
  if (!phone) throw new CommercialError("The recipient's phone number is needed to ask them: that is where the link goes.");
  let token = row.job.recipientApprovalToken;
  if (approvalOf(row.job.recipientApproval) !== "awaiting" || !token) {
    token = token ?? randomBytes(24).toString("hex");
    // Re-asked: the fee is what the shop is billed for the delivery, fare
    // plus the account's facility fee, as when the job was booked.
    const reFare = Number.parseFloat(String(row.ride.estimatedFare ?? "0"));
    const reFacility = Number.parseFloat(String(row.job.facilityFee ?? "0"));
    const reFee = Math.round(((Number.isFinite(reFare) ? reFare : 0) + (Number.isFinite(reFacility) ? Math.max(0, reFacility) : 0)) * 100) / 100;
    await db.update(commercialJobs).set({ recipientApproval: "awaiting", recipientApprovalToken: token, recipientFee: reFee.toFixed(2), recipientNudgedAt: null, shopAskedAt: null }).where(eq(commercialJobs.id, jobId));
  }
  const link = approvalLink(appUrl, token);
  const textSent = await text(phone, approvalText({ shopName: row.org.name, fee: row.job.recipientFee ?? row.ride.estimatedFare ?? 0, windowText: windowText(row.job), link }), `approval link for ${jobLabel(row.job)}`);
  return { token, link, textSent };
}

export interface ApprovalView {
  state: string; shopName: string; jobLabel: string; parcelLabel: string; fee: string; windowText: string | null;
  dropAddress: string | null; recipientName: string | null;
}

/** What the approval page shows. Public: the token is the capability. */
export async function approvalView(token: string): Promise<ApprovalView> {
  const row = await byToken(token);
  if (!row) throw new CommercialError("This link is not valid.", 404);
  return {
    state: approvalOf(row.job.recipientApproval), shopName: row.org.name, jobLabel: jobLabel(row.job),
    parcelLabel: parcelLabel(row.job.parcelSize), fee: Number(row.job.recipientFee ?? row.ride.estimatedFare ?? 0).toFixed(2),
    windowText: windowText(row.job), dropAddress: row.ride.destinationLocation?.address ?? null,
    recipientName: row.job.dropContact?.name ?? null,
  };
}

async function release(row: Row): Promise<void> {
  if (releaseHook) {
    try { releaseHook(row.ride, row.ride.pickupCounty ?? null); } catch (err) { console.error("[recipient-approval] release hook failed:", err); }
  }
}

/** The recipient says yes: the job opens to drivers, both sides are told. */
export async function approveByRecipient(token: string, now: Date = new Date()): Promise<{ state: string }> {
  const row = await byToken(token);
  if (!row) throw new CommercialError("This link is not valid.", 404);
  if (approvalOf(row.job.recipientApproval) === "approved") return { state: "approved" };
  if (!isOpenForAnswer(row.job) || row.ride.status !== "pending") throw new CommercialError("This delivery is no longer open.", 410);
  if (heldJobExpired(row.job, now)) throw new CommercialError("The delivery window has passed; ask the shop to book again.", 410);
  await db.update(commercialJobs).set({ recipientApproval: "approved", recipientApprovedAt: now }).where(eq(commercialJobs.id, row.job.id));
  console.log(`[recipient-approval] ${jobLabel(row.job)} approved by the recipient :: ${row.org.name}`);
  await release(row);
  await text(row.job.dropContact?.phone, recipientApprovedText({ shopName: row.org.name, jobLabel: jobLabel(row.job) }), `approved, to the recipient`);
  await text(row.org.contactPhone, shopApprovedText({ recipientName: row.job.dropContact?.name ?? "The recipient", jobLabel: jobLabel(row.job) }), `approved, to the shop`);
  opsAlert(formatOpsAlert("✅ Delivery fee approved by the recipient", [["Account", row.org.name], ["Job", jobLabel(row.job)], ["Fee", `$${Number(row.job.recipientFee ?? 0).toFixed(2)}`]]));
  return { state: "approved" };
}

/** The recipient says no: the shop is told and decides. */
export async function declineByRecipient(token: string): Promise<{ state: string }> {
  const row = await byToken(token);
  if (!row) throw new CommercialError("This link is not valid.", 404);
  if (approvalOf(row.job.recipientApproval) === "declined") return { state: "declined" };
  if (!isOpenForAnswer(row.job) || row.ride.status !== "pending") throw new CommercialError("This delivery is no longer open.", 410);
  await db.update(commercialJobs).set({ recipientApproval: "declined" }).where(eq(commercialJobs.id, row.job.id));
  console.log(`[recipient-approval] ${jobLabel(row.job)} declined by the recipient :: ${row.org.name}`);
  await text(row.org.contactPhone, shopDeclinedText({ recipientName: row.job.dropContact?.name ?? "The recipient", jobLabel: jobLabel(row.job) }), `declined, to the shop`);
  opsAlert(formatOpsAlert("🙅 Recipient declined a delivery fee", [["Account", row.org.name], ["Job", jobLabel(row.job)]]));
  return { state: "declined" };
}

/** The shop sends it anyway: the hold is lifted at once. */
export async function sendAnyway(orgId: string, jobId: string): Promise<{ state: string }> {
  const row = await byJob(orgId, jobId);
  if (!row) throw new CommercialError("Job not found.", 404);
  if (!isHeld(row.job)) return { state: approvalOf(row.job.recipientApproval) };
  if (row.ride.status !== "pending") throw new CommercialError("This job is no longer open.", 409);
  await db.update(commercialJobs).set({ recipientApproval: "none", recipientApprovalToken: null }).where(eq(commercialJobs.id, row.job.id));
  console.log(`[recipient-approval] ${jobLabel(row.job)} sent without the recipient's approval :: ${row.org.name}`);
  await release(row);
  return { state: "none" };
}

export async function resendApprovalLink(orgId: string, jobId: string, appUrl: string): Promise<{ link: string; textSent: boolean }> {
  const row = await byJob(orgId, jobId);
  if (!row || !row.job.recipientApprovalToken) throw new CommercialError("This job has no approval link.", 404);
  if (!isHeld(row.job) || row.ride.status !== "pending") throw new CommercialError("This job is not waiting for an answer.", 409);
  const link = approvalLink(appUrl, row.job.recipientApprovalToken);
  const textSent = await text(row.job.dropContact?.phone, approvalText({ shopName: row.org.name, fee: row.job.recipientFee ?? 0, windowText: windowText(row.job), link }), `approval link resent for ${jobLabel(row.job)}`);
  return { link, textSent };
}

/** Every way a commercial ride ends before delivery closes an open link, so nobody answers for a job that will not happen. */
export async function onCommercialRideEnded(rideId: string, reason: string): Promise<"closed" | "not_asked"> {
  const row = await load(eq(commercialJobs.rideId, rideId));
  if (!row || !isHeld(row.job)) return "not_asked";
  await db.update(commercialJobs).set({ recipientApproval: "cancelled" }).where(eq(commercialJobs.id, row.job.id));
  console.log(`[recipient-approval] ${jobLabel(row.job)} closed unanswered :: ${reason}`);
  return "closed";
}

/** Every minute: nudge the recipient once, ask the shop once the parcel is ready, give up when the window closes. */
export async function sweepRecipientApproval(now: Date = new Date(), appUrl: string = "https://nbhoodride-production.up.railway.app"): Promise<{ nudged: number; asked: number; expired: number }> {
  const out = { nudged: 0, asked: 0, expired: 0 };
  const rows = await db.select({ job: commercialJobs, ride: rides, org: organizations }).from(commercialJobs)
    .innerJoin(rides, eq(rides.id, commercialJobs.rideId))
    .innerJoin(organizations, eq(organizations.id, commercialJobs.organizationId))
    .where(and(inArray(commercialJobs.recipientApproval, ["awaiting", "declined"]), eq(rides.status, "pending"), isNull(rides.driverId)));
  for (const row of rows) {
    const label = jobLabel(row.job);
    try {
      if (heldJobExpired(row.job, now)) {
        const gone = await db.update(rides).set({ status: "cancelled", cancelledBy: "system", cancellationReason: "Delivery window closed before the recipient approved" } as any)
          .where(and(eq(rides.id, row.ride.id), eq(rides.status, "pending"), isNull(rides.driverId))).returning({ id: rides.id });
        if (gone.length === 0) continue;
        await db.update(commercialJobs).set({ recipientApproval: "expired" }).where(eq(commercialJobs.id, row.job.id));
        out.expired += 1;
        console.log(`[recipient-approval] ${label} expired unanswered :: ${row.org.name}`);
        await text(row.job.dropContact?.phone, recipientExpiredText({ shopName: row.org.name }), `expired, to the recipient`);
        await text(row.org.contactPhone, `PG Ride: delivery ${label} was not approved by its window and has been cancelled. Nothing is charged.`, `expired, to the shop`);
        continue;
      }
      if (recipientNudgeDue(row.job, now) && row.job.recipientApprovalToken) {
        await db.update(commercialJobs).set({ recipientNudgedAt: now }).where(eq(commercialJobs.id, row.job.id));
        await text(row.job.dropContact?.phone, nudgeText({ shopName: row.org.name, fee: row.job.recipientFee ?? 0, link: approvalLink(appUrl, row.job.recipientApprovalToken) }), `nudge for ${label}`);
        out.nudged += 1;
      }
      if (shopDecisionDue(row.job, now)) {
        await db.update(commercialJobs).set({ shopAskedAt: now }).where(eq(commercialJobs.id, row.job.id));
        await text(row.org.contactPhone, shopDecisionText({ recipientName: row.job.dropContact?.name ?? "the recipient", jobLabel: label }), `decision, to the shop`);
        opsAlert(formatOpsAlert("⏳ Delivery ready, recipient has not approved", [["Account", row.org.name], ["Job", label]]));
        out.asked += 1;
      }
    } catch (err) {
      console.error(`[recipient-approval] sweep failed for ${label}:`, err);
    }
  }
  return out;
}
