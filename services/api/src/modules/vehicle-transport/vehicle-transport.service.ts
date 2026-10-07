import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service';
import { VehicleTransportStatus, PaymentMethod } from '@prisma/client';
import { generateOrderNumber } from '../../common/utils/generate-number.util';

export interface CreateVehicleTransportDto {
  vehicleType: string;
  vehicleMake: string;
  vehicleModel: string;
  vehicleYear?: number;
  conditionDescription?: string;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  dropoffAddress: string;
  dropoffLat: number;
  dropoffLng: number;
  paymentMethod: PaymentMethod;
}

@Injectable()
export class VehicleTransportService {
  constructor(private prisma: PrismaService) {}

  async createRequest(customerId: string, dto: CreateVehicleTransportDto) {
    const baseFee = 500;
    return this.prisma.vehicleTransport.create({
      data: {
        bookingNumber: generateOrderNumber('VT'),
        customerId,
        status: VehicleTransportStatus.REQUESTED,
        transportVehicleType: dto.vehicleType as any,
        make: dto.vehicleMake,
        model: dto.vehicleModel,
        year: dto.vehicleYear,
        condition: dto.conditionDescription || 'RUNNING',
        pickupAddress: dto.pickupAddress,
        pickupLat: dto.pickupLat,
        pickupLng: dto.pickupLng,
        dropoffAddress: dto.dropoffAddress,
        dropoffLat: dto.dropoffLat,
        dropoffLng: dto.dropoffLng,
        totalAmount: baseFee,
        paymentMethod: dto.paymentMethod,
      },
    });
  }

  async findById(id: string) {
    const vt = await this.prisma.vehicleTransport.findUnique({
      where: { id },
      include: {
        driver: {
          include: {
            user: { select: { name: true, phone: true } },
          },
        },
      },
    });
    if (!vt) throw new NotFoundException('Vehicle transport request not found');
    return vt;
  }

  async findByCustomer(customerId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [transports, total] = await Promise.all([
      this.prisma.vehicleTransport.findMany({
        where: { customerId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.vehicleTransport.count({ where: { customerId } }),
    ]);

    return { transports, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
}
