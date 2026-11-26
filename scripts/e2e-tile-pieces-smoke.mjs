// Tile stock counted in pieces, orders in boxes: order → backorder → PO from
// pending inward → receive boxes → auto-reserve → pick → challan → deliver → invoice.
//   API_URL=… DATABASE_URL=… TOKEN=<owner session> TILE_SKU=<tile sold by BOX, stocked by PC>
//   node scripts/e2e-tile-pieces-smoke.mjs   (run from apps/api so @prisma/client resolves)
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';

const API = process.env.API_URL || 'http://localhost:4100/graphql';
const token = process.env.TOKEN;
const prisma = new PrismaClient();
const gql = async (query, variables = {}) => {
  const body = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ query, variables }) }).then((r) => r.json());
  if (body.errors) throw new Error(body.errors[0].message);
  return body.data;
};
const tag = Date.now().toString(36);
const product = await prisma.product.findFirst({ where: { sku: process.env.TILE_SKU } });
assert.ok(product, 'Set TILE_SKU to a tile sold by the box and stocked by the piece');
const perBox = Number(product.piecesPerPack);
assert.ok(String(product.baseUom).toUpperCase() === 'PC' && String(product.unit).toUpperCase() === 'BOX' && perBox > 1, 'tile must be BOX sold, PC stocked');
const lotAvailable = async () => Number((await prisma.inventoryLotBalance.aggregate({ where: { lot: { productId: product.id, status: 'active' } }, _sum: { available: true } }))._sum.available || 0);
const availableBefore = await lotAvailable();
const boxes = Math.floor(availableBefore / perBox) + 3; // more than in stock, so part is backordered
const customer = await prisma.customer.findFirst({ where: { mobile: { not: '' } }, orderBy: { createdAt: 'asc' } });
const owner = await prisma.user.findFirst({ where: { role: 'owner', active: true } });
const location = await prisma.stockLocation.findFirst({ where: { status: 'active' } });

// 1. Order in boxes; stock held in pieces.
const order = (await gql('mutation($i: CreateDirectSalesOrderInput!) { createDirectSalesOrder(input: $i) }', { i: {
  customerId: customer.id, ownerId: owner.id, paymentMode: 'cash', taxMode: 'gst', idempotencyKey: `tile-pcs-${tag}`,
  lines: JSON.stringify([{ productId: product.id, qty: boxes, area: 'General Selection', nrpMode: 'PERCENT_OFF_MRP', nrpInput: 0, specialMode: 'NONE', specialInput: 0, taxRate: 18, lineKey: `product:${product.id}:k${tag}` }]),
} })).createDirectSalesOrder;
const orderLine = await prisma.salesOrderLine.findFirst({ where: { salesOrderId: order.id } });
let reservations = await prisma.reservation.findMany({ where: { salesOrderId: order.id } });
const heldPcs = reservations.filter((r) => r.status === 'reserved').reduce((s, r) => s + r.quantity, 0);
const shortPcs = reservations.filter((r) => r.status === 'backordered').reduce((s, r) => s + r.quantity, 0);
console.log(`${order.orderNumber}: ${boxes} box ordered = ${boxes * perBox} pc; held ${heldPcs} pc, short ${shortPcs} pc`);
assert.equal(heldPcs + shortPcs, boxes * perBox, 'reservations cover the order in pieces');
assert.equal(heldPcs, Math.min(availableBefore, boxes * perBox));
assert.equal(orderLine.orderedQuantity, boxes, 'order line stays in boxes');
assert.equal(orderLine.reservedQuantity, Math.floor(heldPcs / perBox));

// 2. Pending inward in pieces, PO from it in pieces.
const demand = await prisma.purchaseDemand.findFirst({ where: { sourceOrderId: order.id } });
assert.equal(demand.quantity, shortPcs); assert.equal(demand.unit, 'PC');
const po = (await gql('mutation($input: CreatePurchaseOrderInput!) { createPurchaseOrder(input: $input) }', { input: { demandIds: [demand.id], vendorName: 'Tile pieces test' } })).createPurchaseOrder;
const poLine = await prisma.purchaseOrderLine.findFirst({ where: { purchaseOrderId: po.id } });
console.log(`${po.poNumber}: ${poLine.orderedQuantity} ${poLine.unit}`);
assert.equal(poLine.orderedQuantity, shortPcs); assert.equal(poLine.unit, 'PC');

