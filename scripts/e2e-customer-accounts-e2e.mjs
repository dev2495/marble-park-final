import { PrismaClient } from '@prisma/client';
import { cleanupE2eRecords } from './lib/cleanup-e2e-records.mjs';

const API = process.env.API_URL || 'http://localhost:4000/graphql';
const WEB = process.env.WEB_URL || 'http://localhost:3000';
const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@marblepark.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'password123';
const prisma = new PrismaClient();
const cleanupContext = { productIds: [], customerIds: [], quoteIds: [], leadIds: [] };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function unique(prefix) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
}

async function gql(query, variables = {}, token) {
  const response = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  const json = await response.json();
  if (!response.ok || json.errors?.length) {
    throw new Error(json.errors?.map((error) => error.message).join('; ') || `GraphQL request failed (${response.status})`);
  }
  return { data: json.data, setCookie: response.headers.get('set-cookie') || '' };
}

async function fetchPdf(path, token, name) {
  const response = await fetch(`${WEB}${path}`, { headers: { authorization: `Bearer ${token}` } });
  const bytes = Buffer.from(await response.arrayBuffer());
  assert(response.ok, `${name} endpoint must return success, got ${response.status}`);
  assert((response.headers.get('content-type') || '').includes('application/pdf'), `${name} endpoint must return application/pdf`);
  assert(bytes.subarray(0, 4).toString() === '%PDF', `${name} must return a valid PDF file`);
  assert(bytes.length > 1200, `${name} PDF must be a substantive document`);
}

