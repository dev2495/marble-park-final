/**
 * Sales lane: cancelling orders, order safety keys and advance payment modes.
 * Scenarios from the sales lane notes (1-5, 15) plus the batch-test must-cover list.
 */
import { Harness, Session, stamp } from '../harness';

const CANCEL = `mutation($id: ID!, $reason: String!) { cancelSalesOrder(id: $id, reason: $reason) }`;
const DIRECT = `mutation($input: CreateDirectSalesOrderInput!) { createDirectSalesOrder(input: $input) }`;
const FROM_QUOTE = `mutation($input: CreateSalesOrderInput!) { createSalesOrderFromQuote(input: $input) }`;

function refusal(r: { errors?: any[] }) {
  expect(r.errors?.length).toBeGreaterThan(0);
  return String(r.errors![0].message);
}

describe('sales orders: cancel, safety key, advance', () => {
  let h: Harness; let admin: Session;
  beforeAll(async () => { h = await Harness.boot(); admin = await h.as('admin'); });
  afterAll(async () => { await h.close(); });

  const orderLines = (id: string) => h.prisma.salesOrderLine.findMany({ where: { salesOrderId: id } });

  // Scenario 1. Direct order with no stock, then cancel.
  it('cancelling a direct order with nothing in stock closes the backorder, the shortfall and the dispatch job', async () => {
    const w = await h.world(admin, { stock: 0 });
    const order = await w.directOrder({ qty: 20 });
    expect((await w.reservations(order.id)).map((r) => r.status)).toEqual(['backordered']);
    expect(await h.prisma.purchaseDemand.count({ where: { sourceOrderId: order.id, status: 'open' } })).toBe(1);

    const result = await w.cancelOrder(order.id, 'Customer bought elsewhere');
    expect(result.status).toBe('cancelled');
    expect(result.closedBackordered).toBe(20);
    expect(result.demandsCancelled).toBe(1);

    expect((await w.reservations(order.id)).every((r) => r.status === 'released')).toBe(true);
    expect((await h.prisma.purchaseDemand.findMany({ where: { sourceOrderId: order.id } })).map((d) => d.status)).toEqual(['cancelled']);
    expect((await w.order(order.id))!.status).toBe('cancelled');
    expect((await orderLines(order.id)).every((l) => l.status === 'cancelled' && l.reservedQuantity === 0 && l.backorderedQuantity === 0)).toBe(true);
    expect((await h.prisma.dispatchJob.findUnique({ where: { salesOrderId: order.id } }))!.status).toBe('cancelled');
    const audit = await h.prisma.auditEvent.findFirst({ where: { entityId: order.id, action: 'sales_order.cancel' } });
    expect(audit?.actorUserId).toBe(admin.userId);

    // The goods that arrive later are free stock, not held for the dead order.
    await w.receiveGoods({ qty: 20 });
    expect(await w.balance()).toMatchObject({ onHand: 20, reserved: 0, available: 20 });
    expect((await w.reservations(order.id)).filter((r) => r.status === 'reserved')).toHaveLength(0);
  });

  // Scenario 2. Stock reserved on lots and a pick list, then cancel.
  it('cancelling an order with reserved stock and a pick list frees the lots and cancels the pick list and challan', async () => {
    const w = await h.world(admin, { stock: 6 });
    const order = await w.directOrder({ qty: 4 });
    const reservation = (await w.reservations(order.id)).find((r) => r.status === 'reserved')!;
    expect(await h.prisma.lotReservation.count({ where: { reservationId: reservation.id, status: 'reserved' } })).toBeGreaterThan(0);
    const pick = await w.pick(order.id);
    const challan = await w.challan(order.id, pick.id);

    const result = await w.cancelOrder(order.id, 'Wrong colour ordered');
    expect(result.releasedReserved).toBe(4);
    expect(result.pickListIds).toContain(pick.id);
    expect(result.challanIds).toContain(challan.id);
    expect(await h.prisma.lotReservation.count({ where: { reservationId: reservation.id, status: 'reserved' } })).toBe(0);
    expect((await h.prisma.pickList.findUnique({ where: { id: pick.id } }))!.status).toBe('cancelled');
    expect((await h.prisma.dispatchChallan.findUnique({ where: { id: challan.id } }))!.status).toBe('cancelled');
    expect(await w.balance()).toMatchObject({ onHand: 6, reserved: 0, available: 6 });
  });

  // Scenario 3. Refusals.
  it('an order whose goods left the warehouse cannot be cancelled, and the refusal names the item', async () => {
    const w = await h.world(admin, { stock: 5 });
    const order = await w.directOrder({ qty: 2 });
    await w.ship(order.id);
    const message = refusal(await admin.gqlRaw(CANCEL, { id: order.id, reason: 'Too late' }));
    expect(message).toContain(w.product.sku);
    expect((await w.order(order.id))!.status).not.toBe('cancelled');
    expect((await w.reservations(order.id)).some((r) => r.status === 'released')).toBe(false);
  });

  it('an order with an open invoice cannot be cancelled even after every piece came back', async () => {
    const w = await h.world(admin, { stock: 5 });
    const order = await w.directOrder({ qty: 2, paymentMode: 'credit' });
    const { challan } = await w.ship(order.id);
    await w.deliver(challan.id);
    const invoice = await w.invoice(order.id, challan.id);
    await w.returnGoods({ challanId: challan.id, salesOrderId: order.id, qty: 2 });
    const row = await h.prisma.salesInvoice.findUnique({ where: { id: invoice.id } });
    const message = refusal(await admin.gqlRaw(CANCEL, { id: order.id, reason: 'Customer returned it all' }));
    expect(message).toContain(row!.invoiceNumber);
    expect((await w.order(order.id))!.status).not.toBe('cancelled');
  });

  it('a cancel without a reason is refused', async () => {
    const w = await h.world(admin, { stock: 2 });
    const order = await w.directOrder({ qty: 1 });
    refusal(await admin.gqlRaw(CANCEL, { id: order.id, reason: '   ' }));
    expect((await w.order(order.id))!.status).not.toBe('cancelled');
  });

  // Scenario 4. Advance on the order, then cancel.
  it('cancelling an order with an advance reports the advance and leaves the receipt posted', async () => {
    const w = await h.world(admin, { stock: 5 });
    const order = await w.directOrder({ qty: 1, advance: 500 });
    const receipt = (await h.prisma.customerPayment.findFirst({ where: { salesOrderId: order.id } }))!;
    expect(receipt.amount).toBe(500);
    const result = await w.cancelOrder(order.id, 'Customer changed plan');
    expect(result.advance.amount).toBe(500);
    expect(result.advance.receipts.map((r: any) => r.id)).toEqual([receipt.id]);
    const after = (await h.prisma.customerPayment.findUnique({ where: { id: receipt.id } }))!;
    expect(after.status).toBe('posted');
    expect(after.unappliedAmount).toBe(500);
    expect(after.salesOrderId).toBe(order.id);
  });

  // Scenario 5. Two orders on one quote, cancel one: the other keeps its stock.
  it('cancelling one of two orders on a quote leaves the other order and its stock untouched', async () => {
    const w = await h.world(admin, { stock: 10 });
    const quote = await w.createQuote([w.line({ qty: 5 })]);
    const first = await w.convertQuote(quote.id, { picks: { 0: 2 } });
    const second = await w.convertQuote(quote.id, { picks: { 0: 3 } });
    expect(await w.balance()).toMatchObject({ reserved: 5 });

    const result = await w.cancelOrder(first.id, 'Only the second delivery is needed');
    expect(result.quoteStatus).toBe('partially_ordered');

    const line = (await w.quoteLines(quote.id))[0];
    expect(line.orderedQuantity).toBe(3);
    expect((await w.quoteRow(quote.id))!.status).toBe('partially_ordered');
    expect((await h.prisma.lead.findUnique({ where: { id: quote.leadId! } }))!.stage).toBe('won');

    expect((await w.order(second.id))!.status).not.toBe('cancelled');
    const live = await w.reservations(second.id);
    expect(live.filter((r) => r.status === 'reserved').reduce((n, r) => n + Number(r.quantity), 0)).toBe(3);
    expect((await orderLines(second.id))[0].reservedQuantity).toBe(3);
    expect(await w.balance()).toMatchObject({ onHand: 10, reserved: 3, available: 7 });

    // The freed 2 can be ordered again from the same quote.
    const again = await w.convertQuote(quote.id);
    expect((await orderLines(again.id))[0].orderedQuantity).toBe(2);
  });

  it('cancelling the only order on a quote puts the quote back to an open offer and the lead back to quoted', async () => {
    const w = await h.world(admin, { stock: 4 });
    const quote = await w.createQuote([w.line({ qty: 2 })]);
    const order = await w.convertQuote(quote.id);
    await w.cancelOrder(order.id, 'Customer will order next month');
    expect(['sent', 'draft']).toContain((await w.quoteRow(quote.id))!.status);
    expect((await w.quoteLines(quote.id))[0].orderedQuantity).toBe(0);
    expect((await h.prisma.lead.findUnique({ where: { id: quote.leadId! } }))!.stage).toBe('quoted');
    expect(await w.balance()).toMatchObject({ reserved: 0, available: 4 });
  });

  it('cancelling twice is harmless', async () => {
    const w = await h.world(admin, { stock: 3 });
    const order = await w.directOrder({ qty: 2 });
    await w.cancelOrder(order.id, 'First tap');
    const again = await w.cancelOrder(order.id, 'Second tap');
    expect(again.alreadyCancelled).toBe(true);
    expect(await w.balance()).toMatchObject({ reserved: 0, available: 3 });
  });

  // A1. Goods receipt: a cancelled order's waiting quantity is not filled; a live order behind it is.
  it('a goods receipt skips a cancelled order and fills the live order behind it', async () => {
    const w = await h.world(admin, { stock: 0 });
    const dead = await w.directOrder({ qty: 3 });
    const live = await w.directOrder({ qty: 2 });
    await w.cancelOrder(dead.id, 'Cancelled before stock arrived');
    await w.receiveGoods({ qty: 4 });
    expect((await w.reservations(dead.id)).map((r) => r.status)).toEqual(['released']);
    expect((await orderLines(dead.id))[0].reservedQuantity).toBe(0);
    const liveReserved = (await w.reservations(live.id)).filter((r) => r.status === 'reserved').reduce((n, r) => n + Number(r.quantity), 0);
    expect(liveReserved).toBe(2);
    expect((await orderLines(live.id))[0].reservedQuantity).toBe(2);
    expect(await w.balance()).toMatchObject({ onHand: 4, reserved: 2, available: 2 });
  });

  // Scenario 15. Direct order safety key.
  it('the same direct order sent twice with one safety key makes one order', async () => {
    const w = await h.world(admin, { stock: 5 });
    const key = `HT-DUP-${stamp()}`;
    const a = await w.directOrder({ qty: 1, key });
    const b = await w.directOrder({ qty: 1, key });
    expect(b.id).toBe(a.id);
    // Two taps at the same moment.
    const key2 = `HT-DUP2-${stamp()}`;
    const [c, d] = await Promise.all([w.directOrder({ qty: 1, key: key2 }), w.directOrder({ qty: 1, key: key2 })]);
    expect(c.id).toBe(d.id);
    expect(await h.prisma.salesOrder.count({ where: { idempotencyKey: { in: [key, key2] } } })).toBe(2);
    expect(await w.balance()).toMatchObject({ reserved: 2, available: 3 });
    // A changed form gets a new key and a new order.
    const e = await w.directOrder({ qty: 2 });
    expect(e.id).not.toBe(a.id);
  });

  it('the same quote conversion sent twice with one safety key makes one order', async () => {
    const w = await h.world(admin, { stock: 5 });
    const quote = await w.createQuote([w.line({ qty: 2 })]);
    const key = `HT-QDUP-${stamp()}`;
    const [a, b] = await Promise.all([w.convertQuote(quote.id, { key }), w.convertQuote(quote.id, { key })]);
    expect(a.id).toBe(b.id);
    expect(await h.prisma.salesOrder.count({ where: { quoteId: quote.id } })).toBe(1);
    expect((await w.quoteLines(quote.id))[0].orderedQuantity).toBe(2);
  });

  // Money follow-up: how the advance was paid is kept.
  it('a direct order advance paid by UPI is recorded as UPI into the bank', async () => {
    const w = await h.world(admin, { stock: 5 });
    const order = (await admin.gql(DIRECT, { input: {
      customerId: w.customer.id, ownerId: w.ownerId, paymentMode: 'cash', advanceAmount: 400, advancePaymentMode: 'upi',
      idempotencyKey: `HT-UPI-${stamp()}`, lines: JSON.stringify([w.line({ qty: 1 })]),
    } })).createDirectSalesOrder;
    const receipt = (await h.prisma.customerPayment.findFirst({ where: { salesOrderId: order.id } }))!;
    expect(receipt.paymentMode).toBe('upi');
    expect(receipt.moneyAccount).toBe('bank');
    expect(receipt.amount).toBe(400);
  });

  it('a quote conversion advance keeps its payment mode, and an unknown mode is recorded as cash', async () => {
    const w = await h.world(admin, { stock: 5 });
    const quote = await w.createQuote([w.line({ qty: 2 })]);
    const f = await w.quoteFulfillment(quote.id);
    const order = (await admin.gql(FROM_QUOTE, { input: {
      quoteId: quote.id, paymentMode: 'cash', advanceAmount: 300, advancePaymentMode: 'neft', idempotencyKey: `HT-NEFT-${stamp()}`,
      lines: JSON.stringify([{ quoteLineId: f.lines[0].id, quantity: 1 }]),
    } })).createSalesOrderFromQuote;
    expect((await h.prisma.customerPayment.findFirst({ where: { salesOrderId: order.id } }))!.paymentMode).toBe('neft');
    const odd = (await admin.gql(FROM_QUOTE, { input: {
      quoteId: quote.id, paymentMode: 'cash', advanceAmount: 100, advancePaymentMode: 'bitcoin', idempotencyKey: `HT-ODD-${stamp()}`,
      lines: JSON.stringify([{ quoteLineId: f.lines[0].id, quantity: 1 }]),
    } })).createSalesOrderFromQuote;
    expect((await h.prisma.customerPayment.findFirst({ where: { salesOrderId: odd.id } }))!.paymentMode).toBe('cash');
  });

  // Scenario 14 (direct order part). A typed 0% GST stays 0%.
  it('a direct order line at 0% GST stays at 0%, and an empty GST box means 18%', async () => {
    const w = await h.world(admin, { stock: 5 });
    const zero = { ...w.line({ qty: 1 }), taxRate: 0 };
    const empty: any = { ...w.line({ qty: 1, area: 'Bathroom' }) };
    delete empty.taxRate;
    const order = await w.directOrder({ lines: [zero, empty as any] });
    const lines = await h.prisma.salesOrderLine.findMany({ where: { salesOrderId: order.id }, orderBy: { lineNo: 'asc' } });
    expect(lines.map((l) => Number(l.taxRate))).toEqual([0, 18]);
  });

  // ---- gaps lane (G2, G4) ----
  it('cancelling an order that holds stock hands it to a live order waiting for the same item', async () => {
    const w = await h.world(admin, { stock: 20 });
    const a = await w.directOrder({ qty: 20 });
    const b = await w.directOrder({ qty: 15 });
    expect((await orderLines(b.id))[0].backorderedQuantity).toBe(15);
    await w.cancelOrder(a.id, 'Customer cancelled');
    expect(sum(await w.reservations(b.id), 'reserved')).toBe(15);
    expect((await orderLines(b.id))[0]).toMatchObject({ reservedQuantity: 15, backorderedQuantity: 0 });
    expect(await w.balance()).toMatchObject({ onHand: 20, reserved: 15, available: 5 });
  });

  it('cancelling an order with special-order goods set aside clears them and writes the release to the ledger', async () => {
    const w = await h.world(admin, { stock: 0 });
    const order = await w.directOrder({ qty: 10 });
    const line = (await orderLines(order.id))[0];
    // A special-order tile line has no product record; its received goods are counted in allocatedQuantity.
    await h.prisma.salesOrderLine.update({ where: { id: line.id }, data: { productId: null, allocatedQuantity: 10, isTileSpecial: true } });
    const result = await w.cancelOrder(order.id, 'Customer chose another tile');
    expect(result.specialOrderReleased).toEqual([expect.objectContaining({ salesOrderLineId: line.id, quantity: 10 })]);
    expect((await h.prisma.salesOrderLine.findUnique({ where: { id: line.id } }))!.allocatedQuantity).toBe(0);
    const ledger = await h.prisma.stockLedgerEntry.findMany({ where: { referenceId: order.id, type: 'special_order_release' } });
    expect(ledger.map((row) => Number(row.quantity))).toEqual([10]);
  });

  it('a fractional quantity is refused on a quote, a direct order and an order from a quote, naming the unit', async () => {
    const w = await h.world(admin, { stock: 10 });
    const q = await admin.gqlRaw(`mutation($input: CreateQuoteInput!) { createQuote(input: $input) { id } }`, {
      input: { customerId: w.customer.id, ownerId: w.ownerId, title: 'Fraction', lines: JSON.stringify([w.line({ qty: 2.5 })]) },
    });
    expect(refusal(q)).toMatch(/whole pieces/);
    expect(refusal(await admin.gqlRaw(DIRECT, { input: { customerId: w.customer.id, ownerId: w.ownerId, paymentMode: 'cash', idempotencyKey: `HT-FR-${stamp()}`, lines: JSON.stringify([w.line({ qty: 1.5 })]) } }))).toMatch(/whole pieces/);
    const quote = await w.createQuote([w.line({ qty: 4 })]);
    const f = await w.quoteFulfillment(quote.id);
    const r = await admin.gqlRaw(FROM_QUOTE, { input: { quoteId: quote.id, paymentMode: 'credit', idempotencyKey: `HT-FR2-${stamp()}`, lines: JSON.stringify([{ quoteLineId: f.lines[0].id, quantity: 1.5 }]) } });
    expect(refusal(r)).toMatch(/whole pieces/);
    expect(await h.prisma.salesOrder.count({ where: { quoteId: quote.id } })).toBe(0);
    expect(await w.balance()).toMatchObject({ reserved: 0 });
  });
});

