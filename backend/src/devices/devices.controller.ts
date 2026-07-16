import { Controller, Get, Post, Put, Param, Body } from '@nestjs/common';
import { DevicesService } from './devices.service';
import { IsString } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

export class RegisterDeviceDto {
  @IsString()
  id: string;

  @IsString()
  busId: string;
}

export class ReassignBusDto {
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
  async register(@Body() dto: RegisterDeviceDto, @CurrentUser() user: any) {
    return this.devicesService.register(dto.id, dto.busId, user?.id);
  }

  @Post(':id/suspend')
  async suspend(@Param('id') id: string, @CurrentUser() user: any) {
    return this.devicesService.suspend(id, user?.id);
  }

  @Post(':id/reactivate')
  async reactivate(@Param('id') id: string, @CurrentUser() user: any) {
    return this.devicesService.reactivate(id, user?.id);
  }

  @Put(':id/reassign-bus')
  async reassignBus(@Param('id') id: string, @Body() dto: ReassignBusDto, @CurrentUser() user: any) {
    return this.devicesService.reassignBus(id, dto.busId, user?.id);
  }
}