import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma/prisma.service';
import { OrderStatus, ServiceType, DriverAvailability } from '@prisma/client';

@Injectable()
export class DeliveriesService {
  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
  ) {}

  async getActiveDelivery(driverId: string) {
    // Check food orders
    const foodOrder = await this.prisma.foodOrder.findFirst({
      where: {
        driverId,
        status: {
          in: [
            OrderStatus.ASSIGNED,
            OrderStatus.DRIVER_HEADING_TO_PICKUP,
            OrderStatus.DRIVER_AT_PICKUP,
            OrderStatus.PICKED_UP,
            OrderStatus.IN_TRANSIT,
            OrderStatus.DRIVER_AT_DROPOFF,
          ],
        },
      },
      include: {
        restaurant: true,
        items: { include: { menuItem: true } },
      },
    });

    if (foodOrder) {
      return { serviceType: ServiceType.FOOD_DELIVERY, order: foodOrder };
    }

    // Check rides
    const ride = await this.prisma.ride.findFirst({
      where: {
        driverId,
        status: { in: ['ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'STARTED'] as any },
      },
      include: {
        customer: { select: { name: true, phone: true } },
      },
    });

    if (ride) {
      return { serviceType: ServiceType.RIDE, order: ride };
    }

    return null;
  }

  async updateDeliveryStep(
    driverId: string,
    serviceType: ServiceType,
    orderId: string,
    step: OrderStatus,
  ) {
    if (serviceType === ServiceType.FOOD_DELIVERY) {
      const updated = await this.prisma.foodOrder.update({
        where: { id: orderId },
        data: {
          status: step,
          deliveredAt: step === OrderStatus.DELIVERED ? new Date() : undefined,
          pickedUpAt: step === OrderStatus.PICKED_UP ? new Date() : undefined,
        },
      });

      if (step === OrderStatus.DELIVERED) {
        // Free the driver
        await this.prisma.driver.update({
          where: { id: driverId },
          data: {
            availability: DriverAvailability.ONLINE,
            activeOrderId: null,
            totalTrips: { increment: 1 },
          },
        });
      }

      this.eventEmitter.emit('order:status_updated', {
        serviceType,
        referenceId: orderId,
        status: step,
        customerId: updated.customerId,
      });

      return updated;
    }

    throw new BadRequestException(`Unsupported service type ${serviceType}`);
  }
}
