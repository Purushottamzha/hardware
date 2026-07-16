import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SecretCipherService } from '../common/crypto/secret-cipher.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class DevicesService {
  constructor(
    private prisma: PrismaService,
    private cipher: SecretCipherService,
    private auditService: AuditService,
  ) {}

  async list() {
    return this.prisma.device.findMany({
      select: {
        id: true,
        busId: true,
        status: true,
        lastSeenCounter: true,
      },
    });
  }

  async register(id: string, busId: string, adminId?: number) {
    const existing = await this.prisma.device.findUnique({ where: { id } });
    if (existing) {
      throw new ConflictException('Device already registered');
    }

    const rawSecret = crypto.randomBytes(32).toString('hex');
    const encryptedSecret = this.cipher.encrypt(rawSecret);

    await this.prisma.device.create({
      data: { id, busId, encryptedSecret },
    });

    if (adminId) await this.auditService.log(adminId, 'REGISTER_DEVICE', id);
    return { id, busId, secret: rawSecret };
  }

  async suspend(id: string, adminId?: number) {
    const device = await this.prisma.device.findUnique({ where: { id } });
    if (!device) throw new NotFoundException('Device not found');

    await this.prisma.device.update({
      where: { id },
      data: { status: 'suspended' },
    });

    if (adminId) await this.auditService.log(adminId, 'SUSPEND_DEVICE', id);
    return { id, status: 'suspended' };
  }

  async reactivate(id: string, adminId?: number) {
    const device = await this.prisma.device.findUnique({ where: { id } });
    if (!device) throw new NotFoundException('Device not found');

    await this.prisma.device.update({
      where: { id },
      data: { status: 'active', invalidSigCount: 0, invalidSigWindowStart: null },
    });

    if (adminId) await this.auditService.log(adminId, 'REACTIVATE_DEVICE', id);
    return { id, status: 'active' };
  }

  async getSecret(deviceId: string): Promise<string> {
    const device = await this.prisma.device.findUnique({ where: { id: deviceId } });
    if (!device) throw new NotFoundException('Device not found');
    return this.cipher.decrypt(device.encryptedSecret);
  }

  async reassignBus(id: string, newBusId: string, adminId?: number) {
    const device = await this.prisma.device.findUnique({ where: { id } });
    if (!device) throw new NotFoundException('Device not found');

    const oldBusId = device.busId;
    await this.prisma.device.update({
      where: { id },
      data: { busId: newBusId },
    });

    if (adminId) await this.auditService.log(adminId, 'DEVICE_REASSIGNED', id, { oldBusId, newBusId });
    return { id, busId: newBusId, oldBusId };
  }
}
