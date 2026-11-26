import { Injectable, Logger, UnauthorizedException, BadRequestException } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
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
  private readonly logger = new Logger(AuthService.name);
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
        // One shared key for every unknown address: the typed text is never used
        // as a key, so a script cannot create endless distinct rows. The address
        // limit in assertLoginAllowed slows and then stops a flood of them.
        entityId: 'unknown-account',
        summary: 'Failed login attempt for an unknown email',
        metadata: { email: email.slice(0, 120), ipAddress: sourceIp, userAgent: String(userAgent || '').slice(0, 200), reason: 'user-not-found' },
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

    void this.prisma.session.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }).catch((error) => this.logger.warn(`Expired session sweep failed: ${error?.message}`));
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

  /** True when a reset link can actually be mailed (mail server configured and switched on). */
  passwordResetDeliveryAvailable(): boolean {
    return process.env.PASSWORD_RESET_DELIVERY_ENABLED === 'true' && !!process.env.SMTP_HOST;
  }

  async requestPasswordReset(email: string) {
    // The caller always gets the same answer whether or not an account exists.
    // Without a configured mail server nothing is created (an anonymous caller
    // could otherwise keep replacing a reset link the owner issued by script).
    if (!this.passwordResetDeliveryAvailable()) {
      return { success: true, delivered: false };
    }
    const user = await this.users.findByEmail(String(email || '').trim().toLowerCase());
    if (!user || !user.active) {
      return { success: true, delivered: false };
    }
    // At most one fresh link every 2 minutes per account.
    const recent = await this.prisma.passwordResetToken.findFirst({
      where: { userId: user.id, usedAt: null, createdAt: { gt: new Date(Date.now() - 2 * 60 * 1000) } } as any,
    }).catch(() => null);
    if (recent) return { success: true, delivered: false };

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

    const base = (process.env.APP_BASE_URL || process.env.CORS_ORIGIN?.split(',')[0] || '').trim().replace(/\/$/, '');
    if (!base) {
      this.logger.error('Password reset not mailed: APP_BASE_URL (or CORS_ORIGIN) is not set, so the link address is unknown.');
      return { success: true, delivered: false };
    }
    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      });
      await transporter.sendMail({
        from: process.env.SMTP_FROM || 'noreply@marblepark.in',
        to: user.email,
        subject: 'Reset your Marble Park password',
        text: `Open this link within one hour to choose a new password:\n\n${base}/reset-password#token=${token}\n\nIf you did not ask for this, ignore this message.`,
      });
      await this.audit.record({ actorUserId: user.id, action: 'auth.password.reset.sent', entityType: 'User', entityId: user.id, summary: 'Password reset link mailed' });
      return { success: true, delivered: true };
    } catch (error) {
      this.logger.error(`Password reset mail failed for user ${user.id}: ${(error as Error).message}`);
      return { success: true, delivered: false };
    }
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

  private throttleCheckFailed(error: any) {
    this.logger.error(`Login limit check failed (allowing the attempt): ${error?.message}`);
    return 0;
  }

  private async assertLoginAllowed(email: string, ipAddress?: string, userAgent?: string) {
    const normalizedIp = String(ipAddress || 'unknown').trim();
    const since = new Date(Date.now() - 15 * 60 * 1000);
    const failed = { action: 'auth.login.failed', createdAt: { gte: since } };
    // Two limits. This email and address together: 10 failures in 15 minutes
    // block (as before). There is no limit on an email alone, so nobody can lock
    // the owner out from elsewhere. This address against any email: from 40
    // failures each attempt is slowed down; only a scripted flood (300) blocks,
    // so a whole shop behind one internet address is never locked out by
    // normal typing mistakes.
    const ipMatch = { metadata: { path: ['ipAddress'], equals: normalizedIp } };
    const [pair, address] = await Promise.all([
      this.prisma.auditEvent.count({ where: { ...failed, AND: [ipMatch, { OR: [
        { entityId: email || 'unknown' },
        // Unknown emails share one audit key; match the typed email kept in metadata.
        { entityId: 'unknown-account', metadata: { path: ['email'], equals: email.slice(0, 120) } },
      ] }] } as any }).catch((error) => this.throttleCheckFailed(error)),
      this.prisma.auditEvent.count({ where: { ...failed, ...ipMatch } as any }).catch((error) => this.throttleCheckFailed(error)),
    ]);
    if (pair < 10 && address < 300) {
      if (address >= 40) await new Promise((resolve) => setTimeout(resolve, Math.min(5000, 1000 + (address - 40) * 50)));
      return;
    }
    // Record the block once per window, not on every refused attempt.
    const already = await this.prisma.auditEvent.count({
      where: { action: 'auth.login.throttled', createdAt: { gte: since }, entityId: email || 'unknown', metadata: { path: ['ipAddress'], equals: normalizedIp } },
    }).catch(() => 1);
    if (!already) {
      await this.audit.record({
        actorUserId: 'anonymous',
        action: 'auth.login.throttled',
        entityType: 'User',
        entityId: email || 'unknown',
        summary: `Login throttled for ${email || 'unknown email'}`,
        metadata: { email: email.slice(0, 120), ipAddress: normalizedIp, userAgent: String(userAgent || '').slice(0, 200), attempts: { pair, address }, scope: pair >= 10 ? 'account-and-address' : 'address' },
      });
    }
    throw new UnauthorizedException('Too many sign-in attempts. Try again in 15 minutes.');
  }
}
