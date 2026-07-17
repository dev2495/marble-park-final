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
  try {
    const token = (await gql(`mutation($input: LoginInput!) { login(input: $input) { token } }`, { input: { email: TEST_EMAIL, password: TEST_PASSWORD } })).login.token;
    const template = (await gql(`query { productImportTemplate }`, {}, token)).productImportTemplate;
    assert(template.contentBase64 && template.headers.includes('Internal Code') && template.headers.includes('Coverage Per Pack') && template.headers.includes('Product Image'), 'Template must expose governed product and embedded-image fields');

    const downloaded = new ExcelJS.Workbook();
    await downloaded.xlsx.load(Buffer.from(template.contentBase64, 'base64'));
    const productSheet = downloaded.getWorksheet('Product Master');
    const lists = downloaded.getWorksheet('Live Master Lists');
    assert(productSheet && lists && downloaded.getWorksheet('How to use') && downloaded.getWorksheet('Reference details'), 'Template must include product, instructions, live lists and reference sheets');
    const definedNames = new Set(downloaded.definedNames.model.map((row) => row.name));
    for (const name of ['Categories', 'Brands', 'Finishes', 'Materials', 'TileSizes', 'UOMs', 'TaxCodes', 'YesNo']) assert(definedNames.has(name), `Template is missing ${name} dropdown range`);
    assert(productSheet.getCell('D2').dataValidation?.formulae?.[0] === 'Categories', 'Category cells must use the live Categories dropdown');

    const categories = listValues(lists, 1);
    const brands = listValues(lists, 2);
    const finishes = listValues(lists, 3);
    const materials = listValues(lists, 4);
    const tileSizes = listValues(lists, 5);
    const uoms = listValues(lists, 6);
    const taxCodes = listValues(lists, 7);
    const tileCategory = categories.find((value) => value.toLowerCase() === 'tiles');
    assert(tileCategory && tileSizes.length && uoms.length && taxCodes.length, 'Live DB must contain Tiles, tile sizes, UOMs and tax codes for the import flow');

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Product Master');
    sheet.addRow(template.headers);
    const suffix = Date.now().toString(36).toUpperCase();
    const sku = `BULK-TILE-${suffix}`;
    createdSkus.push(sku);
    const purchaseUom = uoms.includes('BOX') ? 'BOX' : uoms[0];
    const salesUom = uoms.includes('SQFT') ? 'SQFT' : uoms[0];
    const coverage = ['SQFT', 'SQM', 'M2'].includes(salesUom) ? 15.5 : 0;
    sheet.addRow([sku, `BT-${suffix}`, 'Bulk imported porcelain tile', tileCategory, brands[0] || '', finishes[0] || '', materials[0] || '', tileSizes[0], uoms.includes('PC') ? 'PC' : uoms[0], purchaseUom, salesUom, 2, coverage, 140, 115, taxCodes[0], '6907', 'No', 'Smoke series', '', '', 'Exact tile design row']);
    sheet.getRow(2).height = 48;
    const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nDMAAAAASUVORK5CYII=', 'base64');
    const imageId = workbook.addImage({ buffer: pixel, extension: 'png' });
    sheet.addImage(imageId, { tl: { col: 20, row: 1 }, ext: { width: 42, height: 42 } });
    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `product-master-${suffix}.xlsx`;
    const uploadId = await uploadWorkbook(buffer, filename, token);
    const preview = (await gql(`mutation($uploadId: String!, $filename: String!, $kind: String!) { previewUploadedImport(uploadId: $uploadId, filename: $filename, kind: $kind) { result } }`, { uploadId, filename, kind: 'excel' }, token)).previewUploadedImport.result;
    assert(preview.status === 'ready_to_apply' && preview.ready === 1 && preview.failed === 0 && preview.confirmationToken, `Clean workbook must return one confirmed preview row: ${JSON.stringify(preview)}`);
    assert(preview.previewRows[0].internalCode === `BT-${suffix}` && preview.previewRows[0].imageStatus === 'embedded_image_detected', 'Preview must retain showroom code and detect the embedded row image');

    const unconfirmedUploadId = await uploadWorkbook(buffer, `unconfirmed-${filename}`, token);
    const unconfirmedError = await gql(`mutation($uploadId: String!, $filename: String!, $kind: String!, $confirmationToken: String!) { applyUploadedImport(uploadId: $uploadId, filename: $filename, kind: $kind, confirmationToken: $confirmationToken) { result } }`, { uploadId: unconfirmedUploadId, filename: `unconfirmed-${filename}`, kind: 'excel', confirmationToken: 'not-confirmed' }, token, true);
    assert(/not been confirmed/i.test(unconfirmedError), 'Apply must reject a workbook without its signed preview confirmation');

    const applied = (await gql(`mutation($uploadId: String!, $filename: String!, $kind: String!, $confirmationToken: String!) { applyUploadedImport(uploadId: $uploadId, filename: $filename, kind: $kind, confirmationToken: $confirmationToken) { result } }`, { uploadId, filename, kind: 'excel', confirmationToken: preview.confirmationToken }, token)).applyUploadedImport.result;
    assert(applied.status === 'applied' && applied.created === 1 && applied.updated === 0 && applied.failed === 0, 'Confirmed workbook must create new SKUs atomically without updates');

    const tile = await prisma.product.findUnique({ where: { sku }, include: { balances: true } });
    assert(tile?.internalCode === `BT-${suffix}` && tile.purchaseUom === purchaseUom && tile.salesUom === salesUom && tile.piecesPerPack === 2 && tile.coveragePerPack === coverage, 'Imported tile must retain identity, units and pack conversion');
    assert(tile.categoryId && tile.tileSizeId && tile.balances?.onHand === 0, 'Imported SKU must link governed masters and start with zero physical stock');
    assert(tile.media?.primaryUrl?.includes('/catalogue-images/manual/'), 'Embedded image must become managed Product Master media');
    managedImageNames.push(path.basename(tile.media.primaryUrl));

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

    console.log(JSON.stringify({ ok: true, template: { filename: template.filename, masterCounts: template.masterCounts, dropdowns: [...definedNames] }, preview: { ready: preview.ready, images: preview.imageCount }, applied: { created: applied.created, updated: applied.updated }, protectedExistingSku: duplicatePreview.failed, invalidRowsBlocked: invalidPreview.failed }, null, 2));
  } finally {
    const products = await prisma.product.findMany({ where: { sku: { in: createdSkus } }, select: { id: true } }).catch(() => []);
    const ids = products.map((row) => row.id);
    if (ids.length) {
      await prisma.$transaction([
        prisma.inventoryBalance.deleteMany({ where: { productId: { in: ids } } }),
        prisma.product.deleteMany({ where: { id: { in: ids } } }),
        prisma.auditEvent.deleteMany({ where: { entityType: 'Product', entityId: { in: ids } } }),
      ]).catch(() => null);
    }
    const imageRoot = process.env.CATALOGUE_IMAGE_STORAGE_DIR || path.resolve(process.cwd(), 'apps/web/public/catalogue-images');
    for (const name of managedImageNames) fs.rmSync(path.join(imageRoot, 'manual', name), { force: true });
    await prisma.$disconnect();
  }
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
