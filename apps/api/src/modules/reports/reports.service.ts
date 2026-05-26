import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// Reports service — powers /dashboard/reports with 6 tab boards.
//   • boardData(tab, range, options) returns the full payload per tab.
//   • Legacy single-purpose helpers below (used by CSV exports and earlier UI)
//     stay so nothing breaks.
// ---------------------------------------------------------------------------

export type ReportTab = 'overview' | 'sales' | 'pipeline' | 'inventory' | 'procurement' | 'money';

export interface ReportFilters {
  from?: Date | null;
  to?: Date | null;
  // Comparison period — same length immediately before [from..to].
  compare?: boolean | null;
  // Sales tab segment chip — applied to revenue queries.
  segment?: 'all' | 'walkin' | 'architect' | 'b2b' | 'b2c' | 'cash' | 'credit' | null;
}

type DateRange = { from: Date; to: Date };

function defaultRange(filters: ReportFilters): DateRange {
  const to = filters?.to ? new Date(filters.to) : new Date();
  const from = filters?.from ? new Date(filters.from) : new Date(to.getTime() - 30 * 86400000);
  return { from, to };
}

function priorRange(r: DateRange): DateRange {
  const ms = r.to.getTime() - r.from.getTime();
  return { from: new Date(r.from.getTime() - ms), to: new Date(r.from.getTime() - 1) };
}

function delta(curr: number, prior: number) {
  if (!prior || prior === 0) return curr > 0 ? 100 : 0;
  return ((curr - prior) / prior) * 100;
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
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
  for (const row of rows) lines.push(headers.map((h) => csvEscape(row[h])).join(','));
  return lines.join('\n');
}

