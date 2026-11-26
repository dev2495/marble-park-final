import { Harness, Session, stamp } from '../harness';
import { expectStockBooksAgree, orderLines, lotsAt, transfer, transitionTransfer } from '../stock-helpers';

/** Stock lane B2: stock that cannot be picked today is never promised and never shown as available. */
describe('stock: in-transit and excluded locations', () => {
  let h: Harness; let admin: Session;
  beforeAll(async () => { h = await Harness.boot(); admin = await h.as('admin'); });
  afterAll(async () => { await h.close(); });

  // Scenario 3.
  it('a transfer on the road shows as held, cannot be reserved, and comes back (filling waiting orders) on receipt', async () => {
    const w = await h.world(admin, { stock: 0 });
    const a = await w.createLocation(`Source ${stamp()}`);
    const b = await w.createLocation(`Dest ${stamp()}`);
    await w.receiveGoods({ qty: 50, locationId: a.id });
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 50, available: 50 });
    const [lot] = await lotsAt(h, w.product.id, a.id);
    const t = await transfer(admin, { from: a.id, to: b.id, lotId: lot.lotId, productId: w.product.id, qty: 50 });

    const transit = await h.prisma.stockLocation.findFirst({ where: { code: 'IN-TRANSIT' } });
    expect(transit).toBeTruthy();
    const [onRoad] = await lotsAt(h, w.product.id, transit!.id);
    expect(onRoad).toMatchObject({ onHand: 50, hold: 50, available: 0 });
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 50, hold: 50, available: 0 });

    const order = await w.directOrder({ qty: 20 });
    expect((await orderLines(h, order.id))[0]).toMatchObject({ reservedQuantity: 0, backorderedQuantity: 20 });
    expect(await h.prisma.lotReservation.count({ where: { salesOrderLine: { salesOrderId: order.id }, status: 'reserved' } })).toBe(0);
    await expectStockBooksAgree(h, w.product.id);

    await transitionTransfer(admin, t.id, 'receive');
    const [atDest] = await lotsAt(h, w.product.id, b.id);
    expect(atDest).toMatchObject({ onHand: 50, reserved: 20 });
    const [cleared] = await lotsAt(h, w.product.id, transit!.id);
    expect(cleared).toMatchObject({ onHand: 0, hold: 0 });
    expect((await orderLines(h, order.id))[0]).toMatchObject({ reservedQuantity: 20, backorderedQuantity: 0 });
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 50, reserved: 20, hold: 0, available: 30 });
  });

  it('stock at a location excluded from available stock cannot be reserved and is not counted as available', async () => {
    const w = await h.world(admin, { stock: 0 });
    const code = `X${stamp()}`.slice(0, 12);
    const excluded = (await admin.gql(`mutation($input: StockLocationInput!) { createStockLocation(input: $input) }`, {
      input: { name: `Repair bay ${stamp()}`, code, type: 'warehouse', status: 'active', metadata: { excludeFromAvailableStock: true } },
    })).createStockLocation;
    await w.receiveGoods({ qty: 4, locationId: excluded.id });
    const order = await w.directOrder({ qty: 4 });
    expect((await orderLines(h, order.id))[0]).toMatchObject({ reservedQuantity: 0, backorderedQuantity: 4 });
    const totals = await expectStockBooksAgree(h, w.product.id);
    expect(totals.onHand).toBe(4);
    expect(totals.available).toBe(0);
  });

  it('switching a location to "excluded" holds the stock already there, and switching back frees it', async () => {
    const w = await h.world(admin, { stock: 0 });
    const code = `Y${stamp()}`.slice(0, 12);
    const loc = (await admin.gql(`mutation($input: StockLocationInput!) { createStockLocation(input: $input) }`, {
      input: { name: `Back room ${stamp()}`, code, type: 'warehouse', status: 'active' },
    })).createStockLocation;
    await w.receiveGoods({ qty: 6, locationId: loc.id });
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 6, hold: 0, available: 6 });
    const update = (exclude: boolean) => admin.gql(`mutation($id: ID!, $input: StockLocationInput!) { updateStockLocation(id: $id, input: $input) }`, {
      id: loc.id, input: { name: loc.name, code, type: 'warehouse', status: 'active', metadata: { excludeFromAvailableStock: exclude } },
    });
    await update(true);
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 6, hold: 6, available: 0 });
    await w.receiveGoods({ qty: 2, locationId: loc.id });
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 8, hold: 8, available: 0 });
    await update(false);
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 8, hold: 0, available: 8 });
  });
});
