import {
  Controller,
  Post,
  Req,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PaymentProvider } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { RazorpayProvider } from '../providers/razorpay.provider';
import { StripeProvider } from '../providers/stripe.provider';
import { PaymentsService } from '../payments.service';

@Controller('payments/webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly razorpayProvider: RazorpayProvider,
    private readonly stripeProvider: StripeProvider,
    private readonly paymentsService: PaymentsService,
    private readonly config:ConfigService,
  ) {}

  @Post('razorpay')
  @HttpCode(HttpStatus.OK)
  async handleRazorpayWebhook(
    @Req() req: Request,
    @Headers('x-razorpay-signature') signature: string,
  ) {
    const raw=(req as Request&{rawBody?:Buffer}).rawBody;
    if(!raw)throw new BadRequestException('Raw webhook body required');
    if(!this.config.get('payment.razorpay.webhookSecret'))throw new ServiceUnavailableException('Webhook secret is not configured');
    if(!this.razorpayProvider.verifyWebhookSignature(raw.toString('utf8'),signature))throw new UnauthorizedException('Invalid webhook signature');
    const message=JSON.parse(raw.toString('utf8'));
    if(!['payment.captured','payment.failed'].includes(message.event))return {received:true,ignored:true};
    const payment=message.payload?.payment?.entity;
    return this.paymentsService.recordProviderEvent({provider:PaymentProvider.RAZORPAY,eventId:createHash('sha256').update(raw).digest('hex'),providerOrderId:payment?.order_id,providerPaymentId:payment?.id,amountPaise:payment?.amount,currency:payment?.currency,captured:message.event==='payment.captured'});
  }

  @Post('stripe')
  @HttpCode(HttpStatus.OK)
  async handleStripeWebhook(
    @Req() req: Request,
    @Headers('stripe-signature') signature: string,
  ) {
    const raw=(req as Request&{rawBody?:Buffer}).rawBody;
    if(!raw)throw new BadRequestException('Raw webhook body required');
    if(!this.config.get('payment.stripe.webhookSecret'))throw new ServiceUnavailableException('Webhook secret is not configured');
    let event;
    try{event=this.stripeProvider.constructWebhookEvent(raw,signature);}catch{throw new UnauthorizedException('Invalid webhook signature');}
    if(!['payment_intent.succeeded','payment_intent.payment_failed'].includes(event.type))return {received:true,ignored:true};
    const intent=event.data.object as {id:string;amount:number;currency:string};
    return this.paymentsService.recordProviderEvent({provider:PaymentProvider.STRIPE,eventId:event.id,providerOrderId:intent.id,providerPaymentId:intent.id,amountPaise:intent.amount,currency:intent.currency,captured:event.type==='payment_intent.succeeded'});
  }
}
