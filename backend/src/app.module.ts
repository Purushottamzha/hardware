import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { CommonModule } from './common/common.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { DevicesModule } from './devices/devices.module';
import { StudentsModule } from './students/students.module';
import { AttendanceModule } from './attendance/attendance.module';
import { MqttModule } from './mqtt/mqtt.module';
import { EventsGatewayModule } from './events-gateway/events-gateway.module';
import { AuditModule } from './audit/audit.module';
import { SecurityEventsModule } from './security-events/security-events.module';
import { HealthModule } from './health/health.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }]),
    CommonModule,
    PrismaModule,
    AuthModule,
    DevicesModule,
    StudentsModule,
    AttendanceModule,
    MqttModule,
    EventsGatewayModule,
    AuditModule,
    SecurityEventsModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
