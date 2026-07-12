import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { DevicesService } from '../devices/devices.service';
import { StudentsService } from '../students/students.service';
import { EventsGateway } from '../events-gateway/events.gateway';
import { AuditService } from '../audit/audit.service';

const TIME_WINDOW_MS = 60_000;
const DEBOUNCE_MS = 10_000;
const AUTO_SUSPEND_THRESHOLD = 5;
const AUTO_SUSPEND_WINDOW_MS = 5 * 60_000;

const STATE_SEQUENCE: Record<string, { nextStates: string[]; timeWindows?: { start: number; end: number }[] }> = {
  NOT_BOARDED: {
    nextStates: ['BOARDED'],
    timeWindows: [{ start: 6.5 * 60, end: 9.75 * 60 }],
  },
  BOARDED: {
    nextStates: ['ARRIVED_SCHOOL'],
    timeWindows: [{ start: 0, end: 45 }],
  },
  ARRIVED_SCHOOL: {
    nextStates: ['DEPARTED'],
    timeWindows: [{ start: 15 * 60, end: 17 * 60 }],
  },
  DEPARTED: {
    nextStates: ['ARRIVED_HOME'],
    timeWindows: [{ start: 0, end: 45 }],
  },
  ARRIVED_HOME: {
    nextStates: [],
  },
};

interface AttendancePayload {
  deviceId: string;
  studentToken: string;
  lat: number;
  lon: number;
  timestamp: number;
  counter: number;
  signature: string;
}

