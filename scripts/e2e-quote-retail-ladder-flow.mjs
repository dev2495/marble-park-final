import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { cleanupE2eRecords } from './lib/cleanup-e2e-records.mjs';

if (process.env.ALLOW_MUTATING_ACCEPTANCE !== 'true') {
  throw new Error('Refusing to mutate data. Run only against an isolated acceptance database with ALLOW_MUTATING_ACCEPTANCE=true.');
}

const API = process.env.API_URL || 'http://127.0.0.1:4100/graphql';
const WEB = process.env.WEB_URL || 'http://127.0.0.1:3100';
const TEST_EMAIL = process.env.TEST_EMAIL || 'acceptance.quote@marblepark.test';
const TEST_PASSWORD = process.env.TEST_PASSWORD || '';
const prisma = new PrismaClient();
const cleanup = { productIds: [], customerIds: [], quoteIds: [], leadIds: [], orderIds: [] };
let createdLocationId = null;
let createdRestrictedUserId = null;

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const close = (actual, expected, message) => assert(Math.abs(Number(actual) - Number(expected)) <= 0.02, `${message}: expected ${expected}, received ${actual}`);

async function gql(query, variables = {}, token) {
  const response = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json();
  if (!response.ok || payload.errors?.length) throw new Error(payload.errors?.map((row) => row.message).join('; ') || `GraphQL ${response.status}`);
  return payload.data;
}

