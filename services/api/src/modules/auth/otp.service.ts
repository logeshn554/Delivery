import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as twilio from 'twilio';
import { PrismaService } from '../../database/prisma/prisma.service';
import { addMinutes } from 'date-fns';
import { randomInt } from 'node:crypto';
import { hashOtpCode } from './otp-code.util';

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private twilioClient: twilio.Twilio;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    this.twilioClient = twilio(
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
        code: hashOtpCode(code),
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
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  private async sendViaTwilio(phone: string, code: string): Promise<void> {
    try {
      await this.twilioClient.messages.create({
        body: `Your GoServe sign-in code is ${code}. It expires in 10 minutes. Do not share it.`,
        from: this.config.get<string>('TWILIO_PHONE_NUMBER'),
        to: phone,
      });

      this.logger.log(`OTP sent to ${phone}`);
    } catch (error) {
      this.logger.error(`Failed to send OTP to ${phone}:`, error.message);

      throw error;
    }
  }
}
