import { Module } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { AttendanceController } from './attendance.controller';
import { PhotoController } from './photo.controller';
import { EventsGatewayModule } from '../events-gateway/events-gateway.module';
import { AuditModule } from '../audit/audit.module';
import { DevicesModule } from '../devices/devices.module';
import { StudentsModule } from '../students/students.module';

@Module({
  imports: [EventsGatewayModule, AuditModule, DevicesModule, StudentsModule],
  providers: [AttendanceService],
  controllers: [AttendanceController, PhotoController],
  exports: [AttendanceService],
})
export class AttendanceModule {}
