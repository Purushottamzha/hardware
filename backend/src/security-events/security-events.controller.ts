import { Controller, Get, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('security-events')
export class SecurityEventsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async list(
    @Query('type') type?: string,
    @Query('deviceId') deviceId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const take = Math.min(Number(limit) || 50, 200);
    const skip = (Math.max(Number(page) || 1, 1) - 1) * take;
    const where: any = {};
    if (type) where.type = type;
    if (deviceId) where.deviceId = deviceId;
    const [events, total] = await Promise.all([
      this.prisma.securityEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.securityEvent.count({ where }),
    ]);
    return { events, total, page: Math.max(Number(page) || 1, 1), limit: take };
  }
}