// 3. Receive the short boxes (this is the receipt that used to fail).
await gql('mutation($input: ReceivePurchaseOrderInput!) { receivePurchaseOrder(input: $input) }', { input: {
  purchaseOrderId: po.id, locationId: location.id, idempotencyKey: `tile-pcs-grn-${tag}`,
  lines: JSON.stringify([{ purchaseOrderLineId: poLine.id, boxes: shortPcs / perBox, loosePieces: 0 }]),
} });
reservations = await prisma.reservation.findMany({ where: { salesOrderId: order.id } });
const lineAfter = await prisma.salesOrderLine.findUnique({ where: { id: orderLine.id } });
console.log(`after receipt: reservations ${reservations.map((r) => `${r.status}:${r.quantity}`).join(', ')}; order line reserved ${lineAfter.reservedQuantity} box, backordered ${lineAfter.backorderedQuantity}`);
assert.ok(reservations.every((r) => r.status === 'reserved'), 'arrived stock is reserved for the waiting order');
assert.equal(lineAfter.reservedQuantity, boxes); assert.equal(lineAfter.backorderedQuantity, 0);

// 4. Pick in pieces, dispatch, deliver: order line counts boxes.
const pick = (await gql('mutation($input: CreatePickListInput!) { createPickList(input: $input) }', { input: { salesOrderId: order.id, locationId: location.id } })).createPickList;
const pickLines = await prisma.pickLine.findMany({ where: { pickListId: pick.id } });
const picked = pickLines.reduce((s, l) => s + l.requestedQuantity, 0);
assert.equal(picked, boxes * perBox, 'pick list asks for every piece');
const T = 'mutation($id: ID!, $action: String!, $input: PickListTransitionInput) { transitionPickList(id: $id, action: $action, input: $input) }';
await gql(T, { id: pick.id, action: 'start', input: {} });
await gql(T, { id: pick.id, action: 'pick', input: { lines: JSON.stringify(pickLines.map((l) => ({ pickLineId: l.id, pickedQuantity: l.requestedQuantity }))) } });
await gql(T, { id: pick.id, action: 'pack', input: { lines: JSON.stringify(pickLines.map((l) => ({ pickLineId: l.id, packedQuantity: l.requestedQuantity }))) } });
await gql(T, { id: pick.id, action: 'complete', input: {} });
const job = await prisma.dispatchJob.findFirst({ where: { salesOrderId: order.id } });
const challan = (await gql('mutation($input: CreateChallanInput!) { createChallan(input: $input) { id } }', { input: { jobId: job.id, salesOrderId: order.id, pickListId: pick.id, driverName: 'Tile test', driverPhone: '9000000012', vehicleNo: 'GJ-15-TILE', packages: 1 } })).createChallan;
await gql('mutation($id: ID!, $status: String!) { updateChallanStatus(id: $id, status: $status) { id } }', { id: challan.id, status: 'dispatched' });
let sent = await prisma.salesOrderLine.findUnique({ where: { id: orderLine.id } });
assert.equal(sent.dispatchedQuantity, boxes, 'dispatched counts boxes');
await gql('mutation($id: ID!, $input: ConfirmDeliveryInput!) { confirmDelivery(id: $id, input: $input) }', { id: challan.id, input: { receivedByName: 'Site', proofType: 'manual' } });
sent = await prisma.salesOrderLine.findUnique({ where: { id: orderLine.id } });
assert.equal(sent.deliveredQuantity, boxes, 'delivered counts boxes');
assert.equal(await lotAvailable(), availableBefore - heldPcs, 'stock went out in pieces');

// 5. Invoice the dispatch: pieces, full order value.
const dispatchLineIds = (await prisma.dispatchLine.findMany({ where: { challanId: challan.id } })).map((l) => l.id);
const invoice = (await gql('mutation($input: IssueSalesInvoiceInput!) { issueSalesInvoice(input: $input) }', { input: { salesOrderId: order.id, dispatchLineIds, idempotencyKey: `tile-pcs-inv-${tag}` } })).issueSalesInvoice;
const invoiceLines = await prisma.salesInvoiceLine.findMany({ where: { invoiceId: invoice.id } }).catch(async () => prisma.salesInvoiceLine.findMany({ where: { salesInvoiceId: invoice.id } }));
const billedPcs = invoiceLines.reduce((s, l) => s + l.quantity, 0);
const billed = invoiceLines.reduce((s, l) => s + Number(l.grossLineTotal), 0);
console.log(`invoice ${invoice.invoiceNumber || invoice.id}: ${billedPcs} ${invoiceLines[0]?.unit}, ₹${billed.toFixed(2)} of order line ₹${Number(sent.grossLineTotal).toFixed(2)}`);
assert.equal(billedPcs, boxes * perBox);
assert.ok(Math.abs(billed - Number(sent.grossLineTotal)) < 1, 'invoice bills the order value once, not per piece');

console.log('Tile pieces smoke passed.');
await prisma.$disconnect();
