import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as twilio from 'twilio';

@Injectable()
export class SmsProvider {
  private readonly logger = new Logger(SmsProvider.name);
  private client: twilio.Twilio | null = null;

  constructor(private config: ConfigService) {
    const sid = config.get<string>('TWILIO_ACCOUNT_SID');
    const token = config.get<string>('TWILIO_AUTH_TOKEN');

    if (sid && token) {
      this.client = twilio.default(sid, token);
    } else {
      this.logger.warn('Twilio not configured — SMS notifications disabled');
    }
  }

  async send(to: string, message: string): Promise<void> {
    if (!this.client) {
      this.logger.debug(`[DEV] SMS to ${to}: ${message}`);
      return;
    }

    try {
      await this.client.messages.create({
        to,
        from: this.config.get<string>('TWILIO_PHONE_NUMBER'),
        body: message,
      });
    } catch (error) {
      this.logger.error(`SMS failed to ${to}:`, error.message);
    }
  }
}
