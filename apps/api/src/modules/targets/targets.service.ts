import { BadRequestException, Injectable } from '@nestjs/common';
import { ulid } from 'ulid';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const MONTH_RE = /^\d{4}-\d{2}$/;

@Injectable()
export class TargetsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  async upsert(userId: string, month: string, amount: number, setBy: string, notes?: string | null) {
    if (!MONTH_RE.test(month)) throw new BadRequestException('Month must be YYYY-MM');
    if (amount < 0) throw new BadRequestException('Target amount cannot be negative');
    const target = await this.prisma.salesTarget.upsert({
      where: { userId_month: { userId, month } },
      update: { amount, notes: notes || null, setBy, updatedAt: new Date() } as any,
      create: { id: ulid(), userId, month, amount, notes: notes || null, setBy, updatedAt: new Date() } as any,
    });
    await this.audit.record({
      actorUserId: setBy,
      action: 'target.set',
      entityType: 'SalesTarget',
      entityId: target.id,
      summary: `Set ${month} target for user ${userId} to ₹${amount.toLocaleString('en-IN')}`,
      metadata: { userId, month, amount },
    });
    return target;
  }

  async listForUser(userId: string) {
    return this.prisma.salesTarget.findMany({ where: { userId }, orderBy: { month: 'desc' }, take: 24 });
  }

  async listForMonth(month: string) {
    if (!MONTH_RE.test(month)) throw new BadRequestException('Month must be YYYY-MM');
    return this.prisma.salesTarget.findMany({ where: { month } });
  }

  async getCurrentForUser(userId: string) {
    const month = new Date().toISOString().slice(0, 7);
    return this.prisma.salesTarget.findUnique({ where: { userId_month: { userId, month } } });
  }

  // Roll up actual achievement vs target for a month. "Achievement" =
  // sum of confirmed/won quotes owned by the user in the month.
  async progress(userId: string, month?: string) {
    const targetMonth = month && MONTH_RE.test(month) ? month : new Date().toISOString().slice(0, 7);
    const [target, achievement] = await Promise.all([
      this.prisma.salesTarget.findUnique({ where: { userId_month: { userId, month: targetMonth } } }),
      this.sumWonAmount(userId, targetMonth),
    ]);
    const targetAmount = Number(target?.amount || 0);
    return {
      userId,
      month: targetMonth,
      targetAmount,
      achievedAmount: achievement,
      percent: targetAmount > 0 ? Math.min(100, (achievement / targetAmount) * 100) : 0,
      remaining: Math.max(0, targetAmount - achievement),
      hasTarget: !!target,
    };
  }

  private async sumWonAmount(userId: string, month: string) {
    const [year, mm] = month.split('-').map((s) => parseInt(s, 10));
    const start = new Date(Date.UTC(year, mm - 1, 1));
    const end = new Date(Date.UTC(year, mm, 1));
    const orders = await this.prisma.salesOrder.findMany({
      where: {
        ownerId: userId,
        createdAt: { gte: start, lt: end },
      },
      select: { totalAmount: true },
    });
    return orders.reduce((s, o) => s + Number(o.totalAmount || 0), 0);
  }
}
