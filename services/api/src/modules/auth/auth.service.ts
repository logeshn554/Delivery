import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma/prisma.service';
import { OtpService } from './otp.service';
import { TokenService } from './token.service';
import { UsersService } from '../users/users.service';
import { WalletService } from '../wallet/wallet.service';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { UserRole } from '@prisma/client';
import { verifyOtpCode } from './otp-code.util';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private otpService: OtpService,
    private tokenService: TokenService,
    private usersService: UsersService,
    private walletService: WalletService,
    private config: ConfigService,
    private eventEmitter: EventEmitter2,
  ) {}

  // ─── Send OTP ────────────────────────────────────────────────────────────
  async sendOtp(dto: SendOtpDto) {
    const { phone, role = UserRole.CUSTOMER } = dto;
    if (!([UserRole.CUSTOMER,UserRole.DRIVER,UserRole.RESTAURANT_OWNER,UserRole.BUSINESS_OWNER] as UserRole[]).includes(role)) throw new BadRequestException('This account type cannot register here.');

    // Rate limit: max 5 OTPs per 10 minutes per phone
    const recentCount = await this.prisma.oTP.count({
      where: {
        phone,
        createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
      },
    });

    if (recentCount >= 5) {
      throw new BadRequestException(
        'Too many OTP requests. Please wait before requesting again.',
      );
    }

    // Find or create user
    let user = await this.prisma.user.findUnique({ where: { phone } });

    if (!user) {
      user = await this.usersService.create({
        phone,
        name: 'User',
        role,
      });

      // Create wallet for new user
      await this.walletService.createWallet({ userId: user.id });

      this.eventEmitter.emit('user.created', { userId: user.id, phone });
    }

    // Generate and send OTP
    await this.otpService.generateAndSend(phone, user.id);

    this.logger.log(`OTP sent to ${phone}`);

    return {
      message: 'OTP sent successfully',
      phone,
    };
  }

  // ─── Verify OTP ───────────────────────────────────────────────────────────
  async verifyOtp(dto: VerifyOtpDto, deviceInfo?: Record<string, string>) {
    const { phone, code } = dto;

    // Find valid OTP
    const otp = await this.prisma.oTP.findFirst({
      where: {
        phone,
        verifiedAt: null,
        expiresAt: { gte: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp) {
      throw new UnauthorizedException('OTP expired or not found');
    }

    if (otp.attempts >= otp.maxAttempts) {
      throw new UnauthorizedException('Too many failed attempts. Request a new OTP.');
    }

    if (!verifyOtpCode(code, otp.code)) {
      // Increment attempts
      await this.prisma.oTP.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException('Invalid OTP');
    }

    // Mark OTP as verified
    await this.prisma.oTP.update({
      where: { id: otp.id },
      data: { verifiedAt: new Date() },
    });

    // Get user
    const user = await this.prisma.user.findUnique({
      where: { phone },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Mark phone as verified
    if (!user.isPhoneVerified) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { isPhoneVerified: true },
      });
    }

    // Generate tokens
    const tokens = await this.tokenService.generateTokens(user.id, user.role);

    // Create session
    await this.prisma.userSession.create({
      data: {
        userId: user.id,
        refreshToken: tokens.refreshToken,
        deviceId: deviceInfo?.deviceId,
        deviceName: deviceInfo?.deviceName,
        platform: deviceInfo?.platform,
        ipAddress: deviceInfo?.ipAddress,
        userAgent: deviceInfo?.userAgent,
        expiresAt: new Date(
          Date.now() +
            this.tokenService.parseExpiry(
              this.config.get<string>('jwt.refreshExpiresIn', '30d'),
            ),
        ),
      },
    });

    // Update last active
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastActiveAt: new Date() },
    });

    this.eventEmitter.emit('user.login', { userId: user.id, phone });

    return {
      ...tokens,
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        email: user.email,
        avatar: user.avatar,
        role: user.role,
        isPhoneVerified: true,
      },
    };
  }

  // ─── Refresh Token ────────────────────────────────────────────────────────
  async refreshToken(dto: RefreshTokenDto) {
    const session = await this.prisma.userSession.findUnique({
      where: { refreshToken: dto.refreshToken },
      include: { user: true },
    });

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const tokens = await this.tokenService.generateTokens(
      session.userId,
      session.user.role,
    );

    // Rotate refresh token
    await this.prisma.userSession.update({
      where: { id: session.id },
      data: {
        refreshToken: tokens.refreshToken,
        expiresAt: new Date(
          Date.now() +
            this.tokenService.parseExpiry(
              this.config.get<string>('jwt.refreshExpiresIn', '30d'),
            ),
        ),
      },
    });

    return tokens;
  }

  // ─── Logout ───────────────────────────────────────────────────────────────
  async logout(refreshToken: string) {
    await this.prisma.userSession.updateMany({
      where: { refreshToken },
      data: { revokedAt: new Date() },
    });
    return { message: 'Logged out successfully' };
  }

  // ─── Logout All Devices ───────────────────────────────────────────────────
  async logoutAll(userId: string) {
    await this.prisma.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { message: 'Logged out from all devices' };
  }
}
