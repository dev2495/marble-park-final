/**
 * Money test helpers (money test lane). Kept out of harness.ts so other test lanes can edit that file freely.
 *
 *   await assertLedger(h, admin, customerId)   // call after every money scenario
 *
 * The invariant, all in paise:
 *  - ledger balance (debits - credits) = invoices not void - (receipts not void - advance refunds) - (credit notes - cash refunds)
 *  - every live invoice: open = total - posted allocations (receipts and credit notes), never negative, never over-allocated
 *  - a void invoice has nothing open and nothing allocated
 *  - no receipt or credit note is allocated above its amount, and its free amount = amount - allocated (- refunded)
 *  - statement closing balance and Customer Accounts balance equal the ledger
 *  - the one server-side "receivable" figure = sum over every account of max(0, open invoices - unused credit)
 */
import * as bcrypt from 'bcrypt';
import request = require('supertest');
import { GraphqlFailure, Harness, Session, World, stamp, uniquePhone } from './harness';

export const paise = (value: unknown) => Math.round((Number(value || 0) || 0) * 100);

export async function assertLedger(h: Harness, s: Session, customerId: string) {
  const [entries, invoices, payments, credits, allocations] = await Promise.all([
    h.prisma.customerLedgerEntry.findMany({ where: { customerId } }),
    h.prisma.salesInvoice.findMany({ where: { customerId } }),
    h.prisma.customerPayment.findMany({ where: { customerId } }),
    h.prisma.creditNote.findMany({ where: { customerId } }),
    h.prisma.customerAllocation.findMany({ where: { customerId } }),
  ]);
  const problems: string[] = [];
  const ledger = entries.reduce((sum, row: any) => sum + paise(row.debit) - paise(row.credit), 0);
  const billed = invoices.filter((row: any) => row.status !== 'void').reduce((sum, row: any) => sum + paise(row.totalAmount), 0);
  const received = payments.filter((row: any) => row.status !== 'void').reduce((sum, row: any) => sum + paise(row.amount), 0);
  const advanceRefunds = payments.filter((row: any) => row.status !== 'void').reduce((sum, row: any) => sum + paise((row.metadata as any)?.advanceRefund?.amount), 0);
  const issued = credits.filter((row: any) => row.status === 'issued');
  const credited = issued.reduce((sum, row: any) => sum + paise(row.amount), 0);
  const cashRefunds = issued.filter((row: any) => String(row.refundMode || '').toLowerCase() === 'refund').reduce((sum, row: any) => sum + paise(row.amount), 0);
  const expected = billed - (received - advanceRefunds) - (credited - cashRefunds);
  if (ledger !== expected) problems.push(`ledger balance ${ledger / 100} but documents say ${expected / 100} (billed ${billed / 100}, received ${received / 100}, advance refunds ${advanceRefunds / 100}, credit notes ${credited / 100}, cash refunds ${cashRefunds / 100})`);

  const posted = allocations.filter((row: any) => row.status === 'posted');
  const allocatedTo = (invoiceId: string) => posted.filter((row: any) => row.salesInvoiceId === invoiceId).reduce((sum, row: any) => sum + paise(row.amount), 0);
  const allocatedFrom = (type: string, id: string) => posted.filter((row: any) => row.sourceType === type && row.sourceId === id).reduce((sum, row: any) => sum + paise(row.amount), 0);
  posted.forEach((row: any) => { if (paise(row.amount) <= 0) problems.push(`allocation ${row.id} is ${row.amount}`); });
  for (const invoice of invoices as any[]) {
    const applied = allocatedTo(invoice.id);
    const open = paise(invoice.openAmount);
    const total = paise(invoice.totalAmount);
    if (invoice.status === 'void') {
      if (open !== 0 || applied !== 0) problems.push(`void invoice ${invoice.invoiceNumber} still has open ${open / 100} / allocated ${applied / 100}`);
      continue;
    }
    if (applied > total) problems.push(`invoice ${invoice.invoiceNumber} allocated ${applied / 100} above its total ${total / 100}`);
    if (open < 0) problems.push(`invoice ${invoice.invoiceNumber} open is negative`);
    if (open !== Math.max(0, total - applied)) problems.push(`invoice ${invoice.invoiceNumber} open ${open / 100} but total ${total / 100} - allocated ${applied / 100}`);
  }
  for (const payment of payments as any[]) {
    const applied = allocatedFrom('CustomerPayment', payment.id);
    const amount = paise(payment.amount);
    if (payment.status === 'void') {
      if (applied !== 0 || paise(payment.unappliedAmount) !== 0) problems.push(`void receipt ${payment.receiptNumber} still allocated ${applied / 100} / free ${payment.unappliedAmount}`);
      continue;
    }
    if (applied > amount) problems.push(`receipt ${payment.receiptNumber} allocated ${applied / 100} above its amount ${amount / 100}`);
    const refunded = paise((payment.metadata as any)?.advanceRefund?.amount);
    if (paise(payment.unappliedAmount) !== amount - applied - refunded) problems.push(`receipt ${payment.receiptNumber} free ${payment.unappliedAmount} but amount ${amount / 100} - allocated ${applied / 100} - refunded ${refunded / 100}`);
  }
  for (const credit of issued as any[]) {
    const applied = allocatedFrom('CreditNote', credit.id);
    const amount = paise(credit.amount);
    if (applied > amount) problems.push(`credit note ${credit.creditNoteNumber} allocated ${applied / 100} above ${amount / 100}`);
    const isRefund = String(credit.refundMode || '').toLowerCase() === 'refund';
    const free = isRefund ? 0 : amount - applied;
    if (paise(credit.unappliedAmount) !== free) problems.push(`credit note ${credit.creditNoteNumber} free ${credit.unappliedAmount}, expected ${free / 100}`);
  }

  // Screens: statement and Customer Accounts agree with the ledger.
  const statement = (await s.gql(`query($id: ID!) { customerStatement(customerId: $id, take: 5000) }`, { id: customerId })).customerStatement;
  if (paise(statement.closingBalance) !== ledger) problems.push(`statement closing ${statement.closingBalance} but ledger ${ledger / 100}`);
  const account = (await s.gql(`query($id: ID!) { customerAccount(customerId: $id) }`, { id: customerId })).customerAccount;
  if (paise(account.summary.balance) !== ledger) problems.push(`Customer Accounts balance ${account.summary.balance} but ledger ${ledger / 100}`);

  // The single receivable figure equals the sum over accounts.
  let skip = 0; let sumOver = 0; let kpi = 0; let total = Infinity;
  while (skip < total) {
    const page = (await s.gql(`query($take: Int, $skip: Int) { receivablesDashboard(take: $take, skip: $skip) }`, { take: 300, skip })).receivablesDashboard;
    kpi = paise(page.kpis.receivable); total = Number(page.accountsTotal || 0);
    for (const row of page.accounts as any[]) sumOver += Math.max(0, paise(row.openInvoices) - paise(row.unallocatedCredit));
    skip += 300;
    if (!page.accounts.length) break;
  }
  if (kpi !== sumOver) problems.push(`receivable tile ${kpi / 100} but the accounts add up to ${sumOver / 100}`);

  if (problems.length) throw new Error(`Ledger invariant broken for customer ${customerId}:\n - ${problems.join('\n - ')}`);
  return { ledger: ledger / 100, statement, account };
}

