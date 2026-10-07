import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

@Injectable()
export class StripeProvider {
  private readonly logger = new Logger(StripeProvider.name);
  private client: Stripe;

  constructor(private config: ConfigService) {
    this.client = new Stripe(
      config.get<string>('payment.stripe.secretKey') || 'sk_test_placeholder',
      { apiVersion: '2023-10-16' },
    );
  }

  async createPaymentIntent(params: {
    amount: number;
    currency: string;
    metadata?: Record<string, string>;
  }) {
    return this.client.paymentIntents.create({
      amount: params.amount,
      currency: params.currency,
      automatic_payment_methods: { enabled: true },
      metadata: params.metadata,
    });
  }

  async retrievePaymentIntent(paymentIntentId: string) {
    return this.client.paymentIntents.retrieve(paymentIntentId);
  }

  async createRefund(params: { paymentIntentId: string; amount: number }) {
    return this.client.refunds.create({
      payment_intent: params.paymentIntentId,
      amount: params.amount,
    });
  }

  constructWebhookEvent(payload: Buffer, signature: string): Stripe.Event {
    const secret = this.config.get<string>('payment.stripe.webhookSecret') || '';
    return this.client.webhooks.constructEvent(payload, signature, secret);
  }
}
