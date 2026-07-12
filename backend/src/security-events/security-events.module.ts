import { Module } from '@nestjs/common';
import { SecurityEventsController } from './security-events.controller';

@Module({
  controllers: [SecurityEventsController],
})
export class SecurityEventsModule {}