/** Sign in as any user (not cached), e.g. a user a test created. */
export async function loginAs(h: Harness, email: string, password: string): Promise<Session> {
  const login = await h.publicGql(`mutation($input: LoginInput!) { login(input: $input) { authenticated token user { id role } } }`, { input: { email, password } });
  if (login.errors?.length || !login.data?.login?.token) throw new GraphqlFailure(login.errors || [], login.status);
  const token: string = login.data.login.token;
  const server = h.app.getHttpServer();
  const raw = async (query: string, variables: Record<string, any> = {}) => {
    const res = await request(server).post('/graphql').set('authorization', `Bearer ${token}`).send({ query, variables });
    return { data: res.body?.data, errors: res.body?.errors as any[] | undefined, status: res.status };
  };
  return {
    role: login.data.login.user.role, email, userId: login.data.login.user.id, token, gqlRaw: raw,
    async gql(query, variables) {
      const r = await raw(query, variables);
      if (r.errors?.length || r.status >= 400) throw new GraphqlFailure(r.errors || [], r.status);
      return r.data;
    },
  };
}

/** A new user with a known password, created through the real createUser action. */
export async function createUser(h: Harness, admin: Session, role: string, password = `Money-test-${stamp()}!`) {
  const email = `ht-${stamp().toLowerCase()}@harness.test`;
  const user = (await admin.gql(`mutation($input: CreateUserInput!) { createUser(input: $input) { id email role active } }`, {
    input: { name: `Harness ${role} ${stamp()}`, email, password, role, phone: uniquePhone() },
  })).createUser;
  return { ...user, password } as { id: string; email: string; role: string; active: boolean; password: string };
}

