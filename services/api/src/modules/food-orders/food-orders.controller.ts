import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { FoodOrdersService } from './food-orders.service';
import { CreateFoodOrderDto } from './dto/create-food-order.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { OrderStatus } from '@prisma/client';

@Controller('food-orders')
@UseGuards(JwtAuthGuard)
export class FoodOrdersController {
  constructor(private readonly foodOrdersService: FoodOrdersService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateFoodOrderDto,
  ) {
    return this.foodOrdersService.create(user.id, dto);
  }

  @Get()
  async getMyOrders(
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.foodOrdersService.findByCustomer(user.id, parseInt(page, 10), parseInt(limit, 10));
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    return this.foodOrdersService.findById(id);
  }

  @Patch(':id/confirm')
  async confirmOrder(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.foodOrdersService.confirmOrder(id, user.id);
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body('status') status: OrderStatus,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.foodOrdersService.updateStatus(id, status, user.id);
  }

  @Post(':id/cancel')
  async cancel(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.foodOrdersService.cancel(id, user.id, reason);
  }
}
