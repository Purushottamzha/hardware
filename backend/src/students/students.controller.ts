import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { StudentsService } from './students.service';
import { IsString } from 'class-validator';

export class CreateStudentDto {
  @IsString()
  name: string;
}

@Controller('students')
export class StudentsController {
  constructor(private studentsService: StudentsService) {}

  @Get()
  async list() {
    return this.studentsService.list();
  }

  @Post()
  async create(@Body() dto: CreateStudentDto) {
    return this.studentsService.create(dto.name);
  }

  @Post(':id/token')
  async generateToken(@Param('id') id: string) {
    return this.studentsService.generateToken(id);
  }
}
