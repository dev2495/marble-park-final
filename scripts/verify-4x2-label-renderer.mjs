import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../apps/web/src/app/print/labels/[runId]/page.tsx', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../apps/api/prisma/migrations/20260902124500_portrait_4x2_label_v2/migration.sql', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const portraitStart = source.indexOf('function PortraitFourByTwoLabel');
const historicStart = source.indexOf('function StandardFourByTwoLabel');
const portraitSource = source.slice(portraitStart, historicStart);

assert(source.includes('const PORTRAIT_WIDTH_MM = 50.8'), 'The active sticker width must remain exactly 2 inches (50.8 mm)');
assert(source.includes('const PORTRAIT_HEIGHT_MM = 101.6'), 'The active sticker height must remain exactly 4 inches (101.6 mm)');
assert(portraitStart >= 0 && historicStart > portraitStart, 'The versioned portrait renderer must remain isolated from the historical renderer');
assert(portraitSource.includes('BRAND CODE') && portraitSource.includes('{brandCode}'), 'The portrait label must show the governed Brand Master code');
assert(portraitSource.includes('PRODUCT CODE') && portraitSource.includes('{productCode}'), 'The portrait label must show the governed product code');
assert(portraitSource.includes('LOT CODE') && portraitSource.includes('DISPLAY CODE'), 'Lot and display labels must retain their exact identity code');
assert(portraitSource.includes('<span>RATE</span>') && portraitSource.includes('payload.mrpInclusive'), 'The portrait label must show the governed value as a direct rate');
for (const forbidden of ['brandName', 'productName', 'dimensions', 'finish', 'MRP', 'GST', 'TAX', 'WAREHOUSE SKU', 'TRACE']) {
  assert(!portraitSource.includes(forbidden), `The portrait label must not render removed field or wording: ${forbidden}`);
}
assert(!/payload\.brand(?!Code)/.test(portraitSource), 'The portrait label must not render the product brand name');
assert(source.includes('.mp-portrait-label-page:not(:last-child)') && source.includes('page-break-after: always'), 'Every portrait label must force its own physical page');
assert(migration.includes("'thermal_4x2',\n  2") && migration.includes('"orientation":"portrait"') && migration.includes('50.8,\n  101.6,\n  50.8,\n  101.6'), 'The active template migration must be version 2 at exact portrait dimensions');

console.log(JSON.stringify({ ok: true, version: 2, sizeMm: { width: 50.8, height: 101.6 }, printedFields: ['qr', 'labelCode', 'brandCode', 'productCode', 'identityCode', 'rate', 'rateUom'] }));
