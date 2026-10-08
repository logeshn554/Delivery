import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service';
import { UserRole } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: { phone: string; name: string; role: UserRole }) {
    return this.prisma.user.create({ data: { phone: data.phone, name: data.name, role: data.role } });
  }

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        driver: true,
        restaurant: true,
        business: true,
        wallet: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateProfile(id: string, data: { name?: string; email?: string; avatar?: string }) {
    return this.prisma.user.update({
      where: { id },
      data,
    });
  }

  async registerFcmToken(id: string, token: string) {
    const user = await this.findById(id);
    const tokens = new Set(user.fcmTokens);
    tokens.add(token);
    return this.prisma.user.update({
      where: { id },
      data: { fcmTokens: Array.from(tokens) },
    });
  }

  async removeFcmToken(id: string, token: string) {
    const user = await this.findById(id);
    const tokens = user.fcmTokens.filter((t) => t !== token);
    return this.prisma.user.update({
      where: { id },
      data: { fcmTokens: tokens },
    });
  }
}
