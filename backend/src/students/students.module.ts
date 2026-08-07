import { Module } from '@nestjs/common';
import { StudentsService } from './students.service';
import { StudentsController } from './students.controller';
import { AuditModule } from '../audit/audit.module';
import { DevicesModule } from '../devices/devices.module';
import { FaceModule } from '../face/face.module';

@Module({
  imports: [AuditModule, DevicesModule, FaceModule],
  providers: [StudentsService],
  controllers: [StudentsController],
  exports: [StudentsService],
})
export class StudentsModule {}
