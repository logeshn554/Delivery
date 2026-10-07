import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma/prisma.service';
import { DistanceService } from './distance.service';
import { ServiceType, DriverAvailability, DriverStatus } from '@prisma/client';

export interface FindDriversOptions {
  lat: number;
  lng: number;
  radiusKm: number;
  serviceType: ServiceType;
  vehicleTypes?: string[];
  excludeDriverIds?: string[];
}

export interface DriverCandidate {
  driverId: string;
  userId: string;
  name: string;
  avatar: string | null;
  rating: number;
  distanceKm: number;
  estimatedMinutes: number;
  vehicleType: string;
  vehicleMake: string;
  vehicleModel: string;
  vehicleColor: string;
  registrationNumber: string;
}

@Injectable()
export class DriverMatchingService {
  private readonly logger = new Logger(DriverMatchingService.name);

  constructor(
    private prisma: PrismaService,
    private distanceService: DistanceService,
  ) {}

  async findNearbyDrivers(options: FindDriversOptions): Promise<DriverCandidate[]> {
    const { lat, lng, radiusKm, serviceType, vehicleTypes, excludeDriverIds = [] } = options;

    // Find online drivers within radius using bounding box for performance
    // Then filter by exact distance
    const latDelta = radiusKm / 111.32; // 1 degree lat ≈ 111.32 km
    const lngDelta = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180));

    const drivers = await this.prisma.driver.findMany({
      where: {
        status: DriverStatus.APPROVED,
        availability: DriverAvailability.ONLINE,
        serviceTypes: { has: serviceType },
        currentLat: {
          gte: lat - latDelta,
          lte: lat + latDelta,
        },
        currentLng: {
          gte: lng - lngDelta,
          lte: lng + lngDelta,
        },
        id: { notIn: excludeDriverIds },
        vehicle: vehicleTypes?.length
          ? { vehicleType: { in: vehicleTypes as any } }
          : undefined,
      },
      include: {
        user: { select: { id: true, name: true, avatar: true } },
        vehicle: true,
      },
      take: 20, // Consider top 20 candidates
    });

    if (!drivers.length) {
      this.logger.debug(`No drivers found within ${radiusKm}km for ${serviceType}`);
      return [];
    }

    // Calculate exact distances and ETA
    const candidates: DriverCandidate[] = [];

    for (const driver of drivers) {
      if (!driver.currentLat || !driver.currentLng || !driver.vehicle) continue;

      const distanceKm = this.distanceService.haversine(
        lat, lng,
        driver.currentLat,
        driver.currentLng,
      );

      if (distanceKm > radiusKm) continue;

      const estimatedMinutes = this.distanceService.estimateMinutes(distanceKm);

      candidates.push({
        driverId: driver.id,
        userId: driver.user.id,
        name: driver.user.name,
        avatar: driver.user.avatar,
        rating: driver.rating,
        distanceKm: Math.round(distanceKm * 100) / 100,
        estimatedMinutes,
        vehicleType: driver.vehicle.vehicleType,
        vehicleMake: driver.vehicle.make,
        vehicleModel: driver.vehicle.model,
        vehicleColor: driver.vehicle.color,
        registrationNumber: driver.vehicle.registrationNumber,
      });
    }

    // Sort by distance (nearest first)
    return candidates.sort((a, b) => a.distanceKm - b.distanceKm);
  }
}
