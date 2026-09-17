/**
 * Recipient pays — the server side (rules and words in shared/recipientPay.ts).
 *
 * A held job is booked like any other but not released: the claim board and
 * the ride-risk watch skip it (storage.notHeldForRecipientPay) until the
 * recipient has paid from the link they were texted. Payment is a Stripe
 * PaymentIntent keyed by the job, settled from the webhook or from the pay
 * page asking Stripe directly, so a late webhook cannot leave a paid job
 * held. A paid job that is cancelled, or that nobody takes by the end of
 * its window, is refunded automatically.
 */
import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { commercialJobs, organizations, rides } from "@shared/schema";
import { stripe } from "../stripeService";
import { sendSms } from "../smsService";
import { opsAlert, formatOpsAlert } from "../telegramOps";
import { formatJobNumber } from "@shared/commercial";
import { PARCEL_LABELS, describeWindow, isParcelSize } from "@shared/deliveries";
import {
  heldJobExpired, isHeld, paidByRecipient, recipientExpiredText, recipientNudgeDue, recipientNudgeText, recipientPaidText,
  recipientPayStateFromIntent, recipientPayText, recipientRefundedText, shopDecisionDue, shopDecisionText, shopDeclinedText, shopPaidText,
} from "@shared/recipientPay";
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
  console.log(`[recipient-pay] ${context} → ${to ?? "no number"}: ${body}`);
  if (!to) return false;
  const r = await sendSms(to, body).catch(() => ({ sent: false as const, reason: "send_failed" as const }));
  if (!r.sent && r.reason !== "not_configured") console.log(`[recipient-pay] ${context}: not sent (${r.reason})`);
  return r.sent;
}

async function load(where: any): Promise<Row | null> {
  const [row] = await db.select({ job: commercialJobs, ride: rides, org: organizations }).from(commercialJobs)
    .innerJoin(rides, eq(rides.id, commercialJobs.rideId))
    .innerJoin(organizations, eq(organizations.id, commercialJobs.organizationId))
    .where(where);
  return row ?? null;
}
const byToken = (token: string) => (/^[0-9a-f]{48}$/.test(token) ? load(eq(commercialJobs.recipientPayToken, token)) : Promise.resolve(null));
const byJob = (orgId: string, jobId: string) => load(and(eq(commercialJobs.id, jobId), eq(commercialJobs.organizationId, orgId)));

export const payLink = (appUrl: string, token: string) => `${appUrl}/pay/${token}`;

/** Hold a freshly booked job for the recipient's payment and text them the link. */
export async function startRecipientPay(jobId: string, appUrl: string, now: Date = new Date()): Promise<{ token: string; link: string; textSent: boolean }> {
  const row = await load(eq(commercialJobs.id, jobId));
  if (!row) throw new CommercialError("Job not found.", 404);
  const phone = row.job.dropContact?.phone;
  if (!phone) throw new CommercialError("The recipient's phone number is needed when they pay for the delivery.");
  const token = randomBytes(24).toString("hex");
  await db.update(commercialJobs).set({
    payer: "recipient", recipientPaymentStatus: "awaiting", recipientPayToken: token,
    recipientFee: String(row.ride.estimatedFare ?? "0"), recipientNudgedAt: null, shopAskedAt: null,
  }).where(eq(commercialJobs.id, jobId));
  const link = payLink(appUrl, token);
  const textSent = await text(phone, recipientPayText({ shopName: row.org.name, fee: row.ride.estimatedFare ?? 0, windowText: windowText(row.job), link }), `pay link for ${jobLabel(row.job)}`);
  return { token, link, textSent };
}

export interface RecipientPayView {
  state: string; shopName: string; jobLabel: string; parcelLabel: string; fee: string; windowText: string | null;
  dropAddress: string | null; recipientName: string | null; cardPayments: boolean; paymentIntentId: string | null;
}

/** What the pay page shows. Public: the token is the capability. */
export async function recipientView(token: string): Promise<RecipientPayView> {
  const row = await byToken(token);
  if (!row) throw new CommercialError("This link is not valid.", 404);
  return {
    state: row.job.recipientPaymentStatus ?? "awaiting", shopName: row.org.name, jobLabel: jobLabel(row.job),
    parcelLabel: parcelLabel(row.job.parcelSize), fee: Number(row.job.recipientFee ?? row.ride.estimatedFare ?? 0).toFixed(2),
    windowText: windowText(row.job), dropAddress: row.ride.destinationLocation?.address ?? null,
    recipientName: row.job.dropContact?.name ?? null, cardPayments: !!stripe, paymentIntentId: row.job.recipientPaymentIntentId ?? null,
  };
}

