import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { AuditService } from '../audit/audit.service';
import { ulid } from 'ulid';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

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

// SHA-256 hash a token for at-rest storage. Plain Buffer→hex.
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

// In-process rate-limiter for login. Resets when the API restarts; that is
// acceptable for the small operator team Marble Park serves. For multi-node
// deploys, swap the Map for a shared store (Redis) — the surface is small.
type Attempt = { count: number; firstAt: number };
const LOGIN_ATTEMPTS = new Map<string, Attempt>();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_PER_WINDOW = 8;

function rateLimitKey(email: string, ip?: string) {
  return `${(email || '').toLowerCase()}::${ip || 'unknown'}`;
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private users: UsersService,
    private audit: AuditService,
  ) {}

  async login(input: LoginInput, ipAddress?: string, userAgent?: string) {
    const key = rateLimitKey(input.email, ipAddress);
    const now = Date.now();
    const slot = LOGIN_ATTEMPTS.get(key);
    if (slot && now - slot.firstAt < LOGIN_WINDOW_MS && slot.count >= LOGIN_MAX_PER_WINDOW) {
      await this.audit.record({
        actorUserId: 'anonymous',
        action: 'auth.login.ratelimited',
        entityType: 'User',
        entityId: input.email || 'unknown',
        summary: `Login rate-limited for ${input.email || 'unknown email'}`,
        metadata: { email: input.email, ipAddress, userAgent },
      });
      throw new HttpException('Too many login attempts. Try again in 15 minutes.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const bumpAttempts = () => {
      const current = LOGIN_ATTEMPTS.get(key);
      if (!current || now - current.firstAt >= LOGIN_WINDOW_MS) {
        LOGIN_ATTEMPTS.set(key, { count: 1, firstAt: now });
      } else {
        current.count += 1;
      }
    };

    const user = await this.users.findByEmail(input.email);
    if (!user) {
      bumpAttempts();
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
      bumpAttempts();
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

    // Successful login — reset the counter for this key.
    LOGIN_ATTEMPTS.delete(key);
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
    // Prefer hashed lookup (post-migration); fall back to plaintext during
    // the transition window where legacy sessions exist without a hash row.
    const hashed = hashToken(token);
    let session = await this.prisma.session.findFirst({ where: { tokenHash: hashed } as any });
    if (!session) {
      session = await this.prisma.session.findUnique({ where: { token } });
    }

    if (!session || session.expiresAt < new Date()) {
      if (session) {
        await this.prisma.session.delete({ where: { id: session.id } }).catch(() => {});
      }
      return null;
    }

    const user = await this.prisma.user.findUnique({ where: { id: session.userId } });
    if (!user) return null;

    // Best-effort lastSeenAt — silent on failure.
    await this.prisma.session
      .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } as any })
      .catch(() => {});

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
    const token = ulid() + ulid();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await this.prisma.session.create({
      data: {
        id: ulid(),
        userId,
        token,
        tokenHash: hashToken(token),
        expiresAt,
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
        lastSeenAt: new Date(),
      } as any,
    });

    return token;
  }

  async requestPasswordReset(email: string) {
    const user = await this.users.findByEmail(email);
    if (!user) {
      return { success: true };
    }

    const token = ulid() + ulid();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1);

    await this.prisma.passwordResetToken.create({
      data: {
        id: ulid(),
        userId: user.id,
        token: hashToken(token),
        expiresAt,
      } as any,
    });

    return { success: true, token };
  }

  async resetPassword(token: string, newPassword: string) {
    const hashed = hashToken(token);
    const resetToken = await this.prisma.passwordResetToken.findUnique({
      where: { token: hashed },
    });

    if (!resetToken || resetToken.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired token');
    }
    if (newPassword.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await this.prisma.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash, passwordChangedAt: new Date() } as any,
    });

    await this.prisma.passwordResetToken.delete({ where: { id: resetToken.id } });
    await this.prisma.session.deleteMany({ where: { userId: resetToken.userId } });

    return { success: true };
  }
}
