import { PrismaClient } from '@prisma/client';
import { cleanupE2eRecords } from './lib/cleanup-e2e-records.mjs';

const API = process.env.API_URL || 'http://localhost:4000/graphql';
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
  if (!response.ok || json.errors?.length) throw new Error(json.errors?.map((error) => error.message).join('; ') || `GraphQL request failed (${response.status})`);
  return { data: json.data, setCookie: response.headers.get('set-cookie') || '' };
}

async function main() {
  const login = await gql(
    `mutation($input: LoginInput!) { login(input: $input) { authenticated token user { id email role } } }`,
    { input: { email: TEST_EMAIL, password: TEST_PASSWORD } },
  );
  assert(login.data.login.authenticated && login.data.login.token, 'Login must retain a bearer token for automation clients');
  assert(/mp_session=/i.test(login.setCookie) && /HttpOnly/i.test(login.setCookie), 'Browser login must issue an HttpOnly mp_session cookie');
  const token = login.data.login.token;
  const suffix = unique('CLIENT-FLOW');

  const product = (await gql(
    `mutation($input: CreateProductInput!) { createProduct(input: $input) { id sku name sellPrice floorPrice updatedAt status } }`,
    { input: { sku: suffix, name: 'Client workflow release-gate mixer', category: 'Faucets', brand: 'Release Gate', finish: 'Chrome', dimensions: '180 mm', unit: 'PC', sellPrice: 12000, floorPrice: 9000, taxClass: 'GST_18' } },
    token,
  )).data.createProduct;
  cleanupContext.productIds.push(product.id);
  const updated = (await gql(
    `mutation($id: ID!, $input: UpdateProductInput!) { updateProduct(id: $id, input: $input) { id sku name sellPrice floorPrice status updatedAt media } }`,
    { id: product.id, input: { name: 'Client workflow release-gate mixer updated', sellPrice: 12500, floorPrice: 9000, media: { primaryUrl: null, gallery: [] }, expectedUpdatedAt: product.updatedAt } },
    token,
  )).data.updateProduct;
  assert(updated.sku === suffix && updated.name.endsWith('updated'), 'Product Master must edit details while preserving the original SKU');

  const customer = (await gql(
    `mutation($input: CreateCustomerInput!) { createCustomer(input: $input) { id name } }`,
    { input: { name: `Client workflow customer ${suffix}`, phone: '9000000011', email: `${suffix.toLowerCase()}@example.test`, city: 'Ahmedabad', address: 'Release-gate test site', forceCreate: true } },
    token,
  )).data.createCustomer;
  cleanupContext.customerIds.push(customer.id);

  const quoteInput = (quantity) => ({
    customerId: customer.id,
    title: `Direct customer quote ${suffix}`,
    projectName: 'Release gate direct quote',
    lines: JSON.stringify([{ productId: product.id, sku: product.sku, name: updated.name, category: 'Faucets', brand: 'Release Gate', unit: 'PC', qty: quantity, price: 12500, listPrice: 12500, mrp: 13000, mrpRateBasis: 'PIECE', specialRate: 10000, discountPercent: 0, taxRate: 18, area: 'Master Bathroom' }]),
  });
  const quote = (await gql(
    `mutation($input: CreateQuoteInput!) { createQuote(input: $input) { id quoteNumber leadId lines approvalStatus status } }`,
    { input: quoteInput(5) }, token,
  )).data.createQuote;
  cleanupContext.quoteIds.push(quote.id);
  cleanupContext.leadIds.push(quote.leadId);
  assert(quote.leadId, 'A direct customer quote must auto-create its internal lead link');
  const quoteLine = Array.isArray(quote.lines) ? quote.lines[0] : JSON.parse(quote.lines)[0];
  assert(Number(quoteLine.listPrice) === 12500 && Number(quoteLine.unitRate) === 10000 && Number(quoteLine.taxAmount) === 9000, 'Quote must retain the negotiated rate and canonical tax calculation');

  let fulfillment = (await gql(`query($quoteId: ID!) { quoteFulfillment(quoteId: $quoteId) }`, { quoteId: quote.id }, token)).data.quoteFulfillment;
  const quoteLineId = fulfillment.lines[0].id;
  assert(fulfillment.lines[0].remaining === 5, 'New quote must expose all quantity as remaining');

  const firstKey = `${suffix}-FIRST`;
  const firstOrder = (await gql(
    `mutation($input: CreateSalesOrderInput!) { createSalesOrderFromQuote(input: $input) }`,
    { input: { quoteId: quote.id, paymentMode: 'cash', advanceAmount: 1000, paymentTerms: 'Cash on order', idempotencyKey: firstKey, lines: JSON.stringify([{ quoteLineId, quantity: 2 }]) } }, token,
  )).data.createSalesOrderFromQuote;
  assert(Number(firstOrder.totalAmount) === 23600, 'First partial order must calculate from the negotiated price plus GST');
  const retriedOrder = (await gql(
    `mutation($input: CreateSalesOrderInput!) { createSalesOrderFromQuote(input: $input) }`,
    { input: { quoteId: quote.id, paymentMode: 'cash', advanceAmount: 1000, paymentTerms: 'Cash on order', idempotencyKey: firstKey, lines: JSON.stringify([{ quoteLineId, quantity: 2 }]) } }, token,
  )).data.createSalesOrderFromQuote;
  assert(retriedOrder.id === firstOrder.id, 'Repeating an idempotency key must return the original sales order');

  const presentationLines = [{ lineKey: quoteLine.lineKey, area: 'Client-approved master bathroom', customImageUrl: '/brand/marble-park-logo.png', designCode: 'CLIENT-SELECTION-01' }];
  const presentationUpdate = (await gql(
    `mutation($id: ID!, $input: UpdateQuotePresentationInput!) { updateQuotePresentation(id: $id, input: $input) { id displayMode lines } }`,
    { id: quote.id, input: { displayMode: 'priced', linePresentation: JSON.stringify(presentationLines) } }, token,
  )).data.updateQuotePresentation;
  assert(presentationUpdate.lines.some((line) => line.area === 'Client-approved master bathroom' && line.customImageUrl === '/brand/marble-park-logo.png'), 'Post-order document presentation changes must remain editable');

  let commercialEditRejected = false;
  try {
    await gql(
      `mutation($id: ID!, $input: UpdateQuoteInput!) { updateQuote(id: $id, input: $input) { id } }`,
      { id: quote.id, input: { lines: JSON.stringify([{ ...quoteLine, qty: 99 }]) } }, token,
    );
  } catch (error) {
    commercialEditRejected = /frozen|revision/i.test(String(error.message));
  }
  assert(commercialEditRejected, 'Commercial terms must remain frozen after the first order and require a quote revision');

  fulfillment = (await gql(`query($quoteId: ID!) { quoteFulfillment(quoteId: $quoteId) }`, { quoteId: quote.id }, token)).data.quoteFulfillment;
  assert(fulfillment.lines[0].ordered === 2 && fulfillment.lines[0].remaining === 3, 'Partial conversion must leave the unconfirmed balance on the same quote');
  const secondOrder = (await gql(
    `mutation($input: CreateSalesOrderInput!) { createSalesOrderFromQuote(input: $input) }`,
    { input: { quoteId: quote.id, paymentMode: 'credit', paymentTerms: 'Net 30', idempotencyKey: `${suffix}-SECOND`, lines: JSON.stringify([{ quoteLineId, quantity: 3 }]) } }, token,
  )).data.createSalesOrderFromQuote;
  assert(secondOrder.id !== firstOrder.id && Number(secondOrder.totalAmount) === 35400, 'Second partial order must be distinct and contain only its selected quantity');

  fulfillment = (await gql(`query($quoteId: ID!) { quoteFulfillment(quoteId: $quoteId) }`, { quoteId: quote.id }, token)).data.quoteFulfillment;
  assert(fulfillment.lines[0].remaining === 0 && fulfillment.orders.length === 2, 'One quote must support multiple orders without a duplicate quote');

  let overOrderRejected = false;
  try {
    await gql(`mutation($input: CreateSalesOrderInput!) { createSalesOrderFromQuote(input: $input) }`, { input: { quoteId: quote.id, paymentMode: 'cash', idempotencyKey: `${suffix}-OVER`, lines: JSON.stringify([{ quoteLineId, quantity: 1 }]) } }, token);
  } catch (error) {
    overOrderRejected = /remaining|no remaining/i.test(String(error.message));
  }
  assert(overOrderRejected, 'Over-ordering a fully allocated quote must be rejected');

  const [orders, reservations, dispatchJobs, receipts, demands] = await Promise.all([
    prisma.salesOrder.findMany({ where: { quoteId: quote.id }, orderBy: { createdAt: 'asc' } }),
    prisma.reservation.findMany({ where: { quoteId: quote.id } }),
    prisma.dispatchJob.findMany({ where: { quoteId: quote.id } }),
    prisma.customerPayment.findMany({ where: { salesOrderId: firstOrder.id } }),
    prisma.purchaseDemand.findMany({ where: { sourceQuoteId: quote.id } }),
  ]);
  assert(orders.length === 2 && new Set(orders.map((order) => order.id)).size === 2, 'Database must retain two independent SalesOrder rows for one quote');
  assert(dispatchJobs.length === 2 && new Set(dispatchJobs.map((job) => job.salesOrderId)).size === 2, 'Each partial order must own one dispatch job');
  assert(reservations.length === 2 && new Set(reservations.map((row) => row.salesOrderId)).size === 2 && reservations.every((row) => row.salesOrderId), 'Reservations must be order-scoped, not quote-scoped');
  assert(receipts.length === 1 && Number(receipts[0].amount) === 1000 && Number(receipts[0].unappliedAmount) === 1000, 'Order advance must become one unapplied customer receipt for the correct partial order');
  assert(demands.length === 2 && new Set(demands.map((demand) => demand.sourceOrderId)).size === 2, 'Backorder procurement demand must remain isolated per partial order');

  const remainderQuote = (await gql(
    `mutation($input: CreateQuoteInput!) { createQuote(input: $input) { id } }`, { input: quoteInput(2) }, token,
  )).data.createQuote;
  cleanupContext.quoteIds.push(remainderQuote.id);
  const remainderLead = await prisma.quote.findUnique({ where: { id: remainderQuote.id }, select: { leadId: true } });
  if (remainderLead?.leadId) cleanupContext.leadIds.push(remainderLead.leadId);
  const remainderFulfillment = (await gql(`query($quoteId: ID!) { quoteFulfillment(quoteId: $quoteId) }`, { quoteId: remainderQuote.id }, token)).data.quoteFulfillment;
  await gql(`mutation($input: CreateSalesOrderInput!) { createSalesOrderFromQuote(input: $input) }`, { input: { quoteId: remainderQuote.id, paymentMode: 'cash', idempotencyKey: `${suffix}-REMAINDER-ORDER`, lines: JSON.stringify([{ quoteLineId: remainderFulfillment.lines[0].id, quantity: 1 }]) } }, token);
  await gql(`mutation($quoteId: ID!, $reason: String!) { closeQuoteRemainder(quoteId: $quoteId, reason: $reason) { id status } }`, { quoteId: remainderQuote.id, reason: 'Customer cancelled the final unit during release-gate verification.' }, token);
  const closedFulfillment = (await gql(`query($quoteId: ID!) { quoteFulfillment(quoteId: $quoteId) }`, { quoteId: remainderQuote.id }, token)).data.quoteFulfillment;
  assert(closedFulfillment.status === 'closed' && closedFulfillment.lines[0].remaining === 0 && closedFulfillment.lines[0].closed === 1, 'Staff must be able to close a residual quantity with an explicit reason');

  console.log(JSON.stringify({
    ok: true,
    productSku: updated.sku,
    quoteNumber: quote.quoteNumber,
    orderNumbers: orders.map((order) => order.orderNumber),
    orderIds: orders.map((order) => order.id),
    dispatchJobIds: dispatchJobs.map((job) => job.id),
    demandIds: demands.map((demand) => demand.id),
    authCookie: 'HttpOnly mp_session issued',
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}).finally(async () => {
  if (process.env.KEEP_E2E_RECORDS !== '1') await cleanupE2eRecords(prisma, cleanupContext);
  await prisma.$disconnect();
});
