import { Controller, Get, Query } from '@nestjs/common';
import { AttendanceService } from './attendance.service';

@Controller('attendance')
export class AttendanceController {
  constructor(private attendanceService: AttendanceService) {}

  @Get()
  async getEvents(@Query('studentId') studentId?: string) {
    return this.attendanceService.getEvents(studentId);
  }
}
