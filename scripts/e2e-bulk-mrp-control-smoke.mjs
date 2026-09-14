import bcrypt from 'bcrypt';
import ExcelJS from 'exceljs';
import { PrismaClient } from '@prisma/client';
import { ulid } from 'ulid';

if (process.env.ALLOW_MUTATING_ACCEPTANCE !== 'true' || !/acceptance/i.test(String(process.env.DATABASE_URL || ''))) {
  throw new Error('Run only against an isolated acceptance database with ALLOW_MUTATING_ACCEPTANCE=true.');
}

const API = process.env.API_URL || 'http://127.0.0.1:4000/graphql';
const prisma = new PrismaClient();
const stamp = Date.now().toString(36).toUpperCase();
const cleanup = { productIds: [], userIds: [], batchIds: [] };
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function gql(query, variables = {}, token, expectError = false) {
  const response = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json();
  const message = payload.errors?.map((row) => row.message).join('; ') || '';
  if (expectError) return message;
  if (!response.ok || message) throw new Error(message || `GraphQL ${response.status}`);
  return payload.data;
}

async function login(email, password) {
  return (await gql('mutation($input:LoginInput!){login(input:$input){token}}', { input: { email, password } })).login.token;
}

async function encodeWorkbook(base64, edits) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(base64, 'base64'));
  await edits(workbook);
  return Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64');
}

async function createProduct(index, mrp) {
  const id = `MRP-BULK-${stamp}-${index}`;
  cleanup.productIds.push(id);
  return prisma.product.create({ data: {
    id,
    sku: `MRP-BULK-SKU-${stamp}-${index}`,
    internalCode: `MRP-${stamp}-${index}`,
    name: `Bulk MRP acceptance product ${index}`,
    category: 'Sanitaryware',
    brand: `Bulk Price List ${stamp}`,
    finish: 'Chrome',
    dimensions: 'Acceptance fixture',
    unit: 'PC',
    tags: [],
    mrp: mrp,
    defaultMrpInclusive: mrp,
    defaultNrpInclusive: 800 + index,
    floorPriceInclusive: 700 + index,
    priceRateBasis: 'PIECE',
    priceUom: 'PC',
    taxClass: 'GST18',
    status: 'active',
    media: {},
    sourceRefs: { acceptance: true },
    description: 'Isolated acceptance data',
    baseUom: 'PC',
    purchaseUom: 'PC',
    salesUom: 'PC',
    updatedAt: new Date(),
  } });
}

