import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
} from '@nestjs/common';
import { DriversService } from './drivers.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { DriverAvailability } from '@prisma/client';

@Controller('drivers')
@UseGuards(JwtAuthGuard)
export class DriversController {
  constructor(private readonly driversService: DriversService) {}

  @Get('me')
  async getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.driversService.findByUserId(user.id);
  }

  @Patch('me/availability')
  async setAvailability(
    @CurrentUser() user: AuthenticatedUser,
    @Body('availability') availability: DriverAvailability,
  ) {
    return this.driversService.setAvailability(user.id, availability);
  }

  @Patch('me/location')
  async updateLocation(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { lat: number; lng: number; heading?: number; speed?: number },
  ) {
    return this.driversService.updateLocation(user.id, body);
  }

  @Get('me/earnings')
  async getEarnings(@CurrentUser() user: AuthenticatedUser) {
    return this.driversService.getEarnings(user.id);
  }
}
