import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service';
import { DriverStatus, DriverAvailability } from '@prisma/client';

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  async getDashboardStats() {
    const [
      totalUsers,
      totalDrivers,
      activeDrivers,
      foodOrdersCount,
      ridesCount,
      packagesCount,
      paymentsAggregate,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.driver.count(),
      this.prisma.driver.count({ where: { availability: DriverAvailability.ONLINE } }),
      this.prisma.foodOrder.count(),
      this.prisma.ride.count(),
      this.prisma.package.count(),
      this.prisma.payment.aggregate({
        where: { status: 'COMPLETED' },
        _sum: { amount: true },
      }),
    ]);

    return {
      totalUsers,
      totalDrivers,
      activeDrivers,
      totalOrders: foodOrdersCount + ridesCount + packagesCount,
      totalRevenue: paymentsAggregate._sum.amount || 0,
      breakdown: {
        foodOrders: foodOrdersCount,
        rides: ridesCount,
        packages: packagesCount,
      },
    };
  }

  async getDrivers(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [drivers, total] = await Promise.all([
      this.prisma.driver.findMany({
        include: {
          user: { select: { name: true, phone: true, email: true } },
          documents: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.driver.count(),
    ]);

    return { drivers, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async updateDriverStatus(driverId: string, status: DriverStatus) {
    return this.prisma.driver.update({
      where: { id: driverId },
      data: { status },
    });
  }
}
