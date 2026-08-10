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

  private summary(id: string, label: string, current: number, prior: number, format: string, definition: string, readiness: string = 'available') {
    return { id, label, current: currency(current), prior: currency(prior), variance: currency(current - prior), variancePercent: delta(current, prior), format, definition, readiness };
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
        this.summary('stock_value', 'Stock at lot cost', stockValue, stockValue, 'currency', 'Current lot on-hand quantity multiplied by lot unit cost.'),
        this.summary('po_commitment', 'Open PO commitment', poCommitment, poCommitment, 'currency', 'Remaining open PO quantity multiplied by line unit cost; this is not accounts payable.'),
      ],
      trend: Array.from(trend.values()).sort((a, b) => a.date.localeCompare(b.date)),
      breakdowns: [{ id: 'stock_category', title: 'Stock value by category', kind: 'composition', rows: Array.from(stockMix.values()).sort((a: any, b: any) => b.value - a.value) }, { id: 'fulfilment', title: 'Dispatch status', kind: 'ranking', rows: Object.entries(challans.reduce((acc: any, row: any) => { acc[row.status] = (acc[row.status] || 0) + 1; return acc; }, {})).map(([label, value]) => ({ label, value })) }],
      rows: this.paginate(rowItems, args, [{ key: 'document', label: 'Invoice' }, { key: 'customer', label: 'Customer' }, { key: 'issueDate', label: 'Issue date' }, { key: 'dueDate', label: 'Due date' }, { key: 'total', label: 'Invoice total', format: 'currency' }, { key: 'open', label: 'Open amount', format: 'currency' }, { key: 'status', label: 'Status' }], ['issueDate', 'total', 'open', 'document']),
    };
  }

  private async salesProduct({ args, definition, range, user }: any) {
    const current = { gte: range.from, lte: range.to }; const prior = { gte: range.priorFrom, lte: range.priorTo };
    const ownerScope = user.role === 'sales' ? user.id : (args.filters.ownerId || undefined);
    const scopedOrders = await this.prisma.salesOrder.findMany({ where: { ...(ownerScope ? { ownerId: ownerScope } : {}), status: { not: 'cancelled' } }, select: { id: true, ownerId: true, customerId: true, quoteId: true } });
    const orderIds = scopedOrders.map((row: any) => row.id); const orderMap = new Map(scopedOrders.map((row: any) => [row.id, row]));
    const [invoices, priorInvoices, orderLines, users, quotes] = await Promise.all([
      (this.prisma as any).salesInvoice.findMany({ where: { issueDate: current, status: { not: 'void' }, ...(ownerScope ? { salesOrderId: { in: orderIds } } : {}) }, select: { id: true, invoiceNumber: true, salesOrderId: true, issueDate: true, totalAmount: true } }),
      (this.prisma as any).salesInvoice.findMany({ where: { issueDate: prior, status: { not: 'void' }, ...(ownerScope ? { salesOrderId: { in: orderIds } } : {}) }, select: { totalAmount: true } }),
      (this.prisma as any).salesOrderLine.findMany({ where: { salesOrderId: { in: orderIds } }, select: { id: true, salesOrderId: true, sku: true, name: true, category: true, brand: true, finish: true, orderedQuantity: true, deliveredQuantity: true, listPrice: true, unitPrice: true, discountPercent: true, lineTotal: true } }),
      this.prisma.user.findMany({ select: { id: true, name: true } }),
      this.prisma.quote.findMany({ where: { id: { in: scopedOrders.map((row: any) => row.quoteId).filter(Boolean) } }, select: { id: true, architectId: true, architectName: true } }),
    ]);
    const invoiceIds = invoices.map((row: any) => row.id);
    const invoiceLines = invoiceIds.length ? await (this.prisma as any).salesInvoiceLine.findMany({ where: { salesInvoiceId: { in: invoiceIds } }, select: { salesInvoiceId: true, salesOrderLineId: true, productId: true, sku: true, name: true, brand: true, finish: true, quantity: true, taxableValue: true, grossLineTotal: true } }) : [];
    const invoiceMap = new Map(invoices.map((row: any) => [row.id, row])); const orderLineMap = new Map(orderLines.map((row: any) => [row.id, row])); const userMap = new Map(users.map((row: any) => [row.id, row.name])); const quoteMap = new Map(quotes.map((row: any) => [row.id, row]));
    const product = new Map<string, any>(); const owner = new Map<string, any>();
    let weightedDiscountValue = 0; let weightedBase = 0;
    for (const line of invoiceLines) {
      const inv: any = invoiceMap.get(line.salesInvoiceId); const order: any = orderMap.get(inv?.salesOrderId); const source: any = orderLineMap.get(line.salesOrderLineId); const value = n(line.taxableValue); const key = line.sku || source?.sku || 'Unknown'; const item = product.get(key) || { label: key, name: line.name || source?.name, category: source?.category || 'Uncategorised', brand: line.brand || source?.brand || 'Unspecified', finish: line.finish || source?.finish || '', value: 0, quantity: 0 }; item.value += value; item.quantity += n(line.quantity); product.set(key, item); const ownerName = userMap.get(order?.ownerId) || 'Unassigned'; const own = owner.get(ownerName) || { label: ownerName, value: 0, quantity: 0 }; own.value += value; own.quantity += n(line.quantity); owner.set(ownerName, own); const base = source ? n(source.listPrice) * n(line.quantity) : 0; if (base > 0) { weightedBase += base; weightedDiscountValue += Math.max(0, base - value); }
    }
    const sales = sum(invoices, 'totalAmount'); const priorSales = sum(priorInvoices, 'totalAmount'); const quantity = invoiceLines.reduce((t: number, row: any) => t + n(row.quantity), 0); const avgDiscount = weightedBase ? (weightedDiscountValue / weightedBase) * 100 : 0;
    const rows = Array.from(product.values()).map((row: any) => ({ sku: row.label, product: row.name, category: row.category, brand: row.brand, finish: row.finish, quantity: row.quantity, netValue: currency(row.value), contribution: sales ? round((row.value / sales) * 100, 1) : 0, href: `/dashboard/products?search=${encodeURIComponent(row.label)}` }));
    const mappedArchitects = scopedOrders.filter((row: any) => { const quote: any = quoteMap.get(row.quoteId); return quote?.architectId; }).length;
    return { meta: this.meta(definition, { coverage: scopedOrders.length ? round((mappedArchitects / scopedOrders.length) * 100, 1) : 100, coverageLabel: 'Orders with quote architect master where applicable', warnings: weightedBase ? [] : ['Weighted discount is unavailable where order-line list price is missing'] }), range: range.labels, filters: { ...args.filters, ...(user.role === 'sales' ? { ownerId: user.id, rowScope: 'self' } : {}) }, summary: [this.summary('net_sales','Net invoiced sales',sales,priorSales,'currency','Posted invoice value for eligible owned orders.'), this.summary('units','Invoiced quantity',quantity,quantity,'number','Invoice-line quantity in the selected period.'), this.summary('discount','Weighted discount',avgDiscount,avgDiscount,'percent','List-price value less invoiced taxable value divided by eligible list-price value.','governed_calculation'), this.summary('products','Active selling SKUs',product.size,product.size,'number','Distinct invoice-line SKU in the selected period.')], trend: invoices.map((row: any) => ({ date: indiaDay(row.issueDate), value: n(row.totalAmount), document: row.invoiceNumber })), breakdowns: [{ id:'product_pareto',title:'Product contribution Pareto',kind:'pareto',rows:Array.from(product.values()).sort((a:any,b:any)=>b.value-a.value).slice(0,20) },{ id:'owner_mix',title:'Sales by owner',kind:'ranking',rows:Array.from(owner.values()).sort((a:any,b:any)=>b.value-a.value) }], rows: this.paginate(rows,args,[{key:'sku',label:'SKU'},{key:'product',label:'Product'},{key:'category',label:'Category'},{key:'brand',label:'Brand'},{key:'finish',label:'Finish'},{key:'quantity',label:'Quantity',format:'number'},{key:'netValue',label:'Net value',format:'currency'},{key:'contribution',label:'Contribution %',format:'percent'}],['netValue','quantity','contribution','sku']) };
  }

  private async inventoryStock({ args, definition, range }: any) {
    const [balances, ledger] = await Promise.all([
      (this.prisma as any).inventoryLotBalance.findMany({ where: args.filters.locationId ? { locationId: args.filters.locationId } : {}, include: { lot: { include: { product: true } }, location: true } }),
      (this.prisma as any).inventoryLotLedgerEntry.findMany({ where: { createdAt: { lte: range.to }, direction: 'out', ...(args.filters.locationId ? { locationId: args.filters.locationId } : {}) }, orderBy: { createdAt: 'desc' }, take: 20000, select: { productId: true, lotId: true, createdAt: true, quantity: true } }),
    ]);
    const lastIssue = new Map<string,string>(); const periodIssues = new Map<string,number>();
    for (const entry of ledger) { if (!lastIssue.has(entry.lotId)) lastIssue.set(entry.lotId, indiaDay(entry.createdAt)); if (entry.createdAt >= range.from) periodIssues.set(entry.lotId,(periodIssues.get(entry.lotId)||0)+Math.abs(n(entry.quantity))); }
    let onHand=0, available=0, value=0, costedValue=0, deadValue=0, held=0; const aging=new Map<string,any>(); const categories=new Map<string,any>();
    const rows=balances.map((row:any)=>{ const qty=n(row.onHand); const cost=n(row.lot?.unitCost); const rowValue=qty*cost; const age=ageDays(row.lot.receivedAt,range.to); const issues=periodIssues.get(row.lotId)||0; const last=lastIssue.get(row.lotId)||''; const risk=qty<=0?'stock-out':n(row.damaged)+n(row.hold)>0?'hold / damaged':age>=180&&issues===0?'dead':age>=90&&issues===0?'slow':issues>qty?'fast':'normal'; onHand+=qty;available+=n(row.available);value+=rowValue;if(cost>0)costedValue+=rowValue;if(risk==='dead')deadValue+=rowValue;held+=n(row.damaged)+n(row.hold); const ageLabel=age<=30?'0–30':age<=90?'31–90':age<=180?'91–180':'181+'; const ageItem=aging.get(ageLabel)||{label:ageLabel,value:0,quantity:0};ageItem.value+=rowValue;ageItem.quantity+=qty;aging.set(ageLabel,ageItem);const category=row.lot?.product?.category||'Uncategorised';const cat=categories.get(category)||{label:category,value:0,quantity:0};cat.value+=rowValue;cat.quantity+=qty;categories.set(category,cat);return{sku:row.lot?.product?.sku||'',product:row.lot?.product?.name||'',category,brand:row.lot?.product?.brand||'',location:row.location?.name||row.locationId,lot:row.lot?.lotNumber||row.lotId,onHand:qty,available:n(row.available),reserved:n(row.reserved),hold:n(row.hold),damaged:n(row.damaged),receivedAt:indiaDay(row.lot.receivedAt),ageDays:age,lastIssue:last,issueQuantity:issues,valueAtCost:currency(rowValue),risk,href:`/dashboard/inventory/ledger?lotId=${row.lotId}`}; });
    const reorderExceptions=rows.filter((row:any)=>row.available<=0).length;
    return { meta:this.meta(definition,{coverage:value?round(costedValue/value*100,1):100,coverageLabel:'On-hand value with positive lot cost',warnings:ledger.length>=20000?['Movement scan reached the 20,000-row interactive bound; narrow the location or period.']:[]}),range:range.labels,filters:args.filters,summary:[this.summary('on_hand','On-hand quantity',onHand,onHand,'number','Current InventoryLotBalance.onHand.'),this.summary('available','Sellable available',available,available,'number','Current balance available bucket.'),this.summary('stock_value','Stock at lot cost',value,value,'currency','On-hand quantity multiplied by lot unit cost.'),this.summary('dead_value','Dead-stock value',deadValue,deadValue,'currency','Lot age 180+ days with no issue in the selected period.','governed_calculation'),this.summary('reorder','Stock-out exceptions',reorderExceptions,reorderExceptions,'number','Locations with zero or negative available quantity.'),this.summary('held','Hold / damaged quantity',held,held,'number','Explicit hold and damaged buckets.')],trend:Array.from(aging.values()),breakdowns:[{id:'aging',title:'Inventory aging at cost',kind:'stacked',rows:Array.from(aging.values())},{id:'category',title:'Stock value by category',kind:'composition',rows:Array.from(categories.values()).sort((a:any,b:any)=>b.value-a.value)},{id:'movement',title:'Movement-risk matrix',kind:'scatter',rows:rows.slice(0,300).map((row:any)=>({label:row.sku,x:row.issueQuantity,y:row.valueAtCost,size:row.onHand,risk:row.risk}))}],rows:this.paginate(rows,args,[{key:'sku',label:'SKU'},{key:'product',label:'Product'},{key:'category',label:'Category'},{key:'brand',label:'Brand'},{key:'location',label:'Location'},{key:'lot',label:'Lot'},{key:'onHand',label:'On hand',format:'number'},{key:'available',label:'Available',format:'number'},{key:'ageDays',label:'Age days',format:'number'},{key:'lastIssue',label:'Last issue'},{key:'valueAtCost',label:'Value at cost',format:'currency'},{key:'risk',label:'Risk'}],['valueAtCost','ageDays','onHand','sku']) };
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
    return{meta:this.meta(definition,{coverage:receiptLines.length?round(receiptLines.filter((row:any)=>row.purchaseOrderLineId).length/receiptLines.length*100,1):100,coverageLabel:'GRN lines linked to PO line',warnings:['Open PO commitment is not supplier accounts payable. Supplier invoice/payment capture is not present.']}),range:range.labels,filters:args.filters,summary:[this.summary('po_value','PO value created',currentValue,priorValue,'currency','Purchase-order grand total created in period.'),this.summary('commitment','Open PO commitment',commitment,commitment,'currency','Remaining open quantity at PO line unit cost.'),this.summary('fill','Receipt fill rate',orderedQty?receivedQty/orderedQty*100:0,orderedQty?receivedQty/orderedQty*100:0,'percent','Received quantity divided by ordered quantity for eligible PO lines.','governed_calculation'),this.summary('damage','Inward damage quantity',damagedQty,damagedQty,'number','GRN damaged quantity.'),this.summary('overdue','Overdue purchase orders',overdue,overdue,'number','Open POs past expected date.')],trend:orders.filter((row:any)=>row.createdAt>=range.from).map((row:any)=>({date:indiaDay(row.createdAt),value:n(row.grandTotal),document:row.poNumber})),breakdowns:[{id:'vendor',title:'Vendor fulfilment scorecard',kind:'scatter',rows:rows.map((row:any)=>({label:row.vendor,x:row.medianLeadDays,y:row.fillRate,size:row.openCommitment}))},{id:'commitment',title:'Open commitment by vendor',kind:'ranking',rows:rows.map((row:any)=>({label:row.vendor,value:row.openCommitment})).sort((a:any,b:any)=>b.value-a.value)}],rows:this.paginate(rows,args,[{key:'vendor',label:'Vendor'},{key:'poCount',label:'POs',format:'number'},{key:'ordered',label:'Ordered',format:'number'},{key:'received',label:'Received',format:'number'},{key:'fillRate',label:'Fill %',format:'percent'},{key:'damaged',label:'Damaged',format:'number'},{key:'damageRate',label:'Damage %',format:'percent'},{key:'medianLeadDays',label:'Lead days',format:'number'},{key:'openCommitment',label:'Open commitment',format:'currency'}],['openCommitment','fillRate','medianLeadDays','vendor'])};
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
    return{meta:this.meta(definition,{coverage:100,coverageLabel:'Invoice open balance reconstructed from posted allocations through report date',warnings:ownerScope?['Sales role is restricted to customers reached through owned sales orders.']:[]}),range:range.labels,filters:{...args.filters,...(user.role==='sales'?{ownerId:user.id,rowScope:'self'}:{})},summary:[this.summary('open_ar','Open receivables',openAr,openAr,'currency','Invoice total less posted allocations through the report date.'),this.summary('overdue','Overdue receivables',overdue,overdue,'currency','Open invoice amount after due date.'),this.summary('collections','Collections',collections,priorCollections,'currency','Posted customer payments received in period.'),this.summary('unapplied','Unapplied credit',unapplied,unapplied,'currency','Unapplied posted payment plus issued credit-note amount.'),this.summary('held','Credit-hold exposure',heldExposure,heldExposure,'currency','Open receivables for customers with a credit hold.')],trend:currentPayments.map((row:any)=>({date:indiaDay(row.receivedAt),value:n(row.amount),mode:row.paymentMode})),breakdowns:[{id:'aging',title:'Receivables aging',kind:'composition',rows:Array.from(aging.values())},{id:'payment_mode',title:'Collection mix',kind:'composition',rows:Array.from(paymentMix.values())},{id:'exposure',title:'Credit exposure vs limit',kind:'scatter',rows:rows.map((row:any)=>({label:row.customer,x:row.creditLimit,y:row.exposurePercent,size:row.openAr}))}],rows:this.paginate(rows,args,[{key:'customer',label:'Customer'},{key:'invoiceCount',label:'Open invoices',format:'number'},{key:'creditLimit',label:'Credit limit',format:'currency'},{key:'openAr',label:'Open AR',format:'currency'},{key:'exposurePercent',label:'Exposure %',format:'percent'},{key:'oldestDays',label:'Oldest due days',format:'number'},{key:'creditHold',label:'Credit hold'},{key:'nextTask',label:'Next task'},{key:'priority',label:'Priority'}],['openAr','oldestDays','exposurePercent','customer'])};
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
    return{meta:this.meta(definition,{coverage:rows.length?round(rows.filter((row:any)=>row.promisedDate).length/rows.length*100,1):100,coverageLabel:'Orders with promised date',warnings:eligibleOnTime.length?[]:['On-time delivery is unavailable until both promised and delivered timestamps exist.']}),range:range.labels,filters:{...args.filters,...(user.role==='sales'?{ownerId:user.id,rowScope:'self'}:{})},summary:[this.summary('quotes','Quotes sent',sent.length,sent.length,'number','Non-superseded quotes sent in the selected creation cohort.'),this.summary('orders','Orders created',orders.length,orders.length,'number','Non-cancelled sales orders created in period.'),this.summary('backorder','Backordered quantity',rows.reduce((t:number,row:any)=>t+row.backorder,0),rows.reduce((t:number,row:any)=>t+row.backorder,0),'number','Sales-order-line backordered quantity.'),this.summary('dispatch_risk','Overdue dispatch jobs',overdueJobs,overdueJobs,'number','Open dispatch jobs past due date.'),this.summary('on_time','On-time delivery',eligibleOnTime.length?onTimeCount/eligibleOnTime.length*100:0,eligibleOnTime.length?onTimeCount/eligibleOnTime.length*100:0,'percent','Delivered orders at or before promised date, only where both timestamps exist.','governed_calculation')],trend:orders.map((row:any)=>({date:indiaDay(row.createdAt),value:n(row.totalAmount),document:row.orderNumber})),breakdowns:[{id:'funnel',title:'Quote-to-invoice cohort',kind:'funnel',rows:[{label:'Quotes sent',value:sent.length},{label:'Approved',value:approved.length},{label:'Orders',value:cohortOrders.length},{label:'Dispatched',value:dispatchedOrders.length},{label:'Invoiced',value:invoicedOrders.length}]},{id:'stage',title:'Order status',kind:'ranking',rows:Object.entries(orders.reduce((acc:any,row:any)=>{acc[row.status]=(acc[row.status]||0)+1;return acc},{})).map(([label,value])=>({label,value}))}],rows:this.paginate(rows,args,[{key:'order',label:'Order'},{key:'status',label:'Status'},{key:'promisedDate',label:'Promised'},{key:'ordered',label:'Ordered',format:'number'},{key:'allocated',label:'Allocated',format:'number'},{key:'dispatched',label:'Dispatched',format:'number'},{key:'delivered',label:'Delivered',format:'number'},{key:'backorder',label:'Backorder',format:'number'},{key:'invoicedValue',label:'Invoiced',format:'currency'},{key:'ageDays',label:'Age days',format:'number'}],['ageDays','backorder','invoicedValue','order'])};
  }

  private async auditQuality({ args, definition, range }: any) {
    const current={gte:range.from,lte:range.to};const [events,users,sessions,documents,products,notifications,labels]=await Promise.all([(this.prisma as any).auditEvent.findMany({where:{createdAt:current},orderBy:{createdAt:'desc'},take:5000}),(this.prisma as any).user.findMany({select:{id:true,name:true,role:true,active:true,passwordChangedAt:true,permissionOverrides:true}}),(this.prisma as any).session.findMany({select:{userId:true,expiresAt:true}}),(this.prisma as any).documentJob.findMany({where:{createdAt:current}}),this.prisma.product.findMany({select:{id:true,sku:true,name:true,category:true,brand:true,finish:true,status:true}}),(this.prisma as any).notification.findMany({where:{createdAt:current}}),(this.prisma as any).internalLabelInstance.findMany({where:{createdAt:current}}).catch(()=>[])]);
    const actorIds=Array.from(new Set<string>(events.map((row:any)=>String(row.actorUserId||'')).filter(Boolean)));const actors=actorIds.length?await this.prisma.user.findMany({where:{id:{in:actorIds}},select:{id:true,name:true}}):[];const actorMap=new Map(actors.map((row:any)=>[row.id,row.name]));const actionMix=new Map<string,any>();events.forEach((row:any)=>{const item=actionMix.get(row.action)||{label:row.action,value:0};item.value+=1;actionMix.set(row.action,item)});const incomplete=products.filter((row:any)=>!row.category||!row.brand||!row.name||!row.sku);const failedDocuments=documents.filter((row:any)=>row.status==='failed');const expiredSessions=sessions.filter((row:any)=>row.expiresAt<new Date()).length;const unread=notifications.filter((row:any)=>!row.readAt).length;
    const rows=events.map((row:any)=>({createdAt:row.createdAt.toISOString(),actor:actorMap.get(row.actorUserId)||row.actorUserId||'System',action:row.action,entityType:row.entityType,entityId:row.entityId,summary:row.summary||'',href:row.entityType&&row.entityId?`/dashboard/audit?entityType=${encodeURIComponent(row.entityType)}&entityId=${encodeURIComponent(row.entityId)}`:'/dashboard/audit'}));
    return{meta:this.meta(definition,{coverage:100,coverageLabel:'Current authoritative audit/system records',warnings:['Master-data readiness reports only fields with an explicit current requirement; category-specific completeness policy remains Needs setup.']}),range:range.labels,filters:args.filters,summary:[this.summary('events','Audit events',events.length,events.length,'number','Audit events created in period.'),this.summary('failures','Failed documents',failedDocuments.length,failedDocuments.length,'number','DocumentJob rows in failed status.'),this.summary('users','Active users',users.filter((row:any)=>row.active).length,users.filter((row:any)=>row.active).length,'number','Active user accounts.'),this.summary('sessions','Expired sessions',expiredSessions,expiredSessions,'number','Session rows past expiry pending normal cleanup.'),this.summary('incomplete','Basic product exceptions',incomplete.length,incomplete.length,'number','Products missing SKU, name, category or brand.'),this.summary('unread','Unread notifications',unread,unread,'number','Notifications without readAt in period.'),this.summary('labels','Labels created',labels.length,labels.length,'number','Internal label instances created in period.')],trend:events.map((row:any)=>({date:indiaDay(row.createdAt),value:1,action:row.action})),breakdowns:[{id:'actions',title:'Audit actions',kind:'pareto',rows:Array.from(actionMix.values()).sort((a:any,b:any)=>b.value-a.value).slice(0,20)},{id:'roles',title:'Users by role',kind:'composition',rows:Object.entries(users.reduce((acc:any,row:any)=>{acc[row.role]=(acc[row.role]||0)+1;return acc},{})).map(([label,value])=>({label,value}))}],rows:this.paginate(rows,args,[{key:'createdAt',label:'Timestamp'},{key:'actor',label:'Actor'},{key:'action',label:'Action'},{key:'entityType',label:'Entity'},{key:'entityId',label:'Entity ID'},{key:'summary',label:'Summary'}],['createdAt','action','entityType','actor'])};
  }
}
