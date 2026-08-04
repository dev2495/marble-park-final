import { PrismaClient } from '@prisma/client';

const API = process.env.API_URL || 'http://localhost:4000/graphql';
const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@marblepark.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'password123';
const prisma = new PrismaClient();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function gql(query, variables = {}, token) {
  const response = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  const json = await response.json();
  if (!response.ok || json.errors?.length) throw new Error(json.errors?.map((error) => error.message).join('; ') || `GraphQL request failed (${response.status})`);
  return json.data;
}

async function main() {
  const location = await prisma.stockLocation.findFirst({
    where: { lotBalances: { some: { lot: { status: 'active' } } } },
    orderBy: { code: 'asc' },
  });
  assert(location, 'A stock location with active lot balances is required');

  const directRows = await prisma.$queryRawUnsafe(
    `SELECT
       COALESCE(SUM(lb."onHand"), 0)::double precision AS "total",
       COALESCE(SUM(lb."available"), 0)::double precision AS "available",
       COALESCE(SUM(lb."reserved"), 0)::double precision AS "reserved",
       COALESCE(SUM(lb."hold"), 0)::double precision AS "hold",
       COALESCE(SUM(lb."damaged"), 0)::double precision AS "damaged"
     FROM "InventoryLotBalance" lb
     INNER JOIN "InventoryLot" lot ON lot."id" = lb."lotId" AND lot."status" = 'active'
     WHERE lb."locationId" = $1`,
    location.id,
  );
  const expected = directRows[0];
  const login = await gql(
    `mutation($input: LoginInput!) { login(input: $input) { token } }`,
    { input: { email: TEST_EMAIL, password: TEST_PASSWORD } },
  );
  const result = await gql(
    `query($locationId: String, $take: Int) { inventoryControlTower(locationId: $locationId, take: $take) }`,
    { locationId: location.id, take: 100 },
    login.login.token,
  );
  const summary = result.inventoryControlTower.summary;
  for (const field of ['total', 'available', 'reserved', 'hold', 'damaged']) {
    assert(Number(summary[field]) === Number(expected[field]), `${field} must be scoped to ${location.code}: API=${summary[field]} DB=${expected[field]}`);
  }
  for (const item of result.inventoryControlTower.items) {
    const locationTotal = (item.lots || []).flatMap((lot) => lot.locations || []).reduce((sum, balance) => sum + Number(balance.onHand || 0), 0);
    assert(Number(item.onHand) === locationTotal, `${item.product?.sku || item.productId} row total must match its selected-location lots`);
  }
  console.log(JSON.stringify({ ok: true, location: location.code, products: result.inventoryControlTower.total, totals: summary }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
