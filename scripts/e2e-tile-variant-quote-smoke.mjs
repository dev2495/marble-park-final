import { PrismaClient } from '@prisma/client';
import { writeFile } from 'node:fs/promises';
import { cleanupE2eRecords } from './lib/cleanup-e2e-records.mjs';

if (process.env.ALLOW_MUTATING_ACCEPTANCE !== 'true') {
  throw new Error('Refusing to mutate data. Run only against an isolated acceptance database with ALLOW_MUTATING_ACCEPTANCE=true.');
}

const API = process.env.API_URL || 'http://127.0.0.1:4100/graphql';
const APP_URL = process.env.APP_URL || 'http://127.0.0.1:3100';
const TEST_EMAIL = process.env.TEST_EMAIL || '';
const TEST_PASSWORD = process.env.TEST_PASSWORD || '';
const prisma = new PrismaClient();
const cleanup = { productIds: [], customerIds: [], quoteIds: [], leadIds: [] };
const designIds = [];
let acceptanceSizeId = '';

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const close = (actual, expected, message) => assert(Math.abs(Number(actual) - Number(expected)) <= 0.02, `${message}: expected ${expected}, received ${actual}`);

async function gql(query, variables = {}, token, expectError = false) {
  const response = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json();
  const error = payload.errors?.map((row) => row.message).join('; ') || '';
  if (expectError) return error;
  if (!response.ok || error) throw new Error(error || `GraphQL request failed (${response.status})`);
  return payload.data;
}

