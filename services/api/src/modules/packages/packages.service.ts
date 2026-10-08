import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma/prisma.service';
import { DispatchService } from '../dispatch/dispatch.service';
import { PackageStatus, ServiceType, PaymentMethod } from '@prisma/client';
import { generateOrderNumber } from '../../common/utils/generate-number.util';

export interface CreatePackageDto {
  senderName: string;
  senderPhone: string;
  senderAddress: string;
  senderLat: number;
  senderLng: number;
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string;
  recipientLat: number;
  recipientLng: number;
  packageType: string;
  weightKg?: number;
  instructions?: string;
  paymentMethod: PaymentMethod;
}

@Injectable()
export class PackagesService {
  constructor(
    private prisma: PrismaService,
    private dispatch: DispatchService,
    private eventEmitter: EventEmitter2,
  ) {}

  async createPackageDelivery(customerId: string, dto: CreatePackageDto) {
    const deliveryFee = 60; // Base parcel delivery fee
    const pkg = await this.prisma.package.create({
      data: {
        trackingNumber: generateOrderNumber('PKG'),
        customerId,
        status: PackageStatus.PENDING,
        packageType: dto.packageType as any,
        weightKg: dto.weightKg || 1,
        senderName: dto.senderName,
        senderPhone: dto.senderPhone,
        senderAddress: {line1:dto.senderAddress,lat:dto.senderLat,lng:dto.senderLng},
        receiverName: dto.recipientName,
        receiverPhone: dto.recipientPhone,
        receiverAddress: {line1:dto.recipientAddress,lat:dto.recipientLat,lng:dto.recipientLng},
        deliveryInstructions: dto.instructions,
        baseFare: deliveryFee,
        weightFare: 0,
        totalFare: deliveryFee,
        paymentMethod: dto.paymentMethod,
      },
    });

    await this.dispatch.startDispatch({
      serviceType: ServiceType.PACKAGE_DELIVERY,
      referenceId: pkg.id,
      pickupLat: dto.senderLat,
      pickupLng: dto.senderLng,
    });

    this.eventEmitter.emit('package.created', { packageId: pkg.id, customerId });
    return pkg;
  }

  async findById(id: string, userId: string, role: string) {
    const pkg = await this.prisma.package.findUnique({
      where: { id },
    });
    if (!pkg) throw new NotFoundException('Package delivery not found');
    if(pkg.customerId!==userId&&!['ADMIN','SUPER_ADMIN','SUPPORT_AGENT'].includes(role)){
      const driver=pkg.driverId?await this.prisma.driver.findUnique({where:{id:pkg.driverId},select:{userId:true}}):null;
      if(driver?.userId!==userId)throw new ForbiddenException('This delivery belongs to another account');
    }
    return pkg;
  }

  async findByCustomer(customerId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [packages, total] = await Promise.all([
      this.prisma.package.findMany({
        where: { customerId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.package.count({ where: { customerId } }),
    ]);

    return { packages, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
}
