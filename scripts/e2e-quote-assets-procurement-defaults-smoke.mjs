import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { cleanupE2eRecords } from './lib/cleanup-e2e-records.mjs';

const API = process.env.API_URL || 'http://localhost:4000/graphql';
const WEB = process.env.WEB_URL || 'http://localhost:3000';
const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@marblepark.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'password123';
const REMOTE_IMAGE_URL = process.env.REMOTE_IMAGE_URL || 'https://65-1-24-110.sslip.io/brand/marble-park-logo.png';
const OUTPUT_DIR = resolve(process.env.PDF_OUTPUT_DIR || '/tmp/marble-park-release-gate');
const prisma = new PrismaClient();
const state = { productId: '', customerId: '', quoteId: '', leadId: '', poId: '', grnId: '', managedImage: '', previousSettings: null };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function gql(query, variables = {}, token) {
  const response = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json();
  if (!response.ok || payload.errors?.length) {
    throw new Error(payload.errors?.map((error) => error.message).join('; ') || `GraphQL request failed (${response.status})`);
  }
  return payload.data;
}

function asLines(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return []; }
  }
  return [];
}

function absoluteAssetUrl(value) {
  return /^https?:\/\//i.test(String(value || '')) ? String(value) : new URL(String(value || ''), WEB).href;
}

function retrievableAssetUrl(value) {
  if (/^https?:\/\//i.test(String(value || ''))) return String(value);
  const pathname = String(value || '');
  return new URL(pathname, pathname.startsWith('/catalogue-images/') ? new URL(API).origin : WEB).href;
}

async function expectPdf(url, token, disposition) {
  const response = await fetch(url, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  assert(response.ok, `PDF request failed (${response.status}) for ${url}`);
  assert(response.headers.get('content-type')?.includes('application/pdf'), `PDF route returned ${response.headers.get('content-type') || 'no content type'}`);
  assert(response.headers.get('content-disposition')?.startsWith(disposition), `Expected ${disposition} content disposition for ${url}`);
  const content = Buffer.from(await response.arrayBuffer());
  assert(content.subarray(0, 4).toString() === '%PDF' && content.length > 8_000, `PDF payload is empty or invalid for ${url}`);
  return content;
}

async function cleanup() {
  if (process.env.KEEP_E2E_RECORDS === '1') return;
  if (state.previousSettings?.id) {
    await prisma.appSetting.update({
      where: { id: state.previousSettings.id },
      data: {
        quoteBrandSelectionMode: state.previousSettings.quoteBrandSelectionMode,
        quoteBrandIds: state.previousSettings.quoteBrandIds,
        updatedAt: state.previousSettings.updatedAt,
      },
    }).catch(() => null);
  }

  await cleanupE2eRecords(prisma, {
    customerIds: [state.customerId],
    quoteIds: [state.quoteId],
    leadIds: [state.leadId],
  });

  const lotIds = state.grnId
    ? (await prisma.inventoryLot.findMany({ where: { sourceId: state.grnId }, select: { id: true } }).catch(() => [])).map((row) => row.id)
    : [];
  await prisma.$transaction(async (tx) => {
    if (state.productId) {
      await tx.inventoryLotLedgerEntry.deleteMany({ where: { productId: state.productId } });
      await tx.stockLedgerEntry.deleteMany({ where: { productId: state.productId } });
      await tx.stockBalanceByLocation.deleteMany({ where: { productId: state.productId } });
    }
    if (lotIds.length) await tx.inventoryLotBalance.deleteMany({ where: { lotId: { in: lotIds } } });
    if (state.grnId) await tx.goodsReceiptLine.deleteMany({ where: { goodsReceiptNoteId: state.grnId } });
    if (lotIds.length) await tx.inventoryLot.deleteMany({ where: { id: { in: lotIds } } });
    if (state.grnId) await tx.goodsReceiptNote.deleteMany({ where: { id: state.grnId } });
    if (state.poId) await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: state.poId } });
    if (state.poId) await tx.purchaseOrder.deleteMany({ where: { id: state.poId } });
    if (state.productId) {
      await tx.inventoryBalance.deleteMany({ where: { productId: state.productId } });
      await tx.productAlias.deleteMany({ where: { productId: state.productId } });
      await tx.notification.deleteMany({ where: { entityId: state.productId } });
      await tx.auditEvent.deleteMany({ where: { entityId: { in: [state.productId, state.poId, state.grnId].filter(Boolean) } } });
      await tx.product.deleteMany({ where: { id: state.productId } });
    }
  }).catch((error) => console.error(`Cleanup warning: ${error.message}`));

  if (state.managedImage && !state.managedImage.preExisting) {
    await unlink(state.managedImage.path).catch(() => null);
  }
}

