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
  return json.data;
}

async function expectPdf(path, token, name) {
  const response = await fetch(`${WEB}${path}`, { headers: { authorization: `Bearer ${token}` } });
  const bytes = Buffer.from(await response.arrayBuffer());
  assert(response.ok, `${name} must return 200, received ${response.status}`);
  assert((response.headers.get('content-type') || '').includes('application/pdf'), `${name} must return application/pdf`);
  assert(bytes.subarray(0, 4).toString() === '%PDF', `${name} must start with a PDF header`);
  assert(bytes.length > 1200, `${name} must contain a substantive document`);
}

async function main() {
  const login = await gql(
    `mutation($input: LoginInput!) { login(input: $input) { token user { id email role } } }`,
    { input: { email: TEST_EMAIL, password: TEST_PASSWORD } },
  );
  const token = login.login.token;
  assert(token, 'Release contract smoke requires an admin bearer token');
  const suffix = unique('REL-CONTRACT');

  const product = (await gql(
    `mutation($input: CreateProductInput!) { createProduct(input: $input) { id sku name category brand finish unit sellPrice } }`,
    { input: { sku: suffix, internalCode: suffix, name: 'Release contract test mixer', category: 'Faucets', brand: 'Release Contract', finish: 'Chrome', unit: 'PC', sellPrice: 10000, floorPrice: 8000, taxClass: 'GST_18' } },
    token,
  )).createProduct;
  cleanupContext.productIds.push(product.id);

  const customer = (await gql(
    `mutation($input: CreateCustomerInput!) { createCustomer(input: $input) { id name } }`,
    { input: { name: `Release contract customer ${suffix}`, phone: '9000000088', email: `${suffix.toLowerCase()}@example.test`, city: 'Vapi', address: 'Release contract site', forceCreate: true } },
    token,
  )).createCustomer;
  cleanupContext.customerIds.push(customer.id);

  const lineWithoutMrp = JSON.stringify([{ productId: product.id, sku: product.sku, name: product.name, category: product.category, brand: product.brand, finish: product.finish, unit: 'PC', qty: 1, price: 10000, taxRate: 18 }]);
  let mrpError = '';
  try {
    await gql(
      `mutation($input: CreateQuoteInput!) { createQuote(input: $input) { id } }`,
      { input: { customerId: customer.id, title: `Blocked quote ${suffix}`, lines: lineWithoutMrp } },
      token,
    );
  } catch (error) {
    mrpError = String(error.message || error);
  }
  assert(/MRP|required|commercial/i.test(mrpError), `A new quote without MRP must be blocked, received: ${mrpError}`);

  const quote = (await gql(
    `mutation($input: CreateQuoteInput!) { createQuote(input: $input) { id quoteNumber lines status approvalStatus } }`,
    { input: { customerId: customer.id, title: `Release contract quote ${suffix}`, lines: JSON.stringify([{ productId: product.id, sku: product.sku, name: product.name, category: product.category, brand: product.brand, finish: product.finish, unit: 'PC', qty: 1, price: 10000, mrp: 12000, mrpRateBasis: 'PIECE', taxRate: 18 }]) } },
    token,
  )).createQuote;
  cleanupContext.quoteIds.push(quote.id);
  const fulfillment = (await gql(`query($quoteId: ID!) { quoteFulfillment(quoteId: $quoteId) }`, { quoteId: quote.id }, token)).quoteFulfillment;
  const quoteLine = fulfillment.lines?.[0] || (Array.isArray(quote.lines) ? quote.lines[0] : null);
  assert(Number(quoteLine?.mrp) === 12000 && quoteLine?.mrpRateBasis === 'PIECE', 'Quote must persist the MRP snapshot and basis');

  const order = (await gql(
    `mutation($input: CreateSalesOrderInput!) { createSalesOrderFromQuote(input: $input) }`,
    { input: { quoteId: quote.id, paymentMode: 'cash', advanceAmount: 1000, lines: JSON.stringify([{ quoteLineId: quoteLine.id, quantity: 1 }]), idempotencyKey: `${suffix}-ORDER` } },
    token,
  )).createSalesOrderFromQuote;
  assert(order.id && order.orderNumber, 'A valid MRP quote must convert to a sales order');

  const tower = (await gql(
    `query($search: String, $take: Float) { salesOrderControlTower(search: $search, take: $take) }`,
    { search: order.orderNumber, take: 10 },
    token,
  )).salesOrderControlTower;
  const towerOrder = tower.items?.find((item) => item.id === order.id);
  assert(towerOrder?.lines?.some((line) => Number(line.mrp) === 12000 && line.mrpRateBasis === 'PIECE'), 'Order control tower must expose the persisted MRP snapshot');
  assert(Number(towerOrder.quantities.leftToDispatch) === 1, 'Order control tower must show the un-dispatched quantity');

  const dispatchRegister = (await gql(
    `query($search: String, $take: Float) { reservedDispatchLines(search: $search, take: $take) }`,
    { search: order.orderNumber, take: 10 },
    token,
  )).reservedDispatchLines;
  const registerLine = dispatchRegister.items?.find((item) => item.salesOrderId === order.id);
  assert(registerLine && Number(registerLine.leftToDispatch) === 1 && registerLine.status === 'pending_inward' && Number(registerLine.backorderedQuantity) === 1, 'Reserved dispatch register must expose the unreceived line as pending inward');

  const inventory = (await gql(`query($search: String, $take: Int) { inventoryControlTower(search: $search, take: $take) }`, { search: product.sku, take: 10 }, token)).inventoryControlTower;
  assert(inventory.items?.some((item) => item.product?.sku === product.sku) && Object.hasOwn(inventory.summary || {}, 'zeroSellPrice'), 'Inventory control tower must return bounded rows and price-completeness KPIs');

  await expectPdf(`/api/pdf/quote/${quote.id}`, token, 'Quote PDF');
  await expectPdf(`/api/pdf/order/${order.id}`, token, 'Sales-order PDF');

  console.log(JSON.stringify({ ok: true, blockedWithoutMrp: true, quoteNumber: quote.quoteNumber, orderNumber: order.orderNumber, dispatchStatus: registerLine.status }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}).finally(async () => {
  if (process.env.KEEP_E2E_RECORDS !== '1') await cleanupE2eRecords(prisma, cleanupContext);
  await prisma.$disconnect();
});
