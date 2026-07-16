import ExcelJS from 'exceljs';
import { PrismaClient } from '@prisma/client';

const API = process.env.API_URL || 'http://localhost:4100/graphql';
const prisma = new PrismaClient();
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function gql(query, variables = {}, token) {
  const response = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ query, variables }) });
  const json = await response.json();
  if (!response.ok || json.errors?.length) throw new Error(json.errors?.map((row) => row.message).join('; ') || `GraphQL request failed (${response.status})`);
  return json.data;
}

async function uploadWorkbook(buffer, filename, token) {
  const begin = await gql(`mutation($filename: String!) { beginImportUpload(filename: $filename) { id result } }`, { filename }, token);
  const uploadId = begin.beginImportUpload.result.uploadId;
  await gql(`mutation($uploadId: String!, $filename: String!, $contentBase64: String!) { appendImportUpload(uploadId: $uploadId, filename: $filename, contentBase64: $contentBase64) { id } }`, { uploadId, filename, contentBase64: Buffer.from(buffer).toString('base64') }, token);
  return uploadId;
}

async function main() {
  const token = (await gql(`mutation($input: LoginInput!) { login(input: $input) { token } }`, { input: { email: 'admin@marblepark.com', password: 'password123' } })).login.token;
  const template = (await gql(`query { productImportTemplate }`, {}, token)).productImportTemplate;
  assert(template.contentBase64 && template.headers.includes('Internal Code') && template.headers.includes('Coverage Per Pack'), 'Downloadable template must expose governed tile fields');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Product Master');
  sheet.addRow(template.headers);
  const suffix = Date.now().toString(36).toUpperCase();
  sheet.addRow([`BULK-TILE-${suffix}`, `BT-${suffix}`, 'Bulk imported porcelain tile', 'Tiles', 'Bulk Brand', 'Satin', 'Porcelain', '600 x 1200 mm', 'PC', 'BOX', 'SQFT', 2, 15.5, 140, 115, 'GST_18', '6907', 'https://example.com/bulk-tile.jpg', 'Exact tile design row']);
  sheet.addRow([`BULK-FAU-${suffix}`, `BF-${suffix}`, 'Bulk imported basin mixer', 'Faucets', 'Bulk Brand', 'Chrome', 'Brass', 'Standard', 'PC', 'PC', 'PC', 1, 0, 8200, 7400, 'GST_18', '8481', 'https://example.com/bulk-faucet.jpg', 'Exact faucet row']);
  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `product-master-${suffix}.xlsx`;
  const uploadId = await uploadWorkbook(buffer, filename, token);
  const preview = (await gql(`mutation($uploadId: String!, $filename: String!, $kind: String!) { previewUploadedImport(uploadId: $uploadId, filename: $filename, kind: $kind) { result } }`, { uploadId, filename, kind: 'excel' }, token)).previewUploadedImport.result;
  assert(preview.status === 'ready_to_apply' && preview.ready === 2 && preview.failed === 0, `Clean governed workbook must preview with two ready rows: ${JSON.stringify(preview)}`);
  assert(preview.previewRows[0].internalCode === `BT-${suffix}` && preview.previewRows[0].coveragePerPack === 15.5, 'Preview must retain showroom code and pack conversion');
  const applied = (await gql(`mutation($uploadId: String!, $filename: String!, $kind: String!) { applyUploadedImport(uploadId: $uploadId, filename: $filename, kind: $kind) { result } }`, { uploadId, filename, kind: 'excel' }, token)).applyUploadedImport.result;
  assert(applied.status === 'applied' && applied.created === 2 && applied.failed === 0, 'Clean workbook must apply atomically');

  const tile = await prisma.product.findUnique({ where: { sku: `BULK-TILE-${suffix}` } });
  assert(tile?.internalCode === `BT-${suffix}` && tile.purchaseUom === 'BOX' && tile.salesUom === 'SQFT' && tile.piecesPerPack === 2 && tile.coveragePerPack === 15.5, 'Imported tile must retain identity and conversion fields');
  assert(tile.categoryId && tile.brandId && tile.finishId && tile.materialId && tile.tileSizeId, 'Imported tile must link governed master IDs');
  const alias = await prisma.productAlias.findUnique({ where: { type_normalizedValue: { type: 'internal_code', normalizedValue: `BT-${suffix}` } } });
  assert(alias?.productId === tile.id, 'Imported internal code must create a searchable alias');
  const search = (await gql(`query($query: String!) { globalSearch(query: $query) { products } }`, { query: `BT-${suffix}` }, token)).globalSearch.products;
  assert(search.some((row) => row.id === tile.id), 'Quote and intent search must find imported showroom code');

  const invalidBook = new ExcelJS.Workbook();
  const invalidSheet = invalidBook.addWorksheet('Product Master');
  invalidSheet.addRow(template.headers);
  invalidSheet.addRow([`BAD-1-${suffix}`, `DUP-${suffix}`, 'Bad duplicate one', 'Tiles', 'Bulk Brand', 'Matt', 'Porcelain', '600 x 600 mm', 'PC', 'BOX', 'SQFT', 4, 15, 100, 90, 'GST_18']);
  invalidSheet.addRow([`BAD-2-${suffix}`, `DUP-${suffix}`, 'Bad duplicate two', 'Tiles', 'Bulk Brand', 'Matt', 'Porcelain', '600 x 600 mm', 'PC', 'BOX', 'SQFT', 4, 15, 100, 90, 'GST_18']);
  const invalidFilename = `invalid-product-master-${suffix}.xlsx`;
  const invalidUploadId = await uploadWorkbook(await invalidBook.xlsx.writeBuffer(), invalidFilename, token);
  const invalidPreview = (await gql(`mutation($uploadId: String!, $filename: String!, $kind: String!) { previewUploadedImport(uploadId: $uploadId, filename: $filename, kind: $kind) { result } }`, { uploadId: invalidUploadId, filename: invalidFilename, kind: 'excel' }, token)).previewUploadedImport.result;
  assert(invalidPreview.failed > 0 && /duplicate internal/i.test(invalidPreview.failures.map((row) => row.error).join(' ')), 'Duplicate internal codes must block the workbook before writes');
  assert(await prisma.product.count({ where: { sku: { in: [`BAD-1-${suffix}`, `BAD-2-${suffix}`] } } }) === 0, 'Preview validation must never write invalid products');

  console.log(JSON.stringify({ ok: true, template: template.filename, preview: { ready: preview.ready, failed: preview.failed }, applied: { created: applied.created, updated: applied.updated }, tile: { sku: tile.sku, internalCode: tile.internalCode, purchaseUom: tile.purchaseUom, salesUom: tile.salesUom, coveragePerPack: tile.coveragePerPack }, invalidRowsBlocked: invalidPreview.failed }, null, 2));
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
