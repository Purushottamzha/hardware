import { BadRequestException, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { FaceService } from './face.service';
import { Public } from '../common/decorators/public.decorator';
import { DeviceAuthGuard } from '../common/guards/device-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

@Controller('face')
export class FaceController {
  constructor(
    private faceService: FaceService,
    private prisma: PrismaService,
  ) {}

  /**
   * Device-originated: phone photo + device HMAC (DeviceAuthGuard).
   * Uses the face-service's own enrollment store (/match) — enrollment copies
   * live there (and in Postgres) via StudentsController.enrollFace.
   * Returns {studentId, confidence} or {studentId: null, confidence: 0},
   * plus optional non-sensitive display fields when a student matched.
   */
  @Post('identify')
  @HttpCode(HttpStatus.OK)
  @Public()
  @UseGuards(DeviceAuthGuard)
  async identify(@Req() req: any) {
    const file = req.file;
    if (!file) throw new BadRequestException('Photo file required');
    return this.withStudentDetails(await this.faceService.match(file.buffer, file.originalname || 'photo.jpg'));
  }

  private async withStudentDetails(result: { studentId: string | null; confidence: number }) {
    if (!result.studentId || result.confidence <= 0) return result;
    try {
      const s = await this.prisma.student.findUnique({
        where: { id: result.studentId },
        select: { name: true, class: true, busId: true, bus: { select: { route: { select: { name: true } } } } },
      });
      if (!s) return result;
      return {
        ...result,
        studentName: s.name,
        class: s.class,
        busId: s.busId,
        routeName: s.bus?.route?.name ?? null,
      };
    } catch {
      return result;
    }
  }
}

/**
 * Alias route so the Android terminal contract (POST /identify) and the
 * device-oriented path (POST /face/identify) are both served by the same
 * logic. Identical HMAC/device auth applies.
 */
@Controller()
export class IdentifyAliasController {
  constructor(
    private faceService: FaceService,
    private prisma: PrismaService,
  ) {}

  @Post('identify')
  @HttpCode(HttpStatus.OK)
  @Public()
  @UseGuards(DeviceAuthGuard)
  async identify(@Req() req: any) {
    const file = req.file;
    if (!file) throw new BadRequestException('Photo file required');
    const result = await this.faceService.match(file.buffer, file.originalname || 'photo.jpg');
    if (!result.studentId || result.confidence <= 0) return result;
    try {
      const s = await this.prisma.student.findUnique({
        where: { id: result.studentId },
        select: { name: true, class: true, busId: true, bus: { select: { route: { select: { name: true } } } } },
      });
      if (!s) return result;
      return { ...result, studentName: s.name, class: s.class, busId: s.busId, routeName: s.bus?.route?.name ?? null };
    } catch {
      return result;
    }
  }
}