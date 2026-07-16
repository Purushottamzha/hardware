import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { DevicesService } from '../devices/devices.service';
import { StudentsService } from '../students/students.service';
import { EventsGateway } from '../events-gateway/events.gateway';
import { AuditService } from '../audit/audit.service';
import { getMinutesSinceMidnightNPT, getNPTDate, getEffectiveWindows } from '../common/utils/npt-timezone';

const TIME_WINDOW_MS = 60_000;
const DEBOUNCE_MS = 10_000;
const AUTO_SUSPEND_THRESHOLD = 5;
const AUTO_SUSPEND_WINDOW_MS = 5 * 60_000;
const ANTI_PASSBACK_WINDOW_MS = 5 * 60 * 1000;

const DEFAULT_BOARD_WINDOW = { start: 6.5 * 60, end: 9.75 * 60 };
const DEFAULT_DEPART_WINDOW = { start: 15 * 60, end: 17 * 60 };

const DEFAULT_WINDOWS = {
  boardStart: 6.5 * 60,
  boardEnd: 9.75 * 60,
  departStart: 15 * 60,
  departEnd: 17 * 60,
};

const STATE_SEQUENCE: Record<string, { nextStates: string[] }> = {
  NOT_BOARDED: { nextStates: ['BOARDED'] },
  BOARDED: { nextStates: ['ARRIVED_SCHOOL'] },
  ARRIVED_SCHOOL: { nextStates: ['DEPARTED'] },
  DEPARTED: { nextStates: ['ARRIVED_HOME'] },
  ARRIVED_HOME: { nextStates: [] },
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
  private calendarOverrides: any[] = [];

  constructor(
    private prisma: PrismaService,
    private devicesService: DevicesService,
    private studentsService: StudentsService,
    private eventsGateway: EventsGateway,
    private auditService: AuditService,
  ) {}

  async onModuleInit() {
    await this.loadCalendarOverrides();
    this.scheduleMidnightReset();
    this.schedulePhotoCleanup();
    setInterval(() => this.loadCalendarOverrides(), 60 * 60 * 1000);
  }

  private async loadCalendarOverrides() {
    this.calendarOverrides = await this.prisma.calendarOverride.findMany({
      orderBy: { date: 'asc' },
    });
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

    await this.prisma.device.update({
      where: { id: device.id },
      data: { lastSeenCounter: payload.counter },
    });

    const timestampDiff = Math.abs(now - payload.timestamp);
    const isDelayedSync = timestampDiff > TIME_WINDOW_MS;
    let delayedFlag = false;

    if (isDelayedSync) {
      await this.logSecurityEvent('TIMESTAMP_OUT_OF_WINDOW', payload.deviceId, rawPayload);
      if (timestampDiff > TIME_WINDOW_MS * 10) {
        return { accepted: false, reason: 'TIMESTAMP_OUT_OF_WINDOW' };
      }
      delayedFlag = true;
    }

    const studentData = await this.studentsService.verifyToken(payload.studentToken);
    if (!studentData) {
      await this.logSecurityEvent('INVALID_STUDENT_TOKEN', payload.deviceId, rawPayload);
      return { accepted: false, reason: 'INVALID_STUDENT_TOKEN' };
    }

    const student = await this.prisma.student.findUnique({
      where: { id: studentData.studentId },
      include: { bus: { include: { route: { select: { name: true } } } } },
    });
    if (!student) {
      await this.logSecurityEvent('UNKNOWN_STUDENT', payload.deviceId, rawPayload);
      return { accepted: false, reason: 'UNKNOWN_STUDENT' };
    }

    if (student.qrRevoked) {
      await this.logSecurityEvent('QR_REVOKED', payload.deviceId, rawPayload);
      return { accepted: false, reason: 'QR_REVOKED' };
    }

    const tokenPayload = JSON.parse(Buffer.from(payload.studentToken, 'base64').toString('utf8'));
    const tokenData = JSON.parse(tokenPayload.payload);
    if (tokenData.tokenVersion && tokenData.tokenVersion !== student.tokenVersion) {
      await this.logSecurityEvent('TOKEN_VERSION_MISMATCH', payload.deviceId, rawPayload);
      return { accepted: false, reason: 'TOKEN_VERSION_MISMATCH' };
    }

    const lastEvent = await this.prisma.attendanceEvent.findFirst({
      where: { studentId: student.id },
      orderBy: { createdAt: 'desc' },
    });

    if (lastEvent && (now - lastEvent.createdAt.getTime()) < DEBOUNCE_MS) {
      return { accepted: false, reason: 'DEBOUNCED' };
    }

    const antiPassback = await this.prisma.attendanceEvent.findFirst({
      where: {
        studentId: student.id,
        eventType: this.getNextEventType(student.currentState),
        createdAt: { gte: new Date(now - ANTI_PASSBACK_WINDOW_MS) },
      },
    });

    if (antiPassback) {
      await this.logSecurityEvent('ANTI_PASSBACK_TRIGGERED', payload.deviceId, rawPayload);
    }

    const currentState = student.currentState;
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
      const timeCheck = this.checkTimeWindow(currentState, payload.timestamp);
      if (!timeCheck.valid) {
        flagged = true;
        flagReason = timeCheck.reason;
      }

      if (currentState === 'DEPARTED' && nextEventType === 'ARRIVED_HOME') {
        const homeCheck = await this.checkHomeGeofence(student.id, payload.lat, payload.lon);
        if (!homeCheck.inside) {
          flagged = true;
          flagReason = (flagReason ? flagReason + '; ' : '') + homeCheck.flagReason;
        }
      }
    }

    if (delayedFlag && verified) {
      flagged = true;
      flagReason = (flagReason ? flagReason + '; ' : '') + 'DELAYED_OFFLINE_SYNC';
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
        invalidSigCount: 0,
        invalidSigWindowStart: null,
      },
    });

    if (verified && nextEventType) {
      await this.studentsService.updateState(student.id, nextEventType);
    }

    this.eventsGateway.broadcastEvent({
      studentId: student.id,
      student: student.name,
      deviceId: payload.deviceId,
      event: verified ? nextEventType : 'REJECTED',
      eventTimestamp: event.createdAt.toISOString(),
      lat: payload.lat,
      lon: payload.lon,
      status: verified ? (flagged ? 'warning' : 'success') : 'error',
      verified,
      flagged,
      flagReason: flagged ? flagReason ?? null : null,
      rejectionReason: rejectionReason ?? null,
      routeName: student.bus?.route?.name || null,
    });

    return { accepted: verified, reason: verified ? 'OK' : rejectionReason };
  }

  async createManualAttendance(adminId: number, studentId: string, eventType: string, reason: string) {
    const student = await this.prisma.student.findUnique({ where: { id: studentId } });
    if (!student) {
      throw new Error('Student not found');
    }

    const event = await this.prisma.attendanceEvent.create({
      data: {
        deviceId: 'MANUAL',
        studentId,
        eventType,
        lat: 0,
        lon: 0,
        eventTimestamp: new Date(),
        deviceCounter: 0,
        verified: false,
        flagged: true,
        flagReason: 'MANUAL_OVERRIDE',
        rejectionReason: null,
        manualByAdminId: adminId,
      },
      include: { student: true },
    });

    await this.studentsService.updateState(studentId, eventType);
    await this.auditService.log(adminId, 'MANUAL_ATTENDANCE', studentId, { eventType, reason });

    this.eventsGateway.broadcastEvent({
      studentId: student.id,
      student: student.name,
      deviceId: 'MANUAL',
      event: eventType,
      eventTimestamp: event.createdAt.toISOString(),
      lat: 0,
      lon: 0,
      status: 'warning',
      verified: false,
      flagged: true,
      flagReason: 'MANUAL_OVERRIDE',
      rejectionReason: null,
      routeName: null,
    });

    return event;
  }

  private async verifySignature(payload: AttendancePayload, device: any): Promise<boolean> {
    const secret = await this.devicesService.getSecret(device.id);
    const { signature, ...rest } = payload;
    const canonical = this.buildCanonicalJson(rest);
    const expectedSig = crypto.createHmac('sha256', secret).update(canonical).digest('hex');
    return expectedSig === signature;
  }

  buildCanonicalJson(obj: Record<string, any>): string {
    const sorted: Record<string, any> = {};
    Object.keys(obj).sort().forEach((k) => {
      sorted[k] = obj[k];
    });
    return JSON.stringify(sorted);
  }

  async verifyPhotoSignature(deviceId: string, counter: number, photoTimestamp: number, photoSignature: string): Promise<boolean> {
    const device = await this.prisma.device.findUnique({ where: { id: deviceId } });
    if (!device) return false;
    if (device.status === 'suspended') return false;

    const secret = await this.devicesService.getSecret(device.id);
    const canonical = this.buildCanonicalJson({ deviceId, counter, photoTimestamp });
    const expectedSig = crypto.createHmac('sha256', secret).update(canonical).digest('hex');

    const expectedBuf = Buffer.from(expectedSig, 'hex');
    const providedBuf = Buffer.from(photoSignature, 'hex');
    if (expectedBuf.length !== providedBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, providedBuf);
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

  private checkTimeWindow(currentState: string, timestampMs: number): { valid: boolean; reason?: string } {
    const minutesSinceMidnight = getMinutesSinceMidnightNPT(timestampMs);
    const nptDate = getNPTDate(timestampMs);
    const override = this.calendarOverrides.find(
      (o) => o.date.toISOString().split('T')[0] === nptDate.toISOString().split('T')[0]
    );

    if (override && override.dayType === 'HOLIDAY') {
      return { valid: true, reason: 'TAP_ON_HOLIDAY' };
    }

    const windows = getEffectiveWindows(this.calendarOverrides, timestampMs, DEFAULT_WINDOWS);

    switch (currentState) {
      case 'NOT_BOARDED':
        if (minutesSinceMidnight < windows.boardStart || minutesSinceMidnight > windows.boardEnd) {
          return { valid: false, reason: 'OUTSIDE_BOARD_WINDOW' };
        }
        break;
      case 'ARRIVED_SCHOOL':
        if (minutesSinceMidnight < windows.departStart || minutesSinceMidnight > windows.departEnd) {
          return { valid: false, reason: 'OUTSIDE_DEPART_WINDOW' };
        }
        break;
    }

    return { valid: true };
  }

  private async checkHomeGeofence(studentId: string, lat: number, lon: number): Promise<{ inside: boolean; flagReason?: string }> {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      select: { homeLat: true, homeLon: true, homeRadiusM: true },
    });

    if (!student || student.homeLat === null || student.homeLon === null) {
      return { inside: false, flagReason: 'NO_HOME_GEOFENCE_SET' };
    }

    const distance = this.haversineDistance(lat, lon, student.homeLat, student.homeLon);
    const inside = distance <= student.homeRadiusM;

    return { inside, flagReason: inside ? undefined : 'OUTSIDE_HOME_GEOFENCE' };
  }

  private haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private async incrementInvalidSigCount(device: any) {
    const now = new Date();

    if (device.invalidSigWindowStart && (now.getTime() - device.invalidSigWindowStart.getTime()) > AUTO_SUSPEND_WINDOW_MS) {
      await this.prisma.device.update({
        where: { id: device.id },
        data: { invalidSigCount: 1, invalidSigWindowStart: now },
      });
      return;
    }

    const updated = await this.prisma.device.update({
      where: { id: device.id },
      data: {
        invalidSigCount: { increment: 1 },
        invalidSigWindowStart: device.invalidSigWindowStart || now,
      },
    });

    if (updated.invalidSigCount >= AUTO_SUSPEND_THRESHOLD) {
      await this.prisma.device.update({
        where: { id: device.id },
        data: { status: 'suspended' },
      });

      await this.auditService.log(0, 'AUTO_SUSPENDED', device.id);
      await this.logSecurityEvent('AUTO_SUSPENDED', device.id, { deviceId: device.id });
      this.logger.warn(`Device ${device.id} auto-suspended after ${updated.invalidSigCount} invalid signatures`);
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

  async getOverview() {
    const raw = await this.prisma.student.findMany({
      select: { id: true, name: true, currentState: true, class: true, busId: true, routeOrder: true, bus: { select: { route: { select: { name: true } } } } },
    });
    const students = raw.map((s) => ({
      id: s.id, name: s.name, currentState: s.currentState, class: s.class, busId: s.busId, routeOrder: s.routeOrder,
      routeName: (s.bus as any)?.route?.name ?? null,
    }));

    const studentsWithLastEvent = await Promise.all(
      students.map(async (s) => {
        const lastEvent = await this.prisma.attendanceEvent.findFirst({
          where: { studentId: s.id },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            eventType: true,
            eventTimestamp: true,
            createdAt: true,
            lat: true,
            lon: true,
            verified: true,
            flagged: true,
            flagReason: true,
            rejectionReason: true,
          },
        });
        return { ...s, lastEvent };
      }),
    );

    const devices = await this.prisma.device.findMany({
      select: { id: true, busId: true, status: true, lastSeenCounter: true },
    });

    return { students: studentsWithLastEvent, devices };
  }

  async getTodayTimeline(studentId: string) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    return this.prisma.attendanceEvent.findMany({
      where: {
        studentId,
        createdAt: { gte: startOfDay },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        eventType: true,
        eventTimestamp: true,
        createdAt: true,
        lat: true,
        lon: true,
        verified: true,
        flagged: true,
        flagReason: true,
        rejectionReason: true,
        deviceId: true,
        photoPath: true,
        resolved: true,
        resolutionNote: true,
      },
    });
  }

  async getAlerts() {
    return this.prisma.attendanceEvent.findMany({
      where: {
        OR: [{ flagged: true }, { verified: false }],
        resolved: false,
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        eventType: true,
        eventTimestamp: true,
        createdAt: true,
        lat: true,
        lon: true,
        verified: true,
        flagged: true,
        flagReason: true,
        rejectionReason: true,
        deviceId: true,
        resolved: true,
        resolutionNote: true,
        student: { select: { id: true, name: true, class: true } },
        device: { select: { id: true, busId: true } },
      },
    });
  }

  async resolveAlert(id: number, note?: string) {
    return this.prisma.attendanceEvent.update({
      where: { id },
      data: { resolved: true, resolutionNote: note || null },
    });
  }

  async getCalendarOverrides() {
    return this.prisma.calendarOverride.findMany({
      orderBy: { date: 'desc' },
    });
  }

  async createCalendarOverride(dto: any, adminId?: number) {
    const override = await this.prisma.calendarOverride.create({
      data: {
        date: new Date(dto.date),
        dayType: dto.dayType,
        boardWindowStart: dto.boardWindowStart || null,
        boardWindowEnd: dto.boardWindowEnd || null,
        departWindowStart: dto.departWindowStart || null,
        departWindowEnd: dto.departWindowEnd || null,
      },
    });
    if (adminId) await this.auditService.log(adminId, 'CREATE_CALENDAR_OVERRIDE', String(override.id));
    await this.loadCalendarOverrides();
    return override;
  }

  async updateCalendarOverride(id: number, dto: any, adminId?: number) {
    const override = await this.prisma.calendarOverride.update({
      where: { id },
      data: {
        date: new Date(dto.date),
        dayType: dto.dayType,
        boardWindowStart: dto.boardWindowStart || null,
        boardWindowEnd: dto.boardWindowEnd || null,
        departWindowStart: dto.departWindowStart || null,
        departWindowEnd: dto.departWindowEnd || null,
      },
    });
    if (adminId) await this.auditService.log(adminId, 'UPDATE_CALENDAR_OVERRIDE', String(id));
    await this.loadCalendarOverrides();
    return override;
  }

  async deleteCalendarOverride(id: number, adminId?: number) {
    await this.prisma.calendarOverride.delete({ where: { id } });
    if (adminId) await this.auditService.log(adminId, 'DELETE_CALENDAR_OVERRIDE', String(id));
    await this.loadCalendarOverrides();
    return { success: true };
  }

  async getRoutes() {
    return this.prisma.route.findMany({
      include: { buses: true },
    });
  }
}