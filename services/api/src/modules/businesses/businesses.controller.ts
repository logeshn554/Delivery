import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { BusinessesService } from './businesses.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

@Controller('businesses')
@UseGuards(JwtAuthGuard)
export class BusinessesController {
  constructor(private readonly businessesService: BusinessesService) {}

  @Get('me')
  async getMyBusiness(@CurrentUser() user: AuthenticatedUser) {
    return this.businessesService.findByOwner(user.id);
  }

  @Get('me/deliveries')
  async getMyDeliveries(
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    const business = await this.businessesService.findByOwner(user.id);
    return this.businessesService.getDeliveries(
      business.id,
      parseInt(page, 10),
      parseInt(limit, 10),
    );
  }
}
