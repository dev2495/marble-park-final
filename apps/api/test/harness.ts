/**
 * Integration harness: boots the real Nest app (all modules, real resolvers, real Prisma) against the
 * database in TEST_DATABASE_URL and drives it through /graphql with supertest, exactly like the web app.
 * Going through /graphql keeps role checks, validation, idempotency keys and audit entries in play.
 *
 *   const h = await Harness.boot();
 *   const admin = await h.as('admin');
 *   const w = await h.world(admin);               // product + stock + customer + owner, all unique
 *   const order = await w.directOrder({ qty: 2 });
 *   ...
 *   await h.close();
 *
 * Every record the harness makes carries a unique stamp, so specs never collide with each other or
 * with the data already in the cloned database. Specs assert against the database through `h.prisma`.
 */
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ValidationPipe, INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import request = require('supertest');
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';

export const TEST_PASSWORD = 'Harness-pass-1!';
let counter = 0;
export function stamp(): string {
  counter += 1;
  return `${Date.now().toString(36)}${counter}${Math.floor(Math.random() * 1296).toString(36)}`.toUpperCase();
}
export function uniquePhone(): string {
  return `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
}

export class GraphqlFailure extends Error {
  constructor(public errors: any[], public status: number) {
    super(errors?.map((e: any) => e.message).join('; ') || `GraphQL HTTP ${status}`);
  }
}

export interface Session {
  role: string;
  email: string;
  userId: string;
  token: string;
  /** Run a query/mutation as this user. Throws GraphqlFailure when the server returns errors. */
  gql<T = any>(query: string, variables?: Record<string, any>): Promise<T>;
  /** Same, but returns { data, errors } and never throws. Use for "this must be refused" checks. */
  gqlRaw(query: string, variables?: Record<string, any>): Promise<{ data: any; errors?: any[]; status: number }>;
}

export class Harness {
  prisma!: PrismaClient;
  app!: INestApplication;
  private sessions = new Map<string, Session>();

  static async boot(): Promise<Harness> {
    const h = new Harness();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    h.app = moduleRef.createNestApplication();
    h.app.useGlobalPipes(new ValidationPipe({ whitelist: false, transform: true }));
    await h.app.init();
    h.prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    return h;
  }

  async close() {
    await this.prisma?.$disconnect();
    await this.app?.close();
  }

  /** Anonymous call (no session), e.g. public share links and login. */
  async publicGql(query: string, variables: Record<string, any> = {}) {
    const res = await request(this.app.getHttpServer()).post('/graphql').send({ query, variables });
    return { data: res.body?.data, errors: res.body?.errors as any[] | undefined, status: res.status };
  }

  /**
   * Log in as a user with the given role. Picks the first active user with that role, gives them the
   * harness password in the TEST database only, and signs in through the real login mutation.
   */
  async as(role: string): Promise<Session> {
    const cached = this.sessions.get(role);
    if (cached) return cached;
    const user = await this.prisma.user.findFirst({ where: { role, active: true }, orderBy: { createdAt: 'asc' } });
    if (!user) throw new Error(`No active user with role "${role}" in the test database`);
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(TEST_PASSWORD, 4) } });
    const login = await this.publicGql(
      `mutation($input: LoginInput!) { login(input: $input) { authenticated token user { id } } }`,
      { input: { email: user.email, password: TEST_PASSWORD } },
    );
    if (login.errors?.length || !login.data?.login?.token) throw new GraphqlFailure(login.errors || [], login.status);
    const token: string = login.data.login.token;
    const server = this.app.getHttpServer();
    const raw = async (query: string, variables: Record<string, any> = {}) => {
      const res = await request(server).post('/graphql').set('authorization', `Bearer ${token}`).send({ query, variables });
      return { data: res.body?.data, errors: res.body?.errors as any[] | undefined, status: res.status };
    };
    const session: Session = {
      role, email: user.email, userId: user.id, token,
      gqlRaw: raw,
      async gql(query, variables) {
        const r = await raw(query, variables);
        if (r.errors?.length || r.status >= 400) throw new GraphqlFailure(r.errors || [], r.status);
        return r.data;
      },
    };
    this.sessions.set(role, session);
    return session;
  }

  /** A self-contained scenario: one product with stock, one customer, one sales owner. */
  async world(s: Session, opts: { stock?: number; unitCost?: number; rate?: number } = {}): Promise<World> {
    const w = new World(this, s);
    await w.setup(opts);
    return w;
  }
}

export class World {
  stamp = stamp();
  product!: { id: string; sku: string; name: string };
  customer!: { id: string; name: string };
  ownerId!: string;
  location!: { id: string; name: string };
  rate = 1000;
  constructor(public h: Harness, public s: Session) {}

  get prisma() { return this.h.prisma; }

  async setup(opts: { stock?: number; unitCost?: number; rate?: number } = {}) {
    this.rate = opts.rate ?? 1000;
    this.location = await this.defaultLocation();
    this.product = await this.createProduct({ rate: this.rate });
    if (opts.stock !== undefined ? opts.stock > 0 : true) {
      await this.receiveGoods({ qty: opts.stock ?? 10, unitCost: opts.unitCost ?? 700 });
    }
    this.customer = await this.createCustomer();
    const owners = (await this.s.gql(`query { salesAssignees }`)).salesAssignees;
    this.ownerId = owners[0].id;
  }

  async defaultLocation() {
    const row = await this.prisma.stockLocation.findFirst({ where: { status: 'active', code: { not: 'IN-TRANSIT' } }, orderBy: { createdAt: 'asc' } });
    if (row) return { id: row.id, name: row.name };
    // A freshly seeded database (CI) has no location yet: make the main godown through the real action.
    return this.createLocation('Main Showroom / Godown');
  }

  /** A new stock location (a second godown, a showroom, ...). */
  async createLocation(name = `Godown ${stamp()}`) {
    const code = `T${stamp()}`.slice(0, 12);
    const row = (await this.s.gql(`mutation($input: StockLocationInput!) { createStockLocation(input: $input) }`, { input: { name, code, type: 'warehouse', status: 'active' } })).createStockLocation;
    return { id: row.id as string, name: row.name as string };
  }

  async createProduct(o: { rate?: number; name?: string; unit?: string; category?: string } = {}) {
    const sku = `HT-${stamp()}`;
    const rate = o.rate ?? this.rate;
    const p = (await this.s.gql(`mutation($input: CreateProductInput!) { createProduct(input: $input) { id sku name } }`, {
      input: {
        sku, internalCode: sku, name: o.name || `Harness product ${sku}`, category: o.category || 'Faucets', brand: 'Harness', finish: 'Chrome',
        unit: o.unit || 'PC', defaultMrpInclusive: Math.round(rate * 1.18), defaultNrpInclusive: rate, floorPriceInclusive: Math.round(rate * 0.8),
        priceRateBasis: 'PIECE', mrpSource: 'MANUAL', taxClass: 'GST_18',
      },
    })).createProduct;
    return p as { id: string; sku: string; name: string };
  }

  /** Opening stock / goods in. Creates one lot at the given location. Returns the goods receipt. */
  async receiveGoods(o: { qty: number; unitCost?: number; productId?: string; locationId?: string; key?: string }) {
    return (await this.s.gql(`mutation($input: ManualGoodsReceiptInput!) { createManualGoodsReceipt(input: $input) }`, {
      input: {
        vendorName: 'Harness vendor', locationId: o.locationId || this.location.id, reason: 'Harness opening stock',
        idempotencyKey: o.key || `HT-GRN-${stamp()}`,
        lines: JSON.stringify([{ productId: o.productId || this.product.id, receivedQuantity: o.qty, enteredUnitCost: o.unitCost ?? 700, rateUom: 'PC' }]),
      },
    })).createManualGoodsReceipt;
  }

  async createCustomer() {
    const c = (await this.s.gql(`mutation($input: CreateCustomerInput!) { createCustomer(input: $input) { id name } }`, {
      input: { name: `Harness customer ${this.stamp}-${stamp()}`, phone: uniquePhone() },
    })).createCustomer;
    return c as { id: string; name: string };
  }

  /** One quote/order line in the JSON shape the API takes. */
  line(o: { qty: number; productId?: string; sku?: string; name?: string; rate?: number; area?: string }) {
    const rate = o.rate ?? this.rate;
    return {
      productId: o.productId || this.product.id, sku: o.sku || this.product.sku, name: o.name || this.product.name,
      category: 'Faucets', brand: 'Harness', finish: 'Chrome', unit: 'PC', qty: o.qty, listPrice: rate, mrp: Math.round(rate * 1.18),
      mrpRateBasis: 'PIECE', specialRate: rate, discountPercent: 0, taxRate: 18, area: o.area || 'General Selection',
    };
  }

  /** `supersedes` makes this a revision of an earlier quote (the way the screen saves "Revise"). */
  async createQuote(lines: Array<ReturnType<World['line']>>, o: { title?: string; supersedes?: string; leadId?: string } = {}) {
    const q = (await this.s.gql(`mutation($input: CreateQuoteInput!) { createQuote(input: $input) { id status leadId quoteNumber } }`, {
      input: { customerId: this.customer.id, ownerId: this.ownerId, title: o.title || `Harness ${this.stamp}`, lines: JSON.stringify(lines), ...(o.supersedes ? { supersedesQuoteId: o.supersedes, leadId: o.leadId } : {}) },
    })).createQuote;
    return q as { id: string; status: string; leadId?: string; quoteNumber?: string };
  }

  quoteFulfillment(quoteId: string) {
    return this.s.gql(`query($id: ID!) { quoteFulfillment(quoteId: $id) }`, { id: quoteId }).then((d) => d.quoteFulfillment);
  }

  /** Convert a quote (or part of it) to an order. `picks` = quote line index -> quantity; default = what is still left to order on every line (the whole line on a fresh quote). */
  async convertQuote(quoteId: string, o: { picks?: Record<number, number>; paymentMode?: string; key?: string } = {}) {
    const f = await this.quoteFulfillment(quoteId);
    const rows = f.lines.map((l: any, i: number) => ({ quoteLineId: l.id, quantity: o.picks ? (o.picks[i] ?? 0) : Number(l.remaining ?? l.quantity) })).filter((r: any) => r.quantity > 0);
    return (await this.s.gql(`mutation($input: CreateSalesOrderInput!) { createSalesOrderFromQuote(input: $input) }`, {
      input: { quoteId, paymentMode: o.paymentMode || 'credit', lines: JSON.stringify(rows), idempotencyKey: o.key || `HT-SO-${stamp()}` },
    })).createSalesOrderFromQuote;
  }

  /** Direct order (no quote). */
  async directOrder(o: { qty?: number; lines?: Array<ReturnType<World['line']>>; advance?: number; paymentMode?: string; key?: string } = {}) {
    const lines = o.lines || [this.line({ qty: o.qty ?? 1 })];
    return (await this.s.gql(`mutation($input: CreateDirectSalesOrderInput!) { createDirectSalesOrder(input: $input) }`, {
      input: {
        customerId: this.customer.id, ownerId: this.ownerId, paymentMode: o.paymentMode || 'cash', advanceAmount: o.advance,
        paymentTerms: 'Cash on order', idempotencyKey: o.key || `HT-DO-${stamp()}`, lines: JSON.stringify(lines),
      },
    })).createDirectSalesOrder;
  }

  /** Reserve-to-pick: create the pick list and take it through start, pick, pack, complete. */
  async pick(salesOrderId: string, o: { locationId?: string } = {}) {
    const pick = (await this.s.gql(`mutation($input: CreatePickListInput!) { createPickList(input: $input) }`, { input: { salesOrderId, locationId: o.locationId || this.location.id } })).createPickList;
    const t = (action: string, input: any = {}) => this.s.gql(`mutation($id: ID!, $action: String!, $input: PickListTransitionInput) { transitionPickList(id: $id, action: $action, input: $input) }`, { id: pick.id, action, input });
    await t('start');
    await t('pick', { lines: JSON.stringify(pick.lines.map((l: any) => ({ pickLineId: l.id, pickedQuantity: Number(l.requestedQuantity) }))) });
    await t('pack', { lines: JSON.stringify(pick.lines.map((l: any) => ({ pickLineId: l.id, packedQuantity: Number(l.requestedQuantity) }))) });
    await t('complete');
    return pick as { id: string; lines: any[] };
  }

  async challan(salesOrderId: string, pickListId: string) {
    const job = await this.prisma.dispatchJob.findUnique({ where: { salesOrderId } });
    if (!job) throw new Error('Order has no dispatch job');
    return (await this.s.gql(`mutation($input: CreateChallanInput!) { createChallan(input: $input) { id status quoteId salesOrderId } }`, {
      input: { jobId: job.id, salesOrderId, pickListId, driverName: 'Harness driver', driverPhone: '9000000001', vehicleNo: 'GJ-00-HT', packages: 1 },
    })).createChallan as { id: string; status: string };
  }

  async dispatch(challanId: string) {
    return (await this.s.gql(`mutation($id: ID!, $status: String!) { updateChallanStatus(id: $id, status: $status) { id status } }`, { id: challanId, status: 'dispatched' })).updateChallanStatus;
  }

  async deliver(challanId: string) {
    return (await this.s.gql(`mutation($id: ID!, $input: ConfirmDeliveryInput!) { confirmDelivery(id: $id, input: $input) }`, {
      id: challanId, input: { receivedByName: 'Harness recipient', receivedByPhone: '9000000002', proofType: 'otp', notes: 'harness' },
    })).confirmDelivery;
  }

  /** Whole path from a confirmed order to dispatched goods: pick, challan, dispatch. */
  async ship(salesOrderId: string) {
    const pick = await this.pick(salesOrderId);
    const challan = await this.challan(salesOrderId, pick.id);
    await this.dispatch(challan.id);
    return { pick, challan };
  }

  async invoice(salesOrderId: string, challanId: string) {
    const lines = await this.prisma.dispatchLine.findMany({ where: { challanId } });
    return (await this.s.gql(`mutation($input: IssueSalesInvoiceInput!) { issueSalesInvoice(input: $input) }`, {
      input: { salesOrderId, dispatchLineIds: lines.map((l) => l.id), idempotencyKey: `HT-INV-${stamp()}` },
    })).issueSalesInvoice;
  }

  async receipt(o: { amount: number; salesOrderId?: string; salesInvoiceId?: string; mode?: string }) {
    return (await this.s.gql(`mutation($input: CustomerPaymentInput!) { recordCustomerPayment(input: $input) }`, {
      input: { customerId: this.customer.id, salesOrderId: o.salesOrderId, salesInvoiceId: o.salesInvoiceId, paymentMode: o.mode || 'upi', amount: o.amount, autoAllocate: true, idempotencyKey: `HT-PAY-${stamp()}` },
    })).recordCustomerPayment;
  }

  /** Customer return of dispatched goods. */
  async returnGoods(o: { challanId: string; salesOrderId: string; qty: number; refundAmount?: number; refundMode?: string }) {
    const line = await this.prisma.dispatchLine.findFirst({ where: { challanId: o.challanId } });
    if (!line) throw new Error('Challan has no dispatch line');
    return (await this.s.gql(`mutation($input: ReturnOrderInput!) { createReturnOrder(input: $input) }`, {
      input: {
        salesOrderId: o.salesOrderId, challanId: o.challanId, customerId: this.customer.id, locationId: this.location.id, reason: 'Harness return',
        refundMode: o.refundMode || 'store_credit', refundAmount: o.refundAmount ?? 0, receive: true, idempotencyKey: `HT-RET-${stamp()}`,
        lines: JSON.stringify([{ dispatchLineId: line.id, productId: line.productId, sku: this.product.sku, name: this.product.name, quantity: o.qty, disposition: 'resell' }]),
      },
    })).createReturnOrder;
  }

  cancelQuote(quoteId: string, reason = 'Harness cancel') {
    return this.s.gql(`mutation($id: ID!, $reason: String!) { cancelQuote(id: $id, reason: $reason) { id status } }`, { id: quoteId, reason }).then((d) => d.cancelQuote);
  }

  // ---- read helpers (straight from the database) ----
  order(id: string) { return this.prisma.salesOrder.findUnique({ where: { id } }); }
  reservations(salesOrderId: string) { return this.prisma.reservation.findMany({ where: { salesOrderId } }); }
  async balance(productId = this.product.id) {
    const b: any = await this.prisma.inventoryBalance.findUnique({ where: { productId } });
    return { onHand: Number(b?.onHand ?? 0), reserved: Number(b?.reserved ?? 0), available: Number(b?.available ?? 0) };
  }

  // ---- sales helpers (added by the sales test lane) ----
  /** Cancel one sales order through the real action. Returns the action's JSON result. */
  cancelOrder(salesOrderId: string, reason = 'Harness order cancel') {
    return this.s.gql(`mutation($id: ID!, $reason: String!) { cancelSalesOrder(id: $id, reason: $reason) }`, { id: salesOrderId, reason }).then((d) => d.cancelSalesOrder);
  }

  /** A quote on a given lead (a second quote for the same enquiry). */
  async createQuoteOnLead(leadId: string, lines: Array<ReturnType<World['line']>>, extra: Record<string, any> = {}) {
    return (await this.s.gql(`mutation($input: CreateQuoteInput!) { createQuote(input: $input) { id status leadId quoteNumber updatedAt } }`, {
      input: { customerId: this.customer.id, ownerId: this.ownerId, leadId, title: `Harness ${this.stamp}`, lines: JSON.stringify(lines), ...extra },
    })).createQuote as { id: string; status: string; leadId: string; quoteNumber: string; updatedAt: string };
  }

  quoteRow(id: string) { return this.prisma.quote.findUnique({ where: { id } }); }
  quoteLines(quoteId: string) { return this.prisma.quoteLine.findMany({ where: { quoteId }, orderBy: { lineNo: 'asc' } }); }
}
