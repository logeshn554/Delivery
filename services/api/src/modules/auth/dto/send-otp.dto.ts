import { IsString, IsPhoneNumber, Matches, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { IsIn, IsOptional } from 'class-validator';

export class SendOtpDto {
  @ApiProperty({ example: '+919876543210' })
  @IsString()
  @IsPhoneNumber()
  phone: string;

  @ApiProperty({ enum: UserRole, required: false })
  @IsOptional()
  @IsIn([UserRole.CUSTOMER, UserRole.DRIVER, UserRole.RESTAURANT_OWNER, UserRole.BUSINESS_OWNER])
  role?: UserRole;
}
