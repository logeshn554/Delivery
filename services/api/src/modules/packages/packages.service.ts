import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
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
        packageNumber: generateOrderNumber('PKG'),
        customerId,
        status: PackageStatus.PENDING,
        packageType: dto.packageType as any,
        weightKg: dto.weightKg || 1,
        senderName: dto.senderName,
        senderPhone: dto.senderPhone,
        senderAddress: dto.senderAddress,
        senderLat: dto.senderLat,
        senderLng: dto.senderLng,
        recipientName: dto.recipientName,
        recipientPhone: dto.recipientPhone,
        recipientAddress: dto.recipientAddress,
        recipientLat: dto.recipientLat,
        recipientLng: dto.recipientLng,
        instructions: dto.instructions,
        deliveryFee,
        totalAmount: deliveryFee,
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

  async findById(id: string) {
    const pkg = await this.prisma.package.findUnique({
      where: { id },
      include: {
        driver: {
          include: {
            user: { select: { name: true, phone: true, avatar: true } },
          },
        },
      },
    });
    if (!pkg) throw new NotFoundException('Package delivery not found');
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
