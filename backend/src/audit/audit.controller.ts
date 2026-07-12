import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { AuditService } from './audit.service';
import { IsString } from 'class-validator';

export class AuditLogDto {
  @IsString()
  action: string;

  targetId?: string;
}

@Controller('audit')
export class AuditController {
  constructor(private auditService: AuditService) {}

  @Get()
  async list() {
    return this.auditService.list();
  }

  @Get('verify')
  async verify() {
    return this.auditService.verifyChain();
  }
}
