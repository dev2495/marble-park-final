import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { SessionUser } from '../auth/session-context';
import { customersByMobileKey, maskedMobile, mobileKey } from '../common/phone';
import { matchRank, numberVariants, phoneDigits, searchTokens } from './search-match';

export type SearchItem = { id: string; kind: string; title: string; subtitle?: string; meta?: string; href: string; rank: number; when?: string | null };
export type SearchGroup = { key: string; label: string; items: SearchItem[]; moreHref?: string };

const PER_GROUP = 5;
const FETCH = 25;
const ci = (value: string) => ({ contains: value, mode: 'insensitive' as const });
const money = (value: unknown) => {
  const amount = Number(value || 0);
  return amount ? `₹${Math.round(amount).toLocaleString('en-IN')}` : '';
};
const day = (value: unknown) => (value ? new Date(value as any).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '');
const words = (value: unknown) => String(value || '').replace(/_/g, ' ');
const join = (...parts: unknown[]) => parts.map((part) => String(part ?? '').trim()).filter(Boolean).join(' · ');

/**
 * Who may see which group: the same rule as the navigation (role listed for the
 * page, or the page's permission), so search never shows what a page would not.
 */
function can(user: SessionUser, roles: string[], permissions: string[] = []) {
  return roles.includes(user.role) || permissions.some((key) => (user.effectivePermissions as string[]).includes(key));
}
const privileged = (user: SessionUser) => ['admin', 'owner', 'sales_manager'].includes(user.role);

@Injectable()
export class SearchService {
  constructor(private prisma: PrismaService) {}

  /** Product lookup used by quote, order, intent and procurement pickers. Unchanged behaviour. */
  async products(query: string) {
    const q = String(query || '').trim();
    if (q.length < 1) return [];
    const normalized = q.toUpperCase();
    return this.prisma.product.findMany({
      where: {
        OR: [
          { name: ci(q) }, { sku: ci(q) }, { internalCode: ci(q) }, { brand: ci(q) },
          { aliases: { some: { normalizedValue: { contains: normalized }, status: 'active' } } },
        ],
      },
      select: {
        id: true, sku: true, internalCode: true, name: true, category: true, brand: true, finish: true,
        dimensions: true, unit: true, baseUom: true, purchaseUom: true, salesUom: true,
        piecesPerPack: true, coveragePerPack: true, allowLoose: true, media: true, status: true,
        defaultMrpInclusive: true, defaultNrpInclusive: true, priceRateBasis: true, priceUom: true,
        mrpSource: true, pricingEffectiveFrom: true, pricingVersion: true,
      },
      orderBy: [{ internalCode: 'asc' }, { name: 'asc' }],
      take: 20,
    });
  }