/** One PaymentIntent per job; asking again returns the same one while it is still payable. */
export async function createRecipientIntent(token: string): Promise<{ clientSecret: string; paymentIntentId: string; amount: number }> {
  const row = await byToken(token);
  if (!row) throw new CommercialError("This link is not valid.", 404);
  if (row.job.recipientPaymentStatus === "paid") throw new CommercialError("This delivery is already paid.", 409);
  if (row.job.recipientPaymentStatus !== "awaiting" && row.job.recipientPaymentStatus !== "declined") throw new CommercialError("This delivery can no longer be paid.", 410);
  if (heldJobExpired(row.job)) throw new CommercialError("The delivery window has passed; ask the shop to book again.", 410);
  if (!stripe) throw new CommercialError("Card payments are not available right now. Tell the shop, or try again shortly.", 503);
  const amount = Math.round(Number(row.job.recipientFee ?? row.ride.estimatedFare ?? 0) * 100);
  if (amount < 50) throw new CommercialError("This delivery fee is too small to charge a card.", 409);
  if (row.job.recipientPaymentIntentId && /^pi_/.test(row.job.recipientPaymentIntentId)) {
    const existing = await stripe.paymentIntents.retrieve(row.job.recipientPaymentIntentId).catch(() => null);
    if (existing && existing.client_secret && !["canceled", "succeeded"].includes(existing.status)) {
      return { clientSecret: existing.client_secret, paymentIntentId: existing.id, amount };
    }
  }
  let intent;
  try {
    intent = await stripe.paymentIntents.create({
      amount, currency: "usd",
      description: `PG Ride delivery ${jobLabel(row.job)} from ${row.org.name}`,
      metadata: { type: "recipient_delivery", recipientJobId: row.job.id, organizationId: row.org.id },
      automatic_payment_methods: { enabled: true },
    }, { idempotencyKey: `recipient-job-${row.job.id}-${Date.now()}` });
  } catch (err: any) {
    console.error(`[recipient-pay] Stripe could not start a payment for ${jobLabel(row.job)}:`, err?.message ?? err);
    throw new CommercialError("Card payments are not available right now. Tell the shop, or try again shortly.", 503);
  }
  await db.update(commercialJobs).set({ recipientPaymentIntentId: intent.id, recipientPaymentStatus: "awaiting" }).where(eq(commercialJobs.id, row.job.id));
  return { clientSecret: intent.client_secret!, paymentIntentId: intent.id, amount };
}

/** Bring a job into line with what Stripe says about its intent. Idempotent. */
export async function settleRecipientFromIntent(intent: { id: string; status: string; metadata?: Record<string, string> | null }, now: Date = new Date()): Promise<"paid" | "failed" | "unchanged" | null> {
  const jobId = intent.metadata?.recipientJobId;
  if (!jobId) return null;
  const row = await load(eq(commercialJobs.id, jobId));
  if (!row) return null;
  if (row.job.recipientPaymentIntentId && row.job.recipientPaymentIntentId !== intent.id) return null;
  const next = recipientPayStateFromIntent(intent.status);
  if (!next) return null;
  if (paidByRecipient(row.job)) return "unchanged";
  if (next === "failed") { console.log(`[recipient-pay] ${jobLabel(row.job)}: card ${intent.status}; still awaiting`); return "failed"; }
  await db.update(commercialJobs).set({ recipientPaymentStatus: "paid", recipientPaidAt: now, recipientPaymentIntentId: intent.id }).where(eq(commercialJobs.id, row.job.id));
  console.log(`[recipient-pay] ${jobLabel(row.job)} paid by the recipient :: ${row.org.name} | $${Number(row.job.recipientFee ?? 0).toFixed(2)} | ${intent.id}`);
  await release(row);
  await text(row.job.dropContact?.phone, recipientPaidText({ shopName: row.org.name, jobLabel: jobLabel(row.job) }), `paid, to the recipient`);
  await text(row.org.contactPhone, shopPaidText({ recipientName: row.job.dropContact?.name ?? "The recipient", jobLabel: jobLabel(row.job), fee: row.job.recipientFee ?? 0 }), `paid, to the shop`);
  opsAlert(formatOpsAlert("💳 Delivery paid by the recipient", [["Account", row.org.name], ["Job", jobLabel(row.job)], ["Fee", `$${Number(row.job.recipientFee ?? 0).toFixed(2)}`]]));
  return "paid";
}

