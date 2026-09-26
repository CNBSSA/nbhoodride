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
import { autoCharges, billingWeekWindow, chargeAttemptKey, previousBillingWeek, settlementDecision, weekCharge, type BillingWeek } from "@shared/billingCycle";
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
 *
 * The whole of it happens in one transaction with the jobs locked
 * (corporate audit, #381): the jobs are selected FOR UPDATE, so two issuers
 * running at once — the Monday sweep and an operator's button, or two weeks
 * both entitled to a late job — cannot both take the same job; the loser's
 * select waits, then no longer sees a job the winner stamped. The stamp
 * itself carries the ownership predicate (`statement_id IS NULL`), and the
 * statement is written only if every job it priced was stamped by it, so
 * its count and total can never disagree with the jobs attached to it.
 */
export async function issueStatement(organizationId: string, weekKey: string): Promise<IssueResult> {
  const org = await getOrganization(organizationId);
  if (!org) throw new CommercialError("Organization not found.", 404);
  let window: BillingWeek;
  try { window = billingWeekWindow(weekKey); } catch (e) { throw new CommercialError((e as Error).message); }

  const outcome = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(commercialStatements)
      .where(and(eq(commercialStatements.organizationId, organizationId), eq(commercialStatements.periodKey, weekKey)));
    if (existing) return { statement: existing, created: false, reason: "Already issued" } as IssueResult;

    const rows = await tx
      .select({ job: commercialJobs, ride: rides })
      .from(commercialJobs)
      .innerJoin(rides, eq(rides.id, commercialJobs.rideId))
      .where(and(
        eq(commercialJobs.organizationId, organizationId),
        sql`${commercialJobs.statementId} IS NULL`,
        inArray(rides.status, [...BILLABLE]),
        // This week's jobs — AND anything billable from an earlier week that
        // no statement ever picked up. A job completed on Tuesday for last
        // week's date arrives after last week's statement was issued, and a
        // week is issued exactly once; without this it was never billed at
        // all (daily audit, #381). Late jobs roll onto the next statement,
        // dated as they were.
        sql`COALESCE(${rides.scheduledAt}, ${rides.createdAt}) < ${window.end}`,
      ))
      // Ours until this transaction ends: a concurrent issuer blocks here and
      // then re-reads the rows, minus the ones we stamped.
      .for("update", { of: commercialJobs });

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
    if (!charge.chargeable) return { statement: null, created: false, reason: charge.reason } as IssueResult;

    const [created] = await tx.insert(commercialStatements).values({
      organizationId,
      periodKey: window.weekKey,
      periodLabel: window.label,
      periodStart: window.start,
      periodEnd: window.end,
      jobCount: lines.length,
      total: charge.amount.toFixed(2),
      status: "open",
    }).returning();
    const stamped = await tx.update(commercialJobs)
      .set({ statementId: created.id, billedStatus: "statement" })
      .where(and(
        inArray(commercialJobs.id, rows.map(({ job }) => job.id)),
        sql`${commercialJobs.statementId} IS NULL`,
      ))
      .returning({ id: commercialJobs.id });
    // Every job priced into the total must be the statement's, or the total
    // is a lie. Under the lock this cannot happen; if it ever does, nothing
    // is written rather than something wrong.
    if (stamped.length !== rows.length) {
      throw new CommercialError(`Statement not issued: priced ${rows.length} jobs but could only attach ${stamped.length}. Nothing was written; try again.`, 409);
    }
    return { statement: created, created: true, reason: charge.reason } as IssueResult;
  });

  if (outcome.created && outcome.statement) {
    console.log(`[commercial] statement issued :: ${org.name} | ${window.label} | ${outcome.statement.jobCount} job${outcome.statement.jobCount === 1 ? "" : "s"} | $${outcome.statement.total}`);
  }
  return outcome;
}

export interface ChargeResult {
  statement: CommercialStatement;
  charged: boolean;
  reason: string;
}

/**
 * Is a Stripe error a verdict, or a shrug?
 *
 * A card error or an invalid request is Stripe saying no: the attempt has
 * failed and the next one may be a new one. A connection error or a timeout
 * is Stripe not answering: the request may or may not have gone through,
 * so the attempt is NOT over — the statement stays charging with its
 * attempt number, and the next try repeats the same request under the same
 * idempotency key, which Stripe replays rather than duplicates.
 */
