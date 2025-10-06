import Stripe from "stripe";

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('Missing required Stripe secret: STRIPE_SECRET_KEY');
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-09-30.clover",
});

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

export class StripeService {
  async createOrGetCustomer(userId: string, email: string, name?: string): Promise<string> {
    const customer = await stripe.customers.create({
      email,
      name,
      metadata: { userId }
    });
    
    return customer.id;
  }

  async attachPaymentMethod(paymentMethodId: string, customerId: string): Promise<void> {
    await stripe.paymentMethods.attach(paymentMethodId, {
      customer: customerId,
    });
  }

  async setDefaultPaymentMethod(customerId: string, paymentMethodId: string): Promise<void> {
    await stripe.customers.update(customerId, {
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
    });
  }

  async createPaymentIntent(params: CreatePaymentIntentParams): Promise<Stripe.PaymentIntent> {
    const { amount, customerId, paymentMethodId, metadata } = params;

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: "usd",
      customer: customerId,
      payment_method: paymentMethodId,
      capture_method: 'manual',
      metadata: metadata || {},
    });

    return paymentIntent;
  }

  async capturePaymentIntent(paymentIntentId: string, amountToCapture?: number): Promise<Stripe.PaymentIntent> {
    const captureParams: Stripe.PaymentIntentCaptureParams = {};
    
    if (amountToCapture !== undefined) {
      captureParams.amount_to_capture = Math.round(amountToCapture * 100);
    }

    const paymentIntent = await stripe.paymentIntents.capture(
      paymentIntentId,
      captureParams
    );

    return paymentIntent;
  }

  async cancelPaymentIntent(paymentIntentId: string): Promise<Stripe.PaymentIntent> {
    const paymentIntent = await stripe.paymentIntents.cancel(paymentIntentId);
    return paymentIntent;
  }

  async captureCancellationFee(params: CancellationFeeParams): Promise<Stripe.PaymentIntent> {
    const { paymentIntentId, cancellationFee } = params;
    
    const paymentIntent = await stripe.paymentIntents.capture(
      paymentIntentId,
      {
        amount_to_capture: Math.round(cancellationFee * 100)
      }
    );

    return paymentIntent;
  }

  async getPaymentIntent(paymentIntentId: string): Promise<Stripe.PaymentIntent> {
    return await stripe.paymentIntents.retrieve(paymentIntentId);
  }
}

export const stripeService = new StripeService();
