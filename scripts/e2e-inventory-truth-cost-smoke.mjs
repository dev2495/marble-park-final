import { PrismaClient } from '@prisma/client';
import { ulid } from 'ulid';

const prisma = new PrismaClient();
const API = process.env.API_URL || 'http://127.0.0.1:4011/graphql';
const EMAIL = process.env.TEST_EMAIL || 'admin@marblepark.com';
const PASSWORD = process.env.TEST_PASSWORD || 'password123';
const stamp = Date.now().toString(36).toUpperCase();
const ids = { product: `TRUTH-P-${stamp}`, balance: `TRUTH-B-${stamp}`, lot: `TRUTH-L-${stamp}`, lotBalance: `TRUTH-LB-${stamp}` };

function assert(condition, message) { if (!condition) throw new Error(message); }
async function gql(query, variables = {}, token = '') {
  const response = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ query, variables }) });
  const body = await response.json();
  if (!response.ok || body.errors?.length) throw new Error(body.errors?.map((row) => row.message).join('; ') || `GraphQL ${response.status}`);
  return body.data;
}

try {
  const actor = await prisma.user.findFirst({ where: { email: EMAIL, active: true } });
  const location = await prisma.stockLocation.findFirst({ where: { status: 'active' }, orderBy: { sortOrder: 'asc' } });
  assert(actor && location, 'Test user and active stock location are required');
  await prisma.product.create({ data: { id: ids.product, sku: `TRUTH-${stamp}`, internalCode: `TRUTH-${stamp}`, name: 'Inventory truth cost gate', category: 'Test', brand: 'Test', finish: 'Test', dimensions: '', unit: 'PC', sellPrice: 100, floorPrice: 80, costPrice: 999, taxClass: 'GST_18', status: 'active', tags: [], media: {}, sourceRefs: {}, description: 'Rollback cleanup test', updatedAt: new Date() } });
  await prisma.inventoryBalance.create({ data: { id: ids.balance, productId: ids.product, onHand: 7, available: 7, reserved: 0, damaged: 0, hold: 0, updatedAt: new Date() } });
  await prisma.inventoryLot.create({ data: { id: ids.lot, lotNumber: `TRUTH/${stamp}`, productId: ids.product, sourceType: 'test', sourceId: ids.product, sourceLineId: ids.lot, qualityStatus: 'available', receivedAt: new Date(), unitCost: 0, status: 'active', attributes: {}, metadata: {}, createdBy: actor.id, updatedAt: new Date() } });
  await prisma.inventoryLotBalance.create({ data: { id: ids.lotBalance, lotId: ids.lot, locationId: location.id, onHand: 7, available: 7, reserved: 0, damaged: 0, hold: 0, updatedAt: new Date() } });

  const login = await gql('mutation($input:LoginInput!){login(input:$input){token}}', { input: { email: EMAIL, password: PASSWORD } });
  const token = login.login.token;
  const before = (await gql('query($search:String){inventoryControlTower(search:$search,take:10)}', { search: `TRUTH-${stamp}` }, token)).inventoryControlTower;
  assert(before.items?.[0]?.onHand === 7, 'Control tower must read lot on-hand');
  assert(before.items?.[0]?.onHandValue === 0 && before.items?.[0]?.completenessCodes?.includes('LOT_COST_MISSING'), 'Missing lot cost must be explicit and must not fall back to Product Master cost');

  await gql('mutation($id:ID!,$cost:Float!,$reason:String!){correctMissingInventoryLotCost(id:$id,unitCost:$cost,reason:$reason)}', { id: ids.lot, cost: 25, reason: 'Verified supplier invoice test source' }, token);
  const after = (await gql('query($search:String){inventoryControlTower(search:$search,take:10)}', { search: `TRUTH-${stamp}` }, token)).inventoryControlTower;
  assert(after.items?.[0]?.onHandValue === 175, 'Corrected lot cost must drive stock value');
  assert(!after.items?.[0]?.completenessCodes?.includes('LOT_COST_MISSING'), 'Resolved cost exception remained visible');
  assert(await prisma.auditEvent.count({ where: { action: 'inventory_lot.cost_missing.correct', entityId: ids.lot } }) === 1, 'Cost correction audit was not written');
  console.log(JSON.stringify({ ok: true, quantitySource: 'InventoryLotBalance', costSource: 'InventoryLot.unitCost', missingCost: 'actionable and audited', valueAfter: 175 }, null, 2));
} finally {
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: [ids.product, ids.lot] } } }).catch(() => {});
  await prisma.inventoryLotBalance.deleteMany({ where: { id: ids.lotBalance } }).catch(() => {});
  await prisma.inventoryLot.deleteMany({ where: { id: ids.lot } }).catch(() => {});
  await prisma.inventoryBalance.deleteMany({ where: { id: ids.balance } }).catch(() => {});
  await prisma.product.deleteMany({ where: { id: ids.product } }).catch(() => {});
  await prisma.$disconnect();
}
