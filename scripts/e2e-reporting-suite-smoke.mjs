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
  assert(service.catalog(sales).every((row) => row.permission === 'reports.sales'), 'Sales catalog leaked a non-sales domain');
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
  }

  const bookings = results['owner.pulse'];
  assert(bookings.summaries >= 5, 'Owner pulse is too shallow');
  const salesDefinition = ownerCatalog.find((row) => row.title === 'Product/category sales');
  const salesReport = await service.report(sales, { reportId: salesDefinition.id, from, to, pageSize: 10 });
  assert.equal(salesReport.filters.rowScope, 'self');
  assert.equal(salesReport.filters.ownerId, sales.id);

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

  console.log(JSON.stringify({ ok: true, catalog: ownerCatalog.length, roleCatalogs: { sales: service.catalog(sales).length, inventory: service.catalog(inventory).length, dispatch: service.catalog(dispatch).length, office: service.catalog(office).length }, books: results, inventoryLotValue: directLotValue }, null, 2));
} finally {
  await prisma.$disconnect();
}
