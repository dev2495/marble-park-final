import { Harness, Session, stamp } from '../harness';
import { orderLines, challanWith } from '../stock-helpers';

/** Stock lane B10 (scenario 11): a tile line with no Product Master item is bought, received and sent for its order. */
describe('stock: special-order tile lines', () => {
  let h: Harness; let admin: Session;
  beforeAll(async () => { h = await Harness.boot(); admin = await h.as('admin'); });
  afterAll(async () => { await h.close(); });

  const specialRow = (code: string) => ({
    sku: code, tileCode: code, name: `Special tile ${code}`, type: 'tile', category: 'Tiles', brand: 'Harness', finish: '600x600 Matt', tileSize: '600x600 mm',
    unit: 'BOX', qty: 6, listPrice: 1500, mrp: 1770, mrpRateBasis: 'BOX', specialRate: 1500, discountPercent: 0, taxRate: 18, area: 'Living room',
  });

  // New quotes and direct orders only take Product Master rows today, so a product-less tile row cannot be entered.
  it('a new quote or direct order with a tile row not in Product Master is refused with a plain message', async () => {
    const w = await h.world(admin, { stock: 0 });
    const row = specialRow(`SPT-${stamp()}`);
    const q = await admin.gqlRaw(`mutation($input: CreateQuoteInput!) { createQuote(input: $input) { id } }`, { input: { customerId: w.customer.id, ownerId: w.ownerId, title: 'Special tile', lines: JSON.stringify([row]) } });
    expect(q.errors?.[0]?.message).toMatch(/Product Master/);
    const d = await admin.gqlRaw(`mutation($input: CreateDirectSalesOrderInput!) { createDirectSalesOrder(input: $input) }`, {
      input: { customerId: w.customer.id, ownerId: w.ownerId, paymentMode: 'cash', idempotencyKey: `HT-SPD-${stamp()}`, lines: JSON.stringify([row]) },
    });
    expect(d.errors?.[0]?.message).toMatch(/Product Master/);
  });

  // Orders saved before that rule still carry product-less tile lines: they must still be bought, received and sent.
  it('an older order with a product-less tile line raises a demand, is bought, received in boxes and dispatched and delivered without a pick list', async () => {
    const w = await h.world(admin, { stock: 0 });
    const code = `SPT-${stamp()}`;
    // Build the older shape: an order line with no Product Master item and no stock hold.
    const order = await w.directOrder({ qty: 6 });
    await h.prisma.reservation.deleteMany({ where: { salesOrderId: order.id } });
    const saved = (await w.order(order.id))!;
    const jsonLines = (Array.isArray(saved.lines) ? saved.lines : JSON.parse(String(saved.lines || '[]'))) as any[];
    const legacy = jsonLines.map((l) => ({ ...l, ...specialRow(code), productId: null, lineKey: l.lineKey }));
    await h.prisma.salesOrder.update({ where: { id: order.id }, data: { lines: legacy } });
    await h.prisma.salesOrderLine.updateMany({ where: { salesOrderId: order.id }, data: { productId: null, sku: code, unit: 'BOX', category: 'Tiles', reservedQuantity: 0, backorderedQuantity: 0 } as any });
    const [orderLine] = await orderLines(h, order.id);
    expect(orderLine.productId).toBeNull();
    expect(orderLine.orderedQuantity).toBe(6);

    await admin.gql(`query { purchaseDemandQueue }`);
    const demand = await h.prisma.purchaseDemand.findFirst({ where: { sourceOrderId: order.id, sourceType: 'tile_special_order' } });
    expect(demand).toBeTruthy();
    expect(demand!.quantity).toBe(6);

    const po = (await admin.gql(`mutation($input: CreatePurchaseOrderInput!) { createPurchaseOrder(input: $input) }`, {
      input: { vendorName: 'Harness tile supplier', demandIds: [demand!.id] },
    })).createPurchaseOrder;
    const [poLine] = await h.prisma.purchaseOrderLine.findMany({ where: { purchaseOrderId: po.id } });
    expect(poLine.orderedQuantity).toBe(6);
    await admin.gql(`mutation($input: ReceivePurchaseOrderInput!) { receivePurchaseOrder(input: $input) }`, {
      input: { purchaseOrderId: po.id, idempotencyKey: `HT-SPR-${stamp()}`, lines: JSON.stringify([{ purchaseOrderLineId: poLine.id, boxes: 6, enteredUnitCost: 900, rateUom: 'BOX' }]) },
    });
    expect((await orderLines(h, order.id))[0].allocatedQuantity).toBe(6);

    const queue = (await admin.gql(`query { dispatchQueue }`).catch(() => null))?.dispatchQueue;
    if (queue) expect(JSON.stringify(queue)).toContain(orderLine.id);

    const challan = await challanWith(w, order.id, { lines: [{ salesOrderLineId: orderLine.id, dispatchQty: 6 }], transport: { transportMode: 'self_pickup' } });
    await w.dispatch(challan.id);
    expect((await orderLines(h, order.id))[0].dispatchedQuantity).toBe(6);
    await w.deliver(challan.id);
    expect((await orderLines(h, order.id))[0].deliveredQuantity).toBe(6);
    expect((await w.order(order.id))!.status).toBe('delivered');
  });
});
