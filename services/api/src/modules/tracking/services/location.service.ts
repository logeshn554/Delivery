import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma/prisma.service';

@Injectable()
export class LocationService {
  constructor(private readonly prisma: PrismaService) {}

  async updateDriverLocation(
    driverId: string,
    latitude: number,
    longitude: number,
    heading?: number,
    speed?: number,
  ) {
    return this.prisma.driver.update({
      where: { id: driverId },
      data: {
        currentLat: latitude,
        currentLng: longitude,
        heading,
        speed,
        lastLocationAt: new Date(),
      },
    });
  }

  async getDriverLocation(driverId: string) {
    const driver = await this.prisma.driver.findUnique({
      where: { id: driverId },
      select: {
        currentLat: true,
        currentLng: true,
        heading: true,
        speed: true,
        lastLocationAt: true,
      },
    });

    return driver;
  }
}
