import { Harness, Session, World, stamp } from '../harness';
import { challanWith, createBoxedTile, expectStockBooksAgree, tileLine } from '../stock-helpers';

const FULL_BOX = 'This tile is sold in full boxes of 9 pieces';

/**
 * The full-box rule for a tile sold by the box is checked per order line, not per lot row: lots do not
 * split on box boundaries, so one order line of 38 boxes (342 pc at 9 a box) can be held as 58 pc in one
 * lot and 284 pc in another. 20 boxes = 180 pc = 58 + 122 must go through at every step; a part-box
 * total must not; and a part box the reservation itself holds can still leave as the final remainder.
 */
describe('boxed tiles: whole boxes per order line across lots', () => {
  let h: Harness; let admin: Session;
  beforeAll(async () => { h = await Harness.boot(); admin = await h.as('admin'); });
  afterAll(async () => { await h.close(); });

  async function tileOnTwoLots(w: World, firstLot: number, secondLot: number, boxes: number) {
    const tile = await createBoxedTile(w, 9, 55);
    await w.receiveGoods({ qty: firstLot, productId: tile.id, unitCost: 30 });
    await w.receiveGoods({ qty: secondLot, productId: tile.id, unitCost: 30 });
    const order = await w.directOrder({ lines: [tileLine(w, tile, boxes, 55)], paymentMode: 'credit' });
    const [line] = await h.prisma.salesOrderLine.findMany({ where: { salesOrderId: order.id } });
    const held = await h.prisma.lotReservation.findMany({ where: { salesOrderLineId: line.id, status: 'reserved', quantity: { gt: 0 } }, include: { lot: true }, orderBy: { reservedAt: 'asc' } });
    return { tile, order, line, held };
  }
  const createPick = (w: World, salesOrderId: string, lines?: any[]) => admin.gqlRaw(`mutation($input: CreatePickListInput!) { createPickList(input: $input) }`, {
    input: { salesOrderId, locationId: w.location.id, ...(lines ? { lines: JSON.stringify(lines) } : {}) },
  });
  const transition = (pickId: string, action: string, input: any = {}) => admin.gqlRaw(`mutation($id: ID!, $action: String!, $input: PickListTransitionInput) { transitionPickList(id: $id, action: $action, input: $input) }`, { id: pickId, action, input });
  const row = (line: any, lot: any, quantity: number) => ({ salesOrderLineId: line.id, lotId: lot.lotId, locationId: lot.locationId, quantity });

  it('20 boxes split 58 + 122 across two lots go through pick list, pick, pack and challan; part-box totals are refused', async () => {
    const w = await h.world(admin, { stock: 0 });
    const { tile, order, line, held } = await tileOnTwoLots(w, 58, 284, 38);
    expect(held.map((r) => Number(r.quantity)).sort((a, b) => a - b)).toEqual([58, 284]);
    const lot1 = held.find((r) => Number(r.quantity) === 58)!;
    const lot2 = held.find((r) => Number(r.quantity) === 284)!;

    // Pick list: 58 alone is a part box (6 boxes + 4 pc) and is not everything held: refused.
    expect((await createPick(w, order.id, [row(line, lot1, 58)])).errors?.[0]?.message).toBe(FULL_BOX);
    expect((await createPick(w, order.id, [row(line, lot1, 58), row(line, lot2, 121)])).errors?.[0]?.message).toBe(FULL_BOX);
    const made = await createPick(w, order.id, [row(line, lot1, 58), row(line, lot2, 122)]);
    expect(made.errors).toBeUndefined();
    const pick = made.data.createPickList;
    const p1 = pick.lines.find((l: any) => l.lotId === lot1.lotId);
    const p2 = pick.lines.find((l: any) => l.lotId === lot2.lotId);
    expect([Number(p1.requestedQuantity), Number(p2.requestedQuantity)]).toEqual([58, 122]);

    expect((await transition(pick.id, 'start')).errors).toBeUndefined();
    // Pick: 50 + 121 = 171 = 19 boxes is fine although neither row is whole boxes; 58 + 121 = 179 is not.
    const picked = (a: number, b: number) => transition(pick.id, 'pick', { lines: JSON.stringify([{ pickLineId: p1.id, pickedQuantity: a }, { pickLineId: p2.id, pickedQuantity: b }]) });
    expect((await picked(58, 121)).errors?.[0]?.message).toBe(FULL_BOX);
    expect((await picked(50, 121)).errors).toBeUndefined();
    // Pack: 49 + 113 = 162 = 18 boxes; 50 + 120 = 170 is a part box.
    const packed = (a: number, b: number) => transition(pick.id, 'pack', { lines: JSON.stringify([{ pickLineId: p1.id, packedQuantity: a }, { pickLineId: p2.id, packedQuantity: b }]) });
    expect((await packed(50, 120)).errors?.[0]?.message).toBe(FULL_BOX);
    expect((await packed(49, 113)).errors).toBeUndefined();
    expect((await transition(pick.id, 'complete')).errors).toBeUndefined();
    expect((await expectStockBooksAgree(h, tile.id)).onHand).toBe(342);

    // Challan: 40 + 113 = 153 = 17 boxes goes; 49 + 112 = 161 does not.
    const job = (await h.prisma.dispatchJob.findUnique({ where: { salesOrderId: order.id } }))!;
    const refused = await admin.gqlRaw(`mutation($input: CreateChallanInput!) { createChallan(input: $input) { id } }`, {
      input: { jobId: job.id, salesOrderId: order.id, pickListId: pick.id, packages: 1, driverName: 'Ramesh Patel', driverPhone: '9876543210', vehicleNo: 'GJ 01 AB 1234', lines: JSON.stringify([{ pickLineId: p1.id, dispatchQty: 49 }, { pickLineId: p2.id, dispatchQty: 112 }]) },
    });
    expect(refused.errors?.[0]?.message).toBe(FULL_BOX);
    const challan = await challanWith(w, order.id, { pickListId: pick.id, lines: [{ pickLineId: p1.id, dispatchQty: 40 }, { pickLineId: p2.id, dispatchQty: 113 }] });
    await w.dispatch(challan.id);
    const sent = await h.prisma.dispatchLine.findMany({ where: { challanId: challan.id } });
    expect(sent.map((l: any) => [l.lotId, Number(l.dispatchedQuantity)]).sort()).toEqual([[lot1.lotId, 40], [lot2.lotId, 113]].sort());

    // Stock posted in pieces, lot by lot.
    const totals = await expectStockBooksAgree(h, tile.id);
    expect(totals.onHand).toBe(342 - 153);
    const lotRows = await h.prisma.inventoryLotBalance.findMany({ where: { lot: { productId: tile.id } } });
    const onHand = (lotId: string) => lotRows.filter((r: any) => r.lotId === lotId).reduce((t, r: any) => t + Number(r.onHand), 0);
    expect([onHand(lot1.lotId), onHand(lot2.lotId)]).toEqual([58 - 40, 284 - 113]);

    // The 9 pc still packed (one box, all on lot 1) leaves on a second challan.
    const rest = await challanWith(w, order.id, { pickListId: pick.id, lines: [{ pickLineId: p1.id, dispatchQty: 9 }] });
    await w.dispatch(rest.id);
    expect((await expectStockBooksAgree(h, tile.id)).onHand).toBe(342 - 162);
  });

  it('the final remainder of a part-box reservation leaves when it is everything left; less than that is refused', async () => {
    const w = await h.world(admin, { stock: 0 });
    // 38 boxes ordered, only 338 pc in stock: 37 boxes + 5 pc reserved over two lots.
    const { tile, order, line, held } = await tileOnTwoLots(w, 58, 280, 38);
    expect(held.reduce((t, r) => t + Number(r.quantity), 0)).toBe(338);
    const lot1 = held.find((r) => Number(r.quantity) === 58)!;
    const lot2 = held.find((r) => Number(r.quantity) === 280)!;

    // First 20 boxes: 58 + 122, the whole way through.
    const first = await createPick(w, order.id, [row(line, lot1, 58), row(line, lot2, 122)]);
    expect(first.errors).toBeUndefined();
    const pick1 = first.data.createPickList;
    await transition(pick1.id, 'start');
    expect((await transition(pick1.id, 'pick', { lines: JSON.stringify(pick1.lines.map((l: any) => ({ pickLineId: l.id, pickedQuantity: Number(l.requestedQuantity) }))) })).errors).toBeUndefined();
    expect((await transition(pick1.id, 'pack', { lines: JSON.stringify(pick1.lines.map((l: any) => ({ pickLineId: l.id, packedQuantity: Number(l.requestedQuantity) }))) })).errors).toBeUndefined();
    expect((await transition(pick1.id, 'complete')).errors).toBeUndefined();
    const c1 = await challanWith(w, order.id, { pickListId: pick1.id, lines: pick1.lines.map((l: any) => ({ pickLineId: l.id, dispatchQty: Number(l.requestedQuantity) })) });
    await w.dispatch(c1.id);
    expect((await expectStockBooksAgree(h, tile.id)).onHand).toBe(338 - 180);

    // What is left held: 158 pc on lot 2 = 17 boxes + 5 pc. Less than all of it, as a part box: refused.
    expect((await createPick(w, order.id, [row(line, lot2, 157)])).errors?.[0]?.message).toBe(FULL_BOX);
    const second = await createPick(w, order.id, [row(line, lot2, 158)]);
    expect(second.errors).toBeUndefined();
    const pick2 = second.data.createPickList;
    expect(pick2.lines.map((l: any) => Number(l.requestedQuantity))).toEqual([158]);
    await transition(pick2.id, 'start');
    expect((await transition(pick2.id, 'pick', { lines: JSON.stringify([{ pickLineId: pick2.lines[0].id, pickedQuantity: 157 }]) })).errors?.[0]?.message).toBe(FULL_BOX);
    expect((await transition(pick2.id, 'pick', { lines: JSON.stringify([{ pickLineId: pick2.lines[0].id, pickedQuantity: 158 }]) })).errors).toBeUndefined();
    expect((await transition(pick2.id, 'pack', { lines: JSON.stringify([{ pickLineId: pick2.lines[0].id, packedQuantity: 158 }]) })).errors).toBeUndefined();
    expect((await transition(pick2.id, 'complete')).errors).toBeUndefined();
    const c2 = await challanWith(w, order.id, { pickListId: pick2.id, lines: [{ pickLineId: pick2.lines[0].id, dispatchQty: 158 }] });
    await w.dispatch(c2.id);
    expect(await expectStockBooksAgree(h, tile.id)).toMatchObject({ onHand: 0, reserved: 0 });
  });

  it('a tile sold by the piece and a non-tile item stay unrestricted across lots', async () => {
    const w = await h.world(admin, { stock: 0 });
    const sku = `HT-PTILE-${stamp()}`;
    const tile = (await admin.gql(`mutation($input: CreateProductInput!) { createProduct(input: $input) { id sku name } }`, {
      input: {
        sku, internalCode: sku, name: `Harness piece tile ${sku}`, category: 'Tiles', brand: 'Harness', finish: 'Matt',
        unit: 'PC', baseUom: 'PC', purchaseUom: 'PC', salesUom: 'PC', piecesPerPack: 9, allowLoose: true,
        defaultMrpInclusive: 65, defaultNrpInclusive: 55, floorPriceInclusive: 44, priceRateBasis: 'PIECE', priceUom: 'PC', mrpSource: 'MANUAL', taxClass: 'GST_18',
      },
    })).createProduct;
    await w.receiveGoods({ qty: 58, productId: tile.id, unitCost: 30 });
    await w.receiveGoods({ qty: 284, productId: tile.id, unitCost: 30 });
    const order = await w.directOrder({ lines: [{ ...w.line({ qty: 342, productId: tile.id, sku: tile.sku, name: tile.name, rate: 55 }), category: 'Tiles', unit: 'PC', inventoryUom: 'PC', tileSize: '600x600 mm', rateBasis: 'PIECE', pricingUom: 'PC', piecesPerPack: 9 } as any], paymentMode: 'credit' });
    const [line] = await h.prisma.salesOrderLine.findMany({ where: { salesOrderId: order.id } });
    const held = await h.prisma.lotReservation.findMany({ where: { salesOrderLineId: line.id, status: 'reserved', quantity: { gt: 0 } } });
    const lot1 = held.find((r) => Number(r.quantity) === 58)!;
    const made = await createPick(w, order.id, [row(line, lot1, 31)]);
    expect(made.errors).toBeUndefined();
    expect(made.data.createPickList.lines.map((l: any) => Number(l.requestedQuantity))).toEqual([31]);
    await expectStockBooksAgree(h, tile.id);
  });

  it('a goods receipt on a PO line whose demand is already closed keeps it closed and comes in as free stock', async () => {
    const w = await h.world(admin, { stock: 0 });
    const stockUser = await h.as('inventory_manager');
    const order = await w.directOrder({ qty: 3, paymentMode: 'credit' });
    const demand = (await h.prisma.purchaseDemand.findFirst({ where: { sourceOrderId: order.id } }))!;
    expect(demand).toBeTruthy();
    const po = (await stockUser.gql(`mutation($input: CreatePurchaseOrderInput!) { createPurchaseOrder(input: $input) }`, { input: { vendorName: 'Harness supplier', demandIds: [demand.id] } })).createPurchaseOrder;
    const [poLine] = await h.prisma.purchaseOrderLine.findMany({ where: { purchaseOrderId: po.id } });
    expect((await h.prisma.purchaseDemand.findUnique({ where: { id: demand.id } }))!.status).toBe('ordered');

    // The shortage is filled from other stock before the supplier delivers; the order is shipped and delivered.
    await w.receiveGoods({ qty: 3 });
    const { challan } = await w.ship(order.id);
    await w.deliver(challan.id);
    expect((await w.order(order.id))!.status).toBe('delivered');
    expect((await h.prisma.purchaseDemand.findUnique({ where: { id: demand.id } }))!.status).toBe('closed');
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 0, reserved: 0 });

    // The supplier's goods arrive afterwards on the same PO line.
    await stockUser.gql(`mutation($input: ReceivePurchaseOrderInput!) { receivePurchaseOrder(input: $input) }`, {
      input: { purchaseOrderId: po.id, locationId: w.location.id, idempotencyKey: `HT-CLOSED-${stamp()}`, lines: JSON.stringify([{ purchaseOrderLineId: poLine.id, receivedQuantity: 3, enteredUnitCost: 500, rateUom: 'PC' }]) },
    });
    const after = (await h.prisma.purchaseDemand.findUnique({ where: { id: demand.id } }))!;
    expect(after.status).toBe('closed');
    expect(Number(after.receivedQuantity)).toBe(3);
    expect(await h.prisma.reservation.count({ where: { salesOrderId: order.id, status: { in: ['reserved', 'backordered'] } } })).toBe(0);
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 3, reserved: 0, available: 3 });
  });
});
