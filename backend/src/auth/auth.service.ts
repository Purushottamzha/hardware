import { Injectable, UnauthorizedException, HttpException, HttpStatus } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async login(phone: string, password: string) {
    const user = await this.prisma.adminUser.findUnique({ where: { phone } });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new HttpException(
        'Account temporarily locked. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const passwordValid = await bcrypt.compare(password, user.passwordHash);
    if (!passwordValid) {
      await this.handleFailedAttempt(user.id);
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.prisma.adminUser.update({
      where: { id: user.id },
      data: { failedAttempts: 0, lockedUntil: null },
    });

    return {
      access_token: this.jwtService.sign({
        sub: user.id,
        phone: user.phone,
        role: user.role,
      }),
    };
  }

  private async handleFailedAttempt(userId: number) {
    const user = await this.prisma.adminUser.update({
      where: { id: userId },
      data: { failedAttempts: { increment: 1 } },
    });

    if (user.failedAttempts >= MAX_FAILED_ATTEMPTS) {
      await this.prisma.adminUser.update({
        where: { id: userId },
        data: {
          lockedUntil: new Date(Date.now() + LOCKOUT_DURATION_MS),
        },
      });
    }
  }
}
