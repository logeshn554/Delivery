import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service';

@Injectable()
export class BusinessesService {
  constructor(private readonly prisma: PrismaService) {}

  async findByOwner(userId: string) {
    const business = await this.prisma.business.findFirst({
      where: { ownerId: userId },
      include: {
        shipments: { take: 10, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!business) throw new NotFoundException('Business account not found');
    return business;
  }

  async getDeliveries(businessId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [deliveries, total] = await Promise.all([
      this.prisma.businessShipment.findMany({
        where: { businessId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.businessShipment.count({ where: { businessId } }),
    ]);

    return { deliveries, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
}
