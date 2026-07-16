import { Controller, Get, Post, Put, Query, Param, Body } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { IsOptional, IsString, IsNumber } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

export class ResolveAlertDto {
  @IsOptional()
  @IsString()
  note?: string;
}

export class ManualAttendanceDto {
  @IsString()
  studentId: string;

  @IsString()
  eventType: string;

  @IsString()
  reason: string;
}

export class CalendarOverrideDto {
  @IsString()
  date: string;

  @IsString()
  dayType: string;

  @IsOptional()
  @IsString()
  boardWindowStart?: string;

  @IsOptional()
  @IsString()
  boardWindowEnd?: string;

  @IsOptional()
  @IsString()
  departWindowStart?: string;

  @IsOptional()
  @IsString()
  departWindowEnd?: string;
}

@Controller('attendance')
export class AttendanceController {
  constructor(private attendanceService: AttendanceService) {}

  @Get()
  async getEvents(@Query('studentId') studentId?: string) {
    return this.attendanceService.getEvents(studentId);
  }

  @Get('overview')
  async getOverview() {
    return this.attendanceService.getOverview();
  }

  @Get('alerts')
  async getAlerts() {
    return this.attendanceService.getAlerts();
  }

  @Get('routes')
  async getRoutes() {
    return this.attendanceService.getRoutes();
  }

  @Get('timeline/:studentId')
  async getTimeline(@Param('studentId') studentId: string) {
    return this.attendanceService.getTodayTimeline(studentId);
  }

  @Post('alerts/:id/resolve')
  async resolveAlert(@Param('id') id: string, @Body() dto: ResolveAlertDto) {
    return this.attendanceService.resolveAlert(Number(id), dto.note);
  }

  @Post('manual')
  async createManualAttendance(@Body() dto: ManualAttendanceDto, @CurrentUser() user: any) {
    return this.attendanceService.createManualAttendance(user?.id, dto.studentId, dto.eventType, dto.reason);
  }

  @Get('calendar-overrides')
  async getCalendarOverrides() {
    return this.attendanceService.getCalendarOverrides();
  }

  @Post('calendar-overrides')
  async createCalendarOverride(@Body() dto: CalendarOverrideDto, @CurrentUser() user: any) {
    return this.attendanceService.createCalendarOverride(dto, user?.id);
  }

  @Put('calendar-overrides/:id')
  async updateCalendarOverride(@Param('id') id: string, @Body() dto: CalendarOverrideDto, @CurrentUser() user: any) {
    return this.attendanceService.updateCalendarOverride(Number(id), dto, user?.id);
  }

  @Post('calendar-overrides/:id')
  async deleteCalendarOverride(@Param('id') id: string, @CurrentUser() user: any) {
    return this.attendanceService.deleteCalendarOverride(Number(id), user?.id);
  }
}