import { Global, Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { FirebaseProvider } from './providers/firebase.provider';
import { SmsProvider } from './providers/sms.provider';
import { EmailProvider } from './providers/email.provider';
import { NotificationsController } from './notifications.controller';

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, FirebaseProvider, SmsProvider, EmailProvider],
  exports: [NotificationsService],
})
export class NotificationsModule {}
