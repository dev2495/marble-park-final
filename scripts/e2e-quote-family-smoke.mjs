import bcrypt from 'bcrypt';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { ulid } from 'ulid';

if (process.env.ALLOW_MUTATING_ACCEPTANCE !== 'true') {
  throw new Error('Refusing to mutate data. Run only against an isolated acceptance database with ALLOW_MUTATING_ACCEPTANCE=true.');
}

const prisma = new PrismaClient();
const API = process.env.API_URL || 'http://127.0.0.1:4100/graphql';
const WEB = process.env.WEB_URL || 'http://127.0.0.1:3100';
const outputDir = process.env.PDF_OUTPUT_DIR || '';
const stamp = Date.now().toString(36).toUpperCase();
const email = process.env.ACCEPTANCE_EMAIL || `quote-family-${stamp.toLowerCase()}@example.invalid`;
const password = process.env.ACCEPTANCE_PASSWORD || `Quote-${stamp}-Strong!42`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function gql(query, variables = {}, token = '', expectError = false) {
  const response = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json();
  const error = payload.errors?.map((entry) => entry.message).join('; ') || '';
  if (expectError) return error;
  if (!response.ok || error) throw new Error(error || `GraphQL ${response.status}`);
  return payload.data;
}

async function createProduct(token, input) {
  return (await gql(
    `mutation($input:CreateProductInput!){createProduct(input:$input){
      id sku internalCode name category unit baseUom purchaseUom salesUom piecesPerPack coveragePerPack
      defaultMrpInclusive defaultNrpInclusive priceRateBasis priceUom
    }}`,
    { input },
    token,
  )).createProduct;
}

async function renderQuotePdf(token, quote, filename) {
  const response = await fetch(`${WEB}/api/pdf/quote/${quote.id}`, { headers: { authorization: `Bearer ${token}` } });
  const payload = Buffer.from(await response.arrayBuffer());
  assert(response.ok && (response.headers.get('content-type') || '').includes('application/pdf'), `${quote.quoteNumber} PDF failed (${response.status}): ${payload.toString('utf8').slice(0, 500)}`);
  assert(payload.subarray(0, 4).toString() === '%PDF' && payload.length > 7000, `${quote.quoteNumber} PDF is not substantive`);
  if (outputDir) {
    await mkdir(outputDir, { recursive: true });
    await writeFile(path.join(outputDir, filename), payload);
  }
  return payload.length;
}

