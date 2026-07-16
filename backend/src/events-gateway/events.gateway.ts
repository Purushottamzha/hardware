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
    studentId: string;
    student: string;
    deviceId: string;
    event: string;
    eventTimestamp: string;
    lat: number;
    lon: number;
    status: string;
    verified: boolean;
    flagged: boolean;
    flagReason: string | null;
    rejectionReason: string | null;
    routeName: string | null;
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
