import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { CouponsService } from './coupons.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('coupons')
export class CouponsController {
  constructor(private readonly couponsService: CouponsService) {}

  @Get()
  async listActive() {
    return this.couponsService.listActive();
  }

  @UseGuards(JwtAuthGuard)
  @Post('validate')
  async validate(
    @Body('code') code: string,
    @Body('amount') amount: number,
  ) {
    return this.couponsService.validateCoupon(code, amount);
  }
}
