import { IsEnum, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';
import { PaymentMethod, ServiceType } from '@prisma/client';

export class CreatePaymentDto {
  @IsEnum(ServiceType)
  serviceType: ServiceType;

  @IsString()
  referenceId: string;

  @IsNumber()
  @IsPositive()
  amount: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  @IsOptional()
  @IsString()
  description?: string;
}

export class VerifyPaymentDto {
  @IsString()
  paymentId: string;

  @IsString()
  providerPaymentId: string;

  @IsOptional()
  @IsString()
  providerSignature?: string;
}

export class RefundPaymentDto {
  @IsNumber()
  @IsPositive()
  amount: number;

  @IsString()
  reason: string;
}
