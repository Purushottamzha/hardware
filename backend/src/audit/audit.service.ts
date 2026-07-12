import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async log(adminId: number, action: string, targetId?: string) {
    const lastLog = await this.prisma.auditLog.findFirst({
      orderBy: { id: 'desc' },
    });
    const prevHash = lastLog ? lastLog.hash : '0';

    const hashInput = `${prevHash}|${action}|${targetId || ''}|${new Date().toISOString()}`;
    const hash = crypto.createHash('sha256').update(hashInput).digest('hex');

    return this.prisma.auditLog.create({
      data: { adminId, action, targetId, prevHash, hash },
    });
  }

  async list() {
    return this.prisma.auditLog.findMany({
      orderBy: { id: 'desc' },
      take: 100,
    });
  }

  async verifyChain(): Promise<{ valid: boolean; brokenAt?: number }> {
    const logs = await this.prisma.auditLog.findMany({
      orderBy: { id: 'asc' },
    });

    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];
      const expectedPrevHash = i === 0 ? '0' : logs[i - 1].hash;
      if (log.prevHash !== expectedPrevHash) {
        return { valid: false, brokenAt: log.id };
      }

      const expectedHash = crypto
        .createHash('sha256')
        .update(`${log.prevHash}|${log.action}|${log.targetId || ''}|${log.createdAt.toISOString()}`)
        .digest('hex');
      if (log.hash !== expectedHash) {
        return { valid: false, brokenAt: log.id };
      }
    }

    return { valid: true };
  }
}
