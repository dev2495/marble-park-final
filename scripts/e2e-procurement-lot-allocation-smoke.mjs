import { PrismaClient } from '@prisma/client';

const API = process.env.API_URL || 'http://localhost:4000/graphql';
const WEB = process.env.WEB_URL || 'http://localhost:3000';
const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@marblepark.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'password123';
const prisma = new PrismaClient();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function gql(query, variables = {}, token) {
  const response = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  const json = await response.json();
  if (!response.ok || json.errors?.length) throw new Error(json.errors?.map((error) => error.message).join('; ') || `GraphQL request failed (${response.status})`);
  return json.data;
}

async function main() {
  const login = await gql(
    `mutation($input: LoginInput!) { login(input: $input) { token } }`,
    { input: { email: TEST_EMAIL, password: TEST_PASSWORD } },
  );
  const token = login.login.token;
  assert(token, 'Admin login must return a token');

  const product = await prisma.product.findFirst({
    where: { sku: { startsWith: 'CLIENT-FLOW-' } },
    orderBy: { createdAt: 'desc' },
  });
  assert(product, 'Run e2e-client-workflow-release-gate.mjs first');
  const directPo = (await gql(
    `mutation($input: CreatePurchaseOrderInput!) { createPurchaseOrder(input: $input) }`,
    { input: { demandIds: [], vendorName: 'Direct Product Master test vendor', lines: JSON.stringify([{ productId: product.id, quantity: 4, unit: product.purchaseUom || product.unit || 'PC', unitCost: 7100 }]), notes: 'Direct PO regression test' } },
    token,
  )).createPurchaseOrder;
  assert(directPo.lines.length === 1 && directPo.lines[0].productId === product.id && Number(directPo.lines[0].orderedQuantity) === 4, 'Direct PO must create an exact Product Master line without a demand row');
  assert(directPo.metadata?.source === 'direct_product_master', 'Direct PO source metadata must be explicit');
  const directPdf = await fetch(`${WEB}/api/pdf/purchase-order/${directPo.id}`, { headers: { authorization: `Bearer ${token}` } });
  assert(directPdf.ok && directPdf.headers.get('content-type')?.includes('application/pdf'), `Direct PO PDF must render (${directPdf.status})`);
  const directPdfBytes = Buffer.from(await directPdf.arrayBuffer());
  assert(directPdfBytes.subarray(0, 4).toString() === '%PDF' && directPdfBytes.length > 5_000, 'Direct PO PDF must be a non-empty document');
  const demands = await prisma.purchaseDemand.findMany({
    where: { productId: product.id, status: 'open' },
    orderBy: { createdAt: 'asc' },
    take: 2,
  });
  assert(demands.length === 2, 'Expected two open purchase demands from the two partial sales orders');

  const po = (await gql(
    `mutation($input: CreatePurchaseOrderInput!) { createPurchaseOrder(input: $input) }`,
    { input: { demandIds: demands.map((row) => row.id), lines: JSON.stringify(demands.map((row) => ({ purchaseDemandId: row.id, unitCost: 7200 }))), vendorName: 'Universal lifecycle test vendor', notes: 'Automated exact-lot procurement test' } },
    token,
  )).createPurchaseOrder;
  assert(po.lines.length === 2 && po.lines.every((line) => line.productId === product.id), 'PO lines must stay linked to Product Master');
  const demandPdf = await fetch(`${WEB}/api/pdf/purchase-order/${po.id}`, { headers: { authorization: `Bearer ${token}` } });
  assert(demandPdf.ok && demandPdf.headers.get('content-type')?.includes('application/pdf'), `Demand PO PDF must render (${demandPdf.status})`);
  const testedOrderIds = demands.map((row) => row.sourceOrderId).filter(Boolean);

  const location = await prisma.stockLocation.findFirst({ where: { code: 'MAIN' } });
  assert(location, 'MAIN stock location is required');
  const lines = [...po.lines].sort((a, b) => Number(a.orderedQuantity) - Number(b.orderedQuantity));
  assert(Number(lines[0].orderedQuantity) === 2 && Number(lines[1].orderedQuantity) === 3, 'PO must retain each order-scoped demand quantity');

  const receive = (rows, suffix) => gql(
    `mutation($input: ReceivePurchaseOrderInput!) { receivePurchaseOrder(input: $input) }`,
    {
      input: {
        purchaseOrderId: po.id,
        supplierChallan: `TEST-${suffix}`,
        locationId: location.id,
        lines: JSON.stringify(rows),
        notes: 'Automated partial and damaged receipt verification',
      },
    },
    token,
  );

  await receive([
    { purchaseOrderLineId: lines[0].id, receivedQuantity: 1, damagedQuantity: 0, supplierBatch: 'BATCH-A1', unitCost: 7200 },
    { purchaseOrderLineId: lines[1].id, receivedQuantity: 1, damagedQuantity: 1, supplierBatch: 'BATCH-D1', unitCost: 7200 },
  ], 'PARTIAL-DAMAGE');
  let reservations = await prisma.reservation.findMany({ where: { productId: product.id, salesOrderId: { in: testedOrderIds } }, orderBy: { createdAt: 'asc' } });
  assert(reservations.every((row) => row.status === 'backordered'), 'An incomplete receipt must not partially reserve an order line');

  await receive([
    { purchaseOrderLineId: lines[0].id, receivedQuantity: 1, damagedQuantity: 0, supplierBatch: 'BATCH-A2', unitCost: 7200 },
    { purchaseOrderLineId: lines[1].id, receivedQuantity: 2, damagedQuantity: 0, supplierBatch: 'BATCH-B1', unitCost: 7200 },
  ], 'SECOND');
  reservations = await prisma.reservation.findMany({ where: { productId: product.id, salesOrderId: { in: testedOrderIds } }, orderBy: { createdAt: 'asc' } });
  assert(reservations[0].status === 'reserved' && reservations[1].status === 'backordered', 'FIFO backorder allocation must reserve only the first fully satisfiable order');

  await receive([
    { purchaseOrderLineId: lines[1].id, receivedQuantity: 1, damagedQuantity: 0, supplierBatch: 'BATCH-B2', unitCost: 7200 },
  ], 'REPLACEMENT');
  reservations = await prisma.reservation.findMany({ where: { productId: product.id, salesOrderId: { in: testedOrderIds } }, orderBy: { createdAt: 'asc' } });
  assert(reservations.every((row) => row.status === 'reserved'), 'Replacement receipt must auto-reserve the remaining backorder');

  const [finalPo, balance, lotTotals, reconciliation] = await Promise.all([
    prisma.purchaseOrder.findUnique({ where: { id: po.id } }),
    prisma.inventoryBalance.findUnique({ where: { productId: product.id } }),
    prisma.inventoryLotBalance.aggregate({ where: { lot: { productId: product.id } }, _sum: { onHand: true, reserved: true, damaged: true, available: true } }),
    gql(`query($productId: String) { stockReconciliation(productId: $productId) }`, { productId: product.id }, token),
  ]);
  assert(finalPo?.status === 'received', 'PO must close as received after replacement quantity arrives');
  assert(Number(balance?.onHand) === 6 && Number(balance?.reserved) === 5 && Number(balance?.damaged) === 1 && Number(balance?.available) === 0, 'Aggregate stock must reflect five reserved good units plus one damaged unit');
  assert(Number(lotTotals._sum.onHand) === 6 && Number(lotTotals._sum.reserved) === 5 && Number(lotTotals._sum.damaged) === 1 && Number(lotTotals._sum.available) === 0, 'Lot balances must reconcile to aggregate inventory');
  assert(reconciliation.stockReconciliation.summary.critical === 0, 'Universal stock reconciliation must have zero critical mismatches');

  console.log(JSON.stringify({
    ok: true,
    sku: product.sku,
    poNumber: po.poNumber,
    directPoNumber: directPo.poNumber,
    directPoPdfBytes: directPdfBytes.length,
    grnCount: await prisma.goodsReceiptNote.count({ where: { purchaseOrderId: po.id } }),
    lots: await prisma.inventoryLot.count({ where: { productId: product.id, sourceType: 'grn' } }),
    inventory: { onHand: balance.onHand, reserved: balance.reserved, damaged: balance.damaged, available: balance.available },
    reservationStatuses: reservations.map((row) => row.status),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
