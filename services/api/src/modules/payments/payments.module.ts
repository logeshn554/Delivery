import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { RazorpayProvider } from './providers/razorpay.provider';
import { StripeProvider } from './providers/stripe.provider';
import { WebhookController } from './webhooks/payment-webhook.controller';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [WalletModule],
  controllers: [PaymentsController, WebhookController],
  providers: [PaymentsService, RazorpayProvider, StripeProvider],
  exports: [PaymentsService],
})
export class PaymentsModule {}
