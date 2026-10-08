import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import {
  CreatePaymentDto,
  VerifyPaymentDto,
  RefundPaymentDto,
} from './dto/create-payment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';

@Controller('payments')
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  async createPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePaymentDto,
  ) {
    return this.paymentsService.createPayment(user.id, dto);
  }

  @Post('verify')
  async verifyPayment(@CurrentUser() user:AuthenticatedUser,@Body() dto: VerifyPaymentDto) {
    return this.paymentsService.verifyPayment(user.id,dto);
  }

  @Post(':id/refund')
  async refundPayment(
    @CurrentUser() user:AuthenticatedUser,
    @Param('id') paymentId: string,
    @Body() dto: RefundPaymentDto,
  ) {
    if(!([UserRole.ADMIN,UserRole.SUPER_ADMIN] as UserRole[]).includes(user.role as UserRole))throw new ForbiddenException('Operations access required');
    return this.paymentsService.initiateRefund(paymentId, dto.amount, dto.reason);
  }
}
