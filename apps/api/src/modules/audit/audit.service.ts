import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ulid } from 'ulid';

/**
 * Audit log query service.
 *
 * The `AuditEvent` table is already written from quotes, imports, catalogue
 * review, etc. This service is the *read* side — filters, pagination, and
 * the lightweight stats aggregates the audit dashboard renders into charts.
 *
 * It also exposes a `record()` helper that other services can call without
 * needing to know about Prisma directly. Keeps the audit-write call sites
 * uniform (single import, single shape).
 */

export interface AuditFilters {
  actorUserId?: string;
  action?: string;          // exact match
  actionPrefix?: string;    // e.g. 'quote.' or 'import.'
  entityType?: string;
  entityId?: string;
  search?: string;          // ILIKE summary
  from?: Date | string;
  to?: Date | string;
  /** When true, only return high-impact actions (delete/approve/confirm/...). */
  criticalOnly?: boolean;
}

const CRITICAL_PATTERNS: RegExp[] = [
  /\.delete$/i,
  /\.approve$/i,
  /\.reject$/i,
  /\.confirm$/i,
  /\.apply$/i,
  /role\.change/i,
  /password\.change/i,
  /user\.disable/i,
  /user\.delete/i,
];

function isCritical(action: string): boolean {
  return CRITICAL_PATTERNS.some((re) => re.test(action || ''));
}

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  /**
   * Convenience writer. Other services can `this.audit.record(...)` instead
   * of writing prisma.auditEvent.create inline. Swallows failures (audit
   * should never block business operations).
   */
  async record(input: {
    actorUserId: string;
    action: string;
    entityType: string;
    entityId: string;
    summary: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    try {
      await this.prisma.auditEvent.create({
        data: {
          id: ulid(),
          actorUserId: input.actorUserId,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          summary: input.summary,
          metadata: (input.metadata as any) || {},
        },
      });
    } catch {
      // swallow — audit failures must never break a business write
    }
  }

  private whereFromFilters(filters?: AuditFilters): any {
    const where: any = {};
    if (filters?.actorUserId) where.actorUserId = filters.actorUserId;
    if (filters?.action) where.action = filters.action;
    if (filters?.actionPrefix) where.action = { startsWith: filters.actionPrefix };
    if (filters?.entityType) where.entityType = filters.entityType;
    if (filters?.entityId) where.entityId = filters.entityId;
    if (filters?.search) {
      where.summary = { contains: filters.search, mode: 'insensitive' as const };
    }
    const fromTo: any = {};
    if (filters?.from) fromTo.gte = new Date(filters.from);
    if (filters?.to) fromTo.lte = new Date(filters.to);
    if (Object.keys(fromTo).length) where.createdAt = fromTo;
    return where;
  }

  /**
   * Cursor-paginated list. Events come back with the actor row joined so
   * the page can render avatars without a second hop.
   */
  async findAll(args: { filters?: AuditFilters; take?: number; cursor?: string | null }): Promise<{
    events: any[];
    nextCursor: string | null;
    total: number;
  }> {
    const where = this.whereFromFilters(args.filters);
    const take = Math.min(Math.max(Number(args.take) || 50, 1), 200);

    const [rows, total] = await Promise.all([
      this.prisma.auditEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: take + 1, // one extra to detect "more"
        ...(args.cursor ? { skip: 1, cursor: { id: args.cursor } } : {}),
      } as any),
      this.prisma.auditEvent.count({ where }),
    ]);

    const hasMore = rows.length > take;
    const sliced = hasMore ? rows.slice(0, take) : rows;
    const nextCursor = hasMore ? sliced[sliced.length - 1].id : null;

    // Hydrate actor info (batched).
    const actorIds = Array.from(new Set(sliced.map((r: any) => r.actorUserId).filter(Boolean)));
    const actors = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds as string[] } },
          select: { id: true, name: true, email: true, role: true, avatarUrl: true },
        })
      : [];
    const byId = new Map(actors.map((a: any) => [a.id, a]));

    const events = sliced.map((row: any) => ({
      ...row,
      actor: byId.get(row.actorUserId) || null,
      critical: isCritical(row.action),
    }));

    // Post-filter for criticalOnly because the regex set is too rich for
    // Prisma's where clause. Volumes are bounded by `take`.
    const filtered = args.filters?.criticalOnly ? events.filter((e) => e.critical) : events;

    return { events: filtered, nextCursor, total };
  }

  /**
   * Aggregates for the audit dashboard top section.
   *   • totalEvents — count in window
   *   • eventsByDay — array of { day, count }, fills missing days with 0
   *   • topActors — top 8 by event count, name resolved
   *   • topActions — top 10 actions by count
   *   • byEntityType — distribution across entity types
   *   • criticalCount — number of critical-impact actions in window
   *   • activeActors — distinct users with any event in window
   */
  async getStats(range: string = 'week'): Promise<any> {
    const now = new Date();
    const from = new Date(now);
    let days = 7;
    if (range === 'today') days = 1;
    else if (range === 'week') days = 7;
    else if (range === 'month') days = 30;
    else if (range === 'quarter') days = 90;
    else if (range === 'all') days = 365;
    from.setDate(now.getDate() - days);
    from.setHours(0, 0, 0, 0);

    const where = { createdAt: { gte: from, lte: now } };
    const rows = (await this.prisma.auditEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 5000,
    } as any)) as any[];

    // Per-day buckets.
    const buckets = new Map<string, number>();
    for (let i = days; i >= 0; i -= 1) {
      const d = new Date(now); d.setDate(now.getDate() - i); d.setHours(0, 0, 0, 0);
      buckets.set(d.toISOString().slice(0, 10), 0);
    }
    for (const r of rows) {
      const k = String(r.createdAt).slice(0, 10);
      if (buckets.has(k)) buckets.set(k, (buckets.get(k) || 0) + 1);
    }
    const eventsByDay = Array.from(buckets.entries()).map(([day, count]) => ({ day, count }));

    // Top actors.
    const actorCounts = new Map<string, number>();
    for (const r of rows) {
      if (!r.actorUserId) continue;
      actorCounts.set(r.actorUserId, (actorCounts.get(r.actorUserId) || 0) + 1);
    }
    const topActorIds = [...actorCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    const actors = topActorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: topActorIds.map(([id]) => id) } },
          select: { id: true, name: true, email: true, role: true, avatarUrl: true },
        })
      : [];
    const actorById = new Map(actors.map((a: any) => [a.id, a]));
    const topActors = topActorIds.map(([id, count]) => ({
      userId: id,
      count,
      actor: actorById.get(id) || null,
    }));

    // Top actions.
    const actionCounts = new Map<string, number>();
    for (const r of rows) actionCounts.set(r.action, (actionCounts.get(r.action) || 0) + 1);
    const topActions = [...actionCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([action, count]) => ({ action, count, critical: isCritical(action) }));

    // By entity type.
    const entityCounts = new Map<string, number>();
    for (const r of rows) entityCounts.set(r.entityType, (entityCounts.get(r.entityType) || 0) + 1);
    const byEntityType = [...entityCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([entityType, count]) => ({ entityType, count }));

    // Critical & active counts.
    const criticalCount = rows.filter((r) => isCritical(r.action)).length;
    const activeActors = actorCounts.size;

    return {
      range,
      totalEvents: rows.length,
      eventsByDay,
      topActors,
      topActions,
      byEntityType,
      criticalCount,
      activeActors,
      from,
      to: now,
    };
  }

  /**
   * Plain CSV export. Streamed via the GraphQL response (small enough for
   * normal volumes — bigger windows can paginate).
   */
  async exportCsv(filters?: AuditFilters, take = 2000): Promise<string> {
    const where = this.whereFromFilters(filters);
    const rows = (await this.prisma.auditEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(take, 5000),
    } as any)) as any[];
    const actorIds = Array.from(new Set(rows.map((r) => r.actorUserId).filter(Boolean)));
    const actors = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds as string[] } },
          select: { id: true, name: true, email: true },
        })
      : [];
    const byId = new Map(actors.map((a: any) => [a.id, a]));

    const header = ['timestamp', 'actor_name', 'actor_email', 'action', 'entity_type', 'entity_id', 'summary'];
    const escape = (v: any) => {
      const s = v == null ? '' : String(v);
      return /["\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [header.join(',')];
    for (const r of rows) {
      const a: any = byId.get(r.actorUserId) || {};
      lines.push([
        new Date(r.createdAt).toISOString(),
        escape(a.name || ''),
        escape(a.email || ''),
        escape(r.action),
        escape(r.entityType),
        escape(r.entityId),
        escape(r.summary),
      ].join(','));
    }
    return lines.join('\n');
  }
}
