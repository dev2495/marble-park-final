import { Harness, Session } from '../harness';
import {
  expectStockBooksAgree, orderLines, challanWith, challanRaw, cancelChallan, failDelivery, lotsAt, createBoxedTile, tileLine, sumBy,
} from '../stock-helpers';

/** Stock lane B1, B4, B5, B11, B13 and the boxed-tile unit rule, end to end through /graphql. */
describe('stock: pick, challan, dispatch and delivery', () => {
  let h: Harness; let admin: Session;
  beforeAll(async () => { h = await Harness.boot(); admin = await h.as('admin'); });
  afterAll(async () => { await h.close(); });

  const pickStatus = async (id: string) => (await h.prisma.pickList.findUnique({ where: { id } }))!.status;
  const challanRow = async (id: string) => (await h.prisma.dispatchChallan.findUnique({ where: { id } }))!;
  const dispatchLines = (challanId: string) => h.prisma.dispatchLine.findMany({ where: { challanId }, orderBy: { createdAt: 'asc' } });
  const setStatus = (id: string, status: string) => admin.gqlRaw(`mutation($id: ID!, $status: String!) { updateChallanStatus(id: $id, status: $status) { id status } }`, { id, status });
  const job = async (salesOrderId: string) => (await h.prisma.dispatchJob.findUnique({ where: { salesOrderId } }))!;

  // Scenario 2 and B11 for an order made from a quote.
  it('the same item in two rooms: pick, challan, dispatch and delivery give each order line its own quantity', async () => {
    const w = await h.world(admin, { stock: 10 });
    const quote = await w.createQuote([w.line({ qty: 2, area: 'Kitchen' }), w.line({ qty: 3, area: 'Bathroom' })]);
    const order = await w.convertQuote(quote.id);
    const pick = await w.pick(order.id);
    expect(pick.lines).toHaveLength(2);
    const challan = await challanWith(w, order.id, { pickListId: pick.id });
    expect(await pickStatus(pick.id)).toBe('challan_created');
    await expectStockBooksAgree(h, w.product.id);
    await w.dispatch(challan.id);
    const lines = await orderLines(h, order.id);
    expect(lines.map((l) => [l.area, l.dispatchedQuantity])).toEqual([['Kitchen', 2], ['Bathroom', 3]]);
    const sent = await dispatchLines(challan.id);
    expect(sent.map((l) => l.dispatchedQuantity).sort()).toEqual([2, 3]);
    expect(new Set(sent.map((l) => l.salesOrderLineId)).size).toBe(2);
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 5, reserved: 0, available: 5 });
    await w.deliver(challan.id);
    const after = await orderLines(h, order.id);
    expect(after.map((l) => l.deliveredQuantity)).toEqual([2, 3]);
    expect((await w.order(order.id))!.status).toBe('delivered');
    expect((await job(order.id)).status).toBe('delivered');
    await expectStockBooksAgree(h, w.product.id);
  });

  // Scenario 10.
  it('a direct order that is fully delivered closes its dispatch job and the order as delivered', async () => {
    const w = await h.world(admin, { stock: 5 });
    const order = await w.directOrder({ qty: 2 });
    const { challan } = await w.ship(order.id);
    expect((await w.order(order.id))!.status).toBe('dispatched');
    expect((await job(order.id)).status).toBe('dispatched');
    await w.deliver(challan.id);
    expect((await w.order(order.id))!.status).toBe('delivered');
    expect((await job(order.id)).status).toBe('delivered');
    expect((await orderLines(h, order.id))[0]).toMatchObject({ dispatchedQuantity: 2, deliveredQuantity: 2 });
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 3, reserved: 0 });
  });

  it('one order line held in two lots: each dispatch line carries its own lot quantity', async () => {
    const w = await h.world(admin, { stock: 0 });
    await w.receiveGoods({ qty: 3 });
    await w.receiveGoods({ qty: 2 });
    const order = await w.directOrder({ qty: 5 });
    const pick = await w.pick(order.id);
    expect(pick.lines.map((l: any) => Number(l.requestedQuantity)).sort()).toEqual([2, 3]);
    const { id } = await challanWith(w, order.id, { pickListId: pick.id });
    await w.dispatch(id);
    const sent = await dispatchLines(id);
    expect(sent.map((l) => l.dispatchedQuantity).sort()).toEqual([2, 3]);
    expect(new Set(sent.map((l) => l.lotId)).size).toBe(2);
    expect((await orderLines(h, order.id))[0].dispatchedQuantity).toBe(5);
    for (const lot of await lotsAt(h, w.product.id, w.location.id)) expect(lot).toMatchObject({ onHand: 0, reserved: 0 });
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 0, reserved: 0 });
  });

  // Scenario 7.
  it('a part challan leaves the rest of the pick for the next challan', async () => {
    const w = await h.world(admin, { stock: 10 });
    const order = await w.directOrder({ qty: 10 });
    const pick = await w.pick(order.id);
    const pickLineId = pick.lines[0].id;
    const first = await challanWith(w, order.id, { pickListId: pick.id, lines: [{ pickLineId, dispatchQty: 4 }] });
    expect(await pickStatus(pick.id)).toBe('completed');
    // More than what is left on the pick is refused.
    const job1 = await job(order.id);
    const tooMuch = await challanRaw(w, job1.id, order.id, { pickListId: pick.id, lines: JSON.stringify([{ pickLineId, dispatchQty: 7 }]), driverName: 'Ramesh Patel', driverPhone: '9876543210', vehicleNo: 'GJ 01 AB 1234' });
    expect(tooMuch.errors?.[0]?.message).toMatch(/only 6 packed/);
    await w.dispatch(first.id);
    expect((await h.prisma.pickLine.findUnique({ where: { id: pickLineId } }))!.status).not.toBe('dispatched');
    expect((await orderLines(h, order.id))[0].dispatchedQuantity).toBe(4);
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 6, reserved: 6 });
    const second = await challanWith(w, order.id, { pickListId: pick.id, lines: [{ pickLineId, dispatchQty: 6 }] });
    expect(await pickStatus(pick.id)).toBe('challan_created');
    await w.dispatch(second.id);
    expect((await h.prisma.pickLine.findUnique({ where: { id: pickLineId } }))!.status).toBe('dispatched');
    expect(await pickStatus(pick.id)).toBe('dispatched');
    expect((await orderLines(h, order.id))[0].dispatchedQuantity).toBe(10);
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 0, reserved: 0 });
  });

  // Scenario 8, first half.
  it('cancelling a challan before it leaves puts the pick back so a new challan can be made', async () => {
    const w = await h.world(admin, { stock: 5 });
    const order = await w.directOrder({ qty: 3 });
    const pick = await w.pick(order.id);
    const challan = await challanWith(w, order.id, { pickListId: pick.id });
    expect(await pickStatus(pick.id)).toBe('challan_created');
    await cancelChallan(admin, challan.id);
    expect((await challanRow(challan.id)).status).toBe('cancelled');
    expect((await dispatchLines(challan.id)).every((l) => l.status === 'cancelled')).toBe(true);
    expect(await pickStatus(pick.id)).toBe('completed');
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 5, reserved: 3 });
    const again = await challanWith(w, order.id, { pickListId: pick.id });
    await w.dispatch(again.id);
    expect((await orderLines(h, order.id))[0].dispatchedQuantity).toBe(3);
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 2, reserved: 0 });
  });

  // Scenario 8, second half.
  it('a failed delivery: the challan cannot be cancelled while out; once back, stock returns with a movement and is held for the same line', async () => {
    const w = await h.world(admin, { stock: 5 });
    const order = await w.directOrder({ qty: 3 });
    const { challan } = await w.ship(order.id);
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 2, reserved: 0 });
    const early = await admin.gqlRaw(`mutation($id: ID!, $reason: String!) { cancelChallan(id: $id, reason: $reason) }`, { id: challan.id, reason: 'Trying to cancel while out' });
    expect(early.errors?.[0]?.message).toMatch(/out for delivery/);
    await failDelivery(admin, challan.id);
    expect((await challanRow(challan.id)).status).toBe('failed_delivery');
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 2 }); // still on the road until it is back
    await cancelChallan(admin, challan.id, 'Goods back at the godown');
    expect((await challanRow(challan.id)).status).toBe('cancelled');
    const orderLine = (await orderLines(h, order.id))[0];
    expect(orderLine).toMatchObject({ dispatchedQuantity: 0, reservedQuantity: 3 });
    const heldForLine = await h.prisma.lotReservation.findMany({ where: { salesOrderLineId: orderLine.id, status: 'reserved' } });
    expect(sumBy(heldForLine, (r) => r.quantity)).toBe(3);
    const movement = await h.prisma.inventoryLotLedgerEntry.findMany({ where: { referenceId: challan.id, type: 'failed_delivery_return' } });
    expect(sumBy(movement, (m) => m.onHandDelta)).toBe(3);
    expect((await dispatchLines(challan.id)).every((l) => l.status === 'returned')).toBe(true);
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 5, reserved: 3, available: 2 });
    // The goods held again can be picked and sent on a new challan.
    const { challan: resend } = await w.ship(order.id);
    expect((await orderLines(h, order.id))[0].dispatchedQuantity).toBe(3);
    await w.deliver(resend.id);
    expect((await w.order(order.id))!.status).toBe('delivered');
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 2, reserved: 0 });
  });

  it('a failed delivery sent again moves no stock a second time', async () => {
    const w = await h.world(admin, { stock: 4 });
    const order = await w.directOrder({ qty: 2 });
    const { challan } = await w.ship(order.id);
    await failDelivery(admin, challan.id);
    const r = await setStatus(challan.id, 'dispatched');
    expect(r.errors).toBeUndefined();
    expect((await challanRow(challan.id)).status).toBe('dispatched');
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 2, reserved: 0 });
    await w.deliver(challan.id);
    expect((await orderLines(h, order.id))[0]).toMatchObject({ dispatchedQuantity: 2, deliveredQuantity: 2 });
  });

  // Scenario 9 (API part; the PDF is a script).
  it('challan transport: placeholders refused, customer pickup needs none, editable only until dispatch, old placeholder challans still work', async () => {
    const w = await h.world(admin, { stock: 6 });
    const order = await w.directOrder({ qty: 2 });
    const pick = await w.pick(order.id);
    const j = await job(order.id);
    const base = { pickListId: pick.id };
    for (const bad of [
      { vehicleNo: 'PENDING', driverName: 'Ramesh Patel', driverPhone: '9876543210' },
      { vehicleNo: 'GJ 01 AB 1234', driverName: 'Ramesh Patel', driverPhone: '0000000000' },
      { vehicleNo: 'GJ 01 AB 1234', driverName: '', driverPhone: '9876543210' },
      { vehicleNo: '', driverName: 'Ramesh Patel', driverPhone: '9876543210' },
    ]) {
      const r = await challanRaw(w, j.id, order.id, { ...base, ...bad });
      expect(r.errors?.length).toBeGreaterThan(0);
    }
    expect(await h.prisma.dispatchChallan.count({ where: { salesOrderId: order.id } })).toBe(0);
    const pickup = await challanWith(w, order.id, { pickListId: pick.id, transport: { transportMode: 'self_pickup' } });
    expect(await challanRow(pickup.id)).toMatchObject({ transportMode: 'self_pickup', vehicleNumber: null });
    const edit = (input: any) => admin.gqlRaw(`mutation($id: ID!, $input: ChallanTransportUpdateInput!) { updateChallanTransport(id: $id, input: $input) }`, { id: pickup.id, input });
    expect((await edit({ transportMode: 'vehicle', vehicleNo: 'PENDING', driverName: 'Ramesh', driverPhone: '9876543210' })).errors?.length).toBeGreaterThan(0);
    expect((await edit({ transportMode: 'vehicle', vehicleNo: 'gj 05 cd 9876', driverName: 'Suresh Shah', driverPhone: '9898989898' })).errors).toBeUndefined();
    expect(await challanRow(pickup.id)).toMatchObject({ transportMode: 'vehicle', vehicleNumber: 'GJ 05 CD 9876', driverName: 'Suresh Shah' });
    await w.dispatch(pickup.id);
    expect((await edit({ transportMode: 'self_pickup' })).errors?.[0]?.message).toMatch(/already left/);

    // An old challan saved with the placeholder transport (before the form) still dispatches and delivers.
    const order2 = await w.directOrder({ qty: 1 });
    const pick2 = await w.pick(order2.id);
    const old = await challanWith(w, order2.id, { pickListId: pick2.id });
    await h.prisma.dispatchChallan.update({ where: { id: old.id }, data: { transportMode: null, vehicleNumber: 'PENDING', driverName: 'Dispatch desk', transporterName: 'Store vehicle', contactPhone: '0000000000' } });
    expect((await setStatus(old.id, 'dispatched')).errors).toBeUndefined();
    await w.deliver(old.id);
    expect((await challanRow(old.id)).status).toBe('delivered');
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 3, reserved: 0 });
  });

  // Boxed tiles: orders in boxes, stock in pieces, every conversion in between.
  it('a tile sold by the box and stocked by the piece: receive, reserve, backorder, pick, dispatch and fill all convert right', async () => {
    const w = await h.world(admin, { stock: 0 });
    const tile = await createBoxedTile(w, 4);
    const grn = (lines: any[]) => admin.gql(`mutation($input: ManualGoodsReceiptInput!) { createManualGoodsReceipt(input: $input) }`, {
      input: { vendorName: 'Harness tiles', locationId: w.location.id, reason: 'Tile inward test', idempotencyKey: `HT-TG-${Date.now()}-${Math.random()}`, lines: JSON.stringify(lines) },
    });
    await grn([{ productId: tile.id, boxes: 3, loosePieces: 2, enteredUnitCost: 400, rateUom: 'PC' }]);
    expect(await expectStockBooksAgree(h, tile.id)).toMatchObject({ onHand: 14, available: 14 }); // 3 boxes of 4 + 2 loose

    const first = await w.directOrder({ lines: [tileLine(w, tile, 3)] });
    expect((await orderLines(h, first.id))[0]).toMatchObject({ unit: 'BOX', orderedQuantity: 3, reservedQuantity: 3, backorderedQuantity: 0 });
    expect(await expectStockBooksAgree(h, tile.id)).toMatchObject({ onHand: 14, reserved: 12, available: 2 });

    const second = await w.directOrder({ lines: [tileLine(w, tile, 5)] });
    expect((await orderLines(h, second.id))[0]).toMatchObject({ orderedQuantity: 5, reservedQuantity: 0, backorderedQuantity: 5 });
    await expectStockBooksAgree(h, tile.id);

    const pick = await w.pick(first.id);
    expect(sumBy(pick.lines, (l: any) => l.requestedQuantity)).toBe(12); // pieces
    const { id } = await challanWith(w, first.id, { pickListId: pick.id });
    await w.dispatch(id);
    expect((await orderLines(h, first.id))[0]).toMatchObject({ dispatchedQuantity: 3 }); // boxes
    expect(sumBy(await dispatchLines(id), (l) => l.dispatchedQuantity)).toBe(12);
    await w.deliver(id);
    expect((await orderLines(h, first.id))[0]).toMatchObject({ deliveredQuantity: 3 });
    expect((await w.order(first.id))!.status).toBe('delivered');
    expect(await expectStockBooksAgree(h, tile.id)).toMatchObject({ onHand: 2 });

    await grn([{ productId: tile.id, boxes: 5, enteredUnitCost: 400, rateUom: 'PC' }]);
    expect((await orderLines(h, second.id))[0]).toMatchObject({ reservedQuantity: 5, backorderedQuantity: 0 });
    expect(await expectStockBooksAgree(h, tile.id)).toMatchObject({ onHand: 22, reserved: 20, available: 2 });
  });

  it('pick list location: the dispatch screen is told where the reserved stock is, and a wrong location names it', async () => {
    const w = await h.world(admin, { stock: 10 });
    const order = await w.directOrder({ qty: 2 });
    const other = await w.createLocation();
    const queueJob = async () => ((await admin.gql(`{ dispatchQueue }`)).dispatchQueue as any[]).find((j) => j.salesOrderId === order.id);
    expect((await queueJob()).pickableLocations).toEqual([expect.objectContaining({ locationId: w.location.id, quantity: 2 })]);
    const wrong = await admin.gqlRaw(`mutation($input: CreatePickListInput!) { createPickList(input: $input) }`, { input: { salesOrderId: order.id, locationId: other.id } });
    expect(wrong.errors?.[0]?.message).toContain(`reserved stock is at: ${w.location.name}`);
    await w.pick(order.id);
    expect((await queueJob()).pickableLocations).toEqual([]);
  });
});
