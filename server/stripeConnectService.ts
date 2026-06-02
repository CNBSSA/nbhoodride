// AH-060: Stripe Connect Express helpers for driver payouts + 1099-NEC.
//
// Why a separate file from stripeService.ts: payment-intent logic (rider-side
// charges) and Connect logic (driver-side payouts + onboarding) have nothing
// in common operationally. Keeping them apart means a Stripe API surface
// change to one doesn't risk the other, and reviewers can reason about each
// in isolation.
//
// Express vs Standard vs Custom: we use Express. Stripe hosts the entire
// onboarding UI (SSN/W-9 collection, bank verification, identity docs), so
// the platform never touches FTI directly. Drivers get a lightweight Stripe
// dashboard for tax docs and payout history; the platform retains branding
// for everything else.
//
// 1099 e-filing: Stripe Connect's tax-reporting feature generates and e-files
// 1099-NECs for every driver paid via the platform once enabled in the Stripe
// dashboard. No code change needed at year-end — Stripe mails / emails the
// driver a copy and files with the IRS. Drivers see the form in their Express
// dashboard.

import Stripe from "stripe";
import { stripe } from "./stripeService";

function requireStripe(): Stripe {
  if (!stripe) {
    throw new Error("Stripe is not configured. Set STRIPE_SECRET_KEY in Railway → Variables.");
  }
  return stripe;
}

export interface ConnectAccountStatus {
  payoutsEnabled: boolean;
  chargesEnabled: boolean;
  // detailsSubmitted = driver has finished filling out the Express form.
  // Stripe may still flip payoutsEnabled to true later when bank-verification
  // microdeposits clear, so we keep both signals.
  detailsSubmitted: boolean;
  requirementsCurrentlyDue: string[];
}

export class StripeConnectService {
  get isEnabled(): boolean {
    return stripe !== null;
  }

  /**
   * Create a new Express connected account for a driver. Stripe owns identity
   * verification, W-9 collection, and bank linking inside the hosted flow.
   *
   * The `capabilities.transfers` request is what lets us send money to this
   * account via stripe.transfers.create later. We do NOT request
   * card_payments here — drivers don't accept rider cards directly; the
   * platform stays the merchant of record on every ride.
   */
  async createExpressAccount(params: {
    userId: string;
    email: string;
    firstName?: string;
    lastName?: string;
  }): Promise<Stripe.Account> {
    const { userId, email, firstName, lastName } = params;
    return await requireStripe().accounts.create({
      type: "express",
      country: "US",
      email,
      capabilities: {
        transfers: { requested: true },
      },
      business_type: "individual",
      individual: firstName || lastName ? {
        first_name: firstName,
        last_name: lastName,
        email,
      } : undefined,
      metadata: { userId },
    });
  }

  /**
   * Generate a one-shot URL the driver is redirected to for onboarding.
   * Account links expire fast (a few minutes) and are single-use, which is
   * why this returns a fresh URL each call instead of caching one.
   *
   * refreshUrl: where Stripe sends the user if they abandon mid-flow.
   * returnUrl: where Stripe sends them on success.
   * Both should land on a route that re-polls account state and either
   * generates a new link (refresh) or shows the next step (return).
   */
  async createAccountLink(params: {
    accountId: string;
    refreshUrl: string;
    returnUrl: string;
  }): Promise<Stripe.AccountLink> {
    const { accountId, refreshUrl, returnUrl } = params;
    return await requireStripe().accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: "account_onboarding",
    });
  }

  /**
   * Read the live status of a connected account. Used by status-poll endpoint
   * and as the source of truth that the account.updated webhook persists to
   * our DB. payouts_enabled is the gate the UI uses to allow "Transfer to bank".
   */
  async retrieveAccount(accountId: string): Promise<ConnectAccountStatus> {
    const account = await requireStripe().accounts.retrieve(accountId);
    return {
      payoutsEnabled: account.payouts_enabled === true,
      chargesEnabled: account.charges_enabled === true,
      detailsSubmitted: account.details_submitted === true,
      requirementsCurrentlyDue: account.requirements?.currently_due ?? [],
    };
  }

  /**
   * Move funds from the platform's available balance to a connected account.
   *
   * idempotencyKey: the caller passes the payout request ID. If the request
   * is retried (network blip, webhook retry, etc.) Stripe returns the original
   * Transfer rather than creating a duplicate — this is how we avoid paying
   * the driver twice.
   *
   * Note: in test mode the platform's balance must be funded (via test charges)
   * before transfers will succeed. In production the platform balance comes
   * from rider payments minus refunds/disputes.
   */
  async createTransfer(params: {
    amountCents: number;
    destinationAccountId: string;
    idempotencyKey: string;
    metadata?: Record<string, string>;
    description?: string;
  }): Promise<Stripe.Transfer> {
    const { amountCents, destinationAccountId, idempotencyKey, metadata, description } = params;
    return await requireStripe().transfers.create(
      {
        amount: amountCents,
        currency: "usd",
        destination: destinationAccountId,
        description,
        metadata: metadata ?? {},
      },
      { idempotencyKey },
    );
  }
}

export const stripeConnectService = new StripeConnectService();