function stripeSaidNo(err: any): boolean {
  const type = String(err?.type ?? "");
  return type === "StripeCardError" || type === "StripeInvalidRequestError" || type === "StripeAuthenticationError" || type === "StripePermissionError";
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
  // An account on terms pays outside PG Ride; its statement is never debited
  // here, by hand any more than by the weekly run (rates audit, 2026-09-18).
  // Change the account's billing mode first if it should be charged.
  if (!autoCharges(org.billingMode)) return { statement, charged: false, reason: "On net terms; this account is not charged by PG Ride. Change its billing mode to charge it." };

  // A statement left "charging" has a debit in flight. Charging it again
  // would raise a second PaymentIntent (corporate audit, #382). So ask Stripe
  // what became of the one we have, and only ever go again once it has
  // failed. A charging statement with NO intent recorded is an attempt whose
  // answer never came back; it is repeated below under the same key.
  if (statement.status === "charging" && statement.stripePaymentIntentId) {
    if (!stripe) return { statement, charged: false, reason: "Bank debit in flight; Stripe is not configured here to check it" };
    try {
      const intent = await stripe.paymentIntents.retrieve(statement.stripePaymentIntentId);
      const reconciled = await settleStatementFromIntent({ ...intent, metadata: { ...(intent.metadata ?? {}), statementId } }, now);
      if (reconciled) return reconciled;
      return { statement, charged: false, reason: `Bank debit ${intent.status}; nothing to do yet` };
    } catch (err: any) {
      return { statement, charged: false, reason: `Could not check the debit in flight: ${String(err?.message ?? err).slice(0, 160)}` };
    }
  }

  // A failure is recorded against the attempt it belongs to. One refused
  // before Stripe was called (nothing on file, Stripe not configured) is
  // still an attempt the operator made and sees counted; one Stripe decided
  // against already carries its attempt number from above.
  const fail = async (reason: string, page = true, countsAsAttempt = false): Promise<ChargeResult> => {
    const [updated] = await db.update(commercialStatements)
      .set({ status: "failed", lastError: reason.slice(0, 500), ...(countsAsAttempt ? { attempts: statement.attempts + 1 } : {}) })
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

  if (!stripe) return fail("Stripe is not configured on this deployment", false, true);
  if (!org.stripeCustomerId || !org.defaultPaymentMethodId) {
    return fail(`${org.name} has no bank account or card on file. The desk adds one in the portal under Billing.`, true, true);
  }

  // Which attempt this is decides the idempotency key, so it is fixed and
  // stored BEFORE Stripe is called: an attempt that is still unanswered
  // (charging, no intent id) is repeated under its own key; a new attempt
  // after a recorded failure gets a new one.
  const resumingUnanswered = statement.status === "charging" && !statement.stripePaymentIntentId && statement.attempts > 0;
  const attempt = resumingUnanswered ? statement.attempts : statement.attempts + 1;
  await db.update(commercialStatements)
    .set({ status: "charging", attempts: attempt, lastError: null })
    .where(eq(commercialStatements.id, statementId));
  try {
    const intent = await stripe.paymentIntents.create({
      amount: Math.round(Number(statement.total) * 100),
      currency: "usd",
      customer: org.stripeCustomerId,
      payment_method: org.defaultPaymentMethodId,
      off_session: true,
      confirm: true,
      description: `PG Ride — ${org.name} — ${statement.periodLabel}`,
      metadata: { organizationId: org.id, statementId: statement.id, periodKey: statement.periodKey, attempt: String(attempt) },
    }, { idempotencyKey: chargeAttemptKey(statement.id, attempt) });

    // A bank debit settles over days: "processing" is a success here, and the
    // webhook marks it paid when the money actually lands. Anything Stripe
    // has already decided against is a failure now, not a debit in flight.
    const decision = settlementDecision({ status: "charging", stripePaymentIntentId: null }, intent);
    if (decision.action === "failed") {
      await db.update(commercialStatements).set({ stripePaymentIntentId: intent.id }).where(eq(commercialStatements.id, statementId));
      return fail(`${intent.last_payment_error?.message ?? decision.reason}`);
    }
    const settled = decision.action === "paid";
    const [updated] = await db.update(commercialStatements).set({
      status: settled ? "paid" : "charging",
      stripePaymentIntentId: intent.id,
      paidAt: settled ? now : null,
      lastError: null,
    }).where(eq(commercialStatements.id, statementId)).returning();
    if (settled) {
      await db.update(commercialJobs).set({ billedStatus: "paid" }).where(eq(commercialJobs.statementId, statement.id));
    }
    console.log(`[commercial] statement charged :: ${org.name} | ${statement.periodLabel} | $${statement.total} | attempt ${attempt} | ${intent.status}`);
    return { statement: updated, charged: settled, reason: settled ? "Paid" : `Bank debit ${intent.status}` };
  } catch (err: any) {
    if (stripeSaidNo(err)) return fail(String(err?.message ?? err));
    // No verdict: the request may have gone through. Leave the statement
    // charging on this attempt so the next try repeats it under the same key
    // rather than raising a second debit; say so, and page.
    const reason = `No answer from Stripe (${String(err?.type ?? err?.code ?? "network")}): ${String(err?.message ?? err).slice(0, 160)}. Attempt ${attempt} left open; retrying repeats it, never a second debit.`;
    const [left] = await db.update(commercialStatements).set({ lastError: reason.slice(0, 500) }).where(eq(commercialStatements.id, statementId)).returning();
    console.error(`[commercial] statement charge unanswered :: ${org.name} | ${statement.periodLabel} :: ${reason}`);
    opsAlert(formatOpsAlert("💳 Commercial statement charge unanswered", [["Account", org.name], ["Week", statement.periodLabel], ["Amount", `$${Number(statement.total).toFixed(2)}`], ["Attempt", attempt], ["Reason", reason.slice(0, 200)], ["Next", "Retry from Admin; it repeats this attempt under the same key"]]));
    return { statement: left, charged: false, reason };
  }
}

/**
 * Bring a statement into line with what Stripe says about its debit. Used by
 * the webhook (succeeded / failed / canceled events carry the statement id
 * in metadata) and by chargeStatement when asked to charge a statement whose
 * debit is still in flight. Returns null when nothing moved: the intent is
 * still undecided, or it is not the statement's current attempt and so is
 * not believed (shared/billingCycle.ts settlementDecision, corporate audit
 * #382). Idempotent: a settled statement is not moved again.
 */
export async function settleStatementFromIntent(intent: { id: string; status: string; metadata?: Record<string, string> | null; last_payment_error?: { message?: string } | null }, now: Date = new Date()): Promise<ChargeResult | null> {
  const statementId = intent.metadata?.statementId;
  if (!statementId) return null;
  const [statement] = await db.select().from(commercialStatements).where(eq(commercialStatements.id, statementId));
  if (!statement) return null;
  const decision = settlementDecision(statement, intent);
  if (decision.action === "ignore") {
    if (statement.status !== "paid" && statement.status !== "void") {
      console.warn(`[commercial] statement event ignored :: ${statementId.slice(0, 8)} | ${intent.id} ${intent.status} :: ${decision.reason}`);
    }
    return { statement, charged: false, reason: decision.reason };
  }
  if (decision.action === "undecided") {
    if (decision.adopts) {
      // The attempt whose answer never came back: now we know its id.
      await db.update(commercialStatements).set({ stripePaymentIntentId: intent.id, status: "charging" }).where(eq(commercialStatements.id, statementId));
    }
    return null;
  }
  if (decision.action === "paid") {
    const [updated] = await db.update(commercialStatements)
      .set({ status: "paid", paidAt: now, lastError: null, stripePaymentIntentId: intent.id })
      .where(eq(commercialStatements.id, statementId)).returning();
    await db.update(commercialJobs).set({ billedStatus: "paid" }).where(eq(commercialJobs.statementId, statementId));
    console.log(`[commercial] statement settled :: ${statementId} | $${statement.total} | ${intent.status}`);
    return { statement: updated, charged: true, reason: "Paid" };
  }
  const reason = intent.last_payment_error?.message ?? decision.reason;
  const [updated] = await db.update(commercialStatements)
    .set({ status: "failed", lastError: reason.slice(0, 500), stripePaymentIntentId: intent.id })
    .where(eq(commercialStatements.id, statementId)).returning();
  console.error(`[commercial] statement debit failed after the fact :: ${statementId} | $${statement.total} :: ${reason}`);
  opsAlert(formatOpsAlert("💳 Commercial bank debit failed", [["Statement", statementId.slice(0, 8)], ["Amount", `$${Number(statement.total).toFixed(2)}`], ["Reason", reason.slice(0, 200)], ["Next", "Retry from Admin once the account's bank or card is put right"]]));
  return { statement: updated, charged: false, reason };
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
