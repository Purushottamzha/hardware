import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { MqttService } from '../mqtt/mqtt.service';
import { FaceService } from '../face/face.service';

@Controller('health')
export class HealthController {
  constructor(
    private mqttService: MqttService,
    private faceService: FaceService,
  ) {}

  @Public()
  @Get()
  async check() {
    const faceService = (await this.faceService.ping()) ? 'online' : 'offline';

    return {
      status: 'ok',
      env: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString(),
      mqtt: this.mqttService.isConnected ? 'connected' : 'disconnected',
      faceService,
    };
  }
}
