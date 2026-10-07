import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';

@Injectable()
export class FirebaseProvider {
  private readonly logger = new Logger(FirebaseProvider.name);
  private app: admin.app.App | null = null;

  constructor(private config: ConfigService) {
    this.initialize();
  }

  private initialize() {
    try {
      const privateKey = this.config.get<string>('FIREBASE_PRIVATE_KEY')?.replace(/\\n/g, '\n');

      if (!this.config.get('FIREBASE_PROJECT_ID') || !privateKey) {
        this.logger.warn('Firebase not configured — push notifications disabled');
        return;
      }

      if (!admin.apps.length) {
        this.app = admin.initializeApp({
          credential: admin.credential.cert({
            projectId: this.config.get<string>('FIREBASE_PROJECT_ID'),
            clientEmail: this.config.get<string>('FIREBASE_CLIENT_EMAIL'),
            privateKey,
          }),
        });
      } else {
        this.app = admin.apps[0]!;
      }
    } catch (error) {
      this.logger.error('Failed to initialize Firebase:', error.message);
    }
  }

  async sendToToken(token: string, notification: { title: string; body: string; data?: Record<string, any> }) {
    if (!this.app) return;

    try {
      await admin.messaging().send({
        token,
        notification: {
          title: notification.title,
          body: notification.body,
        },
        data: notification.data
          ? Object.fromEntries(
              Object.entries(notification.data).map(([k, v]) => [k, String(v)]),
            )
          : undefined,
        android: { priority: 'high' },
        apns: { payload: { aps: { sound: 'default' } } },
      });
    } catch (error) {
      this.logger.error(`Failed to send push to ${token}:`, error.message);
    }
  }

  async sendToTokens(tokens: string[], notification: { title: string; body: string; data?: Record<string, any> }) {
    if (!this.app || !tokens.length) return;

    try {
      const response = await admin.messaging().sendEachForMulticast({
        tokens,
        notification: {
          title: notification.title,
          body: notification.body,
        },
        data: notification.data
          ? Object.fromEntries(
              Object.entries(notification.data).map(([k, v]) => [k, String(v)]),
            )
          : undefined,
        android: { priority: 'high' },
        apns: { payload: { aps: { sound: 'default' } } },
      });

      this.logger.debug(
        `Push sent: ${response.successCount}/${tokens.length} succeeded`,
      );
    } catch (error) {
      this.logger.error('Multicast push failed:', error.message);
    }
  }
}
