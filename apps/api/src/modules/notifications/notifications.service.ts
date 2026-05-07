import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ulid } from 'ulid';

export interface CreateNotificationInput {
  title: string;
  message: string;
  type?: string;
  entityType?: string;
  entityId?: string;
  href?: string;
  targetUserId?: string;
  targetRole?: string;
  metadata?: any;
}

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  async create(input: CreateNotificationInput) {
    return this.prisma.notification.create({
      data: {
        id: ulid(),
        title: input.title,
        message: input.message,
        type: input.type || 'info',
        entityType: input.entityType || null,
        entityId: input.entityId || null,
        href: input.href || null,
        targetUserId: input.targetUserId || null,
        targetRole: input.targetRole || null,
        metadata: input.metadata || {},
      },
    } as any).catch(() => null);
  }

  async createMany(inputs: CreateNotificationInput[]) {
    const created: any[] = [];
    for (const input of inputs) {
      const notification = await this.create(input);
      if (notification) created.push(notification);
    }
    return created;
  }

  async forUser(user: any, args?: { unreadOnly?: boolean; take?: number }) {
    const where: any = {
      OR: [
        { targetUserId: user.id },
        { targetRole: user.role },
        { targetUserId: null, targetRole: null },
      ],
    };
    if (args?.unreadOnly) where.readAt = null;
    return this.prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: args?.take || 50,
    } as any);
  }

  async markRead(id: string, user: any) {
    const notification = await this.prisma.notification.findUnique({ where: { id } as any } as any) as any;
    if (!notification) throw new Error('Notification not found');
    const allowed = !notification.targetUserId || notification.targetUserId === user.id || notification.targetRole === user.role;
    if (!allowed) throw new Error('Notification is restricted');
    return this.prisma.notification.update({ where: { id } as any, data: { readAt: new Date() } as any } as any);
  }

  async unreadCount(user: any) {
    return this.prisma.notification.count({
      where: {
        readAt: null,
        OR: [
          { targetUserId: user.id },
          { targetRole: user.role },
          { targetUserId: null, targetRole: null },
        ],
      },
    } as any);
  }
}
