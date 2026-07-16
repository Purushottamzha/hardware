import { Controller, Get, Post, Put, Body, Param, Query } from '@nestjs/common';
import { StudentsService } from './students.service';
import { IsString, IsOptional } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

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
  constructor(private studentsService: StudentsService) {}

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

  @Post(':id/token')
  async generateToken(@Param('id') id: string, @CurrentUser() user: any) {
    return this.studentsService.generateToken(id, user?.id);
  }

  @Post(':id/reissue-qr')
  async reissueQr(@Param('id') id: string, @CurrentUser() user: any) {
    return this.studentsService.reissueQr(id, user?.id);
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
}