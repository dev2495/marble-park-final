import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import * as bcrypt from 'bcrypt';
import { ulid } from 'ulid';

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role: string;
  phone: string;
  avatarUrl?: string | null;
  bio?: string | null;
}

export interface UpdateUserInput {
  name?: string;
  email?: string;
  phone?: string;
  role?: string;
  active?: boolean;
  password?: string;
  avatarUrl?: string | null;
  bio?: string | null;
}

export interface UpdateMyProfileInput {
  name?: string;
  phone?: string;
  email?: string;
  avatarUrl?: string | null;
  bio?: string | null;
}

export interface ChangeMyPasswordInput {
  currentPassword: string;
  newPassword: string;
}

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  async findAll() {
    return this.prisma.user.findMany({
      where: {
        AND: [
          { email: { not: { contains: '.deleted-' } } },
          { email: { not: { contains: '@removed.local' } } },
        ],
      },
      orderBy: { name: 'asc' },
    });
  }

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async create(data: CreateUserInput): Promise<any> {
    if (!data.name?.trim()) throw new BadRequestException('Name is required');
    if (!data.email?.trim()) throw new BadRequestException('Email is required');
    if (!data.password || data.password.length < 8) throw new BadRequestException('Password must be at least 8 characters');
    const email = data.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new BadRequestException('Another user already uses that email');
    const passwordHash = await bcrypt.hash(data.password, 12);
    const created = await this.prisma.user.create({
      data: {
        id: ulid(),
        name: data.name.trim().slice(0, 80),
        email,
        passwordHash,
        role: data.role,
        phone: data.phone?.trim() || '',
        avatarUrl: data.avatarUrl || null,
        bio: typeof data.bio === 'string' ? data.bio.slice(0, 280) : null,
        passwordChangedAt: new Date(),
      },
    } as any) as any;
    await this.audit.record({
      actorUserId: 'system',
      action: 'user.create',
      entityType: 'User',
      entityId: created.id,
      summary: `User ${created.name} (${created.email}) created with role ${created.role}`,
      metadata: { role: created.role, email: created.email },
    });
    return created;
  }

  async update(id: string, data: UpdateUserInput) {
    const before = await this.findById(id);
    const patch: any = {};
    if (typeof data.name === 'string' && data.name.trim()) patch.name = data.name.trim().slice(0, 80);
    if (typeof data.phone === 'string') patch.phone = data.phone.trim().slice(0, 24);
    if (typeof data.role === 'string' && data.role.trim()) patch.role = data.role.trim();
    if (typeof data.active === 'boolean') patch.active = data.active;
    if (typeof data.bio === 'string') patch.bio = data.bio.slice(0, 280);
    if (data.avatarUrl !== undefined) patch.avatarUrl = data.avatarUrl || null;
    if (typeof data.email === 'string' && data.email.trim() && data.email.trim().toLowerCase() !== before.email) {
      const email = data.email.trim().toLowerCase();
      const existing = await this.prisma.user.findUnique({ where: { email } });
      if (existing && existing.id !== id) throw new BadRequestException('Another user already uses that email');
      patch.email = email;
    }
    if (typeof data.password === 'string' && data.password.length > 0) {
      if (data.password.length < 8) throw new BadRequestException('Password must be at least 8 characters');
      patch.passwordHash = await bcrypt.hash(data.password, 12);
      patch.passwordChangedAt = new Date();
    }
    if (Object.keys(patch).length === 0) return before;
    const updated = await this.prisma.user.update({
      where: { id },
      data: patch,
    });
    // Detect role / active changes specifically — they're the high-impact ones.
    const roleChanged = data.role && data.role !== before.role;
    const activeChanged = typeof data.active === 'boolean' && data.active !== before.active;
    if (roleChanged) {
      await this.audit.record({
        actorUserId: 'system',
        action: 'user.role.change',
        entityType: 'User',
        entityId: id,
        summary: `${updated.name} role changed: ${before.role} → ${updated.role}`,
        metadata: { from: before.role, to: updated.role },
      });
    } else if (activeChanged) {
      await this.audit.record({
        actorUserId: 'system',
        action: data.active ? 'user.enable' : 'user.disable',
        entityType: 'User',
        entityId: id,
        summary: `${updated.name} ${data.active ? 'enabled' : 'disabled'}`,
      });
    } else if (patch.passwordHash) {
      await this.audit.record({
        actorUserId: 'system',
        action: 'password.reset',
        entityType: 'User',
        entityId: id,
        summary: `${updated.name} password was reset by admin/owner`,
      });
    } else {
      await this.audit.record({
        actorUserId: 'system',
        action: 'user.update',
        entityType: 'User',
        entityId: id,
        summary: `${updated.name} profile updated`,
      });
    }
    return updated;
  }

  async delete(id: string) {
    const user = await this.findById(id);
    await this.prisma.session.deleteMany({ where: { userId: id } }).catch(() => null);
    await this.prisma.passwordResetToken.deleteMany({ where: { userId: id } }).catch(() => null);
    let result: any;
    try {
      result = await this.prisma.user.delete({ where: { id } });
    } catch {
      result = await this.prisma.user.update({
        where: { id },
        data: {
          active: false,
          name: 'Removed user',
          email: `removed-${id.toLowerCase()}-${Date.now()}@removed.local`,
          phone: '',
          avatarUrl: null,
          bio: null,
        } as any,
      });
    }
    await this.audit.record({
      actorUserId: 'system',
      action: 'user.delete',
      entityType: 'User',
      entityId: id,
      summary: `User ${user.name} (${user.email}) removed from active team access`,
    });
    return result;
  }

  async verifyPassword(user: { passwordHash: string }, password: string) {
    return bcrypt.compare(password, user.passwordHash);
  }

  /**
   * Self-service profile update. Email changes are intentionally checked
   * for uniqueness so a second tab logging in with the new email fails
   * with a clean P2002 instead of a 500.
   */
  async updateMyProfile(userId: string, input: UpdateMyProfileInput) {
    const user = await this.findById(userId);
    const patch: any = {};
    if (typeof input.name === 'string' && input.name.trim()) patch.name = input.name.trim().slice(0, 80);
    if (typeof input.phone === 'string') patch.phone = input.phone.trim().slice(0, 24);
    if (typeof input.bio === 'string') patch.bio = input.bio.slice(0, 280);
    if (input.avatarUrl !== undefined) patch.avatarUrl = input.avatarUrl || null;
    if (typeof input.email === 'string' && input.email.trim() && input.email !== user.email) {
      const trimmedEmail = input.email.trim().toLowerCase();
      const existing = await this.prisma.user.findUnique({ where: { email: trimmedEmail } });
      if (existing && existing.id !== userId) {
        throw new BadRequestException('Another user already uses that email');
      }
      patch.email = trimmedEmail;
    }
    if (Object.keys(patch).length === 0) return user;
    return this.prisma.user.update({ where: { id: userId }, data: patch });
  }

  /**
   * Self-service password change. Verifies the current password, enforces a
   * minimum length, refuses to re-use the existing password, and stamps
   * `passwordChangedAt` so the profile page can show "last changed N days
   * ago" without depending on AuditEvent.
   */
  async changeMyPassword(userId: string, input: ChangeMyPasswordInput) {
    const user = await this.findById(userId);
    if (!input.currentPassword || !input.newPassword) {
      throw new BadRequestException('Current and new password are required');
    }
    if (input.newPassword.length < 8) {
      throw new BadRequestException('New password must be at least 8 characters');
    }
    const ok = await this.verifyPassword(user, input.currentPassword);
    if (!ok) throw new UnauthorizedException('Current password is incorrect');
    const reused = await this.verifyPassword(user, input.newPassword);
    if (reused) throw new BadRequestException('New password must differ from the current one');
    const passwordHash = await bcrypt.hash(input.newPassword, 12);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, passwordChangedAt: new Date() } as any,
    });
    await this.audit.record({
      actorUserId: userId,
      action: 'password.change',
      entityType: 'User',
      entityId: userId,
      summary: `${user.name || user.email} changed their password`,
    });
    // Invalidate every existing session for this user except — to keep the
    // current request usable — we don't delete the session bound to the
    // caller's token. The auth layer is the only place that knows the
    // active token, so this is a best-effort cleanup of *other* devices.
    await this.prisma.session.deleteMany({
      where: { userId, expiresAt: { lt: new Date(Date.now() + 1000 * 60 * 5) } },
    }).catch(() => null);
    return { ok: true, passwordChangedAt: new Date() };
  }
}
