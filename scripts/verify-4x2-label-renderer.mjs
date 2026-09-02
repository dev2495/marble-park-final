import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../apps/web/src/app/print/labels/[runId]/page.tsx', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../apps/api/prisma/migrations/20260902160000_label_v3_grn_corrections/migration.sql', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const v2Start = source.indexOf('function PortraitFourByTwoLabelV2');
const v3Start = source.indexOf('function CompactPortraitFourByTwoLabelV3');
const historicStart = source.indexOf('function StandardFourByTwoLabel');
const v2Source = source.slice(v2Start, v3Start);
const v3Source = source.slice(v3Start, source.indexOf('async function waitForPrintAssets'));

assert(source.includes('const PORTRAIT_WIDTH_MM = 50.8'), 'The active sticker width must remain exactly 2 inches (50.8 mm)');
assert(source.includes('const PORTRAIT_HEIGHT_MM = 101.6'), 'The active sticker height must remain exactly 4 inches (101.6 mm)');
assert(v2Start >= 0 && v3Start > v2Start && historicStart > v3Start, 'V2, V3 and historical label renderers must remain isolated');
assert(v2Source.includes('LOT CODE') && v2Source.includes('DISPLAY CODE'), 'V2 print runs must preserve their historical identity renderer');
assert(v3Source.includes('payload.governedBrandCode') && v3Source.includes('<span>BRAND</span>') && v3Source.includes('{brandCode}'), 'V3 must show the governed Brand Master code with a compact caption');
assert(v3Source.includes('payload.compactProductValue') && v3Source.includes('<span>PRODUCT</span>') && v3Source.includes('{productValue}'), 'V3 must show the compact governed product/design value');
assert(v3Source.includes('<span>RATE</span>') && v3Source.includes('payload.mrpInclusive'), 'V3 must show the governed value as a direct rate');
for (const forbidden of ['lotNumber', 'sourceDocument', 'supplierBatch', 'identityCode', 'brandName', 'productName', 'dimensions', 'finish', 'MRP', 'GST', 'TAX', 'WAREHOUSE SKU', 'TRACE']) {
  assert(!v3Source.includes(forbidden), `V3 must not render removed field or wording: ${forbidden}`);
}
assert(!/payload\.governedBrandName/.test(v3Source), 'V3 must not render the brand name');
assert(source.includes('.mp-v3-label-page:not(:last-child)') && source.includes('page-break-after: always'), 'Every V3 label must force its own physical page');
assert(migration.includes("'thermal_4x2',\n  3") && migration.includes('"orientation":"portrait"') && migration.includes('50.8,\n  101.6,\n  50.8,\n  101.6'), 'The active template migration must be version 3 at exact portrait dimensions');
assert(migration.includes('brand_product_rate_no_lot'), 'The template contract must explicitly exclude lot text');

console.log(JSON.stringify({ ok: true, version: 3, sizeMm: { width: 50.8, height: 101.6 }, printedFields: ['qr', 'labelCode', 'brandCode', 'productOrTileDesign', 'rate', 'rateUom'], removed: ['brandName', 'lot', 'grn', 'taxText'] }));
