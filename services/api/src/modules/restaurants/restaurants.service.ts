import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service';

@Injectable()
export class RestaurantsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: { search?: string; cuisine?: string; page?: number; limit?: number }) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = { isActive: true };
    if (query.cuisine) {
      where.cuisines = { has: query.cuisine };
    }
    if (query.search) {
      where.name = { contains: query.search, mode: 'insensitive' };
    }

    const [restaurants, total] = await Promise.all([
      this.prisma.restaurant.findMany({
        where,
        include: {
          categories: {
            include: {
              items: { where: { isAvailable: true } },
            },
          },
        },
        skip,
        take: limit,
      }),
      this.prisma.restaurant.count({ where }),
    ]);

    return {
      restaurants,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findById(id: string) {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id },
      include: {
        categories: {
          include: {
            items: true,
          },
        },
        menuItems: true,
      },
    });

    if (!restaurant) throw new NotFoundException('Restaurant not found');
    return restaurant;
  }

  async findByOwner(userId: string) {
    return this.prisma.restaurant.findFirst({
      where: { ownerId: userId },
      include: {
        categories: { include: { items: true } },
      },
    });
  }

  async toggleOpenStatus(userId: string, isOpen: boolean) {
    const restaurant = await this.findByOwner(userId);
    if (!restaurant) throw new NotFoundException('Restaurant not found');
    return this.prisma.restaurant.update({
      where: { id: restaurant.id },
      data: { isOpen },
    });
  }
}
