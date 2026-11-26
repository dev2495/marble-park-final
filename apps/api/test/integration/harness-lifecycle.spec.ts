import { Harness, World, Session } from '../harness';

/** Proves the harness end to end on code paths that exist today: the whole sales life of one order. */
describe('harness: order to cash to return', () => {
  let h: Harness; let admin: Session; let w: World;
  beforeAll(async () => { h = await Harness.boot(); admin = await h.as('admin'); w = await h.world(admin, { stock: 10 }); });
  afterAll(async () => { await h.close(); });

  it('opening stock lands in a lot and the balance', async () => {
    expect(await w.balance()).toMatchObject({ onHand: 10, reserved: 0, available: 10 });
    expect(await h.prisma.inventoryLot.count({ where: { productId: w.product.id } })).toBe(1);
  });

  it('direct order reserves, ships, delivers, invoices, is paid and partly returned', async () => {
    const order = await w.directOrder({ qty: 4 });
    expect(Number(order.totalAmount)).toBeGreaterThanOrEqual(4000); // GST may be added on top
    expect((await w.reservations(order.id))[0].status).toBe('reserved');
    expect(await w.balance()).toMatchObject({ reserved: 4, available: 6 });

    const { challan } = await w.ship(order.id);
    expect(await w.balance()).toMatchObject({ onHand: 6, reserved: 0 });
    await w.deliver(challan.id);
    expect((await h.prisma.dispatchChallan.findUnique({ where: { id: challan.id } }))!.status).toBe('delivered');

    const invoice = await w.invoice(order.id, challan.id);
    await w.receipt({ amount: Number(invoice.totalAmount ?? invoice.grandTotal ?? invoice.openAmount), salesInvoiceId: invoice.id });
    const paid = await h.prisma.salesInvoice.findUnique({ where: { id: invoice.id } });
    expect(Number(paid!.openAmount)).toBe(0);

    await w.returnGoods({ challanId: challan.id, salesOrderId: order.id, qty: 1, refundAmount: 1000 });
    expect(await w.balance()).toMatchObject({ onHand: 7 });
  });

  it('a role without the permission is refused (dispatch staff cannot take payments)', async () => {
    const dispatch = await h.as('dispatch_ops');
    const r = await dispatch.gqlRaw(`mutation($input: CustomerPaymentInput!) { recordCustomerPayment(input: $input) }`, { input: { customerId: w.customer.id, paymentMode: 'cash', amount: 1 } });
    expect(r.errors?.length).toBeGreaterThan(0);
  });
});
