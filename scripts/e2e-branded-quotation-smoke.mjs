import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const API = process.env.API_URL || 'http://localhost:4000/graphql';
const WEB = process.env.WEB_URL || 'http://localhost:3000';
const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@marblepark.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'password123';
const PDF_OUTPUT = resolve(process.env.PDF_OUTPUT || 'output/pdf/marble-park-branded-quotation-sample.pdf');

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

  const settings = (await gql(
    `mutation($input: UpdateSettingsInput!) { updateAppSettings(input: $input) { data } }`,
    { input: {
      companyName: 'Marble Park',
      logoUrl: '/brand/marble-park-logo.jpg',
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
  assert(settings.logoUrl === '/brand/marble-park-logo.jpg' && settings.gstNumber === '24AHPPS9407D1Z3', 'Company document identity must persist');

  const brandSpecs = [
    { name: `Marble Park Signature ${suffix}`, code: `MPS-${suffix}`, logoUrl: '/brand/marble-park-logo.jpg' },
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
  assert(brands.every((brand) => brand.metadata?.logoUrl && brand.metadata?.quoteEnabled === true), 'Each Brand Master record must retain its quote logo');

  const createProduct = async (input) => (await gql(
    `mutation($input: CreateProductInput!) { createProduct(input: $input) { id sku internalCode name category brand finish dimensions unit purchaseUom salesUom piecesPerPack coveragePerPack sellPrice } }`,
    { input }, token,
  )).createProduct;
  const [basin, mixer, tile] = await Promise.all([
    createProduct({ sku: `MP-BASIN-${suffix}`, name: 'Premium wall-hung basin - sample quotation', category: 'Sanitaryware', brand: brands[0].name, finish: 'Gloss White', dimensions: '560 x 430 mm', unit: 'PC', sellPrice: 18450, floorPrice: 14800, taxClass: 'GST_18', description: 'Customer-facing branded quotation release gate' }),
    createProduct({ sku: `MP-MIXER-${suffix}`, name: 'Tall basin mixer - quotation selection', category: 'Faucets', brand: brands[1].name, finish: 'Brushed Nickel', dimensions: '310 mm', unit: 'PC', sellPrice: 12900, floorPrice: 9900, taxClass: 'GST_18', description: 'Customer-facing image can be replaced by the sales team' }),
    createProduct({ sku: `MP-TILE-${suffix}`, internalCode: `SHOW-${suffix}`, name: 'Large-format porcelain tile', category: 'Tiles', brand: brands[2].name, finish: 'Matt', dimensions: '600 x 1200 mm', unit: 'BOX', baseUom: 'PC', purchaseUom: 'BOX', salesUom: 'SQFT', piecesPerPack: 2, coveragePerPack: 15.5, sellPrice: 165, floorPrice: 130, taxClass: 'GST_18', description: 'Area-priced tile fulfilled as physical boxes' }),
  ]);
  const customer = (await gql(
    `mutation($input: CreateCustomerInput!) { createCustomer(input: $input) { id name } }`,
    { input: { name: `Sample Client ${suffix}`, phone: '9876543210', email: `sample-${suffix.toLowerCase()}@example.test`, city: 'Vapi', address: 'Sample residence, Vapi', forceCreate: true } },
    token,
  )).createCustomer;

  const selectedBrandIds = brands.map((brand) => String(brand.id));
  const quoteMeta = {
    selectedBrandIds,
    showBrandLogos: true,
    tagline: settings.documentTagline,
    terms: settings.defaultTerms,
    bankDetails: settings.bankDetails,
    remarks: 'Sample document generated by the branded quotation release gate.',
  };
  const quote = (await gql(
    `mutation($input: CreateQuoteInput!) { createQuote(input: $input) { id quoteNumber lines quoteMeta displayMode customer } }`,
    { input: {
      customerId: customer.id,
      title: 'Premium bathroom selection',
      projectName: 'Sample residence - master bathroom',
      displayMode: 'priced',
      quoteMeta: JSON.stringify(quoteMeta),
      lines: JSON.stringify([
        { productId: basin.id, sku: basin.sku, name: basin.name, category: basin.category, brand: basin.brand, finish: basin.finish, qty: 1, unit: 'PC', price: basin.sellPrice, listPrice: basin.sellPrice, discountPercent: 8, taxRate: 18, area: 'Master Bathroom', notes: 'Wall-hung basin with concealed fixing kit' },
        { productId: mixer.id, sku: mixer.sku, name: mixer.name, category: mixer.category, brand: mixer.brand, finish: mixer.finish, qty: 1, unit: 'PC', price: mixer.sellPrice, listPrice: mixer.sellPrice, specialRate: 11500, taxRate: 18, area: 'Master Bathroom', notes: 'Customer-facing image can be replaced by the sales team' },
        { productId: tile.id, sku: tile.sku, tileCode: tile.internalCode, tileSize: tile.dimensions, name: tile.name, category: tile.category, brand: tile.brand, finish: tile.finish, requestedArea: 92, wastagePercent: 8, qty: 1, unit: 'BOX', inventoryUom: 'BOX', pricingUom: 'SQFT', rateBasis: 'AREA', coveragePerPack: tile.coveragePerPack, piecesPerPack: tile.piecesPerPack, price: tile.sellPrice, listPrice: tile.sellPrice, taxRate: 18, area: 'Master Bathroom', notes: 'Billed by covered area; fulfilled as full boxes' },
      ]),
    } },
    token,
  )).createQuote;
  const storedMeta = typeof quote.quoteMeta === 'string' ? JSON.parse(quote.quoteMeta) : quote.quoteMeta;
  assert(selectedBrandIds.every((id) => storedMeta.selectedBrandIds.includes(id)), 'Quote must persist every explicit footer brand selection');
  const tileLine = quote.lines.find((line) => line.rateBasis === 'AREA');
  assert(tileLine.qty === 7 && tileLine.pricingQuantity === 108.5 && tileLine.pricingUom === 'SQFT', 'Sample tile line must retain area pricing and physical box fulfilment');

  const documentData = await gql(`query { documentSettings { data } masterProductBrands(status: "active") }`, {}, token);
  assert(documentData.documentSettings.data.gstNumber === settings.gstNumber, 'Authenticated document settings must expose the saved global identity');
  assert(selectedBrandIds.every((id) => documentData.masterProductBrands.some((brand) => String(brand.id) === id && brand.metadata?.logoUrl)), 'Quote-enabled brands must be available to Quote Studio');

  const pdfResponse = await fetch(`${WEB}/api/pdf/quote/${quote.id}`);
  assert(pdfResponse.ok, `Branded quotation PDF must render (${pdfResponse.status})`);
  const pdf = Buffer.from(await pdfResponse.arrayBuffer());
  assert(pdf.subarray(0, 4).toString() === '%PDF' && pdf.length > 10_000, 'Rendered quotation must be a non-empty PDF');
  await mkdir(dirname(PDF_OUTPUT), { recursive: true });
  await writeFile(PDF_OUTPUT, pdf);

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
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
