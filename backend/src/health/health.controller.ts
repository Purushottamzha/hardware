import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check() {
    return {
      status: 'ok',
      env: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString(),
    };
  }
}
