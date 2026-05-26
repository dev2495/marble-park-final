import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type DateRange = { from?: Date; to?: Date };

function rangeBounds(range?: DateRange) {
  const to = range?.to ? new Date(range.to) : new Date();
  const from = range?.from ? new Date(range.from) : new Date(to.getTime() - 90 * 24 * 60 * 60 * 1000);
  return { from, to };
}

function csvEscape(value: any): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows: Array<Record<string, any>>): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(','));
  }
  return lines.join('\n');
}

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  // -- Monthly sales by category ----------------------------------------------
  async monthlySalesByCategory(range?: DateRange) {
    const { from, to } = rangeBounds(range);
    const orders = await this.prisma.salesOrder.findMany({
      where: { createdAt: { gte: from, lte: to } },
      select: { totalAmount: true, lines: true, createdAt: true },
    });
    const buckets = new Map<string, { month: string; category: string; total: number; orderCount: number }>();
    for (const order of orders) {
      const month = order.createdAt.toISOString().slice(0, 7);
      const lines = Array.isArray(order.lines) ? (order.lines as any[]) : [];
      // Roll up by line.category if present, else as 'uncategorised'.
      const seenCategories = new Set<string>();
      for (const line of lines) {
        const cat = String(line.category || 'uncategorised');
        const key = `${month}::${cat}`;
        const amount = Number(line.totalAmount || line.amount || (Number(line.qty || line.quantity || 0) * Number(line.unitPrice || line.price || 0)));
        const existing = buckets.get(key) || { month, category: cat, total: 0, orderCount: 0 };
        existing.total += amount;
        if (!seenCategories.has(cat)) {
          existing.orderCount += 1;
          seenCategories.add(cat);
        }
        buckets.set(key, existing);
      }
    }
    return Array.from(buckets.values()).sort((a, b) => (b.month + b.category).localeCompare(a.month + a.category));
  }

  // -- Top customers by revenue ----------------------------------------------
  async topCustomers(range?: DateRange, limit = 25) {
    const { from, to } = rangeBounds(range);
    const orders = await this.prisma.salesOrder.findMany({
      where: { createdAt: { gte: from, lte: to } },
      select: { customerId: true, totalAmount: true },
    });
    const sumByCustomer = new Map<string, { customerId: string; total: number; orderCount: number }>();
    for (const o of orders) {
      const e = sumByCustomer.get(o.customerId) || { customerId: o.customerId, total: 0, orderCount: 0 };
      e.total += Number(o.totalAmount || 0);
      e.orderCount += 1;
      sumByCustomer.set(o.customerId, e);
    }
    const sorted = Array.from(sumByCustomer.values()).sort((a, b) => b.total - a.total).slice(0, limit);
    const customerIds = sorted.map((s) => s.customerId);
    const customers = await this.prisma.customer.findMany({ where: { id: { in: customerIds } } });
    const customerMap = new Map(customers.map((c) => [c.id, c]));
    return sorted.map((s) => ({
      customerId: s.customerId,
      name: customerMap.get(s.customerId)?.name || 'Unknown',
      city: customerMap.get(s.customerId)?.city || '',
      gstNo: customerMap.get(s.customerId)?.gstNo || '',
      totalSpent: s.total,
      orderCount: s.orderCount,
    }));
  }

  // -- Dead stock: no inventory movement in N days ----------------------------
  async deadStock(days = 90) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const products = await this.prisma.product.findMany({
      where: { status: 'active' },
      select: { id: true, sku: true, name: true, category: true, brand: true, balances: true },
      take: 5000,
    } as any) as any[];
    const recentMovements = await this.prisma.inventoryMovement.findMany({
      where: { createdAt: { gte: since } },
      select: { productId: true },
    });
    const recentProductIds = new Set(recentMovements.map((m) => m.productId));
    const out: any[] = [];
    for (const p of products) {
      if (recentProductIds.has(p.id)) continue;
      const onHand = Number(p.balances?.onHand || 0);
      if (onHand <= 0) continue;
      out.push({
        productId: p.id,
        sku: p.sku,
        name: p.name,
        category: p.category,
        brand: p.brand,
        onHand,
        daysSinceMovement: days,
      });
    }
    return out.sort((a, b) => b.onHand - a.onHand).slice(0, 500);
  }

  // -- Conversion funnel by sales rep ----------------------------------------
  async conversionFunnel(range?: DateRange) {
    const { from, to } = rangeBounds(range);
    const [leads, quotes, orders] = await Promise.all([
      this.prisma.lead.findMany({ where: { createdAt: { gte: from, lte: to } }, select: { ownerId: true, stage: true } }),
      this.prisma.quote.findMany({ where: { createdAt: { gte: from, lte: to } }, select: { ownerId: true, status: true } }),
      this.prisma.salesOrder.findMany({ where: { createdAt: { gte: from, lte: to } }, select: { ownerId: true, totalAmount: true } }),
    ]);
    const users = await this.prisma.user.findMany({ select: { id: true, name: true, role: true } });
    const userMap = new Map(users.map((u) => [u.id, u]));
    const buckets = new Map<string, any>();
    const seed = (id: string) => {
      if (!buckets.has(id)) {
        const u = userMap.get(id);
        buckets.set(id, {
          userId: id,
          name: u?.name || 'Unknown',
          role: u?.role || '',
          leads: 0,
          quotes: 0,
          ordersWon: 0,
          revenue: 0,
        });
      }
      return buckets.get(id);
    };
    for (const l of leads) seed(l.ownerId).leads += 1;
    for (const q of quotes) seed(q.ownerId).quotes += 1;
    for (const o of orders) {
      const b = seed(o.ownerId);
      b.ordersWon += 1;
      b.revenue += Number(o.totalAmount || 0);
    }
    return Array.from(buckets.values()).sort((a, b) => b.revenue - a.revenue);
  }

  // -- Ageing of pending dispatches ------------------------------------------
  async pendingDispatchAgeing() {
    const jobs = await this.prisma.dispatchJob.findMany({
      where: { status: { in: ['pending', 'packed'] } },
      include: { customer: true, quote: true } as any,
    } as any);
    const now = Date.now();
    return (jobs as any[]).map((j) => {
      const ageDays = Math.floor((now - j.createdAt.getTime()) / (1000 * 60 * 60 * 24));
      let bucket: string;
      if (ageDays <= 3) bucket = '0-3';
      else if (ageDays <= 7) bucket = '4-7';
      else if (ageDays <= 14) bucket = '8-14';
      else if (ageDays <= 30) bucket = '15-30';
      else bucket = '30+';
      return {
        dispatchJobId: j.id,
        customer: j.customer?.name || 'Unknown',
        status: j.status,
        ageDays,
        ageBucket: bucket,
        dueDate: j.dueDate,
        quoteNumber: j.quote?.quoteNumber || '',
      };
    }).sort((a, b) => b.ageDays - a.ageDays);
  }

  // -- Ageing of unpaid receivables ------------------------------------------
  async receivablesAgeing() {
    const orders = await this.prisma.salesOrder.findMany({
      where: { paymentStatus: { in: ['unpaid', 'partial'] } },
      select: { id: true, orderNumber: true, customerId: true, totalAmount: true, createdAt: true, paymentStatus: true },
    });
    const orderIds = orders.map((o) => o.id);
    const payments = await this.prisma.payment.findMany({ where: { salesOrderId: { in: orderIds } } });
    const customerIds = Array.from(new Set(orders.map((o) => o.customerId)));
    const customers = await this.prisma.customer.findMany({ where: { id: { in: customerIds } } });
    const customerMap = new Map(customers.map((c) => [c.id, c]));
    const receivedByOrder = new Map<string, number>();
    for (const p of payments) {
      const sign = p.direction === 'refund' ? -1 : 1;
      receivedByOrder.set(p.salesOrderId, (receivedByOrder.get(p.salesOrderId) || 0) + sign * Number(p.amount || 0));
    }
    const now = Date.now();
    return orders.map((o) => {
      const received = receivedByOrder.get(o.id) || 0;
      const balance = Math.max(0, Number(o.totalAmount || 0) - received);
      const ageDays = Math.floor((now - o.createdAt.getTime()) / (1000 * 60 * 60 * 24));
      let bucket: string;
      if (ageDays <= 30) bucket = '0-30';
      else if (ageDays <= 60) bucket = '31-60';
      else if (ageDays <= 90) bucket = '61-90';
      else bucket = '90+';
      return {
        salesOrderId: o.id,
        orderNumber: o.orderNumber,
        customer: customerMap.get(o.customerId)?.name || 'Unknown',
        total: Number(o.totalAmount || 0),
        received,
        balance,
        ageDays,
        ageBucket: bucket,
        status: o.paymentStatus,
      };
    }).filter((r) => r.balance > 0).sort((a, b) => b.ageDays - a.ageDays);
  }

  // -- Generic CSV serialiser, shared across queries -------------------------
  toCsv(rows: any[]) {
    return toCsv(rows);
  }
}
