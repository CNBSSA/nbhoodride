import Stripe from "stripe";

// Stripe is optional — only initialised when STRIPE_SECRET_KEY is set.
// Without it the app starts normally; payment endpoints return 503.
export let stripe: Stripe | null = null;

if (process.env.STRIPE_SECRET_KEY) {
  // STRIPE_API_BASE_FOR_TESTS points the client at a local stand-in for
  // Stripe so a journey can make a charge succeed, decline or lose its answer
  // (code review 2026-10-06). Never set in production; unset, nothing changes.
  const testBase = process.env.STRIPE_API_BASE_FOR_TESTS ? new URL(process.env.STRIPE_API_BASE_FOR_TESTS) : null;
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2025-10-29.clover",
    ...(testBase ? { host: testBase.hostname, port: Number(testBase.port || 80), protocol: testBase.protocol.replace(":", "") as "http" | "https" } : {}),
  });
}

export interface CreatePaymentIntentParams {
  amount: number;
  customerId: string;
  paymentMethodId: string;
  metadata?: Record<string, string>;
}

export interface CancellationFeeParams {
  paymentIntentId: string;
  cancellationFee: number;
}

function requireStripe(): Stripe {
  if (!stripe) {
    throw new Error("Stripe is not configured. Set STRIPE_SECRET_KEY in Railway → Variables.");
  }
  return stripe;
}

export class StripeService {
  get isEnabled(): boolean {
    return stripe !== null;
  }

  async createOrGetCustomer(userId: string, email: string, name?: string): Promise<string> {
    const customer = await requireStripe().customers.create({
      email,
      name,
      metadata: { userId }
    });
    return customer.id;
  }

  async attachPaymentMethod(paymentMethodId: string, customerId: string): Promise<void> {
    await requireStripe().paymentMethods.attach(paymentMethodId, {
      customer: customerId,
    });
  }

  async setDefaultPaymentMethod(customerId: string, paymentMethodId: string): Promise<void> {
    await requireStripe().customers.update(customerId, {
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
    });
  }

  async listCardPaymentMethods(customerId: string): Promise<Stripe.PaymentMethod[]> {
    const result = await requireStripe().paymentMethods.list({
      customer: customerId,
      type: "card",
    });
    return result.data;
  }

  async retrieveCustomerDefaultPaymentMethodId(customerId: string): Promise<string | null> {
    const customer = await requireStripe().customers.retrieve(customerId);
    if (customer.deleted) return null;
    const def = customer.invoice_settings?.default_payment_method;
    if (!def) return null;
    return typeof def === "string" ? def : def.id;
  }