async function main() {
  const actorId = ulid();
  await prisma.user.create({ data: {
    id: actorId,
    name: 'Quote Family Acceptance Owner',
    email,
    passwordHash: await bcrypt.hash(password, 12),
    role: 'owner',
    phone: '',
    active: true,
    permissionOverrides: {},
    passwordChangedAt: new Date(),
  } });
  const token = (await gql('mutation($input:LoginInput!){login(input:$input){token}}', { input: { email, password } })).login.token;
  assert(token, 'Acceptance owner login failed');

  const createBrand = async (name, code, sortOrder) => (await gql(
    'mutation($input:ProductBrandInput!){saveProductBrand(input:$input){data}}',
    { input: { name, code, status: 'active', sortOrder, metadata: { logoUrl: '/brand/marble-park-logo.png', quoteEnabled: true } } },
    token,
  )).saveProductBrand.data;
  const tileBrand = await createBrand(`Tile family brand ${stamp}`, `TF-${stamp}`, 9801);
  const cpBrand = await createBrand(`CP family brand ${stamp}`, `CF-${stamp}`, 9802);
  const savedSettings = (await gql(
    'mutation($input:UpdateSettingsInput!){updateAppSettings(input:$input){data}}',
    { input: {
      tileQuoteBrandSelectionMode: 'selected',
      tileQuoteBrandIds: [tileBrand.id],
      cpSanitaryQuoteBrandSelectionMode: 'selected',
      cpSanitaryQuoteBrandIds: [cpBrand.id],
    } },
    token,
  )).updateAppSettings.data;
  assert(savedSettings.tileQuoteBrandSelectionMode === 'selected' && savedSettings.tileQuoteBrandIds[0] === tileBrand.id, 'Tile footer policy did not persist');
  assert(savedSettings.cpSanitaryQuoteBrandSelectionMode === 'selected' && savedSettings.cpSanitaryQuoteBrandIds[0] === cpBrand.id, 'CP/Sanitary footer policy did not persist');

  const tile = await createProduct(token, {
    sku: `TILE-FAMILY-${stamp}`,
    internalCode: `TILE-${stamp}`,
    name: 'Parker Grey Matt',
    category: 'Tiles',
    brand: tileBrand.name,
    finish: 'Matt',
    dimensions: '600 x 1200 mm',
    unit: 'BOX',
    baseUom: 'PC',
    purchaseUom: 'BOX',
    salesUom: 'BOX',
    piecesPerPack: 2,
    coveragePerPack: 15.5,
    defaultMrpInclusive: 450,
    defaultNrpInclusive: 360,
    floorPriceInclusive: 330,
    priceRateBasis: 'AREA',
    priceUom: 'SQFT',
    mrpSource: 'MANUAL',
    pricingEffectiveFrom: new Date().toISOString(),
    taxClass: 'GST_18',
  });
  const chemical = await createProduct(token, {
    sku: `CHEM-FAMILY-${stamp}`,
    internalCode: `CHEM-${stamp}`,
    name: 'Premium tile adhesive',
    category: 'Chemicals',
    brand: tileBrand.name,
    finish: 'Standard',
    unit: 'PC',
    baseUom: 'PC',
    purchaseUom: 'BOX',
    salesUom: 'PC',
    piecesPerPack: 20,
    coveragePerPack: 99,
    defaultMrpInclusive: 120,
    defaultNrpInclusive: 100,
    floorPriceInclusive: 90,
    priceRateBasis: 'PIECE',
    priceUom: 'PC',
    mrpSource: 'MANUAL',
    pricingEffectiveFrom: new Date().toISOString(),
    taxClass: 'GST_18',
  });
  const cp = await createProduct(token, {
    sku: `CP-FAMILY-${stamp}`,
    internalCode: `CP-${stamp}`,
    name: 'Single lever basin mixer',
    category: 'Faucets',
    brand: cpBrand.name,
    finish: 'Chrome',
    unit: 'PC',
    baseUom: 'PC',
    purchaseUom: 'PC',
    salesUom: 'PC',
    piecesPerPack: 1,
    defaultMrpInclusive: 4000,
    defaultNrpInclusive: 3600,
    floorPriceInclusive: 3300,
    priceRateBasis: 'PIECE',
    priceUom: 'PC',
    mrpSource: 'MANUAL',
    pricingEffectiveFrom: new Date().toISOString(),
    taxClass: 'GST_18',
  });
  assert(
    chemical.unit === 'KG'
      && chemical.baseUom === 'KG'
      && chemical.purchaseUom === 'KG'
      && chemical.salesUom === 'KG'
      && chemical.piecesPerPack === 1
      && Number(chemical.coveragePerPack) === 0
      && chemical.priceUom === 'KG',
    'Chemical Product Master did not enforce the governed KG identity',
  );

  const customer = (await gql(
    'mutation($input:CreateCustomerInput!){createCustomer(input:$input){id name}}',
    { input: { name: `Quote family customer ${stamp}`, phone: '9000000077', city: 'Vapi', address: 'Quote family acceptance', forceCreate: true } },
    token,
  )).createCustomer;

  const createQuote = async (input) => (await gql(
    `mutation($input:CreateQuoteInput!){createQuote(input:$input){
      id quoteNumber quoteType status commercialTotal lines quoteMeta approval
    }}`,
    { input },
    token,
  )).createQuote;
  const tileQuote = await createQuote({
    customerId: customer.id,
    ownerId: actorId,
    quoteType: 'tile',
    title: 'Tile & chemical acceptance quotation',
    projectName: 'Tile quotation release gate',
    quoteMeta: JSON.stringify({ quoteType: 'tile', taxMode: 'gst', pricingVersion: 'unified_retail_v1', selectedBrandIds: [cpBrand.id], quoteDiscount: { mode: 'PERCENT', value: 2 } }),
    lines: JSON.stringify([
      { productId: tile.id, qty: 2, area: 'Master Bathroom', nrpMode: 'FIXED_NRP', nrpInput: 360, specialMode: 'PERCENT_OFF_NRP', specialInput: 2, taxRate: 18 },
      { productId: chemical.id, qty: 10, area: 'Installation Material', nrpMode: 'FIXED_NRP', nrpInput: 100, specialMode: 'PERCENT_OFF_NRP', specialInput: 5, taxRate: 18 },
    ]),
  });
  assert(tileQuote.quoteType === 'tile' && tileQuote.lines.length === 2, 'Tile quotation family was not persisted');
  assert(tileQuote.quoteMeta.brandSelectionSource === 'global_quote_family_settings' && tileQuote.quoteMeta.selectedBrandIds.length === 1 && tileQuote.quoteMeta.selectedBrandIds[0] === tileBrand.id, 'Tile quote did not enforce and snapshot its global footer policy');
  assert(tileQuote.quoteMeta.brandSelectionSnapshot?.[0]?.id === tileBrand.id && tileQuote.quoteMeta.brandSelectionSnapshot[0].logoUrl, 'Tile quote did not freeze its printable brand identity');
  const tileLine = tileQuote.lines.find((line) => line.category === 'Tiles');
  const chemicalLine = tileQuote.lines.find((line) => line.category === 'Chemicals');
  assert(tileLine?.pricingUom === 'SQFT' && Number(tileLine.pricingQuantity) === 31, 'Tile quotation did not preserve boxes and calculate total SQFT');
  assert(chemicalLine?.unit === 'KG' && chemicalLine?.pricingUom === 'KG' && Number(chemicalLine.pricingQuantity) === 10, 'Chemical quotation line did not price and fulfil in KG');

  const cpQuote = await createQuote({
    customerId: customer.id,
    ownerId: actorId,
    quoteType: 'cp_sanitary',
    title: 'CP & sanitary acceptance quotation',
    projectName: 'CP quotation release gate',
    quoteMeta: JSON.stringify({ quoteType: 'cp_sanitary', taxMode: 'non_gst', pricingVersion: 'unified_retail_v1', selectedBrandIds: [tileBrand.id], quoteDiscount: { mode: 'FIXED_AMOUNT', value: 100 } }),
    lines: JSON.stringify([
      { productId: cp.id, qty: 2, area: 'Master Bathroom', nrpMode: 'PERCENT_OFF_MRP', nrpInput: 10, specialMode: 'PERCENT_OFF_NRP', specialInput: 5, taxRate: 0 },
    ]),
  });
  assert(cpQuote.quoteType === 'cp_sanitary' && cpQuote.lines.length === 1 && cpQuote.lines[0].category === 'Faucets', 'CP/Sanitary quotation family was not persisted');
  assert(cpQuote.quoteMeta.brandSelectionSource === 'global_quote_family_settings' && cpQuote.quoteMeta.selectedBrandIds.length === 1 && cpQuote.quoteMeta.selectedBrandIds[0] === cpBrand.id, 'CP/Sanitary quote did not enforce and snapshot its global footer policy');
  assert(cpQuote.quoteMeta.brandSelectionSnapshot?.[0]?.id === cpBrand.id && cpQuote.quoteMeta.brandSelectionSnapshot[0].logoUrl, 'CP/Sanitary quote did not freeze its printable brand identity');

  const attemptedBrandOverride = (await gql(
    'mutation($id:ID!,$input:UpdateQuotePresentationInput!){updateQuotePresentation(id:$id,input:$input){id quoteMeta}}',
    { id: tileQuote.id, input: { quoteMeta: JSON.stringify({ ...tileQuote.quoteMeta, selectedBrandIds: [cpBrand.id], showBrandLogos: true }) } },
    token,
  )).updateQuotePresentation;
  assert(
    attemptedBrandOverride.quoteMeta.selectedBrandIds.length === 1
      && attemptedBrandOverride.quoteMeta.selectedBrandIds[0] === tileBrand.id
      && attemptedBrandOverride.quoteMeta.brandSelectionSnapshot?.[0]?.id === tileBrand.id
      && attemptedBrandOverride.quoteMeta.brandSelectionSource === 'global_quote_family_settings',
    'A saved quote allowed its governed brand snapshot to be changed',
  );

  const mixedTileError = await gql(
    'mutation($input:CreateQuoteInput!){createQuote(input:$input){id}}',
    { input: { customerId: customer.id, ownerId: actorId, quoteType: 'tile', title: 'Invalid mixed tile quote', lines: JSON.stringify([{ productId: cp.id, qty: 1 }]) } },
    token,
    true,
  );
  assert(/only Tiles and Chemicals/i.test(mixedTileError), `Tile-family guard did not reject CP product: ${mixedTileError}`);
  const mixedCpError = await gql(
    'mutation($input:CreateQuoteInput!){createQuote(input:$input){id}}',
    { input: { customerId: customer.id, ownerId: actorId, quoteType: 'cp_sanitary', title: 'Invalid mixed CP quote', lines: JSON.stringify([{ productId: chemical.id, qty: 1 }]) } },
    token,
    true,
  );
  assert(/CP & Sanitary quotations exclude Tiles and Chemicals|only CP and Sanitary products/i.test(mixedCpError), `CP-family guard did not reject Chemical product: ${mixedCpError}`);

  const tileRegister = (await gql(
    'query($quoteType:String,$search:String){quotePage(quoteType:$quoteType,search:$search,take:20,skip:0)}',
    { quoteType: 'tile', search: stamp },
    token,
  )).quotePage;
  const cpRegister = (await gql(
    'query($quoteType:String,$search:String){quotePage(quoteType:$quoteType,search:$search,take:20,skip:0)}',
    { quoteType: 'cp_sanitary', search: stamp },
    token,
  )).quotePage;
  assert(tileRegister.total === 1 && tileRegister.rows[0].id === tileQuote.id, 'Tile quote register filter is not isolated');
  assert(cpRegister.total === 1 && cpRegister.rows[0].id === cpQuote.id, 'CP/Sanitary quote register filter is not isolated');

  const [tilePdfBytes, cpPdfBytes] = await Promise.all([
    renderQuotePdf(token, tileQuote, 'SAMPLE_TILE_AND_CHEMICAL_QUOTATION.pdf'),
    renderQuotePdf(token, cpQuote, 'SAMPLE_CP_AND_SANITARY_QUOTATION.pdf'),
  ]);

  console.log(JSON.stringify({
    ok: true,
    quoteFamilies: {
      tile: { id: tileQuote.id, quoteNumber: tileQuote.quoteNumber, lines: ['Tiles', 'Chemicals'], tileCoverageSqft: tileLine.pricingQuantity, chemicalKg: chemicalLine.pricingQuantity, pdfBytes: tilePdfBytes },
      cpSanitary: { id: cpQuote.id, quoteNumber: cpQuote.quoteNumber, lines: ['Faucets'], taxMode: 'non_gst', pdfBytes: cpPdfBytes },
    },
    enforced: { familyIsolation: true, chemicalUom: 'KG', registerFilters: true, governedBrandSnapshots: true, savedQuoteSnapshotLock: true },
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
