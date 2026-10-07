import { Module } from '@nestjs/common';
import { TrackingGateway } from './gateway/tracking.gateway';
import { TrackingService } from './tracking.service';
import { TrackingController } from './tracking.controller';
import { LocationService } from './services/location.service';
import { EtaService } from './services/eta.service';

@Module({
  controllers: [TrackingController],
  providers: [TrackingGateway, TrackingService, LocationService, EtaService],
  exports: [TrackingService, TrackingGateway],
})
export class TrackingModule {}
