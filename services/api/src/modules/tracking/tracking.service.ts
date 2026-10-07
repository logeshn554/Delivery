import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service';
import { LocationService } from './services/location.service';
import { EtaService } from './services/eta.service';

@Injectable()
export class TrackingService {
  constructor(
    private prisma: PrismaService,
    private locationService: LocationService,
    private etaService: EtaService,
  ) {}

  async getTrackingDetails(serviceType: string, referenceId: string) {
    let order: any = null;

    if (serviceType === 'FOOD_DELIVERY') {
      order = await this.prisma.foodOrder.findUnique({
        where: { id: referenceId },
        include: {
          restaurant: {
            select: { name: true, address: true, latitude: true, longitude: true },
          },
          driver: {
            include: {
              user: { select: { name: true, phone: true, avatar: true } },
            },
          },
        },
      });
    } else if (serviceType === 'RIDE') {
      order = await this.prisma.ride.findUnique({
        where: { id: referenceId },
        include: {
          driver: {
            include: {
              user: { select: { name: true, phone: true, avatar: true } },
            },
          },
        },
      });
    }

    if (!order) {
      throw new NotFoundException(`Order ${referenceId} not found`);
    }

    let eta: { distanceKm: number; etaMinutes: number } | null = null;
    if (order.driver && order.driver.currentLat && order.driver.currentLng && order.dropoffLat && order.dropoffLng) {
      eta = this.etaService.calculateEta(
        order.driver.currentLat,
        order.driver.currentLng,
        order.dropoffLat,
        order.dropoffLng,
      );
    }

    return {
      order,
      eta,
      driverLocation: order.driver
        ? {
            lat: order.driver.currentLat,
            lng: order.driver.currentLng,
            heading: order.driver.currentHeading,
            speed: order.driver.currentSpeed,
            lastUpdated: order.driver.lastLocationAt,
          }
        : null,
    };
  }
}
