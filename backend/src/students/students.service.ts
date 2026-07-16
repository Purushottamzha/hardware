import { Injectable, NotFoundException } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { loadSecret } from '../common/config/secret-loader';
import { AuditService } from '../audit/audit.service';
import { projectOntoRoute } from './routeUtils';

@Injectable()
export class StudentsService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
  ) {}

  async list() {
    return this.prisma.student.findMany({
      include: {
        bus: { select: { id: true, routeId: true, route: { select: { id: true, name: true, waypoints: true } } } },
      },
      orderBy: [{ busId: 'asc' }, { routeOrder: 'asc' }],
    });
  }

  private async recomputeRouteOrder(busId: string) {
    const bus = await this.prisma.bus.findUnique({
      where: { id: busId },
      include: { route: true, students: { where: { homeLat: { not: null }, homeLon: { not: null } } } },
    });
    if (!bus || !bus.route) return;
    const waypoints = bus.route.waypoints as any[];
    if (!waypoints || waypoints.length < 2) return;

    const ranked = bus.students
      .map((s) => ({ id: s.id, dist: projectOntoRoute({ lat: s.homeLat!, lon: s.homeLon! }, waypoints) }))
      .sort((a, b) => a.dist - b.dist);

    for (let i = 0; i < ranked.length; i++) {
      await this.prisma.student.update({
        where: { id: ranked[i].id },
        data: { routeOrder: i + 1 },
      });
    }
  }

  async create(
    name: string,
    cls: string = 'Unknown',
    busId?: string,
    homeLat?: number,
    homeLon?: number,
    homeRadiusM?: number,
    guardianName?: string,
    guardianPhone?: string,
    wardTole?: string,
    adminId?: number,
  ): Promise<any> {
    const student = await this.prisma.student.create({
      data: { name, class: cls, busId: busId || '', homeLat, homeLon, homeRadiusM: homeRadiusM || 150, guardianName, guardianPhone, wardTole },
      include: { bus: { select: { id: true, routeId: true, route: { select: { id: true, name: true } } } } },
    });
    if (busId && homeLat !== undefined && homeLon !== undefined) {
      await this.recomputeRouteOrder(busId);
    }
    if (adminId) await this.auditService.log(adminId, 'CREATE_STUDENT', student.id);
    return student;
  }

  async update(id: string, dto: {
    name?: string; class?: string; busId?: string;
    homeLat?: number; homeLon?: number; homeRadiusM?: number;
    guardianName?: string; guardianPhone?: string; wardTole?: string;
  }, adminId?: number) {
    const student = await this.prisma.student.findUnique({ where: { id } });
    if (!student) throw new NotFoundException('Student not found');
    const updated = await this.prisma.student.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.class !== undefined && { class: dto.class }),
        ...(dto.busId !== undefined && { busId: dto.busId }),
        ...(dto.homeLat !== undefined && { homeLat: dto.homeLat }),
        ...(dto.homeLon !== undefined && { homeLon: dto.homeLon }),
        ...(dto.homeRadiusM !== undefined && { homeRadiusM: dto.homeRadiusM }),
        ...(dto.guardianName !== undefined && { guardianName: dto.guardianName }),
        ...(dto.guardianPhone !== undefined && { guardianPhone: dto.guardianPhone }),
        ...(dto.wardTole !== undefined && { wardTole: dto.wardTole }),
      },
      include: { bus: { select: { id: true, routeId: true, route: { select: { id: true, name: true } } } } },
    });
    const finalBusId = dto.busId !== undefined ? dto.busId : student.busId;
    const finalHomeLat = dto.homeLat !== undefined ? dto.homeLat : student.homeLat;
    const finalHomeLon = dto.homeLon !== undefined ? dto.homeLon : student.homeLon;
    if (finalBusId && finalHomeLat !== null && finalHomeLon !== null) {
      await this.recomputeRouteOrder(finalBusId);
    }
    if (adminId) await this.auditService.log(adminId, 'UPDATE_STUDENT', id);
    return updated;
  }

  async listBuses() {
    return this.prisma.bus.findMany({
      include: { route: { select: { id: true, name: true, waypoints: true } } },
      orderBy: { id: 'asc' },
    });
  }

  async suggestRoutes(lat: number, lon: number, threshold = 500) {
    const routes = await this.prisma.route.findMany();
    const { suggestRoutesForPoint } = await import('./routeUtils');
    return suggestRoutesForPoint({ lat, lon }, routes as any[], threshold);
  }

  async generateToken(studentId: string, adminId?: number): Promise<{ token: string; qrData: string }> {
    const student = await this.prisma.student.findUnique({ where: { id: studentId } });
    if (!student) throw new NotFoundException('Student not found');

    const secret = process.env.STUDENT_TOKEN_SECRET || loadSecret('STUDENT_TOKEN_SECRET');
    if (!secret) throw new Error('STUDENT_TOKEN_SECRET not configured');

    const payload = JSON.stringify({ studentId, name: student.name, issuedAt: Date.now(), tokenVersion: student.tokenVersion });
    const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    const token = Buffer.from(JSON.stringify({ payload, hmac })).toString('base64');

    if (adminId) await this.auditService.log(adminId, 'GENERATE_TOKEN', studentId);
    return { token, qrData: token };
  }

  async reissueQr(studentId: string, adminId?: number): Promise<{ token: string; qrData: string }> {
    const student = await this.prisma.student.findUnique({ where: { id: studentId } });
    if (!student) throw new NotFoundException('Student not found');

    await this.prisma.student.update({
      where: { id: studentId },
      data: { qrRevoked: true, tokenVersion: { increment: 1 } },
    });

    if (adminId) await this.auditService.log(adminId, 'REISSUE_QR', studentId);

    return this.generateToken(studentId, adminId);
  }

  async verifyToken(tokenBase64: string): Promise<{ studentId: string; name: string; tokenVersion?: number } | null> {
    try {
      const decoded = JSON.parse(Buffer.from(tokenBase64, 'base64').toString('utf8'));
      const secret = process.env.STUDENT_TOKEN_SECRET || loadSecret('STUDENT_TOKEN_SECRET');
      if (!secret) throw new Error('STUDENT_TOKEN_SECRET not configured');

      const expectedHmac = crypto.createHmac('sha256', secret).update(decoded.payload).digest('hex');
      if (expectedHmac !== decoded.hmac) return null;

      const data = JSON.parse(decoded.payload);

      const MAX_TOKEN_AGE_MS = 24 * 60 * 60 * 1000;
      if (Date.now() - data.issuedAt > MAX_TOKEN_AGE_MS) return null;

      return { studentId: data.studentId, name: data.name, tokenVersion: data.tokenVersion };
    } catch {
      return null;
    }
  }

  async updateState(studentId: string, state: string) {
    await this.prisma.student.update({
      where: { id: studentId },
      data: { currentState: state },
    });
  }
}
