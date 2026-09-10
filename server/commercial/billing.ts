/**
 * Weekly billing — issuing a week's statement and collecting it.
 *
 * Two steps, deliberately separate:
 *
 *   issue   price the finished week, write a statement, and stamp every job
 *           in it with the statement id so a job is billed exactly once. A
 *           unique index on (organization, week) makes re-issuing a no-op,
 *           so the Monday run can be re-run safely.
 *   collect take the money off-session from the bank account (or card) the
 *           desk attached. A failure is recorded on the statement with its
 *           reason, paged to ops, and can be retried; it never silently
 *           re-bills the jobs, because they already belong to a statement.
 *
 * Organizations on net terms are issued statements and never charged
 * automatically (shared/billingCycle.ts).
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { commercialJobs, commercialStatements, organizations, rides, type CommercialStatement } from "@shared/schema";
import { autoCharges, billingWeekWindow, previousBillingWeek, weekCharge, type BillingWeek } from "@shared/billingCycle";
import type { StatementLine } from "@shared/commercial";
import { stripe } from "../stripeService";
import { opsAlert, formatOpsAlert } from "../telegramOps";
import { CommercialError, getOrganization } from "./organizations";

const BILLABLE = ["completed", "cancelled", "no_show"] as const;

/**
 * A Stripe connection or credential failure is an outage, not a bug in the
 * request: the desk is told to try again, not shown a server error. Same
 * rule as the rider's card form and the admin's AI tools.
 */
export const STRIPE_UNAVAILABLE_MESSAGE =
  "We can't reach our payment provider right now. Try again in a few minutes; nothing has been charged.";

function stripeUnavailable(error: unknown): boolean {
  const name = (error as any)?.type ?? (error as any)?.constructor?.name ?? "";
  const msg = String((error as any)?.message ?? error);
  return /StripeConnectionError|StripeAPIError|StripeAuthenticationError|StripePermissionError|api_connection_error|api_error|authentication_error/i.test(String(name))
    || /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|socket hang up|Invalid API Key|api\.stripe\.com/i.test(msg);
}

/** Run a Stripe call, turning an outage into a 503 the desk can act on. */
async function throughStripe<T>(what: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (stripeUnavailable(err)) {
      console.error(`[commercial] stripe unavailable during ${what}:`, (err as any)?.message ?? err);
      throw new CommercialError(STRIPE_UNAVAILABLE_MESSAGE, 503);
    }
    throw err;
  }
}

export interface IssueResult {
  statement: CommercialStatement | null;
  created: boolean;
  reason: string;
}

/**
 * Price a finished week and write its statement. Jobs already carrying a
 * statement id are left alone, so a week issued twice charges once.
 */
export async function issueStatement(organizationId: string, weekKey: string): Promise<IssueResult> {
  const org = await getOrganization(organizationId);
  if (!org) throw new CommercialError("Organization not found.", 404);
  let window: BillingWeek;
  try { window = billingWeekWindow(weekKey); } catch (e) { throw new CommercialError((e as Error).message); }

  const [existing] = await db.select().from(commercialStatements)
    .where(and(eq(commercialStatements.organizationId, organizationId), eq(commercialStatements.periodKey, weekKey)));
  if (existing) return { statement: existing, created: false, reason: "Already issued" };

  const rows = await db
    .select({ job: commercialJobs, ride: rides })
    .from(commercialJobs)
    .innerJoin(rides, eq(rides.id, commercialJobs.rideId))
    .where(and(
      eq(commercialJobs.organizationId, organizationId),
      sql`${commercialJobs.statementId} IS NULL`,
      inArray(rides.status, [...BILLABLE]),
      sql`COALESCE(${rides.scheduledAt}, ${rides.createdAt}) >= ${window.start}`,
      sql`COALESCE(${rides.scheduledAt}, ${rides.createdAt}) < ${window.end}`,
    ));

  const lines: StatementLine[] = rows.map(({ job, ride }) => ({
    jobNumber: job.jobNumber,
    at: new Date(ride.scheduledAt ?? ride.createdAt ?? window.start).toISOString(),
    passenger: ride.passengerName ?? "",
    from: ride.pickupLocation?.address ?? "",
    to: ride.destinationLocation?.address ?? "",
    status: ride.status ?? "completed",
    fare: ride.actualFare ?? ride.estimatedFare,
    facilityFee: job.facilityFee,
    waitFee: job.waitFee,
    cancellationFee: Number(job.cancellationFee) > 0 ? job.cancellationFee : (ride.cancellationFee ?? "0.00"),
    receivedBy: (job.proof as any)?.receivedBy ?? null,
  }));
  const charge = weekCharge(lines);
  if (!charge.chargeable) return { statement: null, created: false, reason: charge.reason };

  const [statement] = await db.insert(commercialStatements).values({
    organizationId,
    periodKey: window.weekKey,
    periodLabel: window.label,
    periodStart: window.start,
    periodEnd: window.end,
    jobCount: lines.length,
    total: charge.amount.toFixed(2),
    status: "open",
  }).returning();

  await db.update(commercialJobs)
    .set({ statementId: statement.id, billedStatus: "statement" })
    .where(inArray(commercialJobs.id, rows.map(({ job }) => job.id)));

  console.log(`[commercial] statement issued :: ${org.name} | ${window.label} | ${lines.length} job${lines.length === 1 ? "" : "s"} | $${charge.amount.toFixed(2)}`);
  return { statement, created: true, reason: charge.reason };
}

