import { Module } from '@nestjs/common';
import { MqttService } from './mqtt.service';
import { AttendanceModule } from '../attendance/attendance.module';

@Module({
  imports: [AttendanceModule],
  providers: [MqttService],
  exports: [MqttService],
})
export class MqttModule {}
