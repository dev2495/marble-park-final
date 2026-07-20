import ExcelJS from 'exceljs';
import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.API_URL || 'http://localhost:4000/graphql';
const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@marblepark.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'password123';
const prisma = new PrismaClient();
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function gql(query, variables = {}, token, expectError = false) {
  const response = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ query, variables }) });
  const json = await response.json();
  if (expectError) return json.errors?.map((row) => row.message).join('; ') || '';
  if (!response.ok || json.errors?.length) throw new Error(json.errors?.map((row) => row.message).join('; ') || `GraphQL request failed (${response.status})`);
  return json.data;
}

async function uploadWorkbook(buffer, filename, token) {
  const begin = await gql(`mutation($filename: String!) { beginImportUpload(filename: $filename) { id result } }`, { filename }, token);
  const uploadId = begin.beginImportUpload.result.uploadId;
  await gql(`mutation($uploadId: String!, $filename: String!, $contentBase64: String!) { appendImportUpload(uploadId: $uploadId, filename: $filename, contentBase64: $contentBase64) { id } }`, { uploadId, filename, contentBase64: Buffer.from(buffer).toString('base64') }, token);
  return uploadId;
}

async function cancelUpload(uploadId, filename, token) {
  await gql(`mutation($uploadId: String!, $filename: String!) { cancelImportUpload(uploadId: $uploadId, filename: $filename) { result } }`, { uploadId, filename }, token);
}

function listValues(sheet, column) {
  const values = [];
  for (let row = 2; row <= sheet.rowCount; row += 1) {
    const value = String(sheet.getCell(row, column).value || '').trim();
    if (value) values.push(value);
  }
  return values;
}

