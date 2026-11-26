import { Harness, World, Session } from '../harness';
import { itWhenBuilt } from '../support';

describe('money: invoices, credit notes, advances', () => {
  let h: Harness; let admin: Session;
  beforeAll(async () => { h = await Harness.boot(); admin = await h.as('admin'); });
  afterAll(async () => { await h.close(); });

  async function deliveredInvoicedOrder(w: World, qty = 4) {
    const order = await w.directOrder({ qty, paymentMode: 'credit' });
    const { challan } = await w.ship(order.id);
    await w.deliver(challan.id);
    const invoice = await w.invoice(order.id, challan.id);
    return { order, challan, invoice };
  }

  // C2. A return gives the customer credit against the very invoice it came from.
  it('a credit note from a return reduces the open amount of its invoice', async () => {
    const w = await h.world(admin, { stock: 10 });
    const { order, challan, invoice } = await deliveredInvoicedOrder(w);
    const before = Number((await h.prisma.salesInvoice.findUnique({ where: { id: invoice.id } }))!.openAmount);
    expect(before).toBeGreaterThan(0);
    await w.returnGoods({ challanId: challan.id, salesOrderId: order.id, qty: 1, refundAmount: before / 4, refundMode: 'store_credit' });
    const after = Number((await h.prisma.salesInvoice.findUnique({ where: { id: invoice.id } }))!.openAmount);
    expect(after).toBeCloseTo(before - before / 4, 2);
    expect(await h.prisma.creditNote.count({ where: { salesOrderId: order.id } })).toBe(1);
  });

  // C3. Goods that came back before the bill was raised are not billed.
  it('a return recorded before invoicing is not billed', async () => {
    const w = await h.world(admin, { stock: 10 });
    const order = await w.directOrder({ qty: 4, paymentMode: 'credit' });
    const { challan } = await w.ship(order.id);
    await w.deliver(challan.id);
    await w.returnGoods({ challanId: challan.id, salesOrderId: order.id, qty: 1 });
    const invoice = await w.invoice(order.id, challan.id);
    const lines = await h.prisma.salesInvoiceLine.findMany({ where: { salesInvoiceId: invoice.id } });
    expect(lines.reduce((n, l: any) => n + Number(l.quantity), 0)).toBe(3);
  });

  // C4. An advance belongs to the order it was paid for.
  it('an advance paid on one order is not eaten by the invoice of another order', async () => {
    const w = await h.world(admin, { stock: 10 });
    const orderA = await w.directOrder({ qty: 2, paymentMode: 'credit' });
    const advance = await w.receipt({ amount: 1000, salesOrderId: orderA.id });
    const orderB = await w.directOrder({ qty: 1, paymentMode: 'credit' });
    const { challan } = await w.ship(orderB.id);
    const invoiceB = await w.invoice(orderB.id, challan.id);
    const taken = await h.prisma.customerAllocation.findMany({ where: { sourceId: advance.id, salesInvoiceId: invoiceB.id, status: 'posted' } });
    expect(taken).toHaveLength(0);
    const open = Number((await h.prisma.salesInvoice.findUnique({ where: { id: invoiceB.id } }))!.openAmount);
    expect(open).toBeGreaterThan(0); // still owed: A's advance stayed with A
    const payment = await h.prisma.customerPayment.findUnique({ where: { id: advance.id } });
    expect(payment!.salesOrderId).toBe(orderA.id);
  });

  // C5. Voiding an invoice puts everything back.
  itWhenBuilt(['voidSalesInvoice', 'cancelSalesInvoice'])('voiding an invoice frees its dispatch lines for a fresh invoice and clears the receivable', async (op) => {
    const w = await h.world(admin, { stock: 10 });
    const { order, challan, invoice } = await deliveredInvoicedOrder(w);
    await admin.gql(`mutation($id: ID!, $reason: String!) { ${op}(id: $id, reason: $reason) }`, { id: invoice.id, reason: 'Wrong rate' });
    const voided = await h.prisma.salesInvoice.findUnique({ where: { id: invoice.id } });
    expect(['void', 'voided', 'cancelled']).toContain(voided!.status);
    expect(Number(voided!.openAmount)).toBe(0);
    const again = await w.invoice(order.id, challan.id); // the same goods can be billed once more
    expect(again.id).not.toBe(invoice.id);
  });

  itWhenBuilt(['voidSalesInvoice', 'cancelSalesInvoice'])('voiding a paid invoice hands the money back as customer credit', async (op) => {
    const w = await h.world(admin, { stock: 10 });
    const { invoice } = await deliveredInvoicedOrder(w);
    const total = Number(invoice.openAmount ?? invoice.totalAmount);
    const paid = await w.receipt({ amount: total, salesInvoiceId: invoice.id });
    await admin.gql(`mutation($id: ID!, $reason: String!) { ${op}(id: $id, reason: $reason) }`, { id: invoice.id, reason: 'Billed to wrong party' });
    const payment = await h.prisma.customerPayment.findUnique({ where: { id: paid.id } });
    expect(Number(payment!.unappliedAmount)).toBeCloseTo(total, 2);
    expect(Number((await h.prisma.salesInvoice.findUnique({ where: { id: invoice.id } }))!.openAmount)).toBe(0);
  });

  itWhenBuilt(['voidSalesInvoice', 'cancelSalesInvoice'])('an invoice that goods were returned against cannot be voided', async (op) => {
    const w = await h.world(admin, { stock: 10 });
    const { order, challan, invoice } = await deliveredInvoicedOrder(w);
    await w.returnGoods({ challanId: challan.id, salesOrderId: order.id, qty: 1, refundAmount: 100, refundMode: 'store_credit' });
    const r = await admin.gqlRaw(`mutation($id: ID!, $reason: String!) { ${op}(id: $id, reason: $reason) }`, { id: invoice.id, reason: 'Try to void' });
    expect(r.errors?.length).toBeGreaterThan(0);
  });

  it('the same order and goods cannot be invoiced twice', async () => {
    const w = await h.world(admin, { stock: 10 });
    const { order, challan } = await deliveredInvoicedOrder(w);
    const lines = await h.prisma.dispatchLine.findMany({ where: { challanId: challan.id } });
    const r = await admin.gqlRaw(`mutation($input: IssueSalesInvoiceInput!) { issueSalesInvoice(input: $input) }`, { input: { salesOrderId: order.id, dispatchLineIds: lines.map((l) => l.id), idempotencyKey: 'HT-DUP-' + Date.now() } });
    expect(r.errors?.length).toBeGreaterThan(0);
  });

  it('a payment cannot be allocated beyond what is owed', async () => {
    const w = await h.world(admin, { stock: 10 });
    const { invoice } = await deliveredInvoicedOrder(w, 1);
    const owed = Number((await h.prisma.salesInvoice.findUnique({ where: { id: invoice.id } }))!.openAmount);
    await w.receipt({ amount: owed + 5000, salesInvoiceId: invoice.id });
    const after = Number((await h.prisma.salesInvoice.findUnique({ where: { id: invoice.id } }))!.openAmount);
    expect(after).toBeGreaterThanOrEqual(0);
  });
});
