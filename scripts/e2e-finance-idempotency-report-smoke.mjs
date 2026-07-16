import { PrismaClient } from '@prisma/client';

const API = process.env.API_URL || 'http://localhost:4100/graphql';
const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@marblepark.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'password123';
const prisma = new PrismaClient();
const assert = (value, message) => { if (!value) throw new Error(message); };
const key = (prefix) => `${prefix}-${Date.now().toString(36).toUpperCase()}`;

async function gql(query, variables = {}, token) {
  const response = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ query, variables }) });
  const json = await response.json();
  if (!response.ok || json.errors?.length) throw new Error(json.errors?.map((item) => item.message).join('; ') || `GraphQL ${response.status}`);
  return json.data;
}

async function main() {
  const login = await gql(`mutation($input: LoginInput!) { login(input: $input) { token } }`, { input: { email: TEST_EMAIL, password: TEST_PASSWORD } });
  const token = login.login.token;
  const data = await gql(`query { returnableDispatchLines(take: 20) stockLocations(status: "active") }`, {}, token);
  const line = data.returnableDispatchLines[0];
  const location = data.stockLocations.find((row) => row.code !== 'IN-TRANSIT');
  assert(line && location, 'A delivered returnable line and active stock location are required');
  const returnKey = key('RETURN-RETRY');
  const input = {
    salesOrderId: line.salesOrderId, challanId: line.challanId, customerId: line.challan?.customerId,
    locationId: location.id, reason: 'Financial retry release gate', refundMode: 'store_credit', refundAmount: 1,
    receive: true, idempotencyKey: returnKey,
    lines: JSON.stringify([{ dispatchLineId: line.id, productId: line.productId, sku: line.sku, name: line.name, quantity: 1, disposition: 'resell' }]),
  };
  const mutation = `mutation($input: ReturnOrderInput!) { createReturnOrder(input: $input) }`;
  const firstReturn = (await gql(mutation, { input }, token)).createReturnOrder;
  const retriedReturn = (await gql(mutation, { input }, token)).createReturnOrder;
  assert(firstReturn.id === retriedReturn.id, 'A retried received return must return the original document');
  const [returnCount, creditNotes, returnLines] = await Promise.all([
    prisma.returnOrder.count({ where: { idempotencyKey: returnKey } }),
    prisma.creditNote.findMany({ where: { returnOrderId: firstReturn.id } }),
    prisma.returnLine.findMany({ where: { returnOrderId: firstReturn.id } }),
  ]);
  assert(returnCount === 1 && creditNotes.length === 1 && returnLines.length === 1, 'Return retry must create one return, one stock posting line, and one credit note');

  const product = await prisma.product.findUnique({ where: { id: line.productId } });
  const grnKey = key('GRN-RETRY');
  const grnInput = { vendorName: 'Release Gate Vendor', locationId: location.id, idempotencyKey: grnKey, reason: 'Retry gate', lines: JSON.stringify([{ productId: product.id, quantity: 1, receivedQuantity: 1, damagedQuantity: 0, unitCost: 10 }]) };
  const grnMutation = `mutation($input: ManualGoodsReceiptInput!) { createManualGoodsReceipt(input: $input) }`;
  const firstGrn = (await gql(grnMutation, { input: grnInput }, token)).createManualGoodsReceipt;
  const retriedGrn = (await gql(grnMutation, { input: grnInput }, token)).createManualGoodsReceipt;
  assert(firstGrn.id === retriedGrn.id, 'A retried GRN must return the original document');
  assert(await prisma.goodsReceiptNote.count({ where: { idempotencyKey: grnKey } }) === 1, 'GRN retry must create one receipt only');

  const today = new Date().toISOString().slice(0, 10);
  const report = (await gql(`query($from: String, $to: String) { managementReport(from: $from, to: $to) }`, { from: today, to: today }, token)).managementReport;
  assert(report.finance.creditNotes >= 1 && report.inventory.quantity > 0 && Array.isArray(report.categoryStock), 'Management report must include finance and lot-valued inventory');
  console.log(JSON.stringify({ ok: true, returnNumber: firstReturn.returnNumber, creditNoteNumber: creditNotes[0].creditNoteNumber, grnNumber: firstGrn.grnNumber, report: { netSales: report.finance.netSales, stockValue: report.inventory.value, openDemand: report.procurement.backorderQuantity } }, null, 2));
}

main().finally(() => prisma.$disconnect());
