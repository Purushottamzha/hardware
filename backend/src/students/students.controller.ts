import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsString, IsOptional, IsNumber } from 'class-validator';
import { join } from 'node:path';
import { mkdirSync, promises as fs } from 'node:fs';
import * as crypto from 'node:crypto';
import { StudentsService } from './students.service';
import { PrismaService } from '../prisma/prisma.service';
import { FaceService } from '../face/face.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { DeviceAuthGuard } from '../common/guards/device-auth.guard';

const ENROLL_PHOTO_MAX_SIZE = 5 * 1024 * 1024;

export class FaceTokenDto {
  @IsNumber()
  confidence: number;

  @IsString()
  deviceId: string;

  @IsNumber()
  counter: number;

  @IsNumber()
  photoTimestamp: number;

  @IsString()
  photoSignature: string;
}

export class CreateStudentDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  class?: string;

  @IsOptional()
  @IsString()
  busId?: string;

  @IsOptional()
  @IsString()
  homeLat?: string;

  @IsOptional()
  @IsString()
  homeLon?: string;

  @IsOptional()
  @IsString()
  homeRadiusM?: string;

  @IsOptional()
  @IsString()
  guardianName?: string;

  @IsOptional()
  @IsString()
  guardianPhone?: string;

  @IsOptional()
  @IsString()
  wardTole?: string;
}

export class UpdateStudentDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  class?: string;

  @IsOptional()
  @IsString()
  busId?: string;

  @IsOptional()
  @IsString()
  homeLat?: string;

  @IsOptional()
  @IsString()
  homeLon?: string;

  @IsOptional()
  @IsString()
  homeRadiusM?: string;

  @IsOptional()
  @IsString()
  guardianName?: string;

  @IsOptional()
  @IsString()
  guardianPhone?: string;

  @IsOptional()
  @IsString()
  wardTole?: string;
}

@Controller('students')
export class StudentsController {
  private readonly uploadDir: string;

  constructor(
    private studentsService: StudentsService,
    private prisma: PrismaService,
    private faceService: FaceService,
  ) {
    this.uploadDir = process.env.PHOTO_UPLOAD_DIR || './uploads/photos';
  }

  @Get()
  async list() {
    return this.studentsService.list();
  }

  @Post()
  async create(@Body() dto: CreateStudentDto, @CurrentUser() user: any) {
    return this.studentsService.create(
      dto.name, 
      dto.class || 'Unknown', 
      dto.busId, 
      dto.homeLat ? parseFloat(dto.homeLat) : undefined,
      dto.homeLon ? parseFloat(dto.homeLon) : undefined,
      dto.homeRadiusM ? parseInt(dto.homeRadiusM, 10) : undefined,
      dto.guardianName,
      dto.guardianPhone,
      dto.wardTole,
      user?.id
    );
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateStudentDto, @CurrentUser() user: any) {
    return this.studentsService.update(id, {
      name: dto.name,
      class: dto.class,
      busId: dto.busId,
      homeLat: dto.homeLat ? parseFloat(dto.homeLat) : undefined,
      homeLon: dto.homeLon ? parseFloat(dto.homeLon) : undefined,
      homeRadiusM: dto.homeRadiusM ? parseInt(dto.homeRadiusM, 10) : undefined,
      guardianName: dto.guardianName,
      guardianPhone: dto.guardianPhone,
      wardTole: dto.wardTole,
    }, user?.id);
  }

  @Get('buses')
  async listBuses() {
    return this.studentsService.listBuses();
  }

  @Get('suggest-routes')
  async suggestRoutes(@Query('lat') lat: string, @Query('lon') lon: string) {
    return this.studentsService.suggestRoutes(
      parseFloat(lat), parseFloat(lon)
    );
  }

  @Post(':id/enroll-face')
  @UseInterceptors(
    FileInterceptor('photo', {
      limits: { fileSize: ENROLL_PHOTO_MAX_SIZE },
    }),
  )
  async enrollFace(@Param('id') id: string, @UploadedFile() file: any) {
    if (!file) throw new BadRequestException('Photo file required');

    const result = await this.faceService.enroll(file.buffer, file.originalname || 'face.jpg', id);
    if (!result.faceDetected || !result.embedding) {
      throw new BadRequestException('No face detected in photo');
    }

    const filename = `${crypto.randomUUID()}.jpg`;
    const relativePath = join('faces', filename);
    const fullPath = join(this.uploadDir, relativePath);
    await mkdirSync(join(this.uploadDir, 'faces'), { recursive: true });
    await fs.writeFile(fullPath, file.buffer);

    await this.studentsService.saveFaceEmbedding(id, result.embedding, relativePath);
    return { studentId: id, faceEnrolled: true, photoPath: relativePath };
  }

  @Post(':id/face-token')
  @Public()
  @UseGuards(DeviceAuthGuard)
  async faceToken(@Param('id') id: string, @Body() dto: FaceTokenDto, @Req() req: any) {
    const deviceId = req.deviceId;
    const counter = req.deviceCounter;

    // Reuse the MQTT path's replay check (AttendanceService.processEvent):
    // reject if the counter does not advance, else record it as the last seen.
    const device = await this.prisma.device.findUnique({ where: { id: deviceId } });
    if (counter <= device!.lastSeenCounter) {
      await this.prisma.securityEvent.create({
        data: { type: 'REPLAY_SUSPECTED', deviceId, rawPayload: req.body },
      });
      throw new UnauthorizedException('Replay suspected');
    }
    await this.prisma.device.update({
      where: { id: device!.id },
      data: { lastSeenCounter: counter },
    });

    const student = await this.prisma.student.findUnique({ where: { id } });
    if (!student) throw new NotFoundException('Student not found');

    const threshold = parseFloat(process.env.FACE_MATCH_THRESHOLD || '0.60');
    if (dto.confidence < threshold) {
      throw new ForbiddenException('Face match confidence below threshold');
    }

    return this.studentsService.generateToken(id, undefined, 'FACE', dto.confidence);
  }
}