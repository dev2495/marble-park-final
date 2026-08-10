import assert from 'node:assert/strict';
import { ReportingService } from '../apps/api/dist/src/modules/reporting/reporting.service.js';
import { PrismaService } from '../apps/api/dist/src/modules/prisma/prisma.service.js';
import { effectivePermissionsForUser } from '../apps/api/dist/src/modules/auth/rbac.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const prisma = new PrismaService();
await prisma.$connect();

try {
  const service = new ReportingService(prisma);
  const dbUsers = await prisma.user.findMany({ where: { active: true }, orderBy: { createdAt: 'asc' } });
  assert(dbUsers.length, 'Reporting smoke needs at least one active cloned test user');
  const asUser = (role, fallback = dbUsers[0]) => {
    const record = dbUsers.find((user) => user.role === role) || fallback;
    return { id: record.id, name: record.name, email: record.email, role, permissionOverrides: {}, effectivePermissions: effectivePermissionsForUser({ role, permissionOverrides: {} }) };
  };
  const owner = asUser('owner');
  const sales = asUser('sales');
  const inventory = asUser('inventory_manager');
  const dispatch = asUser('dispatch_ops');
  const office = asUser('office_staff');

  const ownerCatalog = service.catalog(owner);
  assert.equal(ownerCatalog.length, 81, 'Owner catalog must expose all 81 governed definitions');
  const suiteDomains = {
    sales: ['Sales', 'Architect & customer', 'Quotes & orders', 'Product & pricing'],
    finance: ['Executive & financial', 'Receivables & cash'],
    inventory: ['Inventory & warehouse'],
    operations: ['Procurement & vendor', 'Fulfilment', 'Documents & engagement', 'Audit & quality'],
  };
  const governedDomains = new Set(ownerCatalog.map((row) => row.domain));
  const mappedDomains = new Set(Object.values(suiteDomains).flat());
  assert.deepEqual([...mappedDomains].sort(), [...governedDomains].sort(), 'Every governed domain must map to exactly one decision suite');
  for (const [suite, domains] of Object.entries(suiteDomains)) {
    assert(ownerCatalog.some((row) => domains.includes(row.domain)), `${suite} suite has no governed reports`);
  }
  assert(service.catalog(sales).every((row) => row.permission === 'reports.sales'), 'Sales catalog leaked a non-sales domain');
  assert(service.catalog(sales).some((row) => row.title === 'Quote-to-order conversion'), 'Sales catalog must include quote/order conversion');
  assert(!service.catalog(sales).some((row) => row.title === 'Dispatch backlog'), 'Sales catalog must not expose operational dispatch controls');
  assert(service.catalog(inventory).every((row) => ['reports.inventory', 'reports.procurement'].includes(row.permission)), 'Inventory catalog leaked a restricted domain');
  assert(service.catalog(dispatch).every((row) => row.permission === 'reports.fulfilment'), 'Dispatch catalog leaked a restricted domain');
  assert(service.catalog(office).every((row) => ['reports.procurement', 'reports.fulfilment'].includes(row.permission)), 'Office catalog leaked a restricted domain');

  const from = '2025-08-11';
  const to = '2026-08-10';
  const titleForBook = {
    'owner.pulse': 'Management financial pulse',
    'sales.product': 'Product/category sales',
    'inventory.stock': 'Stock by location and lot',
    'procurement.vendor': 'Vendor fulfilment scorecard',
    'finance.receivables': 'Customer AR aging',
    'fulfilment.pipeline': 'Order fulfilment control tower',
    'audit.quality': 'Audit event register',
  };
  const results = {};
  const reportByBook = {};
  for (const [bookId, title] of Object.entries(titleForBook)) {
    const definition = ownerCatalog.find((row) => row.title === title);
    assert(definition, `Catalog is missing ${title}`);
    const report = await service.report(owner, { reportId: definition.id, from, to, page: 1, pageSize: 25 });
    assert.equal(report.meta.bookId, bookId);
    assert.equal(report.meta.timezone, 'Asia/Kolkata');
    assert(report.meta.generatedAt);
    assert(Array.isArray(report.summary));
    assert(report.rows.items.length <= 25, `${title} ignored server page size`);
    assert(report.rows.total >= report.rows.items.length);
    assert(!JSON.stringify(report).includes('NaN'), `${title} returned NaN`);
    results[bookId] = { summaries: report.summary.length, rows: report.rows.total, coverage: report.meta.coverage };
    reportByBook[bookId] = report;
  }

  assert(reportByBook['fulfilment.pipeline'].rows.items.every((row) => !row.href || row.href === '/dashboard/orders'), 'Fulfilment drill-through points at an unsupported route');

  const bookings = results['owner.pulse'];
  assert(bookings.summaries >= 5, 'Owner pulse is too shallow');
  const salesDefinition = ownerCatalog.find((row) => row.title === 'Product/category sales');
  const salesReport = await service.report(sales, { reportId: salesDefinition.id, from, to, pageSize: 10 });
  assert.equal(salesReport.filters.rowScope, 'self');
  assert.equal(salesReport.filters.ownerId, sales.id);
  for (const metricId of ['net_sales', 'bookings', 'collections', 'tax', 'discount', 'orders', 'cancelled', 'quotes', 'customers', 'returns', 'units']) {
    assert(salesReport.summary.some((row) => row.id === metricId), `Sales report is missing ${metricId}`);
  }
  assert.deepEqual(salesReport.breakdowns.map((row) => row.id), ['product_pareto', 'category_mix', 'brand_mix']);
  assert(salesReport.meta.warnings.some((warning) => warning.includes('Gross margin is not shown')), 'Sales report must expose the governed margin boundary');
  const operatorDefinition = ownerCatalog.find((row) => row.title === 'Sales by owner');
  const operatorReport = await service.report(owner, { reportId: operatorDefinition.id, from, to, pageSize: 10 });
  assert(operatorReport.rows.columns.some((column) => column.key === 'owner'));
  assert.deepEqual(operatorReport.breakdowns.map((row) => row.id), ['owner_mix', 'lead_source', 'order_status']);
  const architectDefinition = ownerCatalog.find((row) => row.title === 'Architect portfolio');
  const architectReport = await service.report(owner, { reportId: architectDefinition.id, from, to, pageSize: 10 });
  assert(architectReport.rows.columns.some((column) => column.key === 'architect'));
  assert.deepEqual(architectReport.breakdowns.map((row) => row.id), ['architect', 'customer', 'city']);

  const future = ownerCatalog.find((row) => row.title === 'Supplier payables aging');
  const futureReport = await service.report(owner, { reportId: future.id, from, to });
  assert.equal(futureReport.unavailable.code, 'NEEDS_SETUP');
  assert.equal(futureReport.summary.length, 0, 'Unsupported AP must not fabricate a summary');

  const preset = await service.savePreset(owner, { reportId: salesDefinition.id, name: `Reporting smoke ${Date.now()}`, config: { datePreset: 'last_30_days', columns: ['sku', 'netValue'], metrics: ['net_sales'], filters: { ownerId: owner.id }, pageSize: 25 } });
  assert.equal(preset.ownerId, owner.id);
  assert((await service.presets(owner, salesDefinition.id)).some((row) => row.id === preset.id));
  assert.equal(await service.deletePreset(owner, preset.id), true);

  const directLotRows = await prisma.inventoryLotBalance.findMany({ include: { lot: true } });
  const directLotValue = directLotRows.reduce((total, row) => total + Number(row.onHand || 0) * Number(row.lot?.unitCost || 0), 0);
  const inventoryDefinition = ownerCatalog.find((row) => row.title === 'Stock by location and lot');
  const inventoryReport = await service.report(owner, { reportId: inventoryDefinition.id, from, to, pageSize: 10 });
  const reportedLotValue = inventoryReport.summary.find((row) => row.id === 'stock_value')?.current;
  assert.equal(reportedLotValue, Number(directLotValue.toFixed(2)), 'Inventory report does not reconcile to lot on-hand × lot cost');
  const traceDefinition = ownerCatalog.find((row) => row.title === 'Lot traceability');
  const traceReport = await service.report(owner, { reportId: traceDefinition.id, from, to, pageSize: 10 });
  assert(traceReport.rows.columns.some((column) => column.key === 'reference'), 'Traceability must expose its source document');
  assert(traceReport.rows.columns.some((column) => column.key === 'onHandDelta'), 'Traceability must expose stock impact');
  const reorderDefinition = ownerCatalog.find((row) => row.title === 'Reorder exception list');
  const reorderReport = await service.report(owner, { reportId: reorderDefinition.id, from, to, pageSize: 10 });
  assert(reorderReport.rows.columns.some((column) => column.key === 'reorderPoint'), 'Reorder control must expose the governed threshold');
  assert(reorderReport.rows.columns.some((column) => column.key === 'packMultiple'), 'Reorder control must expose packing constraints');

  console.log(JSON.stringify({ ok: true, catalog: ownerCatalog.length, roleCatalogs: { sales: service.catalog(sales).length, inventory: service.catalog(inventory).length, dispatch: service.catalog(dispatch).length, office: service.catalog(office).length }, books: results, inventoryLotValue: directLotValue }, null, 2));
} finally {
  await prisma.$disconnect();
}
