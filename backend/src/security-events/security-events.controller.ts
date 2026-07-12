import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('security-events')
export class SecurityEventsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async list() {
    return this.prisma.securityEvent.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}
