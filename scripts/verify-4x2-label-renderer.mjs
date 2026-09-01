import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../apps/web/src/app/print/labels/[runId]/page.tsx', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

assert(source.includes("const STANDARD_WIDTH_MM = 101.6"), 'The governed label width must remain exactly 4 inches (101.6 mm)');
assert(source.includes("const STANDARD_HEIGHT_MM = 50.8"), 'The governed label height must remain exactly 2 inches (50.8 mm)');
assert(source.includes('<span>BRAND CODE</span><strong>{brandCode}</strong>'), 'The printed label must show the governed Brand Master code');
assert(source.includes('<span>BRAND NAME</span><strong style={{ fontSize: brandNameSize }}>{brandName}</strong>'), 'The printed label must show the full governed Brand Master name');
assert(source.includes("const brandCode = payload.brandCode || 'CODE PENDING'"), 'Brand code must not silently fall back to brand name');
assert(source.includes("const brandName = payload.brand || 'NAME PENDING'"), 'Brand name must not silently fall back to brand code');
assert(source.includes('label.payload.brandCode') && source.includes('label.payload.brand'), 'Historical label templates must also retain both brand identities');

console.log(JSON.stringify({ ok: true, sizeMm: { width: 101.6, height: 50.8 }, printedFields: ['brandCode', 'brandName'] }));