/** Same password hashing the harness uses (test database only). */
export async function setPassword(h: Harness, userId: string, password: string) {
  await h.prisma.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(password, 4) } });
}

/** Refused for access reasons (not for "not found" or bad input). */
export function isRefused(errors?: any[]) {
  return Boolean(errors?.some((e: any) => ['FORBIDDEN', 'UNAUTHENTICATED'].includes(e?.extensions?.code) || /restricted|login required|not allowed|permission/i.test(String(e?.message || ''))));
}

// ---- money flows on a World ----

export async function newCustomer(w: World, extra: Record<string, any> = {}) {
  const c = (await w.s.gql(`mutation($input: CreateCustomerInput!) { createCustomer(input: $input) { id name } }`, {
    input: { name: `Harness customer ${w.stamp}-${stamp()}`, phone: uniquePhone(), ...extra },
  })).createCustomer;
  w.customer = c;
  return c as { id: string; name: string };
}

/** Order -> ship -> deliver. Returns the order, challan and its dispatch lines. */
export async function delivered(w: World, o: { qty?: number; lines?: any[] } = {}) {
  const order = await w.directOrder({ qty: o.qty ?? 5, lines: o.lines, paymentMode: 'credit' });
  const { challan } = await w.ship(order.id);
  await w.deliver(challan.id);
  const dispatchLines = await w.prisma.dispatchLine.findMany({ where: { challanId: challan.id }, orderBy: { createdAt: 'asc' } });
  return { order, challan, dispatchLines };
}

export async function invoiceLines(w: World, salesOrderId: string, dispatchLineIds: string[]) {
  return (await w.s.gql(`mutation($input: IssueSalesInvoiceInput!) { issueSalesInvoice(input: $input) }`, {
    input: { salesOrderId, dispatchLineIds, idempotencyKey: `HT-INV-${stamp()}` },
  })).issueSalesInvoice;
}

export function invoiceRow(w: World, id: string) {
  return w.prisma.salesInvoice.findUniqueOrThrow({ where: { id } });
}

/** A return on one dispatch line, through the real createReturnOrder action. */
export function returnRaw(w: World, o: { dispatchLine: any; challanId: string; salesOrderId?: string; qty: number; refundAmount?: number; refundMode?: string; customerId?: string | null }) {
  const input: any = {
    salesOrderId: o.salesOrderId, challanId: o.challanId, locationId: w.location.id, reason: 'Harness return',
    refundMode: o.refundMode || 'store_credit', refundAmount: o.refundAmount ?? 0, receive: true, idempotencyKey: `HT-RET-${stamp()}`,
    lines: JSON.stringify([{ dispatchLineId: o.dispatchLine.id, productId: o.dispatchLine.productId, sku: o.dispatchLine.sku, name: o.dispatchLine.name, quantity: o.qty, disposition: 'resell' }]),
  };
  if (o.customerId !== null) input.customerId = o.customerId ?? w.customer.id;
  return w.s.gqlRaw(`mutation($input: ReturnOrderInput!) { createReturnOrder(input: $input) }`, { input });
}

export async function returnOk(w: World, o: Parameters<typeof returnRaw>[1]) {
  const r = await returnRaw(w, o);
  if (r.errors?.length) throw new GraphqlFailure(r.errors, r.status);
  return r.data.createReturnOrder;
}

export async function receiptRaw(w: World, o: { amount: number; salesOrderId?: string; salesInvoiceId?: string; key?: string; receivedAt?: string; mode?: string }) {
  return w.s.gqlRaw(`mutation($input: CustomerPaymentInput!) { recordCustomerPayment(input: $input) }`, {
    input: { customerId: w.customer.id, salesOrderId: o.salesOrderId, salesInvoiceId: o.salesInvoiceId, paymentMode: o.mode || 'upi', amount: o.amount, autoAllocate: true, receivedAt: o.receivedAt, idempotencyKey: o.key || `HT-PAY-${stamp()}` },
  });
}

export async function dashboardKpis(s: Session) {
  return (await s.gql(`query { receivablesDashboard(take: 1) }`)).receivablesDashboard.kpis;
}