async function main() {
  assert(TEST_EMAIL && TEST_PASSWORD, 'TEST_EMAIL and TEST_PASSWORD are required');
  const token = (await gql('mutation($input:LoginInput!){login(input:$input){token}}', { input: { email: TEST_EMAIL, password: TEST_PASSWORD } })).login.token;
  const suffix = Date.now().toString(36).toUpperCase();
  const masters = await gql('query{tileSizes(status:"active") masterProductBrands(status:"active") masterProductFinishes(status:"active")}', {}, token);
  let size = masters.tileSizes.find((row) => Number(row.areaPerBoxSqFt || 0) > 0 || Number(row.areaPerPieceSqFt || 0) > 0);
  if (!size) {
    const widthMm = 300;
    const heightMm = 300;
    const piecesPerBox = 4;
    const areaPerPieceSqM = (widthMm * heightMm) / 1_000_000;
    const areaPerPieceSqFt = areaPerPieceSqM * 10.76391041671;
    acceptanceSizeId = `tile-size-${suffix.toLowerCase()}`;
    await prisma.tileSize.create({ data: {
      id: acceptanceSizeId,
      name: `Acceptance ${suffix} 300 x 300 mm`,
      code: `ACC-${suffix}`,
      widthMm,
      heightMm,
      pcsPerBox: piecesPerBox,
      areaPerPieceSqM,
      areaPerPieceSqFt,
      areaPerBoxSqM: areaPerPieceSqM * piecesPerBox,
      areaPerBoxSqFt: areaPerPieceSqFt * piecesPerBox,
      status: 'active',
      updatedAt: new Date(),
    } });
    size = (await gql('query{tileSizes(status:"active")}', {}, token)).tileSizes.find((row) => row.id === acceptanceSizeId);
  }
  const brand = masters.masterProductBrands[0]?.name;
  const finish = masters.masterProductFinishes[0]?.name;
  assert(size?.id && brand && finish, 'Active Tile Size, Brand and Finish masters are required');

  const design = (await gql(
    'mutation($input:TileDesignInput!){saveTileDesign(input:$input)}',
    { input: { designCode: `TQ-${suffix}`, name: `Tile quote acceptance ${suffix}`, brand, status: 'active' } }, token,
  )).saveTileDesign;
  designIds.push(design.id);
  const alias = `SUP-TQ-${suffix}`;
  const variant = (await gql(
    'mutation($input:TileVariantInput!){saveTileVariant(input:$input){id sku internalCode name category brand finish dimensions purchaseUom salesUom piecesPerPack coveragePerPack defaultMrpInclusive defaultNrpInclusive priceRateBasis priceUom tileDesignId tileSizeId}}',
    { input: {
      tileDesignId: design.id,
      tileSizeId: size.id,
      finish,
      piecesPerPack: Math.max(1, Number(size.pcsPerBox || 1)),
      purchaseUom: 'BOX',
      salesUom: 'BOX',
      allowLoose: false,
      defaultMrpInclusive: 688,
      defaultNrpInclusive: 640,
      priceRateBasis: 'AREA',
      priceUom: 'SQFT',
      mrpSource: 'MANUAL',
      pricingEffectiveFrom: new Date().toISOString(),
      alias,
      status: 'active',
    } }, token,
  )).saveTileVariant;
  cleanup.productIds.push(variant.id);
  assert(variant.tileDesignId === design.id && variant.tileSizeId === size.id, 'Variant must keep the governed design and size');
  assert(Number(variant.defaultMrpInclusive) === 688 && Number(variant.defaultNrpInclusive) === 640, 'Variant must retain quote-ready MRP and NRP defaults');
  assert(variant.priceRateBasis === 'AREA' && variant.priceUom === 'SQFT', 'Tile variants must always govern MRP per SQFT');

  const aliases = (await gql('query($productId:ID!){productAliases(productId:$productId)}', { productId: variant.id }, token)).productAliases;
  assert(aliases.some((row) => row.type === 'internal_code' && row.status === 'active'), 'Variant must have its permanent internal-code alias');
  assert(aliases.some((row) => row.type === 'supplier_sku' && row.normalizedValue === alias), 'Supplier alias must be saved in the same variant lifecycle');
  const search = (await gql('query($query:String!){globalSearch(query:$query){products}}', { query: alias }, token)).globalSearch.products;
  assert(search.some((row) => row.id === variant.id), 'The supplier alias must immediately resolve the variant in shared search');

  const productCountBeforeDuplicate = await prisma.product.count();
  const duplicateDesign = (await gql(
    'mutation($input:TileDesignInput!){saveTileDesign(input:$input)}',
    { input: { designCode: `TQ-DUP-${suffix}`, name: `Duplicate alias guard ${suffix}`, brand, status: 'active' } }, token,
  )).saveTileDesign;
  designIds.push(duplicateDesign.id);
  const duplicateError = await gql(
    'mutation($input:TileVariantInput!){saveTileVariant(input:$input){id}}',
    { input: { tileDesignId: duplicateDesign.id, tileSizeId: size.id, finish, purchaseUom: 'BOX', salesUom: 'BOX', defaultMrpInclusive: 688, priceRateBasis: 'AREA', priceUom: 'SQFT', mrpSource: 'MANUAL', pricingEffectiveFrom: new Date().toISOString(), alias } }, token, true,
  );
  assert(/already assigned|already exists/i.test(duplicateError), 'A duplicate supplier alias must be rejected before variant creation');
  assert(await prisma.product.count() === productCountBeforeDuplicate, 'Rejected aliases must not leave a partial Product Master or inventory record');

  const customer = (await gql(
    'mutation($input:CreateCustomerInput!){createCustomer(input:$input){id}}',
    { input: { name: `Tile quote customer ${suffix}`, phone: '9000000079', city: 'Vapi', address: 'Isolated tile quote acceptance', forceCreate: true } }, token,
  )).createCustomer;
  cleanup.customerIds.push(customer.id);
  const quote = (await gql(
    'mutation($input:CreateQuoteInput!){createQuote(input:$input){id quoteNumber leadId status pricingStatus commercialTotal lines}}',
    { input: {
      customerId: customer.id,
      title: `Tile quotation ${suffix}`,
      projectName: 'Tile variant to quote acceptance',
      saveAsDraft: false,
      quoteMeta: JSON.stringify({ pricingVersion: 'unified_retail_v1', quoteDiscount: { mode: 'PERCENT', value: 0 } }),
      lines: JSON.stringify([{
        productId: variant.id,
        sku: variant.sku,
        tileCode: variant.internalCode,
        name: variant.name,
        category: 'Tiles',
        brand: variant.brand,
        tileSize: variant.dimensions,
        qty: 2,
        quantity: 2,
        unit: 'BOX',
        inventoryUom: 'BOX',
        pricingUom: 'SQFT',
        rateBasis: 'AREA',
        priceRateBasis: 'AREA',
        requestedArea: Number(variant.coveragePerPack) * 2,
        wastagePercent: 0,
        piecesPerPack: variant.piecesPerPack,
        coveragePerPack: variant.coveragePerPack,
        mrpInclusive: 688,
        nrpMode: 'FIXED_NRP',
        nrpInput: 640,
        specialMode: 'NONE',
        specialInput: 0,
        taxRate: 18,
        area: 'Master Bathroom',
      }]),
    } }, token,
  )).createQuote;
  cleanup.quoteIds.push(quote.id);
  if (quote.leadId) cleanup.leadIds.push(quote.leadId);
  assert(quote.status === 'draft' && quote.pricingStatus === 'complete', 'A fully priced tile line must create a validated quote');
  assert(quote.lines.length === 1 && quote.lines[0].type === 'tile' && quote.lines[0].productId === variant.id, 'Quote must preserve the exact Product Master tile variant');
  assert(quote.lines[0].qty === 2 && quote.lines[0].pricingUom === 'SQFT' && quote.lines[0].rateBasis === 'AREA', 'Quote must keep physical boxes while pricing the tile per SQFT');
  const expectedTotal = Number(variant.coveragePerPack) * 2 * 640;
  close(quote.lines[0].grossLineTotal, expectedTotal, 'Tile line total');
  close(quote.commercialTotal, expectedTotal, 'Materialized quote total');

  const pdfResponse = await fetch(`${APP_URL}/api/pdf/quote/${quote.id}?download=1`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const pdf = Buffer.from(await pdfResponse.arrayBuffer());
  assert(pdfResponse.ok, `Tile quote PDF failed (${pdfResponse.status}): ${pdf.toString('utf8')}`);
  assert(pdfResponse.headers.get('content-type') === 'application/pdf' && pdf.subarray(0, 4).toString() === '%PDF' && pdf.length > 1_000, 'Tile quote PDF did not return a valid customer document');
  if (process.env.PDF_OUTPUT) await writeFile(process.env.PDF_OUTPUT, pdf);

  console.log(JSON.stringify({ ok: true, variant: variant.sku, alias, quote: quote.quoteNumber, quoteTotal: quote.commercialTotal, pdfBytes: pdf.length, atomicAliasGuard: true }, null, 2));
}

main()
  .catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; })
  .finally(async () => {
    await cleanupE2eRecords(prisma, cleanup);
    if (designIds.length) {
      await prisma.auditEvent.deleteMany({ where: { entityType: 'TileDesign', entityId: { in: designIds } } }).catch(() => null);
      await prisma.tileDesign.deleteMany({ where: { id: { in: designIds } } }).catch(() => null);
    }
    if (acceptanceSizeId) await prisma.tileSize.delete({ where: { id: acceptanceSizeId } }).catch(() => null);
    await prisma.$disconnect();
  });