async function main() {
  const login = await gql(
    `mutation($input: LoginInput!) { login(input: $input) { authenticated token user { id email role } } }`,
    { input: { email: TEST_EMAIL, password: TEST_PASSWORD } },
  );
  assert(login.data.login.authenticated && login.data.login.token, 'Admin login must return a bearer token');
  assert(/mp_session=/i.test(login.setCookie) && /HttpOnly/i.test(login.setCookie), 'Browser login must issue an HttpOnly session cookie');
  const token = login.data.login.token;
  const suffix = unique('AR-E2E');

  const product = (await gql(
    `mutation($input: CreateProductInput!) { createProduct(input: $input) { id sku name } }`,
    { input: { sku: suffix, internalCode: suffix, name: 'Customer accounts release gate shower', category: 'Faucets', brand: 'Release Gate', finish: 'Chrome', unit: 'PC', sellPrice: 10000, floorPrice: 8000, taxClass: 'GST_18' } }, token,
  )).data.createProduct;
  cleanupContext.productIds.push(product.id);

  const locations = await prisma.stockLocation.findMany({ where: { status: 'active' }, take: 1 });
  assert(locations[0]?.id, 'The release gate needs one active stock location');
  const locationId = locations[0].id;
  const grn = (await gql(
    `mutation($input: ManualGoodsReceiptInput!) { createManualGoodsReceipt(input: $input) }`,
    { input: { vendorName: 'E2E Vendor', locationId, reason: 'Customer accounts release gate', idempotencyKey: `${suffix}-GRN`, lines: JSON.stringify([{ productId: product.id, receivedQuantity: 2, unitCost: 7500 }]) } }, token,
  )).data.createManualGoodsReceipt;
  assert(grn?.id && grn?.grnNumber, 'Manual GRN must create a stock lot before an order can reserve it');

  const customer = (await gql(
    `mutation($input: CreateCustomerInput!) { createCustomer(input: $input) { id name } }`,
    { input: { name: `Accounts customer ${suffix}`, phone: '9000000011', email: `${suffix.toLowerCase()}@example.test`, city: 'Vapi', address: 'E2E test address', forceCreate: true } }, token,
  )).data.createCustomer;
  cleanupContext.customerIds.push(customer.id);

  const quote = (await gql(
    `mutation($input: CreateQuoteInput!) { createQuote(input: $input) { id quoteNumber leadId lines } }`,
    { input: { customerId: customer.id, title: `Accounts release gate ${suffix}`, lines: JSON.stringify([{ productId: product.id, sku: product.sku, name: product.name, category: 'Faucets', brand: 'Release Gate', finish: 'Chrome', unit: 'PC', qty: 3, price: 10000, listPrice: 10000, mrp: 12000, mrpRateBasis: 'PIECE', specialRate: 10000, taxRate: 18, area: 'Master bathroom' }]) } }, token,
  )).data.createQuote;
  cleanupContext.quoteIds.push(quote.id);
  if (quote.leadId) cleanupContext.leadIds.push(quote.leadId);
  const fulfillment = (await gql(`query($quoteId: ID!) { quoteFulfillment(quoteId: $quoteId) }`, { quoteId: quote.id }, token)).data.quoteFulfillment;
  const quoteLine = fulfillment.lines[0];
  assert(quoteLine?.id, 'A new quote must persist an orderable quote-line reference');

  const order = (await gql(
    `mutation($input: CreateSalesOrderInput!) { createSalesOrderFromQuote(input: $input) }`,
    { input: { quoteId: quote.id, paymentMode: 'cash', advanceAmount: 1000, paymentTerms: 'Cash on order', idempotencyKey: `${suffix}-ORDER`, lines: JSON.stringify([{ quoteLineId: quoteLine.id, quantity: 3 }]) } }, token,
  )).data.createSalesOrderFromQuote;
  assert(Number(order.totalAmount) === 35400, 'Sales order must preserve quoted taxable value plus GST');
  const advance = await prisma.customerPayment.findFirst({ where: { salesOrderId: order.id, amount: 1000 } });
  assert(advance?.status === 'posted' && Number(advance.unappliedAmount) === 1000, 'Sales-order advance must become an unapplied customer receipt');
  const legacyReceipts = await prisma.paymentReceipt.count({ where: { salesOrderId: order.id } });
  assert(legacyReceipts === 0, 'A new advance must not also create a duplicate legacy receipt');

  const job = await prisma.dispatchJob.findUnique({ where: { salesOrderId: order.id } });
  assert(job?.id, 'Sales order must create an order-scoped dispatch job');
  const reservations = await prisma.lotReservation.findMany({ where: { reservation: { salesOrderId: order.id }, status: 'reserved' } });
  assert(reservations.reduce((total, row) => total + Number(row.quantity), 0) === 2, 'Only available stock must reserve; the remaining order quantity stays pending inward');
  const pick = (await gql(
    `mutation($input: CreatePickListInput!) { createPickList(input: $input) }`,
    { input: { salesOrderId: order.id, locationId } }, token,
  )).data.createPickList;
  assert(pick?.id && pick.lines?.length === 1 && Number(pick.lines[0].requestedQuantity) === 2, 'Pick list must contain only the physically reserved quantity');
  const pickLine = pick.lines[0];
  await gql(`mutation($id: ID!, $action: String!, $input: PickListTransitionInput) { transitionPickList(id: $id, action: $action, input: $input) }`, { id: pick.id, action: 'start', input: {} }, token);
  await gql(`mutation($id: ID!, $action: String!, $input: PickListTransitionInput) { transitionPickList(id: $id, action: $action, input: $input) }`, { id: pick.id, action: 'pick', input: { lines: JSON.stringify([{ pickLineId: pickLine.id, pickedQuantity: 2 }]) } }, token);
  await gql(`mutation($id: ID!, $action: String!, $input: PickListTransitionInput) { transitionPickList(id: $id, action: $action, input: $input) }`, { id: pick.id, action: 'pack', input: { lines: JSON.stringify([{ pickLineId: pickLine.id, packedQuantity: 2 }]) } }, token);
  const completedPick = (await gql(`mutation($id: ID!, $action: String!, $input: PickListTransitionInput) { transitionPickList(id: $id, action: $action, input: $input) }`, { id: pick.id, action: 'complete', input: {} }, token)).data.transitionPickList;
  assert(completedPick.status === 'completed', 'Picked and packed stock must complete before challan creation');

  const challan = (await gql(
    `mutation($input: CreateChallanInput!) { createChallan(input: $input) { id challanNumber status } }`,
    { input: { jobId: job.id, salesOrderId: order.id, pickListId: pick.id, driverName: 'E2E Driver', driverPhone: '9000000011', vehicleNo: 'GJ-15-TEST', packages: 1 } }, token,
  )).data.createChallan;
  await gql(`mutation($id: ID!, $status: String!) { updateChallanStatus(id: $id, status: $status) { id status } }`, { id: challan.id, status: 'dispatched' }, token);
  const dispatchLines = await prisma.dispatchLine.findMany({ where: { challanId: challan.id, status: 'dispatched' } });
  assert(dispatchLines.length === 1 && Number(dispatchLines[0].dispatchedQuantity) === 2, 'A partial challan must dispatch only available units and preserve the order balance');

  const invoiceable = (await gql(`query { invoiceableOrders(take: 20) }`, {}, token)).data.invoiceableOrders;
  const invoiceableOrder = invoiceable.find((row) => row.salesOrderId === order.id);
  assert(invoiceableOrder?.dispatchLineIds?.includes(dispatchLines[0].id), 'Dispatched, unbilled lines must enter the invoice queue');
  const invoice = (await gql(
    `mutation($input: IssueSalesInvoiceInput!) { issueSalesInvoice(input: $input) }`,
    { input: { salesOrderId: order.id, dispatchLineIds: [dispatchLines[0].id], notes: 'Partial dispatch invoice', idempotencyKey: `${suffix}-INV` } }, token,
  )).data.issueSalesInvoice;
  assert(Number(invoice.totalAmount) === 23600, 'Invoice must value only the two dispatched units');
  assert(Number(invoice.openAmount) === 22600 && invoice.status === 'partial', 'Existing advance must auto-allocate to the first issued invoice');
  const invoiceRetry = (await gql(
    `mutation($input: IssueSalesInvoiceInput!) { issueSalesInvoice(input: $input) }`,
    { input: { salesOrderId: order.id, dispatchLineIds: [dispatchLines[0].id], notes: 'Partial dispatch invoice', idempotencyKey: `${suffix}-INV` } }, token,
  )).data.issueSalesInvoice;
  assert(invoiceRetry.id === invoice.id, 'Invoice idempotency must return the original posted invoice');

  const receiptInput = { customerId: customer.id, salesOrderId: order.id, salesInvoiceId: invoice.id, paymentMode: 'upi', amount: 5000, reference: `${suffix}-UPI`, autoAllocate: true, idempotencyKey: `${suffix}-RCPT` };
  const receipt = (await gql(`mutation($input: CustomerPaymentInput!) { recordCustomerPayment(input: $input) }`, { input: receiptInput }, token)).data.recordCustomerPayment;
  assert(Number(receipt.unappliedAmount) === 0, 'A receipt selected for an invoice must allocate in the same transaction');
  const receiptRetry = (await gql(`mutation($input: CustomerPaymentInput!) { recordCustomerPayment(input: $input) }`, { input: receiptInput }, token)).data.recordCustomerPayment;
  assert(receiptRetry.id === receipt.id, 'Receipt idempotency must return the original receipt');

  const account = (await gql(`query($customerId: ID!) { customerAccount(customerId: $customerId) }`, { customerId: customer.id }, token)).data.customerAccount;
  assert(Number(account.summary.balance) === 17600, 'Customer balance must equal the partial invoice less advance and receipt');
  assert(account.invoices.length === 1 && Number(account.invoices[0].openAmount) === 17600, 'Customer account must expose the live invoice balance');
  assert(account.ledger.some((entry) => entry.sourceType === 'SalesInvoice') && account.ledger.some((entry) => entry.sourceType === 'CustomerPayment'), 'Customer ledger must trace invoice and receipt events');

  const collectionTask = (await gql(
    `mutation($input: CollectionTaskInput!) { createCollectionTask(input: $input) }`,
    { input: { customerId: customer.id, salesInvoiceId: invoice.id, priority: 'high', note: 'E2E payment follow-up' } }, token,
  )).data.createCollectionTask;
  const completedTask = (await gql(`mutation($id: ID!, $outcome: String) { completeCollectionTask(id: $id, outcome: $outcome) }`, { id: collectionTask.id, outcome: 'Customer confirmed payment date' }, token)).data.completeCollectionTask;
  assert(completedTask.status === 'completed', 'Collections follow-up must be separately traceable and completable');

  await fetchPdf(`/api/pdf/invoice/${invoice.id}`, token, 'Invoice PDF');
  await fetchPdf(`/api/pdf/receipt/${receipt.id}`, token, 'Receipt PDF');
  await fetchPdf(`/api/pdf/customer-statement/${customer.id}`, token, 'Customer statement PDF');

  console.log(JSON.stringify({ ok: true, quoteNumber: quote.quoteNumber, orderNumber: order.orderNumber, challanNumber: challan.challanNumber, invoiceNumber: invoice.invoiceNumber, receiptNumber: receipt.receiptNumber, outstanding: account.summary.balance }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}).finally(async () => {
  if (process.env.KEEP_E2E_RECORDS !== '1') await cleanupE2eRecords(prisma, cleanupContext);
  await prisma.$disconnect();
});
