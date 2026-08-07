import { BadRequestException, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FaceService } from './face.service';
import { Public } from '../common/decorators/public.decorator';
import { DeviceAuthGuard } from '../common/guards/device-auth.guard';

@Controller('face')
export class FaceController {
  constructor(
    private prisma: PrismaService,
    private faceService: FaceService,
  ) {}

  /**
   * Device-originated: phone photo + device HMAC (DeviceAuthGuard).
   * The multipart body is parsed by route middleware (multer) registered in
   * FaceModule.configure so DeviceAuthGuard can read the auth fields.
   * Reads all enrolled embeddings here (the one place this feature touches
   * Prisma outside the service), forwards photo + candidates to face-service,
   * returns {studentId, confidence} or {studentId: null} as-is.
   * No threshold rejection at this layer.
   */
  @Post('identify')
  @HttpCode(HttpStatus.OK)
  @Public()
  @UseGuards(DeviceAuthGuard)
  async identify(@Req() req: any) {
    const file = req.file;
    if (!file) throw new BadRequestException('Photo file required');

    const candidates = await this.prisma.faceEmbedding.findMany({
      select: { studentId: true, embedding: true },
    });

    if (candidates.length === 0) {
      return { studentId: null, confidence: 0 };
    }

    return this.faceService.identify(file.buffer, file.originalname || 'photo.jpg', candidates);
  }
}
