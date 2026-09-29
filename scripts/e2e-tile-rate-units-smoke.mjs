import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { cleanupE2eRecords } from './lib/cleanup-e2e-records.mjs';

// This suite creates commercial records. Keep both the API and the Prisma
// connection pinned to the disposable local database before any mutation.
if (process.env.ALLOW_MUTATING_ACCEPTANCE !== 'true') {
  throw new Error('Set ALLOW_MUTATING_ACCEPTANCE=true for the disposable local database.');
}
const API = new URL(process.env.API_URL || 'http://localhost:4000/graphql');
const database = new URL(process.env.DATABASE_URL || '');
if (API.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(API.hostname) || API.port !== '4000' || API.pathname !== '/graphql') {
  throw new Error('The tile rate GraphQL smoke runs only against localhost:4000/graphql.');
}
if (!['localhost', '127.0.0.1'].includes(database.hostname) || database.port !== '5548' || database.pathname !== '/marble_tile_rate_test') {
  throw new Error('The tile rate GraphQL smoke requires the disposable marble_tile_rate_test database on port 5548.');
}
const EMAIL = process.env.TEST_EMAIL || '';
const PASSWORD = process.env.TEST_PASSWORD || '';
if (EMAIL !== 'tile-rate-owner@local.test' || !PASSWORD) {
  throw new Error('Set the isolated tile-rate owner credentials in TEST_EMAIL and TEST_PASSWORD.');
}

