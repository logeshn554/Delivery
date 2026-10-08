import { Injectable, Logger, BadRequestException, NotFoundException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma/prisma.service';
import { RazorpayProvider } from './providers/razorpay.provider';
import { StripeProvider } from './providers/stripe.provider';
import { WalletService } from '../wallet/wallet.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { PaymentStatus, PaymentMethod, PaymentProvider, ServiceType, Refund } from '@prisma/client';

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
  private async amountFor(userId:string, serviceType:ServiceType, referenceId:string):Promise<number>{
    let order:{customerId?:string;totalAmount?:number;estimatedFare?:number;totalFare?:number}|null=null;
    if(serviceType===ServiceType.FOOD_DELIVERY)order=await this.prisma.foodOrder.findUnique({where:{id:referenceId},select:{customerId:true,totalAmount:true}});
    if(serviceType===ServiceType.RIDE)order=await this.prisma.ride.findUnique({where:{id:referenceId},select:{customerId:true,estimatedFare:true}});
    if(serviceType===ServiceType.PACKAGE_DELIVERY)order=await this.prisma.package.findUnique({where:{id:referenceId},select:{customerId:true,totalFare:true}});
    if(serviceType===ServiceType.VEHICLE_TRANSPORT)order=await this.prisma.vehicleTransport.findUnique({where:{id:referenceId},select:{customerId:true,totalFare:true}});
    if(!order)throw new NotFoundException('Payable booking not found');
    if(order.customerId!==userId)throw new ForbiddenException('This booking belongs to another account');
    const amount=order.totalAmount??order.estimatedFare??order.totalFare;
    if(!Number.isFinite(amount)||amount<=0)throw new ServiceUnavailableException('Booking price is unavailable');
    return amount;
  }

  async recordProviderEvent(event:{provider:PaymentProvider;eventId:string;providerOrderId:string;providerPaymentId:string;amountPaise:number;currency:string;captured:boolean}){
    if(!event.eventId||!event.providerOrderId||!Number.isInteger(event.amountPaise)||event.amountPaise<=0)throw new BadRequestException('Invalid provider event');
    try{
      const result=await this.prisma.$transaction(async tx=>{
        await tx.paymentWebhookReceipt.create({data:{provider:event.provider,eventId:event.eventId}});
        const payment=await tx.payment.findFirst({where:{provider:event.provider,providerOrderId:event.providerOrderId}});
        if(!payment)throw new NotFoundException('Provider payment order not found');
        if(Math.round(payment.amount*100)!==event.amountPaise||payment.currency.toUpperCase()!==event.currency.toUpperCase())throw new BadRequestException('Provider payment does not match booking price');
        const claim=await tx.payment.updateMany({where:{id:payment.id,status:{in:[PaymentStatus.PENDING,PaymentStatus.PROCESSING]}},data:event.captured?{status:PaymentStatus.COMPLETED,providerPaymentId:event.providerPaymentId,paidAt:new Date()}:{status:PaymentStatus.FAILED,failureReason:'Provider reported payment failure'}});
        return {payment,changed:claim.count===1};
      });
      if(result.changed&&event.captured)await this.onPaymentSuccess(result.payment.id,result.payment.referenceId,result.payment.serviceType);
      return {received:true,changed:result.changed};
    }catch(error){if(error?.code==='P2002')return {received:true,duplicate:true};throw error;}
  }

  async createPayment(userId: string, dto: CreatePaymentDto) {
    if(dto.currency&&dto.currency.toUpperCase()!=='INR')throw new BadRequestException('Only INR is supported');
    if(dto.method===PaymentMethod.CASH)throw new ServiceUnavailableException('Cash collection is not configured for this booking');
    const amount=await this.amountFor(userId,dto.serviceType,dto.referenceId);
    if(Math.round(dto.amount*100)!==Math.round(amount*100))throw new BadRequestException('The booking price has changed. Refresh and retry.');
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
    if(existing&&existing.userId!==userId)throw new ForbiddenException('This payment belongs to another account');
    if(existing)return {paymentId:existing.id,providerOrderId:existing.providerOrderId,amount:existing.amount,currency:existing.currency,status:existing.status};

    let providerOrderId: string | undefined;
    let clientSecret: string | undefined;

    if (dto.method === PaymentMethod.WALLET) {
      // Deduct from wallet directly
      await this.wallet.debit({
        userId,
        amount,
        reason: 'ORDER_PAYMENT',
        referenceId: dto.referenceId,
        description: dto.description,
      });
    } else if (dto.method === PaymentMethod.RAZORPAY || dto.method === PaymentMethod.UPI) {
      const order = await this.razorpay.createOrder({
        amount: Math.round(amount * 100), // paise
        currency: dto.currency || 'INR',
        receipt: dto.referenceId,
      });
      providerOrderId = order.id;
    } else if (dto.method === PaymentMethod.CARD || dto.method === PaymentMethod.STRIPE) {
      const intent = await this.stripe.createPaymentIntent({
        amount: Math.round(amount * 100), // paise
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
        amount,
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
      amount,
      currency: payment.currency,
      status: payment.status,
      // Razorpay public key for frontend
      razorpayKeyId: dto.method === PaymentMethod.RAZORPAY || dto.method === PaymentMethod.UPI
        ? this.config.get<string>('payment.razorpay.keyId')
        : undefined,
    };
  }

  // ─── Verify Payment ───────────────────────────────────────────────────────
  async verifyPayment(userId:string,dto: {
    paymentId: string;
    providerPaymentId: string;
    providerSignature?: string;
  }) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: dto.paymentId },
    });

    if (!payment) throw new NotFoundException('Payment not found');
    if(payment.userId!==userId)throw new ForbiddenException('This payment belongs to another account');
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
      verified = intent.id===payment.providerOrderId&&intent.status === 'succeeded'&&intent.amount===Math.round(payment.amount*100)&&intent.currency.toUpperCase()===payment.currency;
    }

    if (!verified) {
      throw new BadRequestException('Payment verification failed');
    }

    // A Razorpay checkout signature proves the checkout response, not capture.
    // Only the signed provider webhook can settle the booking.
    const settled = payment.provider === PaymentProvider.STRIPE;
    const claim=await this.prisma.payment.updateMany({
      where: { id: payment.id,status:PaymentStatus.PENDING },
      data: {
        status: settled ? PaymentStatus.COMPLETED : PaymentStatus.PROCESSING,
        providerPaymentId: dto.providerPaymentId,
        providerSignature: dto.providerSignature,
        paidAt: settled ? new Date() : undefined,
      },
    });
    if(claim.count!==1)return {success:true,already:true};
    const updated=await this.prisma.payment.findUnique({where:{id:payment.id}});

    if(settled)await this.onPaymentSuccess(payment.id, payment.referenceId, payment.serviceType);

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
    if (!Number.isFinite(amount) || Math.round(amount * 100) !== Math.round(payment.amount * 100)) {
      throw new BadRequestException('Only a full refund of the charged amount is supported');
    }
    if (![PaymentProvider.RAZORPAY, PaymentProvider.STRIPE, PaymentProvider.INTERNAL].includes(payment.provider)) {
      throw new ServiceUnavailableException('This payment method cannot be refunded automatically');
    }
    if (payment.provider !== PaymentProvider.INTERNAL && !payment.providerPaymentId) {
      throw new ServiceUnavailableException('Provider payment ID is missing; reconcile this payment manually');
    }
    const existingRefund = await this.prisma.refund.findUnique({ where: { paymentId } });
    if (existingRefund) throw new BadRequestException('Refund already started; reconcile the existing refund');
    let refund: Refund;
    try {
      refund = await this.prisma.refund.create({
        data: { paymentId, amount, reason, status: PaymentStatus.PENDING },
      });
    } catch (error) {
      if (error?.code === 'P2002') throw new BadRequestException('Refund already started');
      throw error;
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

    // If the provider response is uncertain, keep PENDING. An operator must
    // reconcile it before another attempt; automatic retry could pay twice.
    refund = await this.prisma.$transaction(async tx => {
      const completed = await tx.refund.update({ where: { id: refund.id },
        data: { providerRefundId, status: PaymentStatus.COMPLETED, processedAt: new Date() },
      });
      await tx.payment.update({ where: { id: paymentId }, data: { status: PaymentStatus.REFUNDED } });
      return completed;
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
