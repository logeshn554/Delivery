import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
} from '@nestjs/common';
import { WalletService } from './wallet.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get()
  async getWallet(@CurrentUser() user: AuthenticatedUser) {
    return this.walletService.getWallet(user.id);
  }

  @Post('add-funds')
  async addFunds(
    @CurrentUser() user: AuthenticatedUser,
    @Body('amount') amount: number,
  ) {
    return this.walletService.credit({
      userId: user.id,
      amount,
      reason: 'TOP_UP' as any,
      description: 'Wallet top-up',
    });
  }
}
