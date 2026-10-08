import { Injectable, NotFoundException, ForbiddenException, ServiceUnavailableException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service';
import { VehicleTransportStatus, PaymentMethod } from '@prisma/client';
import { generateOrderNumber } from '../../common/utils/generate-number.util';

export interface CreateVehicleTransportDto {
  vehicleType: string;
  vehicleMake: string;
  vehicleModel: string;
  vehicleYear: number;
  vehicleColor: string;
  vehicleRegistration: string;
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
    const baseFee = Number(process.env.VEHICLE_TRANSPORT_BASE_FARE_INR);
    if(!Number.isFinite(baseFee)||baseFee<=0)throw new ServiceUnavailableException('Vehicle transport pricing is not configured');
    if(!dto.vehicleYear||!dto.vehicleColor||!dto.vehicleRegistration)throw new BadRequestException('Vehicle year, color and registration are required');
    return this.prisma.vehicleTransport.create({
      data: {
        bookingNumber: generateOrderNumber('VT'),
        customerId,
        status: VehicleTransportStatus.REQUESTED,
        vehicleMake: dto.vehicleMake,
        vehicleModel: dto.vehicleModel,
        vehicleYear: dto.vehicleYear,
        vehicleColor: dto.vehicleColor,
        vehicleRegistration: dto.vehicleRegistration,
        vehicleCondition: dto.conditionDescription || 'RUNNING',
        pickupAddress: dto.pickupAddress,
        pickupLat: dto.pickupLat,
        pickupLng: dto.pickupLng,
        dropoffAddress: dto.dropoffAddress,
        dropoffLat: dto.dropoffLat,
        dropoffLng: dto.dropoffLng,
        baseFare: baseFee,
        totalFare: baseFee,
        paymentMethod: dto.paymentMethod,
      },
    });
  }

  async findById(id: string,userId:string,role:string) {
    const vt = await this.prisma.vehicleTransport.findUnique({
      where: { id },
    });
    if (!vt) throw new NotFoundException('Vehicle transport request not found');
    if(vt.customerId!==userId&&!['ADMIN','SUPER_ADMIN','SUPPORT_AGENT'].includes(role)){
      const driver=vt.driverId?await this.prisma.driver.findUnique({where:{id:vt.driverId},select:{userId:true}}):null;
      if(driver?.userId!==userId)throw new ForbiddenException('This transport belongs to another account');
    }
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
