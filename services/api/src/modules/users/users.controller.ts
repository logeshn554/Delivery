import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Body,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  async getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.findById(user.id);
  }

  @Patch('me')
  async updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { name?: string; email?: string; avatar?: string },
  ) {
    return this.usersService.updateProfile(user.id, body);
  }

  @Post('me/fcm-token')
  async addFcmToken(
    @CurrentUser() user: AuthenticatedUser,
    @Body('token') token: string,
  ) {
    return this.usersService.registerFcmToken(user.id, token);
  }

  @Delete('me/fcm-token')
  async removeFcmToken(
    @CurrentUser() user: AuthenticatedUser,
    @Body('token') token: string,
  ) {
    return this.usersService.removeFcmToken(user.id, token);
  }
}
