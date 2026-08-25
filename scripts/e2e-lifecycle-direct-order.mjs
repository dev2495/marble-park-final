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
  if (process.env.SKIP_PDF === '1') return;
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
    input: {
      sku, internalCode: sku, name: 'Direct order lifecycle mixer', category: 'Faucets', brand: 'Lifecycle Gate', finish: 'Chrome', unit: 'PC',
      defaultMrpInclusive: 1180, defaultNrpInclusive: 1000, floorPriceInclusive: 800, priceRateBasis: 'PIECE', mrpSource: 'MANUAL', taxClass: 'GST_18',
    },
  }, token)).createProduct;
  cleanup.productIds.push(product.id);
  const location = await prisma.stockLocation.findFirst({ where: { status: 'active' } });
  assert(location, 'An active stock location is required');
  await gql(`mutation($input: ManualGoodsReceiptInput!) { createManualGoodsReceipt(input: $input) }`, { input: { vendorName: 'Lifecycle vendor', locationId: location.id, reason: 'Isolated lifecycle acceptance opening receipt', idempotencyKey: `${sku}-GRN`, lines: JSON.stringify([{ productId: product.id, receivedQuantity: 3, enteredUnitCost: 700, rateUom: 'PC' }]) } }, token);

  const customer = (await gql(`mutation($input: CreateCustomerInput!) { createCustomer(input: $input) { id name } }`, { input: { name: `Direct customer ${stamp}`, phone: '9000000012', email: `direct-${stamp.toLowerCase()}@example.test`, city: 'Vapi', address: 'Lifecycle test', forceCreate: true } }, token)).createCustomer;
  cleanup.customerIds.push(customer.id);
  const owners = (await gql(`query { salesAssignees }`, {}, token)).salesAssignees;
  assert(owners[0]?.id, 'At least one active sales owner is required');

  await gql(
    `mutation($customerId: ID!, $input: CustomerCreditProfileInput!) { updateCustomerCreditProfile(customerId: $customerId, input: $input) }`,
    { customerId: customer.id, input: { creditLimit: 2500, defaultPaymentTerms: 'Net 30' } },
    token,
  );
  const committedCreditOrder = (await gql(`mutation($input: CreateDirectSalesOrderInput!) { createDirectSalesOrder(input: $input) }`, { input: {
    customerId: customer.id, ownerId: owners[0].id, paymentMode: 'credit', paymentTerms: 'Net 30', idempotencyKey: `${sku}-LIMIT-COMMITMENT`,
    lines: JSON.stringify([{ productId: product.id, sku, name: product.name, category: 'Faucets', brand: 'Lifecycle Gate', finish: 'Chrome', unit: 'PC', qty: 1, listPrice: 1000, mrp: 1180, mrpRateBasis: 'PIECE', specialRate: 1000, discountPercent: 0, taxRate: 18, area: 'General Selection' }]),
  } }, token)).createDirectSalesOrder;
  cleanup.orderIds.push(committedCreditOrder.id);
  if (committedCreditOrder.leadId) cleanup.leadIds.push(committedCreditOrder.leadId);
  assert(Number(committedCreditOrder.totalAmount) === 1000, 'Credit-limit fixture must create one tax-inclusive unbilled commitment within the limit');
  let creditLimitBlocked = false;
  try {
    await gql(`mutation($input: CreateDirectSalesOrderInput!) { createDirectSalesOrder(input: $input) }`, { input: {
      customerId: customer.id, ownerId: owners[0].id, paymentMode: 'credit', paymentTerms: 'Net 30', idempotencyKey: `${sku}-LIMIT-BLOCK`,
      lines: JSON.stringify([{ productId: product.id, sku, name: product.name, category: 'Faucets', brand: 'Lifecycle Gate', finish: 'Chrome', unit: 'PC', qty: 2, listPrice: 1000, mrp: 1180, mrpRateBasis: 'PIECE', specialRate: 1000, discountPercent: 0, taxRate: 18, area: 'General Selection' }]),
    } }, token);
  } catch (error) {
    creditLimitBlocked = /Credit limit exceeded/i.test(String(error?.message || error));
  }
  assert(creditLimitBlocked, 'Direct credit orders must enforce the customer credit limit');
  await gql(
    `mutation($customerId: ID!, $input: CustomerCreditProfileInput!) { updateCustomerCreditProfile(customerId: $customerId, input: $input) }`,
    { customerId: customer.id, input: { creditLimit: 0 } },
    token,
  );

  const direct = (await gql(`mutation($input: CreateDirectSalesOrderInput!) { createDirectSalesOrder(input: $input) }`, { input: {
    customerId: customer.id, ownerId: owners[0].id, paymentMode: 'cash', advanceAmount: 500, paymentTerms: 'Cash on order',
    idempotencyKey: `${sku}-SO`, lines: JSON.stringify([{ productId: product.id, sku, name: product.name, category: 'Faucets', brand: 'Lifecycle Gate', finish: 'Chrome', unit: 'PC', qty: 2, listPrice: 1000, mrp: 1180, mrpRateBasis: 'PIECE', specialRate: 1000, discountPercent: 0, taxRate: 18, area: 'General Selection' }]),
  } }, token)).createDirectSalesOrder;
  cleanup.orderIds.push(direct.id);
  if (direct.leadId) cleanup.leadIds.push(direct.leadId);
  assert(direct.quoteId === null && direct.ownerId === owners[0].id, 'Direct order must be quote-less and retain the selected sales owner');
  assert(Number(direct.totalAmount) === 2000 && direct.paymentStatus === 'advance', 'Direct order tax-inclusive total and advance status must be correct');
  const orderLine = await prisma.salesOrderLine.findFirst({ where: { salesOrderId: direct.id } });
  const reservation = await prisma.reservation.findFirst({ where: { salesOrderId: direct.id } });
  assert(orderLine?.id && reservation?.salesOrderLineId === orderLine.id && Number(orderLine.reservedQuantity) === 2, 'Direct reservation must remain linked to its order line');
  assert(orderLine.costSnapshot === null && orderLine.costSnapshotSource === null, 'Direct order must not invent a Product Master cost snapshot before lot fulfilment');

  const receipt = (await gql(`mutation($input: CustomerPaymentInput!) { recordCustomerPayment(input: $input) }`, { input: { customerId: customer.id, salesOrderId: direct.id, paymentMode: 'upi', amount: 1500, autoAllocate: true, idempotencyKey: `${sku}-PAY` } }, token)).recordCustomerPayment;
  assert(Number(receipt.unappliedAmount) === 1500, 'Pre-invoice order payment must remain available customer credit');
  const paidOrder = await prisma.salesOrder.findUnique({ where: { id: direct.id } });
  assert(paidOrder.paymentStatus === 'paid' && Number(paidOrder.advanceAmount) === 2000, 'Order payment status must include all posted pre-invoice receipts');

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
  const invoiceLine = await prisma.salesInvoiceLine.findFirst({ where: { salesInvoiceId: invoice.id } });
  assert(Number(invoiceLine?.costSnapshot) === 700 && invoiceLine?.costSnapshotSource === 'InventoryLot.unitCost' && invoiceLine?.costSnapshotAt, 'Invoice line must preserve the dispatched lot cost snapshot');
  const account = (await gql(`query($id: ID!) { customerAccount(customerId: $id) }`, { id: customer.id }, token)).customerAccount;
  assert(Number(account.summary.balance) === 0 && Number(account.summary.unallocatedCredit) === 0, 'Settled direct order must leave no receivable or free customer credit');
  await pdf(`/api/pdf/order/${direct.id}`, token, 'Direct sales order');
  await pdf(`/api/pdf/dispatch/${challan.id}`, token, 'Direct dispatch');
  await pdf(`/api/pdf/invoice/${invoice.id}`, token, 'Direct invoice');
  await pdf(`/api/pdf/receipt/${receipt.id}`, token, 'Direct receipt');

  await gql(`mutation($input: ManualGoodsReceiptInput!) { createManualGoodsReceipt(input: $input) }`, { input: { vendorName: 'Lifecycle vendor', locationId: location.id, reason: 'Isolated lifecycle cancellation receipt', idempotencyKey: `${sku}-CANCEL-GRN`, lines: JSON.stringify([{ productId: product.id, receivedQuantity: 1, enteredUnitCost: 700, rateUom: 'PC' }]) } }, token);
  const draftQuote = (await gql(`mutation($input: CreateQuoteInput!) { createQuote(input: $input) { id status leadId } }`, { input: { customerId: customer.id, ownerId: owners[0].id, title: `Cancellation ${stamp}`, lines: JSON.stringify([{ productId: product.id, sku, name: product.name, category: 'Faucets', brand: 'Lifecycle Gate', unit: 'PC', qty: 1, listPrice: 1000, mrp: 1180, mrpRateBasis: 'PIECE', specialRate: 1000, taxRate: 18 }]) } }, token)).createQuote;
  cleanup.quoteIds.push(draftQuote.id);
  if (draftQuote.leadId) cleanup.leadIds.push(draftQuote.leadId);
  const quotedCostLine = await prisma.quoteLine.findFirst({ where: { quoteId: draftQuote.id } });
  assert(quotedCostLine?.costSnapshot === null && quotedCostLine?.costSnapshotSource === null, 'Quote must not claim realised cost before a lot is dispatched');
  const fulfillment = (await gql(`query($id: ID!) { quoteFulfillment(quoteId: $id) }`, { id: draftQuote.id }, token)).quoteFulfillment;
  const converted = (await gql(`mutation($input: CreateSalesOrderInput!) { createSalesOrderFromQuote(input: $input) }`, { input: { quoteId: draftQuote.id, paymentMode: 'credit', lines: JSON.stringify([{ quoteLineId: fulfillment.lines[0].id, quantity: 1 }]), idempotencyKey: `${sku}-CANCEL-SO` } }, token)).createSalesOrderFromQuote;
  const preCancelReservation = await prisma.reservation.findFirst({ where: { salesOrderId: converted.id } });
  assert(preCancelReservation?.status === 'reserved', 'Converted quote must reserve stock before cancellation');
  const cancelPick = (await gql(`mutation($input: CreatePickListInput!) { createPickList(input: $input) }`, { input: { salesOrderId: converted.id, locationId: location.id } }, token)).createPickList;
  const cancelPickLine = cancelPick.lines[0];
  await gql(`mutation($id: ID!, $action: String!, $input: PickListTransitionInput) { transitionPickList(id: $id, action: $action, input: $input) }`, { id: cancelPick.id, action: 'start', input: {} }, token);
  await gql(`mutation($id: ID!, $action: String!, $input: PickListTransitionInput) { transitionPickList(id: $id, action: $action, input: $input) }`, { id: cancelPick.id, action: 'pick', input: { lines: JSON.stringify([{ pickLineId: cancelPickLine.id, pickedQuantity: 1 }]) } }, token);
  await gql(`mutation($id: ID!, $action: String!, $input: PickListTransitionInput) { transitionPickList(id: $id, action: $action, input: $input) }`, { id: cancelPick.id, action: 'pack', input: { lines: JSON.stringify([{ pickLineId: cancelPickLine.id, packedQuantity: 1 }]) } }, token);
  await gql(`mutation($id: ID!, $action: String!, $input: PickListTransitionInput) { transitionPickList(id: $id, action: $action, input: $input) }`, { id: cancelPick.id, action: 'complete', input: {} }, token);
  const cancelJob = await prisma.dispatchJob.findUnique({ where: { salesOrderId: converted.id } });
  const pendingChallan = (await gql(`mutation($input: CreateChallanInput!) { createChallan(input: $input) { id status } }`, { input: { jobId: cancelJob.id, salesOrderId: converted.id, pickListId: cancelPick.id, driverName: 'Cancel Gate', driverPhone: '9000000012', vehicleNo: 'GJ-15-CANCEL', packages: 1 } }, token)).createChallan;
  assert(pendingChallan.status === 'pending', 'Cancellation fixture must include an unshipped pending challan');
  const cancelledQuote = (await gql(`mutation($id: ID!, $reason: String!) { cancelQuote(id: $id, reason: $reason) { id status } }`, { id: draftQuote.id, reason: 'Lifecycle release gate' }, token)).cancelQuote;
  const [cancelledOrder, cancelledReservation, cancelledPick, cancelledPickRow, cancelledChallan, cancelledDispatchLine, cancelledQuoteLine, restoredBalance] = await Promise.all([
    prisma.salesOrder.findUnique({ where: { id: converted.id } }),
    prisma.reservation.findUnique({ where: { id: preCancelReservation.id } }),
    prisma.pickList.findUnique({ where: { id: cancelPick.id } }),
    prisma.pickLine.findUnique({ where: { id: cancelPickLine.id } }),
    prisma.dispatchChallan.findUnique({ where: { id: pendingChallan.id } }),
    prisma.dispatchLine.findFirst({ where: { challanId: pendingChallan.id } }),
    prisma.quoteLine.findFirst({ where: { quoteId: draftQuote.id } }),
    prisma.inventoryBalance.findUnique({ where: { productId: product.id } }),
  ]);
  assert(cancelledQuote.status === 'cancelled' && await prisma.quote.count({ where: { id: draftQuote.id } }) === 1, 'Quote cancellation must preserve the record');
  assert(cancelledOrder.status === 'cancelled' && cancelledReservation.status === 'released' && Number(restoredBalance.available) === 1, 'Converted quote cancellation must cascade and release stock');
  assert(cancelledPick.status === 'cancelled' && cancelledPickRow.status === 'cancelled', 'Quote cancellation must void unfinished warehouse pick work');
  assert(cancelledChallan.status === 'cancelled' && cancelledDispatchLine.status === 'cancelled', 'Quote cancellation must void an unshipped challan and its dispatch rows');
  assert(Number(cancelledQuoteLine.orderedQuantity) + Number(cancelledQuoteLine.cancelledQuantity) + Number(cancelledQuoteLine.closedQuantity) === Number(cancelledQuoteLine.quantity), 'Quote cancellation quantities must not count ordered units twice');

  const po = (await gql(`mutation($input: CreatePurchaseOrderInput!) { createPurchaseOrder(input: $input) }`, { input: { vendorName: 'Lifecycle vendor', lines: JSON.stringify([{ productId: product.id, quantity: 1, enteredUnitCost: 700, rateUom: 'PC' }]), discountPercent: 5, taxRate: 18 } }, token)).createPurchaseOrder;
  purchaseOrderId = po.id;
  assert(Number(po.subtotal) === 700 && Number(po.discountAmount) === 35 && Number(po.taxAmount) === 119.7 && Number(po.grandTotal) === 784.7 && Number(po.lines?.[0]?.netUnitCost) === 665, 'PO supplier rate, discount and optional GST math must reconcile');
  let silentPoCancellationBlocked = false;
  try {
    await gql(`mutation($id: ID!, $status: String!) { updatePurchaseOrderStatus(id: $id, status: $status) }`, { id: po.id, status: 'cancelled' }, token);
  } catch (error) {
    silentPoCancellationBlocked = /cancelPurchaseOrder|cancellation reason/i.test(String(error?.message || error));
  }
  assert(silentPoCancellationBlocked, 'The generic PO status mutation must not bypass reasoned cancellation');
  const unchangedPo = await prisma.purchaseOrder.findUnique({ where: { id: po.id } });
  assert(unchangedPo.status === 'ordered', 'A blocked silent cancellation must not mutate the PO');
  const cancelledPo = (await gql(`mutation($id: ID!, $reason: String!) { cancelPurchaseOrder(id: $id, reason: $reason) }`, { id: po.id, reason: 'Lifecycle release gate' }, token)).cancelPurchaseOrder;
  assert(cancelledPo.status === 'cancelled' && await prisma.purchaseOrder.count({ where: { id: po.id } }) === 1, 'PO cancellation must preserve the order and lines');

  console.log(JSON.stringify({ ok: true, directOrder: direct.orderNumber, creditLimitBlocked, quoteCancelled: cancelledQuote.id, warehouseDocumentsVoided: true, poCancelled: cancelledPo.poNumber, silentPoCancellationBlocked, paymentStatus: paidOrder.paymentStatus }, null, 2));
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
