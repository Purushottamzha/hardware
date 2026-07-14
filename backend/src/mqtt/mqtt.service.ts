import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'node:fs';
import * as mqtt from 'mqtt';
import { AttendanceService } from '../attendance/attendance.service';
import { loadSecret } from '../common/config/secret-loader';

@Injectable()
export class MqttService implements OnModuleInit {
  private readonly logger = new Logger(MqttService.name);
  private client: mqtt.MqttClient;

  constructor(private attendanceService: AttendanceService) {}

  async onModuleInit() {
    const host = process.env.MOSQUITTO_HOST || 'mosquitto';
    const port = parseInt(process.env.MOSQUITTO_PORT || '8883', 10);
    const username = process.env.MOSQUITTO_USERNAME || 'backend';
    const password = process.env.MOSQUITTO_PASSWORD || loadSecret('MOSQUITTO_PASSWORD') || '';
    const caPath = process.env.MOSQUITTO_CA_CERT || '/mosquitto/certs/ca.crt';

    const rejectUnauthorized = process.env.MQTT_TLS_REJECT_UNAUTHORIZED !== 'false';

    const tlsOptions: any = {
      username,
      password,
      rejectUnauthorized,
      clientId: `backend-${Date.now()}`,
    };

    if (rejectUnauthorized) {
      tlsOptions.ca = fs.readFileSync(caPath);
      tlsOptions.servername = host;
    }

    this.client = mqtt.connect(`mqtts://${host}:${port}`, tlsOptions);

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
