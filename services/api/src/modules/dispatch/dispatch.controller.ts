import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { DispatchService, CreateDispatchDto } from './dispatch.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service';
import { UserRole } from '@prisma/client';

@Controller('dispatch')
@UseGuards(JwtAuthGuard)
export class DispatchController {
  constructor(private readonly dispatchService: DispatchService, private readonly prisma:PrismaService) {}

  @Post()
  async create(@Body() dto: CreateDispatchDto,@CurrentUser() user:AuthenticatedUser) {
    if(!([UserRole.ADMIN,UserRole.SUPER_ADMIN] as UserRole[]).includes(user.role as UserRole))throw new ForbiddenException('Operations access required');
    return this.dispatchService.startDispatch(dto);
  }

  @Get('reference/:refId')
  async getStatus(@Param('refId') refId: string) {
    return this.dispatchService.getDispatchStatus(refId);
  }

  @Post(':id/accept')
  async accept(
    @Param('id') dispatchId: string,
    @Body('attemptId') attemptId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const driver=await this.prisma.driver.findUnique({where:{userId:user.id}});
    if(user.role!==UserRole.DRIVER||!driver||driver.status!=='APPROVED')throw new ForbiddenException('Approved driver access required');
    return this.dispatchService.acceptJob(dispatchId, driver.id, attemptId);
  }

  @Post(':id/reject')
  async reject(
    @Param('id') dispatchId: string,
    @Body('attemptId') attemptId: string,
    @Body('reason') reason: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const driver=await this.prisma.driver.findUnique({where:{userId:user.id}});
    if(user.role!==UserRole.DRIVER||!driver)throw new ForbiddenException('Driver access required');
    return this.dispatchService.rejectJob(dispatchId, driver.id, attemptId, reason);
  }

  @Post(':id/cancel')
  async cancel(@Param('id') dispatchId: string,@CurrentUser() user:AuthenticatedUser) {
    if(!([UserRole.ADMIN,UserRole.SUPER_ADMIN] as UserRole[]).includes(user.role as UserRole))throw new ForbiddenException('Operations access required');
    return this.dispatchService.cancelDispatch(dispatchId);
  }
}
