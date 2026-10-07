import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as sgMail from '@sendgrid/mail';

@Injectable()
export class EmailProvider {
  private readonly logger = new Logger(EmailProvider.name);
  private configured = false;

  constructor(private config: ConfigService) {
    const apiKey = config.get<string>('SENDGRID_API_KEY');
    if (apiKey) {
      sgMail.setApiKey(apiKey);
      this.configured = true;
    } else {
      this.logger.warn('SendGrid not configured — email notifications disabled');
    }
  }

  async send(params: {
    to: string;
    subject: string;
    text: string;
    html?: string;
  }): Promise<void> {
    if (!this.configured) {
      this.logger.debug(`[DEV] Email to ${params.to}: ${params.subject}`);
      return;
    }

    try {
      await sgMail.send({
        to: params.to,
        from: this.config.get<string>('EMAIL_FROM', 'noreply@deliveryos.com'),
        subject: params.subject,
        text: params.text,
        html: params.html || `<p>${params.text}</p>`,
      });
    } catch (error) {
      this.logger.error(`Email failed to ${params.to}:`, error.message);
    }
  }
}
