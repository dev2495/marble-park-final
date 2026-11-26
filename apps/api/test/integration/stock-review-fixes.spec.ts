import { Harness, Session, stamp } from '../harness';
import { expectStockBooksAgree, orderLines, lotsAt, createCount, approveCount, cancelChallan, failDelivery, transfer, transitionTransfer, sumBy } from '../stock-helpers';

/** Expectations from the independent review (review-fix lane). */
describe('stock: review fixes', () => {
  let h: Harness; let admin: Session;
  beforeAll(async () => { h = await Harness.boot(); admin = await h.as('admin'); });
  afterAll(async () => { await h.close(); });

  const billedFor = async (salesOrderId: string) => {
    const lines = await h.prisma.salesInvoiceLine.findMany({ where: { salesInvoice: { salesOrderId, status: { notIn: ['void', 'voided', 'cancelled'] } } } as any });
    return sumBy(lines, (l: any) => l.quantity);
  };

  // (1) A billed challan cannot be taken back until its bill is voided.
  it('a challan that left and was billed cannot be cancelled after a failed delivery until the invoice is voided; then it bills once', async () => {
    const w = await h.world(admin, { stock: 5 });
    const order = await w.directOrder({ qty: 3, paymentMode: 'credit' });
    const { challan } = await w.ship(order.id);
    const invoice = await w.invoice(order.id, challan.id);
    await failDelivery(admin, challan.id);
    const refused = await admin.gqlRaw(`mutation($id: ID!, $reason: String!) { cancelChallan(id: $id, reason: $reason) }`, { id: challan.id, reason: 'Goods back at the godown' });
    expect(refused.errors?.length).toBeGreaterThan(0);
    expect((await h.prisma.dispatchChallan.findUnique({ where: { id: challan.id } }))!.status).toBe('failed_delivery');
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 2 });

    await admin.gql(`mutation($id: ID!, $reason: String!) { voidSalesInvoice(id: $id, reason: $reason) }`, { id: invoice.id, reason: 'Delivery failed, bill raised again later' });
    await cancelChallan(admin, challan.id, 'Goods back at the godown');
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 5, reserved: 3 });
    expect((await orderLines(h, order.id))[0].dispatchedQuantity).toBe(0);

    const { challan: again } = await w.ship(order.id);
    await w.invoice(order.id, again.id);
    expect(await billedFor(order.id)).toBe(3);
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 2, reserved: 0 });
  });

  // (2) A correction dated inside a reopened period, entered later, is in the period when it closes again.
  it('re-closing a reopened month includes a back-dated receipt entered after the month ended', async () => {
    const w = await h.world(admin, { stock: 5 });
    const ist = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
    const year = Number(ist.find((p) => p.type === 'year')!.value);
    const month = Number(ist.find((p) => p.type === 'month')!.value);
    const last = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
    const close = () => admin.gqlRaw(`mutation($input: InventoryPeriodCloseInput!) { closeInventoryPeriod(input: $input) }`, { input: { periodType: 'monthly', periodKey: last } });
    for (const t of await h.prisma.stockTransfer.findMany({ where: { status: 'in_transit' } })) await transitionTransfer(admin, t.id, 'receive');
    for (const t of await h.prisma.stockTransfer.findMany({ where: { status: { in: ['submitted', 'approved'] } } })) await transitionTransfer(admin, t.id, 'cancel');
    const [lot] = await lotsAt(h, w.product.id, w.location.id);
    const count = await createCount(admin, { locationId: w.location.id, countType: 'monthly', periodKey: last, lines: [{ productId: w.product.id, lotId: lot.lotId, countedQuantity: 5 }] });
    expect((await approveCount(admin, count.id)).errors).toBeUndefined();
    const first = await close();
    expect(first.errors).toBeUndefined();
    const periodId = first.data.closeInventoryPeriod.id;
    const owner = await h.as('owner');
    await owner.gql(`mutation($id: ID!, $reason: String!) { reopenInventoryPeriod(id: $id, reason: $reason) }`, { id: periodId, reason: 'Late supplier bill for last month' });
    const grn = await admin.gql(`mutation($input: ManualGoodsReceiptInput!) { createManualGoodsReceipt(input: $input) }`, {
      input: {
        vendorName: 'Harness vendor', locationId: w.location.id, reason: 'Late bill', idempotencyKey: `HT-LATE-${stamp()}`, receivedDate: `${last}-20T06:00:00.000Z`,
        lines: JSON.stringify([{ productId: w.product.id, receivedQuantity: 4, enteredUnitCost: 700, rateUom: 'PC' }]),
      },
    });
    expect(grn).toBeTruthy();
    const lateLot = await h.prisma.inventoryLot.findFirst({ where: { productId: w.product.id, sourceType: 'manual_grn' }, orderBy: { createdAt: 'desc' } });
    // A count correction dated inside the month, entered today: +1 on the original lot.
    const correction = (await admin.gql(`mutation($input: StockCountInput!) { createStockCountSession(input: $input) }`, {
      input: { locationId: w.location.id, submit: true, effectiveAt: `${last}-25T06:00:00.000Z`, lines: JSON.stringify([{ productId: w.product.id, lotId: lot.lotId, countedQuantity: 6 }]) },
    })).createStockCountSession;
    expect((await approveCount(admin, correction.id)).errors).toBeUndefined();
    const again = await close();
    expect(again.errors).toBeUndefined();
    const counted = await h.prisma.inventoryPeriodSnapshot.findFirst({ where: { inventoryPeriodCloseId: periodId, lotId: lot.lotId, locationId: w.location.id } });
    expect(counted?.onHand).toBe(1); // the 5 opening pieces came in after the month ended; only the +1 dated inside it counts
    const snapshot = await h.prisma.inventoryPeriodSnapshot.findFirst({ where: { inventoryPeriodCloseId: periodId, lotId: lateLot!.id } });
    expect(snapshot?.onHand).toBe(4);
    // Leave the month open again for other tests in this database.
    await owner.gql(`mutation($id: ID!, $reason: String!) { reopenInventoryPeriod(id: $id, reason: $reason) }`, { id: periodId, reason: 'Test done, reopen for later runs' });
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 10 });
  });

  // (4) In-transit stock: product level and lot level agree on what is available.
  it('a product with stock in transit shows the same available at product level and lot level', async () => {
    const w = await h.world(admin, { stock: 0 });
    const a = await w.createLocation(`Src ${stamp()}`);
    const b = await w.createLocation(`Dst ${stamp()}`);
    await w.receiveGoods({ qty: 8, locationId: a.id });
    const [lot] = await lotsAt(h, w.product.id, a.id);
    const t = await transfer(admin, { from: a.id, to: b.id, lotId: lot.lotId, productId: w.product.id, qty: 5 });
    const lots = await h.prisma.inventoryLotBalance.findMany({ where: { lot: { productId: w.product.id } } });
    const product = await expectStockBooksAgree(h, w.product.id);
    expect(product.available).toBe(3);
    expect(sumBy(lots, (l) => l.available)).toBe(3);
    await transitionTransfer(admin, t.id, 'receive');
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 8, available: 8 });
  });
});
