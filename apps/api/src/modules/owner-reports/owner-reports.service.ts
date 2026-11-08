import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { stockStatus, stockThreshold } from '../common/stock-status';

export type ReportFilters = { preset?: string; from?: string; to?: string; brand?: string; category?: string; ownerId?: string; locationId?: string; tab?: string };
type Viewer = { id: string; role: string; canCost: boolean };
type Range = { from: Date; to: Date; prevFrom: Date; prevTo: Date; days: number; label: string };

export const DATA_SINCE = '1 Nov 2026';
export const REPORT_PERMISSIONS: Record<string, string[]> = {
  'sales-quotes': ['reports.sales', 'reports.executive'], salespeople: ['reports.sales', 'reports.executive'], architects: ['reports.sales', 'reports.executive'],
  'walk-ins': ['reports.sales', 'reports.executive'], 'demand-gap': ['reports.sales', 'reports.inventory', 'reports.executive'],
  'orders-invoices': ['reports.executive', 'reports.finance'], 'stock-value': ['reports.inventory', 'reports.executive'], 'dead-stock': ['reports.inventory', 'reports.executive'],
  movers: ['reports.inventory', 'reports.executive'], 'open-orders': ['reports.procurement', 'reports.executive'], 'data-health': ['reports.inventory', 'reports.executive'],
};

