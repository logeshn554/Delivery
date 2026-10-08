import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PackagesService, CreatePackageDto } from './packages.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

@Controller('packages')
@UseGuards(JwtAuthGuard)
export class PackagesController {
  constructor(private readonly packagesService: PackagesService) {}

  @Post()
  async createPackage(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePackageDto,
  ) {
    return this.packagesService.createPackageDelivery(user.id, dto);
  }

  @Get()
  async getMyPackages(
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.packagesService.findByCustomer(
      user.id,
      parseInt(page, 10),
      parseInt(limit, 10),
    );
  }

  @Get(':id')
  async getById(@Param('id') id: string,@CurrentUser() user:AuthenticatedUser) {
    return this.packagesService.findById(id,user.id,user.role);
  }
}
