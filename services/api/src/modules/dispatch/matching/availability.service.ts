import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma/prisma.service';
import { DriverAvailability, DriverStatus } from '@prisma/client';

@Injectable()
export class AvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async isDriverAvailable(driverId: string): Promise<boolean> {
    const driver = await this.prisma.driver.findUnique({
      where: { id: driverId },
      select: {
        status: true,
        availability: true,
      },
    });

    if (!driver) return false;
    return (
      driver.status === DriverStatus.APPROVED &&
      driver.availability === DriverAvailability.ONLINE
    );
  }

  async setDriverAvailability(driverId: string, availability: DriverAvailability) {
    return this.prisma.driver.update({
      where: { id: driverId },
      data: { availability },
    });
  }
}