/** The pay page asks Stripe directly, so a late webhook cannot leave a paid job held. */
export async function confirmRecipientPayment(token: string, paymentIntentId: string): Promise<{ state: string }> {
  const row = await byToken(token);
  if (!row) throw new CommercialError("This link is not valid.", 404);
  if (paidByRecipient(row.job)) return { state: "paid" };
  if (!stripe) throw new CommercialError("Card payments are not available right now.", 503);
  if (!/^pi_[A-Za-z0-9]+$/.test(String(paymentIntentId))) throw new CommercialError("That is not a payment.");
  const intent = await stripe.paymentIntents.retrieve(String(paymentIntentId));
  if (intent.metadata?.recipientJobId !== row.job.id) throw new CommercialError("That payment is not for this delivery.", 403);
  await settleRecipientFromIntent(intent);
  const after = await byToken(token);
  return { state: after?.job.recipientPaymentStatus ?? "awaiting" };
}

async function release(row: Row): Promise<void> {
  if (releaseHook) {
    try { releaseHook(row.ride, row.ride.pickupCounty ?? null); } catch (err) { console.error("[recipient-pay] release hook failed:", err); }
  }
}

/** The recipient says no: the shop is told and decides. */
export async function declineRecipientPay(token: string, now: Date = new Date()): Promise<{ state: string }> {
  const row = await byToken(token);
  if (!row) throw new CommercialError("This link is not valid.", 404);
  if (paidByRecipient(row.job)) throw new CommercialError("This delivery is already paid.", 409);
  if (row.job.recipientPaymentStatus === "declined") return { state: "declined" };
  await db.update(commercialJobs).set({ recipientPaymentStatus: "declined" }).where(eq(commercialJobs.id, row.job.id));
  console.log(`[recipient-pay] ${jobLabel(row.job)} declined by the recipient :: ${row.org.name}`);
  await text(row.org.contactPhone, shopDeclinedText({ recipientName: row.job.dropContact?.name ?? "The recipient", jobLabel: jobLabel(row.job) }), `declined, to the shop`);
  opsAlert(formatOpsAlert("🙅 Recipient declined a delivery fee", [["Account", row.org.name], ["Job", jobLabel(row.job)]]));
  return { state: "declined" };
}

/** The shop takes the fee on its own account: the job is released at once. */
export async function switchPayerToOrganization(orgId: string, jobId: string): Promise<{ payer: string }> {
  const row = await byJob(orgId, jobId);
  if (!row) throw new CommercialError("Job not found.", 404);
  if (paidByRecipient(row.job)) throw new CommercialError("The recipient already paid this one.", 409);
  if (!isHeld(row.job)) return { payer: "organization" };
  if (row.ride.status !== "pending") throw new CommercialError("This job is no longer open.", 409);
  await db.update(commercialJobs).set({ payer: "organization", recipientPaymentStatus: null, recipientPayToken: null, recipientFee: null }).where(eq(commercialJobs.id, row.job.id));
  console.log(`[recipient-pay] ${jobLabel(row.job)} now billed to the account :: ${row.org.name}`);
  await release(row);
  return { payer: "organization" };
}

export async function resendPayLink(orgId: string, jobId: string, appUrl: string): Promise<{ link: string; textSent: boolean }> {
  const row = await byJob(orgId, jobId);
  if (!row || !row.job.recipientPayToken) throw new CommercialError("This job has no pay link.", 404);
  if (!isHeld(row.job)) throw new CommercialError("This job is not waiting for payment.", 409);
  const link = payLink(appUrl, row.job.recipientPayToken);
  const textSent = await text(row.job.dropContact?.phone, recipientPayText({ shopName: row.org.name, fee: row.job.recipientFee ?? 0, windowText: windowText(row.job), link }), `pay link resent for ${jobLabel(row.job)}`);
  return { link, textSent };
}

