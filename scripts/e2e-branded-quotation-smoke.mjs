import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { cleanupE2eRecords } from './lib/cleanup-e2e-records.mjs';

const API = process.env.API_URL || 'http://localhost:4000/graphql';
const WEB = process.env.WEB_URL || 'http://localhost:3000';
const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@marblepark.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'password123';
const PDF_OUTPUT = resolve(process.env.PDF_OUTPUT || 'output/pdf/marble-park-branded-quotation-sample.pdf');
const NON_GST_PDF_OUTPUT = resolve(process.env.NON_GST_PDF_OUTPUT || 'output/pdf/marble-park-non-gst-quotation-sample.pdf');
const prisma = new PrismaClient();
const cleanupContext = { productIds: [], customerIds: [], quoteIds: [], leadIds: [], brandIds: [] };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function gql(query, variables = {}, token) {
  const response = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json();
  if (!response.ok || payload.errors?.length) {
    throw new Error(payload.errors?.map((error) => error.message).join('; ') || `GraphQL request failed (${response.status})`);
  }
  return payload.data;
}

async function main() {
  const suffix = Date.now().toString(36).toUpperCase();
  const login = await gql(
    `mutation($input: LoginInput!) { login(input: $input) { token user { id role } } }`,
    { input: { email: TEST_EMAIL, password: TEST_PASSWORD } },
  );
  const token = login.login.token;
  assert(token, 'Admin login must return a session token');
  const unauthenticatedPdf = await fetch(`${WEB}/api/pdf/quote/not-a-real-quote`);
  assert(unauthenticatedPdf.status === 401, 'PDF routes must reject requests without a user session');
  const uploadedImage = (await gql(
    `mutation($filename: String!, $contentBase64: String!, $scope: String) { uploadStoredAsset(filename: $filename, contentBase64: $contentBase64, scope: $scope) { result } }`,
    { filename: `branded-quote-${suffix}.png`, contentBase64: (await readFile(resolve('apps/web/public/brand/marble-park-logo.png'))).toString('base64'), scope: 'product-image' },
    token,
  )).uploadStoredAsset.result.publicUrl;
  assert(/^https:\/\//.test(uploadedImage) || /^\/catalogue-images\/manual\//.test(uploadedImage), 'Product image upload must return an approved persistent URL');

  const settings = (await gql(
    `mutation($input: UpdateSettingsInput!) { updateAppSettings(input: $input) { data } }`,
    { input: {
      companyName: 'Marble Park',
      logoUrl: '/brand/marble-park-logo.png',
      companyAddress: 'Near DCB Bank, Char Rasta, Vapi (Guj)-396191, India',
      gstNumber: '24AHPPS9407D1Z3',
      website: 'www.marblepark.in',
      quotationTitle: 'PROFORMA / QUOTATION',
      documentTagline: 'Premium bath, tile and surface selections for considered spaces.',
      supportPhone: '0260-2424498 | 9427119271 | 7506133166 | 9712508070',
      supportEmail: 'sales@marblepark.in',
      defaultTerms: '1. Freight and labour are extra and subject to applicable GST.\n2. Payment is 100% advance unless agreed in writing.\n3. Goods once sold require an approved return.\n4. Product images are references; shade and batch are confirmed at order stage.',
      bankDetails: 'Account name: Marble Park\nBank: IDFC Bank\nAccount no.: 10033526350\nIFSC: IDFB0042441\nBranch: Vapi - 396195, Gujarat',
      documentFooter: 'Thank you for choosing Marble Park. Availability, shade and batch are confirmed at order stage.',
    } },
    token,
  )).updateAppSettings.data;
  assert(settings.logoUrl === '/brand/marble-park-logo.png' && settings.gstNumber === '24AHPPS9407D1Z3', 'Company document identity must persist');

  const brandSpecs = [
    { name: `Marble Park Signature ${suffix}`, code: `MPS-${suffix}`, logoUrl: '/brand/marble-park-logo.png' },
    { name: `Marble Park Studio ${suffix}`, code: `MPL-${suffix}`, logoUrl: '/brand/marble-park-legacy-reference.jpg' },
    { name: `Served Brand Portfolio ${suffix}`, code: `SBP-${suffix}`, logoUrl: '/brand/client-served-brands-reference.png' },
  ];
  const brands = [];
  for (const [index, spec] of brandSpecs.entries()) {
    const result = await gql(
      `mutation($input: ProductBrandInput!) { saveProductBrand(input: $input) { data } }`,
      { input: { name: spec.name, code: spec.code, description: 'Branded quotation release-gate record', status: 'active', sortOrder: 9000 + index, metadata: { logoUrl: spec.logoUrl, quoteEnabled: true } } },
      token,
    );
    brands.push(result.saveProductBrand.data);
  }
  cleanupContext.brandIds.push(...brands.map((brand) => brand.id));
  assert(brands.every((brand) => brand.metadata?.logoUrl && brand.metadata?.quoteEnabled === true), 'Each Brand Master record must retain its quote logo');

  const createProduct = async (input) => (await gql(
    `mutation($input: CreateProductInput!) { createProduct(input: $input) { id sku internalCode name category brand finish dimensions unit purchaseUom salesUom piecesPerPack coveragePerPack sellPrice media } }`,
    { input }, token,
  )).createProduct;
  const [basin, mixer, tile] = await Promise.all([
    createProduct({ sku: `MP-BASIN-${suffix}`, name: 'Premium wall-hung basin - sample quotation', category: 'Sanitaryware', brand: brands[0].name, finish: 'Gloss White', dimensions: '560 x 430 mm', unit: 'PC', sellPrice: 18450, floorPrice: 14800, taxClass: 'GST_18', media: { gallery: [uploadedImage], primaryUrl: uploadedImage }, description: 'Customer-facing branded quotation release gate' }),
    createProduct({ sku: `MP-MIXER-${suffix}`, name: 'Tall basin mixer - quotation selection', category: 'Faucets', brand: brands[1].name, finish: 'Brushed Nickel', dimensions: '310 mm', unit: 'PC', sellPrice: 12900, floorPrice: 9900, taxClass: 'GST_18', media: { gallery: [uploadedImage], primaryImage: uploadedImage }, description: 'Customer-facing image can be replaced by the sales team' }),
    createProduct({ sku: `MP-TILE-${suffix}`, internalCode: `SHOW-${suffix}`, name: 'Large-format porcelain tile', category: 'Tiles', brand: brands[2].name, finish: 'Matt', dimensions: '600 x 1200 mm', unit: 'BOX', baseUom: 'PC', purchaseUom: 'BOX', salesUom: 'SQFT', piecesPerPack: 2, coveragePerPack: 15.5, sellPrice: 165, floorPrice: 130, taxClass: 'GST_18', media: { gallery: [{ url: uploadedImage }] }, description: 'Area-priced tile fulfilled as physical boxes' }),
  ]);
  cleanupContext.productIds.push(basin.id, mixer.id, tile.id);
  const customer = (await gql(
    `mutation($input: CreateCustomerInput!) { createCustomer(input: $input) { id name } }`,
    { input: { name: `Sample Client ${suffix}`, phone: '9876543210', email: `sample-${suffix.toLowerCase()}@example.test`, city: 'Vapi', address: 'Sample residence, Vapi', forceCreate: true } },
    token,
  )).createCustomer;
  cleanupContext.customerIds.push(customer.id);

  const selectedBrandIds = brands.map((brand) => String(brand.id));
  const quoteMeta = {
    selectedBrandIds,
    showBrandLogos: true,
    taxMode: 'gst',
    tagline: settings.documentTagline,
    terms: settings.defaultTerms,
    bankDetails: settings.bankDetails,
    remarks: 'Sample document generated by the branded quotation release gate.',
  };
  const quote = (await gql(
    `mutation($input: CreateQuoteInput!) { createQuote(input: $input) { id quoteNumber leadId lines quoteMeta displayMode customer } }`,
    { input: {
      customerId: customer.id,
      title: 'Premium bathroom selection',
      projectName: 'Sample residence - master bathroom',
      displayMode: 'priced',
      quoteMeta: JSON.stringify(quoteMeta),
      lines: JSON.stringify([
        { productId: basin.id, sku: basin.sku, name: basin.name, category: basin.category, brand: basin.brand, finish: basin.finish, qty: 1, unit: 'PC', price: basin.sellPrice, listPrice: basin.sellPrice, discountPercent: 8, taxRate: 18, media: { primaryUrl: uploadedImage }, area: 'Master Bathroom', notes: 'Wall-hung basin with concealed fixing kit' },
        { productId: mixer.id, sku: mixer.sku, name: mixer.name, category: mixer.category, brand: mixer.brand, finish: mixer.finish, qty: 1, unit: 'PC', price: mixer.sellPrice, listPrice: mixer.sellPrice, specialRate: 11500, taxRate: 18, media: { primaryImage: uploadedImage }, area: 'Master Bathroom', notes: 'Customer-facing image can be replaced by the sales team' },
        { productId: tile.id, sku: tile.sku, tileCode: tile.internalCode, tileSize: tile.dimensions, name: tile.name, category: tile.category, brand: tile.brand, finish: tile.finish, requestedArea: 92, wastagePercent: 8, qty: 1, unit: 'BOX', inventoryUom: 'BOX', pricingUom: 'SQFT', rateBasis: 'AREA', coveragePerPack: tile.coveragePerPack, piecesPerPack: tile.piecesPerPack, price: tile.sellPrice, listPrice: tile.sellPrice, taxRate: 18, media: tile.media, area: 'Master Bathroom', notes: 'Billed by covered area; fulfilled as full boxes' },
      ]),
    } },
    token,
  )).createQuote;
  cleanupContext.quoteIds.push(quote.id);
  cleanupContext.leadIds.push(quote.leadId);
  const storedMeta = typeof quote.quoteMeta === 'string' ? JSON.parse(quote.quoteMeta) : quote.quoteMeta;
  assert(selectedBrandIds.every((id) => storedMeta.selectedBrandIds.includes(id)), 'Quote must persist every explicit footer brand selection');
  const tileLine = quote.lines.find((line) => line.rateBasis === 'AREA');
  assert(tileLine.qty === 7 && tileLine.pricingQuantity === 108.5 && tileLine.pricingUom === 'SQFT', 'Sample tile line must retain area pricing and physical box fulfilment');

  const documentData = await gql(`query { documentSettings { data } masterProductBrands(status: "active") }`, {}, token);
  assert(documentData.documentSettings.data.gstNumber === settings.gstNumber, 'Authenticated document settings must expose the saved global identity');
  assert(selectedBrandIds.every((id) => documentData.masterProductBrands.some((brand) => String(brand.id) === id && brand.metadata?.logoUrl)), 'Quote-enabled brands must be available to Quote Studio');

  const pdfResponse = await fetch(`${WEB}/api/pdf/quote/${quote.id}`, { headers: { authorization: `Bearer ${token}` } });
  assert(pdfResponse.ok, `Branded quotation PDF must render (${pdfResponse.status})`);
  const pdf = Buffer.from(await pdfResponse.arrayBuffer());
  assert(pdf.subarray(0, 4).toString() === '%PDF' && pdf.length > 10_000, 'Rendered quotation must be a non-empty PDF');
  await mkdir(dirname(PDF_OUTPUT), { recursive: true });
  await writeFile(PDF_OUTPUT, pdf);

  const nonGstQuote = (await gql(
    `mutation($input: CreateQuoteInput!) { createQuote(input: $input) { id quoteNumber leadId lines quoteMeta } }`,
    { input: {
      customerId: customer.id,
      title: 'Non-GST showroom quotation',
      projectName: 'Sample non-GST option',
      displayMode: 'priced',
      quoteMeta: JSON.stringify({ ...quoteMeta, taxMode: 'non_gst', remarks: 'Customer requested a quotation without GST.' }),
      lines: JSON.stringify([{ productId: basin.id, sku: basin.sku, name: basin.name, category: basin.category, brand: basin.brand, finish: basin.finish, qty: 1, unit: 'PC', price: basin.sellPrice, listPrice: basin.sellPrice, taxRate: 0, media: basin.media, area: 'General Selection' }]),
    } }, token,
  )).createQuote;
  cleanupContext.quoteIds.push(nonGstQuote.id);
  cleanupContext.leadIds.push(nonGstQuote.leadId);
  assert(nonGstQuote.lines.every((line) => Number(line.taxRate) === 0 && Number(line.taxAmount) === 0), 'Non-GST quote must persist zero tax on every line');
  const nonGstPdfResponse = await fetch(`${WEB}/api/pdf/quote/${nonGstQuote.id}`, { headers: { authorization: `Bearer ${token}` } });
  assert(nonGstPdfResponse.ok, `Non-GST quotation PDF must render (${nonGstPdfResponse.status})`);
  const nonGstPdf = Buffer.from(await nonGstPdfResponse.arrayBuffer());
  assert(nonGstPdf.subarray(0, 4).toString() === '%PDF' && nonGstPdf.length > 8_000, 'Non-GST quotation must be a non-empty PDF');
  await writeFile(NON_GST_PDF_OUTPUT, nonGstPdf);

  console.log(JSON.stringify({
    ok: true,
    quoteId: quote.id,
    quoteNumber: quote.quoteNumber,
    productSkus: [basin.sku, mixer.sku, tile.sku],
    brandIds: selectedBrandIds,
    brandLogos: brands.map((brand) => brand.metadata.logoUrl),
    tilePricing: { boxes: tileLine.qty, billed: `${tileLine.pricingQuantity} ${tileLine.pricingUom}` },
    pdfOutput: PDF_OUTPUT,
    pdfBytes: pdf.length,
    nonGstQuoteId: nonGstQuote.id,
    nonGstPdfOutput: NON_GST_PDF_OUTPUT,
    nonGstPdfBytes: nonGstPdf.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}).finally(async () => {
  await cleanupE2eRecords(prisma, cleanupContext);
  await prisma.$disconnect();
});
