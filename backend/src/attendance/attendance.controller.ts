import { Controller, Get, Query, Param } from '@nestjs/common';
import { AttendanceService } from './attendance.service';

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

  @Get('timeline/:studentId')
  async getTimeline(@Param('studentId') studentId: string) {
    return this.attendanceService.getTodayTimeline(studentId);
  }
}
