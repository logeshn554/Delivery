import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma/prisma.service';
import { FirebaseProvider } from './providers/firebase.provider';
import { SmsProvider } from './providers/sms.provider';
import { EmailProvider } from './providers/email.provider';
import { NotificationChannel, NotificationStatus } from '@prisma/client';

export interface SendNotificationDto {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, any>;
  channels?: NotificationChannel[];
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private firebase: FirebaseProvider,
    private sms: SmsProvider,
    private email: EmailProvider,
  ) {}

  async send(dto: SendNotificationDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
      select: { fcmTokens: true, phone: true, email: true, preferredLanguage: true },
    });

    if (!user) return;

    const channels = dto.channels || [NotificationChannel.PUSH, NotificationChannel.IN_APP];

    // Store notification in DB
    const notification = await this.prisma.notification.create({
      data: {
        userId: dto.userId,
        title: dto.title,
        body: dto.body,
        data: dto.data || {},
        channel: NotificationChannel.IN_APP,
        status: NotificationStatus.PENDING,
      },
    });

    const promises = [];

    // Push notification via FCM
    if (channels.includes(NotificationChannel.PUSH) && user.fcmTokens.length > 0) {
      promises.push(
        this.firebase.sendToTokens(user.fcmTokens, {
          title: dto.title,
          body: dto.body,
          data: dto.data,
        }),
      );
    }

    // SMS notification
    if (channels.includes(NotificationChannel.SMS) && user.phone) {
      promises.push(
        this.sms.send(user.phone, `${dto.title}: ${dto.body}`),
      );
    }

    // Email notification
    if (channels.includes(NotificationChannel.EMAIL) && user.email) {
      promises.push(
        this.email.send({
          to: user.email,
          subject: dto.title,
          text: dto.body,
        }),
      );
    }

    const results = await Promise.allSettled(promises);
    const allSucceeded = results.every(r => r.status === 'fulfilled');

    await this.prisma.notification.update({
      where: { id: notification.id },
      data: {
        status: allSucceeded ? NotificationStatus.SENT : NotificationStatus.FAILED,
        sentAt: new Date(),
      },
    });

    return notification;
  }

  async markAsRead(notificationId: string, userId: string) {
    return this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { isRead: true, readAt: new Date() },
    });
  }

  async markAllAsRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
  }

  async getUnread(userId: string, limit = 20) {
    return this.prisma.notification.findMany({
      where: { userId, isRead: false },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  // ─── Event Listeners ──────────────────────────────────────────────────────

  @OnEvent('food_order.created')
  async onFoodOrderCreated(payload: { orderId: string; customerId: string; restaurantId: string }) {
    await this.send({
      userId: payload.customerId,
      title: '🍽️ Order Placed!',
      body: 'Your food order has been placed. Waiting for restaurant confirmation.',
      data: { orderId: payload.orderId, type: 'FOOD_ORDER' },
    });
  }

  @OnEvent('dispatch.accepted')
  async onDispatchAccepted(payload: { driverId: string; referenceId: string; serviceType: string }) {
    const dispatch = await this.prisma.dispatch.findFirst({
      where: { referenceId: payload.referenceId },
    });

    if (dispatch) {
      const order = await this.prisma.foodOrder.findUnique({
        where: { id: payload.referenceId },
        select: { customerId: true },
      });

      if (order) {
        await this.send({
          userId: order.customerId,
          title: '🛵 Driver Assigned!',
          body: 'A driver has been assigned to your order and is heading to pick it up.',
          data: { orderId: payload.referenceId, type: 'DRIVER_ASSIGNED' },
          channels: [NotificationChannel.PUSH, NotificationChannel.IN_APP],
        });
      }
    }
  }

  @OnEvent('payment.completed')
  async onPaymentCompleted(payload: { paymentId: string; referenceId: string }) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: payload.paymentId },
    });

    if (payment) {
      await this.send({
        userId: payment.userId,
        title: '✅ Payment Successful',
        body: `Payment of ₹${payment.amount} was successful.`,
        data: { paymentId: payload.paymentId, type: 'PAYMENT' },
      });
    }
  }
}
