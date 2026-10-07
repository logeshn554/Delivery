import { Module } from '@nestjs/common';
import { VehicleTransportService } from './vehicle-transport.service';
import { VehicleTransportController } from './vehicle-transport.controller';

@Module({
  controllers: [VehicleTransportController],
  providers: [VehicleTransportService],
  exports: [VehicleTransportService],
})
export class VehicleTransportModule {}
