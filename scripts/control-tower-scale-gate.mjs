import { mkdir, writeFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const suffix = Date.now().toString(36).toUpperCase();
const ids = { customer: `SCALE-C-${suffix}`, product: `SCALE-P-${suffix}`, lead: `SCALE-LD-${suffix}`, quote: `SCALE-Q-${suffix}`, order: `SCALE-O-${suffix}` };
let evidence;

function elapsed(start) { return Math.round((performance.now() - start) * 100) / 100; }

try {
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findFirst({ where: { active: true }, orderBy: { createdAt: 'asc' } });
    const location = await tx.stockLocation.findFirst({ where: { status: 'active' }, orderBy: { sortOrder: 'asc' } });
    if (!user || !location) throw new Error('Scale gate needs one active user and stock location');
    await tx.customer.create({ data: { id: ids.customer, name: 'Scale Gate Customer', mobile: `8${String(Date.now()).slice(-9)}`, siteAddress: 'Rollback-only scale gate', city: 'Vapi', updatedAt: new Date() } });
    await tx.product.create({ data: { id: ids.product, sku: `SCALE-${suffix}`, internalCode: `SCALE-${suffix}`, name: 'Scale Gate Product', category: 'Scale Gate', brand: 'Scale Gate', finish: 'Test', dimensions: '', unit: 'PC', tags: [], sellPrice: 100, floorPrice: 80, costPrice: 60, mrp: 118, mrpRateBasis: 'PIECE', mrpVerifiedAt: new Date(), mrpVerifiedById: user.id, mrpSource: 'scale_gate', taxClass: 'GST_18', status: 'active', media: {}, sourceRefs: {}, description: 'Rollback-only scale gate', updatedAt: new Date() } });
    await tx.inventoryBalance.create({ data: { id: `SCALE-B-${suffix}`, productId: ids.product, onHand: 500, available: 500, reserved: 0, damaged: 0, hold: 0, updatedAt: new Date() } });
    await tx.lead.create({ data: { id: ids.lead, customerId: ids.customer, title: 'Scale Gate Lead', source: 'scale_gate', ownerId: user.id, stage: 'quoted', expectedValue: 1180000, lastContactAt: new Date(), nextActionAt: new Date(), notes: 'Rollback-only scale gate', updatedAt: new Date() } });
    await tx.quote.create({ data: { id: ids.quote, quoteNumber: `QT/SCALE/${suffix}`, leadId: ids.lead, customerId: ids.customer, ownerId: user.id, title: 'Scale Gate Quote', status: 'confirmed', approvalStatus: 'approved', discountPercent: 0, projectName: '', validUntil: new Date(Date.now() + 86400000), coverImage: '', notes: '', lines: [], versions: [], updatedAt: new Date() } });
    await tx.salesOrder.create({ data: { id: ids.order, orderNumber: `SO/SCALE/${suffix}`, quoteId: ids.quote, leadId: ids.lead, customerId: ids.customer, ownerId: user.id, status: 'open', paymentMode: 'cash', paymentStatus: 'partial', advanceAmount: 0, totalAmount: 1180000, lines: [], notes: '', updatedAt: new Date() } });

    const insertStart = performance.now();
    await tx.$executeRawUnsafe(`
      INSERT INTO "SalesOrderLine" ("id","salesOrderId","quoteId","lineKey","lineNo","productId","sku","name","category","brand","finish","unit","orderedQuantity","listPrice","mrp","mrpRateBasis","mrpSource","mrpConfirmedAt","mrpConfirmedById","unitPrice","taxableValue","taxAmount","grossLineTotal","lineTotal","status","metadata","updatedAt")
      SELECT 'SCALE-L-${suffix}-' || g, '${ids.order}', '${ids.quote}', 'LINE-' || g, g, '${ids.product}', 'SCALE-${suffix}', 'Scale Gate Line ' || g, 'Scale Gate', 'Scale Gate', 'Test', 'PC', 1, 100, 118, 'PIECE', 'scale_gate', NOW(), '${user.id}', 100, 100, 18, 118, 118,
        CASE WHEN g % 4 = 0 THEN 'pending_inward' WHEN g % 4 = 1 THEN 'ready' WHEN g % 4 = 2 THEN 'partial_dispatched' ELSE 'delivered' END,
        '{}'::jsonb, NOW()
      FROM generate_series(1, 10000) g
    `);
    await tx.$executeRawUnsafe(`
      INSERT INTO "InventoryLot" ("id","lotNumber","productId","sourceType","sourceId","sourceLineId","qualityStatus","receivedAt","unitCost","status","attributes","metadata","createdBy","updatedAt")
      SELECT 'SCALE-LOT-${suffix}-' || g, 'LOT/SCALE/${suffix}/' || g, '${ids.product}', 'scale_gate', 'SCALE-GRN-${suffix}', 'LINE-' || g, 'available', NOW() - (g || ' days')::interval, 60, 'active', '{}'::jsonb, '{}'::jsonb, '${user.id}', NOW()
      FROM generate_series(1, 500) g
    `);
    await tx.$executeRawUnsafe(`
      INSERT INTO "InventoryLotBalance" ("id","lotId","locationId","onHand","reserved","damaged","hold","available","updatedAt")
      SELECT 'SCALE-LB-${suffix}-' || g, 'SCALE-LOT-${suffix}-' || g, '${location.id}', 1, 0, 0, 0, 1, NOW()
      FROM generate_series(1, 500) g
    `);
    const insertMs = elapsed(insertStart);

    const queryStart = performance.now();
    const [orderPlan, lotPlan, summaryPlan] = await Promise.all([
      tx.$queryRawUnsafe(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT l."id", l."status" FROM "SalesOrderLine" l JOIN "SalesOrder" o ON o."id"=l."salesOrderId" JOIN "Customer" c ON c."id"=o."customerId" WHERE l."status" IN ('ready','pending_inward') AND (l."sku" ILIKE '%SCALE-${suffix}%' OR o."orderNumber" ILIKE '%SCALE%' OR c."name" ILIKE '%Scale Gate%') ORDER BY l."createdAt" DESC, l."id" DESC LIMIT 26`),
      tx.$queryRawUnsafe(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT lot."id" FROM "InventoryLot" lot WHERE lot."productId"='${ids.product}' AND lot."status"='active' ORDER BY lot."receivedAt", lot."id" LIMIT 50`),
      tx.$queryRawUnsafe(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT COUNT(*), SUM("orderedQuantity"), SUM("backorderedQuantity"), SUM("dispatchedQuantity") FROM "SalesOrderLine" WHERE "salesOrderId"='${ids.order}'`),
    ]);
    evidence = { ok: true, rolledBack: true, synthetic: { salesOrderLines: 10000, inventoryLots: 500 }, timingsMs: { insert: insertMs, explainQueries: elapsed(queryStart) }, plans: { orderRegister: orderPlan, fifoLots: lotPlan, orderSummary: summaryPlan }, generatedAt: new Date().toISOString() };
    throw new Error('__ROLLBACK_SCALE_GATE__');
  }, { maxWait: 10000, timeout: 180000 });
} catch (error) {
  if (error.message !== '__ROLLBACK_SCALE_GATE__') throw error;
} finally {
  await prisma.$disconnect();
}

if (!evidence) throw new Error('Scale evidence was not produced');
const outputDir = new URL('../reports/operations-control-tower-review-2026-08-04/evidence/', import.meta.url);
await mkdir(outputDir, { recursive: true });
await writeFile(new URL('control-tower-scale-gate.json', outputDir), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ ok: evidence.ok, rolledBack: evidence.rolledBack, synthetic: evidence.synthetic, timingsMs: evidence.timingsMs }, null, 2));
