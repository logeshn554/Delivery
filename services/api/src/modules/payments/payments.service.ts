import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma/prisma.service';
import { RazorpayProvider } from './providers/razorpay.provider';
import { StripeProvider } from './providers/stripe.provider';
import { WalletService } from '../wallet/wallet.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { PaymentStatus, PaymentMethod, PaymentProvider, ServiceType } from '@prisma/client';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private prisma: PrismaService,
    private razorpay: RazorpayProvider,
    private stripe: StripeProvider,
    private wallet: WalletService,
    private config: ConfigService,
    private eventEmitter: EventEmitter2,
  ) {}

  // ─── Create Payment Order ─────────────────────────────────────────────────
  async createPayment(userId: string, dto: CreatePaymentDto) {
    // Verify no pending payment for this reference
    const existing = await this.prisma.payment.findFirst({
      where: {
        referenceId: dto.referenceId,
        status: { in: [PaymentStatus.PENDING, PaymentStatus.COMPLETED] },
      },
    });

    if (existing?.status === PaymentStatus.COMPLETED) {
      throw new BadRequestException('Payment already completed for this order');
    }

    let providerOrderId: string | undefined;
    let clientSecret: string | undefined;

    if (dto.method === PaymentMethod.WALLET) {
      // Deduct from wallet directly
      await this.wallet.debit({
        userId,
        amount: dto.amount,
        reason: 'ORDER_PAYMENT',
        referenceId: dto.referenceId,
        description: dto.description,
      });
    } else if (dto.method === PaymentMethod.RAZORPAY) {
      const order = await this.razorpay.createOrder({
        amount: Math.round(dto.amount * 100), // paise
        currency: dto.currency || 'INR',
        receipt: dto.referenceId,
      });
      providerOrderId = order.id;
    } else if (dto.method === PaymentMethod.CARD || dto.method === PaymentMethod.STRIPE) {
      const intent = await this.stripe.createPaymentIntent({
        amount: Math.round(dto.amount * 100), // cents
        currency: (dto.currency || 'inr').toLowerCase(),
        metadata: { referenceId: dto.referenceId },
      });
      providerOrderId = intent.id;
      clientSecret = intent.client_secret;
    }

    const payment = await this.prisma.payment.create({
      data: {
        userId,
        serviceType: dto.serviceType,
        referenceId: dto.referenceId,
        amount: dto.amount,
        currency: dto.currency || 'INR',
        method: dto.method,
        provider: this.resolveProvider(dto.method),
        providerOrderId,
        status: dto.method === PaymentMethod.WALLET
          ? PaymentStatus.COMPLETED
          : PaymentStatus.PENDING,
        description: dto.description,
        paidAt: dto.method === PaymentMethod.WALLET ? new Date() : undefined,
      },
    });

    if (dto.method === PaymentMethod.WALLET) {
      await this.onPaymentSuccess(payment.id, dto.referenceId, dto.serviceType);
    }

    return {
      paymentId: payment.id,
      providerOrderId,
      clientSecret,
      amount: dto.amount,
      currency: payment.currency,
      status: payment.status,
      // Razorpay public key for frontend
      razorpayKeyId: dto.method === PaymentMethod.RAZORPAY
        ? this.config.get<string>('payment.razorpay.keyId')
        : undefined,
    };
  }

  // ─── Verify Payment ───────────────────────────────────────────────────────
  async verifyPayment(dto: {
    paymentId: string;
    providerPaymentId: string;
    providerSignature?: string;
  }) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: dto.paymentId },
    });

    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status === PaymentStatus.COMPLETED) {
      return { success: true, already: true };
    }

    let verified = false;

    if (payment.provider === PaymentProvider.RAZORPAY) {
      verified = this.razorpay.verifySignature({
        orderId: payment.providerOrderId!,
        paymentId: dto.providerPaymentId,
        signature: dto.providerSignature!,
      });
    } else if (payment.provider === PaymentProvider.STRIPE) {
      const intent = await this.stripe.retrievePaymentIntent(dto.providerPaymentId);
      verified = intent.status === 'succeeded';
    }

    if (!verified) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.FAILED, failureReason: 'Signature verification failed' },
      });
      throw new BadRequestException('Payment verification failed');
    }

    const updated = await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.COMPLETED,
        providerPaymentId: dto.providerPaymentId,
        providerSignature: dto.providerSignature,
        paidAt: new Date(),
      },
    });

    await this.onPaymentSuccess(payment.id, payment.referenceId, payment.serviceType);

    return { success: true, payment: updated };
  }

  // ─── Process Refund ───────────────────────────────────────────────────────
  async initiateRefund(paymentId: string, amount: number, reason: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });

    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status !== PaymentStatus.COMPLETED) {
      throw new BadRequestException('Can only refund completed payments');
    }

    let providerRefundId: string | undefined;

    if (payment.provider === PaymentProvider.RAZORPAY && payment.providerPaymentId) {
      const refund = await this.razorpay.createRefund({
        paymentId: payment.providerPaymentId,
        amount: Math.round(amount * 100),
      });
      providerRefundId = refund.id;
    } else if (payment.provider === PaymentProvider.STRIPE && payment.providerPaymentId) {
      const refund = await this.stripe.createRefund({
        paymentIntentId: payment.providerPaymentId,
        amount: Math.round(amount * 100),
      });
      providerRefundId = refund.id;
    } else if (payment.method === PaymentMethod.WALLET) {
      // Credit back to wallet
      await this.wallet.credit({
        userId: payment.userId,
        amount,
        reason: 'REFUND',
        referenceId: paymentId,
        description: reason,
      });
    }

    const refund = await this.prisma.refund.create({
      data: {
        paymentId,
        amount,
        reason,
        providerRefundId,
        status: PaymentStatus.COMPLETED,
        processedAt: new Date(),
      },
    });

    this.eventEmitter.emit('payment.refunded', {
      paymentId,
      refundId: refund.id,
      amount,
      userId: payment.userId,
    });

    return refund;
  }

  // ─── Handle Successful Payment ────────────────────────────────────────────
  private async onPaymentSuccess(
    paymentId: string,
    referenceId: string,
    serviceType: ServiceType,
  ) {
    this.eventEmitter.emit('payment.completed', {
      paymentId,
      referenceId,
      serviceType,
    });
  }

  private resolveProvider(method: PaymentMethod): PaymentProvider | undefined {
    if (method === PaymentMethod.RAZORPAY || method === PaymentMethod.UPI) {
      return PaymentProvider.RAZORPAY;
    }
    if (method === PaymentMethod.CARD || method === PaymentMethod.STRIPE) {
      return PaymentProvider.STRIPE;
    }
    if (method === PaymentMethod.WALLET || method === PaymentMethod.CASH) {
      return PaymentProvider.INTERNAL;
    }
    return undefined;
  }
}