async function main() {
  assert(TEST_PASSWORD, 'TEST_PASSWORD is required for the isolated acceptance identity');
  const token = (await gql('mutation($input:LoginInput!){login(input:$input){token user{id role}}}', { input: { email: TEST_EMAIL, password: TEST_PASSWORD } })).login.token;
  assert(token, 'Acceptance login must return a token');
  const suffix = Date.now().toString(36).toUpperCase();
  const createProduct = async (sku, name, defaultMrpInclusive, defaultNrpInclusive) => (await gql(
    'mutation($input:CreateProductInput!){createProduct(input:$input){id sku name category brand finish unit defaultMrpInclusive defaultNrpInclusive priceRateBasis priceUom}}',
    { input: { sku, internalCode: sku, name, category: 'Sanitaryware', brand: 'Quote Acceptance', finish: 'White', unit: 'PC', defaultMrpInclusive, defaultNrpInclusive, priceRateBasis: 'PIECE', priceUom: 'PC', mrpSource: 'MANUAL', pricingEffectiveFrom: new Date().toISOString(), taxClass: 'GST_18' } }, token,
  )).createProduct;
  const [firstProduct, secondProduct] = await Promise.all([
    createProduct(`QUOTE-LADDER-A-${suffix}`, 'Retail ladder percent fixture', 1000, 900),
    createProduct(`QUOTE-LADDER-B-${suffix}`, 'Retail ladder amount fixture', 800, 720),
  ]);
  cleanup.productIds.push(firstProduct.id, secondProduct.id);
  let location = await prisma.stockLocation.findFirst({ where: { status: 'active' }, orderBy: { createdAt: 'asc' } });
  if (!location) {
    createdLocationId = randomUUID();
    location = await prisma.stockLocation.create({ data: { id: createdLocationId, code: `UAT-${suffix}`, name: 'Isolated pricing acceptance', type: 'warehouse', status: 'active', updatedAt: new Date() } });
  }
  await gql(
    'mutation($input:ManualGoodsReceiptInput!){createManualGoodsReceipt(input:$input)}',
    { input: { vendorName: 'Quote acceptance vendor', locationId: location.id, idempotencyKey: `QUOTE-LADDER-GRN-${suffix}`, lines: JSON.stringify([{ productId: firstProduct.id, receivedQuantity: 3, unitCost: 700 }]) } },
    token,
  );
  const restrictedEmail = `pricing-cost-rbac-${suffix.toLowerCase()}@example.test`;
  const restrictedPassword = `PricingRbac-${suffix}!`;
  const restrictedUser = (await gql(
    'mutation($input:CreateUserInput!){createUser(input:$input){id email role effectivePermissions}}',
    { input: { name: `Pricing cost RBAC ${suffix}`, email: restrictedEmail, phone: '9000000082', password: restrictedPassword, role: 'inventory_manager', permissionOverrides: {} } }, token,
  )).createUser;
  createdRestrictedUserId = restrictedUser.id;
  const restrictedToken = (await gql('mutation($input:LoginInput!){login(input:$input){token}}', { input: { email: restrictedEmail, password: restrictedPassword } })).login.token;
  const restrictedInventory = await gql(
    'query($productId:String!,$search:String){inventoryLots(productId:$productId,search:$search,take:20) goodsReceiptPage(search:$search,take:20,skip:0)}',
    { productId: firstProduct.id, search: firstProduct.sku }, restrictedToken,
  );
  assert(!/unitCost|effectiveUnitCost|grandTotal|taxableValue|taxAmount/.test(JSON.stringify(restrictedInventory)), 'Non-owner inventory and GRN responses must redact purchase and lot cost');
  let restrictedCostEntryBlocked = false;
  try {
    await gql(
      'mutation($input:ManualGoodsReceiptInput!){createManualGoodsReceipt(input:$input)}',
      { input: { vendorName: 'Blocked cost fixture', locationId: location.id, idempotencyKey: `QUOTE-LADDER-RBAC-${suffix}`, lines: JSON.stringify([{ productId: firstProduct.id, receivedQuantity: 1, unitCost: 701 }]) } }, restrictedToken,
    );
  } catch (error) {
    restrictedCostEntryBlocked = /Only an owner or administrator may enter or change purchase and lot cost/i.test(String(error?.message || error));
  }
  assert(restrictedCostEntryBlocked, 'Non-owner cost entry must be rejected by the API, not merely hidden in the UI');
  const customer = (await gql(
    'mutation($input:CreateCustomerInput!){createCustomer(input:$input){id name}}',
    { input: { name: `Quote ladder customer ${suffix}`, phone: '9000000081', email: `quote-ladder-${suffix.toLowerCase()}@example.test`, city: 'Vapi', address: 'Isolated acceptance only', forceCreate: true } }, token,
  )).createCustomer;
  cleanup.customerIds.push(customer.id);

  const quoteMeta = { taxMode: 'gst', pricingVersion: 'unified_retail_v1', quoteDiscount: { mode: 'FIXED_AMOUNT', value: 241 } };
  const quote = (await gql(
    'mutation($input:CreateQuoteInput!){createQuote(input:$input){id quoteNumber leadId status discountPercent lines quoteMeta approval}}',
    { input: {
      customerId: customer.id,
      title: `Retail ladder acceptance ${suffix}`,
      projectName: 'Quote pricing release gate',
      quoteMeta: JSON.stringify(quoteMeta),
      lines: JSON.stringify([
        { productId: firstProduct.id, sku: firstProduct.sku, name: firstProduct.name, category: firstProduct.category, brand: firstProduct.brand, finish: firstProduct.finish, qty: 2, quantity: 2, pricingQuantity: 2, unit: 'PC', inventoryUom: 'PC', pricingUom: 'PC', rateBasis: 'PIECE', priceRateBasis: 'PIECE', mrpInclusive: 1000, pricingVersion: 'unified_retail_v1', nrpMode: 'PERCENT_OFF_MRP', nrpInput: 10, specialMode: 'PERCENT_OFF_NRP', specialInput: 5, taxRate: 18, area: 'Master Bathroom' },
        { productId: secondProduct.id, sku: secondProduct.sku, name: secondProduct.name, category: secondProduct.category, brand: secondProduct.brand, finish: secondProduct.finish, qty: 1, quantity: 1, pricingQuantity: 1, unit: 'PC', inventoryUom: 'PC', pricingUom: 'PC', rateBasis: 'PIECE', priceRateBasis: 'PIECE', mrpInclusive: 800, pricingVersion: 'unified_retail_v1', nrpMode: 'FIXED_NRP', nrpInput: 720, specialMode: 'FIXED_SPECIAL_RATE', specialInput: 700, taxRate: 18, area: 'Powder Room' },
      ]),
    } }, token,
  )).createQuote;
  cleanup.quoteIds.push(quote.id);
  if (quote.leadId) cleanup.leadIds.push(quote.leadId);
  assert(quote.status === 'draft', 'A pricing-ready quote must save as draft, not incomplete pricing');
  close(quote.lines[0].nrpInclusive, 900, 'Percent line NRP');
  close(quote.lines[0].specialRateInclusive, 855, 'Percent line special rate');
  close(quote.lines[1].nrpInclusive, 720, 'Fixed line NRP');
  close(quote.lines[1].specialRateInclusive, 700, 'Fixed line special rate');
  close(quote.approval.pricing.quoteDiscountAmount, 241, 'Whole-quote rupee discount');
  close(quote.approval.pricing.grandTotal, 2169, 'Quote grand total');
  close(quote.lines.reduce((sum, line) => sum + Number(line.grossLineTotal), 0), 2169, 'Saved line reconciliation');

  const register = (await gql(
    'query($search:String,$status:String,$dateFrom:DateTime,$dateTo:DateTime,$sort:String,$take:Float,$skip:Float){quotePage(search:$search,status:$status,dateFrom:$dateFrom,dateTo:$dateTo,sort:$sort,take:$take,skip:$skip)}',
    { search: suffix, status: 'draft', dateFrom: new Date(Date.now() - 86400000).toISOString(), dateTo: new Date(Date.now() + 86400000).toISOString(), sort: 'value_desc', take: 10, skip: 0 }, token,
  )).quotePage;
  assert(register.total === 1 && register.rows[0].id === quote.id, 'Server-paged register search must return the created quote');
  close(register.filteredValue, 2169, 'Register filtered aggregate');
  close(register.rows[0].commercialTotal, 2169, 'Register materialized commercial total');
  close(register.rows[0].commercial.grandTotal, 2169, 'Register displayed snapshot total');

  const pdfResponse = await fetch(`${WEB}/api/pdf/quote/${quote.id}`, { headers: { authorization: `Bearer ${token}` } });
  const pdf = Buffer.from(await pdfResponse.arrayBuffer());
  assert(pdfResponse.ok && (pdfResponse.headers.get('content-type') || '').includes('application/pdf'), `Quote PDF must render (${pdfResponse.status})`);
  assert(pdf.subarray(0, 4).toString() === '%PDF' && pdf.length > 7000, 'Quote PDF must be a substantive PDF');
  if (process.env.PDF_OUTPUT) await writeFile(process.env.PDF_OUTPUT, pdf);

  const fulfillment = (await gql('query($id:ID!){quoteFulfillment(quoteId:$id)}', { id: quote.id }, token)).quoteFulfillment;
  const firstLine = fulfillment.lines.find((line) => line.sku === firstProduct.sku);
  assert(firstLine?.remaining === 2, 'Quote fulfilment must expose the two remaining units');
  const order = (await gql(
    'mutation($input:CreateSalesOrderInput!){createSalesOrderFromQuote(input:$input)}',
    { input: { quoteId: quote.id, paymentMode: 'credit', paymentTerms: 'Net 30', idempotencyKey: `QUOTE-LADDER-${suffix}`, lines: JSON.stringify([{ quoteLineId: firstLine.id, quantity: 1 }]) } }, token,
  )).createSalesOrderFromQuote;
  cleanup.orderIds.push(order.id);
  close(order.totalAmount, 769.5, 'Partial Sales Order proportional payable');
  const orderLine = await prisma.salesOrderLine.findFirst({ where: { salesOrderId: order.id } });
  close(orderLine?.lineTotal, 769.5, 'Sales Order line snapshot total');
  assert(Number(orderLine?.orderedQuantity) === 1, 'Partial conversion must order one physical unit');
  assert(orderLine?.pricingVersion === 'unified_retail_v1', 'Sales Order must preserve the canonical pricing version');
  close(orderLine?.mrpInclusive, 1000, 'Sales Order MRP snapshot');
  close(orderLine?.nrpInclusive, 900, 'Sales Order NRP snapshot');
  close(orderLine?.specialRateInclusive, 855, 'Sales Order special-rate snapshot');
  close(orderLine?.quoteDiscountAllocatedInclusive, 85.5, 'Sales Order proportional quote-discount snapshot');
  assert(orderLine?.costSnapshot == null, 'Sales Order must not invent a Product Master cost before physical lot allocation');
  const sourceQuoteLine = await prisma.quoteLine.findUnique({ where: { id: firstLine.id } });
  assert(Number(sourceQuoteLine?.orderedQuantity) === 1 && Number(sourceQuoteLine?.quantity) === 2, 'Quote line must retain one ordered and one remaining unit');

  const job = await prisma.dispatchJob.findUnique({ where: { salesOrderId: order.id } });
  assert(job?.id, 'Partial Sales Order must create its own dispatch job');
  const pick = (await gql(
    'mutation($input:CreatePickListInput!){createPickList(input:$input)}',
    { input: { salesOrderId: order.id, locationId: location.id, notes: 'Unified pricing lifecycle acceptance' } }, token,
  )).createPickList;
  assert(pick.lines?.length === 1 && Number(pick.lines[0].requestedQuantity) === 1, 'Pick list must allocate exactly the converted quantity');
  const pickLine = pick.lines[0];
  await gql('mutation($id:ID!,$action:String!,$input:PickListTransitionInput){transitionPickList(id:$id,action:$action,input:$input)}', { id: pick.id, action: 'start', input: {} }, token);
  await gql('mutation($id:ID!,$action:String!,$input:PickListTransitionInput){transitionPickList(id:$id,action:$action,input:$input)}', { id: pick.id, action: 'pick', input: { lines: JSON.stringify([{ pickLineId: pickLine.id, pickedQuantity: 1 }]) } }, token);
  await gql('mutation($id:ID!,$action:String!,$input:PickListTransitionInput){transitionPickList(id:$id,action:$action,input:$input)}', { id: pick.id, action: 'pack', input: { lines: JSON.stringify([{ pickLineId: pickLine.id, packedQuantity: 1 }]) } }, token);
  await gql('mutation($id:ID!,$action:String!,$input:PickListTransitionInput){transitionPickList(id:$id,action:$action,input:$input)}', { id: pick.id, action: 'complete', input: {} }, token);
  const challan = (await gql(
    'mutation($input:CreateChallanInput!){createChallan(input:$input){id challanNumber status}}',
    { input: { jobId: job.id, salesOrderId: order.id, pickListId: pick.id, transporter: 'Acceptance vehicle', vehicleNo: 'GJ-15-UAT', driverName: 'Pricing Gate', driverPhone: '9000000081', packages: 1 } }, token,
  )).createChallan;
  await gql('mutation($id:ID!,$status:String!){updateChallanStatus(id:$id,status:$status){id status}}', { id: challan.id, status: 'dispatched' }, token);
  const dispatchLine = await prisma.dispatchLine.findFirst({ where: { challanId: challan.id } });
  assert(dispatchLine?.id && Number(dispatchLine.dispatchedQuantity) === 1, 'Dispatch must consume exactly one allocated unit');
  const invoice = (await gql(
    'mutation($input:IssueSalesInvoiceInput!){issueSalesInvoice(input:$input)}',
    { input: { salesOrderId: order.id, dispatchLineIds: [dispatchLine.id], notes: 'Unified pricing lifecycle acceptance', idempotencyKey: `QUOTE-LADDER-INV-${suffix}` } }, token,
  )).issueSalesInvoice;
  close(invoice.totalAmount, 769.5, 'Invoice total must equal the immutable order snapshot');
  const invoiceLine = await prisma.salesInvoiceLine.findFirst({ where: { salesInvoiceId: invoice.id } });
  assert(invoiceLine?.pricingVersion === 'unified_retail_v1', 'Invoice line must preserve the canonical pricing version');
  close(invoiceLine?.mrpInclusive, 1000, 'Invoice MRP snapshot');
  close(invoiceLine?.nrpInclusive, 900, 'Invoice NRP snapshot');
  close(invoiceLine?.specialRateInclusive, 855, 'Invoice special-rate snapshot');
  close(invoiceLine?.quoteDiscountAllocatedInclusive, 85.5, 'Invoice quote-discount allocation');
  close(invoiceLine?.grossLineTotal, 769.5, 'Invoice gross snapshot');
  close(invoiceLine?.costSnapshot, 700, 'Invoice actual lot-cost snapshot');
  assert(invoiceLine?.costSnapshotSource === 'InventoryLot.unitCost' && invoiceLine?.costSnapshotAt, 'Invoice cost must come only from the allocated physical lot');

  const invoicePdfResponse = await fetch(`${WEB}/api/pdf/invoice/${invoice.id}`, { headers: { authorization: `Bearer ${token}` } });
  const invoicePdf = Buffer.from(await invoicePdfResponse.arrayBuffer());
  assert(invoicePdfResponse.ok && invoicePdf.subarray(0, 4).toString() === '%PDF' && invoicePdf.length > 5000, 'Invoice PDF must render from the same snapshots');
  const delivery = (await gql(
    'mutation($id:ID!,$input:ConfirmDeliveryInput!){confirmDelivery(id:$id,input:$input)}',
    { id: challan.id, input: { receivedByName: 'Pricing Acceptance Customer', receivedByPhone: '9000000081', proofType: 'otp', notes: 'Isolated lifecycle acceptance' } }, token,
  )).confirmDelivery;
  assert(delivery.status === 'delivered', 'Return source must be a delivery with governed recipient proof');
  const returned = (await gql(
    'mutation($input:ReturnOrderInput!){createReturnOrder(input:$input)}',
    { input: { salesOrderId: order.id, challanId: challan.id, customerId: customer.id, locationId: location.id, reason: 'Unified pricing lifecycle acceptance return', receive: true, lines: JSON.stringify([{ dispatchLineId: dispatchLine.id, quantity: 1, disposition: 'resell' }]), metadata: { acceptance: true } } }, token,
  )).createReturnOrder;
  assert(returned.status === 'received', 'Return must post through the governed received lifecycle');
  const returnLine = await prisma.returnLine.findFirst({ where: { returnOrderId: returned.id } });
  assert(returnLine?.pricingVersion === 'unified_retail_v1', 'Return must preserve the original canonical pricing version');
  close(returnLine?.mrpInclusive, 1000, 'Return MRP snapshot');
  close(returnLine?.nrpInclusive, 900, 'Return NRP snapshot');
  close(returnLine?.specialRateInclusive, 855, 'Return special-rate snapshot');
  close(returnLine?.quoteDiscountAllocatedInclusive, 85.5, 'Return quote-discount allocation');
  close(returnLine?.grossLineTotal, 769.5, 'Return refund-value snapshot');
  close(returnLine?.costSnapshot, 700, 'Return physical lot-cost snapshot');
  const balance = await prisma.inventoryBalance.findUnique({ where: { productId: firstProduct.id } });
  assert(Number(balance?.onHand) === 3 && Number(balance?.available) === 3 && Number(balance?.reserved) === 0, 'GRN, reservation, dispatch and resell return must reconcile to the original stock');

  console.log(JSON.stringify({ ok: true, quoteNumber: quote.quoteNumber, grandTotal: quote.approval.pricing.grandTotal, registerTotal: register.rows[0].commercial.grandTotal, pdfBytes: pdf.length, partialOrder: { orderNumber: order.orderNumber, quantity: orderLine.orderedQuantity, total: order.totalAmount }, invoice: { invoiceNumber: invoice.invoiceNumber, total: invoice.totalAmount, costSource: invoiceLine.costSnapshotSource }, return: { returnNumber: returned.returnNumber, total: returnLine.grossLineTotal }, stockReconciled: true, costRbac: { responseRedacted: true, writeBlocked: restrictedCostEntryBlocked } }, null, 2));
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; }).finally(async () => {
  if (process.env.KEEP_E2E_RECORDS !== '1') await cleanupE2eRecords(prisma, cleanup);
  if (createdRestrictedUserId && process.env.KEEP_E2E_RECORDS !== '1') {
    await prisma.session.deleteMany({ where: { userId: createdRestrictedUserId } }).catch(() => null);
    await prisma.reportPreset.deleteMany({ where: { ownerId: createdRestrictedUserId } }).catch(() => null);
    await prisma.user.deleteMany({ where: { id: createdRestrictedUserId } }).catch(() => null);
  }
  if (createdLocationId && process.env.KEEP_E2E_RECORDS !== '1') await prisma.stockLocation.deleteMany({ where: { id: createdLocationId } }).catch(() => null);
  await prisma.$disconnect();
});
