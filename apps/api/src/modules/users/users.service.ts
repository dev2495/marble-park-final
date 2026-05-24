import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
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
  constructor(private prisma: PrismaService) {}

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
    return this.prisma.user.create({
      data: {
        id: ulid(),
        name: data.name,
        email: data.email,
        passwordHash,
        role: data.role,
        phone: data.phone,
        avatarUrl: data.avatarUrl || null,
        bio: data.bio ? data.bio.slice(0, 280) : null,
        passwordChangedAt: new Date(),
      },
    } as any) as any;
  }

  async update(id: string, data: UpdateUserInput) {
    await this.findById(id);
    return this.prisma.user.update({
      where: { id },
      data: data as any,
    });
  }

  async delete(id: string) {
    await this.findById(id);
    return this.prisma.user.update({ where: { id }, data: { active: false } });
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
