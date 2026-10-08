import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { TrackingService } from './tracking.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

@Controller('tracking')
@UseGuards(JwtAuthGuard)
export class TrackingController {
  constructor(private readonly trackingService: TrackingService) {}

  @Get(':serviceType/:referenceId')
  async getTrackingDetails(
    @CurrentUser() user: AuthenticatedUser,
    @Param('serviceType') serviceType: string,
    @Param('referenceId') referenceId: string,
  ) {
    return this.trackingService.getTrackingDetails(user.id,user.role,serviceType, referenceId);
  }
}