// 30s in-memory cache. Reports are fine slightly-stale — the alternative
// (recomputing every refresh) is wasteful.
const CACHE = new Map<string, { at: number; payload: any }>();
const CACHE_TTL_MS = 30 * 1000;

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  // ====================================================================
  // Public entry — tab dispatcher with cache + parallel sub-queries.
  // ====================================================================
  async boardData(tab: ReportTab, filters: ReportFilters) {
    const range = defaultRange(filters);
    const prior = filters.compare ? priorRange(range) : null;
    const cacheKey = `${tab}::${range.from.toISOString()}::${range.to.toISOString()}::${filters.compare ? 'c' : ''}::${filters.segment || ''}`;
    const cached = CACHE.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.payload;

    let payload: any;
    switch (tab) {
      case 'overview': payload = await this.overviewBoard(range, prior); break;
      case 'sales': payload = await this.salesBoard(range, prior, filters.segment || 'all'); break;
      case 'pipeline': payload = await this.pipelineBoard(range, prior); break;
      case 'inventory': payload = await this.inventoryBoard(range, prior); break;
      case 'procurement': payload = await this.procurementBoard(range, prior); break;
      case 'money': payload = await this.moneyBoard(range, prior); break;
      default: payload = await this.overviewBoard(range, prior);
    }
    CACHE.set(cacheKey, { at: Date.now(), payload });
    return payload;
  }

  // ====================================================================
  // OVERVIEW — 6 hero KPIs + 8 widgets.
  // ====================================================================
  private async overviewBoard(range: DateRange, prior: DateRange | null) {
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const targetMonths = this.monthKeysBetween(range.from, range.to);

    // Pull everything in parallel
    const [
      ordersCurr, ordersPrior,
      paymentsCurr, paymentsPrior,
      leads, allLeads, quotesCurr, intentsCurr,
      reps, customers,
      salesTargets,
      balances, recentMovements,
      dailyRevenue, categoryMix, paymentMix,
      challansCurr, dispatchAgeing,
    ] = await Promise.all([
      this.prisma.salesOrder.findMany({ where: { createdAt: { gte: range.from, lte: range.to } } }) as Promise<any[]>,
      (prior ? this.prisma.salesOrder.findMany({ where: { createdAt: { gte: prior.from, lte: prior.to } } }) : Promise.resolve([])) as Promise<any[]>,
      this.prisma.payment.findMany({ where: { paidAt: { gte: range.from, lte: range.to } } }).catch(() => []) as Promise<any[]>,
      (prior ? this.prisma.payment.findMany({ where: { paidAt: { gte: prior.from, lte: prior.to } } }).catch(() => []) : Promise.resolve([])) as Promise<any[]>,
      this.prisma.lead.findMany({ where: { createdAt: { gte: range.from, lte: range.to } } }),
      this.prisma.lead.findMany(),
      this.prisma.quote.findMany({ where: { createdAt: { gte: range.from, lte: range.to } }, select: { id: true, status: true, leadId: true, createdAt: true, ownerId: true, lines: true } }),
      this.prisma.leadIntent.findMany({ where: { createdAt: { gte: range.from, lte: range.to } } }).catch(() => []),
      this.prisma.user.findMany({ where: { active: true } as any, select: { id: true, name: true, role: true, avatarUrl: true } as any }),
      this.prisma.customer.findMany({ select: { id: true, name: true, city: true } }),
      targetMonths.length ? this.prisma.salesTarget.findMany({ where: { month: { in: targetMonths } } as any }).catch(() => []) : Promise.resolve([]),
      this.prisma.inventoryBalance.findMany({ include: { product: true } as any } as any).catch(() => []),
      this.prisma.inventoryMovement.findMany({ where: { createdAt: { gte: new Date(Date.now() - 90 * 86400000) } } } as any).catch(() => []),
      this.dailyRevenueSeries(range, prior),
      this.categoryMixForOrders(range),
      this.paymentMixForRange(range),
      this.prisma.dispatchChallan.findMany({ where: { createdAt: { gte: range.from, lte: range.to } } } as any).catch(() => []),
      this.prisma.dispatchJob.findMany({ where: { status: { in: ['pending', 'packed'] } }, include: { customer: true, quote: true } as any } as any).catch(() => []),
    ]);

    const sum = (arr: any[], key: string) => arr.reduce((s, r) => s + Number(r[key] || 0), 0);
    const customerById = new Map(customers.map((c) => [c.id, c]));
    const userById = new Map((reps as any[]).map((u: any) => [u.id, u]));

    // KPI 1: Revenue
    const revenue = sum(ordersCurr, 'totalAmount');
    const revenuePrior = sum(ordersPrior, 'totalAmount');

    // KPI 2: Net cash in
    const receivedCurr = paymentsCurr.filter((p: any) => p.direction !== 'refund').reduce((s, p: any) => s + Number(p.amount || 0), 0);
    const refundedCurr = paymentsCurr.filter((p: any) => p.direction === 'refund').reduce((s, p: any) => s + Number(p.amount || 0), 0);
    const netCash = receivedCurr - refundedCurr;
    const receivedPrior = paymentsPrior.filter((p: any) => p.direction !== 'refund').reduce((s, p: any) => s + Number(p.amount || 0), 0);
    const refundedPrior = paymentsPrior.filter((p: any) => p.direction === 'refund').reduce((s, p: any) => s + Number(p.amount || 0), 0);
    const netCashPrior = receivedPrior - refundedPrior;

    // KPI 3: Open pipeline
    const openPipeline = allLeads
      .filter((l) => !['won', 'lost'].includes(l.stage))
      .reduce((s, l) => s + Number(l.expectedValue || 0), 0);

    // KPI 4: Win rate (within range)
    const wonInRange = leads.filter((l) => l.stage === 'won').length;
    const lostInRange = leads.filter((l) => l.stage === 'lost').length;
    const winRate = (wonInRange + lostInRange) > 0 ? (wonInRange / (wonInRange + lostInRange)) * 100 : 0;
    const wonPrior = prior ? (await this.prisma.lead.count({ where: { stage: 'won', createdAt: { gte: prior.from, lte: prior.to } } })) : 0;
    const lostPrior = prior ? (await this.prisma.lead.count({ where: { stage: 'lost', createdAt: { gte: prior.from, lte: prior.to } } })) : 0;
    const winRatePrior = (wonPrior + lostPrior) > 0 ? (wonPrior / (wonPrior + lostPrior)) * 100 : 0;

    // KPI 5: AOV
    const aov = ordersCurr.length > 0 ? revenue / ordersCurr.length : 0;
    const aovPrior = ordersPrior.length > 0 ? revenuePrior / ordersPrior.length : 0;

    // KPI 6: Stale leads
    const now = Date.now();
    const staleLeads = allLeads.filter((l) => {
      if (['won', 'lost'].includes(l.stage)) return false;
      const age = Math.floor((now - new Date(l.lastContactAt || l.createdAt).getTime()) / 86400000);
      return age >= 7;
    });

    // Sparklines — last 30 days of revenue per day
    const revSpark = this.bucketDailyRevenue(ordersCurr, 30);
    const cashSpark = this.bucketDailyPayments(paymentsCurr.filter((p: any) => p.direction !== 'refund'), 30);

    // Anomaly detection
    const anomalies: any[] = [];
    if (Math.abs(delta(revenue, revenuePrior)) >= 25 && revenuePrior > 0) {
      const dir = revenue > revenuePrior ? 'up' : 'down';
      anomalies.push({
        kind: dir === 'up' ? 'positive' : 'negative',
        title: `Revenue ${dir} ${Math.abs(delta(revenue, revenuePrior)).toFixed(0)}% vs prior period`,
        body: `${this.short(revenue)} this period vs ${this.short(revenuePrior)} prior.`,
        link: { label: 'Open Sales', tab: 'sales' },
      });
    }
    if (winRate >= 60) {
      anomalies.push({
        kind: 'positive',
        title: `Win rate hit ${winRate.toFixed(0)}% — strong period`,
        body: `${wonInRange} won vs ${lostInRange} lost.`,
        link: { label: 'Open Pipeline', tab: 'pipeline' },
      });
    }
    if (staleLeads.length >= 5) {
      anomalies.push({
        kind: 'negative',
        title: `${staleLeads.length} leads stale 7d+`,
        body: 'Reach out to keep deals from going cold.',
        link: { label: 'Open Leads', tab: 'leads' },
      });
    }

    // Funnel
    const funnel = this.buildFunnel(allLeads);

    // Rep leaderboard — orders MTD per owner
    const targetByUser = this.proratedTargetsByUser(salesTargets as any[], range);
    const repPerformance = (reps as any[]).filter((u: any) => ['sales', 'sales_manager'].includes(u.role)).map((u: any) => {
      const repOrders = ordersCurr.filter((o) => o.ownerId === u.id);
      const repOrdersPrior = ordersPrior.filter((o) => o.ownerId === u.id);
      const won = repOrders.reduce((s, o) => s + Number(o.totalAmount || 0), 0);
      const wonP = repOrdersPrior.reduce((s, o) => s + Number(o.totalAmount || 0), 0);
      const target = targetByUser.get(u.id) || 0;
      const repQuotes = quotesCurr.filter((q) => q.ownerId === u.id);
      const repWonQuotes = repQuotes.filter((q) => ['won', 'converted', 'confirmed'].includes(q.status)).length;
      const conv = repQuotes.length > 0 ? (repWonQuotes / repQuotes.length) * 100 : 0;
      return {
        userId: u.id,
        name: u.name,
        avatarUrl: u.avatarUrl,
        revenue: won,
        priorRevenue: wonP,
        delta: delta(won, wonP),
        target,
        conversion: conv,
        orderCount: repOrders.length,
        spark: this.bucketDailyRevenueForOwner(ordersCurr, u.id, 14),
      };
    }).sort((a, b) => b.revenue - a.revenue).slice(0, 10);

    // Top customers — by revenue in range
    const customerRevenue = new Map<string, { id: string; name: string; city?: string; total: number; orderCount: number }>();
    for (const o of ordersCurr) {
      const cur = customerRevenue.get(o.customerId) || { id: o.customerId, name: customerById.get(o.customerId)?.name || 'Customer record unavailable', city: customerById.get(o.customerId)?.city || '', total: 0, orderCount: 0 };
      cur.total += Number(o.totalAmount || 0);
      cur.orderCount += 1;
      customerRevenue.set(o.customerId, cur);
    }
    const topCustomers = Array.from(customerRevenue.values()).sort((a, b) => b.total - a.total).slice(0, 5);

    // Top SKUs — extract from order lines
    const skuMap = new Map<string, { sku: string; name: string; units: number; revenue: number; category?: string }>();
    for (const o of ordersCurr) {
      const lines = Array.isArray(o.lines) ? (o.lines as any[]) : [];
      for (const line of lines) {
        const sku = String(line.sku || line.productId || '');
        if (!sku) continue;
        const qty = Number(line.qty || line.quantity || 0);
        const amount = qty * Number(line.price || line.sellPrice || line.unitPrice || 0);
        const cur = skuMap.get(sku) || { sku, name: line.name || sku, units: 0, revenue: 0, category: line.category };
        cur.units += qty;
        cur.revenue += amount;
        skuMap.set(sku, cur);
      }
    }
    const topSkus = Array.from(skuMap.values()).sort((a, b) => b.units - a.units).slice(0, 5);

    // Dispatch SLA
    const deliveredCurr = (challansCurr as any[]).filter((c) => c.status === 'delivered');
    const onTimeDelivered = deliveredCurr.filter((c) => {
      // proxy: delivered within 7 days of created
      if (!c.deliveredAt || !c.createdAt) return false;
      return (new Date(c.deliveredAt).getTime() - new Date(c.createdAt).getTime()) <= 7 * 86400000;
    });
    const dispatchSla = deliveredCurr.length > 0 ? (onTimeDelivered.length / deliveredCurr.length) * 100 : 0;

    // Receivables ageing
    const ageingPayments = paymentsCurr.concat(await this.prisma.payment.findMany({ where: { paidAt: { lt: range.from } } }).catch(() => []));
    const receivablesAgeing = await this.computeReceivablesAgeing(ageingPayments);

    // Inventory health
    const totalStockValue = (balances as any[]).reduce((s: number, b: any) => s + Number(b.onHand || 0) * Number(b.product?.sellPrice || 0), 0);
    const activeSkuCount = (balances as any[]).filter((b: any) => Number(b.onHand || 0) > 0).length;
    const recentMovementProductIds = new Set((recentMovements as any[]).map((m: any) => m.productId));
    const deadStockCount = (balances as any[]).filter((b: any) => Number(b.onHand || 0) > 0 && !recentMovementProductIds.has(b.productId)).length;
    const lowStockCount = (balances as any[]).filter((b: any) => Number(b.available || b.onHand || 0) <= Number(b.lowStockThreshold || 5) && Number(b.lowStockThreshold || 5) > 0).length;

    return {
      kpis: [
        { id: 'revenue', label: 'Revenue', value: revenue, delta: delta(revenue, revenuePrior), prior: revenuePrior, tone: 'good', spark: revSpark, format: 'money' },
        { id: 'netCash', label: 'Net cash in', value: netCash, delta: delta(netCash, netCashPrior), prior: netCashPrior, tone: 'blue', spark: cashSpark, format: 'money' },
        { id: 'openPipeline', label: 'Open pipeline', value: openPipeline, delta: 0, tone: 'violet', spark: [], format: 'money' },
        { id: 'winRate', label: 'Win rate', value: winRate, delta: winRate - winRatePrior, prior: winRatePrior, tone: 'sky', spark: [], format: 'percent' },
        { id: 'aov', label: 'Avg order value', value: aov, delta: delta(aov, aovPrior), prior: aovPrior, tone: 'amber', spark: [], format: 'money' },
        { id: 'staleLeads', label: 'Stale leads 7d+', value: staleLeads.length, delta: 0, tone: 'bad', spark: [], format: 'count' },
      ],
      anomalies,
      revenueTrend: dailyRevenue,
      funnel,
      categoryMix,
      paymentMix,
      repPerformance,
      topCustomers,
      topSkus,
      dispatchSla: {
        onTimePercent: dispatchSla,
        delivered: deliveredCurr.length,
        onTime: onTimeDelivered.length,
        late: deliveredCurr.length - onTimeDelivered.length,
      },
      receivablesAgeing,
      inventoryHealth: { totalStockValue, activeSkuCount, deadStockCount, lowStockCount },
    };
  }

  // ====================================================================
  // SALES — 4 KPIs + 7 widgets
  // ====================================================================
  private async salesBoard(range: DateRange, prior: DateRange | null, segment: string) {
    const where = this.buildSegmentWhere(range, segment);
    const wherePrior = prior ? this.buildSegmentWhere(prior, segment) : null;

    const [rawOrdersCurr, rawOrdersPrior, quotesCurr, customers] = await Promise.all([
      this.prisma.salesOrder.findMany({ where }),
      wherePrior ? this.prisma.salesOrder.findMany({ where: wherePrior }) : Promise.resolve([]),
      this.prisma.quote.findMany({ where: { createdAt: { gte: range.from, lte: range.to } } }),
      this.prisma.customer.findMany(),
    ]);
    const sum = (arr: any[]) => arr.reduce((s, o) => s + Number(o.totalAmount || 0), 0);
    const customerById = new Map(customers.map((c) => [c.id, c]));
    const ordersCurr = this.applySalesSegment(rawOrdersCurr, customerById, segment);
    const ordersPrior = this.applySalesSegment(rawOrdersPrior, customerById, segment);

    const revenue = sum(ordersCurr);
    const revenuePrior = sum(ordersPrior);
    const aov = ordersCurr.length > 0 ? revenue / ordersCurr.length : 0;
    const aovPrior = ordersPrior.length > 0 ? revenuePrior / ordersPrior.length : 0;
    const quoteToOrder = quotesCurr.length > 0 ? (ordersCurr.length / quotesCurr.length) * 100 : 0;

    // Cash vs credit daily — split orders by payment mode (already on order)
    const days = Math.max(1, Math.ceil((range.to.getTime() - range.from.getTime()) / 86400000));
    const dailyData: Array<{ date: string; cash: number; credit: number; total: number; prior?: number }> = [];
    for (let i = 0; i < days; i++) {
      const day = new Date(range.from.getTime() + i * 86400000);
      const next = new Date(day.getTime() + 86400000);
      const ordersForDay = ordersCurr.filter((o) => new Date(o.createdAt) >= day && new Date(o.createdAt) < next);
      const cash = ordersForDay.filter((o) => o.paymentMode === 'cash').reduce((s, o) => s + Number(o.totalAmount || 0), 0);
      const credit = ordersForDay.filter((o) => o.paymentMode === 'credit').reduce((s, o) => s + Number(o.totalAmount || 0), 0);
      const dayLabel = dateKey(day);
      let priorAmt = 0;
      if (prior) {
        const priorDay = new Date(prior.from.getTime() + i * 86400000);
        const priorNext = new Date(priorDay.getTime() + 86400000);
        priorAmt = ordersPrior.filter((o) => new Date(o.createdAt) >= priorDay && new Date(o.createdAt) < priorNext).reduce((s, o) => s + Number(o.totalAmount || 0), 0);
      }
      dailyData.push({ date: dayLabel, cash, credit, total: cash + credit, prior: priorAmt });
    }

    // Walk-in vs architect — proxy: customer.architectName present
    const archOrders = ordersCurr.filter((o) => {
      const c = customerById.get(o.customerId);
      return !!(c as any)?.architectName;
    });
    const walkOrders = ordersCurr.filter((o) => {
      const c = customerById.get(o.customerId);
      return !(c as any)?.architectName;
    });
    const archRevenue = sum(archOrders);
    const walkRevenue = sum(walkOrders);

    // Revenue by category — last 6 months stacked
    const sixMonthsAgo = new Date(range.to.getTime() - 180 * 86400000);
    const ordersSixRaw = await this.prisma.salesOrder.findMany({ where: this.buildSegmentWhere({ from: sixMonthsAgo, to: range.to }, segment) });
    const ordersSix = this.applySalesSegment(ordersSixRaw, customerById, segment);
    const categoryByMonth: Record<string, Record<string, number>> = {};
    const months: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(range.to.getFullYear(), range.to.getMonth() - i, 1);
      months.push(monthKey(d));
    }
    for (const month of months) categoryByMonth[month] = {};
    for (const o of ordersSix) {
      const month = monthKey(new Date(o.createdAt));
      if (!categoryByMonth[month]) categoryByMonth[month] = {};
      const lines = Array.isArray(o.lines) ? (o.lines as any[]) : [];
      for (const line of lines) {
        const cat = String(line.category || 'Other');
        const amt = Number(line.qty || line.quantity || 0) * Number(line.price || line.sellPrice || 0);
        categoryByMonth[month][cat] = (categoryByMonth[month][cat] || 0) + amt;
      }
    }
    const categoryStack = months.map((month) => ({ month, ...categoryByMonth[month] }));

    // Activity heatmap — orders by hour × day-of-week
    const heatmap: Record<string, Record<string, number>> = {};
    for (let h = 9; h <= 19; h++) heatmap[h] = { Sun: 0, Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0 };
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    for (const o of ordersCurr) {
      const d = new Date(o.createdAt);
      const hour = d.getHours();
      const dayName = dayNames[d.getDay()];
      if (heatmap[hour] && heatmap[hour][dayName] != null) heatmap[hour][dayName] += 1;
    }
    const heatmapData = Object.entries(heatmap).map(([hour, days]) => ({ hour: Number(hour), ...days }));

    // Discount impact scatter — order amount vs discount %
    // Derive discount from quote.discountPercent if order has quoteId; otherwise 0.
    const quoteByLeadCustomer = new Map((quotesCurr as any[]).map((q: any) => [q.id, q]));
    const scatter: Array<{ amount: number; discount: number }> = [];
    for (const o of ordersCurr) {
      const q = quoteByLeadCustomer.get(o.quoteId);
      const disc = q ? Number((q as any).discountPercent || 0) : 0;
      scatter.push({ amount: Number(o.totalAmount || 0), discount: disc });
    }

    // Top 10 SKUs
    const skuMap = new Map<string, { sku: string; name: string; units: number; revenue: number; category?: string }>();
    for (const o of ordersCurr) {
      const lines = Array.isArray(o.lines) ? (o.lines as any[]) : [];
      for (const line of lines) {
        const sku = String(line.sku || line.productId || '');
        if (!sku) continue;
        const qty = Number(line.qty || line.quantity || 0);
        const amount = qty * Number(line.price || line.sellPrice || 0);
        const cur = skuMap.get(sku) || { sku, name: line.name || sku, units: 0, revenue: 0, category: line.category };
        cur.units += qty;
        cur.revenue += amount;
        skuMap.set(sku, cur);
      }
    }
    const topSkus = Array.from(skuMap.values()).sort((a, b) => b.units - a.units).slice(0, 10);

    // Rep performance
    const reps = await this.prisma.user.findMany({ where: { active: true, role: { in: ['sales', 'sales_manager'] } as any } });
    const repPerformance = reps.map((u) => {
      const repOrders = ordersCurr.filter((o) => o.ownerId === u.id);
      const won = sum(repOrders);
      const repQuotes = quotesCurr.filter((q) => q.ownerId === u.id);
      const conv = repQuotes.length > 0 ? (repOrders.length / repQuotes.length) * 100 : 0;
      const aovRep = repOrders.length > 0 ? won / repOrders.length : 0;
      return {
        userId: u.id, name: u.name, revenue: won, orderCount: repOrders.length, aov: aovRep, conversion: conv,
      };
    }).sort((a, b) => b.revenue - a.revenue).slice(0, 6);

    // Cohort retention
    const cohort = await this.buildCohortRetention();

    return {
      kpis: [
        { id: 'revenue', label: 'Revenue', value: revenue, delta: delta(revenue, revenuePrior), prior: revenuePrior, tone: 'good', format: 'money' },
        { id: 'orderCount', label: 'Orders', value: ordersCurr.length, delta: delta(ordersCurr.length, ordersPrior.length), prior: ordersPrior.length, tone: 'blue', format: 'count' },
        { id: 'aov', label: 'Avg order value', value: aov, delta: delta(aov, aovPrior), prior: aovPrior, tone: 'amber', format: 'money' },
        { id: 'quoteToOrder', label: 'Quote → Order rate', value: quoteToOrder, delta: 0, tone: 'violet', format: 'percent' },
      ],
      dailyData,
      sourceMix: {
        architect: { revenue: archRevenue, count: archOrders.length, aov: archOrders.length > 0 ? archRevenue / archOrders.length : 0 },
        walkin: { revenue: walkRevenue, count: walkOrders.length, aov: walkOrders.length > 0 ? walkRevenue / walkOrders.length : 0 },
      },
      categoryStack,
      heatmap: heatmapData,
      scatter,
      topSkus,
      repPerformance,
      cohort,
    };
  }

  // ====================================================================
  // PIPELINE — 5 KPIs + 6 widgets
  // ====================================================================
  private async pipelineBoard(range: DateRange, prior: DateRange | null) {
    const [leads, quotesAll, ordersAll] = await Promise.all([
      this.prisma.lead.findMany({ where: { createdAt: { gte: range.from, lte: range.to } } }),
      this.prisma.quote.findMany({ where: { createdAt: { gte: range.from, lte: range.to } } }),
      this.prisma.salesOrder.findMany({ where: { createdAt: { gte: range.from, lte: range.to } } }),
    ]);
    const allLeads = await this.prisma.lead.findMany();

    const openLeads = allLeads.filter((l) => !['won', 'lost'].includes(l.stage));
    const openPipeline = openLeads.reduce((s, l) => s + Number(l.expectedValue || 0), 0);

    const STAGE_WEIGHTS: Record<string, number> = {
      new: 0.1, contacted: 0.25, qualified: 0.4, proposal: 0.5, quoted: 0.55, negotiation: 0.75,
    };
    const weightedForecast = openLeads.reduce((s, l) => s + Number(l.expectedValue || 0) * (STAGE_WEIGHTS[l.stage] ?? 0), 0);

    const won = leads.filter((l) => l.stage === 'won');
    const lost = leads.filter((l) => l.stage === 'lost');
    const winRate = (won.length + lost.length) > 0 ? (won.length / (won.length + lost.length)) * 100 : 0;

    // Avg cycle time (lead.createdAt → lead.updatedAt when stage='won')
    const wonAll = await this.prisma.lead.findMany({ where: { stage: 'won' } });
    const cycleDays = wonAll.map((l) => Math.floor((new Date(l.updatedAt).getTime() - new Date(l.createdAt).getTime()) / 86400000)).filter((d) => d > 0);
    const avgCycle = cycleDays.length > 0 ? cycleDays.reduce((s, d) => s + d, 0) / cycleDays.length : 0;

    // Funnel by source
    const sources = Array.from(new Set(allLeads.map((l) => l.source || 'Unspecified source')));
    const funnelBySource = sources.map((source) => {
      const sourceLeads = allLeads.filter((l) => (l.source || 'Unspecified source') === source);
      const contacted = sourceLeads.filter((l) => ['contacted', 'qualified', 'proposal', 'quoted', 'negotiation', 'won'].includes(l.stage)).length;
      const quoted = sourceLeads.filter((l) => ['quoted', 'negotiation', 'won'].includes(l.stage)).length;
      const wonCount = sourceLeads.filter((l) => l.stage === 'won').length;
      return {
        source,
        leads: sourceLeads.length,
        contacted,
        quoted,
        won: wonCount,
        conversion: sourceLeads.length > 0 ? (wonCount / sourceLeads.length) * 100 : 0,
        revenue: sourceLeads.filter((l) => l.stage === 'won').reduce((s, l) => s + Number(l.expectedValue || 0), 0),
      };
    }).sort((a, b) => b.leads - a.leads);

    // Funnel overall (for top widget)
    const funnel = this.buildFunnel(allLeads);

    // Cycle time histogram
    const histBuckets = [0, 7, 14, 30, 60, 90, 180];
    const histogram = histBuckets.slice(0, -1).map((min, i) => {
      const max = histBuckets[i + 1];
      return { range: `${min}-${max}d`, count: cycleDays.filter((d) => d >= min && d < max).length };
    });
    histogram.push({ range: '180d+', count: cycleDays.filter((d) => d >= 180).length });

    // Stale ageing
    const now = Date.now();
    const buckets = { '0-3d': 0, '4-7d': 0, '8-14d': 0, '15-30d': 0, '30+': 0 };
    for (const l of openLeads) {
      const age = Math.floor((now - new Date(l.lastContactAt || l.createdAt).getTime()) / 86400000);
      if (age <= 3) buckets['0-3d']++;
      else if (age <= 7) buckets['4-7d']++;
      else if (age <= 14) buckets['8-14d']++;
      else if (age <= 30) buckets['15-30d']++;
      else buckets['30+']++;
    }
    const staleBuckets = Object.entries(buckets).map(([range, count]) => ({ range, count }));

    return {
      kpis: [
        { id: 'openPipeline', label: 'Open pipeline', value: openPipeline, delta: 0, tone: 'violet', format: 'money' },
        { id: 'weightedForecast', label: 'Weighted forecast', value: weightedForecast, delta: 0, tone: 'blue', format: 'money' },
        { id: 'winRate', label: 'Win rate', value: winRate, delta: 0, tone: 'good', format: 'percent' },
        { id: 'avgCycle', label: 'Avg cycle time', value: avgCycle, delta: 0, tone: 'amber', format: 'days' },
        { id: 'conversion', label: 'Lead → Order conv', value: leads.length > 0 ? (ordersAll.length / leads.length) * 100 : 0, delta: 0, tone: 'sky', format: 'percent' },
      ],
      funnel,
      funnelBySource,
      cycleHistogram: histogram,
      staleBuckets,
    };
  }

  // ====================================================================
  // INVENTORY — 5 KPIs + 6 widgets
  // ====================================================================
  private async inventoryBoard(range: DateRange, _prior: DateRange | null) {
    const [balances, products, recentMovements, reservations, reorderPolicies] = await Promise.all([
      this.prisma.inventoryBalance.findMany({ include: { product: true } as any } as any).catch(() => []),
      this.prisma.product.findMany({ where: { status: 'active' } }).catch(() => []),
      this.prisma.inventoryMovement.findMany({ where: { createdAt: { gte: new Date(Date.now() - 90 * 86400000) } } } as any).catch(() => []),
      this.prisma.reservation.findMany({ where: { status: { in: ['reserved', 'backordered'] } } }).catch(() => []),
      this.prisma.reorderPolicy.findMany().catch(() => []),
    ]);

    const productById = new Map((products as any[]).map((p) => [p.id, p]));

    // Stock value by category
    const categoryValue: Record<string, { value: number; units: number; skus: number }> = {};
    let totalValue = 0;
    for (const b of balances as any[]) {
      const p = b.product || productById.get(b.productId);
      if (!p) continue;
      const value = Number(b.onHand || 0) * Number(p.sellPrice || 0);
      const cat = String(p.category || 'Other');
      const cur = categoryValue[cat] || { value: 0, units: 0, skus: 0 };
      cur.value += value;
      cur.units += Number(b.onHand || 0);
      cur.skus += 1;
      categoryValue[cat] = cur;
      totalValue += value;
    }
    const stockByCategory = Object.entries(categoryValue).map(([category, v]) => ({ category, ...v, percent: totalValue > 0 ? (v.value / totalValue) * 100 : 0 })).sort((a, b) => b.value - a.value);

    // ABC analysis — sort SKUs by value descending, cumulative %
    const skuValues = (balances as any[]).map((b: any) => {
      const p = b.product || productById.get(b.productId);
      return { sku: p?.sku || '—', name: p?.name || '—', category: p?.category, value: Number(b.onHand || 0) * Number(p?.sellPrice || 0), onHand: Number(b.onHand || 0) };
    }).filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
    let cumValue = 0;
    const abc = skuValues.map((sku) => {
      cumValue += sku.value;
      const pct = totalValue > 0 ? (cumValue / totalValue) * 100 : 0;
      const cls = pct <= 80 ? 'A' : pct <= 95 ? 'B' : 'C';
      return { ...sku, cumulativePercent: pct, abcClass: cls };
    });
    const abcSummary = {
      A: abc.filter((s) => s.abcClass === 'A').length,
      B: abc.filter((s) => s.abcClass === 'B').length,
      C: abc.filter((s) => s.abcClass === 'C').length,
      totalSkus: abc.length,
    };

    // Dead stock — onHand > 0 + no movement in 90d
    const recentMovedProductIds = new Set((recentMovements as any[]).map((m: any) => m.productId));
    const deadStock = (balances as any[]).filter((b: any) => Number(b.onHand || 0) > 0 && !recentMovedProductIds.has(b.productId)).map((b: any) => {
      const p = b.product || productById.get(b.productId);
      return { sku: p?.sku, name: p?.name, category: p?.category, onHand: Number(b.onHand), value: Number(b.onHand || 0) * Number(p?.sellPrice || 0), daysSinceMovement: 90 };
    }).sort((a, b) => b.value - a.value).slice(0, 30);

    // Fast vs slow movers — by movement count in last 90d
    const moveCountBySku = new Map<string, number>();
    for (const m of recentMovements as any[]) {
      moveCountBySku.set(m.productId, (moveCountBySku.get(m.productId) || 0) + 1);
    }
    const movers = Array.from(moveCountBySku.entries()).map(([pid, count]) => {
      const p = productById.get(pid);
      return { sku: p?.sku, name: p?.name, category: p?.category, moveCount: count };
    }).filter((m) => m.sku);
    const fastMovers = [...movers].sort((a, b) => b.moveCount - a.moveCount).slice(0, 10);
    const slowMovers = [...movers].sort((a, b) => a.moveCount - b.moveCount).slice(0, 10);

    // Turnover ratio (cost-of-goods-sold over avg inventory)
    const turnoverRatio = totalValue > 0 ? skuValues.reduce((s, sku) => s + (moveCountBySku.get((balances as any[]).find((b: any) => productById.get(b.productId)?.sku === sku.sku)?.productId) || 0), 0) / skuValues.length : 0;

    // Reorder alerts — onHand <= reorderPoint OR <= lowStockThreshold
    const reorderAlerts = (balances as any[]).filter((b: any) => {
      const policy = (reorderPolicies as any[]).find((rp: any) => rp.productId === b.productId);
      const threshold = policy?.reorderPoint || b.lowStockThreshold || 5;
      return threshold > 0 && Number(b.available || b.onHand || 0) <= threshold;
    }).map((b: any) => {
      const p = b.product || productById.get(b.productId);
      return { sku: p?.sku, name: p?.name, category: p?.category, onHand: Number(b.onHand), available: Number(b.available || b.onHand || 0), threshold: b.lowStockThreshold || 5 };
    }).slice(0, 20);

    // Reservation rate
    const totalReserved = (reservations as any[]).reduce((s, r: any) => s + Number(r.quantity || 0), 0);
    const totalOnHand = (balances as any[]).reduce((s, b: any) => s + Number(b.onHand || 0), 0);
    const reservationRate = totalOnHand > 0 ? (totalReserved / totalOnHand) * 100 : 0;

    // Stock outs — products with onHand = 0 and reservations
    const stockOuts = (balances as any[]).filter((b: any) => Number(b.onHand || 0) === 0 && (reservations as any[]).some((r: any) => r.productId === b.productId)).length;

    return {
      kpis: [
        { id: 'stockValue', label: 'Stock value', value: totalValue, delta: 0, tone: 'blue', format: 'money' },
        { id: 'activeSkus', label: 'Active SKUs', value: abc.length, delta: 0, tone: 'good', format: 'count' },
        { id: 'deadStock', label: 'Dead SKUs 90d', value: deadStock.length, delta: 0, tone: 'bad', format: 'count' },
        { id: 'reservationRate', label: 'Reservation %', value: reservationRate, delta: 0, tone: 'violet', format: 'percent' },
        { id: 'stockOuts', label: 'Stock-outs', value: stockOuts, delta: 0, tone: 'amber', format: 'count' },
      ],
      stockByCategory,
      abc,
      abcSummary,
      deadStock,
      fastMovers,
      slowMovers,
      turnoverRatio,
      reorderAlerts,
    };
  }

  // ====================================================================
  // PROCUREMENT — 5 KPIs + 5 widgets
  // ====================================================================
  private async procurementBoard(range: DateRange, _prior: DateRange | null) {
    const [pos, vendors, grns, products] = await Promise.all([
      this.prisma.purchaseOrder.findMany({}).catch(() => []),
      this.prisma.vendor.findMany().catch(() => []),
      this.prisma.inventoryInwardBatch.findMany({ where: { createdAt: { gte: new Date(Date.now() - 180 * 86400000) } } } as any).catch(() => []),
      this.prisma.product.findMany().catch(() => []),
    ]);
    const productById = new Map((products as any[]).map((p) => [p.id, p]));
    const vendorById = new Map((vendors as any[]).map((v) => [v.id, v]));

    const openStatuses = ['draft', 'open', 'sent', 'partial'];
    const openPos = (pos as any[]).filter((p: any) => openStatuses.includes(p.status));
    const openValue = openPos.reduce((s, p: any) => s + Number(p.totalAmount || 0), 0);

    // PO fulfillment % — closed POs delivered on or before expectedDate
    const closedPos = (pos as any[]).filter((p: any) => p.status === 'received' || p.status === 'closed');
    const onTimePos = closedPos.filter((p: any) => {
      if (!p.expectedDate || !p.receivedDate) return true;
      return new Date(p.receivedDate).getTime() <= new Date(p.expectedDate).getTime();
    });
    const fulfillmentPercent = closedPos.length > 0 ? (onTimePos.length / closedPos.length) * 100 : 0;

    // Avg lead time = receivedDate - orderDate
    const leadTimes = closedPos.map((p: any) => {
      if (!p.receivedDate || !p.orderDate) return null;
      return Math.floor((new Date(p.receivedDate).getTime() - new Date(p.orderDate).getTime()) / 86400000);
    }).filter((n): n is number => typeof n === 'number');
    const avgLeadTime = leadTimes.length > 0 ? leadTimes.reduce((s, d) => s + d, 0) / leadTimes.length : 0;

    // Damaged % — from GRN lines if available
    let totalReceived = 0, totalDamaged = 0;
    for (const grn of grns as any[]) {
      const lines = Array.isArray(grn.lines) ? grn.lines : [];
      for (const l of lines) {
        totalReceived += Number(l.receivedQuantity || l.receivedQty || l.quantity || 0);
        totalDamaged += Number(l.damagedQuantity || l.damagedQty || 0);
      }
    }
    const damagedPercent = totalReceived > 0 ? (totalDamaged / totalReceived) * 100 : 0;

    // Vendor concentration (top 3 vendor share of total PO value)
    const totalPoValue = (pos as any[]).reduce((s, p: any) => s + Number(p.totalAmount || 0), 0);
    const spendByVendor = new Map<string, number>();
    for (const p of pos as any[]) {
      if (!p.vendorId) continue;
      spendByVendor.set(p.vendorId, (spendByVendor.get(p.vendorId) || 0) + Number(p.totalAmount || 0));
    }
    const spendArr = Array.from(spendByVendor.entries()).map(([vid, v]) => ({ vendorId: vid, name: vendorById.get(vid)?.name || 'Vendor record unavailable', spend: v })).sort((a, b) => b.spend - a.spend);
    const top3Spend = spendArr.slice(0, 3).reduce((s, v) => s + v.spend, 0);
    const concentration = totalPoValue > 0 ? (top3Spend / totalPoValue) * 100 : 0;

    // Vendor scorecard
    const vendorScorecards = (vendors as any[]).map((v: any) => {
      const vendorPos = (pos as any[]).filter((p: any) => p.vendorId === v.id);
      const vendorClosed = vendorPos.filter((p: any) => p.status === 'received' || p.status === 'closed');
      const vendorOnTime = vendorClosed.filter((p: any) => !p.expectedDate || !p.receivedDate || new Date(p.receivedDate).getTime() <= new Date(p.expectedDate).getTime());
      const ot = vendorClosed.length > 0 ? (vendorOnTime.length / vendorClosed.length) * 100 : 0;
      const totalLT = vendorClosed.map((p: any) => {
        if (!p.receivedDate || !p.orderDate) return null;
        return Math.floor((new Date(p.receivedDate).getTime() - new Date(p.orderDate).getTime()) / 86400000);
      }).filter((n): n is number => typeof n === 'number');
      const avgLT = totalLT.length > 0 ? totalLT.reduce((s, d) => s + d, 0) / totalLT.length : 0;
      const spend = vendorPos.reduce((s, p: any) => s + Number(p.totalAmount || 0), 0);
      const open = vendorPos.filter((p: any) => openStatuses.includes(p.status)).length;
      return { vendorId: v.id, name: v.name, category: v.category, onTimePercent: ot, avgLeadTime: avgLT, spend, openCount: open, totalPos: vendorPos.length };
    }).filter((v) => v.totalPos > 0 || v.openCount > 0).sort((a, b) => b.spend - a.spend);

    // PO ageing — open POs grouped by expectedDate age
    const now = Date.now();
    const poAgeing = { overdue: 0, due_week: 0, future: 0, no_date: 0 };
    const poAgeingValue = { overdue: 0, due_week: 0, future: 0, no_date: 0 };
    for (const p of openPos) {
      if (!p.expectedDate) {
        poAgeing.no_date++; poAgeingValue.no_date += Number(p.totalAmount || 0);
        continue;
      }
      const daysOut = Math.floor((new Date(p.expectedDate).getTime() - now) / 86400000);
      if (daysOut < 0) { poAgeing.overdue++; poAgeingValue.overdue += Number(p.totalAmount || 0); }
      else if (daysOut <= 7) { poAgeing.due_week++; poAgeingValue.due_week += Number(p.totalAmount || 0); }
      else { poAgeing.future++; poAgeingValue.future += Number(p.totalAmount || 0); }
    }

    return {
      kpis: [
        { id: 'openPos', label: 'Open POs', value: openPos.length, delta: 0, tone: 'blue', format: 'count' },
        { id: 'openValue', label: 'Open PO value', value: openValue, delta: 0, tone: 'violet', format: 'money' },
        { id: 'fulfillment', label: 'On-time delivery', value: fulfillmentPercent, delta: 0, tone: 'good', format: 'percent' },
        { id: 'avgLeadTime', label: 'Avg lead time', value: avgLeadTime, delta: 0, tone: 'amber', format: 'days' },
        { id: 'concentration', label: 'Top-3 vendor share', value: concentration, delta: 0, tone: 'sky', format: 'percent' },
      ],
      vendorScorecards: vendorScorecards.slice(0, 20),
      poAgeing,
      poAgeingValue,
      spendByVendor: spendArr.slice(0, 10),
      damagedPercent,
      totalReceived,
      totalDamaged,
    };
  }

  // ====================================================================
  // MONEY — 5 KPIs + 6 widgets
  // ====================================================================
  private async moneyBoard(range: DateRange, _prior: DateRange | null) {
    const [orders, paymentsAll, customers] = await Promise.all([
      this.prisma.salesOrder.findMany({}),
      this.prisma.payment.findMany({}).catch(() => []),
      this.prisma.customer.findMany({ select: { id: true, name: true, city: true, mobile: true } }),
    ]);
    const customerById = new Map(customers.map((c) => [c.id, c]));

    // Outstanding per order
    const orderIds = orders.map((o) => o.id);
    const paidByOrder = new Map<string, number>();
    for (const p of paymentsAll as any[]) {
      if (!p.salesOrderId) continue;
      const sign = p.direction === 'refund' ? -1 : 1;
      paidByOrder.set(p.salesOrderId, (paidByOrder.get(p.salesOrderId) || 0) + sign * Number(p.amount || 0));
    }
    const outstanding = orders.map((o) => {
      const received = paidByOrder.get(o.id) || 0;
      const balance = Math.max(0, Number(o.totalAmount || 0) - received);
      const ageDays = Math.floor((Date.now() - new Date(o.createdAt).getTime()) / 86400000);
      return { ...o, balance, received, ageDays, customer: customerById.get(o.customerId) };
    }).filter((o) => o.balance > 0);
    const totalOutstanding = outstanding.reduce((s, o) => s + o.balance, 0);

    // DSO = (outstanding / revenue last 90d) * 90
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000);
    const revenue90 = orders.filter((o) => new Date(o.createdAt) >= ninetyDaysAgo).reduce((s, o) => s + Number(o.totalAmount || 0), 0);
    const dso = revenue90 > 0 ? (totalOutstanding / revenue90) * 90 : 0;

    // Ageing buckets
    const buckets = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
    const bucketsCount = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
    for (const o of outstanding) {
      if (o.ageDays <= 30) { buckets['0-30'] += o.balance; bucketsCount['0-30']++; }
      else if (o.ageDays <= 60) { buckets['31-60'] += o.balance; bucketsCount['31-60']++; }
      else if (o.ageDays <= 90) { buckets['61-90'] += o.balance; bucketsCount['61-90']++; }
      else { buckets['90+'] += o.balance; bucketsCount['90+']++; }
    }

    // Top 20 outstanding
    const top20 = [...outstanding].sort((a, b) => b.balance - a.balance).slice(0, 20).map((o) => ({
      id: o.id, orderNumber: o.orderNumber, customerName: o.customer?.name || 'Customer record unavailable', customerMobile: (o.customer as any)?.mobile,
      total: Number(o.totalAmount || 0), received: o.received, balance: o.balance, ageDays: o.ageDays,
    }));

    // Payment mode mix (range)
    const inRangePayments = (paymentsAll as any[]).filter((p) => new Date(p.paidAt) >= range.from && new Date(p.paidAt) <= range.to);
    const modeMix: Record<string, number> = {};
    for (const p of inRangePayments) {
      if (p.direction === 'refund') continue;
      const mode = String(p.mode || 'other');
      modeMix[mode] = (modeMix[mode] || 0) + Number(p.amount || 0);
    }
    const paymentModeMix = Object.entries(modeMix).map(([mode, amount]) => ({ mode, amount }));

    // Weekly cash flow trend
    const weeks: Array<{ week: string; received: number; refunded: number; net: number }> = [];
    const totalWeeks = Math.max(1, Math.ceil((range.to.getTime() - range.from.getTime()) / (7 * 86400000)));
    for (let i = 0; i < totalWeeks; i++) {
      const wStart = new Date(range.from.getTime() + i * 7 * 86400000);
      const wEnd = new Date(Math.min(range.to.getTime(), wStart.getTime() + 7 * 86400000));
      const wPayments = (paymentsAll as any[]).filter((p) => new Date(p.paidAt) >= wStart && new Date(p.paidAt) < wEnd);
      const received = wPayments.filter((p) => p.direction !== 'refund').reduce((s, p) => s + Number(p.amount || 0), 0);
      const refunded = wPayments.filter((p) => p.direction === 'refund').reduce((s, p) => s + Number(p.amount || 0), 0);
      weeks.push({ week: dateKey(wStart), received, refunded, net: received - refunded });
    }

    // Refund stats
    const refundsInRange = inRangePayments.filter((p) => p.direction === 'refund');
    const refundCount = refundsInRange.length;
    const totalRefundAmount = refundsInRange.reduce((s, p) => s + Number(p.amount || 0), 0);
    const refundRate = inRangePayments.length > 0 ? (refundCount / inRangePayments.length) * 100 : 0;

    // Time-to-first-payment cohort (avg days from order create → first payment per order)
    const firstPayByOrder = new Map<string, Date>();
    for (const p of paymentsAll as any[]) {
      if (!p.salesOrderId || p.direction === 'refund') continue;
      const cur = firstPayByOrder.get(p.salesOrderId);
      const d = new Date(p.paidAt);
      if (!cur || d < cur) firstPayByOrder.set(p.salesOrderId, d);
    }
    const ttfpDays: number[] = [];
    for (const o of orders) {
      const fp = firstPayByOrder.get(o.id);
      if (!fp) continue;
      ttfpDays.push(Math.max(0, Math.floor((fp.getTime() - new Date(o.createdAt).getTime()) / 86400000)));
    }
    const avgTimeToPay = ttfpDays.length > 0 ? ttfpDays.reduce((s, d) => s + d, 0) / ttfpDays.length : 0;

    // Concentration risk top-5 debtors share
    const top5Share = top20.slice(0, 5).reduce((s, o) => s + o.balance, 0);
    const concentration = totalOutstanding > 0 ? (top5Share / totalOutstanding) * 100 : 0;

    return {
      kpis: [
        { id: 'outstanding', label: 'Outstanding', value: totalOutstanding, delta: 0, tone: 'bad', format: 'money' },
        { id: 'dso', label: 'DSO', value: dso, delta: 0, tone: 'amber', format: 'days' },
        { id: 'refundRate', label: 'Refund rate', value: refundRate, delta: 0, tone: 'sky', format: 'percent' },
        { id: 'avgTimeToPay', label: 'Avg time to pay', value: avgTimeToPay, delta: 0, tone: 'violet', format: 'days' },
        { id: 'concentration', label: 'Top-5 debtor share', value: concentration, delta: 0, tone: 'blue', format: 'percent' },
      ],
      ageingBuckets: Object.entries(buckets).map(([range, amount]) => ({ range, amount, count: (bucketsCount as any)[range] })),
      top20Outstanding: top20,
      paymentModeMix,
      weeklyCashFlow: weeks,
      refundStats: { count: refundCount, total: totalRefundAmount, rate: refundRate },
    };
  }

  // ====================================================================
  // Helpers
  // ====================================================================
  private async dailyRevenueSeries(range: DateRange, prior: DateRange | null) {
    const orders = await this.prisma.salesOrder.findMany({ where: { createdAt: { gte: range.from, lte: range.to } } });
    const ordersPrior = prior ? await this.prisma.salesOrder.findMany({ where: { createdAt: { gte: prior.from, lte: prior.to } } }) : [];
    const days = Math.max(1, Math.ceil((range.to.getTime() - range.from.getTime()) / 86400000));
    const series: Array<{ date: string; current: number; prior: number }> = [];
    for (let i = 0; i < days; i++) {
      const day = new Date(range.from.getTime() + i * 86400000);
      const next = new Date(day.getTime() + 86400000);
      const current = orders.filter((o) => new Date(o.createdAt) >= day && new Date(o.createdAt) < next).reduce((s, o) => s + Number(o.totalAmount || 0), 0);
      let priorVal = 0;
      if (prior) {
        const pDay = new Date(prior.from.getTime() + i * 86400000);
        const pNext = new Date(pDay.getTime() + 86400000);
        priorVal = ordersPrior.filter((o) => new Date(o.createdAt) >= pDay && new Date(o.createdAt) < pNext).reduce((s, o) => s + Number(o.totalAmount || 0), 0);
      }
      series.push({ date: dateKey(day), current, prior: priorVal });
    }
    return series;
  }

  private bucketDailyRevenue(orders: any[], days: number) {
    const series: number[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const start = new Date(); start.setDate(start.getDate() - i); start.setHours(0, 0, 0, 0);
      const end = new Date(start.getTime() + 86400000);
      const value = orders.filter((o) => new Date(o.createdAt) >= start && new Date(o.createdAt) < end).reduce((s, o) => s + Number(o.totalAmount || 0), 0);
      series.push(value);
    }
    return series;
  }
  private bucketDailyPayments(payments: any[], days: number) {
    const series: number[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const start = new Date(); start.setDate(start.getDate() - i); start.setHours(0, 0, 0, 0);
      const end = new Date(start.getTime() + 86400000);
      const value = payments.filter((p) => new Date(p.paidAt) >= start && new Date(p.paidAt) < end).reduce((s, p) => s + Number(p.amount || 0), 0);
      series.push(value);
    }
    return series;
  }
  private bucketDailyRevenueForOwner(orders: any[], ownerId: string, days: number) {
    const series: number[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const start = new Date(); start.setDate(start.getDate() - i); start.setHours(0, 0, 0, 0);
      const end = new Date(start.getTime() + 86400000);
      const value = orders.filter((o) => o.ownerId === ownerId && new Date(o.createdAt) >= start && new Date(o.createdAt) < end).reduce((s, o) => s + Number(o.totalAmount || 0), 0);
      series.push(value);
    }
    return series;
  }

  private async categoryMixForOrders(range: DateRange) {
    const orders = await this.prisma.salesOrder.findMany({ where: { createdAt: { gte: range.from, lte: range.to } } });
    const mix: Record<string, number> = {};
    let total = 0;
    for (const o of orders) {
      const lines = Array.isArray(o.lines) ? (o.lines as any[]) : [];
      for (const line of lines) {
        const cat = String(line.category || 'Other');
        const amt = Number(line.qty || line.quantity || 0) * Number(line.price || line.sellPrice || 0);
        mix[cat] = (mix[cat] || 0) + amt;
        total += amt;
      }
    }
    return Object.entries(mix).map(([category, amount]) => ({ category, amount, percent: total > 0 ? (amount / total) * 100 : 0 })).sort((a, b) => b.amount - a.amount);
  }

  private async paymentMixForRange(range: DateRange) {
    const payments = await this.prisma.payment.findMany({ where: { paidAt: { gte: range.from, lte: range.to }, direction: { not: 'refund' } } }).catch(() => []);
    const mix: Record<string, number> = {};
    let total = 0;
    for (const p of payments as any[]) {
      const mode = String(p.mode || 'other');
      mix[mode] = (mix[mode] || 0) + Number(p.amount || 0);
      total += Number(p.amount || 0);
    }
    return Object.entries(mix).map(([mode, amount]) => ({ mode, amount, percent: total > 0 ? (amount / total) * 100 : 0 })).sort((a, b) => b.amount - a.amount);
  }

  private buildFunnel(leads: any[]) {
    const totalLeads = leads.length;
    const contacted = leads.filter((l) => !['new'].includes(l.stage)).length;
    const quoted = leads.filter((l) => ['quoted', 'negotiation', 'won'].includes(l.stage)).length;
    const negotiation = leads.filter((l) => ['negotiation', 'won'].includes(l.stage)).length;
    const won = leads.filter((l) => l.stage === 'won').length;
    return [
      { stage: 'Leads', count: totalLeads, percent: 100 },
      { stage: 'Contacted', count: contacted, percent: totalLeads > 0 ? (contacted / totalLeads) * 100 : 0 },
      { stage: 'Quoted', count: quoted, percent: totalLeads > 0 ? (quoted / totalLeads) * 100 : 0 },
      { stage: 'Negotiation', count: negotiation, percent: totalLeads > 0 ? (negotiation / totalLeads) * 100 : 0 },
      { stage: 'Won', count: won, percent: totalLeads > 0 ? (won / totalLeads) * 100 : 0 },
    ];
  }

  private async computeReceivablesAgeing(_allPayments: any[]) {
    const orders = await this.prisma.salesOrder.findMany({});
    const payments = await this.prisma.payment.findMany({}).catch(() => []);
    const paidByOrder = new Map<string, number>();
    for (const p of payments as any[]) {
      if (!p.salesOrderId) continue;
      const sign = p.direction === 'refund' ? -1 : 1;
      paidByOrder.set(p.salesOrderId, (paidByOrder.get(p.salesOrderId) || 0) + sign * Number(p.amount || 0));
    }
    const buckets = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
    for (const o of orders) {
      const received = paidByOrder.get(o.id) || 0;
      const balance = Math.max(0, Number(o.totalAmount || 0) - received);
      if (balance <= 0) continue;
      const age = Math.floor((Date.now() - new Date(o.createdAt).getTime()) / 86400000);
      if (age <= 30) buckets['0-30'] += balance;
      else if (age <= 60) buckets['31-60'] += balance;
      else if (age <= 90) buckets['61-90'] += balance;
      else buckets['90+'] += balance;
    }
    const total = Object.values(buckets).reduce((s, v) => s + v, 0);
    return Object.entries(buckets).map(([range, amount]) => ({ range, amount, percent: total > 0 ? (amount / total) * 100 : 0 }));
  }

  private async buildCohortRetention() {
    const orders = await this.prisma.salesOrder.findMany({ select: { customerId: true, createdAt: true } });
    // Group customers by first-order month
    const firstOrder = new Map<string, Date>();
    for (const o of orders) {
      const cur = firstOrder.get(o.customerId);
      if (!cur || new Date(o.createdAt) < cur) firstOrder.set(o.customerId, new Date(o.createdAt));
    }
    const customerMonths = new Map<string, Set<number>>();
    for (const o of orders) {
      const first = firstOrder.get(o.customerId)!;
      const diff = (new Date(o.createdAt).getFullYear() - first.getFullYear()) * 12 + (new Date(o.createdAt).getMonth() - first.getMonth());
      const set = customerMonths.get(o.customerId) || new Set();
      set.add(diff);
      customerMonths.set(o.customerId, set);
    }
    const cohorts = new Map<string, string[]>(); // monthKey -> customer ids
    for (const [cid, first] of firstOrder) {
      const key = `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}`;
      const arr = cohorts.get(key) || [];
      arr.push(cid);
      cohorts.set(key, arr);
    }
    const result: Array<{ cohort: string; customers: number; retention: number[] }> = [];
    const today = new Date();
    const cutoffMonths = 6;
    for (const [cohort, cids] of cohorts) {
      const [y, m] = cohort.split('-').map(Number);
      const monthsAgo = (today.getFullYear() - y) * 12 + (today.getMonth() - (m - 1));
      if (monthsAgo > 12) continue; // only show last 12 months of cohorts
      const retention: number[] = [];
      for (let mPlus = 0; mPlus <= Math.min(cutoffMonths, monthsAgo); mPlus++) {
        const returned = cids.filter((cid) => customerMonths.get(cid)?.has(mPlus)).length;
        const pct = cids.length > 0 ? (returned / cids.length) * 100 : 0;
        retention.push(pct);
      }
      result.push({ cohort, customers: cids.length, retention });
    }
    return result.sort((a, b) => b.cohort.localeCompare(a.cohort)).slice(0, 6).reverse();
  }

  private buildSegmentWhere(range: DateRange, segment: string): any {
    const base: any = { createdAt: { gte: range.from, lte: range.to } };
    if (segment === 'cash') base.paymentMode = 'cash';
    if (segment === 'credit') base.paymentMode = 'credit';
    return base;
  }

  private applySalesSegment(orders: any[], customerById: Map<string, any>, segment: string): any[] {
    if (!['walkin', 'architect', 'b2b', 'b2c'].includes(segment)) return orders;
    return orders.filter((order) => {
      const customer = customerById.get(order.customerId);
      const hasArchitect = !!String(customer?.architectName || '').trim();
      const hasGst = !!String(customer?.gstNo || '').trim();
      if (segment === 'architect') return hasArchitect;
      if (segment === 'walkin') return !hasArchitect;
      if (segment === 'b2b') return hasGst;
      if (segment === 'b2c') return !hasGst;
      return true;
    });
  }

  private monthKeysBetween(from: Date, to: Date): string[] {
    const months: string[] = [];
    const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
    const end = new Date(to.getFullYear(), to.getMonth(), 1);
    while (cursor <= end) {
      months.push(monthKey(cursor));
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return months;
  }

  private proratedTargetsByUser(targets: any[], range: DateRange): Map<string, number> {
    const result = new Map<string, number>();
    for (const target of targets) {
      const [year, month] = String(target.month || '').split('-').map(Number);
      if (!year || !month) continue;
      const monthStart = new Date(year, month - 1, 1);
      const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);
      const overlapStart = Math.max(range.from.getTime(), monthStart.getTime());
      const overlapEnd = Math.min(range.to.getTime(), monthEnd.getTime());
      if (overlapEnd < overlapStart) continue;
      const monthDays = monthEnd.getDate();
      const overlapDays = Math.max(1, Math.ceil((overlapEnd - overlapStart + 1) / 86400000));
      const proratedAmount = Number(target.amount || 0) * Math.min(1, overlapDays / monthDays);
      result.set(target.userId, (result.get(target.userId) || 0) + proratedAmount);
    }
    return result;
  }

  private short(n: number) {
    const v = Number(n || 0);
    if (v >= 10000000) return `₹${(v / 10000000).toFixed(2)}Cr`;
    if (v >= 100000) return `₹${(v / 100000).toFixed(2)}L`;
    if (v >= 1000) return `₹${(v / 1000).toFixed(1)}k`;
    return `₹${v.toLocaleString('en-IN')}`;
  }

  // ====================================================================
  // Legacy single-purpose helpers — preserved for the existing CSV export.
  // ====================================================================
  async monthlySalesByCategory(range?: { from?: Date; to?: Date }) {
    const r = this.normaliseRange(range);
    const orders = await this.prisma.salesOrder.findMany({ where: { createdAt: { gte: r.from, lte: r.to } }, select: { totalAmount: true, lines: true, createdAt: true } });
    const buckets = new Map<string, { month: string; category: string; total: number; orderCount: number }>();
    for (const order of orders) {
      const month = monthKey(order.createdAt);
      const lines = Array.isArray(order.lines) ? (order.lines as any[]) : [];
      const seen = new Set<string>();
      for (const line of lines) {
        const cat = String(line.category || 'uncategorised');
        const key = `${month}::${cat}`;
        const amount = Number(line.totalAmount || line.amount || (Number(line.qty || line.quantity || 0) * Number(line.unitPrice || line.price || 0)));
        const existing = buckets.get(key) || { month, category: cat, total: 0, orderCount: 0 };
        existing.total += amount;
        if (!seen.has(cat)) { existing.orderCount += 1; seen.add(cat); }
        buckets.set(key, existing);
      }
    }
    return Array.from(buckets.values()).sort((a, b) => (b.month + b.category).localeCompare(a.month + a.category));
  }
  async topCustomers(range?: { from?: Date; to?: Date }, limit = 25) {
    const r = this.normaliseRange(range);
    const orders = await this.prisma.salesOrder.findMany({ where: { createdAt: { gte: r.from, lte: r.to } }, select: { customerId: true, totalAmount: true } });
    const sumByCustomer = new Map<string, { customerId: string; total: number; orderCount: number }>();
    for (const o of orders) {
      const e = sumByCustomer.get(o.customerId) || { customerId: o.customerId, total: 0, orderCount: 0 };
      e.total += Number(o.totalAmount || 0); e.orderCount += 1;
      sumByCustomer.set(o.customerId, e);
    }
    const sorted = Array.from(sumByCustomer.values()).sort((a, b) => b.total - a.total).slice(0, limit);
    const customers = await this.prisma.customer.findMany({ where: { id: { in: sorted.map((s) => s.customerId) } } });
    const cmap = new Map(customers.map((c) => [c.id, c]));
    return sorted.map((s) => ({ customerId: s.customerId, name: cmap.get(s.customerId)?.name || 'Customer record unavailable', city: cmap.get(s.customerId)?.city || '', gstNo: cmap.get(s.customerId)?.gstNo || '', totalSpent: s.total, orderCount: s.orderCount }));
  }
  async deadStock(days = 90) {
    const since = new Date(Date.now() - days * 86400000);
    const products = await this.prisma.product.findMany({ where: { status: 'active' }, select: { id: true, sku: true, name: true, category: true, brand: true, balances: true }, take: 5000 } as any) as any[];
    const recentMovements = await this.prisma.inventoryMovement.findMany({ where: { createdAt: { gte: since } }, select: { productId: true } });
    const recentIds = new Set(recentMovements.map((m) => m.productId));
    const out: any[] = [];
    for (const p of products) {
      if (recentIds.has(p.id)) continue;
      const onHand = Number(p.balances?.onHand || 0);
      if (onHand <= 0) continue;
      out.push({ productId: p.id, sku: p.sku, name: p.name, category: p.category, brand: p.brand, onHand, daysSinceMovement: days });
    }
    return out.sort((a, b) => b.onHand - a.onHand).slice(0, 500);
  }
  async conversionFunnel(range?: { from?: Date; to?: Date }) {
    const r = this.normaliseRange(range);
    const [leads, quotes, orders] = await Promise.all([
      this.prisma.lead.findMany({ where: { createdAt: { gte: r.from, lte: r.to } }, select: { ownerId: true, stage: true } }),
      this.prisma.quote.findMany({ where: { createdAt: { gte: r.from, lte: r.to } }, select: { ownerId: true, status: true } }),
      this.prisma.salesOrder.findMany({ where: { createdAt: { gte: r.from, lte: r.to } }, select: { ownerId: true, totalAmount: true } }),
    ]);
    const users = await this.prisma.user.findMany({ select: { id: true, name: true, role: true } });
    const umap = new Map(users.map((u) => [u.id, u]));
    const buckets = new Map<string, any>();
    const seed = (id: string) => {
      if (!buckets.has(id)) { const u = umap.get(id); buckets.set(id, { userId: id, name: u?.name || 'Unassigned owner', role: u?.role || '', leads: 0, quotes: 0, ordersWon: 0, revenue: 0 }); }
      return buckets.get(id);
    };
    for (const l of leads) seed(l.ownerId).leads += 1;
    for (const q of quotes) seed(q.ownerId).quotes += 1;
    for (const o of orders) { const b = seed(o.ownerId); b.ordersWon += 1; b.revenue += Number(o.totalAmount || 0); }
    return Array.from(buckets.values()).sort((a, b) => b.revenue - a.revenue);
  }
  async pendingDispatchAgeing() {
    const jobs = await this.prisma.dispatchJob.findMany({ where: { status: { in: ['pending', 'packed'] } }, include: { customer: true, quote: true } as any } as any);
    return (jobs as any[]).map((j) => {
      const ageDays = Math.floor((Date.now() - j.createdAt.getTime()) / 86400000);
      let bucket: string;
      if (ageDays <= 3) bucket = '0-3'; else if (ageDays <= 7) bucket = '4-7'; else if (ageDays <= 14) bucket = '8-14'; else if (ageDays <= 30) bucket = '15-30'; else bucket = '30+';
      return { dispatchJobId: j.id, customer: j.customer?.name || 'Customer record unavailable', status: j.status, ageDays, ageBucket: bucket, dueDate: j.dueDate, quoteNumber: j.quote?.quoteNumber || '' };
    }).sort((a, b) => b.ageDays - a.ageDays);
  }
  async receivablesAgeing() {
    const orders = await this.prisma.salesOrder.findMany({ where: { paymentStatus: { in: ['unpaid', 'partial'] } }, select: { id: true, orderNumber: true, customerId: true, totalAmount: true, createdAt: true, paymentStatus: true } });
    const orderIds = orders.map((o) => o.id);
    const payments = await this.prisma.payment.findMany({ where: { salesOrderId: { in: orderIds } } }).catch(() => []);
    const customers = await this.prisma.customer.findMany({ where: { id: { in: orders.map((o) => o.customerId) } } });
    const cmap = new Map(customers.map((c) => [c.id, c]));
    const receivedByOrder = new Map<string, number>();
    for (const p of payments as any[]) {
      const sign = p.direction === 'refund' ? -1 : 1;
      receivedByOrder.set(p.salesOrderId, (receivedByOrder.get(p.salesOrderId) || 0) + sign * Number(p.amount || 0));
    }
    return orders.map((o) => {
      const received = receivedByOrder.get(o.id) || 0;
      const balance = Math.max(0, Number(o.totalAmount || 0) - received);
      const ageDays = Math.floor((Date.now() - o.createdAt.getTime()) / 86400000);
      let bucket: string;
      if (ageDays <= 30) bucket = '0-30'; else if (ageDays <= 60) bucket = '31-60'; else if (ageDays <= 90) bucket = '61-90'; else bucket = '90+';
      return { salesOrderId: o.id, orderNumber: o.orderNumber, customer: cmap.get(o.customerId)?.name || 'Customer record unavailable', total: Number(o.totalAmount || 0), received, balance, ageDays, ageBucket: bucket, status: o.paymentStatus };
    }).filter((r) => r.balance > 0).sort((a, b) => b.ageDays - a.ageDays);
  }
  toCsv(rows: any[]) { return toCsv(rows); }
  private normaliseRange(range?: { from?: Date; to?: Date }) {
    const to = range?.to ? new Date(range.to) : new Date();
    const from = range?.from ? new Date(range.from) : new Date(to.getTime() - 90 * 86400000);
    return { from, to };
  }
}
