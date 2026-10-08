import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service';
import { TicketStatus } from '@prisma/client';
import { generateOrderNumber } from '../../common/utils/generate-number.util';

export interface CreateTicketDto {
  subject: string;
  message: string;
  orderId?: string;
  category?: string;
}

@Injectable()
export class SupportService {
  constructor(private prisma: PrismaService) {}

  async createTicket(customerId: string, dto: CreateTicketDto) {
    return this.prisma.supportTicket.create({
      data: {
        ticketNumber: generateOrderNumber('TKT'),
        customerId,
        subject: dto.subject,
        status: TicketStatus.OPEN,
        referenceId: dto.orderId,
        description: dto.message,
        tags: [],
        messages: {
          create: {
            senderId: customerId,
            senderRole: 'CUSTOMER',
            content: dto.message,
            attachments: [],
          },
        },
      },
      include: {
        messages: true,
      },
    });
  }

  async getMyTickets(customerId: string) {
    return this.prisma.supportTicket.findMany({
      where: { customerId },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
