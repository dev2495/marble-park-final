import fs from 'fs';
import path from 'path';
import os from 'os';
import ExcelJS from 'exceljs';

const API = process.env.API_URL || 'http://localhost:4011/graphql';
const WEB = process.env.WEB_URL || 'http://localhost:3011';

async function gql(query, variables = {}, token) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join('; '));
  return json.data;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function unique(prefix) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
}

async function login(email) {
  return (await gql(
    `mutation($input: LoginInput!) { login(input: $input) { token user { id email role name } } }`,
    { input: { email, password: 'password123' } },
  )).login;
}

async function processExcelUpload(filePath, token) {
  const filename = path.basename(filePath);
  const begin = (await gql(
    `mutation($filename: String!) { beginImportUpload(filename: $filename) { result } }`,
    { filename },
    token,
  )).beginImportUpload.result;
  const uploadId = begin.uploadId;
  assert(uploadId, 'upload session should be created');
  const buffer = fs.readFileSync(filePath);
  const chunkSize = 512 * 1024;
  for (let offset = 0; offset < buffer.length; offset += chunkSize) {
    const contentBase64 = buffer.subarray(offset, offset + chunkSize).toString('base64');
    await gql(
      `mutation($uploadId: String!, $filename: String!, $contentBase64: String!) { appendImportUpload(uploadId: $uploadId, filename: $filename, contentBase64: $contentBase64) { result } }`,
      { uploadId, filename, contentBase64 },
      token,
    );
  }
  const preview = (await gql(
    `mutation($uploadId: String!, $filename: String!, $kind: String!) { previewUploadedImport(uploadId: $uploadId, filename: $filename, kind: $kind) { result } }`,
    { uploadId, filename, kind: 'excel' },
    token,
  )).previewUploadedImport.result;
  assert(preview.status === 'ready_to_apply', `Excel preview should be ready_to_apply, got ${preview.status}`);
  assert(preview.total === 1 && preview.failed === 0, `Excel preview should read one clean row, got ${JSON.stringify(preview)}`);
  const applied = (await gql(
    `mutation($uploadId: String!, $filename: String!, $kind: String!) { applyUploadedImport(uploadId: $uploadId, filename: $filename, kind: $kind) { result } }`,
    { uploadId, filename, kind: 'excel' },
    token,
  )).applyUploadedImport.result;
  return { preview, applied };
}

async function writeExcelSample() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Catalogue');
  sheet.addRow(['SKU', 'Product Name', 'Category', 'Brand', 'Finish', 'MRP', 'Floor Price', 'Dimensions', 'Image URL', 'Description']);
  sheet.addRow([unique('XLSX-SKU'), 'Readiness Excel Imported Basin Mixer', 'Faucets & Showers', 'Readiness Brand', 'Chrome', 4321, 3800, 'Test 160 mm', '/catalogue-images/manual/readiness-placeholder.png', 'Excel import readiness row']);
  const filePath = path.join(os.tmpdir(), `marble-readiness-${Date.now()}.xlsx`);
  await workbook.xlsx.writeFile(filePath);
  return filePath;
}

async function main() {
  const [admin, inventory] = await Promise.all([
    login('admin@marblepark.com'),
    login('inventory@marblepark.com'),
  ]);
  assert(admin.user.role === 'admin', 'admin login should return admin role');

  const newEmail = `readiness-${Date.now()}@example.com`;
  const createdUser = (await gql(
    `mutation($input: CreateUserInput!) { createUser(input: $input) { id email role active } }`,
    { input: { name: 'Readiness Office Staff', email: newEmail, password: 'password123', role: 'office_staff', phone: '9000000099' } },
    admin.token,
  )).createUser;
  assert(createdUser.email === newEmail && createdUser.role === 'office_staff' && createdUser.active, 'admin should create office staff user');
  const newLogin = await gql(
    `mutation($input: LoginInput!) { login(input: $input) { token user { email role } } }`,
    { input: { email: newEmail, password: 'password123' } },
  );
  assert(newLogin.login.user.email === newEmail, 'created office staff user should be able to log in');

  const sku = unique('MANUAL-SKU');
  const product = (await gql(
    `mutation($input: CreateProductInput!) { createProduct(input: $input) { id sku media category brand finish sellPrice } }`,
    { input: { sku, name: 'Readiness Manual SKU With Image', category: 'Faucets & Showers', brand: 'Readiness Brand', finish: 'Chrome', dimensions: 'Ready Test', unit: 'PC', sellPrice: 9999, floorPrice: 8500, description: 'Manual SKU smoke with attached image', media: { primary: '/catalogue-images/manual/readiness-placeholder.png', gallery: ['/catalogue-images/manual/readiness-placeholder.png'] } } },
    admin.token,
  )).createProduct;
  assert(product.sku === sku && product.media?.primary, 'manual SKU should be created with primary image media');

  const inventoryBalance = (await gql(
    `mutation($input: CreateInventoryInput!) { createInventory(input: $input) { id onHand available product { sku } } }`,
    { input: { productId: product.id, onHand: 5 } },
    inventory.token,
  )).createInventory;
  assert(inventoryBalance.onHand >= 5 && inventoryBalance.available >= 5, 'inventory create should add available stock');

  const excelPath = await writeExcelSample();
  const { preview: excelPreview, applied: excelImport } = await processExcelUpload(excelPath, inventory.token);
  assert(excelPreview.ready === 1, `Excel preview should mark one row ready, got ${JSON.stringify(excelPreview)}`);
  assert(excelImport.total === 1, `Excel import should read one row, got ${excelImport.total}`);
  assert(excelImport.applied === 1 && excelImport.failed === 0, `Excel import should apply cleanly, got ${JSON.stringify(excelImport)}`);

  const webHealth = await fetch(WEB);
  assert(webHealth.ok, `web should respond on readiness port, got ${webHealth.status}`);

  console.log(JSON.stringify({
    ok: true,
    createdUser: createdUser.email,
    manualSku: product.sku,
    inventoryAvailable: inventoryBalance.available,
    excel: { previewReady: excelPreview.ready, applied: excelImport.applied, created: excelImport.created, updated: excelImport.updated },
    ports: { api: API, web: WEB },
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
