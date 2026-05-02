import Stripe from "stripe";

// Stripe is optional — only initialised when STRIPE_SECRET_KEY is set.
// Without it the app starts normally; payment endpoints return 503.
export let stripe: Stripe | null = null;

if (process.env.STRIPE_SECRET_KEY) {
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2025-09-30.clover",
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
    });
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

  async captureCancellationFee(params: CancellationFeeParams): Promise<Stripe.PaymentIntent> {
    const { paymentIntentId, cancellationFee } = params;
    return await requireStripe().paymentIntents.capture(paymentIntentId, {
      amount_to_capture: Math.round(cancellationFee * 100)
    });
  }

  async getPaymentIntent(paymentIntentId: string): Promise<Stripe.PaymentIntent> {
    return await requireStripe().paymentIntents.retrieve(paymentIntentId);
  }
}

export const stripeService = new StripeService();
