import { PrismaClient } from '@prisma/client';

if (process.env.ALLOW_MUTATING_ACCEPTANCE !== 'true') {
  throw new Error('Refusing to mutate data. Run only against an isolated acceptance database with ALLOW_MUTATING_ACCEPTANCE=true.');
}

const API = process.env.API_URL || 'http://localhost:4000/graphql';
const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@marblepark.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'password123';
const prisma = new PrismaClient();
const createdIds = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function gql(query, variables = {}, token, expectError = false) {
  const response = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  const json = await response.json();
  const error = json.errors?.map((row) => row.message).join('; ') || '';
  if (expectError) return error;
  if (!response.ok || error) throw new Error(error || `GraphQL request failed (${response.status})`);
  return json.data;
}

async function createProduct(input, token) {
  const product = (await gql(
    `mutation($input: CreateProductInput!) {
      createProduct(input: $input) {
        id sku internalCode category status hsnCode media
        tileSizeId unit baseUom purchaseUom salesUom piecesPerPack coveragePerPack allowLoose
        defaultMrpInclusive defaultNrpInclusive floorPriceInclusive priceRateBasis priceUom
      }
    }`,
    { input },
    token,
  )).createProduct;
  createdIds.push(product.id);
  return product;
}

async function cleanup() {
  if (!createdIds.length) return;
  await prisma.$transaction(async (tx) => {
    await tx.inventoryBalance.deleteMany({ where: { productId: { in: createdIds } } });
    await tx.productAlias.deleteMany({ where: { productId: { in: createdIds } } });
    await tx.auditEvent.deleteMany({ where: { entityType: 'Product', entityId: { in: createdIds } } });
    await tx.product.deleteMany({ where: { id: { in: createdIds } } });
  });
}

async function main() {
  try {
    const token = (await gql(
      `mutation($input: LoginInput!) { login(input: $input) { token } }`,
      { input: { email: TEST_EMAIL, password: TEST_PASSWORD } },
    )).login.token;
    const suffix = Date.now().toString(36).toUpperCase();

    const missingMrp = await gql(
      'mutation($input:CreateProductInput!){createProduct(input:$input){id}}',
      { input: { sku: `MISSING-MRP-${suffix}`, internalCode: `MM-${suffix}`, name: 'Missing MRP guard', category: 'Faucets & Showers' } },
      token,
      true,
    );
    assert(/MRP is required/i.test(missingMrp), 'Product Master must reject every new SKU without positive MRP');

    const product = await createProduct({
      sku: `OPTIONAL-PC-${suffix}`,
      internalCode: `OP-${suffix}`,
      name: 'Optional field product smoke',
      category: 'Faucets & Showers',
      status: 'inactive',
      defaultMrpInclusive: 1000,
    }, token);
    assert(product.status === 'inactive', 'CreateProductInput must accept and persist status');
    assert(Number(product.defaultMrpInclusive) === 1000 && product.defaultNrpInclusive === null && product.floorPriceInclusive === null, 'MRP must persist while NRP and floor remain optional');
    assert(product.hsnCode === null && !product.media?.primaryUrl, 'HSN and image must remain optional');
    assert(product.unit === 'PC' && product.baseUom === 'PC' && product.purchaseUom === 'PC' && product.salesUom === 'PC', 'Non-tile SKU must receive PC unit defaults');

    const tile = await createProduct({
      sku: `OPTIONAL-TILE-${suffix}`,
      internalCode: `OT-${suffix}`,
      name: 'Optional tile details smoke',
      category: 'Tiles',
      status: 'active',
      defaultMrpInclusive: 125,
    }, token);
    assert(!tile.tileSizeId && Number(tile.defaultMrpInclusive) === 125 && Number(tile.coveragePerPack) === 0, 'Tile size and coverage may be completed later, but MRP is mandatory');
    assert(tile.priceRateBasis === 'AREA' && tile.priceUom === 'SQFT', 'Tile Product Master MRP must always be governed per SQFT');
    assert(tile.unit === 'BOX' && tile.baseUom === 'PC' && tile.purchaseUom === 'BOX' && tile.salesUom === 'BOX' && tile.piecesPerPack === 1, 'Tile SKU must receive safe box defaults');

    const areaTile = await createProduct({
      sku: `OPTIONAL-AREA-${suffix}`,
      internalCode: `OA-${suffix}`,
      name: 'Incomplete area conversion smoke',
      category: 'Tiles',
      purchaseUom: 'BOX',
      salesUom: 'SQFT',
      defaultMrpInclusive: 150,
    }, token);
    assert(areaTile.salesUom === 'SQFT' && Number(areaTile.coveragePerPack) === 0, 'Product Master must allow area UOM before optional coverage is known');

    console.log(JSON.stringify({
      ok: true,
      manualCreate: { statusAccepted: true, mrpRequired: true, optionalNrp: true, optionalFloor: true, optionalHsn: true, optionalImage: true },
      tiles: { mrpPerSqft: true, optionalSize: true, optionalBoxConversion: true, defaults: 'PC/BOX/BOX' },
    }, null, 2));
  } finally {
    await cleanup().catch((error) => console.error(`Cleanup warning: ${error.message}`));
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
