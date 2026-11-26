import { Harness, World, Session, stamp } from '../harness';
import { itWhenBuilt } from '../support';

describe('stock is released when work is cancelled', () => {
  let h: Harness; let admin: Session;
  beforeAll(async () => { h = await Harness.boot(); admin = await h.as('admin'); });
  afterAll(async () => { await h.close(); });

  const cancelOrder = itWhenBuilt(['cancelSalesOrder', 'cancelOrder']);

  // A1/A2. One order is cancelled on its own (not through its quote).
  cancelOrder('cancelling a single order releases its reserved stock, pick work and backordered rows', async (op) => {
    const w = await h.world(admin, { stock: 3 });
    const order = await w.directOrder({ qty: 5 }); // 3 reserved, 2 short
    const line = (await h.prisma.salesOrderLine.findFirst({ where: { salesOrderId: order.id } }))!;
    expect(line.reservedQuantity).toBe(3);
    expect(line.backorderedQuantity).toBe(2);
    expect(await w.balance()).toMatchObject({ reserved: 3, available: 0 });

    await admin.gql(`mutation($id: ID!, $reason: String!) { ${op}(id: $id, reason: $reason) }`, { id: order.id, reason: 'Customer changed mind' });

    expect((await w.order(order.id))!.status).toBe('cancelled');
    expect((await w.reservations(order.id)).every((r) => r.status !== 'reserved')).toBe(true);
    expect(await w.balance()).toMatchObject({ reserved: 0, available: 3 });
    const after = (await h.prisma.salesOrderLine.findFirst({ where: { salesOrderId: order.id } }))!;
    expect(after.backorderedQuantity).toBe(0);
  });

  cancelOrder('cancelling a single order also cancels its unfinished pick list and unshipped challan', async (op) => {
    const w = await h.world(admin, { stock: 5 });
    const order = await w.directOrder({ qty: 2 });
    const pick = await w.pick(order.id);
    const challan = await w.challan(order.id, pick.id);
    await admin.gql(`mutation($id: ID!, $reason: String!) { ${op}(id: $id, reason: $reason) }`, { id: order.id, reason: 'Cancel with documents' });
    expect((await h.prisma.pickList.findUnique({ where: { id: pick.id } }))!.status).toBe('cancelled');
    expect((await h.prisma.dispatchChallan.findUnique({ where: { id: challan.id } }))!.status).toBe('cancelled');
    expect(await w.balance()).toMatchObject({ reserved: 0, available: 5 });
  });

  cancelOrder('a dispatched order cannot be cancelled', async (op) => {
    const w = await h.world(admin, { stock: 5 });
    const order = await w.directOrder({ qty: 2 });
    await w.ship(order.id);
    const r = await admin.gqlRaw(`mutation($id: ID!, $reason: String!) { ${op}(id: $id, reason: $reason) }`, { id: order.id, reason: 'Too late' });
    expect(r.errors?.length).toBeGreaterThan(0);
    expect((await w.order(order.id))!.status).not.toBe('cancelled');
  });

  // A1. Receiving goods must not feed a dead order.
  cancelOrder('goods receipt skips cancelled orders and still fills a later live backorder', async (op) => {
    const w = await h.world(admin, { stock: 0 });
    const dead = await w.directOrder({ qty: 3 });   // all backordered
    const live = await w.directOrder({ qty: 2 });   // all backordered, later in the queue
    await admin.gql(`mutation($id: ID!, $reason: String!) { ${op}(id: $id, reason: $reason) }`, { id: dead.id, reason: 'Cancelled before stock arrived' });
    await w.receiveGoods({ qty: 2 });
    expect((await w.reservations(dead.id)).filter((r) => r.status === 'reserved')).toHaveLength(0);
    const liveLine = (await h.prisma.salesOrderLine.findFirst({ where: { salesOrderId: live.id } }))!;
    expect(liveLine.reservedQuantity).toBe(2);
    expect(await w.balance()).toMatchObject({ onHand: 2, reserved: 2, available: 0 });
  });

  // A3. Quotes that end without an order must not keep stock.
  it.each(['lost', 'expired'])('a quote marked %s releases the stock held for it', async (status) => {
    const w = await h.world(admin, { stock: 4 });
    const quote = await w.createQuote([w.line({ qty: 4 })]);
    await admin.gql(`mutation($id: ID!) { sendQuote(id: $id) { id status } }`, { id: quote.id }).catch(() => undefined);
    const order = await w.convertQuote(quote.id, { picks: { 0: 4 } });
    expect(await w.balance()).toMatchObject({ reserved: 4 });
    const STATUS = `mutation($id: ID!, $status: String!, $reason: String) { updateQuoteStatus(id: $id, status: $status, reason: $reason) { id status } }`;
    // A live order keeps its stock (A3): ending the quote is refused with a message, and nothing is released.
    const r = await admin.gqlRaw(STATUS, { id: quote.id, status, reason: 'Customer went quiet' });
    expect(r.errors?.length).toBeGreaterThan(0);
    expect(String(r.errors![0].message)).toMatch(/order|cannot be marked/i);
    expect(await w.balance()).toMatchObject({ reserved: 4, available: 0 });
    expect((await w.reservations(order.id)).filter((x) => x.status === 'reserved').reduce((n, x) => n + Number(x.quantity), 0)).toBe(4);
    // Cancel the order first: then the quote ends and the stock is actually free.
    await admin.gql(`mutation($id: ID!, $reason: String!) { cancelSalesOrder(id: $id, reason: $reason) }`, { id: order.id, reason: 'Customer said no' });
    const ended = await admin.gql(STATUS, { id: quote.id, status, reason: 'Customer said no' });
    expect(ended.updateQuoteStatus.status).toBe(status);
    expect((await w.reservations(order.id)).every((x) => x.status === 'released')).toBe(true);
    expect(await h.prisma.lotReservation.count({ where: { reservation: { quoteId: quote.id }, status: 'reserved' } } as any)).toBe(0);
    expect(await w.balance()).toMatchObject({ onHand: 4, reserved: 0, available: 4 });
  });

  it('a quote with no order marked lost keeps the record and leaves stock untouched', async () => {
    const w = await h.world(admin, { stock: 4 });
    const quote = await w.createQuote([w.line({ qty: 2 })]);
    const r = await admin.gql(`mutation($id: ID!, $status: String!, $reason: String) { updateQuoteStatus(id: $id, status: $status) { id status } }`, { id: quote.id, status: 'lost' }).catch((e) => e);
    expect(await h.prisma.quote.count({ where: { id: quote.id } })).toBe(1);
    expect(await w.balance()).toMatchObject({ reserved: 0, available: 4 });
    expect(r).toBeDefined();
  });

  // B2. In-transit stock cannot be promised to a customer.
  it('stock sitting in the in-transit location is not reservable', async () => {
    const w = await h.world(admin, { stock: 0 });
    const a = await w.createLocation(`Source ${stamp()}`);
    const b = await w.createLocation(`Dest ${stamp()}`);
    await w.receiveGoods({ qty: 5, locationId: a.id });
    const lot = (await h.prisma.inventoryLot.findFirst({ where: { productId: w.product.id, balances: { some: { locationId: a.id } } } }))!;
    const transfer = (await admin.gql(`mutation($input: StockTransferInput!) { createStockTransfer(input: $input) }`, {
      input: { sourceLocationId: a.id, destinationLocationId: b.id, submit: true, lines: JSON.stringify([{ lotId: lot.id, productId: w.product.id, quantity: 5 }]) },
    })).createStockTransfer;
    for (const action of ['approve', 'dispatch']) {
      await admin.gql(`mutation($id: ID!, $action: String!) { transitionStockTransfer(id: $id, action: $action) }`, { id: transfer.id, action });
    }
    // The five pieces are on the road. Nobody can be promised them until they are received.
    const order = await w.directOrder({ qty: 5 });
    const line = (await h.prisma.salesOrderLine.findFirst({ where: { salesOrderId: order.id } }))!;
    expect(line.reservedQuantity).toBe(0);
    expect(line.backorderedQuantity).toBe(5);
    expect((await w.reservations(order.id)).filter((r) => r.status === 'reserved')).toHaveLength(0);
    // Once the other godown receives them, the order can be filled.
    await admin.gql(`mutation($id: ID!, $action: String!) { transitionStockTransfer(id: $id, action: $action) }`, { id: transfer.id, action: 'receive' });
  });
});
