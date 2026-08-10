import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ulid } from 'ulid';
import type { SessionUser } from '../auth/session-context';
import { PrismaService } from '../prisma/prisma.service';
import { REPORT_CATALOG, findReportDefinition, type ReportDefinition } from './reporting.catalog';
import { REPORT_TIMEZONE, ageDays, indiaDay, reportRange } from './reporting-time';

type ReportArgs = {
  reportId: string;
  from?: string;
  to?: string;
  search?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDirection?: string;
  filters?: Record<string, unknown>;
};

const n = (value: unknown) => Number(value || 0);
const sum = (rows: any[], field: string) => rows.reduce((total, row) => total + n(row[field]), 0);
const round = (value: number, places = 2) => Number(value.toFixed(places));
const delta = (current: number, prior: number) => prior === 0 ? null : round(((current - prior) / Math.abs(prior)) * 100, 1);
const currency = (value: number) => round(value, 2);

@Injectable()
export class ReportingService {
  constructor(private prisma: PrismaService) {}

  catalog(user: SessionUser) {
    return REPORT_CATALOG.filter((item) => this.canAccess(user, item)).map((item) => this.publicDefinition(item));
  }

  async filterOptions(user: SessionUser) {
    const [owners, locations, categories, vendors] = await Promise.all([
      user.role === 'sales'
        ? this.prisma.user.findMany({ where: { id: user.id }, select: { id: true, name: true } })
        : this.prisma.user.findMany({ where: { active: true, role: { in: ['sales', 'sales_manager', 'owner'] } }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      (this.prisma as any).stockLocation.findMany({ where: { status: 'active' }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { id: true, name: true, code: true } }),
      (this.prisma as any).productCategory.findMany({ where: { status: 'active' }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { id: true, name: true } }),
      (this.prisma as any).vendor.findMany({ where: { status: 'active' }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    ]);
    return { owners, locations, categories, vendors };
  }

  presets(user: SessionUser, reportId?: string) {
    return (this.prisma as any).reportPreset.findMany({
      where: {
        ...(reportId ? { reportId } : {}),
        OR: [{ ownerId: user.id }, { sharedRole: user.role }],
      },
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
      take: 100,
    });
  }

  async savePreset(user: SessionUser, input: any) {
    const reportId = String(input?.reportId || '').trim();
    const definition = findReportDefinition(reportId);
    if (!definition || !this.canAccess(user, definition)) throw new ForbiddenException('This report is not available to your role');
    const name = String(input?.name || '').trim().slice(0, 80);
    if (!name) throw new BadRequestException('Preset name is required');
    const config = this.sanitizePresetConfig(input?.config);
    const sharedRole = input?.sharedRole && ['admin', 'owner'].includes(user.role) ? String(input.sharedRole).slice(0, 40) : null;
    const existing = input?.id ? await (this.prisma as any).reportPreset.findUnique({ where: { id: String(input.id) } }) : null;
    if (existing && existing.ownerId !== user.id) throw new ForbiddenException('Only the preset owner can update it');
    const row = existing
      ? await (this.prisma as any).reportPreset.update({ where: { id: existing.id }, data: { name, config, sharedRole, isDefault: Boolean(input?.isDefault) } })
      : await (this.prisma as any).reportPreset.create({ data: { id: ulid(), ownerId: user.id, reportId, name, config, sharedRole, isDefault: Boolean(input?.isDefault), schemaVersion: 1 } });
    await this.prisma.auditEvent.create({ data: { id: ulid(), actorUserId: user.id, action: existing ? 'report_preset.update' : 'report_preset.create', entityType: 'ReportPreset', entityId: row.id, summary: `${existing ? 'Updated' : 'Created'} reporting preset ${name}`, metadata: { reportId, sharedRole } } }).catch(() => null);
    return row;
  }

  async deletePreset(user: SessionUser, id: string) {
    const existing = await (this.prisma as any).reportPreset.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Report preset not found');
    if (existing.ownerId !== user.id) throw new ForbiddenException('Only the preset owner can remove it');
    await (this.prisma as any).reportPreset.delete({ where: { id } });
    await this.prisma.auditEvent.create({ data: { id: ulid(), actorUserId: user.id, action: 'report_preset.delete', entityType: 'ReportPreset', entityId: id, summary: `Removed personal reporting preset ${existing.name}`, metadata: { reportId: existing.reportId } } }).catch(() => null);
    return true;
  }

  async report(user: SessionUser, raw: ReportArgs, pageSizeLimit = 200) {
    const args = this.normalizeArgs(raw, pageSizeLimit);
    const definition = findReportDefinition(args.reportId);
    if (!definition) throw new NotFoundException('Report not found');
    if (!this.canAccess(user, definition)) throw new ForbiddenException('This report is not available to your role');
    const range = reportRange(args.from, args.to);
    if (range.durationDays > 366) throw new BadRequestException('Interactive reports are limited to 366 days; use an export for a longer period');
    if (definition.readiness === 'needs_setup') return this.unavailable(definition, range);
    const base = { args, definition, range, user };
    switch (definition.bookId) {
      case 'owner.pulse': return this.ownerPulse(base);
      case 'sales.product': return this.salesProduct(base);
      case 'inventory.stock': return this.inventoryStock(base);
      case 'procurement.vendor': return this.procurementVendor(base);
      case 'finance.receivables': return this.financeReceivables(base);
      case 'fulfilment.pipeline': return this.fulfilmentPipeline(base);
      case 'audit.quality': return this.auditQuality(base);
      default: return this.unavailable(definition, range, 'No governed report book is registered');
    }
  }

  async exportCsv(user: SessionUser, raw: ReportArgs) {
    if (!user.effectivePermissions.includes('reports.export') && !['admin', 'owner'].includes(user.role)) throw new ForbiddenException('Reporting export permission is required');
    const response: any = await this.report(user, { ...raw, page: 1, pageSize: 5000 }, 5000);
    if (!response.rows?.items?.length) throw new BadRequestException(response.unavailable?.message || 'There are no eligible rows to export');
    const columns = response.rows.columns || Object.keys(response.rows.items[0]);
    const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = [columns.map((column: any) => escape(column.label || column.key)).join(','), ...response.rows.items.map((row: any) => columns.map((column: any) => escape(row[column.key])).join(','))].join('\r\n');
    const filename = `${response.meta.id.replace(/[^a-z0-9.-]/gi, '-')}-${response.range.from}-${response.range.to}.csv`;
    await this.prisma.auditEvent.create({ data: { id: ulid(), actorUserId: user.id, action: 'report.export', entityType: 'Report', entityId: response.meta.id, summary: `Exported ${response.meta.title}`, metadata: { filename, rowCount: response.rows.items.length, filters: response.filters } } }).catch(() => null);
    return { filename, mimeType: 'text/csv;charset=utf-8', content: csv, rowCount: response.rows.items.length, truncated: response.rows.total > response.rows.items.length };
  }

  private normalizeArgs(raw: ReportArgs, pageSizeLimit = 200): Required<Omit<ReportArgs, 'filters'>> & { filters: Record<string, string> } {
    const filters: Record<string, string> = {};
    const allowed = new Set(['locationId', 'ownerId', 'customerId', 'category', 'brand', 'status', 'vendorId']);
    for (const [key, value] of Object.entries(raw.filters || {})) if (allowed.has(key) && value != null && String(value).trim()) filters[key] = String(value).trim().slice(0, 160);
    const page = Math.max(1, Math.floor(n(raw.page) || 1));
    const pageSize = Math.min(pageSizeLimit, Math.max(10, Math.floor(n(raw.pageSize) || 50)));
    const sortDirection = String(raw.sortDirection || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
    return { reportId: String(raw.reportId || '').trim(), from: raw.from || '', to: raw.to || '', search: String(raw.search || '').trim().slice(0, 120), page, pageSize, sortBy: String(raw.sortBy || '').trim().slice(0, 60), sortDirection, filters };
  }

  private canAccess(user: SessionUser, definition: ReportDefinition) {
    return ['admin', 'owner'].includes(user.role) || user.effectivePermissions.includes(definition.permission);
  }

  private publicDefinition(definition: ReportDefinition) {
    return { ...definition, metricVersion: '2026.08.1', timezone: REPORT_TIMEZONE, drillSupported: definition.readiness !== 'needs_setup', exportSupported: definition.readiness !== 'needs_setup' };
  }

  private unavailable(definition: ReportDefinition, range: any, reason?: string) {
    return {
      meta: this.meta(definition, { coverage: 0, warning: reason || 'The required governed source is not captured in Marble Park yet' }),
      range: range.labels,
      filters: {},
      summary: [], trend: [], breakdowns: [],
      rows: { items: [], total: 0, page: 1, pageSize: 50, columns: [] },
      unavailable: { code: 'NEEDS_SETUP', message: reason || definition.description, requiredSources: definition.sources },
    };
  }

  private meta(definition: ReportDefinition, extra: any = {}) {
    return { ...this.publicDefinition(definition), generatedAt: new Date().toISOString(), freshness: 'Generated on request', ...extra };
  }

  private summary(id: string, label: string, current: number, prior: number | null, format: string, definition: string, readiness: string = 'available') {
    return { id, label, current: currency(current), prior: prior == null ? null : currency(prior), variance: prior == null ? null : currency(current - prior), variancePercent: prior == null ? null : delta(current, prior), format, definition, readiness };
  }

  private paginate(items: any[], args: any, columns: any[], allowedSort: string[]) {
    const query = args.search.toLowerCase();
    let rows = query ? items.filter((row) => Object.values(row).some((value) => String(value ?? '').toLowerCase().includes(query))) : items;
    const sortBy = allowedSort.includes(args.sortBy) ? args.sortBy : allowedSort[0];
    rows = rows.sort((a, b) => {
      const av = a[sortBy]; const bv = b[sortBy];
      const comparison = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av ?? '').localeCompare(String(bv ?? ''));
      return args.sortDirection === 'asc' ? comparison : -comparison;
    });
    const total = rows.length;
    const start = (args.page - 1) * args.pageSize;
    return { items: rows.slice(start, start + args.pageSize), total, page: args.page, pageSize: args.pageSize, pageCount: Math.max(1, Math.ceil(total / args.pageSize)), sortBy, sortDirection: args.sortDirection, columns };
  }

  private sanitizePresetConfig(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const raw = value as Record<string, unknown>;
    const config: Record<string, unknown> = {};
    for (const key of ['datePreset', 'compare', 'breakdown', 'sortBy', 'sortDirection']) if (typeof raw[key] === 'string') config[key] = String(raw[key]).slice(0, 80);
    for (const key of ['columns', 'metrics']) if (Array.isArray(raw[key])) config[key] = raw[key].map((item) => String(item).slice(0, 60)).slice(0, 30);
    if (raw.filters && typeof raw.filters === 'object' && !Array.isArray(raw.filters)) config.filters = this.normalizeArgs({ reportId: 'preset', filters: raw.filters as any }).filters;
    if (raw.pageSize != null) config.pageSize = Math.min(200, Math.max(10, Math.floor(n(raw.pageSize) || 50)));
    return config;
  }

  private async ownerPulse({ args, definition, range }: any) {
    const current = { gte: range.from, lte: range.to };
    const prior = { gte: range.priorFrom, lte: range.priorTo };
    const [invoices, priorInvoices, payments, priorPayments, credits, priorCredits, orders, priorOrders, lotBalances, purchaseOrders, purchaseLines, challans] = await Promise.all([
      (this.prisma as any).salesInvoice.findMany({ where: { issueDate: current, status: { not: 'void' } }, orderBy: { issueDate: 'asc' }, select: { id: true, invoiceNumber: true, customerId: true, salesOrderId: true, issueDate: true, dueDate: true, totalAmount: true, openAmount: true, status: true } }),
      (this.prisma as any).salesInvoice.findMany({ where: { issueDate: prior, status: { not: 'void' } }, select: { totalAmount: true } }),
      (this.prisma as any).customerPayment.findMany({ where: { receivedAt: current, status: 'posted' }, select: { amount: true, receivedAt: true } }),
      (this.prisma as any).customerPayment.findMany({ where: { receivedAt: prior, status: 'posted' }, select: { amount: true } }),
      (this.prisma as any).creditNote.findMany({ where: { issuedAt: current, status: 'issued' }, select: { amount: true, issuedAt: true } }),
      (this.prisma as any).creditNote.findMany({ where: { issuedAt: prior, status: 'issued' }, select: { amount: true } }),
      this.prisma.salesOrder.findMany({ where: { createdAt: current, status: { not: 'cancelled' } }, select: { id: true, totalAmount: true, createdAt: true } }),
      this.prisma.salesOrder.findMany({ where: { createdAt: prior, status: { not: 'cancelled' } }, select: { totalAmount: true } }),
      (this.prisma as any).inventoryLotBalance.findMany({ include: { lot: { include: { product: true } }, location: true } }),
      (this.prisma as any).purchaseOrder.findMany({ where: { status: { in: ['draft', 'ordered', 'partial_received'] } }, select: { id: true } }),
      (this.prisma as any).purchaseOrderLine.findMany({ where: { status: { not: 'cancelled' } } }),
      this.prisma.dispatchChallan.findMany({ where: { createdAt: current }, select: { id: true, challanNumber: true, status: true, createdAt: true } }),
    ]);
    const sales = sum(invoices, 'totalAmount'); const priorSales = sum(priorInvoices, 'totalAmount');
    const credit = sum(credits, 'amount'); const priorCredit = sum(priorCredits, 'amount');
    const collections = sum(payments, 'amount'); const priorCollections = sum(priorPayments, 'amount');
    const bookings = sum(orders, 'totalAmount'); const priorBookings = sum(priorOrders, 'totalAmount');
    const stockValue = lotBalances.reduce((t: number, row: any) => t + n(row.onHand) * n(row.lot?.unitCost), 0);
    const costedValue = lotBalances.filter((row: any) => n(row.lot?.unitCost) > 0).reduce((t: number, row: any) => t + n(row.onHand) * n(row.lot?.unitCost), 0);
    const openPoIds = new Set(purchaseOrders.map((row: any) => row.id));
    const poCommitment = purchaseLines.filter((row: any) => openPoIds.has(row.purchaseOrderId)).reduce((t: number, row: any) => t + Math.max(0, n(row.orderedQuantity) - n(row.receivedQuantity) - n(row.cancelledQuantity)) * n(row.unitCost), 0);
    const trend = new Map<string, any>();
    const bucket = (date: Date) => { const key = indiaDay(date); if (!trend.has(key)) trend.set(key, { date: key, netSales: 0, collections: 0, credits: 0, bookings: 0 }); return trend.get(key); };
    invoices.forEach((row: any) => bucket(row.issueDate).netSales += n(row.totalAmount)); credits.forEach((row: any) => { const b = bucket(row.issuedAt); b.credits += n(row.amount); b.netSales -= n(row.amount); }); payments.forEach((row: any) => bucket(row.receivedAt).collections += n(row.amount)); orders.forEach((row: any) => bucket(row.createdAt).bookings += n(row.totalAmount));
    const productIds = Array.from(new Set(lotBalances.map((row: any) => row.lot?.productId).filter(Boolean)));
    const stockMix = new Map<string, any>(); lotBalances.forEach((row: any) => { const label = row.lot?.product?.category || 'Uncategorised'; const item = stockMix.get(label) || { label, value: 0, quantity: 0 }; item.value += n(row.onHand) * n(row.lot?.unitCost); item.quantity += n(row.onHand); stockMix.set(label, item); });
    const customerIds = Array.from(new Set<string>(invoices.map((row: any) => String(row.customerId))));
    const customers = customerIds.length ? await this.prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true } }) : [];
    const customerMap = new Map(customers.map((row: any) => [row.id, row.name]));
    const rowItems = invoices.map((row: any) => ({ document: row.invoiceNumber, customer: customerMap.get(row.customerId) || row.customerId, issueDate: indiaDay(row.issueDate), dueDate: row.dueDate ? indiaDay(row.dueDate) : '', total: currency(n(row.totalAmount)), open: currency(n(row.openAmount)), status: row.status, href: `/dashboard/payments?invoice=${row.id}` }));
    return {
      meta: this.meta(definition, { coverage: stockValue ? round((costedValue / stockValue) * 100, 1) : 100, coverageLabel: 'Inventory value with positive lot cost', warnings: productIds.length ? [] : ['No costed inventory lots are currently available'] }),
      range: range.labels, filters: args.filters,
      summary: [
        this.summary('net_sales', 'Net invoiced sales', sales - credit, priorSales - priorCredit, 'currency', 'Posted invoice total less issued credit notes in the selected period.'),
        this.summary('collections', 'Collections', collections, priorCollections, 'currency', 'Posted customer payments received in the selected period.'),
        this.summary('bookings', 'Order bookings', bookings, priorBookings, 'currency', 'Non-cancelled sales orders created in period; this is not revenue.'),
        this.summary('stock_value', 'Stock at lot cost', stockValue, null, 'currency', 'Current lot on-hand quantity multiplied by lot unit cost; no historical snapshot is implied.'),
        this.summary('po_commitment', 'Open PO commitment', poCommitment, null, 'currency', 'Remaining open PO quantity multiplied by line unit cost; this is not accounts payable.'),
      ],
      trend: Array.from(trend.values()).sort((a, b) => a.date.localeCompare(b.date)),
      breakdowns: [{ id: 'stock_category', title: 'Stock value by category', kind: 'composition', rows: Array.from(stockMix.values()).sort((a: any, b: any) => b.value - a.value) }, { id: 'fulfilment', title: 'Dispatch status', kind: 'ranking', rows: Object.entries(challans.reduce((acc: any, row: any) => { acc[row.status] = (acc[row.status] || 0) + 1; return acc; }, {})).map(([label, value]) => ({ label, value })) }],
      rows: this.paginate(rowItems, args, [{ key: 'document', label: 'Invoice' }, { key: 'customer', label: 'Customer' }, { key: 'issueDate', label: 'Issue date' }, { key: 'dueDate', label: 'Due date' }, { key: 'total', label: 'Invoice total', format: 'currency' }, { key: 'open', label: 'Open amount', format: 'currency' }, { key: 'status', label: 'Status' }], ['issueDate', 'total', 'open', 'document']),
    };
  }

  private async salesProduct({ args, definition, range, user }: any) {
    const current = { gte: range.from, lte: range.to };
    const prior = { gte: range.priorFrom, lte: range.priorTo };
    const ownerScope = user.role === 'sales' ? user.id : (args.filters.ownerId || undefined);
    const scopedOrders = await this.prisma.salesOrder.findMany({
      where: ownerScope ? { ownerId: ownerScope } : {},
      select: { id: true, orderNumber: true, ownerId: true, customerId: true, quoteId: true, leadId: true, status: true, paymentMode: true, paymentStatus: true, totalAmount: true, createdAt: true },
    });
    const orderIds = scopedOrders.map((row: any) => row.id);
    const orderMap = new Map(scopedOrders.map((row: any) => [row.id, row]));
    const linkedQuoteIds = scopedOrders.map((row: any) => row.quoteId).filter(Boolean);
    const [invoices, priorInvoices, orderLines, users, linkedQuotes, currentQuotes, priorQuotes, leads, currentCredits, priorCredits, currentReturns, priorReturns] = await Promise.all([
      (this.prisma as any).salesInvoice.findMany({ where: { issueDate: current, status: { not: 'void' }, ...(ownerScope ? { salesOrderId: { in: orderIds } } : {}) }, select: { id: true, invoiceNumber: true, salesOrderId: true, customerId: true, issueDate: true, taxableValue: true, taxAmount: true, totalAmount: true } }),
      (this.prisma as any).salesInvoice.findMany({ where: { issueDate: prior, status: { not: 'void' }, ...(ownerScope ? { salesOrderId: { in: orderIds } } : {}) }, select: { id: true, taxAmount: true, totalAmount: true } }),
      (this.prisma as any).salesOrderLine.findMany({ where: { salesOrderId: { in: orderIds } }, select: { id: true, salesOrderId: true, productId: true, sku: true, name: true, category: true, brand: true, finish: true, orderedQuantity: true, returnedQuantity: true, listPrice: true, discountPercent: true, taxRate: true, taxableValue: true, taxAmount: true, lineTotal: true } }),
      this.prisma.user.findMany({ select: { id: true, name: true } }),
      this.prisma.quote.findMany({ where: { id: { in: linkedQuoteIds } }, select: { id: true, customerId: true, ownerId: true, architectId: true, architectName: true, status: true, sentAt: true, supersededByQuoteId: true } }),
      this.prisma.quote.findMany({ where: { createdAt: current, ...(ownerScope ? { ownerId: ownerScope } : {}) }, select: { id: true, customerId: true, ownerId: true, architectId: true, architectName: true, status: true, sentAt: true, confirmedAt: true, supersededByQuoteId: true } }),
      this.prisma.quote.findMany({ where: { createdAt: prior, ...(ownerScope ? { ownerId: ownerScope } : {}) }, select: { id: true, sentAt: true, supersededByQuoteId: true } }),
      this.prisma.lead.findMany({ where: { createdAt: current, ...(ownerScope ? { ownerId: ownerScope } : {}) }, select: { id: true, ownerId: true, source: true, stage: true } }),
      (this.prisma as any).creditNote.findMany({ where: { issuedAt: current, status: 'issued', ...(ownerScope ? { salesOrderId: { in: orderIds } } : {}) }, select: { customerId: true, salesOrderId: true, amount: true } }),
      (this.prisma as any).creditNote.findMany({ where: { issuedAt: prior, status: 'issued', ...(ownerScope ? { salesOrderId: { in: orderIds } } : {}) }, select: { amount: true } }),
      (this.prisma as any).returnOrder.findMany({ where: { createdAt: current, ...(ownerScope ? { salesOrderId: { in: orderIds } } : {}) }, select: { id: true, salesOrderId: true, customerId: true, status: true, refundAmount: true } }),
      (this.prisma as any).returnOrder.findMany({ where: { createdAt: prior, ...(ownerScope ? { salesOrderId: { in: orderIds } } : {}) }, select: { id: true } }),
    ]);
    const invoiceIds = invoices.map((row: any) => row.id);
    const priorInvoiceIds = priorInvoices.map((row: any) => row.id);
    const returnIds = currentReturns.map((row: any) => row.id);
    const priorReturnIds = priorReturns.map((row: any) => row.id);
    const customerIds = Array.from(new Set([...scopedOrders.map((row: any) => row.customerId), ...invoices.map((row: any) => row.customerId)].filter(Boolean)));
    const architectIds = Array.from(new Set([...linkedQuotes, ...currentQuotes].map((row: any) => row.architectId).filter(Boolean)));
    const [invoiceLines, priorInvoiceLines, returnLines, priorReturnLines, customers, architects, payments, priorPayments, availability] = await Promise.all([
      invoiceIds.length ? (this.prisma as any).salesInvoiceLine.findMany({ where: { salesInvoiceId: { in: invoiceIds } }, select: { salesInvoiceId: true, salesOrderLineId: true, productId: true, sku: true, name: true, brand: true, finish: true, quantity: true, taxableValue: true, taxAmount: true, grossLineTotal: true } }) : [],
      priorInvoiceIds.length ? (this.prisma as any).salesInvoiceLine.findMany({ where: { salesInvoiceId: { in: priorInvoiceIds } }, select: { salesOrderLineId: true, quantity: true, taxableValue: true } }) : [],
      returnIds.length ? (this.prisma as any).returnLine.findMany({ where: { returnOrderId: { in: returnIds } }, select: { returnOrderId: true, productId: true, sku: true, quantity: true, acceptedQuantity: true, resellQuantity: true, damagedQuantity: true } }) : [],
      priorReturnIds.length ? (this.prisma as any).returnLine.findMany({ where: { returnOrderId: { in: priorReturnIds } }, select: { quantity: true, acceptedQuantity: true } }) : [],
      customerIds.length ? this.prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true, city: true, state: true } }) : [],
      architectIds.length ? (this.prisma as any).architect.findMany({ where: { id: { in: architectIds } }, select: { id: true, name: true, firmName: true, city: true } }) : [],
      customerIds.length ? (this.prisma as any).customerPayment.findMany({ where: { customerId: { in: customerIds }, receivedAt: current, status: 'posted' }, select: { amount: true, paymentMode: true } }) : [],
      customerIds.length ? (this.prisma as any).customerPayment.findMany({ where: { customerId: { in: customerIds }, receivedAt: prior, status: 'posted' }, select: { amount: true } }) : [],
      (this.prisma as any).inventoryLotBalance.findMany({ select: { available: true, lot: { select: { productId: true } } } }),
    ]);
    const invoiceMap = new Map(invoices.map((row: any) => [row.id, row]));
    const orderLineMap = new Map(orderLines.map((row: any) => [row.id, row]));
    const userMap = new Map(users.map((row: any) => [row.id, row.name]));
    const quoteMap = new Map(linkedQuotes.map((row: any) => [row.id, row]));
    const customerMap = new Map<string, any>(customers.map((row: any) => [row.id, row] as [string, any]));
    const architectMap = new Map(architects.map((row: any) => [row.id, row]));
    const returnMap = new Map(currentReturns.map((row: any) => [row.id, row]));
    const availableByProduct = new Map<string, number>();
    availability.forEach((row: any) => { if (row.lot?.productId) availableByProduct.set(row.lot.productId, (availableByProduct.get(row.lot.productId) || 0) + n(row.available)); });
    const product = new Map<string, any>();
    const owner = new Map<string, any>();
    const customer = new Map<string, any>();
    const architect = new Map<string, any>();
    const ownerBucket = (ownerId: string) => { const label = userMap.get(ownerId) || 'Unassigned'; const item = owner.get(ownerId) || { label, ownerId, leads: 0, quotes: 0, orders: 0, customers: new Set<string>(), bookings: 0, invoiced: 0, credits: 0, returns: 0 }; owner.set(ownerId, item); return item; };
    const customerBucket = (customerId: string) => { const master: any = customerMap.get(customerId); const item = customer.get(customerId) || { label: master?.name || customerId || 'Unassigned', customerId, city: master?.city || '', state: master?.state || '', orders: 0, bookings: 0, invoices: 0, invoiced: 0, credits: 0, returns: 0 }; customer.set(customerId, item); return item; };
    const architectBucket = (quote: any) => { const master: any = architectMap.get(quote?.architectId); const key = quote?.architectId || quote?.architectName || 'Unmapped'; const item = architect.get(key) || { label: master?.name || quote?.architectName || 'Unmapped architect', firm: master?.firmName || '', city: master?.city || '', quotes: 0, orders: 0, customers: new Set<string>(), invoiced: 0 }; architect.set(key, item); return item; };
    const currentOrders = scopedOrders.filter((row: any) => row.createdAt >= range.from && row.createdAt <= range.to);
    const activeOrders = currentOrders.filter((row: any) => row.status !== 'cancelled');
    currentOrders.forEach((row: any) => { const own = ownerBucket(row.ownerId); own.orders += 1; own.customers.add(row.customerId); if (row.status !== 'cancelled') own.bookings += n(row.totalAmount); const cust = customerBucket(row.customerId); cust.orders += 1; if (row.status !== 'cancelled') cust.bookings += n(row.totalAmount); const quote: any = quoteMap.get(row.quoteId); if (quote) { const arch = architectBucket(quote); arch.orders += 1; arch.customers.add(row.customerId); } });
    currentQuotes.filter((row: any) => !row.supersededByQuoteId).forEach((row: any) => { ownerBucket(row.ownerId).quotes += 1; architectBucket(row).quotes += 1; });
    leads.forEach((row: any) => { ownerBucket(row.ownerId).leads += 1; });
    let weightedDiscountValue = 0;
    let weightedBase = 0;
    for (const line of invoiceLines) {
      const inv: any = invoiceMap.get(line.salesInvoiceId);
      const order: any = orderMap.get(inv?.salesOrderId);
      const source: any = orderLineMap.get(line.salesOrderLineId);
      const value = n(line.grossLineTotal);
      const key = line.sku || source?.sku || 'Unknown';
      const item = product.get(key) || { label: key, productId: line.productId || source?.productId, name: line.name || source?.name, category: source?.category || 'Uncategorised', brand: line.brand || source?.brand || 'Unspecified', finish: line.finish || source?.finish || '', value: 0, taxable: 0, tax: 0, quantity: 0, returned: 0 };
      item.value += value; item.taxable += n(line.taxableValue); item.tax += n(line.taxAmount); item.quantity += n(line.quantity); product.set(key, item);
      if (order) { ownerBucket(order.ownerId).invoiced += value; const cust = customerBucket(order.customerId); cust.invoices += 1; cust.invoiced += value; const quote: any = quoteMap.get(order.quoteId); if (quote) architectBucket(quote).invoiced += value; }
      const base = source ? n(source.listPrice) * n(line.quantity) : 0;
      if (base > 0) { weightedBase += base; weightedDiscountValue += Math.max(0, base - n(line.taxableValue)); }
    }
    for (const line of returnLines) { const item = product.get(line.sku); if (item) item.returned += n(line.acceptedQuantity || line.quantity); const ret: any = returnMap.get(line.returnOrderId); const order: any = orderMap.get(ret?.salesOrderId); if (order) { ownerBucket(order.ownerId).returns += n(line.acceptedQuantity || line.quantity); customerBucket(order.customerId).returns += n(line.acceptedQuantity || line.quantity); } }
    currentCredits.forEach((row: any) => { const order: any = orderMap.get(row.salesOrderId); if (order) ownerBucket(order.ownerId).credits += n(row.amount); if (row.customerId) customerBucket(row.customerId).credits += n(row.amount); });
    let priorWeightedBase=0;let priorWeightedDiscount=0;for(const line of priorInvoiceLines){const source:any=orderLineMap.get(line.salesOrderLineId);const base=source?n(source.listPrice)*n(line.quantity):0;if(base>0){priorWeightedBase+=base;priorWeightedDiscount+=Math.max(0,base-n(line.taxableValue));}}
    const priorCurrentOrders=scopedOrders.filter((row:any)=>row.createdAt>=range.priorFrom&&row.createdAt<=range.priorTo);const priorActiveOrders=priorCurrentOrders.filter((row:any)=>row.status!=='cancelled');
    const grossSales = sum(invoices, 'totalAmount'); const priorGrossSales = sum(priorInvoices, 'totalAmount'); const credits = sum(currentCredits, 'amount'); const priorCredit = sum(priorCredits, 'amount');
    const netSales = grossSales - credits; const priorNetSales = priorGrossSales - priorCredit; const quantity = invoiceLines.reduce((t: number, row: any) => t + n(row.quantity), 0); const priorQuantity=priorInvoiceLines.reduce((t:number,row:any)=>t+n(row.quantity),0); const returned = returnLines.reduce((t: number, row: any) => t + n(row.acceptedQuantity || row.quantity), 0); const priorReturned=priorReturnLines.reduce((t:number,row:any)=>t+n(row.acceptedQuantity||row.quantity),0); const avgDiscount = weightedBase ? (weightedDiscountValue / weightedBase) * 100 : 0; const priorAvgDiscount=priorWeightedBase?(priorWeightedDiscount/priorWeightedBase)*100:0;
    const bookings = activeOrders.reduce((total: number, row: any) => total + n(row.totalAmount), 0); const priorBookings=priorActiveOrders.reduce((total:number,row:any)=>total+n(row.totalAmount),0); const collections = sum(payments, 'amount'); const priorCollections = sum(priorPayments, 'amount'); const invoiceTax = sum(invoices, 'taxAmount'); const priorInvoiceTax=sum(priorInvoices,'taxAmount');
    const mappedArchitects = activeOrders.filter((row: any) => { const quote: any = quoteMap.get(row.quoteId); return quote?.architectId; }).length;
    const productRows = Array.from(product.values()).map((row: any) => ({ sku: row.label, product: row.name, category: row.category, brand: row.brand, finish: row.finish, invoicedQuantity: row.quantity, returnedQuantity: row.returned, availableStock: row.productId ? availableByProduct.get(row.productId) || 0 : null, taxableValue: currency(row.taxable), tax: currency(row.tax), invoicedValue: currency(row.value), contribution: grossSales ? round((row.value / grossSales) * 100, 1) : 0, href: `/dashboard/products?search=${encodeURIComponent(row.label)}` }));
    const ownerRows = Array.from(owner.values()).map((row: any) => ({ owner: row.label, leads: row.leads, quotes: row.quotes, orders: row.orders, customers: row.customers.size, bookings: currency(row.bookings), invoiced: currency(row.invoiced), credits: currency(row.credits), netInvoiced: currency(row.invoiced - row.credits), returnedQuantity: row.returns, href: '/dashboard/sales' }));
    const customerRows = Array.from(customer.values()).map((row: any) => ({ customer: row.label, city: row.city, state: row.state, orders: row.orders, invoices: row.invoices, bookings: currency(row.bookings), invoiced: currency(row.invoiced), credits: currency(row.credits), netInvoiced: currency(row.invoiced - row.credits), returnedQuantity: row.returns, href: `/dashboard/customers?search=${encodeURIComponent(row.label)}` }));
    const architectRows = Array.from(architect.values()).map((row: any) => ({ architect: row.label, firm: row.firm, city: row.city, quotes: row.quotes, orders: row.orders, customers: row.customers.size, invoiced: currency(row.invoiced), href: '/dashboard/master-data/architects' }));
    const productBreakdowns = [{ id:'product_pareto',title:'Product contribution Pareto',kind:'pareto',rows:Array.from(product.values()).sort((a:any,b:any)=>b.value-a.value).slice(0,20) },{ id:'category_mix',title:'Sales mix by category',kind:'composition',rows:Array.from(product.values()).reduce((rows:any[],item:any)=>{const row=rows.find((entry:any)=>entry.label===item.category);if(row)row.value+=item.value;else rows.push({label:item.category,value:item.value});return rows},[]).sort((a:any,b:any)=>b.value-a.value) },{ id:'brand_mix',title:'Sales mix by brand',kind:'ranking',rows:Array.from(product.values()).reduce((rows:any[],item:any)=>{const row=rows.find((entry:any)=>entry.label===item.brand);if(row)row.value+=item.value;else rows.push({label:item.brand,value:item.value});return rows},[]).sort((a:any,b:any)=>b.value-a.value) }];
    const ownerBreakdowns = [{ id:'owner_mix',title:'Net invoiced sales by owner',kind:'ranking',rows:ownerRows.map((row:any)=>({label:row.owner,value:row.netInvoiced})).sort((a:any,b:any)=>b.value-a.value) },{ id:'lead_source',title:'Lead source mix',kind:'composition',rows:Object.entries(leads.reduce((acc:any,row:any)=>{acc[row.source||'Unspecified']=(acc[row.source||'Unspecified']||0)+1;return acc},{})).map(([label,value])=>({label,value})) },{ id:'order_status',title:'Order status mix',kind:'composition',rows:Object.entries(currentOrders.reduce((acc:any,row:any)=>{acc[row.status]=(acc[row.status]||0)+1;return acc},{})).map(([label,value])=>({label,value})) }];
    const relationshipBreakdowns = [{ id:'architect',title:'Architect attributed invoiced value',kind:'ranking',rows:architectRows.map((row:any)=>({label:row.architect,value:row.invoiced})).sort((a:any,b:any)=>b.value-a.value) },{ id:'customer',title:'Customer contribution',kind:'pareto',rows:customerRows.map((row:any)=>({label:row.customer,value:row.netInvoiced})).sort((a:any,b:any)=>b.value-a.value).slice(0,20) },{ id:'city',title:'Customer mix by city',kind:'composition',rows:Object.entries(customerRows.reduce((acc:any,row:any)=>{const key=row.city||'Unspecified';acc[key]=(acc[key]||0)+row.netInvoiced;return acc},{})).map(([label,value])=>({label,value})) }];
    const relationshipView = definition.domain === 'Architect & customer'; const ownerView = definition.domain === 'Sales';
    const rows = relationshipView ? (definition.title.toLowerCase().includes('architect') ? architectRows : customerRows) : ownerView ? ownerRows : productRows;
    const columns = relationshipView ? (definition.title.toLowerCase().includes('architect') ? [{key:'architect',label:'Architect'},{key:'firm',label:'Firm'},{key:'city',label:'City'},{key:'quotes',label:'Quotes',format:'number'},{key:'orders',label:'Orders',format:'number'},{key:'customers',label:'Customers',format:'number'},{key:'invoiced',label:'Invoiced',format:'currency'}] : [{key:'customer',label:'Customer'},{key:'city',label:'City'},{key:'state',label:'State'},{key:'orders',label:'Orders',format:'number'},{key:'invoices',label:'Invoices',format:'number'},{key:'bookings',label:'Bookings',format:'currency'},{key:'netInvoiced',label:'Net invoiced',format:'currency'},{key:'returnedQuantity',label:'Returned',format:'number'}]) : ownerView ? [{key:'owner',label:'Owner'},{key:'leads',label:'Leads',format:'number'},{key:'quotes',label:'Quotes',format:'number'},{key:'orders',label:'Orders',format:'number'},{key:'customers',label:'Customers',format:'number'},{key:'bookings',label:'Bookings',format:'currency'},{key:'netInvoiced',label:'Net invoiced',format:'currency'},{key:'returnedQuantity',label:'Returned',format:'number'}] : [{key:'sku',label:'SKU'},{key:'product',label:'Product'},{key:'category',label:'Category'},{key:'brand',label:'Brand'},{key:'finish',label:'Finish'},{key:'invoicedQuantity',label:'Invoiced qty',format:'number'},{key:'returnedQuantity',label:'Returned qty',format:'number'},{key:'availableStock',label:'Available stock',format:'number'},{key:'taxableValue',label:'Taxable value',format:'currency'},{key:'tax',label:'Tax',format:'currency'},{key:'invoicedValue',label:'Gross invoiced',format:'currency'},{key:'contribution',label:'Contribution %',format:'percent'}];
    const warnings: string[] = []; if (!weightedBase) warnings.push('Weighted discount is unavailable where order-line list price is missing.'); if (activeOrders.length && mappedArchitects < activeOrders.length) warnings.push('Architect attribution is shown only where the quote is linked to an architect master.'); warnings.push('Gross margin is not shown because invoice lines do not preserve a governed lot-cost allocation snapshot.');
    return { meta: this.meta(definition, { coverage: activeOrders.length ? round((mappedArchitects / activeOrders.length) * 100, 1) : 100, coverageLabel: 'Current non-cancelled orders with architect-master attribution', warnings }), range: range.labels, filters: { ...args.filters, ...(user.role === 'sales' ? { ownerId: user.id, rowScope: 'self' } : {}) }, summary: [this.summary('net_sales','Net invoiced sales',netSales,priorNetSales,'currency','Posted invoice total less issued credit notes in the selected period.'),this.summary('bookings','Order bookings',bookings,priorBookings,'currency','Non-cancelled orders created in period; this is not revenue.'),this.summary('collections','Collections',collections,priorCollections,'currency','Posted customer payments for customers in the permitted sales scope.'),this.summary('tax','Invoice tax',invoiceTax,priorInvoiceTax,'currency','Tax amount on posted invoices in the selected period.'),this.summary('discount','Weighted discount',avgDiscount,priorAvgDiscount,'percent','List-price value less invoice-line taxable value divided by eligible list-price value.','governed_calculation'),this.summary('orders','Orders created',activeOrders.length,priorActiveOrders.length,'number','Non-cancelled sales orders created in period.'),this.summary('cancelled','Cancelled orders',currentOrders.length-activeOrders.length,priorCurrentOrders.length-priorActiveOrders.length,'number','Orders with cancelled status created in period.'),this.summary('quotes','Quotes sent',currentQuotes.filter((row:any)=>row.sentAt&&!row.supersededByQuoteId).length,priorQuotes.filter((row:any)=>row.sentAt&&!row.supersededByQuoteId).length,'number','Non-superseded quotes sent from the selected creation cohort.'),this.summary('customers','Active customers',new Set(activeOrders.map((row:any)=>row.customerId)).size,new Set(priorActiveOrders.map((row:any)=>row.customerId)).size,'number','Distinct customers with a non-cancelled order created in period.'),this.summary('returns','Accepted return quantity',returned,priorReturned,'number','Accepted return-line quantity created in period.'),this.summary('units','Invoiced quantity',quantity,priorQuantity,'number','Posted invoice-line quantity in the selected period.')], trend: invoices.map((row: any) => ({ date: indiaDay(row.issueDate), invoiced: n(row.totalAmount), taxable: n(row.taxableValue), tax: n(row.taxAmount), document: row.invoiceNumber })), breakdowns: relationshipView ? relationshipBreakdowns : ownerView ? ownerBreakdowns : productBreakdowns, rows: this.paginate(rows,args,columns,['netInvoiced','invoicedValue','bookings','invoiced','orders','quantity','contribution','sku','owner','customer','architect']) };
  }

  private async inventoryStock({ args, definition, range }: any) {
    const [balances, ledger, movements, policies] = await Promise.all([
      (this.prisma as any).inventoryLotBalance.findMany({ where: args.filters.locationId ? { locationId: args.filters.locationId } : {}, include: { lot: { include: { product: true } }, location: true } }),
      (this.prisma as any).inventoryLotLedgerEntry.findMany({ where: { createdAt: { lte: range.to }, direction: 'out', ...(args.filters.locationId ? { locationId: args.filters.locationId } : {}) }, orderBy: { createdAt: 'desc' }, take: 20000, select: { productId: true, lotId: true, createdAt: true, quantity: true } }),
      (this.prisma as any).inventoryLotLedgerEntry.findMany({ where: { createdAt: { gte: range.from, lte: range.to }, ...(args.filters.locationId ? { locationId: args.filters.locationId } : {}) }, orderBy: { createdAt: 'desc' }, take: 20000, include: { product: true, lot: true, location: true } }),
      (this.prisma as any).reorderPolicy.findMany({ where: { status: 'active' } }),
    ]);
    const lastIssue = new Map<string,string>(); const periodIssues = new Map<string,number>();
    for (const entry of ledger) { if (!lastIssue.has(entry.lotId)) lastIssue.set(entry.lotId, indiaDay(entry.createdAt)); if (entry.createdAt >= range.from) periodIssues.set(entry.lotId,(periodIssues.get(entry.lotId)||0)+Math.abs(n(entry.quantity))); }
    let onHand=0, available=0, value=0, costedValue=0, deadValue=0, held=0; const aging=new Map<string,any>(); const categories=new Map<string,any>();
    const rows=balances.map((row:any)=>{ const qty=n(row.onHand); const cost=n(row.lot?.unitCost); const rowValue=qty*cost; const age=ageDays(row.lot.receivedAt,range.to); const issues=periodIssues.get(row.lotId)||0; const last=lastIssue.get(row.lotId)||''; const risk=qty<=0?'stock-out':n(row.damaged)+n(row.hold)>0?'hold / damaged':age>=180&&issues===0?'dead':age>=90&&issues===0?'slow':issues>qty?'fast':'normal'; onHand+=qty;available+=n(row.available);value+=rowValue;if(cost>0)costedValue+=rowValue;if(risk==='dead')deadValue+=rowValue;held+=n(row.damaged)+n(row.hold); const ageLabel=age<=30?'0–30':age<=90?'31–90':age<=180?'91–180':'181+'; const ageItem=aging.get(ageLabel)||{label:ageLabel,value:0,quantity:0};ageItem.value+=rowValue;ageItem.quantity+=qty;aging.set(ageLabel,ageItem);const category=row.lot?.product?.category||'Uncategorised';const cat=categories.get(category)||{label:category,value:0,quantity:0};cat.value+=rowValue;cat.quantity+=qty;categories.set(category,cat);return{sku:row.lot?.product?.sku||'',product:row.lot?.product?.name||'',category,brand:row.lot?.product?.brand||'',location:row.location?.name||row.locationId,lot:row.lot?.lotNumber||row.lotId,onHand:qty,available:n(row.available),reserved:n(row.reserved),hold:n(row.hold),damaged:n(row.damaged),receivedAt:indiaDay(row.lot.receivedAt),ageDays:age,lastIssue:last,issueQuantity:issues,valueAtCost:currency(rowValue),risk,href:`/dashboard/inventory/ledger?lotId=${row.lotId}`}; });
    const availableByProduct = new Map<string,number>(); const productById = new Map<string,any>(); balances.forEach((row:any)=>{availableByProduct.set(row.lot.productId,(availableByProduct.get(row.lot.productId)||0)+n(row.available));productById.set(row.lot.productId,row.lot.product)});
    const missingProductIds = policies.map((row:any)=>row.productId).filter((id:string)=>!productById.has(id)); if(missingProductIds.length){const products=await this.prisma.product.findMany({where:{id:{in:missingProductIds}},select:{id:true,sku:true,name:true,category:true,brand:true}});products.forEach((row:any)=>productById.set(row.id,row));}
    const reorderRows=policies.map((policy:any)=>{const product=productById.get(policy.productId)||{};const currentAvailable=availableByProduct.get(policy.productId)||0;const shortage=Math.max(0,n(policy.reorderPoint)-currentAvailable);const suggested=shortage>0?Math.max(n(policy.reorderQuantity),shortage):0;const pack=Math.max(1,n(policy.packMultiple));const packedSuggested=suggested?Math.ceil(suggested/pack)*pack:0;return{sku:product.sku||policy.productId,product:product.name||'',category:product.category||'',brand:product.brand||'',available:currentAvailable,reorderPoint:n(policy.reorderPoint),minQuantity:n(policy.minQuantity),maxQuantity:n(policy.maxQuantity),suggestedQuantity:packedSuggested,leadTimeDays:n(policy.leadTimeDays),packMultiple:pack,status:shortage>0?'reorder':'within policy',href:`/dashboard/inventory/stock-alerts?productId=${policy.productId}`};}).filter((row:any)=>row.status==='reorder');
    const movementRows=movements.map((row:any)=>({createdAt:row.createdAt.toISOString(),sku:row.product?.sku||row.productId,product:row.product?.name||'',lot:row.lot?.lotNumber||row.lotId,location:row.location?.name||row.locationId,type:row.type,direction:row.direction,quantity:n(row.quantity),onHandDelta:n(row.onHandDelta),reservedDelta:n(row.reservedDelta),damagedDelta:n(row.damagedDelta),holdDelta:n(row.holdDelta),valueAtCost:currency(Math.abs(n(row.quantity))*n(row.unitCost)),reference:row.sourceDocumentNo||`${row.referenceType}:${row.referenceId}`,reason:row.reason,href:`/dashboard/inventory/ledger?lotId=${row.lotId}`}));
    const reorderExceptions=reorderRows.length||rows.filter((row:any)=>row.available<=0).length;
    const movementView=/trace|transfer|movement|ledger|return/i.test(definition.title);const reorderView=/reorder/i.test(definition.title);
    const selectedRows=reorderView?reorderRows:movementView?movementRows:rows;
    const selectedColumns=reorderView?[{key:'sku',label:'SKU'},{key:'product',label:'Product'},{key:'category',label:'Category'},{key:'available',label:'Available',format:'number'},{key:'reorderPoint',label:'Reorder point',format:'number'},{key:'suggestedQuantity',label:'Suggested order',format:'number'},{key:'leadTimeDays',label:'Lead days',format:'number'},{key:'packMultiple',label:'Pack multiple',format:'number'},{key:'status',label:'Status'}]:movementView?[{key:'createdAt',label:'Timestamp'},{key:'sku',label:'SKU'},{key:'product',label:'Product'},{key:'lot',label:'Lot'},{key:'location',label:'Location'},{key:'type',label:'Movement type'},{key:'direction',label:'Direction'},{key:'quantity',label:'Quantity',format:'number'},{key:'onHandDelta',label:'On-hand delta',format:'number'},{key:'reservedDelta',label:'Reserved delta',format:'number'},{key:'valueAtCost',label:'Value at cost',format:'currency'},{key:'reference',label:'Source document'},{key:'reason',label:'Reason'}]:[{key:'sku',label:'SKU'},{key:'product',label:'Product'},{key:'category',label:'Category'},{key:'brand',label:'Brand'},{key:'location',label:'Location'},{key:'lot',label:'Lot'},{key:'onHand',label:'On hand',format:'number'},{key:'available',label:'Available',format:'number'},{key:'reserved',label:'Reserved',format:'number'},{key:'hold',label:'Hold',format:'number'},{key:'damaged',label:'Damaged',format:'number'},{key:'ageDays',label:'Age days',format:'number'},{key:'lastIssue',label:'Last issue'},{key:'valueAtCost',label:'Value at cost',format:'currency'},{key:'risk',label:'Risk'}];
    const movementBreakdowns=[{id:'movement_type',title:'Movement mix by type',kind:'composition',rows:Object.entries(movements.reduce((acc:any,row:any)=>{acc[row.type]=(acc[row.type]||0)+Math.abs(n(row.quantity));return acc},{})).map(([label,value])=>({label,value}))},{id:'movement_location',title:'Movement by location',kind:'ranking',rows:Object.entries(movements.reduce((acc:any,row:any)=>{const key=row.location?.name||row.locationId;acc[key]=(acc[key]||0)+Math.abs(n(row.quantity));return acc},{})).map(([label,value])=>({label,value}))},{id:'movement_value',title:'Quantity and value movement matrix',kind:'scatter',rows:movementRows.slice(0,300).map((row:any)=>({label:row.sku,x:Math.abs(row.quantity),y:row.valueAtCost,size:Math.abs(row.onHandDelta)}))}];
    const standardBreakdowns=[{id:'aging',title:'Inventory aging at cost',kind:'stacked',rows:Array.from(aging.values())},{id:'category',title:'Stock value by category',kind:'composition',rows:Array.from(categories.values()).sort((a:any,b:any)=>b.value-a.value)},{id:'movement',title:'Movement-risk matrix',kind:'scatter',rows:rows.slice(0,300).map((row:any)=>({label:row.sku,x:row.issueQuantity,y:row.valueAtCost,size:row.onHand,risk:row.risk}))}];
    return { meta:this.meta(definition,{coverage:value?round(costedValue/value*100,1):100,coverageLabel:'On-hand value with positive lot cost',warnings:[...(ledger.length>=20000||movements.length>=20000?['Movement scan reached the 20,000-row interactive bound; narrow the location or period.']:[]),...(policies.length?'':['Reorder exceptions only show stock-outs until active ReorderPolicy records are configured.'])]}),range:range.labels,filters:args.filters,summary:[this.summary('on_hand','On-hand quantity',onHand,null,'number','Current InventoryLotBalance.onHand; no historical snapshot is implied.'),this.summary('available','Sellable available',available,null,'number','Current balance available bucket; no historical snapshot is implied.'),this.summary('stock_value','Stock at lot cost',value,null,'currency','On-hand quantity multiplied by lot unit cost; no historical snapshot is implied.'),this.summary('dead_value','Dead-stock value',deadValue,null,'currency','Lot age 180+ days with no issue in the selected period.','governed_calculation'),this.summary('reorder','Reorder exceptions',reorderExceptions,null,'number','Active reorder policies below point; stock-outs are used only when no policies exist.'),this.summary('held','Hold / damaged quantity',held,null,'number','Explicit hold and damaged buckets.'),this.summary('movements','Period movements',movements.length,null,'number','Authoritative universal lot-ledger entries in the selected period.')],trend:movementView?movements.map((row:any)=>({date:indiaDay(row.createdAt),quantity:Math.abs(n(row.quantity)),value:Math.abs(n(row.quantity))*n(row.unitCost)})):Array.from(aging.values()),breakdowns:movementView?movementBreakdowns:standardBreakdowns,rows:this.paginate(selectedRows,args,selectedColumns,['valueAtCost','ageDays','onHand','available','suggestedQuantity','createdAt','quantity','sku','reference']) };
  }

  private async procurementVendor({ args, definition, range }: any) {
    const orders = await (this.prisma as any).purchaseOrder.findMany({ where: { createdAt: { lte: range.to }, ...(args.filters.vendorId ? { vendorId: args.filters.vendorId } : {}) } });
    const purchaseOrderIds = orders.map((row: any) => row.id);
    const lines = purchaseOrderIds.length
      ? await (this.prisma as any).purchaseOrderLine.findMany({ where: { purchaseOrderId: { in: purchaseOrderIds } } })
      : [];
    const purchaseOrderLineIds = lines.map((row: any) => row.id);
    const receiptLines = purchaseOrderLineIds.length
      ? await (this.prisma as any).goodsReceiptLine.findMany({ where: { purchaseOrderLineId: { in: purchaseOrderLineIds } } })
      : [];
    const receiptNoteIds = Array.from(new Set<string>(receiptLines.map((row: any) => String(row.goodsReceiptNoteId))));
    const [notes, vendors] = await Promise.all([
      receiptNoteIds.length ? (this.prisma as any).goodsReceiptNote.findMany({ where: { id: { in: receiptNoteIds }, receivedDate: { lte: range.to } } }) : [],
      (this.prisma as any).vendor.findMany({ where: args.filters.vendorId ? { id: args.filters.vendorId } : {}, select: { id: true, name: true } }),
    ]);
    const poMap=new Map(orders.map((row:any)=>[row.id,row]));const noteMap=new Map(notes.map((row:any)=>[row.id,row]));const vendorMap=new Map(vendors.map((row:any)=>[row.id,row.name]));const lineMap=new Map(lines.map((row:any)=>[row.id,row]));const agg=new Map<string,any>();let commitment=0,orderedQty=0,receivedQty=0,damagedQty=0;
    for(const line of lines){const po:any=poMap.get(line.purchaseOrderId);if(!po)continue;const remaining=Math.max(0,n(line.orderedQuantity)-n(line.receivedQuantity)-n(line.cancelledQuantity));commitment+=remaining*n(line.unitCost);orderedQty+=n(line.orderedQuantity);receivedQty+=n(line.receivedQuantity);const vendor=vendorMap.get(po.vendorId)||po.vendorName||'Unspecified';const item=agg.get(vendor)||{label:vendor,ordered:0,received:0,damaged:0,commitment:0,leadTotal:0,leadCount:0,poCount:new Set()};item.ordered+=n(line.orderedQuantity);item.received+=n(line.receivedQuantity);item.commitment+=remaining*n(line.unitCost);item.poCount.add(po.id);agg.set(vendor,item);}
    for(const receipt of receiptLines){const source:any=lineMap.get(receipt.purchaseOrderLineId);if(!source)continue;const po:any=poMap.get(source.purchaseOrderId);const note:any=noteMap.get(receipt.goodsReceiptNoteId);if(!po||!note)continue;const vendor=vendorMap.get(po.vendorId)||po.vendorName||'Unspecified';const item=agg.get(vendor);if(!item)continue;item.damaged+=n(receipt.damagedQuantity);damagedQty+=n(receipt.damagedQuantity);if(po.orderedAt){item.leadTotal+=ageDays(po.orderedAt,note.receivedDate);item.leadCount+=1;}}
    const rows=Array.from(agg.values()).map((row:any)=>({vendor:row.label,poCount:row.poCount.size,ordered:row.ordered,received:row.received,fillRate:row.ordered?round(row.received/row.ordered*100,1):null,damaged:row.damaged,damageRate:row.received?round(row.damaged/row.received*100,1):null,medianLeadDays:row.leadCount?round(row.leadTotal/row.leadCount,1):null,openCommitment:currency(row.commitment),href:`/dashboard/procurement?vendor=${encodeURIComponent(row.label)}`}));
    const currentOrders=orders.filter((row:any)=>row.createdAt>=range.from&&row.createdAt<=range.to);const priorOrders=orders.filter((row:any)=>row.createdAt>=range.priorFrom&&row.createdAt<=range.priorTo);const currentValue=sum(currentOrders,'grandTotal');const priorValue=sum(priorOrders,'grandTotal');const overdue=orders.filter((row:any)=>row.expectedDate&&row.expectedDate<range.to&&!['closed','cancelled','received'].includes(row.status)).length;
    return{meta:this.meta(definition,{coverage:receiptLines.length?round(receiptLines.filter((row:any)=>row.purchaseOrderLineId).length/receiptLines.length*100,1):100,coverageLabel:'GRN lines linked to PO line',warnings:['Open PO commitment is not supplier accounts payable. Supplier invoice/payment capture is not present.']}),range:range.labels,filters:args.filters,summary:[this.summary('po_value','PO value created',currentValue,priorValue,'currency','Purchase-order grand total created in period.'),this.summary('commitment','Open PO commitment',commitment,null,'currency','Remaining open quantity at PO line unit cost.'),this.summary('fill','Receipt fill rate',orderedQty?receivedQty/orderedQty*100:0,null,'percent','Received quantity divided by ordered quantity for eligible PO lines.','governed_calculation'),this.summary('damage','Inward damage quantity',damagedQty,null,'number','GRN damaged quantity.'),this.summary('overdue','Overdue purchase orders',overdue,null,'number','Open POs past expected date.')],trend:orders.filter((row:any)=>row.createdAt>=range.from).map((row:any)=>({date:indiaDay(row.createdAt),value:n(row.grandTotal),document:row.poNumber})),breakdowns:[{id:'vendor',title:'Vendor fulfilment scorecard',kind:'scatter',rows:rows.map((row:any)=>({label:row.vendor,x:row.medianLeadDays,y:row.fillRate,size:row.openCommitment}))},{id:'commitment',title:'Open commitment by vendor',kind:'ranking',rows:rows.map((row:any)=>({label:row.vendor,value:row.openCommitment})).sort((a:any,b:any)=>b.value-a.value)}],rows:this.paginate(rows,args,[{key:'vendor',label:'Vendor'},{key:'poCount',label:'POs',format:'number'},{key:'ordered',label:'Ordered',format:'number'},{key:'received',label:'Received',format:'number'},{key:'fillRate',label:'Fill %',format:'percent'},{key:'damaged',label:'Damaged',format:'number'},{key:'damageRate',label:'Damage %',format:'percent'},{key:'medianLeadDays',label:'Lead days',format:'number'},{key:'openCommitment',label:'Open commitment',format:'currency'}],['openCommitment','fillRate','medianLeadDays','vendor'])};
  }

  private async financeReceivables({ args, definition, range, user }: any) {
    const ownerScope = user.role === 'sales' ? user.id : (args.filters.ownerId || undefined);
    const scopedOrders = ownerScope ? await this.prisma.salesOrder.findMany({ where: { ownerId: ownerScope }, select: { id: true } }) : [];
    const scopedOrderIds = scopedOrders.map((row: any) => row.id);
    const invoiceWhere: any = { issueDate: { lte: range.to }, status: { not: 'void' }, ...(args.filters.customerId ? { customerId: args.filters.customerId } : {}), ...(ownerScope ? { salesOrderId: { in: scopedOrderIds } } : {}) };
    const invoices = await (this.prisma as any).salesInvoice.findMany({ where: invoiceWhere, select: { id: true, invoiceNumber: true, customerId: true, salesOrderId: true, issueDate: true, dueDate: true, totalAmount: true, openAmount: true, status: true } });
    const invoiceIds = invoices.map((row: any) => row.id);
    const customerIds = Array.from(new Set<string>(invoices.map((row: any) => String(row.customerId))));
    const customerScope = args.filters.customerId
      ? { customerId: args.filters.customerId }
      : ownerScope
        ? { customerId: { in: customerIds } }
        : {};
    const [allocations, currentPayments, priorPayments, credits, profiles, customers, tasks] = await Promise.all([
      invoiceIds.length ? (this.prisma as any).customerAllocation.findMany({ where: { salesInvoiceId: { in: invoiceIds }, status: 'posted', createdAt: { lte: range.to } }, select: { salesInvoiceId: true, amount: true } }) : [],
      (this.prisma as any).customerPayment.findMany({ where: { receivedAt: { gte: range.from, lte: range.to }, status: 'posted', ...customerScope }, select: { customerId: true, amount: true, unappliedAmount: true, paymentMode: true, receivedAt: true } }),
      (this.prisma as any).customerPayment.findMany({ where: { receivedAt: { gte: range.priorFrom, lte: range.priorTo }, status: 'posted', ...customerScope }, select: { amount: true } }),
      (this.prisma as any).creditNote.findMany({ where: { issuedAt: { lte: range.to }, status: 'issued', ...customerScope }, select: { customerId: true, amount: true, unappliedAmount: true } }),
      customerIds.length ? (this.prisma as any).customerCreditProfile.findMany({ where: { customerId: { in: customerIds } } }) : [],
      customerIds.length ? this.prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true } }) : [],
      customerIds.length ? (this.prisma as any).collectionTask.findMany({ where: { customerId: { in: customerIds }, status: { not: 'completed' } }, select: { customerId: true, salesInvoiceId: true, ownerId: true, status: true, priority: true, dueAt: true } }) : [],
    ]);
    const allocated = new Map<string, number>(); allocations.forEach((row: any) => allocated.set(row.salesInvoiceId, (allocated.get(row.salesInvoiceId) || 0) + n(row.amount)));
    const customerMap = new Map<string, string>((customers as any[]).map((row: any) => [row.id, row.name] as [string, string])); const profileMap = new Map<string, any>((profiles as any[]).map((row: any) => [row.customerId, row] as [string, any])); const taskMap = new Map<string, any>(); (tasks as any[]).forEach((row: any) => { if (!taskMap.has(row.customerId)) taskMap.set(row.customerId, row); });
    const aging = new Map<string, any>([['Current',{label:'Current',value:0,count:0}],['1–30',{label:'1–30',value:0,count:0}],['31–60',{label:'31–60',value:0,count:0}],['61+',{label:'61+',value:0,count:0}]]); const customerAgg = new Map<string, any>(); let openAr=0;
    for(const invoice of invoices){const open=Math.max(0,n(invoice.totalAmount)-(allocated.get(invoice.id)||0));if(open<=0)continue;openAr+=open;const days=invoice.dueDate?Math.floor((range.to.getTime()-invoice.dueDate.getTime())/86400000):0;const bucket=days<=0?'Current':days<=30?'1–30':days<=60?'31–60':'61+';const age=aging.get(bucket);age.value+=open;age.count+=1;const item=customerAgg.get(invoice.customerId)||{customerId:invoice.customerId,customer:customerMap.get(invoice.customerId)||invoice.customerId,openAr:0,oldestDays:0,invoiceCount:0};item.openAr+=open;item.oldestDays=Math.max(item.oldestDays,Math.max(0,days));item.invoiceCount+=1;customerAgg.set(invoice.customerId,item);}
    const rows=Array.from(customerAgg.values()).map((row:any)=>{const profile:any=profileMap.get(row.customerId);const creditLimit=n(profile?.creditLimit);const task:any=taskMap.get(row.customerId);return{customer:row.customer,invoiceCount:row.invoiceCount,creditLimit:currency(creditLimit),openAr:currency(row.openAr),exposurePercent:creditLimit?round(row.openAr/creditLimit*100,1):null,oldestDays:row.oldestDays,creditHold:Boolean(profile?.creditHold),nextTask:task?.dueAt?indiaDay(task.dueAt):'',priority:task?.priority||'',href:`/dashboard/payments?customerId=${row.customerId}`};});
    const collections=sum(currentPayments,'amount'),priorCollections=sum(priorPayments,'amount'),unapplied=currentPayments.reduce((t:number,row:any)=>t+n(row.unappliedAmount),0)+credits.reduce((t:number,row:any)=>t+n(row.unappliedAmount),0),overdue=Array.from(aging.values()).filter((row:any)=>row.label!=='Current').reduce((t:number,row:any)=>t+row.value,0),heldExposure=rows.filter((row:any)=>row.creditHold).reduce((t:number,row:any)=>t+row.openAr,0);
    const paymentMix=new Map<string,any>();currentPayments.forEach((row:any)=>{const item=paymentMix.get(row.paymentMode)||{label:row.paymentMode||'Unspecified',value:0,count:0};item.value+=n(row.amount);item.count+=1;paymentMix.set(item.label,item)});
    return{meta:this.meta(definition,{coverage:100,coverageLabel:'Invoice open balance reconstructed from posted allocations through report date',warnings:ownerScope?['Sales role is restricted to customers reached through owned sales orders.']:[]}),range:range.labels,filters:{...args.filters,...(user.role==='sales'?{ownerId:user.id,rowScope:'self'}:{})},summary:[this.summary('open_ar','Open receivables',openAr,null,'currency','Invoice total less posted allocations through the report date.'),this.summary('overdue','Overdue receivables',overdue,null,'currency','Open invoice amount after due date.'),this.summary('collections','Collections',collections,priorCollections,'currency','Posted customer payments received in period.'),this.summary('unapplied','Unapplied credit',unapplied,null,'currency','Unapplied posted payment plus issued credit-note amount.'),this.summary('held','Credit-hold exposure',heldExposure,null,'currency','Open receivables for customers with a credit hold.')],trend:currentPayments.map((row:any)=>({date:indiaDay(row.receivedAt),value:n(row.amount),mode:row.paymentMode})),breakdowns:[{id:'aging',title:'Receivables aging',kind:'composition',rows:Array.from(aging.values())},{id:'payment_mode',title:'Collection mix',kind:'composition',rows:Array.from(paymentMix.values())},{id:'exposure',title:'Credit exposure vs limit',kind:'scatter',rows:rows.map((row:any)=>({label:row.customer,x:row.creditLimit,y:row.exposurePercent,size:row.openAr}))}],rows:this.paginate(rows,args,[{key:'customer',label:'Customer'},{key:'invoiceCount',label:'Open invoices',format:'number'},{key:'creditLimit',label:'Credit limit',format:'currency'},{key:'openAr',label:'Open AR',format:'currency'},{key:'exposurePercent',label:'Exposure %',format:'percent'},{key:'oldestDays',label:'Oldest due days',format:'number'},{key:'creditHold',label:'Credit hold'},{key:'nextTask',label:'Next task'},{key:'priority',label:'Priority'}],['openAr','oldestDays','exposurePercent','customer'])};
  }

  private async fulfilmentPipeline({ args, definition, range, user }: any) {
    const ownerScope=user.role==='sales'?user.id:(args.filters.ownerId||undefined);const quoteWhere:any={createdAt:{gte:range.from,lte:range.to},...(ownerScope?{ownerId:ownerScope}:{}),...(args.filters.customerId?{customerId:args.filters.customerId}:{})};
    const [quotes,orders]=await Promise.all([
      this.prisma.quote.findMany({where:quoteWhere,select:{id:true,quoteNumber:true,customerId:true,ownerId:true,status:true,approvalStatus:true,sentAt:true,confirmedAt:true,createdAt:true,supersededByQuoteId:true}}),
      this.prisma.salesOrder.findMany({where:{createdAt:{gte:range.from,lte:range.to},status:{not:'cancelled'},...(ownerScope?{ownerId:ownerScope}:{}),...(args.filters.customerId?{customerId:args.filters.customerId}:{})},select:{id:true,orderNumber:true,quoteId:true,customerId:true,ownerId:true,status:true,promisedDate:true,totalAmount:true,createdAt:true}})
    ]);
    const orderIdList=orders.map((row:any)=>row.id);
    const [orderLines,challans,invoices,dispatchJobs]=orderIdList.length?await Promise.all([
      (this.prisma as any).salesOrderLine.findMany({where:{salesOrderId:{in:orderIdList}}}),this.prisma.dispatchChallan.findMany({where:{salesOrderId:{in:orderIdList},createdAt:{gte:range.from,lte:range.to}},select:{id:true,challanNumber:true,salesOrderId:true,status:true,createdAt:true,packedAt:true,dispatchedAt:true,deliveredAt:true}}),(this.prisma as any).salesInvoice.findMany({where:{salesOrderId:{in:orderIdList},issueDate:{gte:range.from,lte:range.to},status:{not:'void'}},select:{id:true,invoiceNumber:true,salesOrderId:true,totalAmount:true,issueDate:true}}),(this.prisma as any).dispatchJob.findMany({where:{salesOrderId:{in:orderIdList},createdAt:{lte:range.to}},select:{id:true,salesOrderId:true,status:true,dueDate:true,createdAt:true}})
    ]):[[],[],[],[]];
    const relevantLines=orderLines;const challanMap=new Map<string,any[]>();challans.forEach((row:any)=>{if(!row.salesOrderId)return;const list=challanMap.get(row.salesOrderId)||[];list.push(row);challanMap.set(row.salesOrderId,list)});const invoiceMap=new Map<string,any[]>();invoices.forEach((row:any)=>{const list=invoiceMap.get(row.salesOrderId)||[];list.push(row);invoiceMap.set(row.salesOrderId,list)});const lineByOrder=new Map<string,any[]>();relevantLines.forEach((row:any)=>{const list=lineByOrder.get(row.salesOrderId)||[];list.push(row);lineByOrder.set(row.salesOrderId,list)});
    const rows=orders.map((order:any)=>{const lines=lineByOrder.get(order.id)||[];const docs=challanMap.get(order.id)||[];const bills=invoiceMap.get(order.id)||[];const ordered=lines.reduce((t:number,row:any)=>t+n(row.orderedQuantity),0),allocated=lines.reduce((t:number,row:any)=>t+n(row.allocatedQuantity),0),dispatched=lines.reduce((t:number,row:any)=>t+n(row.dispatchedQuantity),0),delivered=lines.reduce((t:number,row:any)=>t+n(row.deliveredQuantity),0),backorder=lines.reduce((t:number,row:any)=>t+n(row.backorderedQuantity),0),invoiced=bills.reduce((t:number,row:any)=>t+n(row.totalAmount),0);const deliveredAt=docs.map((row:any)=>row.deliveredAt).filter(Boolean).sort().at(-1);const onTime=order.promisedDate&&deliveredAt?deliveredAt<=order.promisedDate:null;return{order:order.orderNumber,status:order.status,promisedDate:order.promisedDate?indiaDay(order.promisedDate):'',ordered,allocated,dispatched,delivered,backorder,invoicedValue:currency(invoiced),challans:docs.length,onTime,ageDays:ageDays(order.createdAt,range.to),href:'/dashboard/orders'};});
    const sent=quotes.filter((row:any)=>row.sentAt&&!row.supersededByQuoteId);const approved=sent.filter((row:any)=>['approved','confirmed'].includes(row.approvalStatus)||row.confirmedAt);const quoteIds=new Set(sent.map((row:any)=>row.id));const cohortOrders=orders.filter((row:any)=>row.quoteId&&quoteIds.has(row.quoteId));const dispatchedOrders=cohortOrders.filter((row:any)=>(challanMap.get(row.id)||[]).some((doc:any)=>['dispatched','delivered'].includes(doc.status)));const invoicedOrders=cohortOrders.filter((row:any)=>(invoiceMap.get(row.id)||[]).length>0);const overdueJobs=dispatchJobs.filter((row:any)=>row.dueDate<range.to&&!['delivered','cancelled'].includes(row.status)).length;const eligibleOnTime=rows.filter((row:any)=>row.onTime!==null);const onTimeCount=eligibleOnTime.filter((row:any)=>row.onTime).length;
    return{meta:this.meta(definition,{coverage:rows.length?round(rows.filter((row:any)=>row.promisedDate).length/rows.length*100,1):100,coverageLabel:'Orders with promised date',warnings:eligibleOnTime.length?[]:['On-time delivery is unavailable until both promised and delivered timestamps exist.']}),range:range.labels,filters:{...args.filters,...(user.role==='sales'?{ownerId:user.id,rowScope:'self'}:{})},summary:[this.summary('quotes','Quotes sent',sent.length,null,'number','Non-superseded quotes sent in the selected creation cohort.'),this.summary('orders','Orders created',orders.length,null,'number','Non-cancelled sales orders created in period.'),this.summary('backorder','Backordered quantity',rows.reduce((t:number,row:any)=>t+row.backorder,0),null,'number','Sales-order-line backordered quantity.'),this.summary('dispatch_risk','Overdue dispatch jobs',overdueJobs,null,'number','Open dispatch jobs past due date.'),this.summary('on_time','On-time delivery',eligibleOnTime.length?onTimeCount/eligibleOnTime.length*100:0,null,'percent','Delivered orders at or before promised date, only where both timestamps exist.','governed_calculation')],trend:orders.map((row:any)=>({date:indiaDay(row.createdAt),value:n(row.totalAmount),document:row.orderNumber})),breakdowns:[{id:'funnel',title:'Quote-to-invoice cohort',kind:'funnel',rows:[{label:'Quotes sent',value:sent.length},{label:'Approved',value:approved.length},{label:'Orders',value:cohortOrders.length},{label:'Dispatched',value:dispatchedOrders.length},{label:'Invoiced',value:invoicedOrders.length}]},{id:'stage',title:'Order status',kind:'ranking',rows:Object.entries(orders.reduce((acc:any,row:any)=>{acc[row.status]=(acc[row.status]||0)+1;return acc},{})).map(([label,value])=>({label,value}))}],rows:this.paginate(rows,args,[{key:'order',label:'Order'},{key:'status',label:'Status'},{key:'promisedDate',label:'Promised'},{key:'ordered',label:'Ordered',format:'number'},{key:'allocated',label:'Allocated',format:'number'},{key:'dispatched',label:'Dispatched',format:'number'},{key:'delivered',label:'Delivered',format:'number'},{key:'backorder',label:'Backorder',format:'number'},{key:'invoicedValue',label:'Invoiced',format:'currency'},{key:'ageDays',label:'Age days',format:'number'}],['ageDays','backorder','invoicedValue','order'])};
  }

  private async auditQuality({ args, definition, range }: any) {
    const current={gte:range.from,lte:range.to};const [events,users,sessions,documents,products,notifications,labels]=await Promise.all([(this.prisma as any).auditEvent.findMany({where:{createdAt:current},orderBy:{createdAt:'desc'},take:5000}),(this.prisma as any).user.findMany({select:{id:true,name:true,role:true,active:true,passwordChangedAt:true,permissionOverrides:true}}),(this.prisma as any).session.findMany({select:{userId:true,expiresAt:true}}),(this.prisma as any).documentJob.findMany({where:{createdAt:current}}),this.prisma.product.findMany({select:{id:true,sku:true,name:true,category:true,brand:true,finish:true,status:true}}),(this.prisma as any).notification.findMany({where:{createdAt:current}}),(this.prisma as any).internalLabelInstance.findMany({where:{createdAt:current}}).catch(()=>[])]);
    const actorIds=Array.from(new Set<string>(events.map((row:any)=>String(row.actorUserId||'')).filter(Boolean)));const actors=actorIds.length?await this.prisma.user.findMany({where:{id:{in:actorIds}},select:{id:true,name:true}}):[];const actorMap=new Map(actors.map((row:any)=>[row.id,row.name]));const actionMix=new Map<string,any>();events.forEach((row:any)=>{const item=actionMix.get(row.action)||{label:row.action,value:0};item.value+=1;actionMix.set(row.action,item)});const incomplete=products.filter((row:any)=>!row.category||!row.brand||!row.name||!row.sku);const failedDocuments=documents.filter((row:any)=>row.status==='failed');const expiredSessions=sessions.filter((row:any)=>row.expiresAt<new Date()).length;const unread=notifications.filter((row:any)=>!row.readAt).length;
    const rows=events.map((row:any)=>({createdAt:row.createdAt.toISOString(),actor:actorMap.get(row.actorUserId)||row.actorUserId||'System',action:row.action,entityType:row.entityType,entityId:row.entityId,summary:row.summary||'',href:row.entityType&&row.entityId?`/dashboard/audit?entityType=${encodeURIComponent(row.entityType)}&entityId=${encodeURIComponent(row.entityId)}`:'/dashboard/audit'}));
    return{meta:this.meta(definition,{coverage:100,coverageLabel:'Current authoritative audit/system records',warnings:['Master-data readiness reports only fields with an explicit current requirement; category-specific completeness policy remains Needs setup.']}),range:range.labels,filters:args.filters,summary:[this.summary('events','Audit events',events.length,null,'number','Audit events created in period.'),this.summary('failures','Failed documents',failedDocuments.length,null,'number','DocumentJob rows in failed status.'),this.summary('users','Active users',users.filter((row:any)=>row.active).length,null,'number','Active user accounts.'),this.summary('sessions','Expired sessions',expiredSessions,null,'number','Session rows past expiry pending normal cleanup.'),this.summary('incomplete','Basic product exceptions',incomplete.length,null,'number','Products missing SKU, name, category or brand.'),this.summary('unread','Unread notifications',unread,null,'number','Notifications without readAt in period.'),this.summary('labels','Labels created',labels.length,null,'number','Internal label instances created in period.')],trend:events.map((row:any)=>({date:indiaDay(row.createdAt),value:1,action:row.action})),breakdowns:[{id:'actions',title:'Audit actions',kind:'pareto',rows:Array.from(actionMix.values()).sort((a:any,b:any)=>b.value-a.value).slice(0,20)},{id:'roles',title:'Users by role',kind:'composition',rows:Object.entries(users.reduce((acc:any,row:any)=>{acc[row.role]=(acc[row.role]||0)+1;return acc},{})).map(([label,value])=>({label,value}))}],rows:this.paginate(rows,args,[{key:'createdAt',label:'Timestamp'},{key:'actor',label:'Actor'},{key:'action',label:'Action'},{key:'entityType',label:'Entity'},{key:'entityId',label:'Entity ID'},{key:'summary',label:'Summary'}],['createdAt','action','entityType','actor'])};
  }
}
