import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { ulid } from 'ulid';

if (process.env.ALLOW_MUTATING_ACCEPTANCE !== 'true') {
  throw new Error('Refusing to mutate data. Run only against an isolated acceptance database with ALLOW_MUTATING_ACCEPTANCE=true.');
}

const prisma = new PrismaClient();
const API = process.env.API_URL || 'http://127.0.0.1:4100/graphql';
const stamp = Date.now().toString(36).toUpperCase();
const email = `po-cost-${stamp.toLowerCase()}@example.invalid`;
const password = `PO-${stamp}-Strong!42`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function close(actual, expected, message, tolerance = 0.0001) {
  assert(Math.abs(Number(actual) - Number(expected)) <= tolerance, `${message}: expected ${expected}, received ${actual}`);
}

async function gql(query, variables = {}, token = '', expectError = false) {
  const response = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  const json = await response.json();
  const error = json.errors?.map((entry) => entry.message).join('; ') || '';
  if (expectError) return error;
  if (!response.ok || error) throw new Error(error || `GraphQL ${response.status}`);
  return json.data;
}

async function main() {
  const actorId = ulid();
  const productId = ulid();
  const vendorId = ulid();
  const locationId = ulid();
  await prisma.user.create({ data: {
    id: actorId, name: 'PO Cost Contract Owner', email, passwordHash: await bcrypt.hash(password, 12),
    role: 'owner', phone: '', active: true, permissionOverrides: {}, passwordChangedAt: new Date(),
  } });
  await prisma.vendor.create({ data: { id: vendorId, name: `Contract Supplier ${stamp}`, status: 'active', updatedAt: new Date() } });
  await prisma.stockLocation.create({ data: { id: locationId, code: `COST-${stamp}`, name: 'PO cost contract location', type: 'godown', status: 'active', updatedAt: new Date() } });
  await prisma.product.create({ data: {
    id: productId, sku: `COST-${stamp}`, internalCode: `SHOW-${stamp}`, name: 'Cost contract tile', category: 'Tiles', brand: 'Contract', finish: 'Matt', dimensions: '600 x 600 mm', unit: 'PC',
    baseUom: 'PC', purchaseUom: 'BOX', salesUom: 'BOX', piecesPerPack: 4, allowLoose: true,
    sellPrice: 0, floorPrice: 0, costPrice: 0, defaultMrpInclusive: 250, defaultNrpInclusive: 225, floorPriceInclusive: 200,
    priceRateBasis: 'AREA', priceUom: 'SQFT', taxClass: 'GST_18', status: 'active', tags: [], media: {}, sourceRefs: {}, description: '', updatedAt: new Date(),
  } });

  const delegatedBuyerId = ulid();
  const delegatedBuyerEmail = `po-buyer-${stamp.toLowerCase()}@example.invalid`;
  await prisma.user.create({ data: {
    id: delegatedBuyerId, name: 'Delegated PO Buyer', email: delegatedBuyerEmail, passwordHash: await bcrypt.hash(password, 12),
    role: 'sales', phone: '', active: true, permissionOverrides: { 'procurement.manage': true }, passwordChangedAt: new Date(),
  } });

  const token = (await gql('mutation($input:LoginInput!){login(input:$input){token}}', { input: { email, password } })).login.token;
  assert(token, 'Owner login failed');

  const delegatedBuyerToken = (await gql(
    'mutation($input:LoginInput!){login(input:$input){token user{role}}}',
    { input: { email: delegatedBuyerEmail, password } },
  )).login;
  assert(delegatedBuyerToken.user.role === 'sales', 'Delegated buyer role changed unexpectedly');
  const delegatedPo = (await gql(
    'mutation($input:CreatePurchaseOrderInput!){createPurchaseOrder(input:$input)}',
    { input: {
      vendorId, vendorName: `Contract Supplier ${stamp}`, discountPercent: 0, taxRate: 0,
      lines: JSON.stringify([{ productId, boxes: 1, loosePieces: 0, enteredUnitCost: 400, rateUom: 'BOX' }]),
    } },
    delegatedBuyerToken.token,
  )).createPurchaseOrder;
  assert(delegatedPo?.id && delegatedPo.createdBy === delegatedBuyerId, 'procurement.manage override did not create a traceable PO');
  close(delegatedPo.lines[0].unitCost, 100, 'Delegated PO supplier rate did not normalize');

  const zeroRateError = await gql(
    'mutation($input:CreatePurchaseOrderInput!){createPurchaseOrder(input:$input)}',
    { input: { vendorId, vendorName: `Contract Supplier ${stamp}`, lines: JSON.stringify([{ productId, boxes: 1, enteredUnitCost: 0, rateUom: 'BOX' }]) } },
    token,
    true,
  );
  assert(/greater than zero/i.test(zeroRateError), `Zero-rate PO was not blocked: ${zeroRateError}`);

  const created = (await gql(
    'mutation($input:CreatePurchaseOrderInput!){createPurchaseOrder(input:$input)}',
    { input: {
      vendorId, vendorName: `Contract Supplier ${stamp}`, discountPercent: 10, taxRate: 0,
      lines: JSON.stringify([{ productId, boxes: 2, loosePieces: 0, enteredUnitCost: 400, rateUom: 'BOX' }]),
    } },
    token,
  )).createPurchaseOrder;
  assert(created?.id && created.lines?.length === 1, 'PO was not created');
  const poLine = created.lines[0];
  close(poLine.orderedQuantity, 8, 'BOX quantity was not normalized to PC');
  close(poLine.enteredUnitCost, 400, 'Supplier-entered BOX rate was not preserved');
  assert(poLine.rateUom === 'BOX', 'Supplier rate UOM was not preserved');
  close(poLine.rateUomFactor, 4, 'Packing conversion factor is wrong');
  close(poLine.unitCost, 100, 'Base PC cost is wrong');
  close(poLine.netUnitCost, 90, 'Discounted pre-tax PC cost is wrong');
  close(created.subtotal, 800, 'PO subtotal is wrong');
  close(created.discountAmount, 80, 'PO discount is wrong');
  close(created.taxAmount, 0, 'No-GST PO has tax');
  close(created.grandTotal, 720, 'No-GST PO total is wrong');

  const overrideError = await gql(
    'mutation($input:ReceivePurchaseOrderInput!){receivePurchaseOrder(input:$input)}',
    { input: { purchaseOrderId: created.id, locationId, lines: JSON.stringify([{ purchaseOrderLineId: poLine.id, boxes: 1, unitCost: 1 }]) } },
    token,
    true,
  );
  assert(/locked|cost/i.test(overrideError), `PO receipt accepted a cost override: ${overrideError}`);

  const receipt = (await gql(
    'mutation($input:ReceivePurchaseOrderInput!){receivePurchaseOrder(input:$input)}',
    { input: { purchaseOrderId: created.id, locationId, supplierBill: `BILL-${stamp}`, lines: JSON.stringify([{ purchaseOrderLineId: poLine.id, boxes: 1, loosePieces: 0 }]) } },
    token,
  )).receivePurchaseOrder;
  assert(receipt?.id && receipt.lines?.length === 1, 'PO GRN was not posted');
  close(receipt.lines[0].receivedQuantity, 4, 'PO GRN quantity normalization is wrong');
  close(receipt.lines[0].unitCost, 90, 'PO GRN did not inherit the discounted pre-tax PO cost');
  const lot = await prisma.inventoryLot.findUnique({ where: { id: receipt.lines[0].lotId } });
  close(lot?.unitCost, 90, 'Inventory lot did not preserve the PO net pre-tax cost snapshot');
  assert(lot?.metadata?.costSource === 'purchase_order_net_snapshot', 'Inventory lot cost provenance is wrong');

  const manual = (await gql(
    'mutation($input:ManualGoodsReceiptInput!){createManualGoodsReceipt(input:$input)}',
    { input: { vendorId, vendorName: `Contract Supplier ${stamp}`, locationId, reason: 'Isolated cost contract acceptance', lines: JSON.stringify([{ productId, boxes: 1, loosePieces: 0, enteredUnitCost: 440, rateUom: 'BOX' }]) } },
    token,
  )).createManualGoodsReceipt;
  close(manual.lines[0].unitCost, 110, 'Manual GRN supplier BOX rate was not normalized to base PC cost');

  const legacyPoId = ulid();
  const legacyLineId = ulid();
  await prisma.purchaseOrder.create({ data: {
    id: legacyPoId, poNumber: `LEGACY/${stamp}`, vendorId, vendorName: `Contract Supplier ${stamp}`, status: 'ordered', createdBy: actorId,
    discountPercent: 5, taxRate: 18, subtotal: 0, discountAmount: 0, taxableValue: 0, taxAmount: 0, grandTotal: 0, metadata: {}, updatedAt: new Date(),
  } });
  await prisma.purchaseOrderLine.create({ data: {
    id: legacyLineId, purchaseOrderId: legacyPoId, productId, sku: `COST-${stamp}`, name: 'Legacy missing-rate line', category: 'Tiles', brand: 'Contract', finish: 'Matt', unit: 'PC',
    orderedQuantity: 4, enteredUnitCost: 0, rateUom: 'PC', rateUomFactor: 1, unitCost: 0, netUnitCost: 0, costStatus: 'missing', status: 'ordered', metadata: {}, updatedAt: new Date(),
  } });
  const readiness = (await gql('query($search:String){purchaseOrderCostReadinessPage(search:$search,take:20)}', { search: `LEGACY/${stamp}` }, token)).purchaseOrderCostReadinessPage;
  assert(readiness.total === 1 && readiness.items[0].missingLineCount === 1, 'Legacy missing-rate PO did not appear in the remediation queue');
  const completed = (await gql(
    'mutation($input:CompletePurchaseOrderCostsInput!){completePurchaseOrderCosts(input:$input)}',
    { input: { purchaseOrderId: legacyPoId, reason: 'Verified supplier document for isolated acceptance', lines: JSON.stringify([{ purchaseOrderLineId: legacyLineId, enteredUnitCost: 400, rateUom: 'BOX' }]) } },
    token,
  )).completePurchaseOrderCosts;
  close(completed.lines[0].unitCost, 100, 'Legacy rate normalization is wrong');
  close(completed.lines[0].netUnitCost, 95, 'Legacy PO discount was not applied to inventory cost');
  close(completed.taxAmount, 68.4, 'Legacy PO optional GST total is wrong');
  assert(await prisma.auditEvent.count({ where: { action: 'purchase_order.cost_complete', entityId: legacyPoId } }) === 1, 'Legacy rate completion audit is missing');

  console.log(JSON.stringify({
    ok: true,
    purchaseRate: '400 / BOX',
    packing: '4 PC / BOX',
    poDiscount: '10%',
    optionalGst: '0% and 18% verified',
    inventoryCost: '90 / PC net pre-tax snapshot',
    manualGrnCost: '110 / PC from 440 / BOX',
    legacyReadiness: 'paged, actionable, audited',
  }, null, 2));
}

main().finally(async () => prisma.$disconnect());
