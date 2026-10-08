import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Razorpay from 'razorpay';
import * as crypto from 'crypto';

@Injectable()
export class RazorpayProvider {
  private readonly logger = new Logger(RazorpayProvider.name);
  private client: Razorpay;

  constructor(private config: ConfigService) {
    this.client = new Razorpay({
      key_id: config.get<string>('payment.razorpay.keyId') || '',
      key_secret: config.get<string>('payment.razorpay.keySecret') || '',
    });
  }

  async createOrder(params: {
    amount: number;
    currency: string;
    receipt: string;
    notes?: Record<string, string>;
  }) {
    return this.client.orders.create({
      amount: params.amount,
      currency: params.currency,
      receipt: params.receipt,
      notes: params.notes,
    });
  }

  verifySignature(params: {
    orderId: string;
    paymentId: string;
    signature: string;
  }): boolean {
    const secret = this.config.get<string>('payment.razorpay.keySecret') || '';
    const body = `${params.orderId}|${params.paymentId}`;
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('hex');
    return /^[a-f0-9]{64}$/i.test(params.signature||'')&&crypto.timingSafeEqual(Buffer.from(expectedSignature,'hex'),Buffer.from(params.signature,'hex'));
  }

  async createRefund(params: { paymentId: string; amount: number }) {
    return this.client.payments.refund(params.paymentId, {
      amount: params.amount,
    });
  }

  verifyWebhookSignature(body: string, signature: string): boolean {
    const secret = this.config.get<string>('payment.razorpay.webhookSecret') || '';
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('hex');
    return /^[a-f0-9]{64}$/i.test(signature||'')&&crypto.timingSafeEqual(Buffer.from(expectedSignature,'hex'),Buffer.from(signature,'hex'));
  }
}
