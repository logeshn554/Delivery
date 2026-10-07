import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as twilio from 'twilio';
import { PrismaService } from '../../database/prisma/prisma.service';
import { addMinutes } from 'date-fns';

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private twilioClient: twilio.Twilio;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    this.twilioClient = twilio.default(
      config.get<string>('TWILIO_ACCOUNT_SID'),
      config.get<string>('TWILIO_AUTH_TOKEN'),
    );
  }

  async generateAndSend(phone: string, userId: string): Promise<string> {
    const code = this.generateCode();
    const expiryMinutes = this.config.get<number>('app.otpExpiryMinutes', 10);

    // Invalidate previous OTPs for this phone
    await this.prisma.oTP.updateMany({
      where: { phone, verifiedAt: null },
      data: { expiresAt: new Date() }, // Expire them immediately
    });

    // Store new OTP
    await this.prisma.oTP.create({
      data: {
        userId,
        phone,
        code,
        expiresAt: addMinutes(new Date(), expiryMinutes),
        maxAttempts: this.config.get<number>('app.otpMaxAttempts', 5),
      },
    });

    // Send via Twilio
    await this.sendViaTwilio(phone, code);

    return code;
  }

  private generateCode(): string {
    // 6-digit OTP
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  private async sendViaTwilio(phone: string, code: string): Promise<void> {
    try {
      const verifyServiceSid = this.config.get<string>('TWILIO_VERIFY_SERVICE_SID');

      if (verifyServiceSid) {
        // Use Twilio Verify Service (recommended)
        await this.twilioClient.verify.v2
          .services(verifyServiceSid)
          .verifications.create({ to: phone, channel: 'sms' });
      } else {
        // Direct SMS
        await this.twilioClient.messages.create({
          body: `Your DeliveryOS OTP is: ${code}. Valid for 10 minutes. Do not share this code.`,
          from: this.config.get<string>('TWILIO_PHONE_NUMBER'),
          to: phone,
        });
      }

      this.logger.log(`OTP sent to ${phone}`);
    } catch (error) {
      this.logger.error(`Failed to send OTP to ${phone}:`, error.message);

      // In development, just log and continue
      if (process.env.NODE_ENV === 'development') {
        this.logger.warn(`[DEV] OTP for ${phone}: (check database)`);
        return;
      }
      throw error;
    }
  }
}
