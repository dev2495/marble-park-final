import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const suffix = Date.now().toString(36).toUpperCase();
const rowCount = Number(process.env.CATALOGUE_SCALE_ROWS || 5000);
let evidence;

function elapsed(start) { return Math.round((performance.now() - start) * 100) / 100; }
function planTime(plan) { return Number(plan?.[0]?.['QUERY PLAN']?.[0]?.['Execution Time'] || plan?.[0]?.['Execution Time'] || 0); }

try {
  await prisma.$transaction(async (tx) => {
    const insertStarted = performance.now();
    await tx.$executeRawUnsafe(`
      INSERT INTO "Product" ("id","sku","internalCode","name","category","brand","finish","dimensions","unit","tags","sellPrice","floorPrice","costPrice","taxClass","status","media","sourceRefs","description","baseUom","purchaseUom","salesUom","piecesPerPack","coveragePerPack","trackLots","allowLoose","updatedAt")
      SELECT 'CAT-SCALE-${suffix}-' || g, 'CAT-${suffix}-' || LPAD(g::text, 6, '0'), 'CI-${suffix}-' || LPAD(g::text, 6, '0'),
        'Catalogue scale design ' || LPAD(g::text, 6, '0'), 'Tiles', 'Scale Brand', 'Matt', '600 x 1200 mm', 'BOX', '[]'::jsonb,
        1000 + g, 900 + g, 700 + g, 'GST_18', 'active', '{}'::jsonb, '{}'::jsonb, 'Rollback-only catalogue scale gate',
        'PC', 'BOX', 'BOX', 2, 16, true, false, NOW()
      FROM generate_series(1, ${rowCount}) g
    `);
    const insertMs = elapsed(insertStarted);

    const queryStarted = performance.now();
    const [firstPage, deepPage, codeSearch, nameSearch] = await Promise.all([
      tx.$queryRawUnsafe(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT "id","sku","name","media" FROM "Product" WHERE "status"='active' ORDER BY "name","id" LIMIT 37`),
      tx.$queryRawUnsafe(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT "id","sku","name","media" FROM "Product" WHERE "status"='active' ORDER BY "name","id" OFFSET ${Math.max(0, rowCount - 40)} LIMIT 37`),
      tx.$queryRawUnsafe(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT "id","sku","name" FROM "Product" WHERE "status"='active' AND "internalCode" ILIKE '%CI-${suffix}-004999%' ORDER BY "name","id" LIMIT 37`),
      tx.$queryRawUnsafe(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT "id","sku","name" FROM "Product" WHERE "status"='active' AND "name" ILIKE '%design 004999%' ORDER BY "name","id" LIMIT 37`),
    ]);
    evidence = {
      ok: true,
      rolledBack: true,
      syntheticProducts: rowCount,
      timingsMs: {
        insert: insertMs,
        allQueries: elapsed(queryStarted),
        firstPage: planTime(firstPage),
        deepPage: planTime(deepPage),
        internalCodeSearch: planTime(codeSearch),
        nameSearch: planTime(nameSearch),
      },
    };
    throw new Error('__ROLLBACK_CATALOGUE_SCALE__');
  }, { maxWait: 10_000, timeout: 180_000 });
} catch (error) {
  if (error?.message !== '__ROLLBACK_CATALOGUE_SCALE__') throw error;
} finally { await prisma.$disconnect(); }

if (!evidence) throw new Error('Catalogue scale evidence was not produced');
console.log(JSON.stringify(evidence, null, 2));
