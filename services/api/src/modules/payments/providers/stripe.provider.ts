import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

@Injectable()
export class StripeProvider {
  private readonly logger = new Logger(StripeProvider.name);
  private client: Stripe | undefined;

  constructor(private config: ConfigService) {
    const key = config.get<string>('payment.stripe.secretKey');
    if (key) this.client = new Stripe(key, { apiVersion: '2023-10-16' });
  }

  private requireClient(): Stripe {
    if (!this.client) throw new ServiceUnavailableException('Stripe payments are not configured');
    return this.client;
  }

  async createPaymentIntent(params: {
    amount: number;
    currency: string;
    metadata?: Record<string, string>;
  }) {
    return this.requireClient().paymentIntents.create({
      amount: params.amount,
      currency: params.currency,
      automatic_payment_methods: { enabled: true },
      metadata: params.metadata,
    });
  }

  async retrievePaymentIntent(paymentIntentId: string) {
    return this.requireClient().paymentIntents.retrieve(paymentIntentId);
  }

  async createRefund(params: { paymentIntentId: string; amount: number }) {
    return this.requireClient().refunds.create({
      payment_intent: params.paymentIntentId,
      amount: params.amount,
    });
  }

  constructWebhookEvent(payload: Buffer, signature: string): Stripe.Event {
    const secret = this.config.get<string>('payment.stripe.webhookSecret') || '';
    if (!secret) throw new ServiceUnavailableException('Stripe webhook is not configured');
    return this.requireClient().webhooks.constructEvent(payload, signature, secret);
  }
}
