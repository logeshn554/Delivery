import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { DispatchService } from './dispatch.service';
import { DispatchController } from './dispatch.controller';
import { DriverMatchingService } from './matching/driver-matching.service';
import { DistanceService } from './matching/distance.service';
import { AvailabilityService } from './matching/availability.service';
import { NearestDriverStrategy } from './strategies/nearest-driver.strategy';
import { LowestEtaStrategy } from './strategies/lowest-eta.strategy';
import { DISPATCH_QUEUE } from './constants/dispatch.constants';
import { DispatchProcessor } from './dispatch.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: DISPATCH_QUEUE }),
  ],
  controllers: [DispatchController],
  providers: [
    DispatchService,
    DispatchProcessor,
    DriverMatchingService,
    DistanceService,
    AvailabilityService,
    NearestDriverStrategy,
    LowestEtaStrategy,
  ],
  exports: [DispatchService],
})
export class DispatchModule {}
