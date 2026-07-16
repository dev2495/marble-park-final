import { PrismaClient } from '@prisma/client';

const API = process.env.API_URL || 'http://localhost:4100/graphql';
const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@marblepark.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'password123';
const prisma = new PrismaClient();
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function gql(query, variables = {}, token) {
  const response = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ query, variables }) });
  const json = await response.json();
  if (!response.ok || json.errors?.length) throw new Error(json.errors?.map((row) => row.message).join('; ') || `GraphQL request failed (${response.status})`);
  return json.data;
}

async function main() {
  const token = (await gql(`mutation($input: LoginInput!) { login(input: $input) { token } }`, { input: { email: TEST_EMAIL, password: TEST_PASSWORD } })).login.token;
  const suffix = Date.now().toString(36).toUpperCase();
  const product = (await gql(
    `mutation($input: CreateProductInput!) { createProduct(input: $input) { id sku internalCode name unit purchaseUom salesUom piecesPerPack coveragePerPack sellPrice } }`,
    { input: { sku: `TILE-AREA-${suffix}`, internalCode: `SHOW-${suffix}`, name: 'Area pricing regression tile', category: 'Tiles', brand: 'Lifecycle Test', finish: 'Matt', dimensions: '600 x 1200 mm', unit: 'BOX', baseUom: 'PC', purchaseUom: 'BOX', salesUom: 'SQFT', piecesPerPack: 2, coveragePerPack: 15.5, sellPrice: 100, floorPrice: 80, taxClass: 'GST_18' } }, token,
  )).createProduct;
  const customer = (await gql(
    `mutation($input: CreateCustomerInput!) { createCustomer(input: $input) { id } }`,
    { input: { name: `Tile area customer ${suffix}`, phone: '9000000099', city: 'Ahmedabad', address: 'Tile pricing UAT', forceCreate: true } }, token,
  )).createCustomer;
  const quote = (await gql(
    `mutation($input: CreateQuoteInput!) { createQuote(input: $input) { id quoteNumber lines } }`,
    { input: { customerId: customer.id, title: 'Area priced tile quote', projectName: 'Area pricing UAT', lines: JSON.stringify([{ productId: product.id, sku: product.sku, name: product.name, category: 'Tiles', tileCode: product.internalCode, tileSize: '600 x 1200 mm', requestedArea: 100, wastagePercent: 10, qty: 1, unit: 'BOX', pricingUom: 'SQFT', coveragePerPack: 15.5, piecesPerPack: 2, listPrice: 100, price: 100, taxRate: 18, area: 'Living Room' }]) } }, token,
  )).createQuote;
  const line = quote.lines[0];
  assert(line.qty === 8 && line.inventoryQuantity === 8, '100 sq ft plus 10% wastage must require 8 whole boxes');
  assert(line.pricingQuantity === 124 && line.coveredArea === 124, 'Eight boxes must bill the actual 124 sq ft coverage');
  assert(line.rateBasis === 'AREA' && line.pricingUom === 'SQFT' && line.unit === 'BOX', 'Quote must distinguish rate UOM from inventory UOM');
  assert(Number(line.taxableValue) === 12400 && Number(line.taxAmount) === 2232 && Number(line.grossLineTotal) === 14632, 'Full quote value must use covered area and GST');

  const fulfillment = (await gql(`query($quoteId: ID!) { quoteFulfillment(quoteId: $quoteId) }`, { quoteId: quote.id }, token)).quoteFulfillment;
  const order = (await gql(
    `mutation($input: CreateSalesOrderInput!) { createSalesOrderFromQuote(input: $input) }`,
    { input: { quoteId: quote.id, paymentMode: 'credit', paymentTerms: 'Net 30', idempotencyKey: `TILE-AREA-${suffix}`, lines: JSON.stringify([{ quoteLineId: fulfillment.lines[0].id, quantity: 3 }]) } }, token,
  )).createSalesOrderFromQuote;
  assert(Number(order.totalAmount) === 5487, 'Three-box partial order must price 46.5 sq ft plus GST');
  const [orderLine, reservation] = await Promise.all([
    prisma.salesOrderLine.findFirst({ where: { salesOrderId: order.id } }),
    prisma.reservation.findFirst({ where: { salesOrderId: order.id } }),
  ]);
  assert(orderLine?.orderedQuantity === 3 && reservation?.quantity === 3, 'Fulfilment must reserve three physical boxes, not square feet');
  assert(Number(orderLine?.metadata?.snapshot?.pricingQuantity || 0) === 46.5, 'Sales order snapshot must retain the partial pricing quantity');

  console.log(JSON.stringify({ ok: true, sku: product.sku, internalCode: product.internalCode, quoteNumber: quote.quoteNumber, fullQuote: { boxes: line.qty, pricedArea: line.pricingQuantity, total: line.grossLineTotal }, partialOrder: { orderNumber: order.orderNumber, boxes: orderLine.orderedQuantity, pricedArea: orderLine.metadata.snapshot.pricingQuantity, total: order.totalAmount } }, null, 2));
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
