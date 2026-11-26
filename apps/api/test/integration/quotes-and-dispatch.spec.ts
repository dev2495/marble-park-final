import { Harness, Session } from '../harness';

describe('quotes, revisions, rooms and the public link', () => {
  let h: Harness; let admin: Session;
  beforeAll(async () => { h = await Harness.boot(); admin = await h.as('admin'); });
  afterAll(async () => { await h.close(); });

  // A4. A revision must remember what was already ordered.
  it('revising a quote that is partly ordered orders only the difference', async () => {
    const w = await h.world(admin, { stock: 20 });
    const quote = await w.createQuote([w.line({ qty: 5 })]);
    await w.convertQuote(quote.id, { picks: { 0: 3 } }); // 3 of 5 ordered
    const revision = await w.createQuote([w.line({ qty: 8 })], { supersedes: quote.id, leadId: quote.leadId }); // customer now wants 8
    // 8 wanted in total, 3 already ordered on the earlier version: 5 left to order, not 8.
    const carried = await h.prisma.quoteLine.findFirst({ where: { quoteId: revision.id } });
    expect(Number(carried!.orderedQuantity)).toBe(3);
    const order = await w.convertQuote(revision.id);
    const lines = await h.prisma.salesOrderLine.findMany({ where: { salesOrderId: order.id } });
    expect(lines.reduce((n, l) => n + l.orderedQuantity, 0)).toBe(5);
  });

  it('a revision that adds nothing cannot be ordered a second time', async () => {
    const w = await h.world(admin, { stock: 20 });
    const quote = await w.createQuote([w.line({ qty: 4 })]);
    await w.convertQuote(quote.id);
    const revision = await w.createQuote([w.line({ qty: 4 })], { supersedes: quote.id, leadId: quote.leadId });
    const f = await w.quoteFulfillment(revision.id);
    const r = await admin.gqlRaw(`mutation($input: CreateSalesOrderInput!) { createSalesOrderFromQuote(input: $input) }`, {
      input: { quoteId: revision.id, paymentMode: 'credit', idempotencyKey: `HT-REV-${Date.now()}`, lines: JSON.stringify([{ quoteLineId: f.lines[0].id, quantity: 4 }]) },
    });
    expect(r.errors?.length).toBeGreaterThan(0);
  });

  // B1. The same item in two rooms is two order lines. Dispatch must match by line, not by product.
  it('the same item quoted in two rooms is ordered, picked and dispatched without clashing', async () => {
    const w = await h.world(admin, { stock: 10 });
    const quote = await w.createQuote([w.line({ qty: 2, area: 'Kitchen' }), w.line({ qty: 3, area: 'Bathroom' })]);
    const order = await w.convertQuote(quote.id);
    const orderLines = await h.prisma.salesOrderLine.findMany({ where: { salesOrderId: order.id }, orderBy: { orderedQuantity: 'asc' } });
    expect(orderLines.map((l) => l.orderedQuantity)).toEqual([2, 3]);
    const { challan } = await w.ship(order.id);
    const dispatched = await h.prisma.dispatchLine.findMany({ where: { challanId: challan.id } });
    expect(dispatched.reduce((n, l) => n + Number(l.dispatchedQuantity), 0)).toBe(5);
    const after = await h.prisma.salesOrderLine.findMany({ where: { salesOrderId: order.id }, orderBy: { orderedQuantity: 'asc' } });
    expect(after.map((l) => l.dispatchedQuantity)).toEqual([2, 3]); // each room got its own quantity
    expect(await w.balance()).toMatchObject({ onHand: 5, reserved: 0 });
  });

  // C1. The link a customer opens must carry nothing that is internal.
  it('the public share document carries no floor rate and no cost', async () => {
    const w = await h.world(admin, { stock: 5 });
    const quote = await w.createQuote([w.line({ qty: 1 })]);
    await admin.gql(`mutation($id: ID!) { sendQuote(id: $id) { id } }`, { id: quote.id }).catch(() => undefined);
    const share = (await admin.gql(`mutation($id: ID!) { createQuoteShare(quoteId: $id) }`, { id: quote.id })).createQuoteShare;
    const token: string = share.token || share.shareToken || (String(share.url || '').split('/').pop() as string);
    expect(token).toBeTruthy();
    const r = await h.publicGql(`query($t: String!) { publicQuoteShareDocument(token: $t) }`, { t: token });
    expect(r.errors).toBeUndefined();
    const text = JSON.stringify(r.data.publicQuoteShareDocument);
    const forbidden = text.match(/"(floor[A-Za-z]*|costSnapshot[A-Za-z]*|unitCost|purchaseCost|margin[A-Za-z]*|landedCost)"\s*:/gi) || [];
    expect(forbidden).toEqual([]);
    expect(text).toContain(w.product.sku); // the customer still sees what they are buying
  });

  it('a revoked share link stops working', async () => {
    const w = await h.world(admin, { stock: 5 });
    const quote = await w.createQuote([w.line({ qty: 1 })]);
    const share = (await admin.gql(`mutation($id: ID!) { createQuoteShare(quoteId: $id) }`, { id: quote.id })).createQuoteShare;
    const token: string = share.token || share.shareToken || (String(share.url || '').split('/').pop() as string);
    await admin.gql(`mutation($quoteId: ID!, $shareId: ID!) { revokeQuoteShare(quoteId: $quoteId, shareId: $shareId) }`, { quoteId: quote.id, shareId: share.id });
    const r = await h.publicGql(`query($t: String!) { publicQuoteShareDocument(token: $t) }`, { t: token });
    expect(r.errors?.length).toBeGreaterThan(0);
  });
});