const prisma = new PrismaClient();
const suffix = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`.toUpperCase();
const created = { productIds: [], customerIds: [], quoteIds: [], leadIds: [], brandIds: [], labelJobIds: [], labelRunIds: [] };
const near = (actual, expected, message, tolerance = 0.02) => assert.ok(
  Math.abs(Number(actual) - Number(expected)) <= tolerance,
  `${message}: expected ${expected}, received ${actual}`,
);

async function gql(query, variables = {}, token, expectError = false) {
  const response = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json();
  const error = payload.errors?.map((row) => row.message).join('; ') || '';
  if (expectError) return error;
  if (!response.ok || error) throw new Error(error || `GraphQL ${response.status}`);
  return payload.data;
}

async function main() {
  const dbOwner = await prisma.user.findFirst({ where: { email: EMAIL }, select: { id: true } });
  assert.ok(dbOwner?.id, 'The disposable database must contain the isolated owner.');
  const login = (await gql('mutation($input:LoginInput!){login(input:$input){token user{id role}}}', {
    input: { email: EMAIL, password: PASSWORD },
  })).login;
  assert.ok(login.token && login.user.id === dbOwner.id,
    'The local GraphQL API must authenticate the same owner ID found in the disposable database.');
  const token = login.token;

  const masters = await gql('query{masterProductCategories(status:"active") masterProductBrands(status:"active") masterProductFinishes(status:"active") productMasters internalLabelTemplates}', {}, token);
  const tileCategory = masters.masterProductCategories.find((row) => String(row.name).toLowerCase() === 'tiles');
  let brand = masters.masterProductBrands.find((row) => row.code) || masters.masterProductBrands[0];
  if (!brand) {
    brand = (await gql('mutation($input:ProductBrandInput!){saveProductBrand(input:$input){data}}', {
      input: { name: `Tile Rate Test ${suffix}`, code: `TR${suffix}`.slice(0, 32), status: 'active' },
    }, token)).saveProductBrand.data;
    created.brandIds.push(brand.id);
  }
  const finish = masters.masterProductFinishes[0];
  const tileSize = masters.productMasters?.tileSizes?.[0];
  const template = masters.internalLabelTemplates.find((row) => row.code === 'thermal_4x2' && row.version >= 4);
  assert.ok(tileCategory?.name && brand?.name && finish?.name && template,
    `Tile category, brand, finish and thermal v4 template are required (category=${Boolean(tileCategory)}, brand=${Boolean(brand)}, finish=${Boolean(finish)}, template=${Boolean(template)}).`);

  const baseInput = {
    category: tileCategory.name, brand: brand.name, finish: finish.name,
    dimensions: tileSize?.name || '600 x 1200 mm',
    ...(tileSize?.id ? { tileSizeId: tileSize.id } : {}),
    unit: 'BOX', baseUom: 'PC', purchaseUom: 'BOX', salesUom: 'BOX',
    piecesPerPack: 2, coveragePerPack: 20,
    defaultMrpInclusive: 100, defaultNrpInclusive: 80,
    mrpSource: 'MANUAL', pricingEffectiveFrom: new Date().toISOString(), taxClass: 'GST_18',
  };
  const createProduct = async (tag, priceRateBasis, priceUom) => {
    const sku = `RATE-${tag}-${suffix}`;
    const product = (await gql(
      'mutation($input:CreateProductInput!){createProduct(input:$input){id sku name category priceRateBasis priceUom defaultMrpInclusive defaultNrpInclusive piecesPerPack coveragePerPack}}',
      { input: { ...baseInput, sku, internalCode: sku, name: `Tile rate ${tag} ${suffix}`, priceRateBasis, priceUom } }, token,
    )).createProduct;
    created.productIds.push(product.id);
    return product;
  };
  const pc = await createProduct('PC', 'PIECE', 'PC');
  const sqm = await createProduct('SQM', 'AREA', 'SQM');
  assert.equal(pc.priceUom, 'PC');
  assert.equal(pc.priceRateBasis, 'PIECE');
  assert.equal(sqm.priceUom, 'SQM');
  assert.equal(sqm.priceRateBasis, 'AREA');
  assert.equal((await prisma.product.findUnique({ where: { id: sqm.id } }))?.priceUom, 'SQM',
    'GraphQL product mutations must persist in the verified disposable database.');

  const rejectedSku = `RATE-BAD-${suffix}`;
  const mismatch = await gql('mutation($input:CreateProductInput!){createProduct(input:$input){id}}', {
    input: { ...baseInput, sku: rejectedSku, internalCode: rejectedSku, name: 'Rejected tile unit', priceRateBasis: 'AREA', priceUom: 'PC' },
  }, token, true);
  assert.match(mismatch, /PIECE|basis/i, 'AREA / PC must be rejected by the API.');
  assert.equal(await prisma.product.count({ where: { sku: rejectedSku } }), 0,
    'Rejected unit mismatch must not create a Product Master row.');

  const customer = (await gql('mutation($input:CreateCustomerInput!){createCustomer(input:$input){id}}', {
    input: {
      name: `Tile rate customer ${suffix}`, email: `tile-rate-${suffix.toLowerCase()}@local.test`,
      phone: `9${String(Math.floor(Math.random() * 1000000000)).padStart(9, '0')}`,
      city: 'Local test', address: 'Disposable acceptance database only', forceCreate: true,
    },
  }, token)).createCustomer;
  created.customerIds.push(customer.id);
  const quote = (await gql('mutation($input:CreateQuoteInput!){createQuote(input:$input){id quoteNumber leadId status lines commercialTotal}}', {
    input: {
      quoteType: 'tile', customerId: customer.id, title: `Tile PC and SQM ${suffix}`,
      projectName: 'Disposable tile rate acceptance',
      lines: JSON.stringify([
        {
          productId: pc.id, sku: pc.sku, category: 'Tiles', tileCode: pc.sku,
          tileSize: baseInput.dimensions, requestedPieces: 3, qty: 1,
          unit: 'BOX', inventoryUom: 'BOX', pricingUom: 'PC', rateBasis: 'PIECE',
          nrpMode: 'FIXED_NRP', nrpInput: 80, taxRate: 18, area: 'Piece rate',
        },
        {
          productId: sqm.id, sku: sqm.sku, category: 'Tiles', tileCode: sqm.sku,
          tileSize: baseInput.dimensions, requestedArea: 3, wastagePercent: 0, qty: 1,
          unit: 'BOX', inventoryUom: 'BOX', pricingUom: 'SQM', rateBasis: 'AREA',
          nrpMode: 'FIXED_NRP', nrpInput: 80, taxRate: 18, area: 'Square metre rate',
        },
      ]),
    },
  }, token)).createQuote;
  created.quoteIds.push(quote.id);
  if (quote.leadId) created.leadIds.push(quote.leadId);
  const pieceLine = quote.lines.find((line) => line.sku === pc.sku);
  const areaLine = quote.lines.find((line) => line.sku === sqm.sku);
  assert.ok(pieceLine && areaLine, 'Both tile rates must persist in one quotation.');
  assert.equal(pieceLine.inventoryUom, 'BOX');
  assert.equal(pieceLine.pricingUom, 'PC');
  assert.equal(pieceLine.qty, 2, 'Three requested pieces require two stock boxes.');
  assert.equal(pieceLine.pricingQuantity, 4, 'Four supplied pieces must be billed.');
  near(pieceLine.grossLineTotal, 320, 'PC quote line total');
  assert.equal(areaLine.inventoryUom, 'BOX');
  assert.equal(areaLine.pricingUom, 'SQM');
  assert.equal(areaLine.qty, 2, 'Three requested square metres require two stock boxes.');
  near(areaLine.pricingQuantity, 2 * 20 * 0.09290304, 'SQM quoted quantity', 0.00001);
  near(areaLine.grossLineTotal, 297.29, 'SQM quote line total');
  near(quote.commercialTotal, Number(pieceLine.grossLineTotal) + Number(areaLine.grossLineTotal), 'Quote total reconciliation');

  const job = (await gql('mutation($input:InternalLabelJobInput!){createInternalLabelJob(input:$input)}', {
    input: { productId: sqm.id, quantity: 1, template: 'shelf', priceUom: 'PC', newJob: true },
  }, token)).createInternalLabelJob;
  created.labelJobIds.push(job.id);
  assert.equal(job.metadata?.priceSnapshot?.priceUom, 'PC');
  near(job.metadata.priceSnapshot.mrpInclusive, 92.9, 'Converted PC label rate');
  const preview = (await gql('query($id:ID!){internalLabelPrintData(id:$id)}', { id: job.id }, token)).internalLabelPrintData;
  assert.equal(preview.labels.length, 1, 'Label preview must contain the newly created sticker.');
  assert.equal(preview.labels[0].payload.priceUom, 'PC');
  near(preview.labels[0].payload.mrpInclusive, 92.9, 'Label preview selected PC rate');
  const prepare = async (reason, copies) => (await gql(
    'mutation($input:InternalLabelPrintRunInput!){prepareInternalLabelPrintRun(input:$input)}',
    { input: { labelJobId: job.id, templateCode: template.code, labelSize: '4x2_in', copies, reason } }, token,
  )).prepareInternalLabelPrintRun;
  const firstRun = await prepare('Initial tile unit acceptance', 2);
  created.labelRunIds.push(firstRun.id);
  const first = (await gql('query($id:ID!){internalLabelPrintRun(id:$id)}', { id: firstRun.id }, token)).internalLabelPrintRun;
  assert.equal(first.labels.length, 2);
  for (const label of first.labels) {
    assert.equal(label.payload.priceUom, 'PC');
    assert.equal(label.payload.priceRateBasis, 'PIECE');
    near(label.payload.mrpInclusive, 92.9, 'First-run label snapshot');
    assert.equal(label.qrValue, `MP-LABEL:${label.labelCode}`);
  }

  await gql('mutation($id:ID!,$input:UpdateProductInput!){updateProduct(id:$id,input:$input){id defaultMrpInclusive priceUom}}', {
    id: sqm.id,
    input: { defaultMrpInclusive: 200, defaultNrpInclusive: 160, mrpChangeReason: 'Disposable unit smoke rate revision' },
  }, token);
  const savedFirst = (await gql('query($id:ID!){internalLabelPrintRun(id:$id)}', { id: firstRun.id }, token)).internalLabelPrintRun;
  assert.equal(savedFirst.labels[0].payload.priceUom, 'PC');
  near(savedFirst.labels[0].payload.mrpInclusive, 92.9, 'Saved first run after master rate revision');
  const reprintRun = await prepare('Reprint saved label after master rate revision', 1);
  created.labelRunIds.push(reprintRun.id);
  const reprint = (await gql('query($id:ID!){internalLabelPrintRun(id:$id)}', { id: reprintRun.id }, token)).internalLabelPrintRun;
  assert.equal(reprint.labels.length, 1);
  assert.equal(reprint.labels[0].payload.priceUom, 'PC');
  near(reprint.labels[0].payload.mrpInclusive, 92.9, 'Reprint must retain the original saved PC rate');

  console.log(JSON.stringify({
    ok: true, database: 'marble_tile_rate_test',
    quote: { status: quote.status, pcBoxes: pieceLine.qty, pcBilled: pieceLine.pricingQuantity,
      sqmBoxes: areaLine.qty, sqmBilled: areaLine.pricingQuantity, total: quote.commercialTotal },
    label: { selectedUom: 'PC', rate: reprint.labels[0].payload.mrpInclusive, copiedPages: first.labels.length,
      reprintSnapshotPreserved: true }, invalidMismatchRejected: true,
  }, null, 2));
}

let failure;
try {
  await main();
} catch (error) {
  failure = error;
} finally {
  for (const labelJobId of created.labelJobIds) {
    await prisma.internalLabelPrintRun.deleteMany({ where: { labelJobId } });
    await prisma.internalLabelInstance.deleteMany({ where: { labelJobId } });
    await prisma.internalLabelJob.deleteMany({ where: { id: labelJobId } });
  }
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: [...created.labelJobIds, ...created.labelRunIds] } } });
  await cleanupE2eRecords(prisma, created);
  const residual = await Promise.all([
    prisma.product.count({ where: { id: { in: created.productIds } } }),
    prisma.productBrand.count({ where: { id: { in: created.brandIds } } }),
    prisma.customer.count({ where: { id: { in: created.customerIds } } }),
    prisma.quote.count({ where: { id: { in: created.quoteIds } } }),
    prisma.lead.count({ where: { id: { in: created.leadIds } } }),
    prisma.internalLabelJob.count({ where: { id: { in: created.labelJobIds } } }),
    prisma.internalLabelInstance.count({ where: { labelJobId: { in: created.labelJobIds } } }),
    prisma.internalLabelPrintRun.count({ where: { id: { in: created.labelRunIds } } }),
    prisma.auditEvent.count({ where: { entityId: { in: [...created.productIds, ...created.brandIds, ...created.customerIds, ...created.quoteIds, ...created.labelJobIds, ...created.labelRunIds] } } }),
  ]);
  assert.ok(residual.every((count) => count === 0), `Disposable smoke cleanup left ${residual.join(',')} fixture rows.`);
  await prisma.$disconnect();
}
if (failure) throw failure;
