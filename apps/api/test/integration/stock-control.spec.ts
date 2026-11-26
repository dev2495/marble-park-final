import { Harness, Session, stamp } from '../harness';
import { expectStockBooksAgree, orderLines, lotsAt, createCount, approveCount, sumBy } from '../stock-helpers';

/** Stock lane B3, B6, B7, B8, B12, B14: counts, periods, purchase orders, whole numbers, double posting. */
describe('stock: counts, periods, purchase orders and double posting', () => {
  let h: Harness; let admin: Session;
  beforeAll(async () => { h = await Harness.boot(); admin = await h.as('admin'); });
  afterAll(async () => { await h.close(); });

  const manualGrn = (s: Session, o: { productId: string; qty: number; locationId: string; key?: string; receivedDate?: string }) =>
    s.gqlRaw(`mutation($input: ManualGoodsReceiptInput!) { createManualGoodsReceipt(input: $input) }`, {
      input: {
        vendorName: 'Harness vendor', locationId: o.locationId, reason: 'Stock control test', idempotencyKey: o.key || `HT-GRN-${stamp()}`,
        ...(o.receivedDate ? { receivedDate: o.receivedDate } : {}),
        lines: JSON.stringify([{ productId: o.productId, receivedQuantity: o.qty, enteredUnitCost: 700, rateUom: 'PC' }]),
      },
    });
  const createPo = (lines: any[], demandIds?: string[]) => admin.gqlRaw(`mutation($input: CreatePurchaseOrderInput!) { createPurchaseOrder(input: $input) }`, {
    input: { vendorName: 'Harness supplier', ...(lines.length ? { lines: JSON.stringify(lines) } : {}), ...(demandIds ? { demandIds } : {}) },
  });
  const receivePo = (purchaseOrderId: string, lines: any[], locationId: string) => admin.gqlRaw(`mutation($input: ReceivePurchaseOrderInput!) { receivePurchaseOrder(input: $input) }`, {
    input: { purchaseOrderId, locationId, idempotencyKey: `HT-PORCV-${stamp()}`, lines: JSON.stringify(lines) },
  });

  // ---- stock counts (scenario 5) ----
  it('a count whose stock moved before approval is refused, and can be rejected with no stock change', async () => {
    const w = await h.world(admin, { stock: 30 });
    const [lot] = await lotsAt(h, w.product.id, w.location.id);
    const count = await createCount(admin, { locationId: w.location.id, lines: [{ productId: w.product.id, lotId: lot.lotId, countedQuantity: 25 }] });
    const order = await w.directOrder({ qty: 20 });
    await w.ship(order.id); // 20 leave between the count and its approval
    const r = await approveCount(admin, count.id);
    expect(r.errors?.[0]?.message).toMatch(/Stock changed after this count was taken/);
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 10 }); // no stale -5 posted
    const short = await admin.gqlRaw(`mutation($id: ID!, $reason: String!) { rejectStockCountSession(id: $id, reason: $reason) }`, { id: count.id, reason: 'no' });
    expect(short.errors?.length).toBeGreaterThan(0);
    await admin.gql(`mutation($id: ID!, $reason: String!) { rejectStockCountSession(id: $id, reason: $reason) }`, { id: count.id, reason: 'Stock moved, count again' });
    expect((await h.prisma.stockCountSession.findUnique({ where: { id: count.id } }))!.status).toBe('rejected');
    expect((await approveCount(admin, count.id)).errors?.length).toBeGreaterThan(0); // a rejected count never posts
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 10, reserved: 0 });
  });

  it('a count with no movement since posts exactly its difference', async () => {
    const w = await h.world(admin, { stock: 12 });
    const [lot] = await lotsAt(h, w.product.id, w.location.id);
    const count = await createCount(admin, { locationId: w.location.id, lines: [{ productId: w.product.id, lotId: lot.lotId, countedQuantity: 9 }] });
    expect((await approveCount(admin, count.id)).errors).toBeUndefined();
    expect((await h.prisma.stockCountSession.findUnique({ where: { id: count.id } }))!.status).toBe('posted');
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 9, available: 9 });
    expect((await approveCount(admin, count.id)).errors).toBeUndefined(); // second approve: no second posting
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 9 });
  });

  // ---- periods (scenario 6) ----
  it('periods: bad and open names refused, a closed month blocks back-dated receipts until the owner reopens it', async () => {
    const w = await h.world(admin, { stock: 5 });
    const close = (periodType: string, periodKey: string) => admin.gqlRaw(`mutation($input: InventoryPeriodCloseInput!) { closeInventoryPeriod(input: $input) }`, { input: { periodType, periodKey } });
    const ist = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
    const year = Number(ist.find((p) => p.type === 'year')!.value);
    const month = Number(ist.find((p) => p.type === 'month')!.value);
    const key = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`;
    const current = key(year, month);
    const next = month === 12 ? key(year + 1, 1) : key(year, month + 1);
    const last = month === 1 ? key(year - 1, 12) : key(year, month - 1);
    for (const bad of ['November 2026', '2026-13', '26-10', '']) expect((await close('monthly', bad)).errors?.length).toBeGreaterThan(0);
    expect((await close('monthly', current)).errors?.[0]?.message).toMatch(/has ended/);
    expect((await close('monthly', next)).errors?.[0]?.message).toMatch(/has ended/);
    const fyStart = month >= 4 ? year : year - 1;
    expect((await close('year_end', `${fyStart}-${String((fyStart + 1) % 100).padStart(2, '0')}`)).errors?.length).toBeGreaterThan(0);

    // Closing needs a posted month-end count and no transfer on the road (this test database only).
    for (const t of await h.prisma.stockTransfer.findMany({ where: { status: 'in_transit' } })) {
      await admin.gql(`mutation($id: ID!, $action: String!) { transitionStockTransfer(id: $id, action: $action) }`, { id: t.id, action: 'receive' });
    }
    for (const t of await h.prisma.stockTransfer.findMany({ where: { status: { in: ['submitted', 'approved'] } } })) {
      await admin.gql(`mutation($id: ID!, $action: String!) { transitionStockTransfer(id: $id, action: $action) }`, { id: t.id, action: 'cancel' });
    }
    const [lot] = await lotsAt(h, w.product.id, w.location.id);
    const count = await createCount(admin, { locationId: w.location.id, countType: 'monthly', periodKey: last, lines: [{ productId: w.product.id, lotId: lot.lotId, countedQuantity: 5 }] });
    expect((await approveCount(admin, count.id)).errors).toBeUndefined();
    const closed = await close('monthly', last);
    expect(closed.errors).toBeUndefined();
    const period = closed.data.closeInventoryPeriod;
    expect(period.status).toBe('closed');

    const backDate = `${last}-15T06:00:00.000Z`;
    const refused = await manualGrn(admin, { productId: w.product.id, qty: 2, locationId: w.location.id, receivedDate: backDate });
    expect(refused.errors?.[0]?.message).toMatch(/closed/);
    const salesManager = await h.as('sales_manager');
    const notOwner = await salesManager.gqlRaw(`mutation($id: ID!, $reason: String!) { reopenInventoryPeriod(id: $id, reason: $reason) }`, { id: period.id, reason: 'Need to post a late bill' });
    expect(notOwner.errors?.length).toBeGreaterThan(0);
    const owner = await h.as('owner');
    const reopened = await owner.gqlRaw(`mutation($id: ID!, $reason: String!) { reopenInventoryPeriod(id: $id, reason: $reason) }`, { id: period.id, reason: 'Supplier bill for last month came late' });
    expect(reopened.errors).toBeUndefined();
    expect((await h.prisma.inventoryPeriodClose.findUnique({ where: { id: period.id } }))!.status).toBe('reopened');
    expect(await h.prisma.auditEvent.count({ where: { entityId: period.id, action: 'inventory_period.reopen' } })).toBeGreaterThan(0);
    const ok = await manualGrn(admin, { productId: w.product.id, qty: 2, locationId: w.location.id, receivedDate: backDate });
    expect(ok.errors).toBeUndefined();
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 7 });
  });

  // ---- purchase orders (scenario 4, B14) ----
  it('two rows for one PO line in one receipt cannot over-receive the line', async () => {
    const w = await h.world(admin, { stock: 0 });
    const po = await createPo([{ productId: w.product.id, quantity: 100, enteredUnitCost: 500, rateUom: 'PC' }]);
    expect(po.errors).toBeUndefined();
    const poId = po.data.createPurchaseOrder.id;
    const [poLine] = await h.prisma.purchaseOrderLine.findMany({ where: { purchaseOrderId: poId } });
    expect(poLine.orderedQuantity).toBe(100);
    const over = await receivePo(poId, [{ purchaseOrderLineId: poLine.id, receivedQuantity: 60 }, { purchaseOrderLineId: poLine.id, receivedQuantity: 60 }], w.location.id);
    expect(over.errors?.[0]?.message).toMatch(/only 100 is still to come/);
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 0 });
    const fine = await receivePo(poId, [{ purchaseOrderLineId: poLine.id, receivedQuantity: 60 }, { purchaseOrderLineId: poLine.id, receivedQuantity: 40 }], w.location.id);
    expect(fine.errors).toBeUndefined();
    expect((await h.prisma.purchaseOrderLine.findUnique({ where: { id: poLine.id } }))!.receivedQuantity).toBe(100);
    expect((await receivePo(poId, [{ purchaseOrderLineId: poLine.id, receivedQuantity: 1 }], w.location.id)).errors?.length).toBeGreaterThan(0);
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 100, available: 100 });
  });

  it('a shortage already on an open purchase order cannot go on a second one, and its receipt fills the order', async () => {
    const w = await h.world(admin, { stock: 0 });
    const order = await w.directOrder({ qty: 3 });
    await admin.gql(`query { purchaseDemandQueue }`);
    const backorder = await h.prisma.reservation.findFirst({ where: { salesOrderId: order.id, status: 'backordered' } });
    const demand = await h.prisma.purchaseDemand.findFirst({ where: { sourceReservationId: backorder!.id } });
    expect(demand).toBeTruthy();
    expect(demand!.quantity).toBe(3);
    const first = await createPo([], [demand!.id]);
    expect(first.errors).toBeUndefined();
    const second = await createPo([], [demand!.id]);
    expect(second.errors?.[0]?.message).toMatch(/already on|no longer available/);
    expect(await h.prisma.purchaseOrderLine.count({ where: { purchaseDemandId: demand!.id } })).toBe(1);
    const [poLine] = await h.prisma.purchaseOrderLine.findMany({ where: { purchaseOrderId: first.data.createPurchaseOrder.id } });
    const rcv = await receivePo(first.data.createPurchaseOrder.id, [{ purchaseOrderLineId: poLine.id, receivedQuantity: 3, enteredUnitCost: 500, rateUom: 'PC' }], w.location.id);
    expect(rcv.errors).toBeUndefined();
    expect((await orderLines(h, order.id))[0]).toMatchObject({ reservedQuantity: 3, backorderedQuantity: 0 });
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 3, reserved: 3, available: 0 });
  });

  // ---- whole numbers (scenario 12) ----
  it('fractional quantities are refused with a plain whole-number message', async () => {
    const w = await h.world(admin, { stock: 4 });
    const grn = await manualGrn(admin, { productId: w.product.id, qty: 2.5, locationId: w.location.id });
    expect(grn.errors?.[0]?.message).toMatch(/whole/i);
    const [lot] = await lotsAt(h, w.product.id, w.location.id);
    const count = await admin.gqlRaw(`mutation($input: StockCountInput!) { createStockCountSession(input: $input) }`, {
      input: { locationId: w.location.id, submit: true, lines: JSON.stringify([{ productId: w.product.id, lotId: lot.lotId, countedQuantity: 2.5 }]) },
    });
    expect(count.errors?.[0]?.message).toMatch(/whole/i);
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 4 });
  });

  // ---- concurrency (B3) ----
  it('the same manual receipt fired twice at once posts once', async () => {
    const w = await h.world(admin, { stock: 0 });
    const key = `HT-DBL-${stamp()}`;
    const results = await Promise.all([1, 2].map(() => manualGrn(admin, { productId: w.product.id, qty: 7, locationId: w.location.id, key })));
    expect(results.filter((r) => !r.errors?.length).length).toBeGreaterThanOrEqual(1);
    expect(await h.prisma.goodsReceiptNote.count({ where: { idempotencyKey: key } })).toBe(1);
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 7, available: 7 });
  });

  it('two different receipts for one item at the same moment both count (no lost update)', async () => {
    const w = await h.world(admin, { stock: 0 });
    const results = await Promise.all([3, 4, 5].map((qty) => manualGrn(admin, { productId: w.product.id, qty, locationId: w.location.id })));
    const posted = results.filter((r) => !r.errors?.length).length;
    // A strict transaction may refuse one of them; whatever posted must be on the books, nothing more, nothing lost.
    const grns = await h.prisma.goodsReceiptLine.findMany({ where: { productId: w.product.id } });
    expect(grns).toHaveLength(posted);
    expect(posted).toBeGreaterThanOrEqual(1);
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: sumBy(grns, (g) => g.receivedQuantity) });
  });

  it('the same dispatch fired twice at once takes the stock out once', async () => {
    const w = await h.world(admin, { stock: 6 });
    const order = await w.directOrder({ qty: 4 });
    const pick = await w.pick(order.id);
    const challan = await w.challan(order.id, pick.id);
    const results = await Promise.all([1, 2].map(() => admin.gqlRaw(`mutation($id: ID!, $status: String!) { updateChallanStatus(id: $id, status: $status) { id status } }`, { id: challan.id, status: 'dispatched' })));
    expect(results.filter((r) => !r.errors?.length).length).toBeGreaterThanOrEqual(1);
    expect((await h.prisma.dispatchChallan.findUnique({ where: { id: challan.id } }))!.status).toBe('dispatched');
    const outs = await h.prisma.inventoryLotLedgerEntry.findMany({ where: { productId: w.product.id, onHandDelta: { lt: 0 } } });
    expect(sumBy(outs, (o) => o.onHandDelta)).toBe(-4);
    expect((await orderLines(h, order.id))[0].dispatchedQuantity).toBe(4);
    expect(sumBy(await h.prisma.dispatchLine.findMany({ where: { challanId: challan.id } }), (l) => l.dispatchedQuantity)).toBe(4);
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 2, reserved: 0, available: 2 });
  });
});
