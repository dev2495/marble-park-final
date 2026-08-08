import { PrismaClient } from '@prisma/client';
import { cleanupE2eRecords } from './lib/cleanup-e2e-records.mjs';

const API = process.env.API_URL || 'http://localhost:4000/graphql';
const WEB = process.env.WEB_URL || 'http://localhost:3000';
const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@marblepark.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'password123';
const prisma = new PrismaClient();
const cleanup = { productIds: [], customerIds: [], quoteIds: [], leadIds: [], orderIds: [] };
let purchaseOrderId = null;

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
  if (!response.ok || json.errors?.length) throw new Error(json.errors?.map((row) => row.message).join('; ') || `GraphQL ${response.status}`);
  return json.data;
}

async function pdf(path, token, label) {
  const response = await fetch(`${WEB}${path}`, { headers: { authorization: `Bearer ${token}` } });
  const body = Buffer.from(await response.arrayBuffer());
  assert(response.ok && (response.headers.get('content-type') || '').includes('application/pdf'), `${label} PDF must return successfully`);
  assert(body.subarray(0, 4).toString() === '%PDF' && body.length > 1200, `${label} PDF must be substantive`);
}

async function main() {
  const login = await gql(`mutation($input: LoginInput!) { login(input: $input) { authenticated token user { id } } }`, { input: { email: TEST_EMAIL, password: TEST_PASSWORD } });
  const token = login.login.token;
  assert(token, 'Admin login must succeed');
  const stamp = Date.now().toString(36).toUpperCase();
  const sku = `DIRECT-${stamp}`;

  const product = (await gql(`mutation($input: CreateProductInput!) { createProduct(input: $input) { id sku name } }`, {
    input: { sku, internalCode: sku, name: 'Direct order lifecycle mixer', category: 'Faucets', brand: 'Lifecycle Gate', finish: 'Chrome', unit: 'PC', sellPrice: 1000, floorPrice: 800, taxClass: 'GST_18' },
  }, token)).createProduct;
  cleanup.productIds.push(product.id);
  const location = await prisma.stockLocation.findFirst({ where: { status: 'active' } });
  assert(location, 'An active stock location is required');
  await gql(`mutation($input: ManualGoodsReceiptInput!) { createManualGoodsReceipt(input: $input) }`, { input: { vendorName: 'Lifecycle vendor', locationId: location.id, idempotencyKey: `${sku}-GRN`, lines: JSON.stringify([{ productId: product.id, receivedQuantity: 2, unitCost: 700 }]) } }, token);

  const customer = (await gql(`mutation($input: CreateCustomerInput!) { createCustomer(input: $input) { id name } }`, { input: { name: `Direct customer ${stamp}`, phone: '9000000012', email: `direct-${stamp.toLowerCase()}@example.test`, city: 'Vapi', address: 'Lifecycle test', forceCreate: true } }, token)).createCustomer;
  cleanup.customerIds.push(customer.id);
  const owners = (await gql(`query { salesAssignees }`, {}, token)).salesAssignees;
  assert(owners[0]?.id, 'At least one active sales owner is required');

  const direct = (await gql(`mutation($input: CreateDirectSalesOrderInput!) { createDirectSalesOrder(input: $input) }`, { input: {
    customerId: customer.id, ownerId: owners[0].id, paymentMode: 'cash', advanceAmount: 500, paymentTerms: 'Cash on order',
    idempotencyKey: `${sku}-SO`, lines: JSON.stringify([{ productId: product.id, sku, name: product.name, category: 'Faucets', brand: 'Lifecycle Gate', finish: 'Chrome', unit: 'PC', qty: 2, listPrice: 1000, mrp: 1180, mrpRateBasis: 'PIECE', specialRate: 1000, discountPercent: 0, taxRate: 18, area: 'General Selection' }]),
  } }, token)).createDirectSalesOrder;
  cleanup.orderIds.push(direct.id);
  if (direct.leadId) cleanup.leadIds.push(direct.leadId);
  assert(direct.quoteId === null && direct.ownerId === owners[0].id, 'Direct order must be quote-less and retain the selected sales owner');
  assert(Number(direct.totalAmount) === 2360 && direct.paymentStatus === 'advance', 'Direct order GST and advance status must be correct');
  const orderLine = await prisma.salesOrderLine.findFirst({ where: { salesOrderId: direct.id } });
  const reservation = await prisma.reservation.findFirst({ where: { salesOrderId: direct.id } });
  assert(orderLine?.id && reservation?.salesOrderLineId === orderLine.id && Number(orderLine.reservedQuantity) === 2, 'Direct reservation must remain linked to its order line');

  const receipt = (await gql(`mutation($input: CustomerPaymentInput!) { recordCustomerPayment(input: $input) }`, { input: { customerId: customer.id, salesOrderId: direct.id, paymentMode: 'upi', amount: 1860, autoAllocate: true, idempotencyKey: `${sku}-PAY` } }, token)).recordCustomerPayment;
  assert(Number(receipt.unappliedAmount) === 1860, 'Pre-invoice order payment must remain available customer credit');
  const paidOrder = await prisma.salesOrder.findUnique({ where: { id: direct.id } });
  assert(paidOrder.paymentStatus === 'paid' && Number(paidOrder.advanceAmount) === 2360, 'Order payment status must include all posted pre-invoice receipts');

  const job = await prisma.dispatchJob.findUnique({ where: { salesOrderId: direct.id } });
  assert(job?.id && job.quoteId === null, 'Direct order must create a quote-less dispatch job');
  const pick = (await gql(`mutation($input: CreatePickListInput!) { createPickList(input: $input) }`, { input: { salesOrderId: direct.id, locationId: location.id } }, token)).createPickList;
  const pickLine = pick.lines[0];
  assert(pickLine && Number(pickLine.requestedQuantity) === 2, 'Direct order pick list must contain its reserved units');
  await gql(`mutation($id: ID!, $action: String!, $input: PickListTransitionInput) { transitionPickList(id: $id, action: $action, input: $input) }`, { id: pick.id, action: 'start', input: {} }, token);
  await gql(`mutation($id: ID!, $action: String!, $input: PickListTransitionInput) { transitionPickList(id: $id, action: $action, input: $input) }`, { id: pick.id, action: 'pick', input: { lines: JSON.stringify([{ pickLineId: pickLine.id, pickedQuantity: 2 }]) } }, token);
  await gql(`mutation($id: ID!, $action: String!, $input: PickListTransitionInput) { transitionPickList(id: $id, action: $action, input: $input) }`, { id: pick.id, action: 'pack', input: { lines: JSON.stringify([{ pickLineId: pickLine.id, packedQuantity: 2 }]) } }, token);
  await gql(`mutation($id: ID!, $action: String!, $input: PickListTransitionInput) { transitionPickList(id: $id, action: $action, input: $input) }`, { id: pick.id, action: 'complete', input: {} }, token);
  const challan = (await gql(`mutation($input: CreateChallanInput!) { createChallan(input: $input) { id status quoteId salesOrderId } }`, { input: { jobId: job.id, salesOrderId: direct.id, pickListId: pick.id, driverName: 'Direct Gate', driverPhone: '9000000012', vehicleNo: 'GJ-15-DIRECT', packages: 1 } }, token)).createChallan;
  assert(challan.quoteId === null && challan.salesOrderId === direct.id, 'Direct challan must remain linked without inventing a quote');
  await gql(`mutation($id: ID!, $status: String!) { updateChallanStatus(id: $id, status: $status) { id status } }`, { id: challan.id, status: 'dispatched' }, token);
  const dispatchedLine = await prisma.dispatchLine.findFirst({ where: { challanId: challan.id } });
  assert(dispatchedLine?.status === 'dispatched' && Number(dispatchedLine.dispatchedQuantity) === 2, 'Direct order dispatch must consume its two reserved units');
  const invoice = (await gql(`mutation($input: IssueSalesInvoiceInput!) { issueSalesInvoice(input: $input) }`, { input: { salesOrderId: direct.id, dispatchLineIds: [dispatchedLine.id], idempotencyKey: `${sku}-INV` } }, token)).issueSalesInvoice;
  assert(invoice.quoteId === null && invoice.status === 'paid' && Number(invoice.openAmount) === 0, 'Direct invoice must auto-allocate existing receipts and settle in full');
  const account = (await gql(`query($id: ID!) { customerAccount(customerId: $id) }`, { id: customer.id }, token)).customerAccount;
  assert(Number(account.summary.balance) === 0 && Number(account.summary.unallocatedCredit) === 0, 'Settled direct order must leave no receivable or free customer credit');
  await pdf(`/api/pdf/order/${direct.id}`, token, 'Direct sales order');
  await pdf(`/api/pdf/dispatch/${challan.id}`, token, 'Direct dispatch');
  await pdf(`/api/pdf/invoice/${invoice.id}`, token, 'Direct invoice');
  await pdf(`/api/pdf/receipt/${receipt.id}`, token, 'Direct receipt');

  await gql(`mutation($input: ManualGoodsReceiptInput!) { createManualGoodsReceipt(input: $input) }`, { input: { vendorName: 'Lifecycle vendor', locationId: location.id, idempotencyKey: `${sku}-CANCEL-GRN`, lines: JSON.stringify([{ productId: product.id, receivedQuantity: 1, unitCost: 700 }]) } }, token);
  const draftQuote = (await gql(`mutation($input: CreateQuoteInput!) { createQuote(input: $input) { id status leadId } }`, { input: { customerId: customer.id, ownerId: owners[0].id, title: `Cancellation ${stamp}`, lines: JSON.stringify([{ productId: product.id, sku, name: product.name, category: 'Faucets', brand: 'Lifecycle Gate', unit: 'PC', qty: 1, listPrice: 1000, mrp: 1180, mrpRateBasis: 'PIECE', specialRate: 1000, taxRate: 18 }]) } }, token)).createQuote;
  cleanup.quoteIds.push(draftQuote.id);
  if (draftQuote.leadId) cleanup.leadIds.push(draftQuote.leadId);
  const fulfillment = (await gql(`query($id: ID!) { quoteFulfillment(quoteId: $id) }`, { id: draftQuote.id }, token)).quoteFulfillment;
  const converted = (await gql(`mutation($input: CreateSalesOrderInput!) { createSalesOrderFromQuote(input: $input) }`, { input: { quoteId: draftQuote.id, paymentMode: 'credit', lines: JSON.stringify([{ quoteLineId: fulfillment.lines[0].id, quantity: 1 }]), idempotencyKey: `${sku}-CANCEL-SO` } }, token)).createSalesOrderFromQuote;
  const preCancelReservation = await prisma.reservation.findFirst({ where: { salesOrderId: converted.id } });
  assert(preCancelReservation?.status === 'reserved', 'Converted quote must reserve stock before cancellation');
  const cancelledQuote = (await gql(`mutation($id: ID!, $reason: String!) { cancelQuote(id: $id, reason: $reason) { id status } }`, { id: draftQuote.id, reason: 'Lifecycle release gate' }, token)).cancelQuote;
  const [cancelledOrder, cancelledReservation, restoredBalance] = await Promise.all([
    prisma.salesOrder.findUnique({ where: { id: converted.id } }),
    prisma.reservation.findUnique({ where: { id: preCancelReservation.id } }),
    prisma.inventoryBalance.findUnique({ where: { productId: product.id } }),
  ]);
  assert(cancelledQuote.status === 'cancelled' && await prisma.quote.count({ where: { id: draftQuote.id } }) === 1, 'Quote cancellation must preserve the record');
  assert(cancelledOrder.status === 'cancelled' && cancelledReservation.status === 'released' && Number(restoredBalance.available) === 1, 'Converted quote cancellation must cascade and release stock');

  const po = (await gql(`mutation($input: CreatePurchaseOrderInput!) { createPurchaseOrder(input: $input) }`, { input: { vendorName: 'Lifecycle vendor', lines: JSON.stringify([{ productId: product.id, quantity: 1 }]), discountPercent: 5, taxRate: 18 } }, token)).createPurchaseOrder;
  purchaseOrderId = po.id;
  assert(Number(po.subtotal) === 0 && Number(po.grandTotal) === 0 && Number(po.lines?.[0]?.unitCost) === 0, 'PO unit cost must be optional and preserve a zero estimate');
  const cancelledPo = (await gql(`mutation($id: ID!, $reason: String!) { cancelPurchaseOrder(id: $id, reason: $reason) }`, { id: po.id, reason: 'Lifecycle release gate' }, token)).cancelPurchaseOrder;
  assert(cancelledPo.status === 'cancelled' && await prisma.purchaseOrder.count({ where: { id: po.id } }) === 1, 'PO cancellation must preserve the order and lines');

  console.log(JSON.stringify({ ok: true, directOrder: direct.orderNumber, quoteCancelled: cancelledQuote.id, poCancelled: cancelledPo.poNumber, paymentStatus: paidOrder.paymentStatus }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}).finally(async () => {
  if (purchaseOrderId) {
    await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrderId } }).catch(() => null);
    await prisma.purchaseOrder.deleteMany({ where: { id: purchaseOrderId } }).catch(() => null);
  }
  if (process.env.KEEP_E2E_RECORDS !== '1') await cleanupE2eRecords(prisma, cleanup);
  await prisma.$disconnect();
});
