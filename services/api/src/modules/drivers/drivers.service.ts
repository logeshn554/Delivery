import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service';
import { DriverAvailability, DriverStatus } from '@prisma/client';

@Injectable()
export class DriversService {
  constructor(private readonly prisma: PrismaService) {}

  async findByUserId(userId: string) {
    const driver = await this.prisma.driver.findUnique({
      where: { userId },
      include: {
        user: { select: { name: true, email: true, phone: true, avatar: true } },
        documents: true,
      },
    });
    if (!driver) throw new NotFoundException('Driver profile not found');
    return driver;
  }

  async setAvailability(userId: string, availability: DriverAvailability) {
    const driver = await this.findByUserId(userId);
    if (driver.status !== DriverStatus.APPROVED && availability === DriverAvailability.ONLINE) {
      throw new BadRequestException('Driver account is not approved yet');
    }
    return this.prisma.driver.update({
      where: { id: driver.id },
      data: { availability },
    });
  }

  async updateLocation(
    userId: string,
    data: { lat: number; lng: number; heading?: number; speed?: number },
  ) {
    const driver = await this.findByUserId(userId);
    return this.prisma.driver.update({
      where: { id: driver.id },
      data: {
        currentLat: data.lat,
        currentLng: data.lng,
        currentHeading: data.heading,
        currentSpeed: data.speed,
        lastLocationAt: new Date(),
      },
    });
  }

  async getEarnings(userId: string) {
    const driver = await this.findByUserId(userId);
    const wallet = await this.prisma.wallet.findFirst({
      where: { driverId: driver.id },
      include: {
        transactions: {
          orderBy: { createdAt: 'desc' },
          take: 30,
        },
      },
    });
    return {
      balance: wallet?.balance || 0,
      totalEarnings: driver.totalEarnings || 0,
      totalTrips: driver.totalTrips || 0,
      rating: driver.rating || 5.0,
      transactions: wallet?.transactions || [],
    };
  }
}