  async createPaymentIntent(params: CreatePaymentIntentParams): Promise<Stripe.PaymentIntent> {
    const { amount, customerId, paymentMethodId, metadata } = params;
    const paymentIntent = await requireStripe().paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: "usd",
      customer: customerId,
      payment_method: paymentMethodId,
      capture_method: 'manual',
      confirm: true,
      confirmation_method: 'automatic',
      metadata: metadata || {},
    });
    return paymentIntent;
  }

  // Authorize the rider's saved card for the portion of a ride fare that the
  // virtual balance can't cover. Manual capture so we can adjust at completion.
  async authorizeRideShortfall(params: {
    amount: number;
    customerId: string;
    paymentMethodId: string;
    rideId: string;
    riderId: string;
  }): Promise<Stripe.PaymentIntent> {
    const { amount, customerId, paymentMethodId, rideId, riderId } = params;
    return await requireStripe().paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: "usd",
      customer: customerId,
      payment_method: paymentMethodId,
      capture_method: 'manual',
      confirm: true,
      off_session: true,
      metadata: { rideId, riderId, type: 'ride_authorization' },
    });
  }

  // Charge the rider's saved card immediately (off-session) for the leftover
  // shortfall at ride completion when the original authorization wasn't enough.
  async chargeRideShortfall(params: {
    amount: number;
    customerId: string;
    paymentMethodId: string;
    rideId: string;
    riderId: string;
  }): Promise<Stripe.PaymentIntent> {
    const { amount, customerId, paymentMethodId, rideId, riderId } = params;
    return await requireStripe().paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: "usd",
      customer: customerId,
      payment_method: paymentMethodId,
      capture_method: 'automatic',
      confirm: true,
      off_session: true,
      metadata: { rideId, riderId, type: 'ride_settlement' },
    }, {
      // Short-window idempotency: if this call is repeated within Stripe's key
      // retention (~24h), Stripe returns the original charge instead of charging
      // the rider again. This is defense-in-depth only — the real guarantee that
      // an overage is charged at most once is that settlement retries REFUSE the
      // overage path (see settleCardPaymentForCompletedRide), so this runs on the
      // first-time completion only. Do not rely on the key alone across days.
      idempotencyKey: `ride_settlement_shortfall_${rideId}`,
    });
  }

  /**
   * A tip after the ride: its own off-session charge on the card on file,
   * never folded into the fare. The once-per-ride guarantee is the ledger
   * (storage.recordRideTipOnce); Stripe's key only makes a network retry of
   * the same request replay the same charge. It carries the amount and the
   * card, so a rider whose card was declined can try another card or amount
   * at once instead of being told the same "no" for a day.
   */
  async chargeTip(params: { amount: number; customerId: string; paymentMethodId: string; rideId: string; riderId: string }): Promise<Stripe.PaymentIntent> {
    const { amount, customerId, paymentMethodId, rideId, riderId } = params;
    const cents = Math.round(amount * 100);
    return await requireStripe().paymentIntents.create({
      amount: cents,
      currency: "usd",
      customer: customerId,
      payment_method: paymentMethodId,
      capture_method: 'automatic',
      confirm: true,
      off_session: true,
      // A card that wants the rider present cannot be charged off-session;
      // say so as a decline rather than leave an intent waiting on nobody.
      error_on_requires_action: true,
      description: "PG Ride tip for your driver",
      metadata: { rideId, riderId, type: 'tip', tipAmount: amount.toFixed(2) },
    }, { idempotencyKey: `ride_tip_${rideId}_${cents}_${paymentMethodId}` });
  }

  /** Give a charge back in full: for a tip that succeeded but has no home on the ledger. */
  async refundPaymentIntent(paymentIntentId: string, reason: string): Promise<Stripe.Refund> {
    return await requireStripe().refunds.create({ payment_intent: paymentIntentId, metadata: { reason } }, { idempotencyKey: `refund_${paymentIntentId}` });
  }

  async capturePaymentIntent(paymentIntentId: string, amountToCapture?: number): Promise<Stripe.PaymentIntent> {
    const captureParams: Stripe.PaymentIntentCaptureParams = {};
    if (amountToCapture !== undefined) {
      captureParams.amount_to_capture = Math.round(amountToCapture * 100);
    }
    return await requireStripe().paymentIntents.capture(paymentIntentId, captureParams);
  }

  async cancelPaymentIntent(paymentIntentId: string): Promise<Stripe.PaymentIntent> {
    return await requireStripe().paymentIntents.cancel(paymentIntentId);
  }

  /** Account deletion: remove the customer (and their attached cards) at Stripe. */
  async deleteCustomer(customerId: string): Promise<void> {
    await requireStripe().customers.del(customerId);
  }

  async captureCancellationFee(params: CancellationFeeParams): Promise<Stripe.PaymentIntent> {
    const { paymentIntentId, cancellationFee } = params;
    return await requireStripe().paymentIntents.capture(paymentIntentId, {
      amount_to_capture: Math.round(cancellationFee * 100)
    });
  }

  /**
   * Car rental (server/rental/): the rental price, charged at collection;
   * the deposit, held at collection and settled at return; and anything owed
   * beyond the deposit. One idempotency key per booking, purpose and card, so
   * a retried collection or settlement replays the same charge instead of
   * making a second one, while a renter who swaps a declined card for another
   * gets a real new attempt, not the old decline replayed. A card that wants the renter present is a decline:
   * these run with the renter at the desk but the card is charged off-session.
   */
  async chargeRental(params: { amount: number; customerId: string; paymentMethodId: string; bookingId: string; renterId: string; purpose: "rental" | "extras" | "driver_rent" | "driver_damage" | "driver_return"; keyPart?: string; attempt?: number }): Promise<Stripe.PaymentIntent> {
    const { amount, customerId, paymentMethodId, bookingId, renterId, purpose, keyPart } = params;
    const attempt = rentalAttemptSuffix(params.attempt);
    return await requireStripe().paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: "usd",
      customer: customerId,
      payment_method: paymentMethodId,
      capture_method: "automatic",
      confirm: true,
      off_session: true,
      error_on_requires_action: true,
      description: purpose === "rental" ? "PG Ride car rental" : purpose === "extras" ? "PG Ride car rental: extras on return" : purpose === "driver_rent" ? "PG Ride car for driving: weekly rent" : purpose === "driver_return" ? "PG Ride car for driving: damage and late return" : "PG Ride car for driving: damage on return",
      metadata: { rentalBookingId: bookingId, renterId, type: `rental_${purpose}`, ...(keyPart ? { rentalKeyPart: keyPart } : {}), ...(attempt ? { rentalAttempt: String(params.attempt) } : {}) },
    }, { idempotencyKey: `rental_${purpose}_${bookingId}${keyPart ? `_${keyPart}` : ""}_${paymentMethodId}${attempt}` });
  }

  /** A charge already made for this booking, purpose and period, if Stripe has one (recovering a charge whose answer was lost). */
  async findRentalCharge(customerId: string, bookingId: string, purpose: string, keyPart?: string): Promise<Stripe.PaymentIntent | null> {
    const recent = await requireStripe().paymentIntents.list({ customer: customerId, limit: 100 });
    const ours = recent.data.filter((pi) => pi.metadata?.rentalBookingId === bookingId && pi.metadata?.type === `rental_${purpose}` && (!keyPart || pi.metadata?.rentalKeyPart === keyPart));
    // A declined attempt and a later one that went through carry the same
    // metadata; the one that took (or holds) money is the answer (code review 2026-10-06).
    return ours.find((pi) => ["succeeded", "requires_capture", "processing"].includes(pi.status)) ?? ours[0] ?? null;
  }

  async holdRentalDeposit(params: { amount: number; customerId: string; paymentMethodId: string; bookingId: string; renterId: string; attempt?: number }): Promise<Stripe.PaymentIntent> {
    const { amount, customerId, paymentMethodId, bookingId, renterId } = params;
    const attempt = rentalAttemptSuffix(params.attempt);
    return await requireStripe().paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: "usd",
      customer: customerId,
      payment_method: paymentMethodId,
      capture_method: "manual",
      confirm: true,
      off_session: true,
      error_on_requires_action: true,
      description: "PG Ride car rental deposit (held, not charged)",
      metadata: { rentalBookingId: bookingId, renterId, type: "rental_deposit", ...(attempt ? { rentalAttempt: String(params.attempt) } : {}) },
    }, { idempotencyKey: `rental_deposit_${bookingId}_${paymentMethodId}${attempt}` });
  }

  async getPaymentIntent(paymentIntentId: string): Promise<Stripe.PaymentIntent> {
    return await requireStripe().paymentIntents.retrieve(paymentIntentId);
  }
}

/**
 * The attempt part of a rental idempotency key (code review 2026-10-06).
 * Attempt 1 keeps the key it always had; a retry after a recorded decline is
 * attempt 2, 3… so the same card gets a real new try instead of the old
 * decline replayed for a day. An attempt whose answer was lost keeps its
 * number, so repeating it replays it and never charges twice. The pattern is
 * chargeAttemptKey in shared/billingCycle.ts.
 */
export function rentalAttemptSuffix(attempt?: number): string {
  return attempt && attempt > 1 ? `_attempt_${attempt}` : "";
}

/**
 * Did Stripe give a verdict? A card decline, a request Stripe refused, or a
 * key it would not accept is an answer: nothing was charged. Anything else
 * (no connection, a 5xx, a reply we could not read) may have charged, so the
 * attempt stays open and is repeated under the same key (code review 2026-10-06).
 */
export function stripeSaidNo(err: any): boolean {
  const type = String(err?.type ?? "");
  return type === "StripeCardError" || type === "StripeInvalidRequestError" || type === "StripeAuthenticationError" || type === "StripePermissionError" || type === "StripeIdempotencyError";
}

export const stripeService = new StripeService();
