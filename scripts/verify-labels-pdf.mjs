import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const jsQR = require('jsqr');
const { require: tsRequire } = require('tsx/cjs/api');
const { brandedLabelQrDataUrl } = tsRequire('../apps/api/src/modules/common/branded-label-qr.ts', import.meta.url);
const { assertRunReady, renderLabelsPdf } = require('../apps/web/scripts/render-labels-pdf.cjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'tmp/pdfs/label-v4-verification');
mkdirSync(output, { recursive: true });

const fixture = async (id, product, finish, brand, rate, uom, category = 'Sanitaryware', dimensions = 'DO NOT PRINT GENERIC SIZE') => {
  const labelCode = `LBL/2026/${id}`;
  return {
    id, labelCode, qrDataUrl: await brandedLabelQrDataUrl(`MP-LABEL:${labelCode}`),
    payload: {
      compactProductValue: product, governedBrandCode: brand, finish, mrpInclusive: rate, priceUom: uom,
      category, dimensions,
      brandName: 'MUST NOT PRINT BRAND NAME', productName: 'MUST NOT PRINT LONG DESCRIPTION', lotNumber: 'GRN/MUST-NOT-PRINT',
    },
  };
};
const labels = [
  await fixture('00001', 'ARORA ARAMANI COCO', 'Glossy', '1047', 65, 'SQFT', 'Tiles', '1200 x 600 mm (3 PC)'),
  await fixture('00002', 'ALD-CHR-079N', 'Chrome', 'JQ', 4010, 'PC'),
  await fixture('00003', 'LONG-COMPACT-PRODUCT-CODE-FOR-STICKER', 'BRUSH HARD GRAPHITE', '1065', 129999.5, 'SQFT', 'Tiles', '1200X2400 MM'),
].flatMap((label) => [0, 1].map((copyIndex) => ({ ...label, copyIndex })));
const base = { id: 'fixture', runNumber: 'LPR/FIXTURE', status: 'prepared', labels };
const results = [];

for (const orientation of ['landscape', 'portrait']) {
  const landscape = orientation === 'landscape';
  const run = { ...base, template: { code: 'thermal_4x2', version: 4, pageWidthMm: landscape ? 101.6 : 50.8, pageHeightMm: landscape ? 50.8 : 101.6, columns: 1, rows: 1 } };
  const pdfPath = path.join(output, `${orientation}.pdf`);
  const pdf = await renderLabelsPdf(run);
  writeFileSync(pdfPath, pdf);
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  const info = execFileSync('pdfinfo', ['-f', '1', '-l', '6', pdfPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.match(info, /Pages:\s+6\b/);
  const dimensions = landscape ? /size:\s+288 x 144 pts/g : /size:\s+144 x 288 pts/g;
  assert.equal([...info.matchAll(dimensions)].length, 6, 'Every sticker must have exact-size PDF media dimensions');
  const text = execFileSync(process.env.PDFTOTEXT || 'pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  for (const expected of ['ARORA', 'COCO', 'GLOSSY', 'CHROME', 'BRUSH HARD GRAPHITE', '/SQFT', '/PC', '1047', '1065', '1200 x 600 mm', '1200 x 2400 mm']) assert.ok(text.includes(expected), `Missing ${expected}`);
  assert.equal((text.match(/LBL\/2026\/00001/g) || []).length, 2, 'Copies should be real duplicate pages');
  assert.equal((text.match(/FINISH/g) || []).length, 6, 'Finish must be present on every label');
  assert.equal((text.match(/1200 x 600 mm/g) || []).length, 2, 'Tile size appears once per tile copy');
  const pages = text.split('\f');
  for (const page of pages.filter((page) => page.includes('1200 x'))) {
    assert.ok(page.indexOf('1200 x') < page.indexOf('PRODUCT'), 'Tile size must sit in the brand row above the product');
  }
  for (const forbidden of ['MUST NOT', 'GRN/', 'GST', 'MRP', 'LOT', '3 PC', 'DO NOT PRINT GENERIC SIZE']) assert.ok(!text.includes(forbidden), `Forbidden label text: ${forbidden}`);
  execFileSync('pdftoppm', ['-f', '1', '-singlefile', '-scale-to', '1600', '-png', pdfPath, path.join(output, orientation)], { stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('pdftoppm', ['-f', '5', '-singlefile', '-scale-to', '1600', '-png', pdfPath, path.join(output, `${orientation}-long-product`)], { stdio: ['ignore', 'pipe', 'pipe'] });
  for (const suffix of ['', '-long-product']) {
    const { data, info } = await sharp(path.join(output, `${orientation}${suffix}.png`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const decoded = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), info.width, info.height, { inversionAttempts: 'dontInvert' });
    assert.equal(decoded?.data, `MP-LABEL:LBL/2026/${suffix ? '00003' : '00001'}`, 'The generated PDF QR must decode from its rendered physical page');
  }
  results.push({ orientation, pages: 6, sizePoints: landscape ? [288, 144] : [144, 288], pdfPath });
}

assert.throws(() => assertRunReady({ ...base, template: { version: 3 } }), /older sticker layout/);
assert.throws(() => assertRunReady({ ...base, template: { code: 'other', version: 4, widthMm: 101.6, heightMm: 50.8 } }), /current 4 x 2 thermal/);
assert.doesNotThrow(() => assertRunReady({ ...base, labels: [{ ...labels[0], payload: { ...labels[0].payload, governedBrandCode: null, brandCode: null, finish: null } }], template: { version: 4, widthMm: 101.6, heightMm: 50.8 } }));
for (const status of ['cancelled', 'confirmed']) assert.throws(() => assertRunReady({ ...base, status, template: { version: 4, widthMm: 101.6, heightMm: 50.8 } }), /no longer prepared/);
assert.throws(() => assertRunReady({ ...base, template: { version: 4, widthMm: 210, heightMm: 297 } }), /exact 4 x 2/);
await assert.rejects(() => renderLabelsPdf({ ...base, labels: [{ ...labels[0], qrDataUrl: 'https://example.com/qr.png' }], template: { version: 4, widthMm: 101.6, heightMm: 50.8 } }), /unsupported source/);
await assert.rejects(() => renderLabelsPdf({
  ...base,
  labels: [{ ...labels[0], payload: { ...labels[0].payload, compactProductValue: 'A'.repeat(220) } }],
  template: { version: 4, widthMm: 101.6, heightMm: 50.8 },
}), /too long to fit legibly within two lines/);
console.log(JSON.stringify({ ok: true, results, preservedCopies: true, finishPrinted: true, renderedQrDecodeChecks: 4, oldTemplatesRejected: true, externalImagesRejected: true }, null, 2));
