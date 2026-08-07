import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { DevicesService } from '../../devices/devices.service';

function buildCanonicalJson(obj: Record<string, any>): string {
  const sorted: Record<string, any> = {};
  Object.keys(obj)
    .sort()
    .forEach((k) => {
      sorted[k] = obj[k];
    });
  return JSON.stringify(sorted);
}

/**
 * Auth for field-device-originated HTTP calls (photo upload, face identify,
 * face-token minting). Verifies the same HMAC scheme used by the MQTT
 * attendance flow: HMAC-SHA256 over canonical JSON of
 * {deviceId, counter, photoTimestamp} keyed with the device secret,
 * compared in constant time.
 *
 * Scheme must match AttendanceService.verifyPhotoSignature() exactly —
 * device lookups use the same encrypted-secret store via DevicesService.
 */
@Injectable()
export class DeviceAuthGuard implements CanActivate {
  constructor(
    private prisma: PrismaService,
    private devicesService: DevicesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const { deviceId, counter, photoTimestamp, photoSignature } = request.body ?? {};

    if (!deviceId || counter === undefined || photoTimestamp === undefined || !photoSignature) {
      throw new UnauthorizedException('deviceId, counter, photoTimestamp, photoSignature required');
    }

    const device = await this.prisma.device.findUnique({ where: { id: deviceId } });
    if (!device || device.status === 'suspended') {
      throw new UnauthorizedException('Unknown or suspended device');
    }

    const secret = await this.devicesService.getSecret(deviceId);
    const canonical = buildCanonicalJson({
      deviceId,
      counter: Number(counter),
      photoTimestamp: Number(photoTimestamp),
    });
    const expectedSig = crypto.createHmac('sha256', secret).update(canonical).digest('hex');

    const expectedBuf = Buffer.from(expectedSig, 'hex');
    const providedBuf = Buffer.from(photoSignature, 'hex');
    if (expectedBuf.length !== providedBuf.length || !crypto.timingSafeEqual(expectedBuf, providedBuf)) {
      throw new UnauthorizedException('Invalid device signature');
    }

    request.deviceId = deviceId;
    request.deviceCounter = Number(counter);
    return true;
  }
}