export interface ChargeResult {
  statement: CommercialStatement;
  charged: boolean;
  reason: string;
}

/** Take the money for an issued statement, off-session, once. */
export async function chargeStatement(statementId: string, now: Date = new Date()): Promise<ChargeResult> {
  const [row] = await db.select({ statement: commercialStatements, org: organizations })
    .from(commercialStatements)
    .innerJoin(organizations, eq(organizations.id, commercialStatements.organizationId))
    .where(eq(commercialStatements.id, statementId));
  if (!row) throw new CommercialError("Statement not found.", 404);
  const { statement, org } = row;
  if (statement.status === "paid") return { statement, charged: false, reason: "Already paid" };
  if (statement.status === "void") return { statement, charged: false, reason: "Voided" };

  const fail = async (reason: string, page = true): Promise<ChargeResult> => {
    const [updated] = await db.update(commercialStatements)
      .set({ status: "failed", attempts: statement.attempts + 1, lastError: reason.slice(0, 500) })
      .where(eq(commercialStatements.id, statementId)).returning();
    console.error(`[commercial] statement charge failed :: ${org.name} | ${statement.periodLabel} | $${statement.total} :: ${reason}`);
    if (page) {
      opsAlert(formatOpsAlert("💳 Commercial statement could not be collected", [
        ["Account", org.name], ["Week", statement.periodLabel], ["Amount", `$${Number(statement.total).toFixed(2)}`],
        ["Reason", reason.slice(0, 200)], ["Attempts", updated.attempts],
      ]));
    }
    return { statement: updated, charged: false, reason };
  };

  if (!stripe) return fail("Stripe is not configured on this deployment", false);
  if (!org.stripeCustomerId || !org.defaultPaymentMethodId) {
    return fail(`${org.name} has no bank account or card on file. The desk adds one in the portal under Billing.`);
  }

  await db.update(commercialStatements).set({ status: "charging" }).where(eq(commercialStatements.id, statementId));
  try {
    const intent = await stripe.paymentIntents.create({
      amount: Math.round(Number(statement.total) * 100),
      currency: "usd",
      customer: org.stripeCustomerId,
      payment_method: org.defaultPaymentMethodId,
      off_session: true,
      confirm: true,
      description: `PG Ride — ${org.name} — ${statement.periodLabel}`,
      metadata: { organizationId: org.id, statementId: statement.id, periodKey: statement.periodKey },
    }, { idempotencyKey: `commercial-statement-${statement.id}` });

    // A bank debit settles over days: "processing" is a success here, and the
    // webhook marks it paid when the money actually lands.
    const settled = intent.status === "succeeded";
    const [updated] = await db.update(commercialStatements).set({
      status: settled ? "paid" : "charging",
      stripePaymentIntentId: intent.id,
      attempts: statement.attempts + 1,
      paidAt: settled ? now : null,
      lastError: null,
    }).where(eq(commercialStatements.id, statementId)).returning();
    if (settled) {
      await db.update(commercialJobs).set({ billedStatus: "paid" }).where(eq(commercialJobs.statementId, statement.id));
    }
    console.log(`[commercial] statement charged :: ${org.name} | ${statement.periodLabel} | $${statement.total} | ${intent.status}`);
    return { statement: updated, charged: settled, reason: settled ? "Paid" : `Bank debit ${intent.status}` };
  } catch (err: any) {
    return fail(String(err?.message ?? err));
  }
}

export interface WeeklyRunResult {
  weekKey: string;
  issued: number;
  charged: number;
  failed: number;
  skipped: Array<{ organization: string; reason: string }>;
}

