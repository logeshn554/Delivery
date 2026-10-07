import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  VehicleTransportService,
  CreateVehicleTransportDto,
} from './vehicle-transport.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

@Controller('vehicle-transport')
@UseGuards(JwtAuthGuard)
export class VehicleTransportController {
  constructor(private readonly vtService: VehicleTransportService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateVehicleTransportDto,
  ) {
    return this.vtService.createRequest(user.id, dto);
  }

  @Get()
  async getMyRequests(
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.vtService.findByCustomer(
      user.id,
      parseInt(page, 10),
      parseInt(limit, 10),
    );
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    return this.vtService.findById(id);
  }
}
