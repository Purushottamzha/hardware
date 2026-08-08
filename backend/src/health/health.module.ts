import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { MqttModule } from '../mqtt/mqtt.module';
import { FaceModule } from '../face/face.module';

@Module({
  imports: [MqttModule, FaceModule],
  controllers: [HealthController],
})
export class HealthModule {}
