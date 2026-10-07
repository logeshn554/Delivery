import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { RestaurantsService } from './restaurants.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

@Controller('restaurants')
export class RestaurantsController {
  constructor(private readonly restaurantsService: RestaurantsService) {}

  @Get()
  async findAll(
    @Query('search') search?: string,
    @Query('cuisine') cuisine?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.restaurantsService.findAll({
      search,
      cuisine,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.restaurantsService.findById(id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('portal/my-restaurant')
  async getMyRestaurant(@CurrentUser() user: AuthenticatedUser) {
    return this.restaurantsService.findByOwner(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('portal/toggle-open')
  async toggleOpen(
    @CurrentUser() user: AuthenticatedUser,
    @Body('isOpen') isOpen: boolean,
  ) {
    return this.restaurantsService.toggleOpenStatus(user.id, isOpen);
  }
}
