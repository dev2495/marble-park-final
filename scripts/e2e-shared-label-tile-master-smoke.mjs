import { PrismaClient } from '@prisma/client';

const API = process.env.API_URL || 'http://localhost:4000/graphql';
const EMAIL = process.env.TEST_EMAIL || 'admin@marblepark.com';
const PASSWORD = process.env.TEST_PASSWORD || 'password123';
const prisma = new PrismaClient();
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function gql(query, variables = {}, token, expectError = false) {
  const response = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ query, variables }) });
  const json = await response.json();
  const error = json.errors?.map((row) => row.message).join('; ') || '';
  if (expectError) return error;
  if (!response.ok || error) throw new Error(error || `GraphQL request failed (${response.status})`);
  return json.data;
}

async function main() {
  const suffix = Date.now().toString(36).toUpperCase();
  const token = (await gql(`mutation($input: LoginInput!) { login(input: $input) { token } }`, { input: { email: EMAIL, password: PASSWORD } })).login.token;
  const masters = (await gql(`query { productMasters }`, {}, token)).productMasters;
  const tileSize = masters.tileSizes[0] || (await gql(`mutation($input: TileSizeInput!) { saveTileSize(input: $input) { data } }`, { input: { name: `600 x 1200 mm ${suffix}`, code: `600X1200${suffix}`, uom: 'BOX', pcsPerBox: 2 } }, token)).saveTileSize.data;
  assert(tileSize?.id, 'Tile Size Master must expose a controlled tile size');
  const duplicateSizeError = await gql(`mutation($input: TileSizeInput!) { saveTileSize(input: $input) { data } }`, { input: { name: `Duplicate ${suffix}`, code: tileSize.code } }, token, true);
  assert(/already used/i.test(duplicateSizeError), 'Duplicate Tile Size codes must be blocked');

  const tile = (await gql(`mutation($input: CreateProductInput!) { createProduct(input: $input) { id sku internalCode tileSizeId piecesPerPack purchaseUom salesUom } }`, { input: {
    sku: `WH-TILE-${suffix}`, internalCode: `DISPLAY-${suffix}`, name: `Tile design ${suffix}`, category: 'Tiles', brand: 'Smoke', finish: 'Matt', tileSizeId: tileSize.id,
    dimensions: tileSize.name, baseUom: 'PC', purchaseUom: 'BOX', salesUom: 'BOX', piecesPerPack: 2, coveragePerPack: 15.5, sellPrice: 100, floorPrice: 80,
  } }, token)).createProduct;
  assert(tile.tileSizeId === tileSize.id && tile.sku === `WH-TILE-${suffix}`, 'Tile SKU must retain immutable warehouse SKU and controlled Tile Size');
  const generic = (await gql(`mutation($input: CreateProductInput!) { createProduct(input: $input) { id sku tileSizeId piecesPerPack } }`, { input: { sku: `WH-GEN-${suffix}`, internalCode: `GEN-${suffix}`, name: `Generic SKU ${suffix}`, category: 'Sanitaryware', unit: 'PC', sellPrice: 50 } }, token)).createProduct;
  assert(!generic.tileSizeId && generic.piecesPerPack === 1, 'Generic products must not be forced into tile-only fields');

  await gql(`mutation($input: ProductAliasInput!) { saveProductAlias(input: $input) }`, { input: { productId: tile.id, type: 'supplier_sku', value: `SUP-${suffix}` } }, token);
  const aliasSearch = (await gql(`query($query: String!) { globalSearch(query: $query) { products } }`, { query: `SUP-${suffix}` }, token)).globalSearch.products;
  assert(aliasSearch.some((row) => row.id === tile.id), 'Supplier/legacy aliases must resolve in shared autocomplete');

  let locations = (await gql(`query { stockLocations(status: "active") }`, {}, token)).stockLocations;
  if (!locations.length) locations = [(await gql(`mutation($input: StockLocationInput!) { createStockLocation(input: $input) }`, { input: { code: `TEST-${suffix}`, name: 'Shared label test location', type: 'plant', defaultStockScope: true } }, token)).createStockLocation];
  const location = locations[0];
  const display = (await gql(`mutation($input: DisplaySampleInput!) { createDisplaySample(input: $input) }`, { input: { productId: tile.id, internalCode: `WALL-${suffix}`, locationId: location.id, displayZone: 'A', displayPosition: '1' } }, token)).createDisplaySample;
  const displaySearch = (await gql(`query($query: String!) { globalSearch(query: $query) { products } }`, { query: `WALL-${suffix}` }, token)).globalSearch.products;
  assert(displaySearch.some((row) => row.id === tile.id), 'A showroom display code must automatically become a searchable product alias');

  const grn = (await gql(`mutation($input: ManualGoodsReceiptInput!) { createManualGoodsReceipt(input: $input) }`, { input: { vendorName: 'Label smoke vendor', supplierChallan: `CH-${suffix}`, locationId: location.id, reason: 'Shared label acceptance', idempotencyKey: `LABEL-${suffix}`, lines: JSON.stringify([{ productId: tile.id, receivedQuantity: 4, damagedQuantity: 0, unitCost: 75, locationId: location.id, location: location.name, supplierBatch: `BATCH-${suffix}` }]) } }, token)).createManualGoodsReceipt;
  const lot = (await gql(`query($productId: String) { inventoryLots(productId: $productId, status: "active", take: 10) }`, { productId: tile.id }, token)).inventoryLots.find((row) => row.sourceId === grn.id);
  assert(lot?.balances?.some((row) => row.onHand === 4 && row.available === 4), 'GRN must create exact-lot stock before labels');
  const balanceBefore = await prisma.inventoryBalance.findUnique({ where: { productId: tile.id } });

  const createJob = async (subject, quantity, template) => (await gql(`mutation($input: InternalLabelJobInput!) { createInternalLabelJob(input: $input) }`, { input: { ...subject, quantity, template, newJob: true } }, token)).createInternalLabelJob;
  const productJob = await createJob({ productId: generic.id }, 2, 'shelf');
  const additiveJob = await createJob({ productId: generic.id }, 1, 'shelf');
  assert(productJob.id !== additiveJob.id && productJob.instances.length === 2 && additiveJob.instances.length === 1, 'Explicit new label jobs must be additive');
  const lotJob = await createJob({ lotId: lot.id }, 2, 'stock_pack');
  const displayJob = await createJob({ displaySampleId: display.id }, 1, 'display_sample');

  const templates = (await gql(`query { internalLabelTemplates }`, {}, token)).internalLabelTemplates;
  assert(templates.some((row) => row.code === 'a4_70x37' && row.widthMm === 70 && row.heightMm === 37) && templates.some((row) => row.paperType === 'thermal'), 'Versioned exact-size A4 and thermal templates must exist');
  const prepared = (await gql(`mutation($input: InternalLabelPrintRunInput!) { prepareInternalLabelPrintRun(input: $input) }`, { input: { labelJobId: productJob.id, templateCode: 'thermal_50x30', labelIds: [productJob.instances[0].id], copies: 1, reason: 'Single-label acceptance' } }, token)).prepareInternalLabelPrintRun;
  let run = (await gql(`query($id: ID!) { internalLabelPrintRun(id: $id) }`, { id: prepared.id }, token)).internalLabelPrintRun;
  assert(run.status === 'prepared' && run.labels.length === 1 && run.labels[0].qrValue === `MP-LABEL:${run.labels[0].labelCode}`, 'Prepared run must isolate one selected label and encode scanner-ready QR payload');
  let refreshedJob = (await gql(`query($sourceId: String) { internalLabelJobs(sourceId: $sourceId, take: 10) }`, { sourceId: generic.id }, token)).internalLabelJobs.find((row) => row.id === productJob.id);
  assert(refreshedJob.instances[0].printCount === 0, 'Preparing/opening print data must not increment print count');
  const scan = (await gql(`mutation($code: String!) { scanInternalLabel(labelCode: $code) }`, { code: run.labels[0].qrValue }, token)).scanInternalLabel;
  const legacyScan = (await gql(`mutation($code: String!) { scanInternalLabel(labelCode: $code) }`, { code: JSON.stringify({ labelCode: run.labels[0].labelCode }) }, token)).scanInternalLabel;
  assert(scan.result === 'success' && legacyScan.result === 'success', 'Scanner must accept rendered QR payload and legacy JSON payload');
  const cancelledRun = (await gql(`mutation($id: ID!, $reason: String!) { cancelInternalLabelPrintRun(id: $id, reason: $reason) }`, { id: prepared.id, reason: 'Acceptance: browser dialog cancelled' }, token)).cancelInternalLabelPrintRun;
  assert(cancelledRun.reason === 'Single-label acceptance' && cancelledRun.cancelReason === 'Acceptance: browser dialog cancelled', 'Cancellation must preserve print intent and cancellation reasons separately');
  refreshedJob = (await gql(`query($sourceId: String) { internalLabelJobs(sourceId: $sourceId, take: 10) }`, { sourceId: generic.id }, token)).internalLabelJobs.find((row) => row.id === productJob.id);
  assert(refreshedJob.instances[0].printCount === 0, 'Cancelled browser print run must leave print count unchanged');

  const confirmedRun = (await gql(`mutation($input: InternalLabelPrintRunInput!) { prepareInternalLabelPrintRun(input: $input) }`, { input: { labelJobId: productJob.id, templateCode: 'a4_70x37', labelIds: [productJob.instances[1].id], copies: 2, reason: 'Selected reprint acceptance' } }, token)).prepareInternalLabelPrintRun;
  await gql(`mutation($id: ID!) { confirmInternalLabelPrintRun(id: $id) }`, { id: confirmedRun.id }, token);
  refreshedJob = (await gql(`query($sourceId: String) { internalLabelJobs(sourceId: $sourceId, take: 10) }`, { sourceId: generic.id }, token)).internalLabelJobs.find((row) => row.id === productJob.id);
  assert(refreshedJob.instances.find((row) => row.id === productJob.instances[0].id).printCount === 0 && refreshedJob.instances.find((row) => row.id === productJob.instances[1].id).printCount === 2, 'Selected reprint must increment only selected label by confirmed copies');

  const displayRun = (await gql(`mutation($input: InternalLabelPrintRunInput!) { prepareInternalLabelPrintRun(input: $input) }`, { input: { labelJobId: displayJob.id, templateCode: 'thermal_100x50', copies: 1, reason: 'Display acceptance' } }, token)).prepareInternalLabelPrintRun;
  run = (await gql(`query($id: ID!) { internalLabelPrintRun(id: $id) }`, { id: displayRun.id }, token)).internalLabelPrintRun;
  assert(run.labels[0].payload.internalCode === `WALL-${suffix}` && run.labels[0].payload.displaySample === display.sampleNumber, 'Display label must print the physical display code, not the product display code');
  const lotRun = (await gql(`mutation($input: InternalLabelPrintRunInput!) { prepareInternalLabelPrintRun(input: $input) }`, { input: { labelJobId: lotJob.id, templateCode: 'a4_70x37', labelIds: [lotJob.instances[0].id], copies: 1, reason: 'Lot acceptance' } }, token)).prepareInternalLabelPrintRun;
  run = (await gql(`query($id: ID!) { internalLabelPrintRun(id: $id) }`, { id: lotRun.id }, token)).internalLabelPrintRun;
  assert(run.labels[0].payload.lotNumber === lot.lotNumber, 'Lot label must retain exact inward-lot identity');

  await gql(`mutation($id: ID!, $reason: String!) { voidInternalLabel(id: $id, reason: $reason) }`, { id: productJob.instances[0].id, reason: 'Acceptance void' }, token);
  const voidScan = (await gql(`mutation($code: String!) { scanInternalLabel(labelCode: $code) }`, { code: `MP-LABEL:${productJob.instances[0].labelCode}` }, token)).scanInternalLabel;
  assert(voidScan.result === 'inactive', 'Voided label must remain auditable and scan inactive');
  const audits = (await gql(`query($entityType: String) { legacyAuditEvents(entityType: $entityType, take: 50) }`, { entityType: 'InternalLabelPrintRun' }, token)).legacyAuditEvents;
  assert(audits.some((row) => row.action === 'internal_label.print_confirm') && audits.some((row) => row.action === 'internal_label.print_cancel'), 'Print confirmation and cancellation must both be audited');
  const balanceAfter = await prisma.inventoryBalance.findUnique({ where: { productId: tile.id } });
  assert(balanceAfter.onHand === balanceBefore.onHand && balanceAfter.available === balanceBefore.available && balanceAfter.reserved === balanceBefore.reserved, 'Label lifecycle must not mutate warehouse stock buckets');

  console.log(JSON.stringify({ ok: true, tileSku: tile.sku, genericSku: generic.sku, tileSize: tileSize.name, aliasSearch: true, additiveJobs: true, productLabels: 3, lotLabels: lotJob.instances.length, displayCode: `WALL-${suffix}`, preparedCancelledWithoutCount: true, selectedConfirmedCopies: 2, qrPayloadScan: true, legacyPayloadScan: true, stockInvariant: { onHand: balanceAfter.onHand, available: balanceAfter.available, reserved: balanceAfter.reserved } }, null, 2));
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