const DAY = 86400000;
const n = (value: unknown) => Number(value || 0) || 0;
const round = (value: number) => Math.round(value * 100) / 100;
const istDay = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(date);
const istStart = (day: string) => new Date(`${day}T00:00:00+05:30`);
const dateLabel = (value?: Date | string | null) => (value ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '');
const dayLabel = (day: string) => new Date(`${day}T12:00:00+05:30`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
export function inr(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1e7) return `₹${(value / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `₹${(value / 1e5).toFixed(1)} L`;
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}
const units = (value: number) => Math.round(value).toLocaleString('en-IN');
const pct = (value: number | null, digits = 0) => (value == null ? '—' : `${(value * 100).toFixed(digits)}%`);
const delta = (current: number, previous: number | null) => (previous == null || previous === 0 ? null : round((current - previous) / Math.abs(previous)));
const top = <T,>(rows: T[], size: number) => rows.slice(0, size);
function groupSum<T>(rows: T[], key: (row: T) => string, value: (row: T) => number) {
  const map = new Map<string, number>();
  rows.forEach((row) => map.set(key(row) || 'Unassigned', (map.get(key(row) || 'Unassigned') || 0) + value(row)));
  return Array.from(map.entries()).map(([label, v]) => ({ label, v })).sort((a, b) => b.v - a.v);
}

@Injectable()
export class OwnerReportsService {
  constructor(private prisma: PrismaService) {}

  range(filters: ReportFilters): Range {
    const today = istDay(new Date());
    const [y, m, d] = today.split('-').map(Number);
    const end = new Date(istStart(today).getTime() + DAY);
    const preset = filters.preset || 'month';
    let from: Date; let to = end; let label: string;
    if (preset === 'today') { from = istStart(today); label = 'today'; }
    else if (preset === 'week') {
      const weekday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
      from = new Date(istStart(today).getTime() - weekday * DAY); label = 'this week';
    } else if (preset === 'quarter') {
      const q = Math.floor((m - 1) / 3) * 3 + 1;
      from = istStart(`${y}-${String(q).padStart(2, '0')}-01`); label = 'this quarter';
    } else if (preset === 'custom' && filters.from && filters.to) {
      from = istStart(filters.from); to = new Date(istStart(filters.to).getTime() + DAY); label = 'in this period';
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) throw new BadRequestException('Choose a valid date range');
    } else { from = istStart(`${y}-${String(m).padStart(2, '0')}-01`); label = 'this month'; }
    const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY));
    const length = Math.min(to.getTime(), end.getTime()) - from.getTime();
    return { from, to, prevFrom: new Date(from.getTime() - Math.max(length, DAY)), prevTo: from, days, label };
  }

  /** Day buckets up to five weeks, week buckets beyond that. Only elapsed days are drawn. */
  private buckets(range: Range) {
    const end = range.to.getTime();
    const list: Array<{ key: string; label: string; from: number; to: number }> = [];
    const step = range.days > 35 ? 7 * DAY : DAY;
    for (let start = range.from.getTime(); start < end && start <= Date.now(); start += step) {
      list.push({ key: String(start), label: dayLabel(istDay(new Date(start))), from: start, to: start + step });
    }
    return list;
  }

  // ---- Quotes ----
  private async loadQuotes(from: Date, to: Date, filters: ReportFilters, viewer: Viewer) {
    const where: any = { supersededByQuoteId: null, createdAt: { lt: to } };
    if (viewer.role === 'sales') where.ownerId = viewer.id;
    else if (filters.ownerId) where.ownerId = filters.ownerId;
    const rows: any[] = await this.prisma.quote.findMany({
      where: { ...where, OR: [{ sentAt: { gte: from, lt: to } }, { sentAt: null, createdAt: { gte: from, lt: to } }] },
      include: { customer: { select: { name: true } }, owner: { select: { id: true, name: true } }, architect: { select: { id: true, name: true, firmName: true, city: true } } },
      orderBy: { createdAt: 'desc' }, take: 5000,
    } as any);
    const brand = String(filters.brand || '').toLowerCase();
    const category = String(filters.category || '').toLowerCase();
    return rows.map((quote) => {
      const lines: any[] = Array.isArray(quote.lines) ? quote.lines : [];
      let taxable = 0; let gst = 0; let mrpValue = 0; let maxDisc = 0;
      lines.forEach((line) => {
        const value = n(line.taxableValue); taxable += value; gst += n(line.taxAmount);
        const mrp = n(line.mrpValueInclusive);
        if (mrp > 0) { mrpValue += mrp; maxDisc = Math.max(maxDisc, 1 - value / mrp); }
      });
      const when: Date = quote.sentAt || quote.createdAt;
      return {
        id: quote.id, number: quote.quoteNumber, when, date: dateLabel(when), customer: quote.customer?.name || '', arch: quote.architect?.name || quote.architectName || '', architectId: quote.architectId,
        firm: quote.architect?.firmName || quote.architect?.city || '', owner: quote.owner?.name || '', ownerId: quote.ownerId, type: quote.quoteType === 'tile' ? 'Tiles' : 'CP & Sanitary', status: quote.status, lines, lineCount: lines.length,
        taxable: round(taxable), gst: round(gst), total: round(n(quote.commercialTotal) || taxable + gst), mrpValue: round(mrpValue), disc: mrpValue > 0 ? 1 - taxable / mrpValue : null, maxDisc,
        given: mrpValue > 0 ? Math.max(0, mrpValue - taxable) : 0, valid: dateLabel(quote.validUntil), validUntil: quote.validUntil, confirmedAt: quote.confirmedAt,
        dtc: quote.confirmedAt ? Math.max(0, Math.round((new Date(quote.confirmedAt).getTime() - when.getTime()) / DAY)) : null, customerId: quote.customerId, createdAt: quote.createdAt,
      };
    }).filter((quote) => (!brand || quote.lines.some((line) => String(line.brand || '').toLowerCase() === brand)) && (!category || quote.lines.some((line) => String(line.category || '').toLowerCase() === category)));
  }

  private isConfirmed(quote: any) { return ['confirmed', 'won', 'ordered', 'partially_ordered', 'closed'].includes(quote.status) || Boolean(quote.confirmedAt); }
  private isDraft(quote: any) { return ['draft', 'incomplete_pricing'].includes(quote.status); }
  private isSent(quote: any) { return !this.isDraft(quote) && !['cancelled', 'superseded'].includes(quote.status); }

  private salesAgg(quotes: any[]) {
    const sent = quotes.filter((quote) => this.isSent(quote));
    const confirmed = sent.filter((quote) => this.isConfirmed(quote));
    const sum = (rows: any[], key: string) => rows.reduce((total, row) => total + n(row[key]), 0);
    const priced = sent.filter((quote) => quote.mrpValue > 0);
    const mrp = sum(priced, 'mrpValue');
    const soon = Date.now() + 7 * DAY;
    return {
      n: quotes.length, sentN: sent.length, sent: sum(sent, 'taxable'), confN: confirmed.length, conf: sum(confirmed, 'taxable'), conv: sent.length ? confirmed.length / sent.length : null,
      disc: mrp ? 1 - sum(priced, 'taxable') / mrp : null, given: sum(priced, 'given'), avg: sent.length ? sum(sent, 'taxable') / sent.length : null,
      drafts: quotes.filter((quote) => quote.status === 'draft').length, incomplete: quotes.filter((quote) => quote.status === 'incomplete_pricing').length,
      expiring: sent.filter((quote) => !this.isConfirmed(quote) && !['lost', 'expired'].includes(quote.status) && quote.validUntil && new Date(quote.validUntil).getTime() <= soon && new Date(quote.validUntil).getTime() >= Date.now()).length,
    };
  }

  private trendChart(quotes: any[], range: Range, title = 'Quoted vs confirmed, by day') {
    const buckets = this.buckets(range);
    const inBucket = (bucket: any, quote: any) => quote.when.getTime() >= bucket.from && quote.when.getTime() < bucket.to;
    return {
      key: 'trend', type: 'bars', span: 2, title, sub: 'Value before GST · line shows confirmed out of sent', kind: 'inr', cats: buckets.map((bucket) => bucket.label),
      series: [
        { name: 'Quoted', color: 'c4', data: buckets.map((bucket) => round(quotes.filter((quote) => inBucket(bucket, quote) && this.isSent(quote)).reduce((total, quote) => total + quote.taxable, 0))) },
        { name: 'Confirmed', color: 'c1', data: buckets.map((bucket) => round(quotes.filter((quote) => inBucket(bucket, quote) && this.isConfirmed(quote)).reduce((total, quote) => total + quote.taxable, 0))) },
      ],
      line: { name: 'Conversion', data: buckets.map((bucket) => { const sent = quotes.filter((quote) => inBucket(bucket, quote) && this.isSent(quote)); return sent.length ? sent.filter((quote) => this.isConfirmed(quote)).length / sent.length : 0; }) },
    };
  }

  // ---- Stock ----
  private async loadStock(filters: ReportFilters, viewer: Viewer) {
    const [products, balances, lotRows, ledger, policies, samples]: any[] = await Promise.all([
      this.prisma.product.findMany({ where: { status: 'active' }, select: { id: true, sku: true, internalCode: true, name: true, brand: true, category: true, finish: true, dimensions: true, defaultMrpInclusive: true, media: true, tileDesignMaster: { select: { name: true } }, baseUom: true } }),
      this.prisma.inventoryBalance.findMany({ select: { productId: true, lowStockThreshold: true, reorderPoint: true } }),
      (this.prisma as any).inventoryLotBalance.findMany({ where: { lot: { status: 'active' }, ...(filters.locationId ? { locationId: filters.locationId } : {}) }, include: { lot: { select: { id: true, productId: true, lotNumber: true, unitCost: true, receivedAt: true, sourceType: true } }, location: { select: { id: true, name: true, code: true } } } }),
      (this.prisma as any).inventoryLotLedgerEntry.findMany({ where: { direction: 'out', createdAt: { gte: new Date(Date.now() - 400 * DAY) } }, select: { productId: true, quantity: true, createdAt: true, type: true }, take: 50000 }),
      (this.prisma as any).reorderPolicy.findMany({ where: { status: 'active' }, select: { productId: true, reorderPoint: true } }),
      this.prisma.displaySample.findMany({ where: { status: 'active' }, select: { productId: true } }),
    ]);
    const balanceBy = new Map<string, any>(balances.map((row: any) => [row.productId, row]));
    const policyBy = new Map<string, number>(policies.map((row: any) => [row.productId, n(row.reorderPoint)]));
    const sampleSet = new Set<string>(samples.map((row: any) => row.productId));
    const stock = new Map<string, any>();
    products.forEach((product: any) => stock.set(product.id, {
      ...product, code: product.internalCode || product.sku, mrp: n(product.defaultMrpInclusive), onHand: 0, available: 0, reserved: 0, hold: 0, damaged: 0, valueCost: 0, costedUnits: 0, missingCost: 0, firstReceived: null, lots: [], everStocked: false, out30: 0, lastOut: null,
    }));
    lotRows.forEach((row: any) => {
      const item = stock.get(row.lot.productId); if (!item) return;
      const qty = n(row.onHand); const cost = n(row.lot.unitCost);
      item.everStocked = true; item.onHand += qty; item.available += n(row.available); item.reserved += n(row.reserved); item.hold += n(row.hold); item.damaged += n(row.damaged);
      item.valueCost += qty * cost; if (cost > 0) item.costedUnits += qty; else item.missingCost += qty;
      const received = new Date(row.lot.receivedAt); if (!item.firstReceived || received < item.firstReceived) item.firstReceived = received;
      item.lots.push({ ...row.lot, qty, location: row.location?.name || '', cost });
    });
    const cutoff = Date.now() - 30 * DAY;
    ledger.forEach((row: any) => {
      const item = stock.get(row.productId); if (!item) return;
      const when = new Date(row.createdAt); if (when.getTime() >= cutoff) item.out30 += Math.abs(n(row.quantity));
      if (!item.lastOut || when > item.lastOut) item.lastOut = when;
    });
    const brand = String(filters.brand || ''); const category = String(filters.category || '');
    const items = Array.from(stock.values()).filter((item) => (!brand || item.brand === brand) && (!category || item.category === category)).map((item) => {
      const balance = balanceBy.get(item.id);
      const threshold = stockThreshold(item.category, balance?.lowStockThreshold, Math.max(n(balance?.reorderPoint), policyBy.get(item.id) || 0));
      const status = stockStatus({ everStocked: item.everStocked, onHand: item.onHand, available: item.available, threshold });
      const avgDay = item.out30 / 30;
      const since = item.lastOut || item.firstReceived;
      return {
        ...item, threshold, status, valueMrp: item.onHand * item.mrp, avgDay, cover: avgDay > 0 ? Math.round(item.available / avgDay) : null, idle: since ? Math.floor((Date.now() - new Date(since).getTime()) / DAY) : null,
        isSample: sampleSet.has(item.id), photo: Boolean(item.media?.primaryUrl || item.media?.primaryImage || (Array.isArray(item.media?.gallery) && item.media.gallery.length)), valueCost: viewer.canCost ? round(item.valueCost) : null,
      };
    });
    return { items, stocked: items.filter((item) => item.onHand > 0) };
  }

  private stockTotals(stocked: any[], canCost: boolean) {
    const unitsOnHand = stocked.reduce((total, item) => total + item.onHand, 0);
    const costed = stocked.reduce((total, item) => total + item.costedUnits, 0);
    return {
      units: unitsOnHand, skus: stocked.length, mrp: stocked.reduce((total, item) => total + item.valueMrp, 0), cost: canCost ? stocked.reduce((total, item) => total + n(item.valueCost), 0) : null,
      costed, missingUnits: unitsOnHand - costed, missingItems: stocked.filter((item) => item.missingCost > 0).length, coverage: unitsOnHand ? costed / unitsOnHand : null,
      noMrpItems: stocked.filter((item) => item.mrp <= 0).length, noMrpUnits: stocked.filter((item) => item.mrp <= 0).reduce((total, item) => total + item.onHand, 0),
      held: stocked.reduce((total, item) => total + item.hold + item.damaged, 0),
    };
  }

  private costNotice(totals: any) {
    if (totals.cost == null || !totals.missingUnits) return [];
    return [{ level: 'partial', text: totals.costed ? `${units(totals.missingUnits)} units in ${units(totals.missingItems)} items have no cost, so stock at cost is partial.` : `No costs recorded yet on ${units(totals.units)} units, so stock at cost shows ₹0. MRP figures are shown instead.`, href: '/dashboard/inventory?stockState=missing_cost', action: 'Enter lot costs' }];
  }

  // ---- Options ----
  async options(viewer: Viewer) {
    const [brands, categories, owners, locations]: any[] = await Promise.all([
      this.prisma.product.groupBy({ by: ['brand'], where: { status: 'active' }, orderBy: { brand: 'asc' } }),
      this.prisma.product.groupBy({ by: ['category'], where: { status: 'active' }, orderBy: { category: 'asc' } }),
      this.prisma.user.findMany({ where: { active: true, role: { in: ['sales', 'sales_manager', 'owner', 'admin', 'office_staff'] } }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.stockLocation.findMany({ where: { status: 'active' }, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } }),
    ]);
    return { brands: brands.map((row: any) => row.brand).filter(Boolean), categories: categories.map((row: any) => row.category).filter(Boolean), owners: viewer.role === 'sales' ? [] : owners, locations, dataSince: DATA_SINCE };
  }

  // ---- Reports ----
  async report(kind: string, filters: ReportFilters, viewer: Viewer) {
    const handlers: Record<string, () => Promise<any>> = {
      'sales-quotes': () => this.salesQuotes(filters, viewer), salespeople: () => this.salespeople(filters, viewer), architects: () => this.architects(filters, viewer), 'walk-ins': () => this.walkIns(filters, viewer),
      'demand-gap': () => this.demandGap(filters, viewer), 'orders-invoices': () => this.ordersInvoices(filters, viewer), 'stock-value': () => this.stockValue(filters, viewer), 'dead-stock': () => this.deadStock(filters, viewer),
      movers: () => this.movers(filters, viewer), 'open-orders': () => this.openOrders(filters, viewer), 'data-health': () => this.dataHealth(filters, viewer),
    };
    if (!handlers[kind]) throw new BadRequestException('Unknown report');
    const result = await handlers[kind]();
    return { kind, asOf: new Date().toISOString(), dataSince: DATA_SINCE, notices: [], charts: [], tabs: [], ...result };
  }

  private async salesQuotes(filters: ReportFilters, viewer: Viewer) {
    const range = this.range(filters);
    const [quotes, previous] = await Promise.all([this.loadQuotes(range.from, range.to, filters, viewer), this.loadQuotes(range.prevFrom, range.prevTo, filters, viewer)]);
    const a = this.salesAgg(quotes); const p = this.salesAgg(previous);
    const tiles = this.salesAgg(quotes.filter((quote) => quote.type === 'Tiles')); const cp = this.salesAgg(quotes.filter((quote) => quote.type !== 'Tiles'));
    return {
      notices: a.incomplete ? [{ level: 'partial', text: `${a.incomplete} quote${a.incomplete === 1 ? ' has' : 's have'} incomplete pricing and ${a.incomplete === 1 ? 'is' : 'are'} left out of these totals.`, href: '/dashboard/reports/data-health?tab=incomplete-quotes', action: 'Fix pricing' }] : [],
      empty: quotes.length ? null : { title: 'No quotes in this period', body: 'Quotes appear here the moment they are saved or sent.' },
      kpis: [
        { key: 'quoted', label: 'Quoted', value: a.sent, format: 'inr', sub: `${a.sentN} quotes sent`, delta: delta(a.sent, p.sent) },
        { key: 'confirmed', label: 'Confirmed', value: a.conf, format: 'inr', sub: `${a.confN} quotes`, delta: delta(a.conf, p.conf) },
        { key: 'conv', label: 'Converted', value: a.conv, format: 'pct', sub: `${a.confN} of ${a.sentN} sent` },
        { key: 'avg', label: 'Average quote', value: a.avg, format: 'inr', sub: 'per quote sent' },
        { key: 'drafts', label: 'Still drafts', value: a.drafts, format: 'num', sub: `${a.expiring} sent quotes expire in 7 days` },
      ],
      charts: [this.trendChart(quotes, range), { key: 'type', type: 'donut', title: 'By quote type', sub: 'Share of confirmed value', slices: [{ label: 'Tiles', v: tiles.conf }, { label: 'CP & Sanitary', v: cp.conf }], center: [inr(a.conf), 'confirmed'] }],
      table: {
        title: 'All quotes in this period', exportName: 'quotes',
        columns: [{ key: 'number', label: 'Quote', mono: true, sub: 'date' }, { key: 'customer', label: 'Customer', sub: 'arch' }, { key: 'owner', label: 'Salesperson' }, { key: 'type', label: 'Type' }, { key: 'lineCount', label: 'Lines', kind: 'num' }, { key: 'taxable', label: 'Taxable ₹', kind: 'inr' }, { key: 'gst', label: 'GST ₹', kind: 'inr' }, { key: 'total', label: 'Total ₹', kind: 'inr' }, { key: 'disc', label: 'Avg disc', kind: 'pct', d: 1 }, { key: 'status', label: 'Status', kind: 'chip' }, { key: 'valid', label: 'Valid until' }, { key: 'dtc', label: 'Days to confirm', kind: 'num' }],
        rows: quotes.map(({ lines: _lines, when: _when, validUntil: _validUntil, confirmedAt: _confirmedAt, createdAt: _createdAt, ...quote }) => ({ ...quote, href: `/dashboard/quotes/${quote.id}` })),
      },
    };
  }

  private async salespeople(filters: ReportFilters, viewer: Viewer) {
    const range = this.range(filters);
    const [quotes, visits]: any[] = await Promise.all([this.loadQuotes(range.from, range.to, filters, viewer), (this.prisma as any).showroomVisit.findMany({ where: { createdAt: { gte: range.from, lt: range.to }, handledBy: { not: null } }, select: { handledBy: true } })]);
    const team = this.salesAgg(quotes);
    const owners = Array.from(new Map(quotes.map((quote: any) => [quote.ownerId, quote.owner])).entries());
    const rows = owners.map(([id, name]: any) => {
      const mine = quotes.filter((quote: any) => quote.ownerId === id); const a = this.salesAgg(mine); const confirmed = mine.filter((quote: any) => quote.dtc != null);
      return { id, name, n: a.n, sentN: a.sentN, confN: a.confN, conv: a.conv, quoted: round(a.sent), conf: round(a.conf), disc: a.disc, given: round(a.given), maxD: Math.max(0, ...mine.map((quote: any) => quote.maxDisc)), dtc: confirmed.length ? round(confirmed.reduce((total: number, quote: any) => total + quote.dtc, 0) / confirmed.length) : null, walk: visits.filter((visit: any) => visit.handledBy === id).length, href: `/dashboard/reports/sales-quotes?ownerId=${id}&preset=${filters.preset || 'month'}` };
    }).sort((x: any, y: any) => y.conf - x.conf || y.quoted - x.quoted);
    const best = rows.filter((row: any) => row.conv != null).sort((x: any, y: any) => y.conv - x.conv)[0];
    return {
      empty: rows.length ? null : { title: 'Nobody has sent a quote yet this period', body: 'Once quotes are sent, each salesperson’s confirmed value, conversion and discount appear here.' },
      kpis: [
        { key: 'conf', label: 'Team confirmed', value: team.conf, format: 'inr', sub: `${team.confN} quotes` }, { key: 'conv', label: 'Team converted', value: team.conv, format: 'pct', sub: `${team.confN} of ${team.sentN} sent` },
        { key: 'disc', label: 'Average discount', value: team.disc, format: 'pct1', sub: 'below MRP, quantity-weighted' }, { key: 'given', label: 'Discount given away', value: team.given, format: 'inr', sub: 'on quotes sent' },
        { key: 'best', label: 'Best conversion', value: best ? String(best.name).split(' ')[0] : '—', format: 'text', sub: best ? `${pct(best.conv)} at ${pct(best.disc, 1)} discount` : 'no quotes yet' },
      ],
      charts: [
        { key: 'value', type: 'hbar', span: 'even', title: 'Confirmed value by salesperson', sub: 'Dark bar: confirmed · light bar behind: quoted', kind: 'inr', ghost: 'Quoted', rowH: 44, rows: rows.map((row: any) => ({ label: row.name, v: row.conf, g: row.quoted })) },
        { key: 'scatter', type: 'scatter', span: 'even', title: 'Discount vs conversion', sub: 'Who converts without buying the deal', pts: rows.map((row: any) => ({ label: row.name, x: row.disc || 0, y: row.conv || 0, size: row.conf || 1 })) },
      ],
      table: { title: 'Salespeople', exportName: 'salespeople', columns: [{ key: 'name', label: 'Salesperson' }, { key: 'n', label: 'Quotes', kind: 'num' }, { key: 'sentN', label: 'Sent', kind: 'num' }, { key: 'confN', label: 'Confirmed', kind: 'num' }, { key: 'conv', label: 'Converted', kind: 'pct' }, { key: 'quoted', label: 'Quoted ₹', kind: 'inr' }, { key: 'conf', label: 'Confirmed ₹', kind: 'inr' }, { key: 'disc', label: 'Avg disc', kind: 'pct', d: 1 }, { key: 'given', label: 'Given away ₹', kind: 'inr' }, { key: 'maxD', label: 'Max line disc', kind: 'pct' }, { key: 'dtc', label: 'Days to confirm', kind: 'num' }, { key: 'walk', label: 'Walk-ins handled', kind: 'num' }], rows },
    };
  }

  private async architects(filters: ReportFilters, viewer: Viewer) {
    const range = this.range(filters);
    const [quotes, master]: any[] = await Promise.all([this.loadQuotes(range.from, range.to, filters, viewer), (this.prisma as any).architect.count({ where: { status: 'active' } })]);
    const linked = quotes.filter((quote: any) => quote.arch); const direct = quotes.filter((quote: any) => !quote.arch);
    const a = this.salesAgg(linked); const d = this.salesAgg(direct); const all = this.salesAgg(quotes);
    const rows = Array.from(new Set(linked.map((quote: any) => quote.arch))).map((name: any) => {
      const mine = linked.filter((quote: any) => quote.arch === name); const x = this.salesAgg(mine);
      const brands = groupSum(mine.flatMap((quote: any) => quote.lines), (line: any) => line.brand, (line: any) => n(line.taxableValue));
      const last = mine[0];
      return { name, firm: last.firm, n: x.n, confN: x.confN, conv: x.conv, quoted: round(x.sent), conf: round(x.conf), disc: x.disc, last: last.date, since: Math.floor((Date.now() - last.when.getTime()) / DAY), brand: brands[0]?.label || '', href: `/dashboard/quotes?search=${encodeURIComponent(String(name))}` };
    }).sort((x: any, y: any) => y.conf - x.conf || y.quoted - x.quoted);
    const buckets = this.buckets(range);
    return {
      empty: rows.length ? null : { title: 'No architect tagged on a quote yet', body: 'Tag the architect when creating a quote to see who brings business.' },
      kpis: [
        { key: 'active', label: 'Architects active', value: rows.length, format: 'num', sub: `of ${master} in master` }, { key: 'quoted', label: 'Architect-linked quoted', value: a.sent, format: 'inr', sub: `${all.sent ? pct(a.sent / all.sent) : '—'} of all quoted` },
        { key: 'conf', label: 'Confirmed', value: a.conf, format: 'inr', sub: `${a.confN} quotes` }, { key: 'conv', label: 'Converted', value: a.conv, format: 'pct', sub: `direct: ${pct(d.conv)}` },
        { key: 'disc', label: 'Discount, architect vs direct', value: `${pct(a.disc, 1)} · ${pct(d.disc, 1)}`, format: 'text', sub: 'average below MRP' },
      ],
      charts: [
        { key: 'by', type: 'hbar', title: 'Confirmed value by architect', sub: 'Light bar behind: quoted', kind: 'inr', ghost: 'Quoted', rowH: 38, rows: top(rows, 15).map((row: any) => ({ label: row.name, v: row.conf, g: row.quoted })) },
        { key: 'share', type: 'bars', title: 'Quoted via architects', sub: 'By day', kind: 'inr', stacked: true, cats: buckets.map((b) => b.label), series: [{ name: 'Via architect', color: 'c1', data: buckets.map((b) => round(linked.filter((q: any) => this.isSent(q) && q.when.getTime() >= b.from && q.when.getTime() < b.to).reduce((t: number, q: any) => t + q.taxable, 0))) }, { name: 'Direct / walk-in', color: 'c4', data: buckets.map((b) => round(direct.filter((q: any) => this.isSent(q) && q.when.getTime() >= b.from && q.when.getTime() < b.to).reduce((t: number, q: any) => t + q.taxable, 0))) }] },
      ],
      table: { title: 'Architects', exportName: 'architects', columns: [{ key: 'name', label: 'Architect', sub: 'firm' }, { key: 'n', label: 'Quotes', kind: 'num' }, { key: 'confN', label: 'Confirmed', kind: 'num' }, { key: 'conv', label: 'Converted', kind: 'pct' }, { key: 'quoted', label: 'Quoted ₹', kind: 'inr' }, { key: 'conf', label: 'Confirmed ₹', kind: 'inr' }, { key: 'disc', label: 'Avg disc', kind: 'pct', d: 1 }, { key: 'last', label: 'Last quote' }, { key: 'since', label: 'Days since', kind: 'num' }, { key: 'brand', label: 'Top brand' }], rows },
    };
  }

  private async loadVisits(from: Date, to: Date) {
    const visits: any[] = await (this.prisma as any).showroomVisit.findMany({ where: { createdAt: { gte: from, lt: to } }, include: { scans: true }, orderBy: { createdAt: 'desc' }, take: 5000 });
    const customerIds = Array.from(new Set(visits.map((visit) => visit.customerId).filter(Boolean))) as string[];
    const handlers = Array.from(new Set(visits.map((visit) => visit.handledBy).filter(Boolean))) as string[];
    const [quotes, users]: any[] = await Promise.all([
      customerIds.length ? this.prisma.quote.findMany({ where: { customerId: { in: customerIds }, supersededByQuoteId: null, createdAt: { gte: from } }, select: { id: true, quoteNumber: true, customerId: true, status: true, confirmedAt: true, createdAt: true } }) : [],
      handlers.length ? this.prisma.user.findMany({ where: { id: { in: handlers } }, select: { id: true, name: true } }) : [],
    ]);
    const names = new Map(users.map((user: any) => [user.id, user.name]));
    return visits.map((visit) => {
      const quote = quotes.find((row: any) => row.customerId === visit.customerId && new Date(row.createdAt) >= new Date(visit.createdAt));
      const outcome = quote ? (this.isConfirmed(quote) ? 'Confirmed' : 'Quoted') : visit.status === 'closed' ? 'Closed' : 'Open';
      return { ...visit, outcome, quoteNumber: quote?.quoteNumber || '', quoteId: quote?.id, handler: visit.handledBy ? names.get(visit.handledBy) || '' : '', scanTotal: visit.scans.length };
    });
  }

  private async walkIns(filters: ReportFilters, viewer: Viewer) {
    const range = this.range(filters);
    const visits = await this.loadVisits(range.from, range.to);
    const count = visits.length; const quoted = visits.filter((visit) => ['Quoted', 'Confirmed'].includes(visit.outcome)).length; const confirmed = visits.filter((visit) => visit.outcome === 'Confirmed').length; const open = visits.filter((visit) => visit.outcome === 'Open').length;
    const today = istDay(new Date());
    const productIds = Array.from(new Set(visits.flatMap((visit) => visit.scans.map((scan: any) => scan.productId)))) as string[];
    const stock = await this.loadStock({}, viewer);
    const byId = new Map<string, any>(stock.items.map((item: any) => [item.id, item]));
    const scanCounts = new Map<string, number>();
    visits.forEach((visit) => visit.scans.forEach((scan: any) => scanCounts.set(scan.productId, (scanCounts.get(scan.productId) || 0) + n(scan.scanCount))));
    const buckets = this.buckets(range);
    const per = (outcome: string, b: any) => visits.filter((visit) => visit.outcome === outcome && new Date(visit.createdAt).getTime() >= b.from && new Date(visit.createdAt).getTime() < b.to).length;
    return {
      empty: count ? null : { title: 'No walk-ins recorded yet', body: 'Visitors appear here when they check in by scanning the showroom poster.', href: '/print/showroom-poster', action: 'Print the poster' },
      kpis: [
        { key: 'n', label: 'Walk-ins', value: count, format: 'num', sub: `${visits.filter((visit) => istDay(new Date(visit.createdAt)) === today).length} today` }, { key: 'q', label: 'Got a quote', value: quoted, format: 'num', sub: count ? `${pct(quoted / count)} of walk-ins` : '' },
        { key: 'c', label: 'Confirmed', value: confirmed, format: 'num', sub: count ? `${pct(confirmed / count)} of walk-ins` : '' }, { key: 's', label: 'Scans per visitor', value: count ? round(visits.reduce((t, v) => t + v.scanTotal, 0) / count) : 0, format: 'dec', sub: 'product stickers scanned' },
        { key: 'open', label: 'Waiting now', value: open, format: 'num', sub: open ? 'need someone' : 'all handled', warn: open > 0, href: '/dashboard/walk-ins' },
      ],
      charts: [
        { key: 'daily', type: 'bars', title: 'Walk-ins per day, by outcome', kind: 'num', stacked: true, cats: buckets.map((b) => b.label), series: [{ name: 'Closed, no quote', color: 'c6', data: buckets.map((b) => per('Closed', b)) }, { name: 'Still open', color: 'c3', data: buckets.map((b) => per('Open', b)) }, { name: 'Quoted', color: 'c4', data: buckets.map((b) => per('Quoted', b)) }, { name: 'Confirmed', color: 'c1', data: buckets.map((b) => per('Confirmed', b)) }] },
        { key: 'scanned', type: 'hbar', title: 'Most scanned products', sub: 'Grey = not in stock', kind: 'num', rows: top(productIds.map((id) => { const item = byId.get(id); return { label: item?.name || item?.code || 'Product', v: scanCounts.get(id) || 0, vl: item?.onHand ? undefined : `${scanCounts.get(id) || 0} · not stocked`, color: item?.onHand ? 'c2' : 'c6' }; }).sort((a, b) => b.v - a.v), 8) },
      ],
      table: { title: 'Walk-ins', exportName: 'walk-ins', columns: [{ key: 'when', label: 'When', mono: true }, { key: 'name', label: 'Visitor', sub: 'mobile' }, { key: 'city', label: 'City' }, { key: 'note', label: 'Looking for' }, { key: 'scanTotal', label: 'Scans', kind: 'num' }, { key: 'handler', label: 'Handled by' }, { key: 'outcome', label: 'Status', kind: 'chip' }, { key: 'quoteNumber', label: 'Quote', mono: true }],
        rows: visits.map((visit) => ({ id: visit.id, when: new Date(visit.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }), name: visit.name, mobile: viewer.role === 'sales' && visit.handledBy !== viewer.id ? `${String(visit.mobile).slice(0, 2)}xxx xx${String(visit.mobile).slice(-3)}` : visit.mobile, city: visit.city, note: visit.note, scanTotal: visit.scanTotal, handler: visit.handler, outcome: visit.outcome, quoteNumber: visit.quoteNumber, href: visit.quoteId ? `/dashboard/quotes/${visit.quoteId}` : '/dashboard/walk-ins' })) },
    };
  }

  private async demandRows(range: Range, filters: ReportFilters, viewer: Viewer) {
    const [quotes, stock, scans, stats]: any[] = await Promise.all([
      this.loadQuotes(range.from, range.to, {}, viewer), this.loadStock(filters, viewer),
      (this.prisma as any).showroomVisitScan.findMany({ where: { updatedAt: { gte: range.from, lt: range.to } }, select: { productId: true, scanCount: true, updatedAt: true } }),
      (this.prisma as any).productPublicStat.findMany({ select: { productId: true, views: true, qrScans: true } }),
    ]);
    const map = new Map<string, any>();
    const bump = (id: string) => { if (!map.has(id)) map.set(id, { qty: 0, quotes: new Set(), value: 0, scans: 0, views: 0, last: null }); return map.get(id); };
    quotes.filter((quote: any) => !this.isDraft(quote)).forEach((quote: any) => quote.lines.forEach((line: any) => { if (!line.productId) return; const row = bump(line.productId); row.qty += n(line.qty || line.quantity); row.quotes.add(quote.id); row.value += n(line.taxableValue); if (!row.last || quote.when > row.last) row.last = quote.when; }));
    scans.forEach((scan: any) => { const row = bump(scan.productId); row.scans += n(scan.scanCount); const when = new Date(scan.updatedAt); if (!row.last || when > row.last) row.last = when; });
    stats.forEach((stat: any) => { if (map.has(stat.productId)) map.get(stat.productId).views = n(stat.views); });
    const byId = new Map<string, any>(stock.items.map((item: any) => [item.id, item]));
    return Array.from(map.entries()).map(([id, row]) => { const item = byId.get(id); if (!item) return null; return { id, sku: item.code, name: String(item.name || '').trim() || item.code, brand: item.brand, cat: item.category, status: item.status, available: item.available, qQty: row.qty, quotes: row.quotes.size, scans: row.scans, views: row.views, qVal: round(row.value), last: dateLabel(row.last), score: Math.round(row.qty * 3 + row.scans + row.views * 0.2), href: `/dashboard/products?product=${id}` }; }).filter(Boolean).sort((a: any, b: any) => b.score - a.score) as any[];
  }

  private async demandGap(filters: ReportFilters, viewer: Viewer) {
    const range = this.range(filters);
    const rows = await this.demandRows(range, filters, viewer);
    const gap = rows.filter((row) => row.available <= 0);
    const totalScore = rows.reduce((t, r) => t + r.score, 0);
    return {
      empty: rows.length ? null : { title: 'No demand recorded yet', body: 'As quotes and showroom scans come in, this shows what people want that is not on the floor.' },
      kpis: [
        { key: 'n', label: 'Asked for, not in stock', value: gap.length, format: 'num', sub: `products ${range.label}` }, { key: 'val', label: 'Quoted on unstocked', value: gap.reduce((t, r) => t + r.qVal, 0), format: 'inr', sub: 'would need ordering' },
        { key: 'scan', label: 'Scans on unstocked', value: gap.reduce((t, r) => t + r.scans, 0), format: 'num', sub: 'showroom stickers' }, { key: 'share', label: 'Share of demand unstocked', value: totalScore ? gap.reduce((t, r) => t + r.score, 0) / totalScore : null, format: 'pct', sub: 'by demand score' },
        { key: 'low', label: 'Asked for, running low', value: rows.filter((r) => r.status === 'Running low').length, format: 'num', sub: 'reorder soon' },
      ],
      notices: rows.length ? [{ level: 'info', text: 'Stock is checked as of now, so an item that has since arrived no longer shows as unstocked.' }] : [],
      charts: [
        { key: 'top', type: 'hbar', title: 'Most asked for, and where it stands', sub: 'Score = quoted quantity ×3 + scans + views ×0.2', kind: 'num', rowH: 32, rows: top(rows, 12).map((r) => ({ label: r.name, v: r.score, color: r.status === 'Ran out' ? 'c5' : r.status === 'Running low' ? 'c3' : r.status === 'Catalogue only' ? 'c6' : 'c2' })), legend: [{ name: 'In stock', color: 'c2' }, { name: 'Running low', color: 'c3' }, { name: 'Ran out', color: 'c5' }, { name: 'Never stocked', color: 'c6' }] },
        { key: 'brand', type: 'hbar', title: 'Unstocked demand by brand', sub: 'Quoted value', kind: 'inr', rows: top(groupSum(gap, (r) => r.brand, (r) => r.qVal), 10) },
      ],
      table: { title: 'Products asked for', exportName: 'demand-gap', columns: [{ key: 'name', label: 'Product', sub: 'brand' }, { key: 'sku', label: 'Code', mono: true }, { key: 'cat', label: 'Category' }, { key: 'status', label: 'Stock', kind: 'chip' }, { key: 'available', label: 'Available', kind: 'num' }, { key: 'qQty', label: 'Quoted qty', kind: 'num' }, { key: 'quotes', label: 'Quotes', kind: 'num' }, { key: 'scans', label: 'Scans', kind: 'num' }, { key: 'views', label: 'Views', kind: 'num' }, { key: 'qVal', label: 'Quoted ₹', kind: 'inr' }, { key: 'last', label: 'Last asked' }], rows },
    };
  }

  private async ordersInvoices(filters: ReportFilters, viewer: Viewer) {
    const range = this.range(filters);
    const where = { gte: range.from, lt: range.to };
    const [orders, invoices, payments, grns, confirmed, openInvoices]: any[] = await Promise.all([
      this.prisma.salesOrder.findMany({ where: { createdAt: where, status: { not: 'cancelled' } }, include: { customer: { select: { name: true } }, owner: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 3000 } as any),
      this.prisma.salesInvoice.findMany({ where: { issueDate: where, voidedAt: null }, orderBy: { issueDate: 'desc' }, take: 3000 } as any),
      this.prisma.customerPayment.findMany({ where: { receivedAt: where, voidedAt: null }, select: { amount: true, receivedAt: true } } as any),
      (this.prisma as any).goodsReceiptNote.findMany({ where: { createdAt: where }, select: { id: true, grnNumber: true, vendorName: true, createdAt: true, lines: { select: { acceptedQuantity: true, unitCost: true } } } }).catch(() => []),
      this.loadQuotes(range.from, range.to, filters, viewer),
      this.prisma.salesInvoice.aggregate({ where: { voidedAt: null }, _sum: { openAmount: true } } as any),
    ]);
    const sum = (rows: any[], key: string) => rows.reduce((t, r) => t + n(r[key]), 0);
    const a = this.salesAgg(confirmed);
    const received = viewer.canCost ? grns.reduce((t: number, grn: any) => t + (grn.lines || []).reduce((x: number, line: any) => x + n(line.acceptedQuantity) * n(line.unitCost), 0), 0) : null;
    const buckets = this.buckets(range);
    const inB = (b: any, value: any) => new Date(value).getTime() >= b.from && new Date(value).getTime() < b.to;
    const rows = orders.map((order: any) => ({ id: order.id, number: order.orderNumber, date: dateLabel(order.createdAt), customer: order.customer?.name || '', owner: order.owner?.name || '', status: order.status, payment: order.paymentStatus, total: round(n(order.totalAmount)), advance: round(n(order.advanceAmount)), href: `/dashboard/orders?search=${encodeURIComponent(order.orderNumber)}` }));
    return {
      notices: !orders.length && !invoices.length ? [{ level: 'info', text: 'No orders or invoices are recorded in the system yet, so confirmed quotes are the best view of sales for now. These figures fill in as soon as orders and invoices are created here.' }] : [],
      kpis: [
        { key: 'conf', label: 'Confirmed quotes', value: a.conf, format: 'inr', sub: `${a.confN} quotes`, href: '/dashboard/reports/sales-quotes' }, { key: 'orders', label: 'Orders booked', value: sum(orders, 'totalAmount'), format: 'inr', sub: `${orders.length} orders` },
        { key: 'inv', label: 'Invoiced', value: sum(invoices, 'totalAmount'), format: 'inr', sub: `${invoices.length} invoices` }, { key: 'paid', label: 'Payments received', value: sum(payments, 'amount'), format: 'inr', sub: `${payments.length} receipts` },
        { key: 'due', label: 'Still to collect', value: n(openInvoices._sum?.openAmount), format: 'inr', sub: 'open on invoices' }, ...(received == null ? [] : [{ key: 'grn', label: 'Purchases received', value: received, format: 'inr', sub: `${grns.length} GRNs at cost` }]),
      ],
      charts: [
        { key: 'flow', type: 'bars', span: 2, title: 'Sales flow, by day', sub: 'Confirmed quotes, orders and invoices', kind: 'inr', cats: buckets.map((b) => b.label), series: [{ name: 'Confirmed quotes', color: 'c4', data: buckets.map((b) => round(confirmed.filter((q: any) => this.isConfirmed(q) && inB(b, q.when)).reduce((t: number, q: any) => t + q.taxable, 0))) }, { name: 'Orders', color: 'c1', data: buckets.map((b) => round(orders.filter((o: any) => inB(b, o.createdAt)).reduce((t: number, o: any) => t + n(o.totalAmount), 0))) }, { name: 'Invoiced', color: 'c2', data: buckets.map((b) => round(invoices.filter((i: any) => inB(b, i.issueDate)).reduce((t: number, i: any) => t + n(i.totalAmount), 0))) }] },
        { key: 'split', type: 'donut', title: 'Where the value stands', slices: [{ label: 'Confirmed quotes', v: a.conf }, { label: 'Orders', v: sum(orders, 'totalAmount') }, { label: 'Invoiced', v: sum(invoices, 'totalAmount') }], center: [inr(a.conf + sum(orders, 'totalAmount') + sum(invoices, 'totalAmount')), 'total'] },
      ],
      table: { title: 'Orders in this period', exportName: 'orders', columns: [{ key: 'number', label: 'Order', mono: true, sub: 'date' }, { key: 'customer', label: 'Customer' }, { key: 'owner', label: 'Salesperson' }, { key: 'status', label: 'Status', kind: 'chip' }, { key: 'payment', label: 'Payment' }, { key: 'advance', label: 'Advance ₹', kind: 'inr' }, { key: 'total', label: 'Total ₹', kind: 'inr' }], rows },
    };
  }

  private async stockValue(filters: ReportFilters, viewer: Viewer) {
    const { items, stocked } = await this.loadStock(filters, viewer);
    const t = this.stockTotals(stocked, viewer.canCost);
    const tab = filters.tab || 'brand';
    const tabs = [['brand', 'Brand'], ['category', 'Category'], ['matrix', 'Brand × Category'], ['tile', 'Tile design & size'], ['age', 'Age'], ['top', 'Top items'], ['hold', 'Hold / Damaged'], ['source', 'Source'], ['location', 'Location']].map(([id, label]) => ({ id, label }));
    const costCols = viewer.canCost ? [{ key: 'cost', label: 'Value at cost', kind: 'inr' }, { key: 'cov', label: 'Costs entered', kind: 'pct' }] : [];
    const group = (key: (item: any) => string) => {
      const map = new Map<string, any>();
      stocked.forEach((item: any) => { const name = key(item) || 'Unassigned'; const row = map.get(name) || { name, skus: 0, units: 0, mrp: 0, cost: 0, costed: 0 }; row.skus += 1; row.units += item.onHand; row.mrp += item.valueMrp; row.cost += n(item.valueCost); row.costed += item.costedUnits; map.set(name, row); });
      return Array.from(map.values()).map((row) => ({ ...row, mrp: round(row.mrp), cost: viewer.canCost ? round(row.cost) : null, cov: row.units ? row.costed / row.units : null, share: t.mrp ? row.mrp / t.mrp : 0 })).sort((a, b) => b.mrp - a.mrp);
    };
    let charts: any[] = []; let table: any = null;
    const byDim = (label: string, key: (item: any) => string, param: string) => {
      const rows = group(key).map((row) => ({ ...row, href: `/dashboard/inventory?${param}=${encodeURIComponent(row.name)}` }));
      charts = [{ key: 'bar', type: 'hbar', span: 2, title: `Stock at MRP by ${label.toLowerCase()}`, sub: viewer.canCost ? 'Cost appears as the light bar once lot costs are entered' : '', kind: 'inr', ghost: viewer.canCost ? 'Cost' : undefined, rowH: 36, rows: top(rows, 14).map((row) => ({ label: row.name, v: row.mrp, g: row.cost || 0 })) }, { key: 'share', type: 'donut', title: 'Share of value', sub: 'At MRP', slices: [...top(rows, 5).map((row) => ({ label: row.name, v: row.mrp })), { label: 'Others', v: rows.slice(5).reduce((s, r) => s + r.mrp, 0) }].filter((s) => s.v > 0), center: [inr(t.mrp), 'at MRP'] }];
      table = { title: `By ${label.toLowerCase()}`, exportName: `stock-by-${label.toLowerCase()}`, columns: [{ key: 'name', label }, { key: 'skus', label: 'Items', kind: 'num' }, { key: 'units', label: 'Units', kind: 'num' }, { key: 'mrp', label: 'Value at MRP', kind: 'inr' }, ...costCols, { key: 'share', label: 'Share', kind: 'pct', d: 1 }], rows };
    };
    if (tab === 'brand') byDim('Brand', (item) => item.brand, 'brand');
    else if (tab === 'category') byDim('Category', (item) => item.category, 'category');
    else if (tab === 'matrix') {
      const brands = top(group((item) => item.brand), 10).map((row) => row.name); const cats = top(group((item) => item.category), 8).map((row) => row.name);
      const cells = brands.map((b) => cats.map((c) => round(stocked.filter((item: any) => item.brand === b && item.category === c).reduce((s: number, item: any) => s + item.valueMrp, 0))));
      charts = [{ key: 'heat', type: 'heatmap', span: 'full', title: 'Where the money sits', sub: 'Value at MRP · tap a cell to open that stock', rows: brands, cols: cats, cells }];
      table = { title: 'Brand and category', exportName: 'stock-brand-category', columns: [{ key: 'brand', label: 'Brand' }, { key: 'category', label: 'Category' }, { key: 'skus', label: 'Items', kind: 'num' }, { key: 'units', label: 'Units', kind: 'num' }, { key: 'mrp', label: 'Value at MRP', kind: 'inr' }, ...costCols], rows: group((item) => `${item.brand}|||${item.category}`).map((row) => { const [brand, category] = row.name.split('|||'); return { ...row, brand, category, href: `/dashboard/inventory?brand=${encodeURIComponent(brand)}&category=${encodeURIComponent(category)}` }; }) };
    } else if (tab === 'tile') {
      const tiles = stocked.filter((item: any) => String(item.category).toLowerCase() === 'tiles');
      const rows = group((item) => (String(item.category).toLowerCase() === 'tiles' ? `${item.tileDesignMaster?.name || item.name} · ${item.dimensions || 'no size'}` : '')).filter((row) => row.name !== 'Unassigned');
      charts = tiles.length ? [{ key: 'bar', type: 'hbar', span: 'full', title: 'Top tile designs and sizes', sub: 'Value at MRP', kind: 'inr', rows: top(rows, 15).map((row) => ({ label: row.name, v: row.mrp })) }] : [];
      table = { title: 'Tile design and size', exportName: 'tile-stock', empty: 'No tiles in stock yet. They appear here once tile stock is posted.', columns: [{ key: 'name', label: 'Design and size' }, { key: 'skus', label: 'Items', kind: 'num' }, { key: 'units', label: 'Boxes / pieces', kind: 'num' }, { key: 'mrp', label: 'Value at MRP', kind: 'inr' }, ...costCols], rows };
    } else if (tab === 'age') {
      const bands: Array<[string, number, number]> = [['0–30 days', 0, 30], ['31–90 days', 31, 90], ['91–180 days', 91, 180], ['181–365 days', 181, 365], ['Over a year', 366, 99999]];
      const lots = stocked.flatMap((item: any) => item.lots.filter((lot: any) => lot.qty > 0).map((lot: any) => ({ ...lot, item, age: Math.floor((Date.now() - new Date(lot.receivedAt).getTime()) / DAY) })));
      const rows = bands.map(([name, min, max]) => { const inBand = lots.filter((lot: any) => lot.age >= min && lot.age <= max); return { name, lots: inBand.length, units: inBand.reduce((s: number, l: any) => s + l.qty, 0), mrp: round(inBand.reduce((s: number, l: any) => s + l.qty * l.item.mrp, 0)), cost: viewer.canCost ? round(inBand.reduce((s: number, l: any) => s + l.qty * l.cost, 0)) : null }; });
      charts = [{ key: 'age', type: 'bars', span: 'full', title: 'Stock value by age of lot', sub: 'Counted from the date each lot was received', kind: 'inr', cats: rows.map((r) => r.name), series: [{ name: 'At MRP', color: 'c1', data: rows.map((r) => r.mrp) }] }];
      table = { title: 'By age', exportName: 'stock-by-age', columns: [{ key: 'name', label: 'Age' }, { key: 'lots', label: 'Lots', kind: 'num' }, { key: 'units', label: 'Units', kind: 'num' }, { key: 'mrp', label: 'Value at MRP', kind: 'inr' }, ...(viewer.canCost ? [{ key: 'cost', label: 'Value at cost', kind: 'inr' }] : [])], rows };
    } else if (tab === 'top') {
      let cumulative = 0;
      const rows = top([...stocked].sort((a: any, b: any) => b.valueMrp - a.valueMrp), 100).map((item: any) => { cumulative += item.valueMrp; return { id: item.id, sku: item.code, name: String(item.name || '').trim() || item.code, brand: item.brand, cat: item.category, onHand: item.onHand, mrp: item.mrp, valueMrp: round(item.valueMrp), cost: item.valueCost, cum: t.mrp ? cumulative / t.mrp : 0, href: `/dashboard/products?product=${item.id}` }; });
      charts = [{ key: 'top', type: 'hbar', span: 'full', title: 'Top 15 items by value at MRP', kind: 'inr', rowH: 30, rows: top(rows, 15).map((r) => ({ label: r.name, v: r.valueMrp })) }];
      table = { title: 'Top 100 items', exportName: 'top-items-by-value', columns: [{ key: 'sku', label: 'Code', mono: true }, { key: 'name', label: 'Product', sub: 'brand' }, { key: 'cat', label: 'Category' }, { key: 'onHand', label: 'On hand', kind: 'num' }, { key: 'mrp', label: 'MRP', kind: 'inr' }, { key: 'valueMrp', label: 'Value at MRP', kind: 'inr' }, ...(viewer.canCost ? [{ key: 'cost', label: 'At cost', kind: 'inr' }] : []), { key: 'cum', label: 'Cumulative', kind: 'pct' }], rows };
    } else if (tab === 'hold') {
      const rows = stocked.filter((item: any) => item.hold + item.damaged > 0).map((item: any) => ({ id: item.id, sku: item.code, name: item.name || item.code, brand: item.brand, hold: item.hold, damaged: item.damaged, mrp: item.mrp, tied: round((item.hold + item.damaged) * item.mrp), href: `/dashboard/products?product=${item.id}` }));
      table = { title: 'Held and damaged', exportName: 'hold-damaged', empty: 'Nothing is on hold or damaged.', columns: [{ key: 'sku', label: 'Code', mono: true }, { key: 'name', label: 'Product', sub: 'brand' }, { key: 'hold', label: 'On hold', kind: 'num' }, { key: 'damaged', label: 'Damaged', kind: 'num' }, { key: 'mrp', label: 'MRP', kind: 'inr' }, { key: 'tied', label: 'Value tied up', kind: 'inr' }], rows };
    } else if (tab === 'source') {
      const lots = stocked.flatMap((item: any) => item.lots.filter((lot: any) => lot.qty > 0).map((lot: any) => ({ source: lot.sourceType === 'opening_stock' ? 'Opening stock' : lot.sourceType === 'manual_grn' ? 'Manual GRN' : 'GRN', units: lot.qty, mrp: lot.qty * item.mrp })));
      const rows = ['Opening stock', 'GRN', 'Manual GRN'].map((name) => { const list = lots.filter((lot: any) => lot.source === name); return { name, lots: list.length, units: list.reduce((s: number, l: any) => s + l.units, 0), mrp: round(list.reduce((s: number, l: any) => s + l.mrp, 0)) }; });
      charts = [{ key: 'donut', type: 'donut', title: 'Where stock came from', sub: 'By units', kind: 'num', slices: rows.filter((r) => r.units).map((r) => ({ label: r.name, v: r.units })), center: [units(t.units), 'units'] }, { key: 'bar', type: 'bars', title: 'Value at MRP by source', kind: 'inr', cats: rows.map((r) => r.name), series: [{ name: 'At MRP', color: 'c1', data: rows.map((r) => r.mrp) }], span: 'even' }];
      table = { title: 'By source', exportName: 'stock-by-source', columns: [{ key: 'name', label: 'Source' }, { key: 'lots', label: 'Lots', kind: 'num' }, { key: 'units', label: 'Units', kind: 'num' }, { key: 'mrp', label: 'Value at MRP', kind: 'inr' }], rows };
    } else if (tab === 'location') {
      const map = new Map<string, any>();
      stocked.forEach((item: any) => item.lots.forEach((lot: any) => { const key = `${lot.location}|||${item.category}`; const row = map.get(key) || { loc: lot.location, cat: item.category, units: 0, mrp: 0, cost: 0 }; row.units += lot.qty; row.mrp += lot.qty * item.mrp; row.cost += lot.qty * lot.cost; map.set(key, row); }));
      table = { title: 'By location and category', exportName: 'stock-by-location', columns: [{ key: 'loc', label: 'Location' }, { key: 'cat', label: 'Category' }, { key: 'units', label: 'Units', kind: 'num' }, { key: 'mrp', label: 'Value at MRP', kind: 'inr' }, ...(viewer.canCost ? [{ key: 'cost', label: 'At cost', kind: 'inr' }] : [])], rows: Array.from(map.values()).map((row) => ({ ...row, mrp: round(row.mrp), cost: viewer.canCost ? round(row.cost) : null })).sort((a, b) => b.mrp - a.mrp) };
    }
    return {
      tabs, tab, notices: this.costNotice(t),
      empty: stocked.length ? null : { title: 'No stock posted yet', body: 'Post opening stock or receive a GRN and values appear here.', href: '/dashboard/inventory/opening-stock', action: 'Open Opening Stock' },
      kpis: [
        { key: 'units', label: 'Units on hand', value: t.units, format: 'num', sub: `${units(t.skus)} items in stock` }, { key: 'mrp', label: 'Stock at MRP', value: t.mrp, format: 'inr', sub: t.noMrpItems ? `before GST · ${units(t.noMrpItems)} items have no MRP` : 'before GST' },
        ...(viewer.canCost ? [{ key: 'cost', label: 'Stock at cost', value: t.cost, format: 'inr', sub: `Costs entered for ${pct(t.coverage)} of units`, warn: t.missingUnits > 0 }] : []),
        { key: 'cat', label: 'Catalogue only', value: items.filter((item: any) => item.status === 'Catalogue only').length, format: 'num', sub: 'never stocked · no alerts' }, { key: 'held', label: 'Held / damaged', value: t.held, format: 'num', sub: 'units not saleable' },
      ],
      charts, table: table || undefined,
    };
  }

  private async deadStock(filters: ReportFilters, viewer: Viewer) {
    const { stocked } = await this.loadStock(filters, viewer);
    const range = this.range({ preset: 'quarter' });
    const demand = await this.demandRows({ ...range, from: new Date(Date.now() - 90 * DAY), to: new Date(Date.now() + DAY) }, filters, viewer);
    const demandBy = new Map(demand.map((row) => [row.id, row]));
    const first = stocked.reduce((min: number, item: any) => Math.min(min, item.firstReceived ? new Date(item.firstReceived).getTime() : Date.now()), Date.now());
    const history = Math.floor((Date.now() - first) / DAY);
    const young = history < 90;
    const list = stocked.filter((item: any) => (young ? !item.lastOut : (item.idle || 0) >= 90));
    const rows = list.map((item: any) => { const d = demandBy.get(item.id); const asked = (d?.quotes || 0) + (d?.scans || 0); return { id: item.id, sku: item.code, name: String(item.name || '').trim() || item.code, brand: item.brand, cat: item.category, onHand: item.onHand, idle: item.idle, lastOut: item.lastOut ? dateLabel(item.lastOut) : 'Never', valueMrp: round(item.valueMrp), cost: item.valueCost, quotes: d?.quotes || 0, scans: d?.scans || 0, action: item.isSample ? 'Display piece' : asked ? 'Promote (being asked for)' : 'Watch', href: `/dashboard/products?product=${item.id}` }; }).sort((a: any, b: any) => b.valueMrp - a.valueMrp);
    const total = this.stockTotals(stocked, viewer.canCost); const value = rows.reduce((s: number, r: any) => s + r.valueMrp, 0);
    const bands: Array<[string, number, number]> = young ? [['Since opening', 0, 99999]] : [['90–180 days', 90, 180], ['181–365 days', 181, 365], ['Over a year', 366, 99999]];
    const cats = top(groupSum(rows, (r: any) => r.cat, (r: any) => r.valueMrp), 4).map((c) => c.label);
    return {
      notices: young ? [{ level: 'info', text: `Nothing can be called dead yet: tracking started ${history} days ago. Showing items with no stock going out since they arrived. The 90, 180 and 365-day bands fill in over time.` }] : [],
      empty: rows.length ? null : { title: 'No idle stock', body: 'Every stocked item has moved recently.' },
      kpis: [
        { key: 'mrp', label: young ? 'Not moved since opening' : 'Not moved in 90+ days', value: value, format: 'inr', sub: 'at MRP' }, ...(viewer.canCost ? [{ key: 'cost', label: 'At cost', value: rows.reduce((s: number, r: any) => s + n(r.cost), 0), format: 'inr', sub: `Costs entered for ${pct(total.coverage)} of units`, warn: total.missingUnits > 0 }] : []),
        { key: 'n', label: 'Items', value: rows.length, format: 'num', sub: `${units(rows.reduce((s: number, r: any) => s + r.onHand, 0))} units` }, { key: 'share', label: 'Share of stock', value: total.mrp ? value / total.mrp : null, format: 'pct', sub: 'by value at MRP' }, { key: 'asked', label: 'Asked for anyway', value: rows.filter((r: any) => r.quotes + r.scans > 0).length, format: 'num', sub: 'promote these first' },
      ],
      charts: [
        { key: 'bands', type: 'bars', title: 'Value by how long it has sat', sub: 'Stacked by category', kind: 'inr', stacked: true, cats: bands.map((b) => b[0]), series: cats.map((cat, i) => ({ name: cat, color: `c${i + 1}`, data: bands.map(([, min, max]) => round(rows.filter((r: any) => r.cat === cat && (r.idle || 0) >= min && (r.idle || 0) <= max).reduce((s: number, r: any) => s + r.valueMrp, 0))) })) },
        { key: 'brand', type: 'hbar', title: 'By brand', sub: 'Value at MRP not moved', kind: 'inr', rows: top(groupSum(rows, (r: any) => r.brand, (r: any) => r.valueMrp), 10) },
      ],
      table: { title: 'Items not moved', exportName: 'dead-stock', columns: [{ key: 'sku', label: 'Code', mono: true }, { key: 'name', label: 'Product', sub: 'brand' }, { key: 'cat', label: 'Category' }, { key: 'onHand', label: 'On hand', kind: 'num' }, { key: 'idle', label: 'Days idle', kind: 'num' }, { key: 'lastOut', label: 'Last out' }, { key: 'valueMrp', label: 'Value at MRP', kind: 'inr' }, ...(viewer.canCost ? [{ key: 'cost', label: 'At cost', kind: 'inr' }] : []), { key: 'quotes', label: 'Quotes 90d', kind: 'num' }, { key: 'scans', label: 'Scans', kind: 'num' }, { key: 'action', label: 'Suggested' }], rows },
    };
  }

  private async movers(filters: ReportFilters, viewer: Viewer) {
    const { items, stocked } = await this.loadStock(filters, viewer);
    const openLines: any[] = await (this.prisma as any).purchaseOrderLine.findMany({ where: { purchaseOrder: { status: { in: ['ordered', 'sent', 'partial_received'] } } }, select: { productId: true, orderedQuantity: true, receivedQuantity: true, cancelledQuantity: true } });
    const onOrder = new Map<string, number>();
    openLines.forEach((line) => { if (line.productId) onOrder.set(line.productId, (onOrder.get(line.productId) || 0) + Math.max(0, n(line.orderedQuantity) - n(line.receivedQuantity) - n(line.cancelledQuantity))); });
    const shaped = items.filter((item: any) => item.status !== 'Catalogue only').map((item: any) => { const open = onOrder.get(item.id) || 0; return { id: item.id, sku: item.code, name: String(item.name || '').trim() || item.code, brand: item.brand, cat: item.category, status: item.status, available: item.available, out30: item.out30, cover: item.cover, threshold: item.threshold, open, suggest: Math.max(0, Math.ceil(item.avgDay * 30 + item.threshold - item.available - open)), lastOut: item.lastOut ? dateLabel(item.lastOut) : 'None yet', href: `/dashboard/products?product=${item.id}` }; });
    const low = shaped.filter((row: any) => row.status === 'Running low'); const out = shaped.filter((row: any) => row.status === 'Ran out'); const fast = shaped.filter((row: any) => row.out30 > 0).sort((a: any, b: any) => b.out30 - a.out30);
    const sets: Record<string, any[]> = { low, out, fast: top(fast, 100), reorder: shaped.filter((row: any) => row.suggest > 0 && (row.out30 > 0 || row.status !== 'Healthy')).sort((a: any, b: any) => b.suggest - a.suggest) };
    const tab = filters.tab && sets[filters.tab] ? filters.tab : 'low';
    const bands: Array<[string, (c: number | null) => boolean]> = [['Under 7 days', (c) => c != null && c < 7], ['7–14 days', (c) => c != null && c >= 7 && c <= 14], ['15–30 days', (c) => c != null && c > 14 && c <= 30], ['31–60 days', (c) => c != null && c > 30 && c <= 60], ['Over 60 days', (c) => c != null && c > 60], ['No movement', (c) => c == null]];
    const moving = fast.filter((row: any) => row.cover != null);
    const catalogue = items.filter((item: any) => item.status === 'Catalogue only').length;
    return {
      tabs: [{ id: 'low', label: `Running low`, count: low.length }, { id: 'out', label: 'Ran out', count: out.length }, { id: 'fast', label: 'Fast movers', count: fast.length }, { id: 'reorder', label: 'Reorder suggestions', count: sets.reorder.length }], tab,
      notices: fast.length ? [] : [{ level: 'info', text: 'No stock has gone out yet, so speed and days of stock left are not available. Running low uses each item’s own threshold or its category default.' }],
      kpis: [
        { key: 'out', label: 'Units out (30 days)', value: shaped.reduce((s: number, r: any) => s + r.out30, 0), format: 'num', sub: 'issues and dispatches' }, { key: 'low', label: 'Running low', value: low.length, format: 'num', sub: 'below own threshold', warn: low.length > 0 }, { key: 'out2', label: 'Ran out', value: out.length, format: 'num', sub: 'had stock, now 0', warn: out.length > 0 },
        { key: 'cover', label: 'Days of stock left', value: moving.length ? Math.round(moving.reduce((s: number, r: any) => s + r.cover, 0) / moving.length) : null, format: 'num', sub: 'average, moving items' }, { key: 'cat', label: 'Catalogue only', value: catalogue, format: 'num', sub: 'never stocked · no alerts' },
      ],
      charts: [
        { key: 'fast', type: 'hbar', title: 'Fastest movers', sub: 'Units out in 30 days · label shows days of stock left', kind: 'num', rowH: 32, rows: top(fast, 12).map((r: any) => ({ label: r.name, v: r.out30, vl: `${r.out30} · ${r.cover == null ? '—' : `${r.cover} d left`}`, color: r.cover != null && r.cover < 15 ? 'c3' : 'c2' })) },
        { key: 'cover', type: 'bars', title: 'Days of stock left', sub: 'Number of stocked items in each band', kind: 'num', cats: bands.map((b) => b[0]), series: [{ name: 'Items', color: 'c4', data: bands.map(([, test]) => stocked.filter((item: any) => test(item.cover)).length) }] },
      ],
      table: { title: { low: 'Running low', out: 'Ran out', fast: 'Fast movers', reorder: 'Reorder suggestions' }[tab], exportName: `stock-${tab}`, empty: 'Nothing here right now.', columns: [{ key: 'sku', label: 'Code', mono: true }, { key: 'name', label: 'Product', sub: 'brand' }, { key: 'cat', label: 'Category' }, { key: 'status', label: 'Status', kind: 'chip' }, { key: 'available', label: 'Available', kind: 'num' }, { key: 'out30', label: 'Out 30 d', kind: 'num' }, { key: 'cover', label: 'Days left', kind: 'num' }, { key: 'threshold', label: 'Threshold', kind: 'num' }, { key: 'open', label: 'On order', kind: 'num' }, { key: 'suggest', label: 'Suggested order', kind: 'num' }, { key: 'lastOut', label: 'Last out' }], rows: sets[tab] },
    };
  }

  private async openOrders(_filters: ReportFilters, viewer: Viewer) {
    const orders: any[] = await this.prisma.purchaseOrder.findMany({ where: { status: { in: ['ordered', 'sent', 'partial_received', 'draft'] } }, include: { lines: true }, orderBy: { createdAt: 'desc' }, take: 2000 } as any);
    const today = Date.now();
    const rows = orders.filter((po) => po.status !== 'draft').map((po) => {
      const pendingLines = po.lines.map((line: any) => ({ qty: Math.max(0, n(line.orderedQuantity) - n(line.receivedQuantity) - n(line.cancelledQuantity)), cost: n(line.netUnitCost || line.unitCost) }));
      const pending = pendingLines.reduce((s: number, l: any) => s + l.qty, 0); const expected = po.expectedDate ? new Date(po.expectedDate) : null; const late = expected ? Math.floor((today - expected.getTime()) / DAY) : null;
      return { id: po.id, number: po.poNumber, vendor: po.vendorName, on: dateLabel(po.orderedAt || po.createdAt), exp: dateLabel(expected) || 'No date', late: late != null && late > 0 ? late : 0, expected, lines: po.lines.length, oq: po.lines.reduce((s: number, l: any) => s + n(l.orderedQuantity), 0), rq: po.lines.reduce((s: number, l: any) => s + n(l.receivedQuantity), 0), pq: pending, val: viewer.canCost ? round(pendingLines.reduce((s: number, l: any) => s + l.qty * l.cost, 0)) : null, status: late != null && late > 0 ? 'Overdue' : 'Due', href: `/dashboard/procurement?view=orders&search=${encodeURIComponent(po.poNumber)}` };
    }).filter((row) => row.pq > 0).sort((a, b) => b.late - a.late);
    const overdue = rows.filter((row) => row.status === 'Overdue'); const week = rows.filter((row) => row.expected && row.status === 'Due' && row.expected.getTime() <= today + 7 * DAY);
    const sumV = (list: any[]) => list.reduce((s, r) => s + n(r.val), 0); const ordered = rows.reduce((s, r) => s + r.oq, 0); const received = rows.reduce((s, r) => s + r.rq, 0);
    const when: Array<[string, (r: any) => boolean]> = [['Overdue', (r) => r.status === 'Overdue'], ['This week', (r) => r.expected && r.status === 'Due' && r.expected.getTime() <= today + 7 * DAY], ['Next week', (r) => r.expected && r.expected.getTime() > today + 7 * DAY && r.expected.getTime() <= today + 14 * DAY], ['Later', (r) => r.expected && r.expected.getTime() > today + 14 * DAY], ['No date', (r) => !r.expected]];
    return {
      empty: rows.length ? null : { title: 'Nothing is on order', body: 'Raise a purchase order and receive it with a GRN. Pending quantities and overdue vendors appear here, and lot costs fill in from the GRN.', href: '/dashboard/procurement', action: 'Open Procurement' },
      kpis: [
        { key: 'open', label: 'Open orders', value: rows.length, format: 'num', sub: viewer.canCost ? `${inr(sumV(rows))} pending` : `${units(rows.reduce((s, r) => s + r.pq, 0))} units pending` }, { key: 'over', label: 'Overdue', value: overdue.length, format: 'num', sub: viewer.canCost ? inr(sumV(overdue)) : '', warn: overdue.length > 0 },
        { key: 'week', label: 'Due this week', value: week.length, format: 'num', sub: viewer.canCost ? inr(sumV(week)) : '' }, { key: 'recv', label: 'Received so far', value: ordered ? received / ordered : null, format: 'pct', sub: 'of quantity on open orders' },
      ],
      charts: [
        { key: 'vendor', type: 'hbar', title: viewer.canCost ? 'Pending value by vendor' : 'Pending units by vendor', kind: viewer.canCost ? 'inr' : 'num', rowH: 40, rows: top(groupSum(rows, (r) => r.vendor, (r) => (viewer.canCost ? n(r.val) : r.pq)), 10) },
        { key: 'when', type: 'bars', title: 'When it should arrive', sub: viewer.canCost ? 'Pending value' : 'Pending units', kind: viewer.canCost ? 'inr' : 'num', cats: when.map((w) => w[0]), series: [{ name: 'Pending', color: 'c4', data: when.map(([, test]) => rows.filter(test).reduce((s, r) => s + (viewer.canCost ? n(r.val) : r.pq), 0)) }] },
      ],
      table: { title: 'Open purchase orders', exportName: 'open-purchase-orders', columns: [{ key: 'number', label: 'PO', mono: true }, { key: 'vendor', label: 'Vendor' }, { key: 'on', label: 'Ordered on' }, { key: 'exp', label: 'Expected' }, { key: 'late', label: 'Days late', kind: 'num' }, { key: 'lines', label: 'Lines', kind: 'num' }, { key: 'oq', label: 'Ordered', kind: 'num' }, { key: 'rq', label: 'Received', kind: 'num' }, { key: 'pq', label: 'Pending', kind: 'num' }, ...(viewer.canCost ? [{ key: 'val', label: 'Pending ₹', kind: 'inr' }] : []), { key: 'status', label: 'Status', kind: 'chip' }], rows: rows.map(({ expected: _expected, ...row }) => row) },
    };
  }

  private async dataHealth(filters: ReportFilters, viewer: Viewer) {
    const { items, stocked } = await this.loadStock(filters, viewer);
    const [incomplete, waiting, customers]: any[] = await Promise.all([
      this.prisma.quote.findMany({ where: { status: 'incomplete_pricing', supersededByQuoteId: null }, select: { id: true, quoteNumber: true, title: true, customer: { select: { name: true } } }, take: 500 } as any),
      (this.prisma as any).openingStockSession.findMany({ where: { status: { in: ['draft', 'submitted'] } }, select: { id: true, sessionNumber: true, lines: { select: { id: true } } } }),
      this.prisma.customer.findMany({ where: { mobile: '' }, select: { id: true, name: true, city: true }, take: 500 }),
    ]);
    const item = (row: any, missing: string, impact: string, href: string) => ({ id: row.id, sku: row.code, name: String(row.name || '').trim() || '(no name)', brand: row.brand, cat: row.category, onHand: row.onHand, missing, impact, href });
    const noName = items.filter((row: any) => !String(row.name || '').trim()).sort((a: any, b: any) => b.onHand - a.onHand);
    const noPhoto = items.filter((row: any) => !row.photo).sort((a: any, b: any) => b.onHand - a.onHand);
    const dupes = items.filter((row: any) => row.category === 'Faucets & Showers');
    const checks: Array<{ id: string; label: string; count: number; sev: string; note: string; rows: any[]; blocks?: boolean }> = [
      { id: 'no-mrp', label: 'Stocked without MRP', count: stocked.filter((r: any) => r.mrp <= 0).length, sev: 'Blocking', note: 'Left out of stock value', rows: stocked.filter((r: any) => r.mrp <= 0).map((r: any) => item(r, 'MRP', 'Left out of stock value', '/dashboard/master-data/pricing-readiness?tab=missing')) },
      ...(viewer.canCost ? [{ id: 'no-cost', label: 'Items without cost', count: stocked.filter((r: any) => r.missingCost > 0).length, sev: 'Blocking', note: 'Stock at cost is understated', rows: stocked.filter((r: any) => r.missingCost > 0).map((r: any) => item(r, 'Lot cost', `${units(r.missingCost)} units valued at ₹0`, '/dashboard/inventory?stockState=missing_cost')) }] : []),
      { id: 'no-name', label: 'No product name', count: noName.length, sev: 'Warning', note: 'Shows only a code on quotes', rows: noName.slice(0, 2000).map((r: any) => item(r, 'Name', 'Shows only a code', '/dashboard/master-data/products')) },
      { id: 'no-photo', label: 'Missing photo', count: noPhoto.length, sev: 'Warning', note: 'Blank in catalogue and customer pages', rows: noPhoto.slice(0, 2000).map((r: any) => item(r, 'Photo', 'Blank in catalogue', String(r.category).toLowerCase() === 'tiles' ? '/dashboard/master-data/tiles' : '/dashboard/master-data/products')) },
      { id: 'dup-category', label: 'Duplicate category', count: dupes.length, sev: 'Warning', note: '“Faucets & Showers” and “Faucets” are counted separately', rows: dupes.map((r: any) => item(r, 'Category merge', 'Totals split in two', '/dashboard/master-data/products')) },
      { id: 'incomplete-quotes', label: 'Quotes with incomplete pricing', count: incomplete.length, sev: 'Warning', note: 'Left out of sales totals', rows: incomplete.map((q: any) => ({ id: q.id, sku: q.quoteNumber, name: q.customer?.name || q.title, brand: '', cat: '', onHand: null, missing: 'Pricing', impact: 'Left out of totals', href: `/dashboard/quotes/${q.id}` })) },
      { id: 'opening-waiting', label: 'Opening stock awaiting approval', count: waiting.length, sev: 'Info', note: 'Not yet in stock', rows: waiting.map((s: any) => ({ id: s.id, sku: s.sessionNumber, name: `${s.lines.length} items`, brand: '', cat: '', onHand: null, missing: 'Owner approval', impact: 'Not yet in stock', href: '/dashboard/inventory/opening-stock' })) },
      { id: 'no-mobile', label: 'Customers without mobile', count: customers.length, sev: 'Info', note: 'Cannot be matched to walk-ins', rows: customers.map((c: any) => ({ id: c.id, sku: '', name: c.name, brand: c.city, cat: '', onHand: null, missing: 'Mobile', impact: 'Cannot match walk-ins', href: '/dashboard/customers' })) },
    ];
    const tab = filters.tab && checks.some((c) => c.id === filters.tab) ? filters.tab : checks[0].id;
    const current = checks.find((c) => c.id === tab)!;
    const complete = stocked.length ? stocked.filter((r: any) => r.mrp > 0 && String(r.name || '').trim() && r.photo).length / stocked.length : null;
    return {
      tabs: checks.map((c) => ({ id: c.id, label: c.label, count: c.count })), tab, tabNote: { severity: current.sev, text: current.note },
      kpis: [
        { key: 'block', label: 'Blocking', value: checks.filter((c) => c.sev === 'Blocking' && c.count).length, format: 'num', sub: 'checks that change report numbers', warn: true }, { key: 'warn', label: 'Warnings', value: checks.filter((c) => c.sev === 'Warning' && c.count).length, format: 'num', sub: 'checks that affect presentation' },
        { key: 'complete', label: 'Stocked items complete', value: complete, format: 'pct', sub: 'MRP, name and photo' },
      ],
      charts: [{ key: 'issues', type: 'hbar', span: 'full', title: 'Open issues by check', sub: 'Records affected', kind: 'num', rowH: 34, rows: checks.map((c) => ({ label: c.label, v: c.count, color: c.sev === 'Blocking' ? 'c5' : c.sev === 'Warning' ? 'c3' : 'c4' })), legend: [{ name: 'Blocking', color: 'c5' }, { name: 'Warning', color: 'c3' }, { name: 'Info', color: 'c4' }] }],
      table: { title: current.label, exportName: `fix-list-${current.id}`, empty: 'Nothing to fix here.', columns: [{ key: 'sku', label: 'Code', mono: true }, { key: 'name', label: 'Name' }, { key: 'brand', label: 'Brand' }, { key: 'cat', label: 'Category' }, { key: 'onHand', label: 'On hand', kind: 'num' }, { key: 'missing', label: 'What is missing' }, { key: 'impact', label: 'Impact' }], rows: current.rows },
    };
  }

  // ---- Dashboard ----
  async dashboard(filters: ReportFilters, viewer: Viewer) {
    const range = this.range(filters);
    const today = istDay(new Date());
    const [quotes, previous, stock, visits, prevVisits, demand, waiting, orders, invoices, payments, leads, prevLeads, followUps, openPo, recentGrn, lastOpening]: any[] = await Promise.all([
      this.loadQuotes(range.from, range.to, {}, viewer), this.loadQuotes(range.prevFrom, range.prevTo, {}, viewer), this.loadStock({}, viewer), this.loadVisits(range.from, range.to), (this.prisma as any).showroomVisit.count({ where: { createdAt: { gte: range.prevFrom, lt: range.prevTo } } }), this.demandRows(range, {}, viewer),
      (this.prisma as any).openingStockSession.count({ where: { status: 'submitted' } }),
      this.prisma.salesOrder.aggregate({ where: { createdAt: { gte: range.from, lt: range.to }, status: { not: 'cancelled' } }, _sum: { totalAmount: true }, _count: { _all: true } } as any),
      this.prisma.salesInvoice.aggregate({ where: { issueDate: { gte: range.from, lt: range.to }, voidedAt: null }, _sum: { totalAmount: true }, _count: { _all: true } } as any),
      this.prisma.customerPayment.aggregate({ where: { receivedAt: { gte: range.from, lt: range.to }, voidedAt: null }, _sum: { amount: true }, _count: { _all: true } } as any),
      this.prisma.lead.count({ where: { createdAt: { gte: range.from, lt: range.to } } }), this.prisma.lead.count({ where: { createdAt: { gte: range.prevFrom, lt: range.prevTo } } }),
      this.prisma.lead.count({ where: { nextActionAt: { lt: new Date(Date.now() + DAY) }, stage: { notIn: ['won', 'lost', 'closed'] } } }),
      (this.prisma as any).purchaseOrderLine.findMany({ where: { purchaseOrder: { status: { in: ['ordered', 'sent', 'partial_received'] } } }, select: { orderedQuantity: true, receivedQuantity: true, cancelledQuantity: true, netUnitCost: true, unitCost: true, purchaseOrder: { select: { id: true, expectedDate: true } } } }),
      (this.prisma as any).goodsReceiptNote.findFirst({ orderBy: { createdAt: 'desc' }, select: { grnNumber: true, createdAt: true } }).catch(() => null),
      (this.prisma as any).openingStockSession.findFirst({ where: { status: 'posted' }, orderBy: { postedAt: 'desc' }, select: { sessionNumber: true, postedAt: true } }),
    ]);
    const a = this.salesAgg(quotes); const p = this.salesAgg(previous); const t = this.stockTotals(stock.stocked, viewer.canCost);
    const walkToday = visits.filter((visit: any) => istDay(new Date(visit.createdAt)) === today).length;
    const open = visits.filter((visit: any) => visit.outcome === 'Open').length; const gotQuote = visits.filter((visit: any) => ['Quoted', 'Confirmed'].includes(visit.outcome)).length; const walkConfirmed = visits.filter((visit: any) => visit.outcome === 'Confirmed').length;
    const ranOut = stock.items.filter((item: any) => item.status === 'Ran out').length; const low = stock.items.filter((item: any) => item.status === 'Running low').length; const healthy = stock.items.filter((item: any) => item.status === 'Healthy').length; const catalogue = stock.items.filter((item: any) => item.status === 'Catalogue only').length;
    const noMrp = t.noMrpItems;
    const pendingPo = openPo.reduce((s: number, l: any) => s + Math.max(0, n(l.orderedQuantity) - n(l.receivedQuantity) - n(l.cancelledQuantity)) * n(l.netUnitCost || l.unitCost), 0);
    const overduePo = new Set(openPo.filter((l: any) => l.purchaseOrder.expectedDate && new Date(l.purchaseOrder.expectedDate).getTime() < Date.now()).map((l: any) => l.purchaseOrder.id)).size;
    const po = new Set(openPo.map((l: any) => l.purchaseOrder.id)).size;
    const owners = Array.from(new Map(quotes.map((q: any) => [q.ownerId, q.owner])).entries()).map(([id, name]: any) => { const mine = this.salesAgg(quotes.filter((q: any) => q.ownerId === id)); return { name, conf: mine.conf, sent: mine.sent, conv: mine.conv, disc: mine.disc }; }).sort((x: any, y: any) => y.conf - x.conf || y.sent - x.sent);
    const archRows = groupSum(quotes.filter((q: any) => q.arch && this.isSent(q)), (q: any) => q.arch, (q: any) => q.taxable);
    const statusMix = [['Draft', quotes.filter((q: any) => q.status === 'draft').length, 'c6'], ['Sent', quotes.filter((q: any) => this.isSent(q) && !this.isConfirmed(q)).length, 'c4'], ['Confirmed', a.confN, 'c1'], ['Needs pricing', a.incomplete, 'c3']].filter(([, v]) => Number(v) > 0).map(([label, v, color]) => ({ label, v, color }));
    const lotAges = stock.stocked.flatMap((item: any) => item.lots.filter((lot: any) => lot.qty > 0).map((lot: any) => ({ age: Math.floor((Date.now() - new Date(lot.receivedAt).getTime()) / DAY), mrp: lot.qty * item.mrp })));
    const ageBands: Array<[string, number, number]> = [['0–30 d', 0, 30], ['31–90 d', 31, 90], ['91–180 d', 91, 180], ['181+ d', 181, 99999]];
    const topItems = top([...stock.stocked].sort((x: any, y: any) => y.valueMrp - x.valueMrp), 8);
    const R = '/dashboard/reports';
    return {
      asOf: new Date().toISOString(), dataSince: DATA_SINCE, periodLabel: range.label,
      needs: [
        { n: waiting, t: `opening stock session${waiting === 1 ? '' : 's'} to approve`, tone: 'brand', i: 'check', href: '/dashboard/inventory/opening-stock' }, { n: open, t: `walk-in${open === 1 ? '' : 's'} waiting for someone`, tone: 'warn', i: 'door', href: '/dashboard/walk-ins' },
        { n: a.expiring, t: `quote${a.expiring === 1 ? '' : 's'} expire within 7 days`, tone: 'warn', i: 'clock', href: `${R}/sales-quotes` }, { n: followUps, t: `lead follow-up${followUps === 1 ? '' : 's'} due`, tone: 'warn', i: 'phone', href: '/dashboard/leads' }, { n: ranOut, t: `item${ranOut === 1 ? '' : 's'} ran out (had stock, now 0)`, tone: 'bad', i: 'box', href: `${R}/movers?tab=out` },
        { n: overduePo, t: `purchase order${overduePo === 1 ? '' : 's'} overdue`, tone: 'bad', i: 'truck', href: `${R}/open-orders` }, { n: noMrp, t: `stocked item${noMrp === 1 ? '' : 's'} missing MRP`, tone: 'mute', i: 'heart', href: `${R}/data-health` },
      ].filter((item) => item.n > 0),
      kpis: [
        { key: 'quoted', label: `Quoted ${range.label}`, value: a.sent, format: 'inr', sub: `${a.sentN} quotes`, delta: delta(a.sent, p.sent), href: `${R}/sales-quotes` }, { key: 'conf', label: 'Confirmed quotes', value: a.conf, format: 'inr', sub: `${a.confN} of ${a.sentN} sent · ${pct(a.conv)} converted`, delta: delta(a.conf, p.conf), href: `${R}/sales-quotes` },
        { key: 'mrp', label: 'Stock at MRP', value: t.mrp, format: 'inr', sub: `${units(t.skus)} items · ${units(t.units)} units`, href: `${R}/stock-value` }, ...(viewer.canCost ? [{ key: 'cost', label: 'Stock at cost', value: t.cost, format: 'inr', sub: `Costs entered for ${pct(t.coverage)}${t.missingItems ? ` · ${units(t.missingItems)} items missing` : ''}`, warn: t.missingUnits > 0, href: '/dashboard/inventory?stockState=missing_cost' }] : []),
        { key: 'walk', label: 'Walk-ins today', value: walkToday, format: 'num', sub: `${visits.length} ${range.label} · ${open} waiting`, href: `${R}/walk-ins` }, { key: 'disc', label: 'Discount given', value: a.given, format: 'inr', sub: `average ${pct(a.disc, 1)} below MRP`, href: `${R}/salespeople` },
      ],
      moreKpis: [
        { key: 'orders', label: 'Orders booked', value: n(orders._sum?.totalAmount), format: 'inr', sub: `${orders._count?._all || 0} orders`, href: `${R}/orders-invoices` }, { key: 'inv', label: 'Invoiced', value: n(invoices._sum?.totalAmount), format: 'inr', sub: `${invoices._count?._all || 0} invoices`, href: `${R}/orders-invoices` }, { key: 'paid', label: 'Payments received', value: n(payments._sum?.amount), format: 'inr', sub: `${payments._count?._all || 0} receipts`, href: `${R}/orders-invoices` },
        { key: 'avg', label: 'Average quote', value: a.avg, format: 'inr', sub: 'per quote sent', href: `${R}/sales-quotes` }, { key: 'drafts', label: 'Quotes in draft', value: a.drafts, format: 'num', sub: `${a.incomplete} need pricing`, href: '/dashboard/quotes' }, { key: 'leads', label: 'New leads', value: leads, format: 'num', sub: `${followUps} follow-ups due`, delta: delta(leads, prevLeads), href: '/dashboard/leads' },
        { key: 'low', label: 'Running low', value: low, format: 'num', sub: 'below own threshold', warn: low > 0, href: `${R}/movers?tab=low` }, { key: 'ran', label: 'Ran out', value: ranOut, format: 'num', sub: 'had stock, now 0', warn: ranOut > 0, href: `${R}/movers?tab=out` }, ...(viewer.canCost ? [{ key: 'po', label: 'On order', value: pendingPo, format: 'inr', sub: `${po} open purchase orders`, href: `${R}/open-orders` }] : []), { key: 'gap', label: 'Asked, not stocked', value: demand.filter((row: any) => row.available <= 0).length, format: 'num', sub: `products ${range.label}`, href: `${R}/demand-gap` },
        { key: 'walkc', label: 'Walk-ins to quote', value: visits.length ? gotQuote / visits.length : null, format: 'pct', sub: `${gotQuote} of ${visits.length} visitors`, delta: delta(visits.length, prevVisits), href: `${R}/walk-ins` }, { key: 'arch', label: 'Architects active', value: archRows.length, format: 'num', sub: `${archRows.length ? inr(archRows.reduce((s, r) => s + r.v, 0)) : '₹0'} quoted`, href: `${R}/architects` },
      ],
      charts: [
        { ...this.trendChart(quotes, range, 'Quotes, day by day'), sub: 'Quoted and confirmed before GST · line shows confirmed out of sent' },
        { key: 'cat', type: 'hbar', title: 'Stock by category', sub: 'Value at MRP', kind: 'inr', rows: top(groupSum(stock.stocked, (i: any) => i.category, (i: any) => i.valueMrp), 7) },
        { key: 'brand', type: 'donut', title: 'Stock by brand', sub: 'Share of value at MRP', slices: (() => { const rows = groupSum(stock.stocked, (i: any) => i.brand, (i: any) => i.valueMrp); return [...top(rows, 5), { label: 'Others', v: rows.slice(5).reduce((s, r) => s + r.v, 0) }].filter((s) => s.v > 0); })(), center: [inr(t.mrp), 'at MRP'], href: `${R}/stock-value?tab=brand` },
        { key: 'health', type: 'donut', title: 'Stock health', sub: 'Items that have been stocked', kind: 'num', slices: [{ label: 'Healthy', v: healthy, color: 'c2' }, { label: 'Running low', v: low, color: 'c3' }, { label: 'Ran out', v: ranOut, color: 'c5' }].filter((s) => s.v > 0), center: [units(healthy + low + ranOut), 'items'], foot: `${units(catalogue)} catalogue-only products are not counted`, href: `${R}/movers` },
        { key: 'status', type: 'donut', title: 'Quotes by status', sub: `Quotes ${range.label}`, kind: 'num', slices: statusMix, center: [units(quotes.length), 'quotes'], href: `${R}/sales-quotes` },
        { key: 'funnel', type: 'hbar', title: 'Walk-in funnel', sub: `Visitors ${range.label}`, kind: 'num', rowH: 44, rows: [{ label: 'Walked in', v: visits.length, color: 'c4' }, { label: 'Got a quote', v: gotQuote, color: 'c3' }, { label: 'Confirmed', v: walkConfirmed, color: 'c1' }], href: `${R}/walk-ins` },
        { key: 'age', type: 'bars', title: 'Stock age', sub: 'Value at MRP by age of lot', kind: 'inr', cats: ageBands.map((b) => b[0]), series: [{ name: 'At MRP', color: 'c1', data: ageBands.map(([, min, max]) => round(lotAges.filter((l: any) => l.age >= min && l.age <= max).reduce((s: number, l: any) => s + l.mrp, 0))) }], href: `${R}/stock-value?tab=age` },
        { key: 'arch', type: 'hbar', title: 'Top architects', sub: 'Quoted value', kind: 'inr', rows: top(archRows, 6), href: `${R}/architects` },
        { key: 'items', type: 'hbar', title: 'Most valuable stock', sub: 'Value at MRP', kind: 'inr', rowH: 30, rows: topItems.map((item: any) => ({ label: String(item.name || '').trim() || item.code, v: item.valueMrp })), href: `${R}/stock-value?tab=top` },
      ],
      leaderboard: owners.slice(0, 6),
      demand: top(demand, 7).map((row: any) => ({ label: row.name, v: row.score, status: row.status })),
      notices: this.costNotice(t),
      footer: { lastGrn: recentGrn ? `${recentGrn.grnNumber}, ${dateLabel(recentGrn.createdAt)}` : '', lastOpening: lastOpening ? `${lastOpening.sessionNumber}, ${dateLabel(lastOpening.postedAt)}` : '', openPo: po },
    };
  }

  async exportFile(kind: string, filters: ReportFilters, viewer: Viewer) {
    const report = await this.report(kind, filters, viewer);
    if (!report.table) throw new BadRequestException('This view has no list to download');
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Marble Park';
    const sheet = workbook.addWorksheet('Report', { views: [{ state: 'frozen', ySplit: 1 }] });
    const columns: any[] = report.table.columns.flatMap((column: any) => (column.sub ? [column, { key: column.sub, label: column.sub === 'brand' ? 'Brand' : column.sub === 'date' ? 'Date' : column.sub === 'arch' ? 'Architect' : column.sub === 'firm' ? 'Firm' : column.sub === 'mobile' ? 'Mobile' : column.sub }] : [column]));
    sheet.addRow(columns.map((column) => column.label));
    sheet.getRow(1).eachCell((cell: any) => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7F2925' } }; });
    report.table.rows.forEach((row: any) => sheet.addRow(columns.map((column) => row[column.key] ?? '')));
    columns.forEach((column, index) => {
      const col = sheet.getColumn(index + 1);
      col.width = Math.max(12, Math.min(44, String(column.label).length + 6, ...[String(report.table.rows[0]?.[column.key] ?? '').length + 4].map((x) => Math.max(x, 12))));
      if (column.kind === 'inr') col.numFmt = '#,##,##0.00';
      if (column.kind === 'pct') col.numFmt = '0.0%';
    });
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
    const info = workbook.addWorksheet('About');
    info.addRows([['Report', report.table.title], ['As of', new Date(report.asOf).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })], ['Rows', report.table.rows.length], ['Filters', JSON.stringify(filters)]]);
    const buffer = await workbook.xlsx.writeBuffer();
    return { filename: `marble-park-${report.table.exportName}-${istDay(new Date())}.xlsx`, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', contentBase64: Buffer.from(buffer).toString('base64'), rows: report.table.rows.length };
  }
}
