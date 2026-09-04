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
  const missingMrpError = await gql(`mutation($input: CreateProductInput!) { createProduct(input: $input) { id } }`, { input: { sku: `MISSING-MRP-${suffix}`, internalCode: `MM-${suffix}`, name: 'MRP guard acceptance', category: 'Sanitaryware', unit: 'PC' } }, token, true);
  assert(/MRP is required/i.test(missingMrpError), 'Every new Product Master SKU must be rejected without a positive MRP');
  const masters = (await gql(`query { productMasters }`, {}, token)).productMasters;
  const tileSize = masters.tileSizes[0] || (await gql(`mutation($input: TileSizeInput!) { saveTileSize(input: $input) { data } }`, { input: { name: `600 x 1200 mm ${suffix}`, code: `600X1200${suffix}`, uom: 'BOX', pcsPerBox: 2 } }, token)).saveTileSize.data;
  assert(tileSize?.id, 'Tile Size Master must expose a controlled tile size');
  const duplicateSizeError = await gql(`mutation($input: TileSizeInput!) { saveTileSize(input: $input) { data } }`, { input: { name: `Duplicate ${suffix}`, code: tileSize.code } }, token, true);
  assert(/already used/i.test(duplicateSizeError), 'Duplicate Tile Size codes must be blocked');

  const tile = (await gql(`mutation($input: CreateProductInput!) { createProduct(input: $input) { id sku internalCode tileSizeId piecesPerPack purchaseUom salesUom defaultMrpInclusive priceRateBasis priceUom } }`, { input: {
    sku: `WH-TILE-${suffix}`, internalCode: `DISPLAY-${suffix}`, name: `Tile design ${suffix}`, category: 'Tiles', brand: 'Smoke', finish: 'Matt', tileSizeId: tileSize.id,
    dimensions: tileSize.name, baseUom: 'PC', purchaseUom: 'BOX', salesUom: 'BOX', piecesPerPack: 2, coveragePerPack: 15.5,
    defaultMrpInclusive: 125, defaultNrpInclusive: 100, priceRateBasis: 'AREA', priceUom: 'SQFT', mrpSource: 'MANUAL', pricingEffectiveFrom: new Date().toISOString(),
  } }, token)).createProduct;
  assert(tile.tileSizeId === tileSize.id && tile.sku === `WH-TILE-${suffix}`, 'Tile SKU must retain immutable warehouse SKU and controlled Tile Size');
  assert(tile.priceRateBasis === 'AREA' && tile.priceUom === 'SQFT', 'Tile Product Master MRP must be governed per SQFT');
  const generic = (await gql(`mutation($input: CreateProductInput!) { createProduct(input:$input) { id sku tileSizeId piecesPerPack } }`, { input: { sku: `WH-GEN-${suffix}`, internalCode: `GEN-${suffix}`, name: `Generic SKU ${suffix}`, category: 'Sanitaryware', unit: 'PC', defaultMrpInclusive: 50, priceRateBasis: 'PIECE', priceUom: 'PC', mrpSource: 'MANUAL', pricingEffectiveFrom: new Date().toISOString() } }, token)).createProduct;
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
  assert(templates.length === 1 && templates[0].code === 'thermal_4x2' && templates[0].version === 4 && templates[0].widthMm === 101.6 && templates[0].heightMm === 50.8 && templates[0].pageWidthMm === 101.6 && templates[0].pageHeightMm === 50.8, 'The active v4 sticker must default to exact 4 x 2 inch landscape media');
  const prepared = (await gql(`mutation($input: InternalLabelPrintRunInput!) { prepareInternalLabelPrintRun(input: $input) }`, { input: { labelJobId: productJob.id, templateCode: 'thermal_4x2', labelIds: [productJob.instances[0].id], copies: 1, reason: 'Single-label acceptance' } }, token)).prepareInternalLabelPrintRun;
  let run = (await gql(`query($id: ID!) { internalLabelPrintRun(id: $id) }`, { id: prepared.id }, token)).internalLabelPrintRun;
  assert(run.status === 'prepared' && run.labels.length === 1 && run.labels[0].qrValue === `MP-LABEL:${run.labels[0].labelCode}`, 'Prepared run must isolate one selected label and encode scanner-ready QR payload');
  assert(run.metadata.orientation === 'landscape' && run.template.definition.orientation === 'landscape' && run.template.pageWidthMm === 101.6 && run.template.pageHeightMm === 50.8, 'A run without an explicit orientation must persist landscape and expose matching physical page dimensions');
  const invalidRunCountBefore = await prisma.internalLabelPrintRun.count({ where: { labelJobId: productJob.id } });
  for (const invalid of [{ copies: 0 }, { copies: 51 }, { copies: 1.5 }, { orientation: 'sideways' }]) {
    const validationError = await gql(`mutation($input: InternalLabelPrintRunInput!) { prepareInternalLabelPrintRun(input: $input) }`, { input: { labelJobId: productJob.id, templateCode: 'thermal_4x2', labelIds: [productJob.instances[0].id], copies: 1, reason: 'Rejected print option acceptance', ...invalid } }, token, true);
    assert(validationError && (invalid.orientation ? /portrait or landscape/i.test(validationError) : /copies|int/i.test(validationError)), `Invalid print options must be rejected: ${JSON.stringify(invalid)}`);
  }
  assert(await prisma.internalLabelPrintRun.count({ where: { labelJobId: productJob.id } }) === invalidRunCountBefore, 'Rejected options must not create print runs');
  let refreshedJob = (await gql(`query($sourceId: String) { internalLabelJobs(sourceId: $sourceId, take: 10) }`, { sourceId: generic.id }, token)).internalLabelJobs.find((row) => row.id === productJob.id);
  assert(refreshedJob.instances[0].printCount === 0, 'Preparing/opening print data must not increment print count');
  const scan = (await gql(`mutation($code: String!) { scanInternalLabel(labelCode: $code) }`, { code: run.labels[0].qrValue }, token)).scanInternalLabel;
  const legacyScan = (await gql(`mutation($code: String!) { scanInternalLabel(labelCode: $code) }`, { code: JSON.stringify({ labelCode: run.labels[0].labelCode }) }, token)).scanInternalLabel;
  assert(scan.result === 'success' && legacyScan.result === 'success', 'Scanner must accept rendered QR payload and legacy JSON payload');
  const cancelledRun = (await gql(`mutation($id: ID!, $reason: String!) { cancelInternalLabelPrintRun(id: $id, reason: $reason) }`, { id: prepared.id, reason: 'Acceptance: browser dialog cancelled' }, token)).cancelInternalLabelPrintRun;
  assert(cancelledRun.reason === 'Single-label acceptance' && cancelledRun.cancelReason === 'Acceptance: browser dialog cancelled', 'Cancellation must preserve print intent and cancellation reasons separately');
  refreshedJob = (await gql(`query($sourceId: String) { internalLabelJobs(sourceId: $sourceId, take: 10) }`, { sourceId: generic.id }, token)).internalLabelJobs.find((row) => row.id === productJob.id);
  assert(refreshedJob.instances[0].printCount === 0, 'Cancelled browser print run must leave print count unchanged');

  const confirmedRun = (await gql(`mutation($input: InternalLabelPrintRunInput!) { prepareInternalLabelPrintRun(input: $input) }`, { input: { templateCode: 'thermal_4x2', labelIds: [productJob.instances[1].id, additiveJob.instances[0].id], copies: 2, reason: 'Cross-job bulk print acceptance' } }, token)).prepareInternalLabelPrintRun;
  run = (await gql(`query($id: ID!) { internalLabelPrintRun(id: $id) }`, { id: confirmedRun.id }, token)).internalLabelPrintRun;
  assert(run.labels.length === 4 && run.jobs.length === 2 && run.metadata.bulk === true && run.metadata.jobCount === 2 && run.metadata.physicalPages === 4, 'One governed print run must combine labels from several jobs and expand physical copies');
  await gql(`mutation($id: ID!) { confirmInternalLabelPrintRun(id: $id) }`, { id: confirmedRun.id }, token);
  refreshedJob = (await gql(`query($sourceId: String) { internalLabelJobs(sourceId: $sourceId, take: 10) }`, { sourceId: generic.id }, token)).internalLabelJobs.find((row) => row.id === productJob.id);
  const refreshedAdditiveJob = (await gql(`query($sourceId: String) { internalLabelJobs(sourceId: $sourceId, take: 10) }`, { sourceId: generic.id }, token)).internalLabelJobs.find((row) => row.id === additiveJob.id);
  assert(refreshedJob.instances.find((row) => row.id === productJob.instances[0].id).printCount === 0 && refreshedJob.instances.find((row) => row.id === productJob.instances[1].id).printCount === 2 && refreshedAdditiveJob.instances[0].printCount === 2, 'Bulk confirmation must increment only selected labels across every source job by the confirmed copy count');
  const jobsForPrintState = async (printState, skip = 0, take = 10) => (await gql(`query($sourceId: String, $printState: String, $skip: Int, $take: Int) { internalLabelJobs(sourceId: $sourceId, printState: $printState, skip: $skip, take: $take) }`, { sourceId: generic.id, printState, skip, take }, token)).internalLabelJobs;
  const latestUnfiltered = await jobsForPrintState('all', 0, 1);
  const olderUnprinted = await jobsForPrintState('unprinted', 0, 1);
  const printedJobs = await jobsForPrintState('printed');
  assert(latestUnfiltered[0]?.id === additiveJob.id && olderUnprinted[0]?.id === productJob.id, 'Print-state filtering must happen before pagination so an older unprinted job remains discoverable behind a newer fully printed job');
  assert(printedJobs.length === 2 && printedJobs.every((job) => job.instances.some((label) => label.status === 'active' && label.printCount > 0)), 'Printed-before must return only jobs containing active printed labels');
  assert((await jobsForPrintState('unprinted')).every((job) => job.instances.some((label) => label.status === 'active' && label.printCount === 0)), 'Not-printed must return only jobs containing active unprinted labels');
  assert((await jobsForPrintState('printed', 1, 1))[0]?.id === productJob.id, 'Printed-before pagination must retain older matching jobs');

  const displayRun = (await gql(`mutation($input: InternalLabelPrintRunInput!) { prepareInternalLabelPrintRun(input: $input) }`, { input: { labelJobId: displayJob.id, templateCode: 'thermal_4x2', copies: 1, reason: 'Display acceptance' } }, token)).prepareInternalLabelPrintRun;
  run = (await gql(`query($id: ID!) { internalLabelPrintRun(id: $id) }`, { id: displayRun.id }, token)).internalLabelPrintRun;
  assert(run.labels[0].payload.internalCode === `WALL-${suffix}` && run.labels[0].payload.displaySample === display.sampleNumber, 'Display label must print the physical display code, not the product display code');
  const lotRun = (await gql(`mutation($input: InternalLabelPrintRunInput!) { prepareInternalLabelPrintRun(input: $input) }`, { input: { labelJobId: lotJob.id, templateCode: 'thermal_4x2', labelIds: [lotJob.instances[0].id], copies: 1, orientation: 'portrait', reason: 'Lot portrait acceptance' } }, token)).prepareInternalLabelPrintRun;
  run = (await gql(`query($id: ID!) { internalLabelPrintRun(id: $id) }`, { id: lotRun.id }, token)).internalLabelPrintRun;
  assert(run.labels[0].payload.lotNumber === lot.lotNumber, 'Lot label must retain exact inward-lot identity');
  assert(Number(run.labels[0].payload.mrpInclusive) === 125 && run.labels[0].payload.priceUom === 'SQFT', 'Tile lot labels must use Product Master MRP per SQFT');
  assert(run.metadata.orientation === 'portrait' && run.template.definition.orientation === 'portrait' && run.template.pageWidthMm === 50.8 && run.template.pageHeightMm === 101.6, 'Portrait choice must persist on the run and expose the correct media dimensions after reload');
  assert(run.labels[0].payload.finish === 'Matt', 'The label payload must carry the actual SKU finish for the line below the product code');

  await gql(`mutation($id: ID!, $reason: String!) { voidInternalLabel(id: $id, reason: $reason) }`, { id: productJob.instances[0].id, reason: 'Acceptance void' }, token);
  const voidScan = (await gql(`mutation($code: String!) { scanInternalLabel(labelCode: $code) }`, { code: `MP-LABEL:${productJob.instances[0].labelCode}` }, token)).scanInternalLabel;
  assert(voidScan.result === 'inactive', 'Voided label must remain auditable and scan inactive');
  const audits = (await gql(`query($entityType: String) { legacyAuditEvents(entityType: $entityType, take: 50) }`, { entityType: 'InternalLabelPrintRun' }, token)).legacyAuditEvents;
  assert(audits.some((row) => row.action === 'internal_label.print_confirm') && audits.some((row) => row.action === 'internal_label.print_cancel'), 'Print confirmation and cancellation must both be audited');
  const balanceAfter = await prisma.inventoryBalance.findUnique({ where: { productId: tile.id } });
  assert(balanceAfter.onHand === balanceBefore.onHand && balanceAfter.available === balanceBefore.available && balanceAfter.reserved === balanceBefore.reserved, 'Label lifecycle must not mutate warehouse stock buckets');

  console.log(JSON.stringify({ ok: true, tileSku: tile.sku, genericSku: generic.sku, tileSize: tileSize.name, aliasSearch: true, additiveJobs: true, crossJobBulkRun: { jobs: 2, uniqueLabels: 2, physicalPages: 4 }, templateVersion: 4, defaultOrientation: 'landscape', persistedPortrait: true, rejectedInvalidOrientation: true, rejectedInvalidCopies: [0, 51, 1.5], finish: 'Matt', printStateBeforePagination: true, productLabels: 3, lotLabels: lotJob.instances.length, displayCode: `WALL-${suffix}`, preparedCancelledWithoutCount: true, selectedConfirmedCopies: 2, qrPayloadScan: true, legacyPayloadScan: true, stockInvariant: { onHand: balanceAfter.onHand, available: balanceAfter.available, reserved: balanceAfter.reserved } }, null, 2));
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
