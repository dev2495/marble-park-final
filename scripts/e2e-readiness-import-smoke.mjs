import fs from 'fs';
import path from 'path';
import os from 'os';
import ExcelJS from 'exceljs';

const API = process.env.API_URL || 'http://localhost:4011/graphql';
const WEB = process.env.WEB_URL || 'http://localhost:3011';
const PDF_PATH = process.env.READINESS_PDF || '/Users/devarshthakkar/Downloads/American Standard Pricing Catalogue 2025 (1).pdf';

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

async function writeExcelSample() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Catalogue');
  sheet.addRow(['SKU', 'Product Name', 'Category', 'Brand', 'Finish', 'MRP', 'Dimensions', 'Description']);
  sheet.addRow([unique('XLSX-SKU'), 'Readiness Excel Imported Basin Mixer', 'Faucets & Showers', 'Readiness Brand', 'Chrome', 4321, 'Test 160 mm', 'Excel import readiness row']);
  const filePath = path.join(os.tmpdir(), `marble-readiness-${Date.now()}.xlsx`);
  await workbook.xlsx.writeFile(filePath);
  return filePath;
}

async function main() {
  const [admin, owner, inventory] = await Promise.all([
    login('admin@marblepark.com'),
    login('owner@marblepark.com'),
    login('inventory@marblepark.com'),
  ]);
  assert(admin.user.role === 'admin', 'admin login should return admin role');
  assert(owner.user.role === 'owner', 'owner login should return owner role');

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
    { input: { sku, name: 'Readiness Manual SKU With Image', category: 'Faucets & Showers', brand: 'Readiness Brand', finish: 'Chrome', dimensions: 'Ready Test', unit: 'PC', sellPrice: 9999, floorPrice: 8500, description: 'Manual SKU smoke with attached image', media: { primary: '/catalogue-images/new-style-products-p011-106-98195b773d7d52.png', gallery: ['/catalogue-images/new-style-products-p011-106-98195b773d7d52.png'] } } },
    admin.token,
  )).createProduct;
  assert(product.sku === sku && product.media?.primary, 'manual SKU should be created with primary image media');

  const inventoryBalance = (await gql(
    `mutation($input: CreateInventoryInput!) { createInventory(input: $input) { id onHand available product { sku } } }`,
    { input: { productId: product.id, onHand: 5 } },
    inventory.token,
  )).createInventory;
  assert(inventoryBalance.onHand >= 5 && inventoryBalance.available >= 5, 'inventory inward/create should add available stock');

  const excelPath = await writeExcelSample();
  const excelImport = (await gql(
    `mutation($filePath: String!) { processExcelImport(filePath: $filePath) { result } }`,
    { filePath: excelPath },
    inventory.token,
  )).processExcelImport.result;
  assert(excelImport.total === 1 && excelImport.importBatchId, 'Excel import should stage one row');
  const excelRows = (await gql(`query($id: String!) { importRows(importBatchId: $id) }`, { id: excelImport.importBatchId }, inventory.token)).importRows;
  assert(excelRows.length === 1 && excelRows[0].status === 'pending', 'Excel row should be ready without master-data gaps');
  await gql(`mutation($id: String!) { submitImportBatchForApproval(importBatchId: $id) { result } }`, { id: excelImport.importBatchId }, inventory.token);
  await gql(`mutation($id: String!, $note: String) { approveImportBatch(importBatchId: $id, note: $note) { result } }`, { id: excelImport.importBatchId, note: 'Readiness Excel approval' }, owner.token);
  const excelApply = (await gql(`mutation($id: String!) { applyImportBatch(importBatchId: $id) { result } }`, { id: excelImport.importBatchId }, inventory.token)).applyImportBatch.result;
  assert(excelApply.applied === 1 && excelApply.failed === 0, 'approved Excel batch should apply cleanly');

  assert(fs.existsSync(PDF_PATH), `readiness PDF missing: ${PDF_PATH}`);
  const pdfImport = (await gql(
    `mutation($filePath: String!) { processPdfImport(filePath: $filePath) { result } }`,
    { filePath: PDF_PATH },
    inventory.token,
  )).processPdfImport.result;
  assert(pdfImport.importBatchId, 'PDF import should create an import batch');
  assert(pdfImport.total >= 100, `American Standard PDF should extract at least 100 products, got ${pdfImport.total}`);
  const pdfRows = (await gql(`query($id: String!) { importRows(importBatchId: $id) }`, { id: pdfImport.importBatchId }, inventory.token)).importRows;
  assert(pdfRows.length > 0, 'PDF rows should be available for review');
  const readyRows = pdfRows.filter((row) => row.status === 'pending');
  assert(readyRows.length >= Math.min(50, pdfRows.length), `PDF rows should mostly be ready after inferred brand/category/finish, ready=${readyRows.length}, rows=${pdfRows.length}`);
  assert(readyRows.some((row) => row.brand === 'American Standard'), 'PDF import should infer American Standard brand');
  assert((pdfImport.rowsWithImages || 0) > 0, `PDF import should map product images, got rowsWithImages=${pdfImport.rowsWithImages || 0}`);
  await gql(`mutation($id: String!) { submitImportBatchForApproval(importBatchId: $id) { result } }`, { id: pdfImport.importBatchId }, inventory.token);
  await gql(`mutation($id: String!, $note: String) { approveImportBatch(importBatchId: $id, note: $note) { result } }`, { id: pdfImport.importBatchId, note: 'Readiness PDF extraction approval' }, owner.token);

  const webHealth = await fetch(WEB);
  assert(webHealth.ok, `web should respond on readiness port, got ${webHealth.status}`);

  console.log(JSON.stringify({
    ok: true,
    createdUser: createdUser.email,
    manualSku: product.sku,
    inventoryAvailable: inventoryBalance.available,
    excel: { batch: excelImport.importBatchId, applied: excelApply.applied },
    pdf: { batch: pdfImport.importBatchId, extracted: pdfImport.total, rowsWithImages: pdfImport.rowsWithImages, orphansCreated: pdfImport.orphansCreated, readyRows: readyRows.length },
    ports: { api: API, web: WEB },
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
