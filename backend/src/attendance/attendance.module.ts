import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import multer from 'multer';
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
export class AttendanceModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(multer({ storage: multer.memoryStorage(), limits: { fileSize: 300 * 1024 } }).single('photo'))
      .forRoutes({ path: 'attendance/photo', method: RequestMethod.POST });
  }
}
