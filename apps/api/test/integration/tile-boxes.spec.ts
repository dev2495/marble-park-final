import { Harness, Session } from '../harness';
import { createBoxedTile, tileLine } from '../stock-helpers';
import { boxQuantity, boxQuantityFromSelling } from '../../src/modules/common/stock-units';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { priceQuoteLines } = require('@marble-park/pricing-contract');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { formatBoxQuantity } = require('@marble-park/pricing-contract/box-quantity');

/**
 * Tiles read in boxes on quotes and dispatch documents (the client's slip: 342 pc at 9 a box is 38 boxes),
 * while stock, picks and dispatch lines keep counting pieces and every amount stays as priced.
 */
describe('boxed tiles read in boxes from quote to dispatch, stock stays in pieces', () => {
  let h: Harness; let admin: Session;
  beforeAll(async () => { h = await Harness.boot(); admin = await h.as('admin'); });
  afterAll(async () => { await h.close(); });

  it('38 boxes of 9: quote, order, pick, challan, dispatch and invoice', async () => {
    const w = await h.world(admin, { stock: 0 });
    const tile = await createBoxedTile(w, 9, 55);
    await w.receiveGoods({ qty: 400, productId: tile.id, unitCost: 30 });
    const before = await w.balance(tile.id);
    expect(before.onHand).toBe(400);

    // Quote: the line counts boxes; the price is per piece on 342 pieces.
    const quote = await w.createQuote([{ ...tileLine(w, tile, 38, 55), pricingQuantity: 342 } as any]);
    const stored: any = await h.prisma.quote.findUnique({ where: { id: quote.id } });
    const line = (stored.lines as any[])[0];
    expect(Number(line.qty ?? line.quantity)).toBe(38);
    expect(Number(line.pricingQuantity)).toBe(342);
    // The box label on the quote, from the same formatter the screen and PDF use.
    expect(formatBoxQuantity(Number(line.qty) * Number(line.piecesPerPack), { piecesPerUnit: line.piecesPerPack, orderUnit: 'BOX', unit: 'PC' }).label).toBe('38 Box');

    // Amounts are byte-identical to the unchanged pricing library for the same inputs.
    const expected = priceQuoteLines([{
      pricingQuantity: line.pricingQuantity, mrpInclusive: line.mrpInclusive, priceRateBasis: line.priceRateBasis, lineRateBasis: line.rateBasis || line.priceRateBasis,
      nrpMode: line.nrpMode, nrpInput: line.nrpInput, specialMode: line.specialMode, specialInput: line.specialInput, taxRate: line.taxRate, taxTreatment: line.taxTreatment,
    }], { mode: line.quoteDiscountMode || 'PERCENT', value: line.quoteDiscountValue || 0 }, { requireComplete: false });
    expect(Number(line.grossLineTotal)).toBe(expected.lines[0].grossLineTotal);
    expect(Number(line.taxableValue)).toBe(expected.lines[0].taxableValue);
    expect(Number(line.taxAmount)).toBe(expected.lines[0].taxAmount);
    expect(Number(stored.commercialTotal)).toBe(expected.totals.grandTotal);

    // Order: 38 boxes ordered, 342 pieces held.
    const fulfilment = await w.quoteFulfillment(quote.id);
    expect(fulfilment.lines[0]).toMatchObject({ quantity: 38, piecesPerUnit: 9 });
    const order = await w.convertQuote(quote.id);
    const orderLine: any = await h.prisma.salesOrderLine.findFirst({ where: { salesOrderId: order.id } });
    expect(Number(orderLine.orderedQuantity)).toBe(38);
    expect(Number(orderLine.grossLineTotal)).toBe(expected.lines[0].grossLineTotal);
    const reservations = await w.reservations(order.id);
    expect(reservations.filter((r: any) => r.status === 'reserved').reduce((n: number, r: any) => n + Number(r.quantity), 0)).toBe(342);
    const product = await h.prisma.product.findUnique({ where: { id: tile.id } });
    expect(boxQuantityFromSelling(product, orderLine.reservedQuantity).label).toBe('38 Box');

    const tower = (await admin.gql(`query($search: String) { salesOrderControlTower(search: $search) }`, { search: order.orderNumber })).salesOrderControlTower;
    const towerLine = tower.items.find((row: any) => row.id === order.id).lines[0];
    expect(towerLine).toMatchObject({ orderedQuantity: 38, piecesPerUnit: 9 });

    // Pick: pieces, read as boxes.
    const { pick, challan } = await w.ship(order.id);
    expect(pick.lines.map((l: any) => Number(l.requestedQuantity))).toEqual([342]);
    expect(boxQuantity({ baseUom: 'PC', unit: 'BOX', piecesPerPack: 9 }, pick.lines[0].requestedQuantity).fullLabel).toBe('38 Box (342 pc)');

    // Challan: the slip's line counts 342 pieces and carries 9 a box, so it reads "38 Box".
    const slip = (await admin.gql(`query($id: ID!) { dispatchChallan(id: $id) }`, { id: challan.id })).dispatchChallan;
    expect(slip.lines).toHaveLength(1);
    expect(slip.lines[0]).toMatchObject({ dispatchQty: 342, unit: 'PC', piecesPerUnit: 9 });
    const slipQty = formatBoxQuantity(slip.lines[0].dispatchQty, { unit: slip.lines[0].unit, orderUnit: slip.lines[0].orderUnit, piecesPerUnit: slip.lines[0].piecesPerUnit });
    expect(slipQty).toMatchObject({ isBoxed: true, boxes: 38, loosePieces: 0, label: '38 Box', unitLabel: 'BOX', piecesLabel: '342 pc' });

    // Dispatch posted 342 pieces, not 38.
    const after = await w.balance(tile.id);
    expect(after.onHand).toBe(400 - 342);
    const dispatchLines = await h.prisma.dispatchLine.findMany({ where: { challanId: challan.id } });
    expect(dispatchLines.reduce((n, l: any) => n + Number(l.dispatchedQuantity), 0)).toBe(342);
    const sent = (await admin.gql(`query($id: ID!) { salesOrderDispatchedQuantities(salesOrderId: $id) }`, { id: order.id })).salesOrderDispatchedQuantities;
    expect(sent[0]).toMatchObject({ sentQuantity: 38, piecesPerUnit: 9 });

    // Dispatch queue: order line in boxes, challan line carries the factor.
    const queue = (await admin.gql(`query { dispatchQueue }`)).dispatchQueue;
    const job = queue.find((row: any) => row.salesOrderId === order.id);
    expect(job).toBeTruthy();
    expect(job.lines[0]).toMatchObject({ orderedQty: 38, piecesPerUnit: 9 });
    expect(job.challans[0].lines[0]).toMatchObject({ dispatchQty: 342, piecesPerUnit: 9 });

    // Invoice: billed in pieces at the order's value, read in boxes.
    const invoice = await w.invoice(order.id, challan.id);
    const view = (await admin.gql(`query($id: ID!) { salesInvoice(id: $id) }`, { id: invoice.id })).salesInvoice;
    expect(view.lines[0]).toMatchObject({ quantity: 342, unit: 'PC', piecesPerUnit: 9 });
    expect(Number(view.lines[0].grossLineTotal)).toBe(expected.lines[0].grossLineTotal);
    expect(formatBoxQuantity(view.lines[0].quantity, { unit: 'PC', piecesPerUnit: view.lines[0].piecesPerUnit }).label).toBe('38 Box');
  });

  it('a tile sold by the box cannot leave as a part box typed by hand', async () => {
    const w = await h.world(admin, { stock: 0 });
    const tile = await createBoxedTile(w, 9, 55);
    await w.receiveGoods({ qty: 400, productId: tile.id, unitCost: 30 });
    const order = await w.directOrder({ lines: [tileLine(w, tile, 38, 55)] });
    const pick = (await admin.gql(`mutation($input: CreatePickListInput!) { createPickList(input: $input) }`, { input: { salesOrderId: order.id, locationId: w.location.id } })).createPickList;
    const t = (action: string, input: any = {}) => admin.gqlRaw(`mutation($id: ID!, $action: String!, $input: PickListTransitionInput) { transitionPickList(id: $id, action: $action, input: $input) }`, { id: pick.id, action, input });
    await t('start');
    // Picking 340 of 342 pieces (37 boxes and 7 loose) is refused.
    const partPick = await t('pick', { lines: JSON.stringify([{ pickLineId: pick.lines[0].id, pickedQuantity: 340 }]) });
    expect(partPick.errors?.[0]?.message).toBe('This tile is sold in full boxes of 9 pieces');
    // The whole pick (what the system offers) goes through; packing 37 whole boxes is fine, a part box is not.
    expect((await t('pick', { lines: JSON.stringify([{ pickLineId: pick.lines[0].id, pickedQuantity: 342 }]) })).errors).toBeUndefined();
    const partPack = await t('pack', { lines: JSON.stringify([{ pickLineId: pick.lines[0].id, packedQuantity: 335 }]) });
    expect(partPack.errors?.[0]?.message).toBe('This tile is sold in full boxes of 9 pieces');
    expect((await t('pack', { lines: JSON.stringify([{ pickLineId: pick.lines[0].id, packedQuantity: 333 }]) })).errors).toBeUndefined();
    const line = await h.prisma.pickLine.findUnique({ where: { id: pick.lines[0].id } });
    expect(line!.packedQuantity).toBe(333);
    // Nothing was posted out of stock by the refused entries.
    expect((await w.balance(tile.id)).onHand).toBe(400);
  });

  it('a tile sold by the piece (9 a box) reads "38 Box + 2 pc" on the challan, 344 pieces leave', async () => {
    const w = await h.world(admin, { stock: 0 });
    const sku = `HT-PTILE-${Date.now()}`;
    const tile = (await admin.gql(`mutation($input: CreateProductInput!) { createProduct(input: $input) { id sku name } }`, {
      input: {
        sku, internalCode: sku, name: `Harness piece tile ${sku}`, category: 'Tiles', brand: 'Harness', finish: 'Matt',
        unit: 'PC', baseUom: 'PC', purchaseUom: 'PC', salesUom: 'PC', piecesPerPack: 9, allowLoose: true,
        defaultMrpInclusive: 65, defaultNrpInclusive: 55, floorPriceInclusive: 44, priceRateBasis: 'PIECE', priceUom: 'PC', mrpSource: 'MANUAL', taxClass: 'GST_18',
      },
    })).createProduct;
    await w.receiveGoods({ qty: 400, productId: tile.id, unitCost: 30 });
    const order = await w.directOrder({ lines: [{ ...w.line({ qty: 344, productId: tile.id, sku: tile.sku, name: tile.name, rate: 55 }), category: 'Tiles', unit: 'PC', inventoryUom: 'PC', tileSize: '600x600 mm', rateBasis: 'PIECE', pricingUom: 'PC', piecesPerPack: 9 } as any] });
    const { challan } = await w.ship(order.id);
    const slip = (await admin.gql(`query($id: ID!) { dispatchChallan(id: $id) }`, { id: challan.id })).dispatchChallan;
    expect(slip.lines[0]).toMatchObject({ dispatchQty: 344, piecesPerUnit: 1, piecesPerBox: 9, soldBy: 'PIECE' });
    const qty = formatBoxQuantity(slip.lines[0].dispatchQty, slip.lines[0]);
    expect(qty).toMatchObject({ boxes: 38, loosePieces: 2, label: '38 Box + 2 pc', piecesLabel: '344 pc' });
    expect((await w.balance(tile.id)).onHand).toBe(400 - 344);
    const sent = (await admin.gql(`query($id: ID!) { salesOrderDispatchedQuantities(salesOrderId: $id) }`, { id: order.id })).salesOrderDispatchedQuantities;
    expect(sent[0]).toMatchObject({ sentQuantity: 344, piecesPerUnit: 1, piecesPerBox: 9, soldBy: 'PIECE' });
  });
});
