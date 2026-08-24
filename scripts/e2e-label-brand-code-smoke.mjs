import { PrismaClient } from '@prisma/client';
import { cleanupE2eRecords } from './lib/cleanup-e2e-records.mjs';

if (process.env.ALLOW_MUTATING_ACCEPTANCE !== 'true') throw new Error('Run only against an isolated acceptance database with ALLOW_MUTATING_ACCEPTANCE=true.');

const API = process.env.API_URL || 'http://127.0.0.1:4000/graphql';
const EMAIL = process.env.TEST_EMAIL || '';
const PASSWORD = process.env.TEST_PASSWORD || '';
const prisma = new PrismaClient();
let productId = '';
let jobId = '';

const assert = (condition, message) => { if (!condition) throw new Error(message); };
async function gql(query, variables = {}, token) {
  const response = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ query, variables }) });
  const payload = await response.json();
  if (!response.ok || payload.errors?.length) throw new Error(payload.errors?.map((row) => row.message).join('; ') || `GraphQL ${response.status}`);
  return payload.data;
}

try {
  assert(EMAIL && PASSWORD, 'TEST_EMAIL and TEST_PASSWORD are required');
  const token = (await gql('mutation($input:LoginInput!){login(input:$input){token}}', { input: { email: EMAIL, password: PASSWORD } })).login.token;
  const setup = await gql('query{masterProductCategories(status:"active") masterProductBrands(status:"active") masterProductFinishes(status:"active") internalLabelTemplates}', {}, token);
  const brand = setup.masterProductBrands.find((row) => row.code) || setup.masterProductBrands[0];
  const category = setup.masterProductCategories[0];
  const finish = setup.masterProductFinishes[0];
  const template = setup.internalLabelTemplates.find((row) => row.code === 'a4_70x37') || setup.internalLabelTemplates[0];
  assert(brand?.name && brand?.code && category?.name && finish?.name && template?.code, 'Governed brand code, category, finish and label template are required');
  const suffix = Date.now().toString(36).toUpperCase();
  const product = (await gql('mutation($input:CreateProductInput!){createProduct(input:$input){id sku brand}}', { input: {
    sku: `LABEL-BRAND-${suffix}`, internalCode: `LB-${suffix}`, name: `Label brand-code acceptance ${suffix}`,
    category: category.name, brand: brand.name, finish: finish.name, unit: 'PC', taxClass: 'GST_18',
    defaultMrpInclusive: 1000, defaultNrpInclusive: 900, priceRateBasis: 'PIECE', priceUom: 'PC',
    mrpSource: 'MANUAL', pricingEffectiveFrom: new Date().toISOString(),
  } }, token)).createProduct;
  productId = product.id;
  const job = (await gql('mutation($input:InternalLabelJobInput!){createInternalLabelJob(input:$input)}', { input: { productId, quantity: 1, template: 'shelf', newJob: true } }, token)).createInternalLabelJob;
  jobId = job.id;
  const prepared = (await gql('mutation($input:InternalLabelPrintRunInput!){prepareInternalLabelPrintRun(input:$input)}', { input: { labelJobId: job.id, templateCode: template.code, copies: 1, reason: 'Brand code acceptance' } }, token)).prepareInternalLabelPrintRun;
  const run = (await gql('query($id:ID!){internalLabelPrintRun(id:$id)}', { id: prepared.id }, token)).internalLabelPrintRun;
  assert(run.labels?.length === 1, 'Prepared run must contain one label');
  assert(run.labels[0].payload.brandCode === brand.code, `Label must use Brand Master code ${brand.code}`);
  assert(run.labels[0].payload.brand === brand.name, 'Full brand name must remain in governed payload for traceability');
  assert(Number(run.labels[0].payload.mrpInclusive) === 1000, 'Label must use the governed Product Master MRP');
  assert(run.labels[0].payload.priceUom === 'PC', 'Generic product label must retain its governed pricing UOM');
  console.log(JSON.stringify({ ok: true, brandName: brand.name, printedBrandCode: run.labels[0].payload.brandCode, mrpInclusive: run.labels[0].payload.mrpInclusive, priceUom: run.labels[0].payload.priceUom }));
} finally {
  if (jobId) {
    await prisma.internalLabelPrintRun.deleteMany({ where: { labelJobId: jobId } }).catch(() => null);
    await prisma.internalLabelInstance.deleteMany({ where: { labelJobId: jobId } }).catch(() => null);
    await prisma.internalLabelJob.deleteMany({ where: { id: jobId } }).catch(() => null);
  }
  if (productId) await cleanupE2eRecords(prisma, { productIds: [productId] });
  await prisma.$disconnect();
}
