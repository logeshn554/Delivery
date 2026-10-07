import { Module } from '@nestjs/common';
import { FoodOrdersService } from './food-orders.service';
import { FoodOrdersController } from './food-orders.controller';
import { DispatchModule } from '../dispatch/dispatch.module';

@Module({
  imports: [DispatchModule],
  controllers: [FoodOrdersController],
  providers: [FoodOrdersService],
  exports: [FoodOrdersService],
})
export class FoodOrdersModule {}
