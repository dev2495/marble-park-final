import { PrismaClient } from '@prisma/client';

if (process.env.ALLOW_MUTATING_ACCEPTANCE !== 'true') {
  throw new Error('Refusing to run. Use only against an isolated acceptance database with ALLOW_MUTATING_ACCEPTANCE=true.');
}

const prisma = new PrismaClient();
const suffix = Date.now().toString(36).toUpperCase();
const customerId = `QUOTE-SCALE-C-${suffix}`;
const leadId = `QUOTE-SCALE-L-${suffix}`;
let evidence;

const elapsed = (startedAt) => Math.round((performance.now() - startedAt) * 100) / 100;

try {
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findFirst({ where: { active: true }, orderBy: { createdAt: 'asc' } });
    if (!user) throw new Error('Quote scale gate needs one active user in the isolated database');

    await tx.customer.create({
      data: {
        id: customerId,
        name: `Quote Scale Customer ${suffix}`,
        mobile: `7${String(Date.now()).slice(-9)}`,
        siteAddress: 'Rollback-only quote register scale gate',
        city: 'Vapi',
        updatedAt: new Date(),
      },
    });
    await tx.lead.create({
      data: {
        id: leadId,
        customerId,
        title: `Quote Scale Lead ${suffix}`,
        source: 'scale_gate',
        ownerId: user.id,
        stage: 'quoted',
        expectedValue: 0,
        lastContactAt: new Date(),
        nextActionAt: new Date(),
        notes: 'Rollback-only quote register scale gate',
        updatedAt: new Date(),
      },
    });

    const insertStart = performance.now();
    await tx.$executeRawUnsafe(`
      INSERT INTO "Quote" (
        "id", "quoteNumber", "leadId", "customerId", "ownerId", "architectName", "title", "status",
        "approvalStatus", "discountPercent", "commercialTotal", "projectName", "createdAt", "validUntil",
        "coverImage", "notes", "lines", "versions", "quoteMeta", "approval", "updatedAt"
      )
      SELECT
        'QUOTE-SCALE-${suffix}-' || g,
        'QT/SCALE/${suffix}/' || LPAD(g::text, 5, '0'),
        '${leadId}', '${customerId}', '${user.id}',
        CASE WHEN g % 3 = 0 THEN 'Scale Architect' ELSE NULL END,
        'Quote register scale fixture ' || g,
        CASE WHEN g % 5 = 0 THEN 'sent' WHEN g % 5 = 1 THEN 'confirmed' ELSE 'draft' END,
        'not_required', 0, (g % 5000) + 100,
        'Scale Project ${suffix}',
        NOW() - (g % 365 || ' days')::interval,
        NOW() + ((g % 90) + 1 || ' days')::interval,
        '', '', '[]'::jsonb, '[]'::jsonb, '{}'::jsonb,
        jsonb_build_object('pricing', jsonb_build_object('grandTotal', (g % 5000) + 100)),
        NOW()
      FROM generate_series(1, 10000) g
    `);
    const insertMs = elapsed(insertStart);

    await tx.$executeRawUnsafe('ANALYZE "Quote"');
    const queryStart = performance.now();
    const [valuePage, exactSearch, filteredSummary, searchPlan, valuePlan] = await Promise.all([
      tx.$queryRawUnsafe(`SELECT "id", "commercialTotal" FROM "Quote" WHERE "ownerId"='${user.id}' ORDER BY "commercialTotal" DESC, "createdAt" DESC LIMIT 25 OFFSET 4975`),
      tx.$queryRawUnsafe(`SELECT "id" FROM "Quote" WHERE "quoteNumber" ILIKE '%QT/SCALE/${suffix}/09999%' LIMIT 25`),
      tx.$queryRawUnsafe(`SELECT COUNT(*)::int AS count, COALESCE(SUM("commercialTotal"), 0)::float8 AS value FROM "Quote" WHERE "ownerId"='${user.id}' AND "status"='sent' AND "createdAt" >= NOW() - INTERVAL '370 days'`),
      tx.$queryRawUnsafe(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT "id" FROM "Quote" WHERE "quoteNumber" ILIKE '%QT/SCALE/${suffix}/09999%' LIMIT 25`),
      tx.$queryRawUnsafe(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT "id", "commercialTotal" FROM "Quote" WHERE "ownerId"='${user.id}' ORDER BY "commercialTotal" DESC, "createdAt" DESC LIMIT 25 OFFSET 4975`),
    ]);
    const queryMs = elapsed(queryStart);

    if (valuePage.length !== 25) throw new Error(`Expected a 25-row deep page, received ${valuePage.length}`);
    if (exactSearch.length !== 1) throw new Error(`Expected one exact suffix search result, received ${exactSearch.length}`);
    if (!filteredSummary[0]?.count || !Number.isFinite(Number(filteredSummary[0]?.value))) throw new Error('Filtered summary did not reconcile');
    for (let index = 1; index < valuePage.length; index += 1) {
      if (Number(valuePage[index - 1].commercialTotal) < Number(valuePage[index].commercialTotal)) {
        throw new Error('Deep value page is not sorted descending');
      }
    }
    if (queryMs > 3000) throw new Error(`Quote register scale queries exceeded 3000 ms (${queryMs} ms)`);

    evidence = {
      ok: true,
      rolledBack: true,
      syntheticQuotes: 10000,
      deepPageRows: valuePage.length,
      exactSearchRows: exactSearch.length,
      filteredCount: filteredSummary[0].count,
      timingsMs: { insert: insertMs, querySet: queryMs },
      plans: { search: searchPlan, valuePage: valuePlan },
    };
    throw new Error('__ROLLBACK_QUOTE_SCALE_GATE__');
  }, { maxWait: 10000, timeout: 180000 });
} catch (error) {
  if (error.message !== '__ROLLBACK_QUOTE_SCALE_GATE__') throw error;
} finally {
  await prisma.$disconnect();
}

if (!evidence) throw new Error('Quote register scale evidence was not produced');
console.log(JSON.stringify(evidence, null, 2));
