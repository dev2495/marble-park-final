import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { ulid } from 'ulid';
import * as bcrypt from 'bcrypt';

export interface LoginInput {
  email: string;
  password: string;
}

export interface SessionPayload {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private users: UsersService,
  ) {}

  async login(input: LoginInput, ipAddress?: string, userAgent?: string) {
    const user = await this.users.findByEmail(input.email);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await this.users.verifyPassword(user, input.password);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.active) {
      throw new UnauthorizedException('Account is disabled');
    }

    const token = await this.createSession(user.id, ipAddress, userAgent);
    
    return {
      authenticated: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    };
  }

  async logout(sessionId: string) {
    await this.prisma.session.delete({ where: { id: sessionId } }).catch(() => {});
    return { success: true };
  }

  async validateSession(token: string): Promise<SessionPayload | null> {
    const session = await this.prisma.session.findUnique({
      where: { token },
    });

    if (!session || session.expiresAt < new Date()) {
      if (session) {
        await this.prisma.session.delete({ where: { id: session.id } }).catch(() => {});
      }
      return null;
    }

    const user = await this.prisma.user.findUnique({ where: { id: session.userId } });
    if (!user) return null;

    return {
      id: session.id,
      userId: session.userId,
      name: user.name,
      email: user.email,
      role: user.role,
    };
  }

  async createSession(
    userId: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const token = ulid();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await this.prisma.session.create({
      data: {
        id: ulid(),
        userId,
        token,
        expiresAt,
      } as any,
    });

    return token;
  }

  async requestPasswordReset(email: string) {
    const user = await this.users.findByEmail(email);
    if (!user) {
      return { success: true };
    }

    const token = ulid();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1);

    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        token,
        expiresAt,
      } as any,
    });

    return { success: true, token };
  }

  async resetPassword(token: string, newPassword: string) {
    const resetToken = await this.prisma.passwordResetToken.findUnique({
      where: { token },
    });

    if (!resetToken || resetToken.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired token');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    
    await this.prisma.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash },
    });

    await this.prisma.passwordResetToken.delete({ where: { id: resetToken.id } });
    await this.prisma.session.deleteMany({ where: { userId: resetToken.userId } });

    return { success: true };
  }
}
