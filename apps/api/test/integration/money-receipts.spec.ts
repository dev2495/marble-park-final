import { Harness, Session, stamp } from '../harness';
import { itWhenBuilt } from '../support';
import { assertLedger, dashboardKpis, delivered, invoiceRow, paise, receiptRaw } from '../money-support';

/** Receipts, advances, voids, statement and the month tiles (money notes 4, 5, 6, 8, 9, C9, C15 and the gaps lane advance actions). */
describe('money: receipts, advances and voids', () => {
  let h: Harness; let admin: Session;
  beforeAll(async () => { h = await Harness.boot(); admin = await h.as('admin'); });
  afterAll(async () => { await h.close(); });

  const voidInvoice = (s: Session, id: string, reason = 'Wrong rate') => s.gqlRaw(`mutation($id: ID!, $reason: String!) { voidSalesInvoice(id: $id, reason: $reason) }`, { id, reason });
  const istDay = (offsetDays = 0) => new Date(Date.now() + 330 * 60000 + offsetDays * 86400000).toISOString().slice(0, 10);

  // Scenario 4 + must-cover: an advance belongs to its order.
  it('an advance for order Y waits for Y; X stays open; invoicing Y uses that advance first', async () => {
    const w = await h.world(admin, { stock: 10 });
    const x = await delivered(w, { qty: 2 });
    const invX = await w.invoice(x.order.id, x.challan.id);
    const y = await delivered(w, { qty: 1 });
    const advance = await w.receipt({ amount: 800, salesOrderId: y.order.id });
    expect(Number((await h.prisma.customerPayment.findUniqueOrThrow({ where: { id: advance.id } })).unappliedAmount)).toBe(800);
    const xRow = await invoiceRow(w, invX.id);
    expect(paise(xRow.openAmount)).toBe(paise(xRow.totalAmount));
    expect(Number((await w.order(y.order.id))!.advanceAmount)).toBe(800);
    await assertLedger(h, admin, w.customer.id);

    const invY = await w.invoice(y.order.id, y.challan.id);
    const used = await h.prisma.customerAllocation.findFirst({ where: { sourceId: advance.id, salesInvoiceId: invY.id, status: 'posted' } });
    expect(Number(used?.amount)).toBe(800);
    expect(paise((await invoiceRow(w, invX.id)).openAmount)).toBe(paise(xRow.totalAmount));
    await assertLedger(h, admin, w.customer.id);
  });

  // Scenario 5: money on account goes to the oldest invoice first.
  it('a receipt with no order goes to the oldest open invoice first', async () => {
    const w = await h.world(admin, { stock: 10 });
    const a = await delivered(w, { qty: 1 });
    const inv1 = await w.invoice(a.order.id, a.challan.id);
    const b = await delivered(w, { qty: 1 });
    const inv2 = await w.invoice(b.order.id, b.challan.id);
    const open1 = Number((await invoiceRow(w, inv1.id)).openAmount);
    const total2 = Number((await invoiceRow(w, inv2.id)).totalAmount);
    await w.receipt({ amount: open1 + 100 });
    expect(Number((await invoiceRow(w, inv1.id)).openAmount)).toBe(0);
    expect(paise((await invoiceRow(w, inv2.id)).openAmount)).toBe(paise(total2) - 10000);
    await assertLedger(h, admin, w.customer.id);
  });

  // Scenario 6 + must-cover: invoice void.
  it('voiding an invoice frees its receipt (still on the order) and its dispatch lines; a second void is refused', async () => {
    const w = await h.world(admin, { stock: 10 });
    const { order, challan } = await delivered(w, { qty: 2 });
    const inv = await w.invoice(order.id, challan.id);
    const total = Number((await invoiceRow(w, inv.id)).totalAmount);
    const paid = await w.receipt({ amount: total, salesInvoiceId: inv.id });
    expect((await invoiceRow(w, inv.id)).status).toBe('paid');

    const v = await voidInvoice(admin, inv.id);
    expect(v.errors).toBeUndefined();
    const voided = await invoiceRow(w, inv.id);
    expect(voided.status).toBe('void');
    const pay = await h.prisma.customerPayment.findUniqueOrThrow({ where: { id: paid.id } });
    expect(paise(pay.unappliedAmount)).toBe(paise(total));
    expect(pay.salesOrderId).toBe(order.id);
    const ord = await w.order(order.id);
    expect(ord!.paymentStatus).not.toBe('paid');
    expect(paise(ord!.advanceAmount)).toBe(paise(total));
    const queue = (await admin.gql(`query { invoiceableOrders(take: 300) }`)).invoiceableOrders;
    expect(queue.find((row: any) => row.salesOrderId === order.id)).toBeTruthy();
    await assertLedger(h, admin, w.customer.id);

    const entriesBefore = await h.prisma.customerLedgerEntry.count({ where: { customerId: w.customer.id } });
    const again = await voidInvoice(admin, inv.id, 'Second try');
    expect(again.errors?.[0]?.message).toMatch(/already void/i);
    expect(await h.prisma.customerLedgerEntry.count({ where: { customerId: w.customer.id } })).toBe(entriesBefore);

    const fresh = await w.invoice(order.id, challan.id);
    expect(fresh.id).not.toBe(inv.id);
    const freshRow = await invoiceRow(w, fresh.id);
    expect(freshRow.status).toBe('paid');
    expect(Number((await h.prisma.customerPayment.findUniqueOrThrow({ where: { id: paid.id } })).unappliedAmount)).toBe(0);
    await assertLedger(h, admin, w.customer.id);
  });

  it('voiding a receipt puts the invoice back to unpaid; only owner or admin may void', async () => {
    const w = await h.world(admin, { stock: 10 });
    const { order, challan } = await delivered(w, { qty: 2 });
    const inv = await w.invoice(order.id, challan.id);
    const total = Number((await invoiceRow(w, inv.id)).totalAmount);
    const paid = await w.receipt({ amount: total, salesInvoiceId: inv.id });
    const manager = await h.as('sales_manager');
    const refused = await manager.gqlRaw(`mutation($id: ID!, $reason: String) { voidCustomerPayment(id: $id, reason: $reason) }`, { id: paid.id, reason: 'x' });
    expect(refused.errors?.length).toBeGreaterThan(0);
    await admin.gql(`mutation($id: ID!, $reason: String) { voidCustomerPayment(id: $id, reason: $reason) }`, { id: paid.id, reason: 'Bounced cheque' });
    const row = await invoiceRow(w, inv.id);
    expect(paise(row.openAmount)).toBe(paise(total));
    expect(row.status).toBe('posted');
    expect(await h.prisma.customerAllocation.count({ where: { sourceId: paid.id, status: 'posted' } })).toBe(0);
    const { ledger } = await assertLedger(h, admin, w.customer.id);
    expect(paise(ledger)).toBe(paise(total));
  });

  // Must-cover: a double click on "Save receipt".
  it('the same receipt sent twice (same key, one after the other and at the same moment) posts once', async () => {
    const w = await h.world(admin, { stock: 10 });
    const key = `HT-PAY-DUP-${stamp()}`;
    const first = await receiptRaw(w, { amount: 300, key });
    const second = await receiptRaw(w, { amount: 300, key });
    expect(first.errors).toBeUndefined();
    expect(second.errors).toBeUndefined();
    expect(second.data.recordCustomerPayment.id).toBe(first.data.recordCustomerPayment.id);
    const key2 = `HT-PAY-DUP-${stamp()}`;
    const both = await Promise.all([receiptRaw(w, { amount: 200, key: key2 }), receiptRaw(w, { amount: 200, key: key2 })]);
    both.forEach((r) => expect(r.errors).toBeUndefined());
    expect(both[0].data.recordCustomerPayment.id).toBe(both[1].data.recordCustomerPayment.id);
    expect(await h.prisma.customerPayment.count({ where: { customerId: w.customer.id } })).toBe(2);
    expect(await h.prisma.customerLedgerEntry.count({ where: { customerId: w.customer.id, sourceType: 'CustomerPayment' } })).toBe(2);
    await assertLedger(h, admin, w.customer.id);
  });

  // Scenario 8 / C15: two cashiers at the same second.
  it('three cashiers posting receipts for one customer at the same moment all succeed with no database error', async () => {
    const w = await h.world(admin, { stock: 10 });
    const { order, challan } = await delivered(w, { qty: 3 });
    const inv = await w.invoice(order.id, challan.id);
    const total = Number((await invoiceRow(w, inv.id)).totalAmount);
    const part = Math.round(total / 2);
    const results = await Promise.all([receiptRaw(w, { amount: part }), receiptRaw(w, { amount: part }), receiptRaw(w, { amount: part })]);
    for (const r of results) {
      expect(r.errors?.map((e: any) => e.message)).toBeUndefined();
    }
    const numbers = results.map((r) => r.data.recordCustomerPayment.receiptNumber);
    expect(new Set(numbers).size).toBe(3);
    expect(Number((await invoiceRow(w, inv.id)).openAmount)).toBe(0);
    await assertLedger(h, admin, w.customer.id);
  });

  // Scenario 9 / C12: statement over a range adds up, across pages.
  it('statement for a date range: opening + entries = closing, and page 2 carries page 1 forward', async () => {
    const w = await h.world(admin, { stock: 10 });
    const old = await receiptRaw(w, { amount: 1000, receivedAt: new Date(Date.now() - 10 * 86400000).toISOString() });
    expect(old.errors).toBeUndefined();
    const { order, challan } = await delivered(w, { qty: 2 });
    const inv = await w.invoice(order.id, challan.id);
    await w.receipt({ amount: 250 });
    await w.receipt({ amount: 150 });
    const q = `query($id: ID!, $from: String, $to: String, $skip: Int, $take: Int) { customerStatement(customerId: $id, from: $from, to: $to, skip: $skip, take: $take) }`;
    const vars = { id: w.customer.id, from: istDay(-5), to: istDay(0) };
    const p1 = (await admin.gql(q, { ...vars, skip: 0, take: 2 })).customerStatement;
    const p2 = (await admin.gql(q, { ...vars, skip: 2, take: 2 })).customerStatement;
    expect(p1.openingBalance).toBe(-1000);
    expect(p1.total).toBe(3);
    expect(paise(p1.openingBalance) + paise(p1.totalDebit) - paise(p1.totalCredit)).toBe(paise(p1.closingBalance));
    expect(p1.entries).toHaveLength(2);
    expect(p2.entries).toHaveLength(1);
    expect(p2.pageOpeningBalance).toBe(p1.entries[1].runningBalance);
    expect(p2.entries[0].runningBalance).toBe(p2.closingBalance);
    const invTotal = Number((await invoiceRow(w, inv.id)).totalAmount);
    expect(paise(p2.closingBalance)).toBe(paise(invTotal) - 140000);
    const { ledger } = await assertLedger(h, admin, w.customer.id);
    expect(paise(ledger)).toBe(paise(p2.closingBalance));
  });

  // C9: billing this month counts an invoice even when it was paid the same day.
  it('billing this month includes an invoice paid the same day; collections include the receipt', async () => {
    const w = await h.world(admin, { stock: 10 });
    const before = await dashboardKpis(admin);
    const { order, challan } = await delivered(w, { qty: 2 });
    const inv = await w.invoice(order.id, challan.id);
    const total = Number((await invoiceRow(w, inv.id)).totalAmount);
    await w.receipt({ amount: total, salesInvoiceId: inv.id });
    const after = await dashboardKpis(admin);
    expect(paise(after.currentMonthBilling) - paise(before.currentMonthBilling)).toBe(paise(total));
    expect(paise(after.currentMonthReceipts) - paise(before.currentMonthReceipts)).toBe(paise(total));
    expect(paise(after.receivable)).toBe(paise(before.receivable));
    await assertLedger(h, admin, w.customer.id);
  });

  // Gaps lane: money left on a cancelled order.
  itWhenBuilt(['refundOrderAdvance'])('refunding the advance of a cancelled order records money out and the ledger balances', async (op) => {
    const w = await h.world(admin, { stock: 10 });
    const order = await w.directOrder({ qty: 1, paymentMode: 'credit' });
    const adv = await w.receipt({ amount: 700, salesOrderId: order.id });
    const refund = (reason: string) => admin.gqlRaw(`mutation($id: ID!, $reason: String!) { ${op}(paymentId: $id, reason: $reason) }`, { id: adv.id, reason });
    const live = await refund('Order still live');
    expect(live.errors?.[0]?.message).toMatch(/live order/i);
    await admin.gql(`mutation($id: ID!, $reason: String!) { cancelSalesOrder(id: $id, reason: $reason) }`, { id: order.id, reason: 'Customer changed mind' });
    const account = (await admin.gql(`query($id: ID!) { customerAccount(customerId: $id) }`, { id: w.customer.id })).customerAccount;
    expect(account.cancelledOrderAdvances.map((r: any) => r.paymentId)).toEqual([adv.id]);
    expect((await refund('')).errors?.length).toBeGreaterThan(0);
    const before = await dashboardKpis(admin);
    // Double click: two at the same moment, then a third later. One refund only.
    const both = await Promise.all([refund('Paid back in cash'), refund('Paid back in cash')]);
    both.forEach((r) => expect(r.errors?.map((e: any) => e.message)).toBeUndefined());
    const again = await refund('Paid back in cash');
    expect(again.errors).toBeUndefined();
    const accountAfter = (await admin.gql(`query($id: ID!) { customerAccount(customerId: $id) }`, { id: w.customer.id })).customerAccount;
    expect(accountAfter.cancelledOrderAdvances).toHaveLength(0);
    const outs = await h.prisma.customerLedgerEntry.findMany({ where: { sourceType: 'AdvanceRefund', sourceId: adv.id } });
    expect(outs).toHaveLength(1);
    expect(Number(outs[0].debit)).toBe(700);
    expect((outs[0].metadata as any)?.moneyOut).toBe(true);
    expect(Number((await h.prisma.customerPayment.findUniqueOrThrow({ where: { id: adv.id } })).unappliedAmount)).toBe(0);
    const after = await dashboardKpis(admin);
    expect(paise(after.currentMonthRefunds) - paise(before.currentMonthRefunds)).toBe(70000);
    const { ledger } = await assertLedger(h, admin, w.customer.id);
    expect(ledger).toBe(0);
    const manager = await h.as('sales_manager');
    expect((await manager.gqlRaw(`mutation($id: ID!, $reason: String!) { ${op}(paymentId: $id, reason: $reason) }`, { id: adv.id, reason: 'x y z' })).errors?.length).toBeGreaterThan(0);
  });

  itWhenBuilt(['moveAdvanceToAccount'])('moving the advance of a cancelled order to the account pays the oldest open invoice', async (op) => {
    const w = await h.world(admin, { stock: 10 });
    const a = await delivered(w, { qty: 2 });
    const inv = await w.invoice(a.order.id, a.challan.id);
    const total = Number((await invoiceRow(w, inv.id)).totalAmount);
    const order = await w.directOrder({ qty: 1, paymentMode: 'credit' });
    const adv = await w.receipt({ amount: 500, salesOrderId: order.id });
    expect(paise((await invoiceRow(w, inv.id)).openAmount)).toBe(paise(total));
    const live = await admin.gqlRaw(`mutation($id: ID!, $reason: String!) { ${op}(paymentId: $id, reason: $reason) }`, { id: adv.id, reason: 'Order still live' });
    expect(live.errors?.length).toBeGreaterThan(0);
    await admin.gql(`mutation($id: ID!, $reason: String!) { cancelSalesOrder(id: $id, reason: $reason) }`, { id: order.id, reason: 'Customer changed mind' });
    // A payments.manage user (sales manager) may move it; a second call changes nothing.
    const manager = await h.as('sales_manager');
    await manager.gql(`mutation($id: ID!, $reason: String!) { ${op}(paymentId: $id, reason: $reason) }`, { id: adv.id, reason: 'Use for the open bill' });
    expect((await admin.gqlRaw(`mutation($id: ID!, $reason: String!) { ${op}(paymentId: $id, reason: $reason) }`, { id: adv.id, reason: 'Use for the open bill' })).errors).toBeUndefined();
    const pay = await h.prisma.customerPayment.findUniqueOrThrow({ where: { id: adv.id } });
    expect(pay.salesOrderId).toBeNull();
    expect(Number(pay.unappliedAmount)).toBe(0);
    expect(paise((await invoiceRow(w, inv.id)).openAmount)).toBe(paise(total) - 50000);
    await assertLedger(h, admin, w.customer.id);
  });
});
