import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { AuditService } from '../audit/audit.service';
import { ulid } from 'ulid';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { nextIdleExpiry, sessionIdleTimeoutMs, sessionWarningMs } from './session-policy';

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

export interface SessionStatusPayload {
  expiresAt: string;
  serverTime: string;
  idleTimeoutSeconds: number;
  warningSeconds: number;
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private users: UsersService,
    private audit: AuditService,
  ) {}

  async login(input: LoginInput, ipAddress?: string, userAgent?: string) {
    const email = String(input.email || '').trim().toLowerCase();
    const sourceIp = String(ipAddress || 'unknown').trim();
    await this.assertLoginAllowed(email, sourceIp, userAgent);
    const user = await this.users.findByEmail(email);
    if (!user) {
      // Record a failed-login attempt against an anonymous actor so admins
      // can spot brute-force or typo storms in the audit log.
      await this.audit.record({
        actorUserId: 'anonymous',
        action: 'auth.login.failed',
        entityType: 'User',
        entityId: email || 'unknown',
        summary: `Failed login attempt for ${email || 'unknown email'}`,
        metadata: { email, ipAddress: sourceIp, userAgent, reason: 'user-not-found' },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await this.users.verifyPassword(user, input.password);
    if (!valid) {
      await this.audit.record({
        actorUserId: user.id,
        action: 'auth.login.failed',
        entityType: 'User',
          entityId: email,
        summary: `Failed login attempt for ${user.email}`,
        metadata: { email, userId: user.id, ipAddress: sourceIp, userAgent, reason: 'invalid-password' },
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
        metadata: { ipAddress: sourceIp, userAgent },
      });
      throw new UnauthorizedException('Account is disabled');
    }

    const token = await this.createSession(user.id, sourceIp, userAgent);
    await this.audit.record({
      actorUserId: user.id,
      action: 'auth.login',
      entityType: 'User',
      entityId: user.id,
      summary: `${user.name || user.email} signed in`,
      metadata: { ipAddress: sourceIp, userAgent, role: user.role },
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

  async logout(sessionId: string, reason = 'user') {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } }).catch(() => null);
    await this.prisma.session.delete({ where: { id: sessionId } }).catch(() => {});
    if (session?.userId) {
      await this.audit.record({
        actorUserId: session.userId,
        action: 'auth.logout',
        entityType: 'User',
        entityId: session.userId,
        summary: reason === 'idle' ? 'User session ended after inactivity' : 'User signed out',
        metadata: { reason },
      });
    }
    return { success: true };
  }

  async logoutByToken(token: string, reason = 'user') {
    const session = await this.prisma.session.findUnique({ where: { token } }).catch(() => null);
    if (!session) return { success: true };
    return this.logout(session.id, reason);
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
    if (!user || !user.active) {
      await this.prisma.session.delete({ where: { id: session.id } }).catch(() => {});
      return null;
    }

    return {
      id: session.id,
      userId: session.userId,
      name: user.name,
      email: user.email,
      role: user.role,
    };
  }

  async sessionStatus(token: string): Promise<SessionStatusPayload> {
    const session = await this.prisma.session.findUnique({ where: { token } });
    const now = new Date();
    if (!session || session.expiresAt <= now) {
      if (session) await this.prisma.session.delete({ where: { id: session.id } }).catch(() => {});
      throw new UnauthorizedException('Session expired');
    }
    const user = await this.prisma.user.findUnique({ where: { id: session.userId }, select: { active: true } });
    if (!user?.active) {
      await this.prisma.session.delete({ where: { id: session.id } }).catch(() => {});
      throw new UnauthorizedException('Account is disabled or missing');
    }
    return this.statusPayload(session.expiresAt, now);
  }

  async keepSessionAlive(token: string): Promise<SessionStatusPayload> {
    const now = new Date();
    const session = await this.prisma.session.findUnique({ where: { token } });
    if (!session || session.expiresAt <= now) {
      if (session) await this.prisma.session.delete({ where: { id: session.id } }).catch(() => {});
      throw new UnauthorizedException('Session expired');
    }
    const user = await this.prisma.user.findUnique({ where: { id: session.userId }, select: { active: true } });
    if (!user?.active) {
      await this.prisma.session.delete({ where: { id: session.id } }).catch(() => {});
      throw new UnauthorizedException('Account is disabled or missing');
    }
    const expiresAt = nextIdleExpiry(now);
    const updated = await this.prisma.session.updateMany({
      where: { token, expiresAt: { gt: now } },
      data: { lastActivityAt: now, expiresAt },
    });
    if (updated.count !== 1) {
      await this.prisma.session.deleteMany({ where: { token } }).catch(() => {});
      throw new UnauthorizedException('Session expired');
    }
    return this.statusPayload(expiresAt, now);
  }

  async createSession(
    userId: string,
    _ipAddress?: string,
    _userAgent?: string,
  ) {
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    const expiresAt = nextIdleExpiry(now);

    await this.prisma.session.create({
      data: {
        id: ulid(),
        userId,
        token,
        expiresAt,
        lastActivityAt: now,
      } as any,
    });

    return token;
  }

  private statusPayload(expiresAt: Date, now = new Date()): SessionStatusPayload {
    const timeoutMs = sessionIdleTimeoutMs();
    return {
      expiresAt: expiresAt.toISOString(),
      serverTime: now.toISOString(),
      idleTimeoutSeconds: Math.floor(timeoutMs / 1000),
      warningSeconds: Math.floor(sessionWarningMs(timeoutMs) / 1000),
    };
  }

  async requestPasswordReset(email: string) {
    // Until an approved delivery channel is configured, keep this public
    // enumeration-safe endpoint inert. Otherwise an anonymous caller could
    // continuously replace an operator-issued recovery token without ever
    // receiving the newly generated link.
    if (process.env.PASSWORD_RESET_DELIVERY_ENABLED !== 'true') {
      return { success: true };
    }
    const user = await this.users.findByEmail(email);
    if (!user) {
      return { success: true };
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1);

    await this.prisma.$transaction([
      this.prisma.passwordResetToken.deleteMany({ where: { userId: user.id } }),
      this.prisma.passwordResetToken.create({
        data: {
          id: ulid(),
          userId: user.id,
          token,
          expiresAt,
        } as any,
      }),
    ]);

    // The caller always receives the same result whether an account exists or not.
    // Delivery is intentionally delegated to a configured mail provider; never return
    // a password-reset secret in a GraphQL response.
    return { success: true };
  }

  async resetPassword(token: string, newPassword: string) {
    const resetToken = await this.prisma.passwordResetToken.findUnique({
      where: { token },
    });

    const now = new Date();
    if (!resetToken || resetToken.usedAt || resetToken.expiresAt <= now) {
      throw new BadRequestException('Invalid or expired token');
    }

    if (String(newPassword || '').length < 12) {
      throw new BadRequestException('Password must contain at least 12 characters');
    }
    const passwordHash = await bcrypt.hash(newPassword, 12);
    
    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.passwordResetToken.updateMany({
        where: { id: resetToken.id, token, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (consumed.count !== 1) throw new BadRequestException('Invalid or expired token');

      await tx.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash, passwordChangedAt: now },
      });
      await tx.session.deleteMany({ where: { userId: resetToken.userId } });
      await tx.auditEvent.create({
        data: {
          id: ulid(),
          actorUserId: resetToken.userId,
          action: 'auth.password.reset',
          entityType: 'User',
          entityId: resetToken.userId,
          summary: 'Password reset completed; all active sessions were revoked',
          metadata: { sessionsRevoked: true },
        },
      });
    });

    return { success: true };
  }

  private async assertLoginAllowed(email: string, ipAddress?: string, userAgent?: string) {
    const normalizedIp = String(ipAddress || 'unknown').trim();
    const attempts = await this.prisma.auditEvent.count({
      where: {
        action: 'auth.login.failed',
        entityId: email || 'unknown',
        createdAt: { gte: new Date(Date.now() - 15 * 60 * 1000) },
        metadata: { path: ['ipAddress'], equals: normalizedIp },
      },
    }).catch(() => 0);
    if (attempts < 10) return;
    await this.audit.record({
      actorUserId: 'anonymous',
      action: 'auth.login.throttled',
      entityType: 'User',
      entityId: email || 'unknown',
      summary: `Login throttled for ${email || 'unknown email'}`,
      metadata: { email, ipAddress: normalizedIp, userAgent, attempts, scope: 'account-and-source' },
    });
    throw new UnauthorizedException('Too many sign-in attempts. Try again in 15 minutes.');
  }
}
