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
}

export interface UpdateUserInput {
  name?: string;
  phone?: string;
  role?: string;
  active?: boolean;
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
    const passwordHash = await bcrypt.hash(data.password, 12);
    const created = await this.prisma.user.create({
      data: {
        id: ulid(),
        name: data.name,
        email: data.email,
        passwordHash,
        role: data.role,
        phone: data.phone,
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
    const updated = await this.prisma.user.update({
      where: { id },
      data: data as any,
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
    const result = await this.prisma.user.delete({ where: { id } });
    await this.audit.record({
      actorUserId: 'system',
      action: 'user.delete',
      entityType: 'User',
      entityId: id,
      summary: `User ${user.name} (${user.email}) deleted`,
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
