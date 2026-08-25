import { PrismaClient } from '@prisma/client';
import { cleanupE2eRecords } from './lib/cleanup-e2e-records.mjs';

if (process.env.ALLOW_MUTATING_ACCEPTANCE !== 'true') throw new Error('Run only against an isolated acceptance database with ALLOW_MUTATING_ACCEPTANCE=true.');

const API = process.env.API_URL || 'http://127.0.0.1:4000/graphql';
const EMAIL = process.env.TEST_EMAIL || '';
const PASSWORD = process.env.TEST_PASSWORD || '';
const prisma = new PrismaClient();
const cleanup = { productIds: [], brandIds: [] };
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function gql(query, variables = {}, token, expectError = false) {
  const response = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ query, variables }) });
  const payload = await response.json();
  const message = payload.errors?.map((row) => row.message).join('; ') || '';
  if (expectError) return message;
  if (!response.ok || message) throw new Error(message || `GraphQL ${response.status}`);
  return payload.data;
}

try {
  assert(EMAIL && PASSWORD, 'TEST_EMAIL and TEST_PASSWORD are required');
  const token = (await gql('mutation($input:LoginInput!){login(input:$input){token}}', { input: { email: EMAIL, password: PASSWORD } })).login.token;
  const suffix = Date.now().toString(36).toUpperCase();
  const masters = await gql('query{masterProductCategories(status:"active") masterProductFinishes(status:"active")}', {}, token);
  const category = masters.masterProductCategories[0]?.name;
  const finish = masters.masterProductFinishes[0]?.name;
  assert(category && finish, 'Active Category and Finish masters are required');

  const createdBrand = (await gql('mutation($input:ProductBrandInput!){saveProductBrand(input:$input){data}}', { input: {
    name: `Audit brand ${suffix}`, code: `AB-${suffix}`, description: 'Acceptance create', status: 'active', sortOrder: 9800, metadata: { quoteEnabled: true },
  } }, token)).saveProductBrand.data;
  cleanup.brandIds.push(createdBrand.id);
  const updatedBrand = (await gql('mutation($input:ProductBrandInput!){saveProductBrand(input:$input){data}}', { input: {
    id: createdBrand.id, expectedUpdatedAt: createdBrand.updatedAt, name: createdBrand.name, code: createdBrand.code,
    description: 'Acceptance update with before/after audit', status: 'active', sortOrder: 9801, metadata: createdBrand.metadata,
  } }, token)).saveProductBrand.data;
  assert(updatedBrand.description.includes('before/after'), 'Brand edit must persist');
  const staleBrandError = await gql('mutation($input:ProductBrandInput!){saveProductBrand(input:$input){data}}', { input: {
    id: createdBrand.id, expectedUpdatedAt: createdBrand.updatedAt, name: createdBrand.name, code: createdBrand.code,
    description: 'Stale overwrite', status: 'active', sortOrder: 9802,
  } }, token, true);
  assert(/changed by another user|refresh/i.test(staleBrandError), 'Stale master-data edits must fail closed');

  const product = (await gql('mutation($input:CreateProductInput!){createProduct(input:$input){id sku internalCode name defaultMrpInclusive updatedAt}}', { input: {
    sku: `AUDIT-MRP-${suffix}`, internalCode: `AM-${suffix}`, name: `MRP audit acceptance ${suffix}`,
    category, brand: createdBrand.name, finish, unit: 'PC', purchaseUom: 'PC', salesUom: 'PC',
    defaultMrpInclusive: 1000, priceRateBasis: 'PIECE', priceUom: 'PC', mrpSource: 'MANUAL', pricingEffectiveFrom: new Date().toISOString(),
  } }, token)).createProduct;
  cleanup.productIds.push(product.id);
  const missingReason = await gql('mutation($id:ID!,$input:UpdateProductInput!){updateProduct(id:$id,input:$input){id}}', { id: product.id, input: {
    defaultMrpInclusive: 1100, expectedUpdatedAt: product.updatedAt,
  } }, token, true);
  assert(/reason/i.test(missingReason), 'An existing MRP cannot change without a reason');

  const revised = (await gql('mutation($id:ID!,$input:UpdateProductInput!){updateProduct(id:$id,input:$input){id name defaultMrpInclusive updatedAt}}', { id: product.id, input: {
    defaultMrpInclusive: 1100, mrpChangeReason: 'Supplier revised statutory MRP', expectedUpdatedAt: product.updatedAt,
  } }, token)).updateProduct;
  assert(Number(revised.defaultMrpInclusive) === 1100, 'MRP revision must persist');
  const renamed = (await gql('mutation($id:ID!,$input:UpdateProductInput!){updateProduct(id:$id,input:$input){id name defaultMrpInclusive updatedAt}}', { id: product.id, input: {
    name: `${product.name} revised`, expectedUpdatedAt: revised.updatedAt,
  } }, token)).updateProduct;
  assert(renamed.name.endsWith('revised'), 'Normal Product Master fields must remain editable');

  const history = (await gql('query($productId:String){productMrpHistoryPage(productId:$productId,take:20)}', { productId: product.id }, token)).productMrpHistoryPage;
  assert(history.total === 2, `Only initial MRP plus one MRP revision should exist, received ${history.total}`);
  assert(Number(history.items[0].previousMrpInclusive) === 1000 && Number(history.items[0].newMrpInclusive) === 1100, 'MRP revision must retain exact before and after values');
  assert(history.items[0].reason === 'Supplier revised statutory MRP', 'MRP history must retain the operator reason');

  const audit = await gql('query($filters:AuditFiltersInput){auditEvents(filters:$filters,take:50){events{id action entityType entityId metadata actor} total} auditFacets}', { filters: { search: product.internalCode } }, token);
  assert(audit.auditEvents.total >= 2, 'Product code search must find Product Master audit events');
  assert(audit.auditEvents.events.some((event) => event.action === 'product.update' && event.metadata?.before && event.metadata?.after), 'Product update must retain field-level before and after metadata');
  assert(audit.auditFacets.entityTypes.some((item) => item.value === 'Product'), 'Audit facets must expose the Product domain');
  const brandAudit = (await gql('query($filters:AuditFiltersInput){auditEvents(filters:$filters,take:20){events{id action metadata} total}}', { filters: { entityType: 'ProductBrand', entityId: createdBrand.id } }, token)).auditEvents;
  assert(brandAudit.events.some((event) => event.action === 'master.brand.update' && event.metadata?.before?.description === 'Acceptance create' && event.metadata?.after?.description === updatedBrand.description), 'Brand Master edit must retain exact before/after audit evidence');

  console.log(JSON.stringify({ ok: true, productCode: product.internalCode, mrpHistoryRows: history.total, searchedAuditEvents: audit.auditEvents.total, brandConcurrencyGuard: true, masterBeforeAfterAudit: true }));
} finally {
  await cleanupE2eRecords(prisma, cleanup);
  await prisma.$disconnect();
}
