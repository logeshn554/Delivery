import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service';
import { WalletTransactionType, WalletTransactionReason } from '@prisma/client';

export interface WalletOperationDto {
  userId?: string;
  driverId?: string;
  amount: number;
  reason: WalletTransactionReason;
  referenceId?: string;
  description?: string;
}

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(private prisma: PrismaService) {}

  async createWallet(data: { userId?: string; driverId?: string }) {
    return this.prisma.wallet.create({
      data: {
        userId: data.userId,
        driverId: data.driverId,
        balance: 0,
      },
    });
  }

  async getWallet(userId?: string, driverId?: string) {
    const wallet = await this.prisma.wallet.findFirst({
      where: userId ? { userId } : { driverId },
      include: {
        transactions: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });

    if (!wallet) throw new NotFoundException('Wallet not found');
    return wallet;
  }

  async credit(dto: WalletOperationDto) {
    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findFirst({
        where: dto.userId ? { userId: dto.userId } : { driverId: dto.driverId },
      });

      if (!wallet) throw new NotFoundException('Wallet not found');
      if (wallet.isLocked) throw new BadRequestException('Wallet is locked');

      const newBalance = wallet.balance + dto.amount;

      await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: newBalance },
      });

      const transaction = await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: WalletTransactionType.CREDIT,
          reason: dto.reason,
          amount: dto.amount,
          balanceBefore: wallet.balance,
          balanceAfter: newBalance,
          referenceId: dto.referenceId,
          description: dto.description,
        },
      });

      return { wallet: { ...wallet, balance: newBalance }, transaction };
    });
  }

  async debit(dto: WalletOperationDto) {
    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findFirst({
        where: dto.userId ? { userId: dto.userId } : { driverId: dto.driverId },
      });

      if (!wallet) throw new NotFoundException('Wallet not found');
      if (wallet.isLocked) throw new BadRequestException('Wallet is locked');

      if (wallet.balance < dto.amount) {
        throw new BadRequestException(
          `Insufficient wallet balance. Available: ₹${wallet.balance.toFixed(2)}`,
        );
      }

      const newBalance = wallet.balance - dto.amount;

      await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: newBalance },
      });

      const transaction = await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: WalletTransactionType.DEBIT,
          reason: dto.reason,
          amount: dto.amount,
          balanceBefore: wallet.balance,
          balanceAfter: newBalance,
          referenceId: dto.referenceId,
          description: dto.description,
        },
      });

      return { wallet: { ...wallet, balance: newBalance }, transaction };
    });
  }

  async getTransactions(userId: string, page = 1, limit = 20) {
    const wallet = await this.prisma.wallet.findFirst({ where: { userId } });
    if (!wallet) throw new NotFoundException('Wallet not found');

    const skip = (page - 1) * limit;
    const [transactions, total] = await Promise.all([
      this.prisma.walletTransaction.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.walletTransaction.count({ where: { walletId: wallet.id } }),
    ]);

    return {
      balance: wallet.balance,
      transactions,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }
}
