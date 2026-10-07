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

@Controller('dispatch')
@UseGuards(JwtAuthGuard)
export class DispatchController {
  constructor(private readonly dispatchService: DispatchService) {}

  @Post()
  async create(@Body() dto: CreateDispatchDto) {
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
    return this.dispatchService.acceptJob(dispatchId, user.id, attemptId);
  }

  @Post(':id/reject')
  async reject(
    @Param('id') dispatchId: string,
    @Body('attemptId') attemptId: string,
    @Body('reason') reason: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.dispatchService.rejectJob(dispatchId, user.id, attemptId, reason);
  }

  @Post(':id/cancel')
  async cancel(@Param('id') dispatchId: string) {
    return this.dispatchService.cancelDispatch(dispatchId);
  }
}
