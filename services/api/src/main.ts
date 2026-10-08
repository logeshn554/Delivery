import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { IoAdapter } from '@nestjs/platform-socket.io';
import helmet from 'helmet';
import * as compression from 'compression';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrap() {
  if(process.env.NODE_ENV==='production'&&(!process.env.JWT_SECRET||process.env.JWT_SECRET.length<32||!process.env.JWT_REFRESH_SECRET||process.env.JWT_REFRESH_SECRET.length<32))throw new Error('Production JWT secrets must each have at least 32 characters.');
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'],
    rawBody: true,
  });

  // ─── Security ─────────────────────────────────────────────────────────────
  app.use(helmet());
  app.use(compression());

  app.enableCors({
    origin: process.env.CORS_ORIGINS?.split(',') || [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:3002',
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  });

  // ─── Versioning ───────────────────────────────────────────────────────────
  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  // ─── Global Pipes & Filters ───────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(
    new LoggingInterceptor(),
    new TransformInterceptor(),
  );

  // ─── WebSocket ────────────────────────────────────────────────────────────
  app.useWebSocketAdapter(new IoAdapter(app));

  // ─── Swagger ─────────────────────────────────────────────────────────────
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('DeliveryOS API')
      .setDescription('All-in-One Delivery & Mobility Platform API')
      .setVersion('1.0')
      .addBearerAuth()
      .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header' }, 'api-key')
      .addTag('auth', 'Authentication & OTP')
      .addTag('users', 'User Management')
      .addTag('drivers', 'Driver Management')
      .addTag('restaurants', 'Restaurant & Menu')
      .addTag('food-orders', 'Food Ordering')
      .addTag('rides', 'Ride Booking')
      .addTag('packages', 'Package Delivery')
      .addTag('vehicle-transport', 'Vehicle Transport')
      .addTag('dispatch', 'Dispatch Engine')
      .addTag('tracking', 'Live Tracking')
      .addTag('payments', 'Payments & Refunds')
      .addTag('wallet', 'Wallet')
      .addTag('ratings', 'Ratings & Reviews')
      .addTag('notifications', 'Notifications')
      .addTag('support', 'Customer Support')
      .addTag('admin', 'Admin Operations')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
      },
    });
    logger.log('Swagger UI available at /api/docs');
  }

  const port = process.env.API_PORT || 4000;
  await app.listen(port);
  logger.log(`🚀 DeliveryOS API running on http://localhost:${port}`);
  logger.log(`📚 API Docs: http://localhost:${port}/api/docs`);
}

bootstrap();
