import { Harness, Session, World } from '../harness';
import { assertLedger, delivered, invoiceRow, paise } from '../money-support';

/**
 * An advance on a cancelled order is either refunded, moved to the account or voided, never two of them
 * in a way that charges the customer twice. The ledger invariant holds after every refused step.
 */
describe('money: refund, move and void of an advance cannot double count', () => {
  let h: Harness; let admin: Session;
  beforeAll(async () => { h = await Harness.boot(); admin = await h.as('admin'); });
  afterAll(async () => { await h.close(); });

  const refund = (id: string) => admin.gqlRaw(`mutation($id: ID!, $reason: String!) { refundOrderAdvance(paymentId: $id, reason: $reason) }`, { id, reason: 'Paid back in cash' });
  const move = (id: string) => admin.gqlRaw(`mutation($id: ID!, $reason: String!) { moveAdvanceToAccount(paymentId: $id, reason: $reason) }`, { id, reason: 'Use for the open bill' });
  const voidReceipt = (id: string) => admin.gqlRaw(`mutation($id: ID!, $reason: String) { voidCustomerPayment(id: $id, reason: $reason) }`, { id, reason: 'Wrong receipt' });
  const ledgerRows = (customerId: string) => h.prisma.customerLedgerEntry.findMany({ where: { customerId }, orderBy: { id: 'asc' } });

  async function advanceOnCancelledOrder(w: World, amount = 10000) {
    const order = await w.directOrder({ qty: 1, paymentMode: 'credit' });
    const adv = await w.receipt({ amount, salesOrderId: order.id });
    await w.cancelOrder(order.id, 'Customer changed mind');
    return { order, adv };
  }

  it('a refunded advance cannot be voided: refused with a plain message, ledger unchanged', async () => {
    const w = await h.world(admin, { stock: 5 });
    const { adv } = await advanceOnCancelledOrder(w);
    expect((await refund(adv.id)).errors).toBeUndefined();
    const { ledger } = await assertLedger(h, admin, w.customer.id);
    expect(ledger).toBe(0);
    const before = await ledgerRows(w.customer.id);

    const refused = await voidReceipt(adv.id);
    expect(refused.errors?.[0]?.message).toBe('This advance was already refunded. It cannot be voided.');
    expect(await ledgerRows(w.customer.id)).toEqual(before);
    const pay = await h.prisma.customerPayment.findUniqueOrThrow({ where: { id: adv.id } });
    expect(pay.status).toBe('posted');
    expect((pay.metadata as any)?.advanceRefund?.amount).toBe(10000);
    expect((await assertLedger(h, admin, w.customer.id)).ledger).toBe(0);
    // The account screen no longer offers it for refund or move.
    const account = (await admin.gql(`query($id: ID!) { customerAccount(customerId: $id) }`, { id: w.customer.id })).customerAccount;
    expect(account.cancelledOrderAdvances).toHaveLength(0);
  });

  it('a voided advance cannot be refunded or moved, and a second void changes nothing', async () => {
    const w = await h.world(admin, { stock: 5 });
    const { adv } = await advanceOnCancelledOrder(w);
    expect((await voidReceipt(adv.id)).errors).toBeUndefined();
    const before = await ledgerRows(w.customer.id);
    expect((await refund(adv.id)).errors?.[0]?.message).toMatch(/is void/);
    expect((await move(adv.id)).errors?.[0]?.message).toMatch(/is void/);
    expect((await voidReceipt(adv.id)).errors).toBeUndefined();
    expect(await ledgerRows(w.customer.id)).toEqual(before);
    expect(await h.prisma.customerLedgerEntry.count({ where: { sourceId: adv.id, sourceType: 'AdvanceRefund' } })).toBe(0);
    expect((await assertLedger(h, admin, w.customer.id)).ledger).toBe(0);
  });

  it('a refunded advance cannot be moved to the account; a moved advance cannot be refunded', async () => {
    const w = await h.world(admin, { stock: 5 });
    const first = await advanceOnCancelledOrder(w, 4000);
    expect((await refund(first.adv.id)).errors).toBeUndefined();
    const beforeMove = await ledgerRows(w.customer.id);
    expect((await move(first.adv.id)).errors?.[0]?.message).toMatch(/already refunded/);
    expect(await ledgerRows(w.customer.id)).toEqual(beforeMove);
    expect((await h.prisma.customerPayment.findUniqueOrThrow({ where: { id: first.adv.id } })).salesOrderId).toBe(first.order.id);

    const second = await advanceOnCancelledOrder(w, 3000);
    expect((await move(second.adv.id)).errors).toBeUndefined();
    const beforeRefund = await ledgerRows(w.customer.id);
    expect((await refund(second.adv.id)).errors?.[0]?.message).toMatch(/not on a cancelled order/);
    expect(await ledgerRows(w.customer.id)).toEqual(beforeRefund);
    const moved = await h.prisma.customerPayment.findUniqueOrThrow({ where: { id: second.adv.id } });
    expect(moved.salesOrderId).toBeNull();
    expect(Number(moved.unappliedAmount)).toBe(3000);
    // Ledger: 4000 in and back out, 3000 on account.
    expect((await assertLedger(h, admin, w.customer.id)).ledger).toBe(-3000);
  });

  it('voiding a moved advance that has since paid an invoice reverses the allocation and reopens the invoice', async () => {
    const w = await h.world(admin, { stock: 10 });
    const { adv } = await advanceOnCancelledOrder(w, 500);
    expect((await move(adv.id)).errors).toBeUndefined();
    // A later invoice takes the money on account.
    const a = await delivered(w, { qty: 2 });
    const inv = await w.invoice(a.order.id, a.challan.id);
    const total = Number((await invoiceRow(w, inv.id)).totalAmount);
    // (Issuing the invoice may already use the money on account; otherwise apply it by hand.)
    if (Number((await h.prisma.customerPayment.findUniqueOrThrow({ where: { id: adv.id } })).unappliedAmount) > 0) {
      await admin.gql(`mutation($p: ID!, $i: ID!, $a: Float!) { allocateCustomerPayment(paymentId: $p, salesInvoiceId: $i, amount: $a) }`, { p: adv.id, i: inv.id, a: 500 });
    }
    const applied = await h.prisma.customerAllocation.findMany({ where: { sourceType: 'CustomerPayment', sourceId: adv.id, status: 'posted' } });
    expect(applied.reduce((t, r) => t + paise(r.amount), 0)).toBe(50000);
    expect(paise((await invoiceRow(w, inv.id)).openAmount)).toBe(paise(total) - 50000);
    await assertLedger(h, admin, w.customer.id);

    expect((await voidReceipt(adv.id)).errors).toBeUndefined();
    expect(await h.prisma.customerAllocation.count({ where: { sourceType: 'CustomerPayment', sourceId: adv.id, status: 'posted' } })).toBe(0);
    expect(paise((await invoiceRow(w, inv.id)).openAmount)).toBe(paise(total));
    expect(await h.prisma.customerLedgerEntry.count({ where: { sourceId: adv.id, sourceType: 'CustomerPaymentVoid' } })).toBe(1);
    expect((await assertLedger(h, admin, w.customer.id)).ledger).toBe(total);
  });
});
