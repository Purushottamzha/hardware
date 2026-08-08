import { BadRequestException, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { FaceService } from './face.service';
import { Public } from '../common/decorators/public.decorator';
import { DeviceAuthGuard } from '../common/guards/device-auth.guard';

@Controller('face')
export class FaceController {
  constructor(private faceService: FaceService) {}

  /**
   * Device-originated: phone photo + device HMAC (DeviceAuthGuard).
   * Uses the face-service's own enrollment store (/match) — enrollment copies
   * live there (and in Postgres) via StudentsController.enrollFace.
   * Returns {studentId, confidence} or {studentId: null, confidence: 0}.
   */
  @Post('identify')
  @HttpCode(HttpStatus.OK)
  @Public()
  @UseGuards(DeviceAuthGuard)
  async identify(@Req() req: any) {
    const file = req.file;
    if (!file) throw new BadRequestException('Photo file required');
    return this.faceService.match(file.buffer, file.originalname || 'photo.jpg');
  }
}

/**
 * Alias route so the Android terminal contract (POST /identify) and the
 * device-oriented path (POST /face/identify) are both served by the same
 * logic. Identical HMAC/device auth applies.
 */
@Controller()
export class IdentifyAliasController {
  constructor(private faceService: FaceService) {}

  @Post('identify')
  @HttpCode(HttpStatus.OK)
  @Public()
  @UseGuards(DeviceAuthGuard)
  async identify(@Req() req: any) {
    const file = req.file;
    if (!file) throw new BadRequestException('Photo file required');
    return this.faceService.match(file.buffer, file.originalname || 'photo.jpg');
  }
}