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

async function processExcelUpload(filePath, token, { apply = true } = {}) {
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
  if (!apply) {
    await gql(`mutation($uploadId: String!, $filename: String!) { cancelImportUpload(uploadId: $uploadId, filename: $filename) { result } }`, { uploadId, filename }, token);
    return { preview, applied: null };
  }
  assert(preview.status === 'ready_to_apply', `Excel preview should be ready_to_apply, got ${preview.status}`);
  assert(preview.total === 1 && preview.failed === 0, `Excel preview should read one clean row, got ${JSON.stringify(preview)}`);
  const applied = (await gql(
    `mutation($uploadId: String!, $filename: String!, $kind: String!, $confirmationToken: String!) { applyUploadedImport(uploadId: $uploadId, filename: $filename, kind: $kind, confirmationToken: $confirmationToken) { result } }`,
    { uploadId, filename, kind: 'excel', confirmationToken: preview.confirmationToken },
    token,
  )).applyUploadedImport.result;
  return { preview, applied };
}

async function writeExcelSample({ minimal = false } = {}) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Catalogue');
  if (minimal) {
    sheet.addRow(['SKU', 'Product Name', 'Category']);
    sheet.addRow([unique('XLSX-MIN'), 'Readiness Excel Minimal SKU', 'Faucets & Showers']);
  } else {
    const sku = unique('XLSX-SKU');
    sheet.addRow(['SKU', 'Internal Code', 'Product Name', 'Category', 'Brand', 'Finish', 'Base UOM', 'Purchase UOM', 'Sales UOM', 'Pieces Per Pack', 'Coverage Per Pack', 'Sell Price', 'Floor Price', 'Tax Code', 'Allow Loose', 'Image URL', 'Description']);
    sheet.addRow([sku, `${sku}-INT`, 'Readiness Excel Imported Basin Mixer', 'Faucets & Showers', 'Readiness Brand', 'Chrome', 'PC', 'PC', 'PC', 1, 0, 4321, 3800, 'GST_18', 'No', '/catalogue-images/manual/readiness-placeholder.png', 'Excel import readiness row']);
  }
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

  const tileCode = unique('TILE').replace(/[^A-Z0-9]/g, '').slice(0, 24);
  const tileSize = (await gql(
    `mutation($input: TileSizeInput!) { saveTileSize(input: $input) { data } }`,
    { input: { name: `${tileCode} 600 x 1200 mm`, code: tileCode } },
    admin.token,
  )).saveTileSize.data;
  assert(tileSize.code === tileCode && tileSize.uom === 'BOX', 'tile master should require only size name and code, defaulting UOM to BOX');
  let missingTileCodeRejected = false;
  try {
    await gql(
      `mutation($input: TileSizeInput!) { saveTileSize(input: $input) { data } }`,
      { input: { name: unique('TILE-MISSING-CODE') } },
      admin.token,
    );
  } catch (error) {
    missingTileCodeRejected = /code is required/i.test(error.message);
  }
  assert(missingTileCodeRejected, 'tile master should reject rows without a code');

  const minimalSku = unique('MIN-SKU');
  const minimalProduct = (await gql(
    `mutation($input: CreateProductInput!) { createProduct(input: $input) { id sku category brand finish sellPrice floorPrice } }`,
    { input: { sku: minimalSku, name: 'Readiness Minimal Optional Fields SKU', category: 'Faucets & Showers' } },
    admin.token,
  )).createProduct;
  assert(minimalProduct.sku === minimalSku && Number(minimalProduct.sellPrice) === 0 && Number(minimalProduct.floorPrice) === 0, 'manual product should require only SKU, name and category');

  const sku = unique('MANUAL-SKU');
  const product = (await gql(
    `mutation($input: CreateProductInput!) { createProduct(input: $input) { id sku media category brand finish sellPrice } }`,
    { input: { sku, name: 'Readiness Manual SKU With Image', category: 'Faucets & Showers', brand: 'Readiness Brand', finish: 'Chrome', dimensions: 'Ready Test', unit: 'PC', sellPrice: 9999, floorPrice: 8500, description: 'Manual SKU smoke with attached image', media: { primary: '/catalogue-images/manual/readiness-placeholder.png', gallery: ['/catalogue-images/manual/readiness-placeholder.png'] } } },
    admin.token,
  )).createProduct;
  assert(product.sku === sku && product.media?.primaryUrl, 'manual SKU should be created with normalized primary image media');

  let directInventoryRejected = false;
  try {
    await gql(
      `mutation($input: CreateInventoryInput!) { createInventory(input: $input) { id } }`,
      { input: { productId: product.id, onHand: 5 } },
      inventory.token,
    );
  } catch (error) {
    directInventoryRejected = /Opening Stock|Goods Receipt Note/i.test(error.message);
  }
  assert(directInventoryRejected, 'direct inventory creation must be rejected so every stock unit has an opening or GRN source');
  const locations = (await gql(`query { stockLocations }`, {}, inventory.token)).stockLocations;
  const location = locations.find((row) => row.defaultStockScope) || locations[0];
  assert(location?.id, 'a stock location is required for the readiness inward test');
  await gql(
    `mutation($input: ManualGoodsReceiptInput!) { createManualGoodsReceipt(input: $input) }`,
    { input: {
      vendorName: 'Readiness lifecycle vendor', supplierChallan: unique('READY-GRN'), locationId: location.id,
      reason: 'Readiness test inward', idempotencyKey: unique('READY-INWARD'),
      lines: JSON.stringify([{ productId: product.id, receivedQuantity: 5, damagedQuantity: 0, unitCost: 8500, locationId: location.id, location: location.name }]),
    } },
    inventory.token,
  );
  const inventoryBalance = (await gql(
    `query($productId: String) { inventoryBalances(productId: $productId, take: 1) { id onHand available product { sku } } }`,
    { productId: product.id },
    inventory.token,
  )).inventoryBalances[0];
  assert(inventoryBalance.onHand === 5 && inventoryBalance.available === 5, 'posted GRN should add five traceable available units');
  const reconciliation = (await gql(
    `query($productId: String) { stockReconciliation(productId: $productId, take: 10) }`,
    { productId: product.id },
    inventory.token,
  )).stockReconciliation;
  const reconciliationRow = reconciliation.rows.find((row) => row.productId === product.id);
  assert(reconciliationRow?.status === 'ok', `inventory create should produce a reconciled stock row, got ${JSON.stringify(reconciliationRow?.issues || [])}`);

  const excelPath = await writeExcelSample();
  const { preview: excelPreview, applied: excelImport } = await processExcelUpload(excelPath, inventory.token);
  assert(excelPreview.ready === 1, `Excel preview should mark one row ready, got ${JSON.stringify(excelPreview)}`);
  assert(excelImport.total === 1, `Excel import should read one row, got ${excelImport.total}`);
  assert(excelImport.applied === 1 && excelImport.failed === 0, `Excel import should apply cleanly, got ${JSON.stringify(excelImport)}`);
  const minimalExcelPath = await writeExcelSample({ minimal: true });
  const { preview: minimalPreview } = await processExcelUpload(minimalExcelPath, inventory.token, { apply: false });
  assert(minimalPreview.status === 'needs_correction' && minimalPreview.failed === 1 && /internal|brand|finish|uom|price|tax/i.test(minimalPreview.failures[0].error), `Incomplete Excel rows must be blocked for browser correction, got ${JSON.stringify(minimalPreview)}`);

  const webHealth = await fetch(WEB);
  assert(webHealth.ok, `web should respond on readiness port, got ${webHealth.status}`);

  console.log(JSON.stringify({
    ok: true,
    createdUser: createdUser.email,
    tileSize: tileSize.code,
    minimalSku: minimalProduct.sku,
    manualSku: product.sku,
    inventoryAvailable: inventoryBalance.available,
    directInventoryRejected,
    excel: { previewReady: excelPreview.ready, applied: excelImport.applied, incompleteRowsBlocked: minimalPreview.failed, created: excelImport.created, updated: excelImport.updated },
    ports: { api: API, web: WEB },
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
