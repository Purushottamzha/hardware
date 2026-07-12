import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as mqtt from 'mqtt';
import { AttendanceService } from '../attendance/attendance.service';

@Injectable()
export class MqttService implements OnModuleInit {
  private readonly logger = new Logger(MqttService.name);
  private client: mqtt.MqttClient;

  constructor(private attendanceService: AttendanceService) {}

  async onModuleInit() {
    const host = process.env.MOSQUITTO_HOST || 'mosquitto';
    const port = parseInt(process.env.MOSQUITTO_PORT || '8883', 10);
    const username = process.env.MOSQUITTO_USERNAME || 'backend';
    const password = process.env.MOSQUITTO_PASSWORD || '';
    const caPath = process.env.MOSQUITTO_CA_CERT || '/mosquitto/certs/ca.crt';

    this.client = mqtt.connect(`mqtts://${host}:${port}`, {
      username,
      password,
      ca: caPath,
      rejectUnauthorized: false,
      clientId: `backend-${Date.now()}`,
    });

    this.client.on('connect', () => {
      this.logger.log('Connected to Mosquitto');
      this.client.subscribe('saferide/hardware/+/attendance', { qos: 1 });
    });

    this.client.on('message', async (topic, payload) => {
      try {
        const raw = JSON.parse(payload.toString());
        this.logger.debug(`MQTT event from ${raw.deviceId}: counter=${raw.counter}`);
        await this.attendanceService.processEvent(raw);
      } catch (err: any) {
        this.logger.error(`Failed to process MQTT message: ${err.message}`);
      }
    });

    this.client.on('error', (err) => {
      this.logger.error(`MQTT error: ${err.message}`);
    });
  }
}
