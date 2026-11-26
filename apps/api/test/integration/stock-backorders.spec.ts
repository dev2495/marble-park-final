import { Harness, Session, World, stamp } from '../harness';
import { expectStockBooksAgree, cancelOrder, orderLines, createCount, approveCount, lotsAt } from '../stock-helpers';

/** Stock lane A1r/B9: every stock gain goes to waiting orders first, by one rule. */
describe('stock: waiting orders get the stock that comes in', () => {
  let h: Harness; let admin: Session;
  beforeAll(async () => { h = await Harness.boot(); admin = await h.as('admin'); });
  afterAll(async () => { await h.close(); });

  const line = async (orderId: string) => (await orderLines(h, orderId))[0];
  const held = async (orderId: string) => (await h.prisma.reservation.findMany({ where: { salesOrderId: orderId, status: 'reserved' } })).reduce((t, r) => t + r.quantity, 0);
  const waiting = async (orderId: string) => (await h.prisma.reservation.findMany({ where: { salesOrderId: orderId, status: 'backordered' } })).reduce((t, r) => t + r.quantity, 0);

  // Scenario 1, widened: oldest first, dead orders skipped, a backorder too big is passed over.
  it('goods receipt fills waiting orders oldest first, skips cancelled and closed orders, and moves past one too big', async () => {
    const w = await h.world(admin, { stock: 0 });
    const dead = await w.directOrder({ qty: 20 });
    const closed = await w.directOrder({ qty: 2 });
    const big = await w.directOrder({ qty: 15 });
    const live = await w.directOrder({ qty: 5 });
    const later = await w.directOrder({ qty: 4 });
    await cancelOrder(admin, dead.id, 'Customer cancelled before stock came');
    // An older order closed with a stale waiting row still on it (as legacy data has): must be skipped too.
    await h.prisma.salesOrder.update({ where: { id: closed.id }, data: { status: 'closed' } });
    expect(await waiting(closed.id)).toBe(2);
    await expectStockBooksAgree(h, w.product.id);

    await w.receiveGoods({ qty: 10 });

    expect(await held(dead.id)).toBe(0);
    expect(await held(closed.id)).toBe(0);
    expect(await waiting(closed.id)).toBe(2); // untouched
    expect(await held(big.id)).toBe(0);       // 15 > 10: waits whole
    expect(await waiting(big.id)).toBe(15);
    expect(await held(live.id)).toBe(5);
    expect(await held(later.id)).toBe(4);     // behind the big one, still filled
    expect(await line(live.id)).toMatchObject({ reservedQuantity: 5, backorderedQuantity: 0 });
    expect(await line(later.id)).toMatchObject({ reservedQuantity: 4, backorderedQuantity: 0 });
    expect(await line(big.id)).toMatchObject({ reservedQuantity: 0, backorderedQuantity: 15 });
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 10, reserved: 9, available: 1 });
  });

  // Scenario 13: customer return (resell) fills a waiting backorder in the same save.
  it('a customer return of a resellable item fills a waiting order', async () => {
    const w = await h.world(admin, { stock: 3 });
    const first = await w.directOrder({ qty: 3, paymentMode: 'credit' });
    const { challan } = await w.ship(first.id);
    await w.deliver(challan.id);
    const waitingOrder = await w.directOrder({ qty: 2 });
    expect(await waiting(waitingOrder.id)).toBe(2);
    await w.returnGoods({ challanId: challan.id, salesOrderId: first.id, qty: 2 });
    expect(await held(waitingOrder.id)).toBe(2);
    expect(await line(waitingOrder.id)).toMatchObject({ reservedQuantity: 2, backorderedQuantity: 0 });
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 2, reserved: 2, available: 0 });
  });

  it('a count that finds extra stock fills a waiting order when it is approved', async () => {
    const w = await h.world(admin, { stock: 0 });
    const order = await w.directOrder({ qty: 2 });
    const count = await createCount(admin, { locationId: w.location.id, lines: [{ productId: w.product.id, countedQuantity: 2 }] });
    const r = await approveCount(admin, count.id);
    expect(r.errors).toBeUndefined();
    expect(await held(order.id)).toBe(2);
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 2, reserved: 2, available: 0 });
  });

  it('approved opening stock fills a waiting order', async () => {
    const w = await h.world(admin, { stock: 0 });
    const order = await w.directOrder({ qty: 3 });
    const session = (await admin.gql(`mutation($input: OpeningStockInput!) { createOpeningStockSession(input: $input) }`, {
      input: { locationId: w.location.id, submit: true, lines: JSON.stringify([{ productId: w.product.id, quantity: 5, unitCost: 600, lotCode: `OPEN-${stamp()}` }]) },
    })).createOpeningStockSession;
    await admin.gql(`mutation($id: ID!) { approveOpeningStockSession(id: $id) }`, { id: session.id });
    expect(await held(order.id)).toBe(3);
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 5, reserved: 3, available: 2 });
  });

  it('a display piece returned to stock fills a waiting order', async () => {
    const w = await h.world(admin, { stock: 2 });
    const [lot] = await lotsAt(h, w.product.id, w.location.id);
    const sample = (await admin.gql(`mutation($input: DisplaySampleInput!) { createDisplaySample(input: $input) }`, {
      input: { productId: w.product.id, internalCode: `DS${stamp()}`, locationId: w.location.id, displayZone: 'Bath gallery', sourceLotId: lot.lotId, issuedQuantity: 2 },
    })).createDisplaySample;
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 0 });
    const order = await w.directOrder({ qty: 2 });
    expect(await waiting(order.id)).toBe(2);
    await admin.gql(`mutation($id: ID!, $input: DisplaySampleTransitionInput!) { transitionDisplaySample(id: $id, input: $input) }`, {
      id: sample.id, input: { action: 'return_to_stock', reason: 'Display changed, piece back to stock', returnQuantity: 2 },
    });
    expect(await held(order.id)).toBe(2);
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 2, reserved: 2, available: 0 });
  });

  it('an approved stock increase fills a waiting order', async () => {
    const w = await h.world(admin, { stock: 1 });
    const order = await w.directOrder({ qty: 3 }); // 1 held, 2 waiting
    expect(await waiting(order.id)).toBe(2);
    const [lot] = await lotsAt(h, w.product.id, w.location.id);
    const req = (await admin.gql(`mutation($input: StockAdjustmentRequestInput!) { requestStockAdjustment(input: $input) }`, {
      input: { productId: w.product.id, lotId: lot.lotId, locationId: w.location.id, quantity: 2, type: 'increase', reason: 'Found two boxes behind the rack' },
    })).requestStockAdjustment;
    await admin.gql(`mutation($id: ID!, $action: String!) { decideStockAdjustment(id: $id, action: $action) }`, { id: req.id, action: 'approve' });
    expect(await held(order.id)).toBe(3);
    expect(await line(order.id)).toMatchObject({ reservedQuantity: 3, backorderedQuantity: 0 });
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 3, reserved: 3, available: 0 });
  });

  it('goods back from a failed delivery go back to their own order, not to another waiting order', async () => {
    const w = await h.world(admin, { stock: 2 });
    const order = await w.directOrder({ qty: 2 });
    const { challan } = await w.ship(order.id);
    const other = await w.directOrder({ qty: 2 });
    expect(await waiting(other.id)).toBe(2);
    await admin.gql(`mutation($id: ID!, $reason: String!) { reportFailedDelivery(id: $id, reason: $reason) }`, { id: challan.id, reason: 'Customer not at site' });
    await admin.gql(`mutation($id: ID!, $reason: String!) { cancelChallan(id: $id, reason: $reason) }`, { id: challan.id, reason: 'Goods back at the godown' });
    expect(await held(order.id)).toBe(2);
    expect(await waiting(other.id)).toBe(2);
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 2, reserved: 2, available: 0 });
  });

  it('cancelling a pending challan moves no stock and the order keeps its hold', async () => {
    const w = await h.world(admin, { stock: 4 });
    const order = await w.directOrder({ qty: 3 });
    const pick = await w.pick(order.id);
    const challan = await w.challan(order.id, pick.id);
    await admin.gql(`mutation($id: ID!, $reason: String!) { cancelChallan(id: $id, reason: $reason) }`, { id: challan.id, reason: 'Wrong vehicle booked' });
    expect(await held(order.id)).toBe(3);
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 4, reserved: 3, available: 1 });
  });

  // World type is referenced so the import is used in type position in every build mode.
  it('the harness world builds with stock that agrees with itself', async () => {
    const w: World = await h.world(admin, { stock: 7 });
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 7, reserved: 0, available: 7 });
  });
});