  /** Header search: every record a person can open, grouped, best match first. */
  async everything(queryInput: string, user: SessionUser): Promise<SearchGroup[]> {
    const query = String(queryInput || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (query.length < 2) return [];
    const tokens = searchTokens(query);
    const numbers = numberVariants(query);
    const digits = phoneDigits(query);
    const phoneCustomerIds = mobileKey(digits) ? (await customersByMobileKey(this.prisma, digits, { take: 20 })).map((row: any) => row.id) : [];
    const ctx = { query, tokens, numbers, digits, phoneCustomerIds, user };
    const groups: Array<[boolean, () => Promise<SearchGroup | null>]> = [
      [can(user, ['admin', 'owner', 'sales_manager', 'sales', 'dispatch_ops', 'office_staff']), () => this.customers(ctx)],
      [can(user, ['admin', 'owner', 'sales_manager', 'sales', 'office_staff'], ['quotes.manage']), () => this.quotes(ctx)],
      [can(user, ['admin', 'owner', 'sales_manager', 'sales', 'office_staff', 'dispatch_ops']), () => this.orders(ctx)],
      [can(user, ['admin', 'owner', 'sales_manager', 'sales', 'office_staff']), () => this.leads(ctx)],
      [can(user, ['admin', 'owner', 'sales_manager', 'sales', 'inventory_manager', 'office_staff'], ['products.manage']), () => this.catalogue(ctx)],
      [can(user, ['admin', 'owner', 'dispatch_ops', 'sales_manager', 'office_staff'], ['dispatch.manage']), () => this.dispatch(ctx)],
      [can(user, ['admin', 'owner'], ['payments.manage']), () => this.money(ctx)],
      [can(user, ['admin', 'owner', 'inventory_manager', 'office_staff'], ['procurement.manage']), () => this.purchasing(ctx)],
      [can(user, ['admin', 'owner', 'sales_manager', 'sales', 'inventory_manager', 'office_staff'], ['master_data.manage', 'quotes.manage']), () => this.architects(ctx)],
      [can(user, ['admin', 'owner', 'inventory_manager', 'sales_manager', 'office_staff'], ['inventory.manage', 'returns.manage']), () => this.stock(ctx)],
      [can(user, [], ['documents.view']), () => this.documents(ctx)],
      [can(user, ['admin', 'owner', 'sales_manager', 'sales', 'office_staff']), () => this.walkIns(ctx)],
      [can(user, [], ['users.manage']), () => this.users(ctx)],
    ];
    const results = await Promise.all(groups.filter(([allowed]) => allowed).map(([, load]) => load().catch((error) => {
      // One broken group must not take the whole search box down.
      console.error('[search] group failed', error?.message || error);
      return null;
    })));
    return results.filter((group): group is SearchGroup => Boolean(group && group.items.length));
  }

  /** Every word must match one of the fields (in any order); a number or phone match also counts. */
  private tokenWhere(tokens: string[], fields: (token: string) => any[], extra: any[] = []) {
    const words = { AND: tokens.map((token) => ({ OR: fields(token) })) };
    return extra.length ? { OR: [words, ...extra] } : words;
  }

  /**
   * Number-shaped queries ("qt 2026 8") also match many records word by word,
   * so the exact document could fall outside the batch that gets ranked.
   * Fetch number matches on their own first, then the word matches, and merge.
   */
  private async numberFirst<T extends { id: string }>(ctx: any, field: string, scope: any, find: (where: any) => Promise<T[]>, wordWhere: any) {
    const byNumber = ctx.numbers.length ? await find({ AND: [scope, { OR: ctx.numbers.map((n: string) => ({ [field]: ci(n) })) }] }) : [];
    const byWords = await find({ AND: [scope, wordWhere] });
    const seen = new Set<string>();
    return [...byNumber, ...byWords].filter((row) => (seen.has(row.id) ? false : (seen.add(row.id), true)));
  }

  private finish(key: string, label: string, items: SearchItem[], moreHref?: string): SearchGroup {
    const sorted = items.sort((a, b) => b.rank - a.rank || String(b.when || '').localeCompare(String(a.when || '')));
    return { key, label, items: sorted.slice(0, PER_GROUP), moreHref: sorted.length > PER_GROUP ? moreHref : undefined };
  }

  private async customerNames(ids: unknown[]) {
    const unique = Array.from(new Set(ids.filter(Boolean) as string[]));
    if (!unique.length) return new Map<string, any>();
    const rows = await this.prisma.customer.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, mobile: true, city: true } });
    return new Map(rows.map((row) => [row.id, row]));
  }

  private customerFilter(ctx: any) {
    const or: any[] = [];
    if (ctx.phoneCustomerIds.length) or.push({ customerId: { in: ctx.phoneCustomerIds } });
    else if (ctx.digits) or.push({ customer: { mobile: { contains: ctx.digits } } });
    return or;
  }

  private async customers(ctx: any) {
    const extra: any[] = [];
    if (ctx.phoneCustomerIds.length) extra.push({ id: { in: ctx.phoneCustomerIds } });
    else if (ctx.digits) extra.push({ mobile: { contains: ctx.digits } });
    const rows = await this.prisma.customer.findMany({
      where: this.tokenWhere(ctx.tokens, (t) => [{ name: ci(t) }, { email: ci(t) }, { city: ci(t) }, { gstNo: ci(t.replace(/\s+/g, '')) }, { architectName: ci(t) }, { siteAddress: ci(t) }], extra),
      select: { id: true, name: true, mobile: true, city: true, gstNo: true, updatedAt: true }, take: FETCH, orderBy: { updatedAt: 'desc' },
    });
    return this.finish('customers', 'Customers', rows.map((row) => ({
      id: row.id, kind: 'customer', title: row.name, subtitle: join(maskedMobile(row.mobile), row.city, row.gstNo ? `GST ${row.gstNo}` : ''),
      href: `/dashboard/customers?search=${encodeURIComponent(mobileKey(row.mobile) || row.name)}`,
      rank: Math.max(matchRank(ctx.query, [row.name, row.gstNo]), ctx.phoneCustomerIds.includes(row.id) ? 100 : 0), when: row.updatedAt.toISOString(),
    })), `/dashboard/customers?search=${encodeURIComponent(ctx.query)}`);
  }

  private async quotes(ctx: any) {
    const user: SessionUser = ctx.user;
    const seeAll = privileged(user) || user.role === 'office_staff' || (user.effectivePermissions as string[]).includes('quotes.manage');
    const rows: any[] = await this.numberFirst(ctx, 'quoteNumber', seeAll ? {} : { ownerId: user.id }, (where) => this.prisma.quote.findMany({
      where, take: FETCH, orderBy: { updatedAt: 'desc' },
      select: { id: true, quoteNumber: true, status: true, commercialTotal: true, updatedAt: true, supersededByQuoteId: true, projectName: true, customer: { select: { name: true, mobile: true } } },
    } as any) as any, this.tokenWhere(ctx.tokens, (t) => [{ quoteNumber: ci(t) }, { title: ci(t) }, { projectName: ci(t) }, { architectName: ci(t) }, { customer: { name: ci(t) } }], this.customerFilter(ctx)));
    return this.finish('quotes', 'Quotes', rows.map((row) => ({
      id: row.id, kind: 'quote', title: row.quoteNumber, subtitle: join(row.customer?.name, maskedMobile(row.customer?.mobile), row.projectName),
      meta: join(row.supersededByQuoteId ? 'replaced' : words(row.status), money(row.commercialTotal)), href: `/dashboard/quotes/${row.id}`,
      rank: matchRank(ctx.query, [row.quoteNumber]) + (row.supersededByQuoteId ? -5 : 0), when: row.updatedAt.toISOString(),
    })), `/dashboard/quotes?search=${encodeURIComponent(ctx.query)}`);
  }

  private async orders(ctx: any) {
    const user: SessionUser = ctx.user;
    const seeAll = privileged(user) || ['office_staff', 'dispatch_ops'].includes(user.role);
    const rows: any[] = await this.numberFirst(ctx, 'orderNumber', seeAll ? {} : { ownerId: user.id }, (where) => this.prisma.salesOrder.findMany({
      where, take: FETCH, orderBy: { createdAt: 'desc' },
      select: { id: true, orderNumber: true, status: true, totalAmount: true, createdAt: true, customer: { select: { name: true, mobile: true } } },
    }) as any, this.tokenWhere(ctx.tokens, (t) => [{ orderNumber: ci(t) }, { customer: { name: ci(t) } }], this.customerFilter(ctx)));
    return this.finish('orders', 'Sales orders', rows.map((row) => ({
      id: row.id, kind: 'order', title: row.orderNumber, subtitle: join(row.customer?.name, maskedMobile(row.customer?.mobile)), meta: join(words(row.status), money(row.totalAmount)),
      href: `/dashboard/orders?search=${encodeURIComponent(row.orderNumber)}`, rank: matchRank(ctx.query, [row.orderNumber]), when: row.createdAt.toISOString(),
    })), `/dashboard/orders?search=${encodeURIComponent(ctx.query)}`);
  }

  private async leads(ctx: any) {
    const user: SessionUser = ctx.user;
    const seeAll = privileged(user) || user.role === 'office_staff';
    const rows: any[] = await this.prisma.lead.findMany({
      where: { AND: [seeAll ? {} : { ownerId: user.id }, this.tokenWhere(ctx.tokens, (t) => [{ title: ci(t) }, { source: ci(t) }, { customer: { name: ci(t) } }], this.customerFilter(ctx))] },
      take: FETCH, orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, stage: true, updatedAt: true, customer: { select: { name: true, mobile: true } } },
    });
    return this.finish('leads', 'Leads', rows.map((row) => ({
      id: row.id, kind: 'lead', title: row.title, subtitle: join(row.customer?.name, maskedMobile(row.customer?.mobile)), meta: words(row.stage),
      href: `/dashboard/leads/${row.id}`, rank: matchRank(ctx.query, [row.title]), when: row.updatedAt.toISOString(),
    })), `/dashboard/leads`);
  }

  private async catalogue(ctx: any) {
    const upper = (t: string) => t.toUpperCase();
    const rows: any[] = await this.prisma.product.findMany({
      where: {
        status: 'active',
        ...this.tokenWhere(ctx.tokens, (t) => [
          { sku: ci(t) }, { internalCode: ci(t) }, { name: ci(t) }, { brand: ci(t) }, { category: ci(t) }, { finish: ci(t) }, { dimensions: ci(t) },
          { aliases: { some: { normalizedValue: { contains: upper(t) }, status: 'active' } } },
          { tileDesignMaster: { OR: [{ name: ci(t) }, { designCode: ci(t) }, { collection: ci(t) }, { colour: ci(t) }] } },
        ], [{ sku: ci(ctx.query.replace(/\s+/g, '-')) }, { aliases: { some: { normalizedValue: { contains: upper(ctx.query).replace(/\s+/g, '-') }, status: 'active' } } }]),
      } as any,
      take: FETCH, orderBy: [{ internalCode: 'asc' }, { name: 'asc' }],
      select: { id: true, sku: true, internalCode: true, name: true, brand: true, category: true, dimensions: true, finish: true, defaultMrpInclusive: true },
    });
    return this.finish('products', 'Products & tiles', rows.map((row) => ({
      id: row.id, kind: 'product', title: join(row.internalCode || row.sku, row.name), subtitle: join(row.brand, row.category, row.dimensions, row.finish),
      meta: Number(row.defaultMrpInclusive) ? `MRP ${money(row.defaultMrpInclusive)}` : '', href: `/dashboard/products?product=${row.id}`,
      rank: matchRank(ctx.query, [row.sku, row.internalCode]) + (matchRank(ctx.query, [row.name]) >= 60 ? 10 : 0),
    })), `/dashboard/products`);
  }

  private async dispatch(ctx: any) {
    const rows: any[] = await this.numberFirst(ctx, 'challanNumber', {}, (where) => this.prisma.dispatchChallan.findMany({
      where, take: FETCH, orderBy: { createdAt: 'desc' },
      select: { id: true, challanNumber: true, status: true, vehicleNumber: true, createdAt: true, customer: { select: { name: true, mobile: true } } },
    }) as any, this.tokenWhere(ctx.tokens, (t) => [{ challanNumber: ci(t) }, { vehicleNumber: ci(t) }, { vehicleNumber: ci(t.replace(/[\s-]+/g, '')) }, { driverName: ci(t) }, { transporterName: ci(t) }, { customer: { name: ci(t) } }],
      [...this.customerFilter(ctx), ...(ctx.digits ? [{ contactPhone: { contains: ctx.digits } }] : [])]));
    return this.finish('dispatch', 'Dispatch', rows.map((row) => ({
      id: row.id, kind: 'challan', title: row.challanNumber, subtitle: join(row.customer?.name, maskedMobile(row.customer?.mobile), row.vehicleNumber), meta: words(row.status),
      href: `/dashboard/dispatch?search=${encodeURIComponent(row.challanNumber)}`, rank: matchRank(ctx.query, [row.challanNumber, row.vehicleNumber]), when: row.createdAt.toISOString(),
    })), `/dashboard/dispatch?search=${encodeURIComponent(ctx.query)}`);
  }

  private async money(ctx: any) {
    const customerIds = ctx.phoneCustomerIds.length ? [{ customerId: { in: ctx.phoneCustomerIds } }] : [];
    const [invoices, payments]: any[] = await Promise.all([
      (this.prisma as any).salesInvoice.findMany({ where: { OR: [...[ctx.query, ...ctx.numbers].map((n: string) => ({ invoiceNumber: ci(n) })), ...customerIds] }, take: FETCH, orderBy: { createdAt: 'desc' }, select: { id: true, invoiceNumber: true, customerId: true, status: true, totalAmount: true, openAmount: true, createdAt: true } }),
      (this.prisma as any).customerPayment.findMany({ where: { OR: [...[ctx.query, ...ctx.numbers].map((n: string) => ({ receiptNumber: ci(n) })), { reference: ci(ctx.query) }, ...customerIds] }, take: FETCH, orderBy: { createdAt: 'desc' }, select: { id: true, receiptNumber: true, customerId: true, status: true, amount: true, reference: true, paymentMode: true, createdAt: true } }),
    ]);
    const names = await this.customerNames([...invoices, ...payments].map((row: any) => row.customerId));
    const who = (id: string) => { const c = names.get(id); return c ? join(c.name, maskedMobile(c.mobile)) : ''; };
    return this.finish('money', 'Invoices & payments', [
      ...invoices.map((row: any) => ({ id: row.id, kind: 'invoice', title: row.invoiceNumber, subtitle: who(row.customerId), meta: join('Invoice', words(row.status), money(row.totalAmount), Number(row.openAmount) ? `${money(row.openAmount)} open` : ''), href: `/dashboard/payments?customerId=${row.customerId}`, rank: matchRank(ctx.query, [row.invoiceNumber]), when: row.createdAt.toISOString() })),
      ...payments.map((row: any) => ({ id: row.id, kind: 'payment', title: row.receiptNumber, subtitle: join(who(row.customerId), row.reference ? `Ref ${row.reference}` : ''), meta: join('Receipt', words(row.paymentMode), money(row.amount)), href: `/dashboard/payments?customerId=${row.customerId}`, rank: matchRank(ctx.query, [row.receiptNumber, row.reference]), when: row.createdAt.toISOString() })),
    ], `/dashboard/payments`);
  }

  private async purchasing(ctx: any) {
    const [orders, receipts, vendors]: any[] = await Promise.all([
      this.prisma.purchaseOrder.findMany({ where: this.tokenWhere(ctx.tokens, (t) => [{ poNumber: ci(t) }, { vendorName: ci(t) }], ctx.numbers.map((n: string) => ({ poNumber: ci(n) }))), take: FETCH, orderBy: { createdAt: 'desc' }, select: { id: true, poNumber: true, vendorName: true, status: true, grandTotal: true, createdAt: true } }),
      this.prisma.goodsReceiptNote.findMany({ where: this.tokenWhere(ctx.tokens, (t) => [{ grnNumber: ci(t) }, { vendorName: ci(t) }, { supplierChallan: ci(t) }, { supplierBill: ci(t) }], ctx.numbers.map((n: string) => ({ grnNumber: ci(n) }))), take: FETCH, orderBy: { createdAt: 'desc' }, select: { id: true, grnNumber: true, vendorName: true, supplierBill: true, supplierChallan: true, status: true, receivedDate: true, createdAt: true } }),
      this.prisma.vendor.findMany({ where: this.tokenWhere(ctx.tokens, (t) => [{ name: ci(t) }, { contactPerson: ci(t) }, { city: ci(t) }, { gstNo: ci(t) }, { email: ci(t) }], ctx.digits ? [{ phone: { contains: ctx.digits } }] : []), take: FETCH, select: { id: true, name: true, city: true, phone: true, contactPerson: true, updatedAt: true } }),
    ]);
    return this.finish('purchasing', 'Purchasing', [
      ...orders.map((row: any) => ({ id: row.id, kind: 'po', title: row.poNumber, subtitle: row.vendorName, meta: join('Purchase order', words(row.status), money(row.grandTotal)), href: `/dashboard/procurement?view=orders&search=${encodeURIComponent(row.poNumber)}`, rank: matchRank(ctx.query, [row.poNumber]), when: row.createdAt.toISOString() })),
      ...receipts.map((row: any) => ({ id: row.id, kind: 'grn', title: row.grnNumber, subtitle: join(row.vendorName, row.supplierBill ? `Bill ${row.supplierBill}` : '', row.supplierChallan ? `Challan ${row.supplierChallan}` : ''), meta: join('Goods received', day(row.receivedDate)), href: `/dashboard/procurement?view=receiving&search=${encodeURIComponent(row.grnNumber)}`, rank: matchRank(ctx.query, [row.grnNumber, row.supplierBill, row.supplierChallan]), when: row.createdAt.toISOString() })),
      ...vendors.map((row: any) => ({ id: row.id, kind: 'vendor', title: row.name, subtitle: join(row.contactPerson, row.city, maskedMobile(row.phone)), meta: 'Vendor', href: `/dashboard/master-data/vendors?search=${encodeURIComponent(row.name)}`, rank: matchRank(ctx.query, [row.name]), when: row.updatedAt.toISOString() })),
    ], `/dashboard/procurement?search=${encodeURIComponent(ctx.query)}`);
  }

  private async architects(ctx: any) {
    const rows = await this.prisma.architect.findMany({
      where: this.tokenWhere(ctx.tokens, (t) => [{ name: ci(t) }, { firmName: ci(t) }, { city: ci(t) }, { email: ci(t) }, { registrationNo: ci(t) }], ctx.digits ? [{ phone: { contains: ctx.digits } }] : []),
      take: FETCH, select: { id: true, name: true, firmName: true, city: true, phone: true, updatedAt: true },
    });
    return this.finish('architects', 'Architects', rows.map((row) => ({
      id: row.id, kind: 'architect', title: row.name, subtitle: join(row.firmName, row.city, maskedMobile(row.phone)),
      href: `/dashboard/master-data/architects?search=${encodeURIComponent(row.name)}`, rank: matchRank(ctx.query, [row.name, row.firmName]), when: row.updatedAt.toISOString(),
    })), `/dashboard/master-data/architects?search=${encodeURIComponent(ctx.query)}`);
  }

  private async stock(ctx: any) {
    const user: SessionUser = ctx.user;
    const inventory = can(user, ['admin', 'owner', 'inventory_manager', 'sales_manager', 'office_staff'], ['inventory.manage']);
    const returns = can(user, ['admin', 'owner', 'inventory_manager', 'dispatch_ops', 'sales_manager'], ['returns.manage']);
    const textOrNumber = (field: string) => [...[ctx.query, ...ctx.numbers].map((n: string) => ({ [field]: ci(n) }))];
    const [lots, samples, transfers, returnRows]: any[] = await Promise.all([
      inventory ? (this.prisma as any).inventoryLot.findMany({ where: { OR: [...textOrNumber('lotNumber'), { supplierBatch: ci(ctx.query) }] }, take: FETCH, orderBy: { receivedAt: 'desc' }, select: { id: true, lotNumber: true, supplierBatch: true, receivedAt: true, product: { select: { id: true, sku: true, internalCode: true, name: true } } } }) : [],
      inventory ? this.prisma.displaySample.findMany({ where: { OR: [...textOrNumber('sampleNumber'), { internalCode: ci(ctx.query) }, { displayZone: ci(ctx.query) }] }, take: FETCH, select: { id: true, sampleNumber: true, internalCode: true, displayZone: true, status: true, productId: true, createdAt: true } }) : [],
      inventory ? (this.prisma as any).stockTransfer.findMany({ where: { OR: textOrNumber('transferNumber') }, take: FETCH, orderBy: { createdAt: 'desc' }, select: { id: true, transferNumber: true, status: true, createdAt: true } }) : [],
      returns ? (this.prisma as any).returnOrder.findMany({ where: { OR: textOrNumber('returnNumber') }, take: FETCH, orderBy: { createdAt: 'desc' }, select: { id: true, returnNumber: true, status: true, customerId: true, refundAmount: true, createdAt: true } }) : [],
    ]);
    const names = await this.customerNames(returnRows.map((row: any) => row.customerId));
    return this.finish('stock', 'Stock & returns', [
      ...lots.map((row: any) => ({ id: row.id, kind: 'lot', title: row.lotNumber, subtitle: join(row.product?.internalCode || row.product?.sku, row.product?.name, row.supplierBatch ? `Batch ${row.supplierBatch}` : ''), meta: join('Lot', day(row.receivedAt)), href: `/dashboard/inventory?search=${encodeURIComponent(row.product?.internalCode || row.product?.sku || row.lotNumber)}`, rank: matchRank(ctx.query, [row.lotNumber, row.supplierBatch]), when: new Date(row.receivedAt).toISOString() })),
      ...samples.map((row: any) => ({ id: row.id, kind: 'sample', title: row.sampleNumber, subtitle: join(row.internalCode, row.displayZone), meta: join('Display piece', words(row.status)), href: `/dashboard/inventory/display-assets?product=${row.productId}`, rank: matchRank(ctx.query, [row.sampleNumber, row.internalCode]), when: row.createdAt.toISOString() })),
      ...transfers.map((row: any) => ({ id: row.id, kind: 'transfer', title: row.transferNumber, meta: join('Transfer', words(row.status)), href: '/dashboard/inventory/transfers', rank: matchRank(ctx.query, [row.transferNumber]), when: row.createdAt.toISOString() })),
      ...returnRows.map((row: any) => ({ id: row.id, kind: 'return', title: row.returnNumber, subtitle: join(names.get(row.customerId)?.name, maskedMobile(names.get(row.customerId)?.mobile)), meta: join('Return', words(row.status), money(row.refundAmount)), href: `/dashboard/returns?search=${encodeURIComponent(row.returnNumber)}`, rank: matchRank(ctx.query, [row.returnNumber]), when: row.createdAt.toISOString() })),
    ], `/dashboard/inventory?search=${encodeURIComponent(ctx.query)}`);
  }

  private async documents(ctx: any) {
    const rows: any[] = await (this.prisma as any).vaultAsset.findMany({
      where: { status: { in: ['active', 'archived'] }, ...this.tokenWhere(ctx.tokens, (t) => [{ title: ci(t) }, { originalName: ci(t) }, { description: ci(t) }, { category: ci(t) }]) },
      take: FETCH, orderBy: { updatedAt: 'desc' }, select: { id: true, title: true, originalName: true, category: true, status: true, updatedAt: true },
    });
    return this.finish('documents', 'Documents', rows.map((row) => ({
      id: row.id, kind: 'document', title: row.title || row.originalName, subtitle: join(row.originalName !== row.title ? row.originalName : '', row.category), meta: row.status === 'archived' ? 'archived' : '',
      href: `/dashboard/documents?search=${encodeURIComponent(row.title || row.originalName)}`, rank: matchRank(ctx.query, [row.title, row.originalName]), when: row.updatedAt.toISOString(),
    })), `/dashboard/documents?search=${encodeURIComponent(ctx.query)}`);
  }

  private async walkIns(ctx: any) {
    const rows: any[] = await (this.prisma as any).showroomVisit.findMany({
      where: this.tokenWhere(ctx.tokens, (t) => [{ name: ci(t) }, { city: ci(t) }, { note: ci(t) }], ctx.digits ? [{ mobile: { contains: ctx.digits } }] : []),
      take: FETCH, orderBy: { createdAt: 'desc' }, select: { id: true, name: true, mobile: true, city: true, status: true, createdAt: true },
    });
    const istDay = (value: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(value);
    return this.finish('walkins', 'Walk-ins', rows.map((row) => ({
      id: row.id, kind: 'walkin', title: row.name, subtitle: join(maskedMobile(row.mobile), row.city), meta: join(day(row.createdAt), words(row.status)),
      href: `/dashboard/walk-ins?day=${istDay(new Date(row.createdAt))}`, rank: matchRank(ctx.query, [row.name]) + (ctx.digits && String(row.mobile).includes(ctx.digits) ? 50 : 0), when: row.createdAt.toISOString(),
    })), '/dashboard/walk-ins');
  }

  private async users(ctx: any) {
    const rows = await this.prisma.user.findMany({
      where: this.tokenWhere(ctx.tokens, (t) => [{ name: ci(t) }, { email: ci(t) }, { role: ci(t) }], ctx.digits ? [{ phone: { contains: ctx.digits } }] : []),
      take: FETCH, select: { id: true, name: true, email: true, role: true, active: true, updatedAt: true },
    });
    return this.finish('users', 'Users', rows.map((row) => ({
      id: row.id, kind: 'user', title: row.name, subtitle: join(row.email, words(row.role)), meta: row.active ? '' : 'inactive',
      href: `/dashboard/users?search=${encodeURIComponent(row.email || row.name)}`, rank: matchRank(ctx.query, [row.name, row.email]), when: row.updatedAt.toISOString(),
    })), '/dashboard/users');
  }
}
