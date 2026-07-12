import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { DevicesService } from './devices.service';
import { IsString } from 'class-validator';

export class RegisterDeviceDto {
  @IsString()
  id: string;

  @IsString()
  busId: string;
}

@Controller('devices')
export class DevicesController {
  constructor(private devicesService: DevicesService) {}

  @Get()
  async list() {
    return this.devicesService.list();
  }

  @Post('register')
  async register(@Body() dto: RegisterDeviceDto) {
    return this.devicesService.register(dto.id, dto.busId);
  }

  @Post(':id/suspend')
  async suspend(@Param('id') id: string) {
    return this.devicesService.suspend(id);
  }

  @Post(':id/reactivate')
  async reactivate(@Param('id') id: string) {
    return this.devicesService.reactivate(id);
  }
}
