import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DriverStatus } from '@prisma/client';

@Controller('admin')
@UseGuards(JwtAuthGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('stats')
  async getStats() {
    return this.adminService.getDashboardStats();
  }

  @Get('drivers')
  async getDrivers(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.adminService.getDrivers(parseInt(page, 10), parseInt(limit, 10));
  }

  @Patch('drivers/:id/status')
  async updateDriverStatus(
    @Param('id') driverId: string,
    @Body('status') status: DriverStatus,
  ) {
    return this.adminService.updateDriverStatus(driverId, status);
  }
}
