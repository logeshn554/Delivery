import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
} from '@nestjs/common';
import { DeliveriesService } from './deliveries.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { OrderStatus, ServiceType } from '@prisma/client';

@Controller('deliveries')
@UseGuards(JwtAuthGuard)
export class DeliveriesController {
  constructor(private readonly deliveriesService: DeliveriesService) {}

  @Get('active')
  async getActiveDelivery(@CurrentUser() user: AuthenticatedUser) {
    return this.deliveriesService.getActiveDelivery(user.id);
  }

  @Patch('step')
  async updateDeliveryStep(
    @CurrentUser() user: AuthenticatedUser,
    @Body('serviceType') serviceType: ServiceType,
    @Body('orderId') orderId: string,
    @Body('step') step: OrderStatus,
  ) {
    return this.deliveriesService.updateDeliveryStep(
      user.id,
      serviceType,
      orderId,
      step,
    );
  }
}
