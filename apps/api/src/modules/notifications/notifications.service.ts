import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ulid } from 'ulid';

export interface CreateNotificationInput {
  title: string; message: string; type?: string; entityType?: string; entityId?: string;
  href?: string; targetUserId?: string; targetRole?: string; metadata?: any;
}

export function notificationAudience(user: any) {
  return { OR: [
    { targetUserId: user.id },
    { targetUserId: null, targetRole: { in: [user.role, ...(['owner','admin'].includes(user.role) ? ['owner_admin'] : [])] }, targetPermission: null },
    { targetUserId: null, targetPermission: { in: user.effectivePermissions || [] } },
  ] };
}

export function notificationLimit(value: unknown, fallback = 30) {
  if (value == null) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 100) throw new BadRequestException('Choose between 1 and 100 notifications.');
  return number;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  constructor(private prisma: PrismaService) {}

  // Actionable states are additionally reconciled from committed business records.
  async create(input: CreateNotificationInput) {
    if (!input.targetUserId && !input.targetRole) {
      this.logger.warn(`Notification rejected: missing audience (${input.type || 'info'})`);
      return null;
    }
    try {
      return await this.prisma.notification.create({ data: {
        id: ulid(), ...input, type: input.type || 'info', metadata: input.metadata || {},
        href: input.href?.startsWith('/dashboard/') ? input.href : '/dashboard/notifications',
      } });
    } catch (error) {
      this.logger.error(`Notification persistence failed (${input.type || 'info'}); actionable work will be reconciled`, (error as Error).stack);
      return null; // Do not invite a retry of an already committed business operation.
    }
  }
  async createMany(inputs: CreateNotificationInput[]) { return Promise.all(inputs.map(input => this.create(input))); }

  private recipientWhere(user: any, args: any = {}): any {
    const now = new Date();
    const filters: any[] = [notificationAudience(user)];
    if (args.view === 'action') filters.push({ category: 'action', status: 'open', OR: [{ assignedUserId: user.id }, { targetUserId: user.id }] });
    if (args.view === 'team') filters.push({ category: 'action', status: 'open', targetUserId: null, assignedUserId: null });
    if (args.view === 'updates') filters.push({ category: 'updates' });
    if (args.view === 'completed') filters.push({ category: 'action', status: 'resolved' });
    if (args.view === 'open') filters.push({ category: 'action', status: 'open' });
    if (args.search) filters.push({ OR: ['title', 'message'].map(key => ({ [key]: { contains: String(args.search).slice(0, 120), mode: 'insensitive' } })) });
    if (args.id) filters.push({ id: args.id });
    return {
      userId: user.id,
      archivedAt: args.view === 'archived' ? { not: null } : null,
      ...(args.unreadOnly ? { readAt: null } : {}),
      OR: args.view === 'snoozed' ? [{ snoozedUntil: { gt: now } }] : [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
      notification: { AND: filters },
    };
  }
  private decorate(receipt: any) {
    const n = receipt.notification;
    return { ...n, readAt: receipt.readAt, archivedAt: receipt.archivedAt, snoozedUntil: receipt.snoozedUntil,
      deliveryError: undefined, deliveryAttempts: undefined, retryAt: undefined,
      href: n.href?.startsWith('/dashboard/') ? n.href : '/dashboard/notifications',
      actionLabel: n.metadata?.actionLabel || 'Open record' };
  }
  async inbox(user: any, args: any = {}) {
    const take = notificationLimit(args.take);
    if (args.view && !['all','open','action','team','updates','completed','archived','snoozed'].includes(args.view)) throw new BadRequestException('Unknown inbox view');
    const where = this.recipientWhere(user, args);
    if (args.cursor) {
      let cursor: any;
      try { cursor = JSON.parse(Buffer.from(args.cursor, 'base64url').toString()); } catch { throw new BadRequestException('Invalid page cursor'); }
      if (!cursor.id || !Number.isFinite(Date.parse(cursor.at))) throw new BadRequestException('Invalid page cursor');
      where.notification.AND.push({ OR: [{ createdAt: { lt: new Date(cursor.at) } }, { createdAt: new Date(cursor.at), id: { lt: cursor.id } }] });
    }
    const receipts = await this.prisma.notificationRecipient.findMany({ where, include: { notification: true },
      orderBy: [{ notification: { createdAt: 'desc' } }, { notificationId: 'desc' }], take: take + 1 });
    const items = receipts.slice(0, take).map(row => this.decorate(row));
    const last = items[items.length - 1];
    const [unread, action, team, preference] = await Promise.all([
      this.unreadCount(user),
      this.prisma.notificationRecipient.count({ where: this.recipientWhere(user, { view: 'action' }) }),
      this.prisma.notificationRecipient.count({ where: this.recipientWhere(user, { view: 'team' }) }),
      this.prisma.notificationPreference.findUnique({ where: { userId: user.id } }),
    ]);
    return { items, nextCursor: receipts.length > take && last ? Buffer.from(JSON.stringify({ id: last.id, at: last.createdAt })).toString('base64url') : null,
      unread, action, team, preference: preference || { muteUpdates: false } };
  }
  async forUser(user: any, args?: { unreadOnly?: boolean; take?: number }) {
    const take = notificationLimit(args?.take, 8);
    const preference = await this.prisma.notificationPreference.findUnique({ where: { userId: user.id } });
    const where = this.recipientWhere(user, args);
    where.notification.AND.push({ OR: [{ category: 'action', status: 'open' }, ...(preference?.muteUpdates ? [] : [{ category: 'updates' }])] });
    const rows = await this.prisma.notificationRecipient.findMany({ where, include: { notification: true },
      orderBy: [{ readAt: { sort: 'asc', nulls: 'first' } }, { notification: { createdAt: 'desc' } }, { notificationId: 'desc' }], take });
    return rows.map(row => this.decorate(row));
  }
  async markRead(id: string, user: any) { return this.change([id], 'read', user); }

  async change(ids: string[], action: string, user: any) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 100) throw new BadRequestException('Select 1–100 notifications.');
    if (!['read','unread','archive','restore','snooze','unsnooze','claim','release'].includes(action)) throw new BadRequestException('Unknown notification action');
    return this.prisma.$transaction(async tx => {
      const rows = await tx.notificationRecipient.findMany({ where: { userId: user.id, notificationId: { in: ids }, notification: notificationAudience(user) }, include: { notification: true } });
      if (rows.length !== new Set(ids).size) throw new ForbiddenException('A notification is unavailable or no longer assigned to your team.');
      for (const row of rows) {
        const n = row.notification;
        if (action === 'archive' && n.category === 'action' && n.status === 'open') throw new BadRequestException('Open work cannot be archived. Complete it in the source record or snooze it.');
        if (action === 'claim' || action === 'release') {
          if (ids.length !== 1 || n.category !== 'action' || n.status !== 'open' || n.targetUserId) throw new BadRequestException('Only open team work can be claimed.');
          const changed = await tx.notification.updateMany({ where: { id: n.id, assignedUserId: action === 'claim' ? null : user.id, status: 'open' }, data: { assignedUserId: action === 'claim' ? user.id : null } });
          if (!changed.count) throw new BadRequestException('This task was already claimed or changed. Refresh the inbox.');
          await tx.auditEvent.create({ data: { id: ulid(), actorUserId: user.id, action: `notification.${action}`, entityType: 'Notification', entityId: n.id, summary: `${action === 'claim' ? 'Claimed' : 'Released'} ${n.title}` } });
        } else {
          const data: any = action === 'read' ? { readAt: new Date() } : action === 'unread' ? { readAt: null } : action === 'archive' ? { archivedAt: new Date() } : action === 'restore' ? { archivedAt: null } : action === 'snooze' ? { snoozedUntil: new Date(Date.now() + 3600000) } : { snoozedUntil: null };
          await tx.notificationRecipient.update({ where: { notificationId_userId: { notificationId: n.id, userId: user.id } }, data });
        }
      }
      return { success: true, count: rows.length };
    });
  }
  async unreadCount(user: any) {
    const pref = await this.prisma.notificationPreference.findUnique({ where: { userId: user.id } });
    const where = this.recipientWhere(user, { unreadOnly: true });
    where.notification.AND.push({ OR: [{ category: 'action', status: 'open' }, ...(pref?.muteUpdates ? [] : [{ category: 'updates' }])] });
    return this.prisma.notificationRecipient.count({ where });
  }
  async preferences(user: any, muteUpdates: boolean) {
    return this.prisma.notificationPreference.upsert({ where: { userId: user.id }, create: { userId: user.id, muteUpdates }, update: { muteUpdates } });
  }
  async health(user: any) {
    if (!['owner', 'admin'].includes(user.role)) throw new ForbiddenException('Administrator access required');
    const [pending, failed, oldest, heartbeat, unrouted] = await Promise.all([
      this.prisma.notification.count({ where: { deliveredAt: null } }),
      this.prisma.notification.count({ where: { deliveredAt: null, deliveryAttempts: { gt: 0 } } }),
      this.prisma.notification.findFirst({ where: { deliveredAt: null }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
      this.prisma.notification.findUnique({ where: { taskKey: 'system:notification-worker' }, select: { reconciledAt: true } }),
      this.prisma.notification.count({ where: { category: 'action', status: 'open', recipients: { none: {} } } }),
    ]);
    return { pending, failed, unrouted, oldestPendingAt: oldest?.createdAt || null, lastReconciledAt: heartbeat?.reconciledAt || null,
      healthy: Boolean(heartbeat?.reconciledAt && Date.now() - heartbeat.reconciledAt.getTime() < 180000 && failed === 0 && unrouted === 0) };
  }
}
