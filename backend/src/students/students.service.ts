import { Injectable, NotFoundException } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class StudentsService {
  constructor(private prisma: PrismaService) {}

  async list() {
    return this.prisma.student.findMany({
      select: { id: true, name: true, currentState: true },
    });
  }

  async create(name: string): Promise<{ id: string; name: string }> {
    return this.prisma.student.create({
      data: { name },
      select: { id: true, name: true },
    });
  }

  async generateToken(studentId: string): Promise<{ token: string; qrData: string }> {
    const student = await this.prisma.student.findUnique({ where: { id: studentId } });
    if (!student) throw new NotFoundException('Student not found');

    const secret = process.env.STUDENT_TOKEN_SECRET;
    if (!secret) throw new Error('STUDENT_TOKEN_SECRET not configured');

    const payload = JSON.stringify({ studentId, name: student.name, issuedAt: Date.now() });
    const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    const token = Buffer.from(JSON.stringify({ payload, hmac })).toString('base64');

    return { token, qrData: token };
  }

  async verifyToken(tokenBase64: string): Promise<{ studentId: string; name: string } | null> {
    try {
      const decoded = JSON.parse(Buffer.from(tokenBase64, 'base64').toString('utf8'));
      const secret = process.env.STUDENT_TOKEN_SECRET;
      if (!secret) throw new Error('STUDENT_TOKEN_SECRET not configured');

      const expectedHmac = crypto.createHmac('sha256', secret).update(decoded.payload).digest('hex');
      if (expectedHmac !== decoded.hmac) return null;

      const data = JSON.parse(decoded.payload);

      const MAX_TOKEN_AGE_MS = 24 * 60 * 60 * 1000;
      if (Date.now() - data.issuedAt > MAX_TOKEN_AGE_MS) return null;

      return { studentId: data.studentId, name: data.name };
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
