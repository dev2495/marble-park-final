import { PrismaClient } from '@prisma/client';
import { cleanupE2eRecords } from './lib/cleanup-e2e-records.mjs';

if (process.env.ALLOW_MUTATING_ACCEPTANCE !== 'true') {
  throw new Error('Refusing to mutate data. Run only against an isolated acceptance database with ALLOW_MUTATING_ACCEPTANCE=true.');
}

const API = process.env.API_URL || 'http://127.0.0.1:4100/graphql';
const WEB = process.env.WEB_URL || 'http://127.0.0.1:3100';
const TEST_EMAIL = process.env.TEST_EMAIL || 'owner@marblepark.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || '';
const prisma = new PrismaClient();
const cleanup = { productIds: [], customerIds: [], quoteIds: [], leadIds: [] };
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function gql(query, variables = {}, token) {
  const response = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json();
  if (!response.ok || payload.errors?.length) throw new Error(payload.errors?.map((row) => row.message).join('; ') || `GraphQL ${response.status}`);
  return payload.data;
}

async function main() {
  assert(TEST_PASSWORD, 'TEST_PASSWORD is required');
  const token = (await gql('mutation($input:LoginInput!){login(input:$input){token}}', { input: { email: TEST_EMAIL, password: TEST_PASSWORD } })).login.token;
  const suffix = Date.now().toString(36).toUpperCase();
  const sku = `LEGACY-PDF-${suffix}`;
  const product = (await gql(
    'mutation($input:CreateProductInput!){createProduct(input:$input){id sku name category brand finish unit defaultMrpInclusive defaultNrpInclusive priceRateBasis priceUom}}',
    { input: { sku, internalCode: sku, name: 'Legacy PDF remediation fixture', category: 'Sanitaryware', brand: 'Acceptance', finish: 'White', unit: 'PC', defaultMrpInclusive: 1000, defaultNrpInclusive: 800, priceRateBasis: 'PIECE', priceUom: 'PC', mrpSource: 'MANUAL', pricingEffectiveFrom: new Date().toISOString(), taxClass: 'GST_18' } },
    token,
  )).createProduct;
  cleanup.productIds.push(product.id);
  const customer = (await gql(
    'mutation($input:CreateCustomerInput!){createCustomer(input:$input){id}}',
    { input: { name: `Legacy PDF customer ${suffix}`, phone: '9000000079', email: `legacy-pdf-${suffix.toLowerCase()}@example.test`, city: 'Vapi', address: 'Isolated acceptance only', forceCreate: true } },
    token,
  )).createCustomer;
  cleanup.customerIds.push(customer.id);
  const quote = (await gql(
    'mutation($input:CreateQuoteInput!){createQuote(input:$input){id quoteNumber leadId lines quoteMeta}}',
    { input: { customerId: customer.id, title: `Legacy PDF ${suffix}`, projectName: 'Commercial remediation gate', quoteMeta: JSON.stringify({ taxMode: 'gst', pricingVersion: 'unified_retail_v1', quoteDiscount: { mode: 'PERCENT', value: 0 } }), lines: JSON.stringify([{ productId: product.id, sku, name: product.name, category: product.category, brand: product.brand, finish: product.finish, qty: 2, quantity: 2, unit: 'PC', inventoryUom: 'PC', pricingUom: 'PC', rateBasis: 'PIECE', priceRateBasis: 'PIECE', mrpInclusive: 1000, pricingVersion: 'unified_retail_v1', nrpMode: 'FIXED_NRP', nrpInput: 800, specialMode: 'NONE', specialInput: 0, taxRate: 18, area: 'General Selection' }]) } },
    token,
  )).createQuote;
  cleanup.quoteIds.push(quote.id);
  if (quote.leadId) cleanup.leadIds.push(quote.leadId);

  const legacyLines = quote.lines.map((line) => ({
    ...line,
    pricingVersion: 'legacy_v0',
    mrpInclusive: null,
    nrpInclusive: null,
    mrpConfirmedAt: null,
    mrpConfirmedById: null,
    unitPrice: 800,
    total: 1600,
  }));
  await prisma.quote.update({ where: { id: quote.id }, data: { lines: legacyLines, pricingVersion: 'legacy_v0', pricingStatus: 'incomplete', status: 'draft' } });

  const legacyRegister = (await gql('query($search:String,$take:Float,$skip:Float){quotePage(search:$search,take:$take,skip:$skip)}', { search: suffix, take: 10, skip: 0 }, token)).quotePage;
  assert(legacyRegister.rows[0]?.commercial?.pricingReady === false, 'Legacy quote must not advertise PDF readiness');

  const blockedJson = await fetch(`${WEB}/api/pdf/quote/${quote.id}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, redirect: 'manual' });
  const blockedPayload = await blockedJson.json();
  assert(blockedJson.status === 422 && blockedPayload.code === 'COMMERCIAL_VALIDATION_FAILED', `Legacy PDF must return governed 422 JSON, received ${blockedJson.status}`);
  assert(!/\/app\/|\n\s*at\s+/.test(String(blockedPayload.error || '')), 'Client PDF error must not expose renderer paths or stack frames');

  const blockedBrowser = await fetch(`${WEB}/api/pdf/quote/${quote.id}`, { headers: { authorization: `Bearer ${token}`, accept: 'text/html' }, redirect: 'manual' });
  assert(blockedBrowser.status === 303, `Browser PDF request must redirect to remediation, received ${blockedBrowser.status}`);
  assert((blockedBrowser.headers.get('location') || '').includes(`/dashboard/quotes/${quote.id}?pdfError=commercial-pricing`), 'Browser PDF redirect must target the exact quote remediation page');
  if (process.env.STOP_AFTER_BLOCKED === '1') {
    console.log(JSON.stringify({ ok: true, phase: 'legacy-blocked', quoteId: quote.id, quoteNumber: quote.quoteNumber, productId: product.id, customerId: customer.id, leadId: quote.leadId || null }, null, 2));
    return;
  }

  const refreshedLines = legacyLines.map((line) => ({
    ...line,
    pricingVersion: 'unified_retail_v1',
    mrpInclusive: Number(product.defaultMrpInclusive),
    mrpSource: 'PRODUCT_MASTER',
    nrpMode: 'FIXED_NRP',
    nrpInput: 800,
    specialMode: 'NONE',
    specialInput: 0,
    priceRateBasis: 'PIECE',
    rateBasis: 'PIECE',
    pricingUom: 'PC',
  }));
  await gql(
    'mutation($id:ID!,$input:UpdateQuoteInput!){updateQuote(id:$id,input:$input){id status pricingVersion pricingStatus lines}}',
    { id: quote.id, input: { saveAsDraft: false, quoteMeta: JSON.stringify({ taxMode: 'gst', pricingVersion: 'unified_retail_v1', quoteDiscount: { mode: 'PERCENT', value: 0 } }), lines: JSON.stringify(refreshedLines) } },
    token,
  );
  const readyRegister = (await gql('query($search:String,$take:Float,$skip:Float){quotePage(search:$search,take:$take,skip:$skip)}', { search: suffix, take: 10, skip: 0 }, token)).quotePage;
  assert(readyRegister.rows[0]?.commercial?.pricingReady === true, 'Validated quote must advertise PDF readiness');

  const pdfResponse = await fetch(`${WEB}/api/pdf/quote/${quote.id}`, { headers: { authorization: `Bearer ${token}` } });
  const pdf = Buffer.from(await pdfResponse.arrayBuffer());
  assert(pdfResponse.ok && pdf.subarray(0, 4).toString() === '%PDF' && pdf.length > 5000, `Validated quote must render a substantive PDF (${pdfResponse.status})`);
  console.log(JSON.stringify({ ok: true, quoteId: quote.id, quoteNumber: quote.quoteNumber, productId: product.id, customerId: customer.id, leadId: quote.leadId || null, legacyReadiness: false, sanitized422: true, browserRedirect: true, validatedReadiness: true, pdfBytes: pdf.length }, null, 2));
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; }).finally(async () => {
  if (process.env.KEEP_E2E_RECORDS !== '1') await cleanupE2eRecords(prisma, cleanup);
  await prisma.$disconnect();
});
