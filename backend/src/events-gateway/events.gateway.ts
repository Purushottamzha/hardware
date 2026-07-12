import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server } from 'socket.io';

@WebSocketGateway({
  cors: {
    origin: process.env.DASHBOARD_ORIGIN || 'http://localhost:5173',
    credentials: true,
  },
})
export class EventsGateway implements OnGatewayInit {
  @WebSocketServer()
  server: Server;

  afterInit() {
    console.log('Socket.IO gateway initialized');
  }

  broadcastEvent(data: {
    student: string;
    event: string;
    time: string;
    lat: number;
    lon: number;
    status: string;
  }) {
    this.server?.emit('attendanceEvent', data);
  }

  broadcastSecurityEvent(data: {
    type: string;
    deviceId?: string;
    time: string;
    raw: any;
  }) {
    this.server?.emit('securityEvent', data);
  }
}
