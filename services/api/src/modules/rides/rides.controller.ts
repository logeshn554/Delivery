import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RidesService, CreateRideDto } from './rides.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

@Controller('rides')
@UseGuards(JwtAuthGuard)
export class RidesController {
  constructor(private readonly ridesService: RidesService) {}

  @Post()
  async requestRide(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateRideDto,
  ) {
    return this.ridesService.requestRide(user.id, dto);
  }

  @Get()
  async getMyRides(
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.ridesService.findByCustomer(
      user.id,
      parseInt(page, 10),
      parseInt(limit, 10),
    );
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    return this.ridesService.findById(id);
  }

  @Post(':id/cancel')
  async cancelRide(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body('reason') reason: string,
  ) {
    return this.ridesService.cancelRide(id, user.id, reason);
  }
}