async function main() {
  const suffix = Date.now().toString(36).toUpperCase();
  const login = await gql(
    `mutation($input: LoginInput!) { login(input: $input) { authenticated token user { id role } } }`,
    { input: { email: TEST_EMAIL, password: TEST_PASSWORD } },
  );
  const token = login.login.token;
  assert(login.login.authenticated && token, 'Owner/admin login must return a session token');

  const setup = await gql(`query ReleaseGateSetup {
    appSettings { data }
    masterProductCategories(status: "active")
    masterProductBrands(status: "active")
    masterProductFinishes(status: "active")
    stockLocations
    productImportTemplate
  }`, {}, token);
  const settings = setup.appSettings.data;
  const brands = setup.masterProductBrands.filter((brand) => brand.metadata?.quoteEnabled !== false);
  assert(setup.masterProductCategories.length && setup.masterProductFinishes.length, 'Product category and finish masters are required');
  assert(brands.length > 0, 'At least one active quote-enabled brand is required');
  assert(setup.productImportTemplate.headers.includes('Default Purchase Cost'), 'Excel template must expose optional Default Purchase Cost');
  state.previousSettings = {
    id: settings.id,
    quoteBrandSelectionMode: settings.quoteBrandSelectionMode || 'all',
    quoteBrandIds: Array.isArray(settings.quoteBrandIds) ? settings.quoteBrandIds : [],
    updatedAt: settings.updatedAt,
  };
  await gql(
    `mutation($input: UpdateSettingsInput!) { updateAppSettings(input: $input) { data } }`,
    { input: { quoteBrandSelectionMode: 'all', quoteBrandIds: [] } },
    token,
  );

  const product = (await gql(
    `mutation($input: CreateProductInput!) { createProduct(input: $input) { id sku name category brand finish unit sellPrice floorPrice costPrice media } }`,
    { input: {
      sku: `COST-IMAGE-${suffix}`,
      internalCode: `CI-${suffix}`,
      name: 'Cost and quote image release gate',
      category: setup.masterProductCategories[0].name,
      brand: brands[0].name,
      finish: setup.masterProductFinishes[0].name,
      unit: 'PC',
      sellPrice: 5500,
      floorPrice: 5000,
      costPrice: 4321,
      taxClass: 'GST_18',
    } },
    token,
  )).createProduct;
  state.productId = product.id;
  assert(Number(product.costPrice) === 4321, 'Product Master default purchase cost was not persisted');
  await prisma.product.update({
    where: { id: product.id },
    data: { media: { primaryUrl: '/catalogue-images/new-style-products-p011-106-98195b773d7d52.png', gallery: ['/catalogue-images/new-style-products-p011-106-98195b773d7d52.png'] } },
  });

  const customer = (await gql(
    `mutation($input: CreateCustomerInput!) { createCustomer(input: $input) { id name } }`,
    { input: { name: `Quote asset release gate ${suffix}`, phone: '9000000042', email: `quote-assets-${suffix.toLowerCase()}@example.test`, city: 'Vapi', address: 'Automated release gate', forceCreate: true } },
    token,
  )).createCustomer;
  state.customerId = customer.id;

  let quote = (await gql(
    `mutation($input: CreateQuoteInput!) { createQuote(input: $input) { id quoteNumber leadId lines quoteMeta displayMode } }`,
    { input: {
      customerId: customer.id,
      title: `Persistent image quote ${suffix}`,
      projectName: 'Release gate bathroom',
      displayMode: 'priced',
      lines: JSON.stringify([{ productId: product.id, qty: 1, price: 5500, specialRate: 5500, mrp: 6500, mrpRateBasis: 'PIECE', taxRate: 18, area: 'Master Bathroom' }]),
    } },
    token,
  )).createQuote;
  state.quoteId = quote.id;
  state.leadId = quote.leadId;
  let quoteLine = asLines(quote.lines)[0];
  assert(quoteLine.quoteImage === '/catalogue-images/new-style-products-p011-106-98195b773d7d52.png', 'Bundled catalogue image path must remain usable on a quote');

  const imageRoot = process.env.CATALOGUE_IMAGE_STORAGE_DIR || resolve(process.cwd(), 'apps/web/public/catalogue-images');
  const remoteBefore = new Set((await readdir(resolve(imageRoot, 'manual')).catch(() => [])).filter((name) => name.startsWith('remote-')));
  quote = (await gql(
    `mutation($id: ID!, $input: UpdateQuotePresentationInput!) { updateQuotePresentation(id: $id, input: $input) { id lines quoteMeta } }`,
    { id: quote.id, input: { linePresentation: JSON.stringify([{ lineKey: quoteLine.lineKey, quoteImage: REMOTE_IMAGE_URL, area: 'Master Bathroom', designCode: `DESIGN-${suffix}` }]) } },
    token,
  )).updateQuotePresentation;
  quoteLine = asLines(quote.lines)[0];
  assert(/\/catalogue-images\/manual\/remote-[a-f0-9]{32}\.(?:png|jpe?g|webp)$/i.test(new URL(absoluteAssetUrl(quoteLine.quoteImage)).pathname), 'Remote quote image was not copied into managed storage');
  assert(quoteLine.customImageUrl === quoteLine.quoteImage, 'Quote image aliases must point at the same persisted asset');
  const managedFileName = basename(new URL(absoluteAssetUrl(quoteLine.quoteImage)).pathname);
  const managedFilePath = resolve(imageRoot, 'manual', managedFileName);
  state.managedImage = { path: managedFilePath, preExisting: remoteBefore.has(managedFileName) };
  assert((await stat(managedFilePath)).size > 1_000, 'Managed quote image file is missing or empty');
  const servedImage = await fetch(retrievableAssetUrl(quoteLine.quoteImage));
  assert(servedImage.ok && servedImage.headers.get('content-type')?.startsWith('image/'), 'Persisted quote image is not publicly retrievable');

  const po = (await gql(
    `mutation($input: CreatePurchaseOrderInput!) { createPurchaseOrder(input: $input) }`,
    { input: { demandIds: [], vendorName: 'Release gate supplier', notes: 'PO cost intentionally deferred to inward', lines: JSON.stringify([{ productId: product.id, quantity: 2, unit: 'PC' }]) } },
    token,
  )).createPurchaseOrder;
  state.poId = po.id;
  assert(po.lines.length === 1 && Number(po.lines[0].unitCost) === 0, 'PO must accept a line without unit cost');
  assert(Number(po.lines[0].skuCost) === 4321 && Number(po.lines[0].effectiveUnitCost) === 4321, 'PO response must expose the Product Master fallback cost');

  const location = setup.stockLocations.find((row) => row.defaultStockScope) || setup.stockLocations[0];
  assert(location?.id, 'A stock location is required for GRN verification');
  const grn = (await gql(
    `mutation($input: ReceivePurchaseOrderInput!) { receivePurchaseOrder(input: $input) }`,
    { input: {
      purchaseOrderId: po.id,
      supplierChallan: `COST-${suffix}`,
      locationId: location.id,
      idempotencyKey: `cost-image-${suffix}`,
      lines: JSON.stringify([{ purchaseOrderLineId: po.lines[0].id, receivedQuantity: 2, damagedQuantity: 0 }]),
    } },
    token,
  )).receivePurchaseOrder;
  state.grnId = grn.id;
  const receiptLine = await prisma.goodsReceiptLine.findFirst({ where: { goodsReceiptNoteId: grn.id } });
  const lot = await prisma.inventoryLot.findFirst({ where: { sourceId: grn.id, productId: product.id } });
  const ledger = lot
    ? await prisma.stockLedgerEntry.findUnique({ where: { idempotencyKey: `grn:${grn.id}:${lot.id}` } })
    : null;
  assert(Number(receiptLine?.unitCost) === 4321 && receiptLine?.metadata?.costSource === 'sku_default', 'GRN must fall back to Product Master cost when GRN and PO costs are blank');
  assert(Number(lot?.unitCost) === 4321 && lot?.metadata?.costSource === 'sku_default', 'Inventory lot must retain the resolved SKU-default cost source');
  assert(ledger?.type === 'grn_receipt' && Number(ledger?.unitCost) === 4321 && ledger?.metadata?.costSource === 'sku_default', 'Stock ledger must retain the resolved SKU-default cost source');

  const fulfillment = (await gql(`query($quoteId: ID!) { quoteFulfillment(quoteId: $quoteId) }`, { quoteId: quote.id }, token)).quoteFulfillment;
  const order = (await gql(
    `mutation($input: CreateSalesOrderInput!) { createSalesOrderFromQuote(input: $input) }`,
    { input: { quoteId: quote.id, paymentMode: 'cash', idempotencyKey: `quote-assets-${suffix}`, lines: JSON.stringify([{ quoteLineId: fulfillment.lines[0].id, quantity: 1 }]) } },
    token,
  )).createSalesOrderFromQuote;

  const share = (await gql(
    `mutation($quoteId: ID!, $expiresInDays: Float, $allowDownload: Boolean) { createQuoteShare(quoteId: $quoteId, expiresInDays: $expiresInDays, allowDownload: $allowDownload) }`,
    { quoteId: quote.id, expiresInDays: 30, allowDownload: true },
    token,
  )).createQuoteShare;
  assert(/^[A-Za-z0-9_-]{40,64}$/.test(share.token), 'Quote share token is missing or invalid');
  const publicDocument = (await gql(`query($token: String!) { publicQuoteShareDocument(token: $token) }`, { token: share.token })).publicQuoteShareDocument;
  const expectedBrands = publicDocument.brands.filter((brand) => brand.status === 'active' && brand.metadata?.quoteEnabled !== false);
  assert(publicDocument.settings.quoteBrandSelectionMode === 'all' && expectedBrands.length === brands.length, 'Public quote document must carry the global all-brand policy and every enabled brand');

  const quoteInline = await expectPdf(`${WEB}/api/pdf/quote/${quote.id}`, token, 'inline');
  const quoteDownload = await expectPdf(`${WEB}/api/pdf/quote/${quote.id}?download=1`, token, 'attachment');
  const sharedPdf = await expectPdf(`${WEB}/api/share/quote/${share.token}`, '', 'inline');
  const poPdf = await expectPdf(`${WEB}/api/pdf/purchase-order/${po.id}?download=1`, token, 'attachment');
  const salesPdf = await expectPdf(`${WEB}/api/pdf/order/${order.id}`, token, 'inline');
  const publicPage = await fetch(`${WEB}/share/quotes/${share.token}`);
  assert(publicPage.ok && (await publicPage.text()).includes('Customer quotation'), 'Public quote share page must open without authentication');
  const imageObjects = (quoteInline.toString('latin1').match(/\/Subtype\s*\/Image/g) || []).length;
  const salesImageObjects = (salesPdf.toString('latin1').match(/\/Subtype\s*\/Image/g) || []).length;
  assert(imageObjects >= 2, 'Quote PDF must embed company/product artwork instead of blank image boxes');
  assert(salesImageObjects >= 1, 'Sales order PDF must embed the persisted quote image');

  await mkdir(OUTPUT_DIR, { recursive: true });
  const artifacts = {
    quote: resolve(OUTPUT_DIR, `quote-${suffix}.pdf`),
    quoteDownload: resolve(OUTPUT_DIR, `quote-download-${suffix}.pdf`),
    sharedQuote: resolve(OUTPUT_DIR, `shared-quote-${suffix}.pdf`),
    purchaseOrder: resolve(OUTPUT_DIR, `purchase-order-${suffix}.pdf`),
    salesOrder: resolve(OUTPUT_DIR, `sales-order-${suffix}.pdf`),
  };
  await Promise.all([
    writeFile(artifacts.quote, quoteInline),
    writeFile(artifacts.quoteDownload, quoteDownload),
    writeFile(artifacts.sharedQuote, sharedPdf),
    writeFile(artifacts.purchaseOrder, poPdf),
    writeFile(artifacts.salesOrder, salesPdf),
  ]);

  console.log(JSON.stringify({
    ok: true,
    product: { sku: product.sku, defaultCost: product.costPrice },
    procurement: { poNumber: po.poNumber, poCost: po.lines[0].unitCost, grnNumber: grn.grnNumber, resolvedCost: receiptLine.unitCost, costSource: receiptLine.metadata.costSource },
    quote: { quoteNumber: quote.quoteNumber, managedImage: quoteLine.quoteImage, servedBrands: expectedBrands.length, imageObjects },
    sharing: { publicPage: `${WEB}/share/quotes/${share.token}`, publicPdfBytes: sharedPdf.length },
    salesOrder: { orderNumber: order.orderNumber, pdfBytes: salesPdf.length, imageObjects: salesImageObjects },
    artifacts,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}).finally(async () => {
  await cleanup().catch((error) => console.error(`Cleanup warning: ${error.message}`));
  await prisma.$disconnect();
});