/** The Monday run: issue last week for every active organization, then collect. */
export async function runWeeklyBilling(now: Date = new Date(), weekKey?: string): Promise<WeeklyRunResult> {
  const window = weekKey ? billingWeekWindow(weekKey) : previousBillingWeek(now);
  const orgs = await db.select().from(organizations).where(eq(organizations.status, "active"));
  const out: WeeklyRunResult = { weekKey: window.weekKey, issued: 0, charged: 0, failed: 0, skipped: [] };
  for (const org of orgs) {
    try {
      const issued = await issueStatement(org.id, window.weekKey);
      if (issued.created) out.issued += 1;
      if (!issued.statement) { out.skipped.push({ organization: org.name, reason: issued.reason }); continue; }
      if (!autoCharges(org.billingMode)) { out.skipped.push({ organization: org.name, reason: "On net terms; statement issued, not charged" }); continue; }
      if (issued.statement.status === "paid") { out.skipped.push({ organization: org.name, reason: "Already paid" }); continue; }
      const charged = await chargeStatement(issued.statement.id, now);
      if (charged.charged) out.charged += 1;
      else if (charged.statement.status === "failed") out.failed += 1;
    } catch (err: any) {
      out.failed += 1;
      out.skipped.push({ organization: org.name, reason: String(err?.message ?? err).slice(0, 200) });
      console.error(`[commercial] weekly billing failed for ${org.name}:`, err?.message ?? err);
    }
  }
  console.log(`[commercial] weekly billing :: ${window.label} | issued ${out.issued} | charged ${out.charged} | failed ${out.failed}`);
  return out;
}

export async function listStatements(organizationId: string, limit = 26): Promise<CommercialStatement[]> {
  return db.select().from(commercialStatements)
    .where(eq(commercialStatements.organizationId, organizationId))
    .orderBy(desc(commercialStatements.periodKey))
    .limit(Math.min(Math.max(limit, 1), 200));
}

/**
 * A Stripe SetupIntent so the desk can attach a bank account (preferred) or
 * a card. Returns the client secret the portal hands to Stripe.js.
 */
export async function startPaymentMethodSetup(organizationId: string): Promise<{ clientSecret: string; customerId: string }> {
  if (!stripe) throw new CommercialError("Card and bank payments are not configured on this deployment.", 503);
  const org = await getOrganization(organizationId);
  if (!org) throw new CommercialError("Organization not found.", 404);
  let customerId = org.stripeCustomerId;
  if (!customerId) {
    const customer = await throughStripe("customer create", () => stripe!.customers.create({
      name: org.name,
      email: org.contactEmail ?? undefined,
      metadata: { organizationId: org.id },
    }));
    customerId = customer.id;
    await db.update(organizations).set({ stripeCustomerId: customerId, updatedAt: new Date() }).where(eq(organizations.id, org.id));
  }
  const intent = await throughStripe("setup intent", () => stripe!.setupIntents.create({
    customer: customerId!,
    payment_method_types: ["us_bank_account", "card"],
    usage: "off_session",
    metadata: { organizationId: org.id },
  }));
  if (!intent.client_secret) throw new CommercialError("Stripe did not return a setup secret.", 502);
  return { clientSecret: intent.client_secret, customerId };
}

/** Record what the desk attached, so the weekly debit knows where to look. */
export async function savePaymentMethod(organizationId: string, paymentMethodId: string): Promise<{ kind: string }> {
  if (!stripe) throw new CommercialError("Card and bank payments are not configured on this deployment.", 503);
  const org = await getOrganization(organizationId);
  if (!org?.stripeCustomerId) throw new CommercialError("Start the setup first.", 409);
  const pm = await throughStripe("payment method retrieve", () => stripe!.paymentMethods.retrieve(paymentMethodId));
  if ((pm as any).customer && (pm as any).customer !== org.stripeCustomerId) {
    throw new CommercialError("That payment method belongs to another account.", 403);
  }
  await throughStripe("customer update", () => stripe!.customers.update(org.stripeCustomerId!, { invoice_settings: { default_payment_method: paymentMethodId } }));
  await db.update(organizations)
    .set({ defaultPaymentMethodId: paymentMethodId, defaultPaymentMethodKind: pm.type, updatedAt: new Date() })
    .where(eq(organizations.id, organizationId));
  console.log(`[commercial] payment method saved :: ${org.name} | ${pm.type}`);
  return { kind: pm.type };
}

/** What the desk is shown about how the account pays. */
export function describePaymentMethod(org: { defaultPaymentMethodKind?: string | null; billingMode?: string | null }): string {
  if (!org.defaultPaymentMethodKind) return "No bank account or card on file yet.";
  const kind = org.defaultPaymentMethodKind === "us_bank_account" ? "bank account" : "card";
  return autoCharges(org.billingMode)
    ? `Last week's jobs are debited from your ${kind} every Monday morning.`
    : `A ${kind} is on file. This account is on terms, so nothing is taken automatically.`;
}
