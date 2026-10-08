import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service';
import { ServiceType, RatingTarget } from '@prisma/client';

export interface CreateRatingDto {
  serviceType: ServiceType;
  referenceId: string;
  target: RatingTarget;
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
    if(!dto.serviceType||!dto.referenceId||!dto.target)throw new BadRequestException('A delivered service and rating target are required');
    const previous=await this.prisma.rating.findFirst({where:{raterId,serviceType:dto.serviceType,referenceId:dto.referenceId,target:dto.target}});
    if(previous)throw new BadRequestException('You already rated this delivery');

    const rating = await this.prisma.rating.create({
      data: {
        raterId,
        ratedUserId: dto.targetUserId,
        ratedDriverId: dto.driverId,
        ratedRestaurantId: dto.restaurantId,
        serviceType:dto.serviceType,
        referenceId:dto.referenceId,
        target:dto.target,
        score: dto.score,
        comment: dto.review,
        tags: dto.tags || [],
      },
    });

    // Update driver rating if applicable
    if (dto.driverId) {
      const all = await this.prisma.rating.findMany({
        where: { ratedDriverId: dto.driverId },
        select: { score: true },
      });
      const avg = all.reduce((sum, r) => sum + r.score, 0) / all.length;
      await this.prisma.driver.update({
        where: { id: dto.driverId },
        data: { rating: Math.round(avg * 10) / 10 },
      });
    }

    return rating;
  }
}
