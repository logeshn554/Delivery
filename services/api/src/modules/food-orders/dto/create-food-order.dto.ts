import {
  IsArray,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentMethod } from '@prisma/client';

export class FoodOrderItemDto {
  @IsString()
  menuItemId: string;

  @IsNumber()
  @IsPositive()
  quantity: number;

  @IsOptional()
  addons?: any;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateFoodOrderDto {
  @IsString()
  restaurantId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FoodOrderItemDto)
  items: FoodOrderItemDto[];

  @IsObject()
  deliveryAddress: Record<string, any>;

  @IsOptional()
  @IsString()
  specialInstructions?: string;

  @IsOptional()
  @IsNumber()
  tipAmount?: number;

  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;
}
