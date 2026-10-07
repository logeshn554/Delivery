import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bull';
import { CacheModule } from '@nestjs/cache-manager';
import * as redisStore from 'cache-manager-redis-yet';
import { TerminusModule } from '@nestjs/terminus';

// Config
import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import jwtConfig from './config/jwt.config';
import mapsConfig from './config/maps.config';
import paymentConfig from './config/payment.config';
import storageConfig from './config/storage.config';

// Core Modules
import { PrismaModule } from './database/prisma/prisma.module';
import { HealthModule } from './health/health.module';

// Feature Modules
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { DriversModule } from './modules/drivers/drivers.module';
import { RestaurantsModule } from './modules/restaurants/restaurants.module';
import { BusinessesModule } from './modules/businesses/businesses.module';
import { FoodOrdersModule } from './modules/food-orders/food-orders.module';
import { RidesModule } from './modules/rides/rides.module';
import { PackagesModule } from './modules/packages/packages.module';
import { VehicleTransportModule } from './modules/vehicle-transport/vehicle-transport.module';
import { DeliveriesModule } from './modules/deliveries/deliveries.module';
import { DispatchModule } from './modules/dispatch/dispatch.module';
import { TrackingModule } from './modules/tracking/tracking.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { RatingsModule } from './modules/ratings/ratings.module';
import { SupportModule } from './modules/support/support.module';
import { CouponsModule } from './modules/coupons/coupons.module';
import { AddressesModule } from './modules/addresses/addresses.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { AdminModule } from './modules/admin/admin.module';

@Module({
  imports: [
    // ─── Configuration ──────────────────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        appConfig,
        databaseConfig,
        jwtConfig,
        mapsConfig,
        paymentConfig,
        storageConfig,
      ],
      envFilePath: ['.env.local', '.env'],
    }),

    // ─── Rate Limiting ──────────────────────────────────────────────────────
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: config.get<number>('app.rateLimitWindowMs', 60000),
            limit: config.get<number>('app.rateLimitMax', 100),
          },
        ],
      }),
    }),

    // ─── Events ─────────────────────────────────────────────────────────────
    EventEmitterModule.forRoot({ wildcard: true }),

    // ─── Scheduler ──────────────────────────────────────────────────────────
    ScheduleModule.forRoot(),

    // ─── Redis Queue ─────────────────────────────────────────────────────────
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        redis: config.get<string>('REDIS_URL'),
        defaultJobOptions: {
          removeOnComplete: 100,
          removeOnFail: 500,
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
        },
      }),
    }),

    // ─── Cache (Redis) ───────────────────────────────────────────────────────
    CacheModule.registerAsync({
      isGlobal: true,
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => ({
        store: redisStore.redisStore,
        url: config.get<string>('REDIS_URL'),
        ttl: 300, // 5 minutes default
      }),
    }),

    // ─── Database ───────────────────────────────────────────────────────────
    PrismaModule,

    // ─── Health ─────────────────────────────────────────────────────────────
    TerminusModule,
    HealthModule,

    // ─── Feature Modules ────────────────────────────────────────────────────
    AuthModule,
    UsersModule,
    DriversModule,
    RestaurantsModule,
    BusinessesModule,
    FoodOrdersModule,
    RidesModule,
    PackagesModule,
    VehicleTransportModule,
    DeliveriesModule,
    DispatchModule,
    TrackingModule,
    PaymentsModule,
    WalletModule,
    NotificationsModule,
    RatingsModule,
    SupportModule,
    CouponsModule,
    AddressesModule,
    UploadsModule,
    AdminModule,
  ],
})
export class AppModule {}