async function main() {
  const createdSkus = [];
  const managedImageNames = [];
  const lifecycle = { grnId: '', lotId: '', displayId: '', labelJobIds: [] };
  try {
    const requestProbeResponse = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'query RequestReferenceProbe { productImportReadiness }' }) });
    const requestProbe = await requestProbeResponse.json();
    const requestReference = requestProbeResponse.headers.get('x-request-id');
    assert(requestReference && requestProbe.errors?.[0]?.extensions?.requestId === requestReference, 'GraphQL errors must expose the same request reference in the response header and error extensions');
    const token = (await gql(`mutation($input: LoginInput!) { login(input: $input) { token } }`, { input: { email: TEST_EMAIL, password: TEST_PASSWORD } })).login.token;
    const readiness = (await gql(`query { productImportReadiness }`, {}, token)).productImportReadiness;
    assert(readiness.ready && readiness.blockers.length === 0, `Import preflight must be ready before template download: ${JSON.stringify(readiness.blockers)}`);
    const template = (await gql(`query { productImportTemplate }`, {}, token)).productImportTemplate;
    assert(template.contentBase64 && template.headers.includes('Internal Code') && template.headers.includes('Coverage Per Pack') && template.headers.includes('Product Image'), 'Template must expose governed product and embedded-image fields');

    const downloaded = new ExcelJS.Workbook();
    await downloaded.xlsx.load(Buffer.from(template.contentBase64, 'base64'));
    const productSheet = downloaded.getWorksheet('Product Master');
    const lists = downloaded.getWorksheet('Live Master Lists');
    assert(productSheet && lists && downloaded.getWorksheet('How to use') && downloaded.getWorksheet('Reference details'), 'Template must include product, instructions, live lists and reference sheets');
    assert(String(productSheet.getCell('A1').value).includes('*') && /optional/i.test(String(productSheet.getCell('N1').value)), 'Template headers must visibly distinguish required and optional columns');
    const definedNames = new Set(downloaded.definedNames.model.map((row) => row.name));
    for (const name of ['Categories', 'Brands', 'Finishes', 'Materials', 'TileSizes', 'UOMs', 'TaxCodes', 'YesNo']) assert(definedNames.has(name), `Template is missing ${name} dropdown range`);
    assert(productSheet.getCell('D2').dataValidation?.formulae?.[0] === 'Categories', 'Category cells must use the live Categories dropdown');
    assert(productSheet.getColumn(1).numFmt === '@' && productSheet.getColumn(2).numFmt === '@', 'SKU and internal-code columns must be formatted as Excel text');
    assert(/place over cells/i.test(String(downloaded.getWorksheet('How to use').getCell('C8').value)), 'Image instructions must name the supported Excel image mode');

    const categories = listValues(lists, 1);
    const brands = listValues(lists, 2);
    const finishes = listValues(lists, 3);
    const materials = listValues(lists, 4);
    const tileSizes = listValues(lists, 5);
    const uoms = listValues(lists, 6);
    const taxCodes = listValues(lists, 7);
    const tileCategory = categories.find((value) => value.toLowerCase() === 'tiles');
    assert(tileCategory && tileSizes.length && uoms.length && taxCodes.length, 'Live DB must contain Tiles, tile sizes, UOMs and tax codes for the import flow');

    // Browser review materializes blank optional cells into explicit defaults.
    // Applying that semantically identical payload must retain the initial token.
    const cleanBook = new ExcelJS.Workbook();
    const cleanSheet = cleanBook.addWorksheet('Product Master');
    cleanSheet.addRow(template.headers);
    const cleanSuffix = `${Date.now().toString(36).toUpperCase()}C`;
    const cleanSku = `BULK-CLEAN-${cleanSuffix}`;
    createdSkus.push(cleanSku);
    cleanSheet.addRow([cleanSku, `BC-${cleanSuffix}`, 'Clean browser confirmation row', categories.find((value) => value !== tileCategory) || categories[0], brands[0], finishes[0], '', '', '', '', '', '', '', '', '', taxCodes[0]]);
    const cleanFilename = `clean-browser-review-${cleanSuffix}.xlsx`;
    const cleanUploadId = await uploadWorkbook(await cleanBook.xlsx.writeBuffer(), cleanFilename, token);
    const cleanPreview = (await gql(`mutation($uploadId: String!, $filename: String!, $kind: String!) { previewUploadedImport(uploadId: $uploadId, filename: $filename, kind: $kind) { result } }`, { uploadId: cleanUploadId, filename: cleanFilename, kind: 'excel' }, token)).previewUploadedImport.result;
    assert(cleanPreview.status === 'ready_to_apply' && cleanPreview.confirmationToken, 'Clean workbook must be ready on its first preview');
    const browserRows = cleanPreview.previewRows.map((row) => ({
      sheet: row.sheet, rowNumber: row.rowNumber, sku: row.sku, internalCode: row.internalCode, name: row.name,
      category: row.category, brand: row.brand, finish: row.finish, material: row.material || '', dimensions: row.dimensions || '',
      baseUom: row.provided?.baseUom ? row.baseUom : '', purchaseUom: row.provided?.purchaseUom ? row.purchaseUom : '', salesUom: row.provided?.salesUom ? row.salesUom : '',
      piecesPerPack: row.provided?.piecesPerPack ? row.piecesPerPack : '', coveragePerPack: row.provided?.coveragePerPack ? row.coveragePerPack : '',
      sellPrice: row.provided?.sellPrice ? row.sellPrice : '', floorPrice: row.provided?.floorPrice ? row.floorPrice : '', taxClass: row.taxClass,
      hsnCode: row.hsnCode || '', allowLoose: row.provided?.allowLoose ? (row.allowLoose ? 'Yes' : 'No') : '', range: row.range || '', imageUrl: row.imageUrl || '', description: row.description || '',
    }));
    const cleanApplied = (await gql(`mutation($uploadId: String!, $filename: String!, $kind: String!, $confirmationToken: String!, $reviewRows: JSON) { applyUploadedImport(uploadId: $uploadId, filename: $filename, kind: $kind, confirmationToken: $confirmationToken, reviewRows: $reviewRows) { result } }`, { uploadId: cleanUploadId, filename: cleanFilename, kind: 'excel', confirmationToken: cleanPreview.confirmationToken, reviewRows: browserRows }, token)).applyUploadedImport.result;
    assert(cleanApplied.status === 'applied' && cleanApplied.created === 1, 'Initial clean preview must apply with the browser-expanded review payload');

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Product Master');
    sheet.addRow(template.headers);
    const suffix = Date.now().toString(36).toUpperCase();
    const sku = `BULK-TILE-${suffix}`;
    createdSkus.push(sku);
    sheet.addRow([sku, `BT-${suffix}`, 'Bulk imported porcelain tile', tileCategory, '', finishes[0] || '', materials[0] || '', '', '', '', '', '', '', '', 115, taxCodes[0], '', '', 'Smoke series', '', '', 'Exact tile design row']);
    sheet.getRow(2).height = 48;
    const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nDMAAAAASUVORK5CYII=', 'base64');
    const imageId = workbook.addImage({ buffer: pixel, extension: 'png' });
    sheet.addImage(imageId, { tl: { col: 20, row: 1 }, ext: { width: 42, height: 42 } });
    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `product-master-${suffix}.xlsx`;
    const uploadId = await uploadWorkbook(buffer, filename, token);
    const initialPreview = (await gql(`mutation($uploadId: String!, $filename: String!, $kind: String!) { previewUploadedImport(uploadId: $uploadId, filename: $filename, kind: $kind) { result } }`, { uploadId, filename, kind: 'excel' }, token)).previewUploadedImport.result;
    assert(initialPreview.status === 'needs_correction' && initialPreview.failed === 1 && /brand/i.test(initialPreview.failures[0].error), 'Missing required brand must be blocked in initial preview');
    const reviewRows = [{ sheet: 'Product Master', rowNumber: 2, brand: brands[0] }];
    const preview = (await gql(`mutation($uploadId: String!, $filename: String!, $kind: String!, $reviewRows: JSON) { previewUploadedImport(uploadId: $uploadId, filename: $filename, kind: $kind, reviewRows: $reviewRows) { result } }`, { uploadId, filename, kind: 'excel', reviewRows }, token)).previewUploadedImport.result;
    assert(preview.status === 'ready_to_apply' && preview.ready === 1 && preview.failed === 0 && preview.confirmationToken, `Edited review must return one confirmed row: ${JSON.stringify(preview)}`);
    assert(preview.previewRows[0].internalCode === `BT-${suffix}` && preview.previewRows[0].sellPrice === 0 && preview.previewRows[0].imageStatus === 'embedded_image_detected', 'Edited preview must retain identity/image and default an omitted price to zero');

    const unconfirmedUploadId = await uploadWorkbook(buffer, `unconfirmed-${filename}`, token);
    const unconfirmedPreview = (await gql(`mutation($uploadId: String!, $filename: String!, $kind: String!, $reviewRows: JSON) { previewUploadedImport(uploadId: $uploadId, filename: $filename, kind: $kind, reviewRows: $reviewRows) { result } }`, { uploadId: unconfirmedUploadId, filename: `unconfirmed-${filename}`, kind: 'excel', reviewRows }, token)).previewUploadedImport.result;
    const changedReviewRows = [{ sheet: 'Product Master', rowNumber: 2, brand: brands[0], sellPrice: 1 }];
    const unconfirmedError = await gql(`mutation($uploadId: String!, $filename: String!, $kind: String!, $confirmationToken: String!, $reviewRows: JSON) { applyUploadedImport(uploadId: $uploadId, filename: $filename, kind: $kind, confirmationToken: $confirmationToken, reviewRows: $reviewRows) { result } }`, { uploadId: unconfirmedUploadId, filename: `unconfirmed-${filename}`, kind: 'excel', confirmationToken: unconfirmedPreview.confirmationToken, reviewRows: changedReviewRows }, token, true);
    assert(/changed|revalidate/i.test(unconfirmedError), 'Apply must reject review edits that differ from the server-signed preview');

    const applied = (await gql(`mutation($uploadId: String!, $filename: String!, $kind: String!, $confirmationToken: String!, $reviewRows: JSON) { applyUploadedImport(uploadId: $uploadId, filename: $filename, kind: $kind, confirmationToken: $confirmationToken, reviewRows: $reviewRows) { result } }`, { uploadId, filename, kind: 'excel', confirmationToken: preview.confirmationToken, reviewRows }, token)).applyUploadedImport.result;
    assert(applied.status === 'applied' && applied.created === 1 && applied.updated === 0 && applied.failed === 0, 'Confirmed workbook must create new SKUs atomically without updates');

    const tile = await prisma.product.findUnique({ where: { sku }, include: { balances: true } });
    assert(tile?.internalCode === `BT-${suffix}` && tile.purchaseUom === 'BOX' && tile.salesUom === 'BOX' && tile.baseUom === 'PC' && tile.piecesPerPack === 1 && tile.coveragePerPack === 0 && Number(tile.sellPrice) === 0, 'Imported tile must use safe defaults when optional unit, box conversion and price fields are blank');
    assert(tile.categoryId && !tile.tileSizeId && tile.balances?.onHand === 0, 'Imported SKU must link required masters, allow an omitted tile size and start with zero physical stock');
    assert(tile.media?.primaryUrl?.includes('/catalogue-images/manual/'), 'Embedded image must become managed Product Master media');
    managedImageNames.push(path.basename(tile.media.primaryUrl));

    const locations = (await gql(`query { stockLocations }`, {}, token)).stockLocations;
    const location = locations.find((row) => row.defaultStockScope) || locations[0];
    assert(location?.id, 'A stock location is required for inward lifecycle verification');
    const grn = (await gql(`mutation($input: ManualGoodsReceiptInput!) { createManualGoodsReceipt(input: $input) }`, { input: {
      vendorName: 'Product import lifecycle verification', supplierChallan: `IMP-${suffix}`, locationId: location.id,
      reason: 'Imported SKU inward verification', idempotencyKey: `import-lifecycle-${suffix}`,
      lines: JSON.stringify([{ productId: tile.id, receivedQuantity: 4, damagedQuantity: 0, unitCost: 100, locationId: location.id, location: location.name }]),
    } }, token)).createManualGoodsReceipt;
    lifecycle.grnId = grn.id;
    const lots = (await gql(`query($productId: String) { inventoryLots(productId: $productId, status: "active", take: 10) }`, { productId: tile.id }, token)).inventoryLots;
    const lot = lots.find((row) => row.sourceId === grn.id);
    assert(lot?.balances?.some((balance) => balance.locationId === location.id && balance.onHand === 4 && balance.available === 4), 'GRN must create an available lot for the imported SKU');
    lifecycle.lotId = lot.id;
    const lotJob = (await gql(`mutation($input: InternalLabelJobInput!) { createInternalLabelJob(input: $input) }`, { input: { lotId: lot.id, quantity: 2, template: 'stock_pack' } }, token)).createInternalLabelJob;
    lifecycle.labelJobIds.push(lotJob.id);
    const lotPrint = (await gql(`mutation($id: ID!) { printInternalLabelJob(id: $id) }`, { id: lotJob.id }, token)).printInternalLabelJob;
    assert(lotPrint.labels.length === 2 && lotPrint.labels.every((label) => label.payload.lotNumber === lot.lotNumber && label.qrDataUrl.startsWith('data:image/png;base64,')), 'Lot label print must encode exact imported SKU and inward lot');
    const lotScan = (await gql(`mutation($labelCode: String!) { scanInternalLabel(labelCode: $labelCode) }`, { labelCode: lotPrint.labels[0].labelCode }, token)).scanInternalLabel;
    assert(lotScan.result === 'success' && lotScan.label.lotId === lot.id, 'Printed inward label must scan back to the exact lot');

    const beforeDisplayBalance = await prisma.inventoryBalance.findUnique({ where: { productId: tile.id } });
    const display = (await gql(`mutation($input: DisplaySampleInput!) { createDisplaySample(input: $input) }`, { input: { productId: tile.id, internalCode: `BT-${suffix}-DISPLAY`, locationId: location.id, displayZone: 'Smoke wall', displayPosition: 'A-01' } }, token)).createDisplaySample;
    lifecycle.displayId = display.id;
    assert(display.sellable === false, 'Display sample must be explicitly non-sellable');
    const displayJob = (await gql(`mutation($input: InternalLabelJobInput!) { createInternalLabelJob(input: $input) }`, { input: { displaySampleId: display.id, quantity: 1, template: 'display_sample' } }, token)).createInternalLabelJob;
    lifecycle.labelJobIds.push(displayJob.id);
    const displayPrint = (await gql(`mutation($id: ID!) { printInternalLabelJob(id: $id) }`, { id: displayJob.id }, token)).printInternalLabelJob;
    assert(displayPrint.labels.length === 1 && displayPrint.labels[0].payload.displaySample === display.sampleNumber && !displayPrint.labels[0].payload.lotNumber, 'Display QR must identify the display record without pretending it is stock');
    const afterDisplayBalance = await prisma.inventoryBalance.findUnique({ where: { productId: tile.id } });
    assert(afterDisplayBalance.onHand === beforeDisplayBalance.onHand && afterDisplayBalance.available === beforeDisplayBalance.available, 'Registering a display sample must not change saleable stock');

    const duplicateUploadId = await uploadWorkbook(buffer, `duplicate-${filename}`, token);
    const duplicatePreview = (await gql(`mutation($uploadId: String!, $filename: String!, $kind: String!) { previewUploadedImport(uploadId: $uploadId, filename: $filename, kind: $kind) { result } }`, { uploadId: duplicateUploadId, filename: `duplicate-${filename}`, kind: 'excel' }, token)).previewUploadedImport.result;
    assert(duplicatePreview.failed === 1 && /already exists/i.test(duplicatePreview.failures[0].error), 'Existing SKU must be blocked and directed to individual Product Master editing');
    await cancelUpload(duplicateUploadId, `duplicate-${filename}`, token);

    const invalidBook = new ExcelJS.Workbook();
    const invalidSheet = invalidBook.addWorksheet('Product Master');
    invalidSheet.addRow(template.headers);
    invalidSheet.addRow([`BAD-${suffix}`, `BAD-${suffix}`, 'Unknown master row', 'Not A Real Category', '', '', '', '', uoms[0], uoms[0], uoms[0], 1, 0, 100, 90, taxCodes[0], '', 'No']);
    const invalidFilename = `invalid-product-master-${suffix}.xlsx`;
    const invalidUploadId = await uploadWorkbook(await invalidBook.xlsx.writeBuffer(), invalidFilename, token);
    const invalidPreview = (await gql(`mutation($uploadId: String!, $filename: String!, $kind: String!) { previewUploadedImport(uploadId: $uploadId, filename: $filename, kind: $kind) { result } }`, { uploadId: invalidUploadId, filename: invalidFilename, kind: 'excel' }, token)).previewUploadedImport.result;
    assert(invalidPreview.failed === 1 && /unknown category/i.test(invalidPreview.failures[0].error), 'Unknown master values must block the entire workbook');
    await cancelUpload(invalidUploadId, invalidFilename, token);

    console.log(JSON.stringify({ ok: true, requestReferences: true, template: { filename: template.filename, masterCounts: template.masterCounts, dropdowns: [...definedNames] }, editableReview: { initialFailed: initialPreview.failed, ready: preview.ready, images: preview.imageCount }, applied: { created: applied.created, updated: applied.updated }, inward: { grnNumber: grn.grnNumber, lotNumber: lot.lotNumber, onHand: 4 }, labels: { lot: lotPrint.labels.length, display: displayPrint.labels.length }, displayStockSeparated: true, protectedExistingSku: duplicatePreview.failed, invalidRowsBlocked: invalidPreview.failed }, null, 2));
  } finally {
    const products = await prisma.product.findMany({ where: { sku: { in: createdSkus } }, select: { id: true } }).catch(() => []);
    const ids = products.map((row) => row.id);
    if (ids.length) {
      const labelInstances = lifecycle.labelJobIds.length ? await prisma.internalLabelInstance.findMany({ where: { labelJobId: { in: lifecycle.labelJobIds } }, select: { id: true } }).catch(() => []) : [];
      await prisma.$transaction(async (tx) => {
        if (labelInstances.length) await tx.internalScanEvent.deleteMany({ where: { labelInstanceId: { in: labelInstances.map((row) => row.id) } } });
        if (lifecycle.labelJobIds.length) await tx.internalLabelJob.deleteMany({ where: { id: { in: lifecycle.labelJobIds } } });
        if (lifecycle.displayId) await tx.displaySample.deleteMany({ where: { id: lifecycle.displayId } });
        await tx.inventoryLotLedgerEntry.deleteMany({ where: { productId: { in: ids } } });
        await tx.stockLedgerEntry.deleteMany({ where: { productId: { in: ids } } });
        if (lifecycle.lotId) await tx.inventoryLotBalance.deleteMany({ where: { lotId: lifecycle.lotId } });
        if (lifecycle.grnId) await tx.goodsReceiptLine.deleteMany({ where: { goodsReceiptNoteId: lifecycle.grnId } });
        if (lifecycle.lotId) await tx.inventoryLot.deleteMany({ where: { id: lifecycle.lotId } });
        if (lifecycle.grnId) await tx.goodsReceiptNote.deleteMany({ where: { id: lifecycle.grnId } });
        await tx.inventoryBalance.deleteMany({ where: { productId: { in: ids } } });
        await tx.productAlias.deleteMany({ where: { productId: { in: ids } } });
        await tx.auditEvent.deleteMany({ where: { OR: [{ entityType: 'Product', entityId: { in: ids } }, ...(lifecycle.grnId ? [{ entityId: lifecycle.grnId }] : []), ...(lifecycle.displayId ? [{ entityId: lifecycle.displayId }] : []), ...(lifecycle.labelJobIds.length ? [{ entityId: { in: lifecycle.labelJobIds } }] : [])] } });
        await tx.product.deleteMany({ where: { id: { in: ids } } });
      }).catch((error) => { console.error(`Cleanup warning: ${error.message}`); });
    }
    const imageRoot = process.env.CATALOGUE_IMAGE_STORAGE_DIR || path.resolve(process.cwd(), 'apps/web/public/catalogue-images');
    for (const name of managedImageNames) fs.rmSync(path.join(imageRoot, 'manual', name), { force: true });
    await prisma.$disconnect();
  }
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
