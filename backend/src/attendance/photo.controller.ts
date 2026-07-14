import {
  Controller,
  Get,
  Post,
  Param,
  ParseIntPipe,
  UseInterceptors,
  UploadedFile,
  Body,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  Logger,
  StreamableFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { join, extname } from 'node:path';
import * as crypto from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, promises as fs } from 'node:fs';
import { PrismaService } from '../prisma/prisma.service';
import { AttendanceService } from './attendance.service';
import { Public } from '../common/decorators/public.decorator';

const PHOTO_UPLOAD_SIG_WINDOW_MS = 30_000;
const PHOTO_MAX_SIZE = 300 * 1024;

@Controller('attendance')
export class PhotoController {
  private readonly logger = new Logger(PhotoController.name);
  private readonly uploadDir: string;

  constructor(
    private prisma: PrismaService,
    private attendanceService: AttendanceService,
  ) {
    this.uploadDir = process.env.PHOTO_UPLOAD_DIR || './uploads/photos';
    if (!existsSync(this.uploadDir)) {
      mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  @Post('photo')
  @Public()
  @UseInterceptors(
    FileInterceptor('photo', {
      limits: { fileSize: PHOTO_MAX_SIZE },
      fileFilter: (_req, file, cb) => {
        if (file.mimetype !== 'image/jpeg') {
          cb(new BadRequestException('Only JPEG images allowed'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  async uploadPhoto(
    @UploadedFile() file: any,
    @Body('deviceId') deviceId: string,
    @Body('counter') counter: string,
    @Body('photoSignature') photoSignature: string,
    @Body('photoTimestamp') photoTimestamp: string,
  ) {
    if (!file) throw new BadRequestException('Photo file required');
    if (!deviceId || !counter || !photoSignature || !photoTimestamp) {
      throw new BadRequestException('deviceId, counter, photoSignature, and photoTimestamp required');
    }

    const counterNum = parseInt(counter, 10);
    if (isNaN(counterNum)) throw new BadRequestException('counter must be a number');

    const ts = parseInt(photoTimestamp, 10);
    if (isNaN(ts)) throw new BadRequestException('photoTimestamp must be a number');

    if (Math.abs(Date.now() - ts) > PHOTO_UPLOAD_SIG_WINDOW_MS) {
      await this.logSecurityEvent('PHOTO_TIMESTAMP_OUT_OF_WINDOW', deviceId, { deviceId, counter });
      throw new UnauthorizedException('photoTimestamp out of window');
    }

    const sigValid = await this.attendanceService.verifyPhotoSignature(deviceId, counterNum, ts, photoSignature);
    if (!sigValid) {
      await this.logSecurityEvent('INVALID_PHOTO_SIGNATURE', deviceId, { deviceId, counter });
      throw new UnauthorizedException('Invalid photo signature');
    }

    const event = await this.prisma.attendanceEvent.findFirst({
      where: { deviceId, deviceCounter: counterNum, photoPath: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!event) throw new NotFoundException('Attendance event not found or photo already uploaded');

    const photoFilename = `${crypto.randomUUID()}.jpg`;
    const fullPath = join(this.uploadDir, photoFilename);
    await fs.writeFile(fullPath, file.buffer);

    await this.prisma.attendanceEvent.update({
      where: { id: event.id },
      data: { photoPath: photoFilename },
    });

    this.logger.log(`Photo attached to event ${event.id} (device=${deviceId}, counter=${counter})`);

    return { eventId: event.id, photoPath: photoFilename };
  }

  @Get(':eventId/photo')
  async getPhoto(@Param('eventId', ParseIntPipe) eventId: number) {
    const event = await this.prisma.attendanceEvent.findUnique({
      where: { id: eventId },
      select: { photoPath: true },
    });

    if (!event || !event.photoPath) {
      throw new NotFoundException('Photo not found');
    }

    const fullPath = join(this.uploadDir, event.photoPath);
    if (!existsSync(fullPath)) {
      throw new NotFoundException('Photo file not found on disk');
    }

    return new StreamableFile(createReadStream(fullPath), {
      type: 'image/jpeg',
      disposition: `inline; filename="${event.photoPath}"`,
    });
  }

  private async logSecurityEvent(type: string, deviceId: string, payload: { deviceId: string; counter: string }) {
    await this.prisma.securityEvent.create({
      data: { type, deviceId, rawPayload: payload },
    });
  }
}
