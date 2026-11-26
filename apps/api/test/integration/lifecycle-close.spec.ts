import { Harness, Session, World, stamp } from '../harness';
import { expectStockBooksAgree, orderLines, challanWith, cancelOrder } from '../stock-helpers';
import { assertLedger } from '../money-support';

/**
 * Delivery close: when the last challan of an order is delivered the order is finished.
 * Status, dispatch job, pick lists, stock holds and purchase demands close in the same
 * save, and the order leaves every work queue, read through the real queries as the
 * role that uses each screen. Payment stays separate: unpaid goods stay in collections.
 */
describe('lifecycle: an order closes on delivery and leaves every work queue', () => {
  let h: Harness; let admin: Session; let dispatchOps: Session; let stockUser: Session; let salesManager: Session; let owner: Session;
  beforeAll(async () => {
    h = await Harness.boot();
    admin = await h.as('admin');
    dispatchOps = await h.as('dispatch_ops');
    stockUser = await h.as('inventory_manager');
    salesManager = await h.as('sales_manager');
    owner = await h.as('owner');
  });
  afterAll(async () => { await h.close(); });

  const ACTIVE = ['open', 'ordered', 'partial_received'];

  // ---- queue readers, each as the role whose screen uses it ----
  const pendingInward = async (orderNumber: string, status = 'all') =>
    (await stockUser.gql(`query($search: String, $status: String) { purchaseDemandPage(search: $search, status: $status, take: 100) }`, { search: orderNumber, status })).purchaseDemandPage;
  const demandQueue = async (status?: string) =>
    (await stockUser.gql(`query($status: String) { purchaseDemandQueue(status: $status, take: 1000) }`, { status })).purchaseDemandQueue as any[];
  const dispatchQueueJob = async (orderId: string) =>
    ((await dispatchOps.gql(`query { dispatchQueue }`)).dispatchQueue as any[]).find((job) => job.salesOrderId === orderId);
  const registerLines = async (orderNumber: string, status: string) =>
    (await dispatchOps.gql(`query($search: String, $status: String) { reservedDispatchLines(search: $search, status: $status, take: 100) }`, { search: orderNumber, status })).reservedDispatchLines.items as any[];
  const orderBook = async (orderId: string, fulfillmentStatus: string) =>
    (await salesManager.gql(`query($search: String, $f: String) { salesOrderControlTower(search: $search, fulfillmentStatus: $f, take: 50) }`, { search: orderId, f: fulfillmentStatus })).salesOrderControlTower.items as any[];
  const openPicks = async (orderId: string) =>
    ((await dispatchOps.gql(`query($id: String) { pickLists(salesOrderId: $id) }`, { id: orderId })).pickLists as any[]).filter((pick) => !['dispatched', 'cancelled'].includes(pick.status));
  const activeDispatchJobs = async () => Number((await owner.gql(`query { ownerDashboard { stats } }`)).ownerDashboard.stats.activeDispatchJobs);
  const inbox = async (search: string, view = 'open') => (await dispatchOps.gql(`query($search: String, $view: String) { notificationInbox(view: $view, search: $search, take: 100) }`, { search, view })).notificationInbox;

  /** The work item the notification worker raises for an open dispatch job (the worker is off in tests). */
  async function seedDispatchTask(jobId: string) {
    const id = `work_ht_${stamp().toLowerCase()}`;
    await h.prisma.notification.create({
      data: {
        id, taskKey: `work_dispatch:${jobId}`, type: 'work_dispatch', category: 'action', status: 'open',
        title: 'Order awaiting fulfilment', message: `Harness dispatch task ${id}`, entityType: 'DispatchJob', entityId: jobId,
        href: '/dashboard/dispatch', targetPermission: 'dispatch.manage', reconciledAt: new Date(), metadata: { rule: 'work_dispatch' },
      } as any,
    });
    await h.prisma.notificationRecipient.create({ data: { notificationId: id, userId: dispatchOps.userId } as any });
    expect(JSON.stringify(await inbox(id))).toContain(id);
    return id;
  }

  async function demandFor(orderId: string) {
    const order = (await h.prisma.salesOrder.findUnique({ where: { id: orderId } }))!;
    const page = await pendingInward(order.orderNumber);
    const row = (page.items as any[]).find((item) => item.sourceOrderId === orderId);
    expect(row).toBeTruthy();
    expect(ACTIVE).toContain(row.status);
    return row as { id: string; quantity: number };
  }

  async function buyAndReceive(w: World, demandId: string, qty: number) {
    const po = (await stockUser.gql(`mutation($input: CreatePurchaseOrderInput!) { createPurchaseOrder(input: $input) }`, {
      input: { vendorName: 'Harness supplier', demandIds: [demandId] },
    })).createPurchaseOrder;
    const [poLine] = await h.prisma.purchaseOrderLine.findMany({ where: { purchaseOrderId: po.id } });
    expect((await h.prisma.purchaseDemand.findUnique({ where: { id: demandId } }))!.status).toBe('ordered');
    await stockUser.gql(`mutation($input: ReceivePurchaseOrderInput!) { receivePurchaseOrder(input: $input) }`, {
      input: { purchaseOrderId: po.id, locationId: w.location.id, idempotencyKey: `HT-LC-${stamp()}`, lines: JSON.stringify([{ purchaseOrderLineId: poLine.id, receivedQuantity: qty, enteredUnitCost: 500, rateUom: 'PC' }]) },
    });
    return po;
  }

  /** Every item of "the order is finished", read from the database and from each screen's query. */
  async function expectClosed(orderId: string, productIds: string[]) {
    const order = (await h.prisma.salesOrder.findUnique({ where: { id: orderId } }))!;
    expect(order.status).toBe('delivered');
    const job = (await h.prisma.dispatchJob.findUnique({ where: { salesOrderId: orderId } }))!;
    expect(job.status).toBe('delivered');
    const lines = await orderLines(h, orderId);
    for (const line of lines) {
      expect({ sku: line.sku, delivered: line.deliveredQuantity, backordered: line.backorderedQuantity, reserved: line.reservedQuantity, status: line.status })
        .toEqual({ sku: line.sku, delivered: line.orderedQuantity, backordered: 0, reserved: 0, status: 'delivered' });
    }
    const picks = await h.prisma.pickList.findMany({ where: { salesOrderId: orderId } });
    expect(picks.every((pick) => ['dispatched', 'cancelled'].includes(pick.status))).toBe(true);
    const holds = await h.prisma.reservation.findMany({ where: { salesOrderId: orderId, status: { in: ['reserved', 'backordered'] } } });
    expect(holds).toHaveLength(0);
    expect(await h.prisma.lotReservation.count({ where: { salesOrderLine: { salesOrderId: orderId }, status: 'reserved', quantity: { gt: 0 } } })).toBe(0);
    const demands = await h.prisma.purchaseDemand.findMany({ where: { sourceOrderId: orderId } });
    expect(demands.filter((d) => !['closed', 'cancelled'].includes(d.status)).map((d) => d.status)).toEqual([]);

    // Work queues.
    expect(await dispatchQueueJob(orderId)).toBeUndefined();
    expect((await pendingInward(order.orderNumber)).items.filter((row: any) => row.sourceOrderId === orderId)).toEqual([]);
    expect((await demandQueue()).filter((row: any) => row.sourceOrderId === orderId)).toEqual([]);
    expect(await openPicks(orderId)).toEqual([]);
    for (const status of ['ready_to_pick', 'pending_inward', 'partial_dispatch', 'needs_reservation', 'dispatched']) {
      expect({ status, lines: (await registerLines(order.orderNumber, status)).filter((row) => row.salesOrderId === orderId).length }).toEqual({ status, lines: 0 });
    }
    for (const status of ['left_to_dispatch', 'pending_inward', 'ready_to_pick', 'partial_dispatch', 'dispatched']) {
      expect({ status, orders: (await orderBook(orderId, status)).length }).toEqual({ status, orders: 0 });
    }
    // Still findable as history.
    expect((await orderBook(orderId, 'delivered')).map((row) => row.id)).toEqual([orderId]);
    expect((await registerLines(order.orderNumber, 'delivered')).filter((row) => row.salesOrderId === orderId)).toHaveLength(lines.length);
    for (const productId of productIds) await expectStockBooksAgree(h, productId);
  }

  // ---- 1. quote order with a backordered line, through buying and receiving ----
  it('a quote order with a line on backorder: demand, PO, receipt, auto-reserve, pick, challan, dispatch, deliver closes everything', async () => {
    const w = await h.world(admin, { stock: 10 });
    const short = await w.createProduct();
    const quote = await w.createQuote([w.line({ qty: 2 }), w.line({ qty: 3, productId: short.id, sku: short.sku, name: short.name, area: 'Bath' })]);
    const order = await w.convertQuote(quote.id);
    const job = (await h.prisma.dispatchJob.findUnique({ where: { salesOrderId: order.id } }))!;
    expect((await h.prisma.reservation.findMany({ where: { salesOrderId: order.id, productId: short.id } })).map((r) => r.status)).toEqual(['backordered']);

    const demand = await demandFor(order.id);
    expect(demand.quantity).toBe(3);
    await buyAndReceive(w, demand.id, 3);
    // Goods in and set aside for the order: off "All active", still under its own filter until delivered.
    const afterReceipt = (await h.prisma.purchaseDemand.findUnique({ where: { id: demand.id } }))!;
    expect(['received', 'allocated']).toContain(afterReceipt.status);
    const { orderNumber } = (await w.order(order.id))!;
    expect((await pendingInward(orderNumber)).items.filter((row: any) => row.id === demand.id)).toEqual([]);
    expect((await pendingInward(orderNumber, afterReceipt.status)).items.map((row: any) => row.id)).toContain(demand.id);
    expect((await orderLines(h, order.id)).map((l) => ({ reserved: l.reservedQuantity, backordered: l.backorderedQuantity }))).toEqual([{ reserved: 2, backordered: 0 }, { reserved: 3, backordered: 0 }]);

    const taskId = await seedDispatchTask(job.id);
    const { challan } = await w.ship(order.id);
    expect(await dispatchQueueJob(order.id)).toBeTruthy(); // on the road: still dispatch's work
    const before = await activeDispatchJobs();
    await w.deliver(challan.id);

    expect(await activeDispatchJobs()).toBe(before - 1);
    await expectClosed(order.id, [w.product.id, short.id]);
    expect((await h.prisma.purchaseDemand.findUnique({ where: { id: demand.id } }))!.status).toBe('closed');
    expect((await pendingInward(orderNumber, 'closed')).items.map((row: any) => row.id)).toContain(demand.id);
    // A closed demand is never bought again.
    const again = await stockUser.gqlRaw(`mutation($input: CreatePurchaseOrderInput!) { createPurchaseOrder(input: $input) }`, { input: { vendorName: 'Harness supplier', demandIds: [demand.id] } });
    expect(again.errors?.[0]?.message).toMatch(/no longer available/);
    // The dispatch task is resolved in the same save.
    expect((await h.prisma.notification.findUnique({ where: { id: taskId } }))!.status).toBe('resolved');
    expect(JSON.stringify(await inbox(taskId))).not.toContain(taskId);
    expect(JSON.stringify(await inbox(taskId, 'completed'))).toContain(taskId);
    // Later stock of the same item is free stock, not held for the finished order.
    await w.receiveGoods({ qty: 4, productId: short.id });
    expect(await h.prisma.reservation.count({ where: { salesOrderId: order.id, status: { in: ['reserved', 'backordered'] } } })).toBe(0);
    expect(await expectStockBooksAgree(h, short.id)).toMatchObject({ onHand: 4, reserved: 0, available: 4 });
    await assertLedger(h, admin, w.customer.id);
  });

  // ---- 2. direct order, delivered but unpaid ----
  it('a direct order delivered on credit closes, and only collections still shows it until paid', async () => {
    const w = await h.world(admin, { stock: 5 });
    const order = await w.directOrder({ qty: 3, paymentMode: 'credit' });
    const { challan } = await w.ship(order.id);
    await w.deliver(challan.id);
    await expectClosed(order.id, [w.product.id]);
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 2, reserved: 0, available: 2 });

    const invoice = await w.invoice(order.id, challan.id);
    const board = (await owner.gql(`query($search: String) { receivablesDashboard(search: $search, take: 50) }`, { search: w.customer.name })).receivablesDashboard;
    const account = (board.accounts as any[]).find((row) => row.customerId === w.customer.id);
    expect(account?.openInvoices).toBeGreaterThan(0);
    expect((board.collectionQueue as any[]).map((row) => row.id)).toContain(invoice.id);
    // Billing does not reopen any work queue.
    expect(await dispatchQueueJob(order.id)).toBeUndefined();
    expect((await w.order(order.id))!.status).toBe('delivered');
    await assertLedger(h, admin, w.customer.id);
  });

  // ---- 3. two challans, with a shortage bought in between ----
  it('an order sent in two challans closes only when the second is delivered; its demand stays until then', async () => {
    const w = await h.world(admin, { stock: 3 });
    const order = await w.directOrder({ qty: 6, paymentMode: 'credit' });
    const demand = await demandFor(order.id);
    expect(demand.quantity).toBe(3);

    // First challan: the 3 in stock.
    const first = await w.ship(order.id);
    await w.deliver(first.challan.id);
    expect((await w.order(order.id))!.status).not.toBe('delivered');
    expect((await h.prisma.dispatchJob.findUnique({ where: { salesOrderId: order.id } }))!.status).not.toBe('delivered');
    expect(await dispatchQueueJob(order.id)).toBeTruthy();
    expect((await orderBook(order.id, 'left_to_dispatch')).map((row) => row.id)).toEqual([order.id]);
    expect((await pendingInward((await w.order(order.id))!.orderNumber)).items.map((row: any) => row.id)).toContain(demand.id);

    // The rest is bought, comes in and is reserved; delivered in part the demand is left as it is.
    await buyAndReceive(w, demand.id, 3);
    const waiting = (await h.prisma.purchaseDemand.findUnique({ where: { id: demand.id } }))!.status;
    expect(['received', 'allocated']).toContain(waiting);
    expect((await orderLines(h, order.id))[0]).toMatchObject({ reservedQuantity: 3, backorderedQuantity: 0, deliveredQuantity: 3 });

    const pick = await w.pick(order.id);
    const second = await challanWith(w, order.id, { pickListId: pick.id });
    await w.dispatch(second.id);
    expect((await h.prisma.purchaseDemand.findUnique({ where: { id: demand.id } }))!.status).toBe(waiting);
    await w.deliver(second.id);

    await expectClosed(order.id, [w.product.id]);
    expect((await h.prisma.purchaseDemand.findUnique({ where: { id: demand.id } }))!.status).toBe('closed');
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 0, reserved: 0 });
    await assertLedger(h, admin, w.customer.id);
  });

  // ---- 4. a line returned after delivery ----
  it('a return after delivery leaves the order delivered and out of every work queue; the return holds the goods', async () => {
    const w = await h.world(admin, { stock: 4 });
    const order = await w.directOrder({ qty: 4, paymentMode: 'credit' });
    const { challan } = await w.ship(order.id);
    await w.deliver(challan.id);
    await w.returnGoods({ challanId: challan.id, salesOrderId: order.id, qty: 1 });
    expect((await orderLines(h, order.id))[0]).toMatchObject({ deliveredQuantity: 4, returnedQuantity: 1 });
    await expectClosed(order.id, [w.product.id]);
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 1, reserved: 0, available: 1 });
    await assertLedger(h, admin, w.customer.id);
  });

  // ---- 5. a cancelled order ----
  it('a cancelled order with a shortage leaves the dispatch queue, Pending Inward and the order book work filters', async () => {
    const w = await h.world(admin, { stock: 1 });
    const order = await w.directOrder({ qty: 3 });
    const demand = await demandFor(order.id);
    await cancelOrder(admin, order.id, 'Customer bought elsewhere');
    expect((await w.order(order.id))!.status).toBe('cancelled');
    expect((await h.prisma.purchaseDemand.findUnique({ where: { id: demand.id } }))!.status).toBe('cancelled');
    expect(await h.prisma.reservation.count({ where: { salesOrderId: order.id, status: { in: ['reserved', 'backordered'] } } })).toBe(0);
    expect(await dispatchQueueJob(order.id)).toBeUndefined();
    const { orderNumber } = (await w.order(order.id))!;
    expect((await pendingInward(orderNumber)).items).toEqual([]);
    expect((await pendingInward(orderNumber, 'cancelled')).items.map((row: any) => row.id)).toEqual([demand.id]);
    for (const status of ['left_to_dispatch', 'pending_inward', 'ready_to_pick']) {
      expect({ status, orders: (await orderBook(order.id, status)).length }).toEqual({ status, orders: 0 });
    }
    for (const status of ['ready_to_pick', 'pending_inward', 'needs_reservation']) {
      expect({ status, lines: (await registerLines(orderNumber, status)).length }).toEqual({ status, lines: 0 });
    }
    expect(await expectStockBooksAgree(h, w.product.id)).toMatchObject({ onHand: 1, reserved: 0, available: 1 });
  });

  // ---- "All active" means waiting on a supplier, on every reader ----
  it('"All active" lists only demands still waiting on a supplier, and the procurement count agrees', async () => {
    const page = await pendingInward('', 'all');
    expect((page.items as any[]).every((row) => ACTIVE.includes(row.status))).toBe(true);
    expect(page.total).toBe(await h.prisma.purchaseDemand.count({ where: { status: { in: ACTIVE } } }));
    expect((await demandQueue()).every((row) => ACTIVE.includes(row.status))).toBe(true);
    const summary = (await stockUser.gql(`query { procurementSummary }`)).procurementSummary;
    expect(Number(summary.demandInFlow)).toBe(page.total);
  });
});
