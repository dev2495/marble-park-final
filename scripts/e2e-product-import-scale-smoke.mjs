import ExcelJS from 'exceljs';
import { PrismaClient } from '@prisma/client';

const API = process.env.API_URL || 'http://localhost:4000/graphql';
const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@marblepark.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'password123';
const ROW_COUNT = Number(process.env.IMPORT_SCALE_ROWS || 600);
const prisma = new PrismaClient();
const createdSkus = [];

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
  if (!response.ok || payload.errors?.length) throw new Error(payload.errors?.map((error) => error.message).join('; ') || `GraphQL request failed (${response.status})`);
  return payload.data;
}

async function main() {
  const token = (await gql(`mutation($input: LoginInput!) { login(input: $input) { token } }`, { input: { email: TEST_EMAIL, password: TEST_PASSWORD } })).login.token;
  const readiness = (await gql(`query { productImportReadiness }`, {}, token)).productImportReadiness;
  assert(readiness.ready, `Product import preflight is not ready: ${readiness.message}`);
  const options = readiness.options;
  assert(options.categories?.length && options.brands?.length && options.finishes?.length && options.taxCodes?.length, 'Required live master options are missing');

  const suffix = Date.now().toString(36).toUpperCase();
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Product Master');
  sheet.addRow(['SKU *', 'Internal Code *', 'Product Name *', 'Category *', 'Brand *', 'Finish *', 'Material (Optional)', 'Tile Size / Dimensions (Optional)', 'Base UOM (Optional)', 'Purchase UOM (Optional)', 'Sales UOM (Optional)', 'Pieces Per Pack (Optional)', 'Coverage Per Pack (Optional)', 'Sell Price (Optional)', 'Floor Price (Optional)', 'Tax Code *', 'HSN Code (Optional)', 'Allow Loose (Optional)', 'Range / Series (Optional)', 'Image URL (Optional)', 'Product Image (Optional)', 'Description (Optional)']);
  for (let index = 0; index < ROW_COUNT; index += 1) {
    const serial = String(index + 1).padStart(4, '0');
    const sku = `SCALE-${suffix}-${serial}`;
    createdSkus.push(sku);
    sheet.addRow([sku, `SC-${suffix}-${serial}`, `Scale verification SKU ${serial}`, options.categories[0], options.brands[0], options.finishes[0], '', '', 'PC', 'PC', 'PC', 1, 0, index + 1, 0, options.taxCodes[0]]);
  }
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const filename = `product-import-scale-${suffix}.xlsx`;
  const begin = await gql(`mutation($filename: String!) { beginImportUpload(filename: $filename) { result } }`, { filename }, token);
  const uploadId = begin.beginImportUpload.result.uploadId;
  for (let offset = 0; offset < buffer.length; offset += 2 * 1024 * 1024) {
    await gql(`mutation($uploadId: String!, $filename: String!, $contentBase64: String!) { appendImportUpload(uploadId: $uploadId, filename: $filename, contentBase64: $contentBase64) { id } }`, { uploadId, filename, contentBase64: buffer.subarray(offset, offset + 2 * 1024 * 1024).toString('base64') }, token);
  }

  const previewStarted = Date.now();
  const preview = (await gql(`mutation($uploadId: String!, $filename: String!, $kind: String!) { previewUploadedImport(uploadId: $uploadId, filename: $filename, kind: $kind) { result } }`, { uploadId, filename, kind: 'excel' }, token)).previewUploadedImport.result;
  const previewMs = Date.now() - previewStarted;
  assert(preview.total === ROW_COUNT && preview.ready === ROW_COUNT && preview.failed === 0 && preview.previewRows.length === ROW_COUNT, `Scale preview did not validate every row: ${JSON.stringify({ total: preview.total, ready: preview.ready, failed: preview.failed, previewRows: preview.previewRows?.length })}`);

  const applyStarted = Date.now();
  const applied = (await gql(`mutation($uploadId: String!, $filename: String!, $kind: String!, $confirmationToken: String!, $reviewRows: JSON) { applyUploadedImport(uploadId: $uploadId, filename: $filename, kind: $kind, confirmationToken: $confirmationToken, reviewRows: $reviewRows) { result } }`, { uploadId, filename, kind: 'excel', confirmationToken: preview.confirmationToken, reviewRows: [] }, token)).applyUploadedImport.result;
  const applyMs = Date.now() - applyStarted;
  assert(applied.status === 'applied' && applied.created === ROW_COUNT && applied.failed === 0, `Scale apply failed: ${JSON.stringify(applied)}`);
  const persisted = await prisma.product.count({ where: { sku: { in: createdSkus } } });
  assert(persisted === ROW_COUNT, `Expected ${ROW_COUNT} persisted SKUs, found ${persisted}`);

  console.log(JSON.stringify({ ok: true, rows: ROW_COUNT, bytes: buffer.length, previewMs, applyMs, created: applied.created }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}).finally(async () => {
  const products = await prisma.product.findMany({ where: { sku: { in: createdSkus } }, select: { id: true } }).catch(() => []);
  const productIds = products.map((row) => row.id);
  if (productIds.length) {
    await prisma.inventoryBalance.deleteMany({ where: { productId: { in: productIds } } }).catch(() => null);
    await prisma.productAlias.deleteMany({ where: { productId: { in: productIds } } }).catch(() => null);
    await prisma.auditEvent.deleteMany({ where: { entityType: 'Product', entityId: { in: productIds } } }).catch(() => null);
    await prisma.product.deleteMany({ where: { id: { in: productIds } } }).catch(() => null);
  }
  await prisma.$disconnect();
});
