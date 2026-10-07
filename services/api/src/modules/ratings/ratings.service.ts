import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service';

export interface CreateRatingDto {
  targetUserId?: string;
  driverId?: string;
  restaurantId?: string;
  score: number;
  review?: string;
  tags?: string[];
}

@Injectable()
export class RatingsService {
  constructor(private prisma: PrismaService) {}

  async create(raterId: string, dto: CreateRatingDto) {
    if (dto.score < 1 || dto.score > 5) {
      throw new BadRequestException('Rating score must be between 1 and 5');
    }

    const rating = await this.prisma.rating.create({
      data: {
        raterId,
        ratedUserId: dto.targetUserId,
        driverId: dto.driverId,
        restaurantId: dto.restaurantId,
        rating: dto.score,
        comment: dto.review,
        tags: dto.tags || [],
      },
    });

    // Update driver rating if applicable
    if (dto.driverId) {
      const all = await this.prisma.rating.findMany({
        where: { driverId: dto.driverId },
        select: { rating: true },
      });
      const avg = all.reduce((sum, r) => sum + r.rating, 0) / all.length;
      await this.prisma.driver.update({
        where: { id: dto.driverId },
        data: { rating: Math.round(avg * 10) / 10 },
      });
    }

    return rating;
  }
}