/** Give the recipient their money back; if Stripe is unreachable, ops is paged and the job says so. */
export async function refundRecipientIfPaid(jobId: string, reason: string): Promise<"refunded" | "refund_pending" | "not_paid"> {
  const row = await load(eq(commercialJobs.id, jobId));
  if (!row || !paidByRecipient(row.job)) return "not_paid";
  const fields: Array<[string, string]> = [["Account", row.org.name], ["Job", jobLabel(row.job)], ["Fee", `$${Number(row.job.recipientFee ?? 0).toFixed(2)}`], ["Why", reason]];
  if (stripe && row.job.recipientPaymentIntentId) {
    try {
      await stripe.refunds.create({ payment_intent: row.job.recipientPaymentIntentId }, { idempotencyKey: `recipient-refund-${row.job.id}` });
      await db.update(commercialJobs).set({ recipientPaymentStatus: "refunded" }).where(eq(commercialJobs.id, row.job.id));
      console.log(`[recipient-pay] ${jobLabel(row.job)} refunded to the recipient :: ${reason}`);
      await text(row.job.dropContact?.phone, recipientRefundedText({ shopName: row.org.name, fee: row.job.recipientFee ?? 0 }), `refund, to the recipient`);
      opsAlert(formatOpsAlert("↩️ Delivery fee refunded to the recipient", fields));
      return "refunded";
    } catch (err: any) {
      console.error(`[recipient-pay] refund failed for ${jobLabel(row.job)}:`, err?.message ?? err);
    }
  }
  await db.update(commercialJobs).set({ recipientPaymentStatus: "refund_pending" }).where(eq(commercialJobs.id, row.job.id));
  opsAlert(formatOpsAlert("⚠️ Refund to a recipient needs a hand", [...fields, ["Do", "Refund the PaymentIntent in Stripe, then mark the job refunded"]]));
  return "refund_pending";
}

/** Every minute: nudge the recipient once, ask the shop once the parcel is ready, give up when the window closes. */
export async function sweepRecipientPay(now: Date = new Date(), appUrl: string = "https://nbhoodride-production.up.railway.app"): Promise<{ nudged: number; asked: number; expired: number; refunded: number }> {
  const out = { nudged: 0, asked: 0, expired: 0, refunded: 0 };
  const rows = await db.select({ job: commercialJobs, ride: rides, org: organizations }).from(commercialJobs)
    .innerJoin(rides, eq(rides.id, commercialJobs.rideId))
    .innerJoin(organizations, eq(organizations.id, commercialJobs.organizationId))
    .where(and(eq(commercialJobs.payer, "recipient"), eq(rides.status, "pending"), isNull(rides.driverId)));
  for (const row of rows) {
    const label = jobLabel(row.job);
    try {
      if (heldJobExpired(row.job, now)) {
        await db.transaction(async (tx) => {
          await tx.update(rides).set({ status: "cancelled", cancelledBy: "system", cancellationReason: "Delivery window closed before the recipient paid"} as any).where(eq(rides.id, row.ride.id));
          await tx.update(commercialJobs).set({ recipientPaymentStatus: "expired" }).where(eq(commercialJobs.id, row.job.id));
        });
        out.expired += 1;
        console.log(`[recipient-pay] ${label} expired unpaid :: ${row.org.name}`);
        await text(row.job.dropContact?.phone, recipientExpiredText({ shopName: row.org.name }), `expired, to the recipient`);
        await text(row.org.contactPhone, `PG Ride: delivery ${label} was not paid by its window and has been cancelled. Nothing is charged.`, `expired, to the shop`);
        continue;
      }
      if (paidByRecipient(row.job) && row.job.windowEnd && new Date(row.job.windowEnd).getTime() <= now.getTime()) {
        // Paid, and nobody ever took it: the money goes back.
        await db.update(rides).set({ status: "cancelled", cancelledBy: "system", cancellationReason: "No driver took the delivery by the end of its window"} as any).where(eq(rides.id, row.ride.id));
        if ((await refundRecipientIfPaid(row.job.id, "no driver took it by the end of the window")) === "refunded") out.refunded += 1;
        continue;
      }
      if (recipientNudgeDue(row.job, now) && row.job.recipientPayToken) {
        await db.update(commercialJobs).set({ recipientNudgedAt: now }).where(eq(commercialJobs.id, row.job.id));
        await text(row.job.dropContact?.phone, recipientNudgeText({ shopName: row.org.name, fee: row.job.recipientFee ?? 0, link: payLink(appUrl, row.job.recipientPayToken) }), `nudge for ${label}`);
        out.nudged += 1;
      }
      if (shopDecisionDue(row.job, now)) {
        await db.update(commercialJobs).set({ shopAskedAt: now }).where(eq(commercialJobs.id, row.job.id));
        await text(row.org.contactPhone, shopDecisionText({ recipientName: row.job.dropContact?.name ?? "the recipient", jobLabel: label }), `decision, to the shop`);
        opsAlert(formatOpsAlert("⏳ Delivery ready, recipient has not paid", [["Account", row.org.name], ["Job", label]]));
        out.asked += 1;
      }
    } catch (err) {
      console.error(`[recipient-pay] sweep failed for ${label}:`, err);
    }
  }
  return out;
}
