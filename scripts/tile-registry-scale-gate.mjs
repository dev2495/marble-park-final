import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const suffix = Date.now().toString(36).toUpperCase();
const rowCount = Number(process.env.TILE_SCALE_ROWS || 10000);
let evidence;

function elapsed(start) { return Math.round((performance.now() - start) * 100) / 100; }
function planTime(plan) { return Number(plan?.[0]?.['QUERY PLAN']?.[0]?.['Execution Time'] || 0); }

try {
  const size = await prisma.tileSize.findFirst({ where: { status: 'active' }, orderBy: { sortOrder: 'asc' } });
  if (!size) throw new Error('An active governed Tile Size is required for the scale gate');
  const escapedSizeName = String(size.name).replaceAll("'", "''");
  await prisma.$transaction(async (tx) => {
    const insertStarted = performance.now();
    await tx.$executeRawUnsafe(`
      INSERT INTO "TileDesign" ("id","designCode","name","brand","collection","material","surface","style","colour","pattern","usage","description","media","tags","status","metadata","createdAt","updatedAt")
      SELECT 'TD-SCALE-${suffix}-' || g, 'TD-${suffix}-' || LPAD(g::text, 6, '0'),
        'Scale tile design ' || LPAD(g::text, 6, '0'), 'Scale Brand', 'Scale Collection', 'Porcelain', 'Matt', 'Stone', 'Ivory', 'Vein',
        '["floor","wall"]'::jsonb, 'Rollback-only tile registry scale gate', '{}'::jsonb, '[]'::jsonb, 'active', '{}'::jsonb, NOW(), NOW()
      FROM generate_series(1, ${rowCount}) g
    `);
    await tx.$executeRawUnsafe(`
      INSERT INTO "Product" ("id","sku","internalCode","name","category","brand","finish","dimensions","unit","tags","sellPrice","floorPrice","costPrice","taxClass","status","media","sourceRefs","description","tileSizeId","tileDesignId","baseUom","purchaseUom","salesUom","piecesPerPack","coveragePerPack","trackLots","allowLoose","updatedAt")
      SELECT 'TV-SCALE-${suffix}-' || g, 'TV-${suffix}-' || LPAD(g::text, 6, '0'), 'TC-${suffix}-' || LPAD(g::text, 6, '0'),
        'Scale tile variant ' || LPAD(g::text, 6, '0'), 'Tiles', 'Scale Brand', 'Matt', '${escapedSizeName}', 'BOX', '[]'::jsonb,
        1000 + g, 900 + g, 700 + g, 'GST_18', 'active', '{}'::jsonb, '{}'::jsonb, 'Rollback-only tile registry scale gate',
        '${size.id}', 'TD-SCALE-${suffix}-' || g, 'PC', 'BOX', 'BOX', ${Math.max(1, Number(size.pcsPerBox || 1))}, 0, true, true, NOW()
      FROM generate_series(1, ${rowCount}) g
    `);
    await tx.$executeRawUnsafe(`
      INSERT INTO "ProductAlias" ("id","productId","type","value","normalizedValue","status","isPrimary","metadata","updatedAt")
      SELECT 'TA-SCALE-${suffix}-' || g, 'TV-SCALE-${suffix}-' || g, 'supplier_sku',
        'SUP-${suffix}-' || LPAD(g::text, 6, '0'), 'SUP-${suffix}-' || LPAD(g::text, 6, '0'), 'active', false, '{}'::jsonb, NOW()
      FROM generate_series(1, ${rowCount}) g
    `);
    const insertMs = elapsed(insertStarted);
    const queryStarted = performance.now();
    const [designFirst, designDeep, designSearch, variantDeep, aliasSearch] = await Promise.all([
      tx.$queryRawUnsafe(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT "id","designCode","name" FROM "TileDesign" WHERE "status"='active' ORDER BY "updatedAt" DESC,"id" DESC LIMIT 30`),
      tx.$queryRawUnsafe(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT "id","designCode","name" FROM "TileDesign" WHERE "status"='active' ORDER BY "designCode","id" OFFSET ${Math.max(0, rowCount - 30)} LIMIT 30`),
      tx.$queryRawUnsafe(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT "id","designCode","name" FROM "TileDesign" WHERE "status"='active' AND ("designCode" ILIKE '%TD-${suffix}-009999%' OR "name" ILIKE '%design 009999%') LIMIT 30`),
      tx.$queryRawUnsafe(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT "id","sku","name" FROM "Product" WHERE LOWER("category")='tiles' AND "status"='active' ORDER BY "sku","id" OFFSET ${Math.max(0, rowCount - 40)} LIMIT 40`),
      tx.$queryRawUnsafe(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT p."id",p."sku" FROM "Product" p JOIN "ProductAlias" a ON a."productId"=p."id" WHERE a."status"='active' AND a."normalizedValue" ILIKE '%SUP-${suffix}-009999%' LIMIT 40`),
    ]);
    evidence = {
      ok: true, rolledBack: true, syntheticDesigns: rowCount, syntheticVariants: rowCount, syntheticAliases: rowCount,
      timingsMs: { insert: insertMs, allQueries: elapsed(queryStarted), designFirst: planTime(designFirst), designDeep: planTime(designDeep), designSearch: planTime(designSearch), variantDeep: planTime(variantDeep), aliasSearch: planTime(aliasSearch) },
    };
    throw new Error('__ROLLBACK_TILE_SCALE__');
  }, { maxWait: 10000, timeout: 180000 });
} catch (error) {
  if (error?.message !== '__ROLLBACK_TILE_SCALE__') throw error;
} finally {
  await prisma.$disconnect();
}

if (!evidence) throw new Error('Tile registry scale evidence was not produced');
console.log(JSON.stringify(evidence, null, 2));
