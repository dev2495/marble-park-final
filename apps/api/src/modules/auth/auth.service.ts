import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { AuditService } from '../audit/audit.service';
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
    private audit: AuditService,
  ) {}

  async login(input: LoginInput, ipAddress?: string, userAgent?: string) {
    const user = await this.users.findByEmail(input.email);
    if (!user) {
      // Record a failed-login attempt against an anonymous actor so admins
      // can spot brute-force or typo storms in the audit log.
      await this.audit.record({
        actorUserId: 'anonymous',
        action: 'auth.login.failed',
        entityType: 'User',
        entityId: input.email || 'unknown',
        summary: `Failed login attempt for ${input.email || 'unknown email'}`,
        metadata: { email: input.email, ipAddress, userAgent, reason: 'user-not-found' },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await this.users.verifyPassword(user, input.password);
    if (!valid) {
      await this.audit.record({
        actorUserId: user.id,
        action: 'auth.login.failed',
        entityType: 'User',
        entityId: user.id,
        summary: `Failed login attempt for ${user.email}`,
        metadata: { email: user.email, ipAddress, userAgent, reason: 'invalid-password' },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.active) {
      await this.audit.record({
        actorUserId: user.id,
        action: 'auth.login.blocked',
        entityType: 'User',
        entityId: user.id,
        summary: `Disabled account ${user.email} tried to sign in`,
        metadata: { ipAddress, userAgent },
      });
      throw new UnauthorizedException('Account is disabled');
    }

    const token = await this.createSession(user.id, ipAddress, userAgent);
    await this.audit.record({
      actorUserId: user.id,
      action: 'auth.login',
      entityType: 'User',
      entityId: user.id,
      summary: `${user.name || user.email} signed in`,
      metadata: { ipAddress, userAgent, role: user.role },
    });
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
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } }).catch(() => null);
    await this.prisma.session.delete({ where: { id: sessionId } }).catch(() => {});
    if (session?.userId) {
      await this.audit.record({
        actorUserId: session.userId,
        action: 'auth.logout',
        entityType: 'User',
        entityId: session.userId,
        summary: 'User signed out',
      });
    }
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
