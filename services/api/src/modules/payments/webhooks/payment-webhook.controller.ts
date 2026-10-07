import {
  Controller,
  Post,
  Req,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
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
  ) {}

  @Post('razorpay')
  @HttpCode(HttpStatus.OK)
  async handleRazorpayWebhook(
    @Req() req: Request,
    @Headers('x-razorpay-signature') signature: string,
  ) {
    this.logger.log('Received Razorpay webhook');
    return { received: true };
  }

  @Post('stripe')
  @HttpCode(HttpStatus.OK)
  async handleStripeWebhook(
    @Req() req: Request,
    @Headers('stripe-signature') signature: string,
  ) {
    this.logger.log('Received Stripe webhook');
    return { received: true };
  }
}
