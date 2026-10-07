import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { TrackingService } from './tracking.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('tracking')
@UseGuards(JwtAuthGuard)
export class TrackingController {
  constructor(private readonly trackingService: TrackingService) {}

  @Get(':serviceType/:referenceId')
  async getTrackingDetails(
    @Param('serviceType') serviceType: string,
    @Param('referenceId') referenceId: string,
  ) {
    return this.trackingService.getTrackingDetails(serviceType, referenceId);
  }
}
