import { Harness, Session } from '../harness';
import { assertLedger, delivered, invoiceLines, invoiceRow, paise, returnOk, returnRaw, dashboardKpis } from '../money-support';

/** Returns, credit notes and cash refunds (money notes scenarios 1, 2, 3, 7 and C13). Ledger checked after each. */
describe('money: returns and credit notes', () => {
  let h: Harness; let admin: Session;
  beforeAll(async () => { h = await Harness.boot(); admin = await h.as('admin'); });
  afterAll(async () => { await h.close(); });

  const r2 = (v: number) => Math.round(v * 100) / 100;

  // Scenario 1: unpaid invoice, everything comes back as store credit.
  it('a full return with store credit clears the unpaid invoice; more than invoiced is refused', async () => {
    const w = await h.world(admin, { stock: 10 });
    const { order, challan, dispatchLines } = await delivered(w, { qty: 5 });
    const inv = await w.invoice(order.id, challan.id);
    const total = Number((await invoiceRow(w, inv.id)).totalAmount);
    expect(total).toBeGreaterThan(0);
    const tooMuch = await returnRaw(w, { dispatchLine: dispatchLines[0], challanId: challan.id, salesOrderId: order.id, qty: 5, refundAmount: total + 100 });
    expect(tooMuch.errors?.length).toBeGreaterThan(0);
    await returnOk(w, { dispatchLine: dispatchLines[0], challanId: challan.id, salesOrderId: order.id, qty: 5, refundAmount: total });
    const after = await invoiceRow(w, inv.id);
    expect(Number(after.openAmount)).toBe(0);
    expect(after.status).toBe('paid');
    const cn = await h.prisma.creditNote.findFirstOrThrow({ where: { salesOrderId: order.id } });
    expect(Number(cn.unappliedAmount)).toBe(0);
    const { ledger } = await assertLedger(h, admin, w.customer.id);
    expect(ledger).toBe(0);
  });

  it('a partial return with store credit reduces that invoice by the credit', async () => {
    const w = await h.world(admin, { stock: 10 });
    const { order, challan, dispatchLines } = await delivered(w, { qty: 5 });
    const inv = await w.invoice(order.id, challan.id);
    const total = Number((await invoiceRow(w, inv.id)).totalAmount);
    const credit = r2(total * 2 / 5);
    await returnOk(w, { dispatchLine: dispatchLines[0], challanId: challan.id, salesOrderId: order.id, qty: 2, refundAmount: credit });
    expect(paise((await invoiceRow(w, inv.id)).openAmount)).toBe(paise(total) - paise(credit));
    await assertLedger(h, admin, w.customer.id);
  });

  // Must-cover: credit capped at what is open, the excess stays as customer credit.
  it('credit above what is still open on the invoice clears it and keeps the rest as credit', async () => {
    const w = await h.world(admin, { stock: 10 });
    const { order, challan, dispatchLines } = await delivered(w, { qty: 5 });
    const inv = await w.invoice(order.id, challan.id);
    const total = Number((await invoiceRow(w, inv.id)).totalAmount);
    await w.receipt({ amount: r2(total - 300), salesInvoiceId: inv.id });
    const oneUnit = r2(total / 5);
    expect(oneUnit).toBeGreaterThan(300);
    await returnOk(w, { dispatchLine: dispatchLines[0], challanId: challan.id, salesOrderId: order.id, qty: 1, refundAmount: oneUnit });
    expect(Number((await invoiceRow(w, inv.id)).openAmount)).toBe(0);
    const cn = await h.prisma.creditNote.findFirstOrThrow({ where: { salesOrderId: order.id } });
    expect(paise(cn.unappliedAmount)).toBe(paise(oneUnit) - 30000);
    await assertLedger(h, admin, w.customer.id);
  });

  // Scenario 2: paid invoice, store credit is kept and the next invoice on the same order uses it.
  it('store credit on a paid invoice stays as credit and the next invoice of the order uses it', async () => {
    const w = await h.world(admin, { stock: 10 });
    const second = await w.createProduct();
    await w.receiveGoods({ qty: 10, productId: second.id });
    const { order, challan, dispatchLines } = await delivered(w, { lines: [w.line({ qty: 3 }), w.line({ qty: 2, productId: second.id, sku: second.sku, name: second.name })] });
    expect(dispatchLines).toHaveLength(2);
    const lineA = dispatchLines.find((l) => l.productId === w.product.id)!;
    const lineB = dispatchLines.find((l) => l.productId === second.id)!;
    const invA = await invoiceLines(w, order.id, [lineA.id]);
    const totalA = Number((await invoiceRow(w, invA.id)).totalAmount);
    await w.receipt({ amount: totalA, salesInvoiceId: invA.id });
    expect((await invoiceRow(w, invA.id)).status).toBe('paid');
    const credit = r2(totalA / 3);
    await returnOk(w, { dispatchLine: lineA, challanId: challan.id, salesOrderId: order.id, qty: 1, refundAmount: credit });
    expect((await invoiceRow(w, invA.id)).status).toBe('paid');
    const cn = await h.prisma.creditNote.findFirstOrThrow({ where: { salesOrderId: order.id } });
    expect(paise(cn.unappliedAmount)).toBe(paise(credit));
    await assertLedger(h, admin, w.customer.id);

    const invB = await invoiceLines(w, order.id, [lineB.id]);
    const rowB = await invoiceRow(w, invB.id);
    expect(paise(rowB.openAmount)).toBe(Math.max(0, paise(rowB.totalAmount) - paise(credit)));
    expect(Number((await h.prisma.creditNote.findUniqueOrThrow({ where: { id: cn.id } })).unappliedAmount)).toBe(0);
    await assertLedger(h, admin, w.customer.id);
  });

  // Scenario 3 / C13: a cash refund is money going out.
  it('a cash refund on an invoiced return is recorded as money out and leaves the invoice as it is', async () => {
    const w = await h.world(admin, { stock: 10 });
    const { order, challan, dispatchLines } = await delivered(w, { qty: 5 });
    const inv = await w.invoice(order.id, challan.id);
    const total = Number((await invoiceRow(w, inv.id)).totalAmount);
    await w.receipt({ amount: total, salesInvoiceId: inv.id });
    const before = await dashboardKpis(admin);
    await returnOk(w, { dispatchLine: dispatchLines[0], challanId: challan.id, salesOrderId: order.id, qty: 1, refundAmount: 500, refundMode: 'refund' });
    const row = await invoiceRow(w, inv.id);
    expect(row.status).toBe('paid');
    const cn = await h.prisma.creditNote.findFirstOrThrow({ where: { salesOrderId: order.id } });
    const out = await h.prisma.customerLedgerEntry.findFirstOrThrow({ where: { sourceType: 'CreditNoteRefund', sourceId: cn.id } });
    expect(Number(out.debit)).toBe(500);
    expect((out.metadata as any)?.moneyOut).toBe(true);
    const after = await dashboardKpis(admin);
    expect(paise(after.currentMonthRefunds) - paise(before.currentMonthRefunds)).toBe(50000);
    expect(paise(after.currentMonthCollections) - paise(before.currentMonthCollections)).toBe(-50000);
    const { ledger } = await assertLedger(h, admin, w.customer.id);
    expect(ledger).toBe(0);
  });

  // Scenario 7 / C5: goods back before the bill is raised.
  it('a return before invoicing is left off the bill and cannot also carry a credit', async () => {
    const w = await h.world(admin, { stock: 12 });
    const { order, challan, dispatchLines } = await delivered(w, { qty: 10 });
    const refused = await returnRaw(w, { dispatchLine: dispatchLines[0], challanId: challan.id, salesOrderId: order.id, qty: 4, refundAmount: 100 });
    expect(refused.errors?.length).toBeGreaterThan(0);
    await returnOk(w, { dispatchLine: dispatchLines[0], challanId: challan.id, salesOrderId: order.id, qty: 4 });
    const queue = (await admin.gql(`query { invoiceableOrders(take: 300) }`)).invoiceableOrders.find((row: any) => row.salesOrderId === order.id);
    expect(Number(queue.lines[0].quantity)).toBe(6);
    const inv = await w.invoice(order.id, challan.id);
    const lines = await h.prisma.salesInvoiceLine.findMany({ where: { salesInvoiceId: inv.id } });
    expect(lines.reduce((n, l: any) => n + Number(l.quantity), 0)).toBe(6);
    const orderRow = await w.order(order.id);
    expect(paise((await invoiceRow(w, inv.id)).totalAmount)).toBe(Math.round(paise(orderRow!.totalAmount) * 6 / 10));
    // The 6 billed can be credited up to their invoiced value, never more.
    const unit = Number(lines[0].grossLineTotal) / 6;
    const over = await returnRaw(w, { dispatchLine: dispatchLines[0], challanId: challan.id, salesOrderId: order.id, qty: 2, refundAmount: r2(unit * 2 + 50) });
    expect(over.errors?.length).toBeGreaterThan(0);
    // Nothing more can come back than what is still out.
    const tooMany = await returnRaw(w, { dispatchLine: dispatchLines[0], challanId: challan.id, salesOrderId: order.id, qty: 7 });
    expect(tooMany.errors?.length).toBeGreaterThan(0);
    await returnOk(w, { dispatchLine: dispatchLines[0], challanId: challan.id, salesOrderId: order.id, qty: 2, refundAmount: r2(unit * 2) });
    expect(paise((await invoiceRow(w, inv.id)).openAmount)).toBe(paise(lines[0].grossLineTotal) - paise(r2(unit * 2)));
    await assertLedger(h, admin, w.customer.id);
  });

  // Review fix: a credit note from a pre-invoice return made under the old rules is not taken off again.
  it('old data: 10 out, 2 back with store credit before invoicing; the invoice bills 8 and leaves the credit as credit', async () => {
    const w = await h.world(admin, { stock: 12 });
    const { order, challan, dispatchLines } = await delivered(w, { qty: 10 });
    const ret = await returnOk(w, { dispatchLine: dispatchLines[0], challanId: challan.id, salesOrderId: order.id, qty: 2 });
    // The old screens allowed a credit here; write it the way the old code did (credit note + ledger credit, unapplied).
    const unit = Number((await w.order(order.id))!.totalAmount) / 10;
    const amount = Math.round(unit * 2 * 100) / 100;
    const cnId = `HT-CN-${Date.now()}`;
    await h.prisma.creditNote.create({ data: { id: cnId, creditNoteNumber: `CN/HT/${Date.now()}`, returnOrderId: ret.id, salesOrderId: order.id, customerId: w.customer.id, amount, unappliedAmount: amount, refundMode: 'store_credit', status: 'issued', createdBy: admin.userId, notes: 'old rule', metadata: {}, updatedAt: new Date() } as any });
    await h.prisma.customerLedgerEntry.create({ data: { id: `HT-LE-${Date.now()}`, entryNumber: `AR/HT-${Date.now()}`, customerId: w.customer.id, sourceType: 'CreditNote', sourceId: cnId, sourceKey: `credit-note:${cnId}`, effectiveAt: new Date(), debit: 0, credit: amount, narration: 'old rule credit', createdBy: admin.userId, metadata: {} } as any });
    const inv = await w.invoice(order.id, challan.id);
    const lines = await h.prisma.salesInvoiceLine.findMany({ where: { salesInvoiceId: inv.id } });
    expect(lines.reduce((n, l: any) => n + Number(l.quantity), 0)).toBe(8);
    const row = await invoiceRow(w, inv.id);
    expect(paise(row.openAmount)).toBe(paise(row.totalAmount));
    expect(paise((await h.prisma.creditNote.findUniqueOrThrow({ where: { id: cnId } })).unappliedAmount)).toBe(paise(amount));
    await assertLedger(h, admin, w.customer.id);
  });

  it('goods returned in full before invoicing leave the invoice queue and cannot be billed', async () => {
    const w = await h.world(admin, { stock: 10 });
    const { order, challan, dispatchLines } = await delivered(w, { qty: 3 });
    await returnOk(w, { dispatchLine: dispatchLines[0], challanId: challan.id, salesOrderId: order.id, qty: 3 });
    const queue = (await admin.gql(`query { invoiceableOrders(take: 300) }`)).invoiceableOrders;
    expect(queue.find((row: any) => row.salesOrderId === order.id)).toBeUndefined();
    const r = await admin.gqlRaw(`mutation($input: IssueSalesInvoiceInput!) { issueSalesInvoice(input: $input) }`, { input: { salesOrderId: order.id, dispatchLineIds: [dispatchLines[0].id], idempotencyKey: `HT-INV-FULLRET-${Date.now()}` } });
    expect(r.errors?.length).toBeGreaterThan(0);
    await assertLedger(h, admin, w.customer.id);
  });

  // C13: the customer on a return is the order's customer.
  it('the return customer comes from the order; another customer is refused', async () => {
    const w = await h.world(admin, { stock: 10 });
    const { order, challan, dispatchLines } = await delivered(w, { qty: 4 });
    const inv = await w.invoice(order.id, challan.id);
    const other = (await admin.gql(`mutation($input: CreateCustomerInput!) { createCustomer(input: $input) { id } }`, { input: { name: `Harness other ${w.stamp}`, phone: `8${String(Date.now()).slice(-9)}` } })).createCustomer;
    const wrong = await returnRaw(w, { dispatchLine: dispatchLines[0], challanId: challan.id, salesOrderId: order.id, qty: 1, refundAmount: 100, customerId: other.id });
    expect(wrong.errors?.length).toBeGreaterThan(0);
    const created = await returnOk(w, { dispatchLine: dispatchLines[0], challanId: challan.id, salesOrderId: order.id, qty: 1, refundAmount: 100, customerId: null });
    const ret = await h.prisma.returnOrder.findUniqueOrThrow({ where: { id: created.id } });
    expect(ret.customerId).toBe(w.customer.id);
    const cn = await h.prisma.creditNote.findFirstOrThrow({ where: { returnOrderId: ret.id } });
    expect(cn.customerId).toBe(w.customer.id);
    expect(paise((await invoiceRow(w, inv.id)).openAmount)).toBe(paise((await invoiceRow(w, inv.id)).totalAmount) - 10000);
    expect(await h.prisma.customerLedgerEntry.count({ where: { customerId: other.id } })).toBe(0);
    await assertLedger(h, admin, w.customer.id);
  });

  it('an invoice with a credit note applied cannot be voided', async () => {
    const w = await h.world(admin, { stock: 10 });
    const { order, challan, dispatchLines } = await delivered(w, { qty: 4 });
    const inv = await w.invoice(order.id, challan.id);
    await returnOk(w, { dispatchLine: dispatchLines[0], challanId: challan.id, salesOrderId: order.id, qty: 1, refundAmount: 100 });
    const r = await admin.gqlRaw(`mutation($id: ID!, $reason: String!) { voidSalesInvoice(id: $id, reason: $reason) }`, { id: inv.id, reason: 'Try to void' });
    expect(r.errors?.[0]?.message).toMatch(/credit note|returned/i);
    expect((await invoiceRow(w, inv.id)).status).not.toBe('void');
    await assertLedger(h, admin, w.customer.id);
  });
});

