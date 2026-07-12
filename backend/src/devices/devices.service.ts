import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SecretCipherService } from '../common/crypto/secret-cipher.service';

@Injectable()
export class DevicesService {
  constructor(
    private prisma: PrismaService,
    private cipher: SecretCipherService,
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

  async register(id: string, busId: string) {
    const existing = await this.prisma.device.findUnique({ where: { id } });
    if (existing) {
      throw new ConflictException('Device already registered');
    }

    const rawSecret = crypto.randomBytes(32).toString('hex');
    const encryptedSecret = this.cipher.encrypt(rawSecret);

    await this.prisma.device.create({
      data: { id, busId, encryptedSecret },
    });

    return { id, busId, secret: rawSecret };
  }

  async suspend(id: string) {
    const device = await this.prisma.device.findUnique({ where: { id } });
    if (!device) throw new NotFoundException('Device not found');

    await this.prisma.device.update({
      where: { id },
      data: { status: 'suspended' },
    });

    return { id, status: 'suspended' };
  }

  async reactivate(id: string) {
    const device = await this.prisma.device.findUnique({ where: { id } });
    if (!device) throw new NotFoundException('Device not found');

    await this.prisma.device.update({
      where: { id },
      data: { status: 'active', invalidSigCount: 0, invalidSigWindowStart: null },
    });

    return { id, status: 'active' };
  }

  async getSecret(deviceId: string): Promise<string> {
    const device = await this.prisma.device.findUnique({ where: { id: deviceId } });
    if (!device) throw new NotFoundException('Device not found');
    return this.cipher.decrypt(device.encryptedSecret);
  }
}
