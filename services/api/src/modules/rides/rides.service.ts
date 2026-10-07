import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma/prisma.service';
import { DispatchService } from '../dispatch/dispatch.service';
import { RideStatus, ServiceType, PaymentMethod, VehicleType } from '@prisma/client';
import { generateOrderNumber } from '../../common/utils/generate-number.util';

export interface CreateRideDto {
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  dropoffAddress: string;
  dropoffLat: number;
  dropoffLng: number;
  vehicleType: VehicleType;
  paymentMethod: PaymentMethod;
}

@Injectable()
export class RidesService {
  constructor(
    private prisma: PrismaService,
    private dispatch: DispatchService,
    private eventEmitter: EventEmitter2,
  ) {}

  async requestRide(customerId: string, dto: CreateRideDto) {
    // Calculate estimated fare
    const baseFare = 50;
    const estimatedDistanceKm = 5;
    const perKmRate = 14;
    const estimatedFare = baseFare + estimatedDistanceKm * perKmRate;

    const ride = await this.prisma.ride.create({
      data: {
        rideNumber: generateOrderNumber('RD'),
        customerId,
        status: RideStatus.REQUESTED,
        vehicleType: dto.vehicleType,
        pickupAddress: dto.pickupAddress,
        pickupLat: dto.pickupLat,
        pickupLng: dto.pickupLng,
        dropoffAddress: dto.dropoffAddress,
        dropoffLat: dto.dropoffLat,
        dropoffLng: dto.dropoffLng,
        estimatedDistanceKm,
        estimatedFare,
        totalFare: estimatedFare,
        paymentMethod: dto.paymentMethod,
      },
    });

    // Start dispatch
    await this.dispatch.startDispatch({
      serviceType: ServiceType.RIDE,
      referenceId: ride.id,
      pickupLat: dto.pickupLat,
      pickupLng: dto.pickupLng,
      vehicleTypes: [dto.vehicleType],
    });

    this.eventEmitter.emit('ride.requested', { rideId: ride.id, customerId });
    return ride;
  }

  async findById(rideId: string) {
    const ride = await this.prisma.ride.findUnique({
      where: { id: rideId },
      include: {
        driver: {
          include: {
            user: { select: { name: true, phone: true, avatar: true } },
          },
        },
      },
    });
    if (!ride) throw new NotFoundException('Ride not found');
    return ride;
  }

  async findByCustomer(customerId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [rides, total] = await Promise.all([
      this.prisma.ride.findMany({
        where: { customerId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.ride.count({ where: { customerId } }),
    ]);

    return { rides, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async cancelRide(rideId: string, userId: string, reason: string) {
    const ride = await this.findById(rideId);
    if ([RideStatus.COMPLETED, RideStatus.CANCELLED].includes(ride.status)) {
      throw new BadRequestException('Ride cannot be cancelled');
    }

    const updated = await this.prisma.ride.update({
      where: { id: rideId },
      data: {
        status: RideStatus.CANCELLED,
        cancelReason: reason,
        cancelledBy: userId,
        cancelledAt: new Date(),
      },
    });

    this.eventEmitter.emit('ride.cancelled', { rideId, userId, reason });
    return updated;
  }
}