try {
  const ownerEmail = String(process.env.BOOTSTRAP_OWNER_EMAIL || '').trim().toLowerCase();
  const ownerPassword = String(process.env.BOOTSTRAP_OWNER_PASSWORD || '');
  assert(ownerEmail && ownerPassword, 'Acceptance owner credentials are not configured');
  const ownerToken = await login(ownerEmail, ownerPassword);
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });

  const salesPassword = `Bulk-MRP-${stamp}-Pass!`;
  const sales = await prisma.user.create({ data: {
    id: `MRP-BULK-SALES-${stamp}`,
    name: 'Bulk MRP unauthorised acceptance',
    email: `mrp-bulk-${stamp.toLowerCase()}@marblepark.test`,
    passwordHash: await bcrypt.hash(salesPassword, 12),
    role: 'sales',
    phone: '9000000088',
    active: true,
    permissionOverrides: {},
  } });
  cleanup.userIds.push(sales.id);
  const salesToken = await login(sales.email, salesPassword);
  const permissionError = await gql('query{productMrpBulkFilterOptions}', {}, salesToken, true);
  assert(/owner|admin|permission|author/i.test(permissionError), 'Sales user must be blocked from bulk MRP controls');

  const first = await createProduct(1, 1000);
  const second = await createProduct(2, 2000);
  const missing = await createProduct(3, null);
  const filterData = await gql('query{productMrpBulkFilterOptions}', {}, ownerToken);
  assert(filterData.productMrpBulkFilterOptions.brands.some((row) => row.value === first.brand && row.count === 3), 'Brand filter must expose real matching counts');

  const list = await gql('query($brand:String,$status:String){productPricingReadinessPage(brand:$brand,status:$status,take:20)}', { brand: first.brand, status: 'missing' }, ownerToken);
  assert(list.productPricingReadinessPage.filtered === 1 && list.productPricingReadinessPage.rows[0].id === missing.id, 'Missing MRP tab must retain the dedicated queue');

  const packet = (await gql('query($brand:String,$selectAllMatching:Boolean){productMrpBulkWorkbook(brand:$brand,selectAllMatching:$selectAllMatching)}', { brand: first.brand, selectAllMatching: true }, ownerToken)).productMrpBulkWorkbook;
  assert(packet.selectedCount === 3 && packet.filename.endsWith('.xlsx'), 'Filtered select-all must export all matching products');
  const originalWorkbook = new ExcelJS.Workbook();
  await originalWorkbook.xlsx.load(Buffer.from(packet.contentBase64, 'base64'));
  const sheet = originalWorkbook.getWorksheet('MRP Update');
  assert(sheet && sheet.getColumn(1).hidden && sheet.getColumn(2).hidden && sheet.getColumn(3).hidden, 'Identity, snapshot and signature columns must be hidden');
  assert(sheet.getCell('N4').protection.locked === false && sheet.getCell('M4').protection.locked !== false, 'Only New MRP cells may be unlocked');
  assert(originalWorkbook.getWorksheet('_Marble Park')?.state === 'veryHidden', 'Governed workbook metadata must be very hidden');

  const productRows = new Map();
  for (let row = 4; row <= sheet.rowCount; row += 1) productRows.set(String(sheet.getCell(row, 1).value), row);
  const firstRow = productRows.get(first.id);
  const secondRow = productRows.get(second.id);
  assert(firstRow && secondRow, 'Selected Product Master rows must be present');
  const completed = await encodeWorkbook(packet.contentBase64, async (book) => {
    book.getWorksheet('MRP Update').getCell(firstRow, 14).value = 1250.5;
  });
  const preview = (await gql('mutation($filename:String!,$contentBase64:String!){previewProductMrpBulkWorkbook(filename:$filename,contentBase64:$contentBase64)}', { filename: packet.filename, contentBase64: completed }, ownerToken)).previewProductMrpBulkWorkbook;
  assert(preview.changed === 1 && preview.rows[0].productId === first.id && Number(preview.rows[0].newMrp) === 1250.5, 'Preview must show the exact before and after MRP');
  assert(Number((await prisma.product.findUniqueOrThrow({ where: { id: first.id } })).defaultMrpInclusive) === 1000, 'Preview must not write Product Master');

  const tampered = await encodeWorkbook(packet.contentBase64, async (book) => {
    book.getWorksheet('MRP Update').getCell(firstRow, 6).value = 'Tampered product name';
    book.getWorksheet('MRP Update').getCell(firstRow, 14).value = 1300;
  });
  const tamperError = await gql('mutation($filename:String!,$contentBase64:String!){previewProductMrpBulkWorkbook(filename:$filename,contentBase64:$contentBase64)}', { filename: packet.filename, contentBase64: tampered }, ownerToken, true);
  assert(/protected reference data changed/i.test(tamperError), 'Protected Product Master data tampering must fail closed');

  const before = await prisma.product.findUniqueOrThrow({ where: { id: first.id } });
  const applied = (await gql('mutation($filename:String!,$contentBase64:String!,$token:String!,$reason:String!,$date:String!){applyProductMrpBulkWorkbook(filename:$filename,contentBase64:$contentBase64,confirmationToken:$token,reason:$reason,effectiveFrom:$date)}', {
    filename: packet.filename,
    contentBase64: completed,
    token: preview.confirmationToken,
    reason: 'Acceptance supplier price list revision',
    date: new Date().toISOString(),
  }, ownerToken)).applyProductMrpBulkWorkbook;
  cleanup.batchIds.push(applied.batchId);
  assert(applied.applied === 1, 'One reviewed MRP change must apply');
  const after = await prisma.product.findUniqueOrThrow({ where: { id: first.id } });
  assert(Number(after.defaultMrpInclusive) === 1250.5 && Number(after.mrp) === 1250.5, 'Governed and compatibility MRP must stay in sync');
  assert(Number(after.defaultNrpInclusive) === Number(before.defaultNrpInclusive) && Number(after.floorPriceInclusive) === Number(before.floorPriceInclusive) && after.name === before.name && after.priceUom === before.priceUom, 'Bulk upload must not change NRP, floor, identity or UOM');
  const history = await prisma.productMrpHistory.findMany({ where: { productId: first.id } });
  assert(history.length === 1 && Number(history[0].previousMrpInclusive) === 1000 && Number(history[0].newMrpInclusive) === 1250.5 && history[0].reason.includes('supplier price list'), 'MRP history must retain before, after and reason');
  const audit = await prisma.auditEvent.findMany({ where: { entityId: { in: [first.id, applied.batchId] } } });
  assert(audit.some((row) => row.action === 'product.mrp.bulk_update') && audit.some((row) => row.action === 'product.mrp.bulk_apply'), 'Per-product and batch audit events must both exist');

  const stalePacket = (await gql('query($selectedIds:[String!]){productMrpBulkWorkbook(selectedIds:$selectedIds)}', { selectedIds: [second.id] }, ownerToken)).productMrpBulkWorkbook;
  const staleCompleted = await encodeWorkbook(stalePacket.contentBase64, async (book) => { book.getWorksheet('MRP Update').getCell('N4').value = 2200; });
  await prisma.product.update({ where: { id: second.id }, data: { updatedAt: new Date(Date.now() + 1000) } });
  const staleError = await gql('mutation($filename:String!,$contentBase64:String!){previewProductMrpBulkWorkbook(filename:$filename,contentBase64:$contentBase64)}', { filename: stalePacket.filename, contentBase64: staleCompleted }, ownerToken, true);
  assert(/changed after download|fresh workbook/i.test(staleError), 'Stale workbooks must be rejected before confirmation');

  console.log(JSON.stringify({ ok: true, selectedExport: packet.selectedCount, ownerAdminOnly: true, previewNoWrite: true, tamperRejected: true, staleRejected: true, mrpOnly: true, historyRows: history.length, auditRows: audit.length, batchId: applied.batchId }));
} finally {
  if (cleanup.productIds.length) {
    await prisma.auditEvent.deleteMany({ where: { entityId: { in: [...cleanup.productIds, ...cleanup.batchIds] } } }).catch(() => null);
    await prisma.productMrpHistory.deleteMany({ where: { productId: { in: cleanup.productIds } } }).catch(() => null);
    await prisma.product.deleteMany({ where: { id: { in: cleanup.productIds } } }).catch(() => null);
  }
  if (cleanup.userIds.length) {
    await prisma.session.deleteMany({ where: { userId: { in: cleanup.userIds } } }).catch(() => null);
    await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } }).catch(() => null);
  }
  await prisma.$disconnect();
}