describe('cancelling a quote with an advance on its order (review fix R7)', () => {
  let h: Harness; let admin: Session;
  beforeAll(async () => { h = await Harness.boot(); admin = await h.as('admin'); });
  afterAll(async () => { await h.close(); });

  it('is refused until the order is cancelled and the advance is moved to the customer account', async () => {
    const w = await h.world(admin, { stock: 5 });
    const quote = await w.createQuote([w.line({ qty: 2 })]);
    const f = await w.quoteFulfillment(quote.id);
    const order = (await admin.gql(FROM_QUOTE, { input: {
      quoteId: quote.id, paymentMode: 'cash', advanceAmount: 500, advancePaymentMode: 'upi', idempotencyKey: `HT-R7-${stamp()}`,
      lines: JSON.stringify([{ quoteLineId: f.lines[0].id, quantity: 2 }]),
    } })).createSalesOrderFromQuote;
    const CANCEL_QUOTE = `mutation($id: ID!, $reason: String!) { cancelQuote(id: $id, reason: $reason) { id status } }`;
    const r = await admin.gqlRaw(CANCEL_QUOTE, { id: quote.id, reason: 'Customer backed out' });
    expect(r.errors?.length).toBeGreaterThan(0);
    expect(String(r.errors![0].message)).toMatch(/advance/i);
    expect((await w.order(order.id))!.status).not.toBe('cancelled');
    expect(await w.balance()).toMatchObject({ reserved: 2 });

    await w.cancelOrder(order.id, 'Customer backed out');
    const receipt = (await h.prisma.customerPayment.findFirst({ where: { salesOrderId: order.id } }))!;
    expect((await admin.gqlRaw(CANCEL_QUOTE, { id: quote.id, reason: 'Customer backed out' })).errors?.length).toBeGreaterThan(0);
    await admin.gql(`mutation($id: ID!, $reason: String!) { moveAdvanceToAccount(paymentId: $id, reason: $reason) }`, { id: receipt.id, reason: 'Keep for next purchase' });
    const done = (await admin.gql(CANCEL_QUOTE, { id: quote.id, reason: 'Customer backed out' })).cancelQuote;
    expect(done.status).toBe('cancelled');
    const after = (await h.prisma.customerPayment.findUnique({ where: { id: receipt.id } }))!;
    expect(after.salesOrderId).toBeNull();
    expect(after.status).toBe('posted');
    expect(await w.balance()).toMatchObject({ reserved: 0, available: 5 });
  });
});

function sum(rows: Array<{ quantity: any; status: string }>, status = 'reserved') {
  return rows.filter((r) => r.status === status).reduce((n, r) => n + Number(r.quantity), 0);
}