@Injectable()
export class AttendanceService implements OnModuleInit {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    private prisma: PrismaService,
    private devicesService: DevicesService,
    private studentsService: StudentsService,
    private eventsGateway: EventsGateway,
    private auditService: AuditService,
  ) {}

  async onModuleInit() {
    this.scheduleMidnightReset();
    this.schedulePhotoCleanup();
  }

  private schedulePhotoCleanup() {
    const runCleanup = async () => {
      try {
        const retentionDays = parseInt(process.env.PHOTO_RETENTION_DAYS || '30', 10);
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - retentionDays);

        const oldEvents = await this.prisma.attendanceEvent.findMany({
          where: {
            photoPath: { not: null },
            createdAt: { lt: cutoff },
          },
          select: { id: true, photoPath: true },
        });

        for (const event of oldEvents) {
          try {
            const fs = await import('node:fs');
            if (event.photoPath) {
              fs.unlink(event.photoPath, () => {});
            }
          } catch {}
        }

        await this.prisma.attendanceEvent.updateMany({
          where: { id: { in: oldEvents.map((e) => e.id) } },
          data: { photoPath: null },
        });

        if (oldEvents.length > 0) {
          this.logger.log(`Cleaned up ${oldEvents.length} old photos`);
        }
      } catch (err: any) {
        this.logger.error(`Photo cleanup failed: ${err.message}`);
      }
    };

    runCleanup();
    setInterval(runCleanup, 24 * 60 * 60 * 1000);
  }

  private scheduleMidnightReset() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const msUntilMidnight = tomorrow.getTime() - now.getTime();

    setTimeout(async () => {
      await this.resetStatesAtMidnight();
      this.scheduleMidnightReset();
    }, msUntilMidnight);

    this.logger.log(`Midnight state reset scheduled in ${Math.round(msUntilMidnight / 60000)} minutes`);
  }

  private async resetStatesAtMidnight() {
    try {
      const result = await this.prisma.student.updateMany({
        where: { currentState: 'ARRIVED_HOME' },
        data: { currentState: 'NOT_BOARDED' },
      });
      if (result.count > 0) {
        this.logger.log(`Reset ${result.count} students from ARRIVED_HOME to NOT_BOARDED`);
      }
    } catch (err: any) {
      this.logger.error(`Failed to reset states at midnight: ${err.message}`);
    }
  }

  async processEvent(rawPayload: any) {
    const payload = rawPayload as AttendancePayload;

    const device = await this.prisma.device.findUnique({ where: { id: payload.deviceId } });
    if (!device) {
      await this.logSecurityEvent('UNKNOWN_DEVICE', payload.deviceId, rawPayload);
      return { accepted: false, reason: 'UNKNOWN_DEVICE' };
    }

    if (device.status === 'suspended') {
      await this.logSecurityEvent('DEVICE_SUSPENDED', payload.deviceId, rawPayload);
      return { accepted: false, reason: 'DEVICE_SUSPENDED' };
    }

    const signatureValid = await this.verifySignature(payload, device);
    if (!signatureValid) {
      await this.logSecurityEvent('INVALID_DEVICE_SIGNATURE', payload.deviceId, rawPayload);
      await this.incrementInvalidSigCount(device);
      return { accepted: false, reason: 'INVALID_DEVICE_SIGNATURE' };
    }

    if (payload.counter <= device.lastSeenCounter) {
      await this.logSecurityEvent('REPLAY_SUSPECTED', payload.deviceId, rawPayload);
      return { accepted: false, reason: 'REPLAY_SUSPECTED' };
    }

    const now = Date.now();
    if (Math.abs(now - payload.timestamp) > TIME_WINDOW_MS) {
      await this.logSecurityEvent('TIMESTAMP_OUT_OF_WINDOW', payload.deviceId, rawPayload);
      return { accepted: false, reason: 'TIMESTAMP_OUT_OF_WINDOW' };
    }

    const studentData = await this.studentsService.verifyToken(payload.studentToken);
    if (!studentData) {
      await this.logSecurityEvent('INVALID_STUDENT_TOKEN', payload.deviceId, rawPayload);
      return { accepted: false, reason: 'INVALID_STUDENT_TOKEN' };
    }

    const student = await this.prisma.student.findUnique({ where: { id: studentData.studentId } });
    if (!student) {
      await this.logSecurityEvent('UNKNOWN_STUDENT', payload.deviceId, rawPayload);
      return { accepted: false, reason: 'UNKNOWN_STUDENT' };
    }

    const lastEvent = await this.prisma.attendanceEvent.findFirst({
      where: { studentId: student.id },
      orderBy: { createdAt: 'desc' },
    });

    if (lastEvent && (now - lastEvent.createdAt.getTime()) < DEBOUNCE_MS) {
      return { accepted: false, reason: 'DEBOUNCED' };
    }

    const currentState = student.currentState;
    const stateConfig = STATE_SEQUENCE[currentState];
    const nextEventType = this.getNextEventType(currentState);

    const sequenceValid = this.validateStateSequence(currentState, nextEventType, payload);
    let verified = sequenceValid;
    let flagged = false;
    let flagReason: string | undefined;
    let rejectionReason: string | undefined;
    let eventType = nextEventType;

    if (!sequenceValid) {
      verified = false;
      rejectionReason = 'INVALID_SEQUENCE';
      eventType = currentState === 'NOT_BOARDED' ? 'BOARDED' : currentState;
      await this.logSecurityEvent('INVALID_SEQUENCE', payload.deviceId, rawPayload);
    } else {
      const timeValid = this.checkTimeWindow(currentState, payload.timestamp);
      if (!timeValid) {
        flagged = true;
        flagReason = `OUTSIDE_TIME_WINDOW`;
      }
    }

    const event = await this.prisma.attendanceEvent.create({
      data: {
        deviceId: payload.deviceId,
        studentId: student.id,
        eventType: verified ? nextEventType : eventType,
        lat: payload.lat,
        lon: payload.lon,
        eventTimestamp: new Date(payload.timestamp),
        deviceCounter: payload.counter,
        verified,
        flagged,
        flagReason,
        rejectionReason,
      },
      include: { student: true, device: true },
    });

    await this.prisma.device.update({
      where: { id: device.id },
      data: {
        lastSeenCounter: payload.counter,
        invalidSigCount: 0,
        invalidSigWindowStart: null,
      },
    });

    if (verified && nextEventType) {
      await this.studentsService.updateState(student.id, nextEventType);
    }

    const eventTime = new Date(payload.timestamp).toLocaleTimeString();
    this.eventsGateway.broadcastEvent({
      student: student.name,
      event: verified ? nextEventType : 'REJECTED',
      time: eventTime,
      lat: payload.lat,
      lon: payload.lon,
      status: verified ? (flagged ? 'warning' : 'success') : 'error',
    });

    return { accepted: verified, reason: verified ? 'OK' : rejectionReason };
  }

  private async verifySignature(payload: AttendancePayload, device: any): Promise<boolean> {
    const secret = await this.devicesService.getSecret(device.id);
    const { signature, ...rest } = payload;
    const canonical = this.buildCanonicalJson(rest);
    const expectedSig = crypto.createHmac('sha256', secret).update(canonical).digest('hex');
    return expectedSig === signature;
  }

  private buildCanonicalJson(obj: Record<string, any>): string {
    const sorted: Record<string, any> = {};
    Object.keys(obj).sort().forEach((k) => {
      sorted[k] = obj[k];
    });
    return JSON.stringify(sorted);
  }

  private getNextEventType(currentState: string): string {
    const config = STATE_SEQUENCE[currentState];
    if (!config || config.nextStates.length === 0) return currentState;
    return config.nextStates[0];
  }

  private validateStateSequence(currentState: string, nextEventType: string, payload: AttendancePayload): boolean {
    const config = STATE_SEQUENCE[currentState];
    if (!config) return false;

    return config.nextStates.includes(nextEventType);
  }

  private checkTimeWindow(currentState: string, timestampMs: number): boolean {
    const date = new Date(timestampMs);
    const minutesSinceMidnight = date.getUTCHours() * 60 + date.getUTCMinutes();
    const config = STATE_SEQUENCE[currentState];
    if (!config || !config.timeWindows || config.timeWindows.length === 0) return true;

    return config.timeWindows.some((tw) => minutesSinceMidnight >= tw.start && minutesSinceMidnight <= tw.end);
  }

  private async incrementInvalidSigCount(device: any) {
    const now = new Date();
    const windowStart = device.invalidSigWindowStart || now;

    if (device.invalidSigWindowStart && (now.getTime() - device.invalidSigWindowStart.getTime()) > AUTO_SUSPEND_WINDOW_MS) {
      await this.prisma.device.update({
        where: { id: device.id },
        data: { invalidSigCount: 1, invalidSigWindowStart: now },
      });
      return;
    }

    const newCount = device.invalidSigCount + 1;
    if (newCount >= AUTO_SUSPEND_THRESHOLD) {
      await this.prisma.device.update({
        where: { id: device.id },
        data: { status: 'suspended', invalidSigCount: newCount },
      });

      await this.auditService.log(0, 'AUTO_SUSPENDED', device.id);

      await this.logSecurityEvent('AUTO_SUSPENDED', device.id, { deviceId: device.id });
      this.logger.warn(`Device ${device.id} auto-suspended after ${newCount} invalid signatures`);
    } else {
      await this.prisma.device.update({
        where: { id: device.id },
        data: {
          invalidSigCount: newCount,
          invalidSigWindowStart: windowStart,
        },
      });
    }
  }

  private async logSecurityEvent(type: string, deviceId: string | undefined, rawPayload: any) {
    await this.prisma.securityEvent.create({
      data: { type, deviceId, rawPayload },
    });

    this.eventsGateway.broadcastSecurityEvent({
      type,
      deviceId,
      time: new Date().toLocaleTimeString(),
      raw: rawPayload,
    });
  }

  async getEvents(studentId?: string) {
    const where = studentId ? { studentId } : {};
    return this.prisma.attendanceEvent.findMany({
      where,
      include: { student: true, device: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}
