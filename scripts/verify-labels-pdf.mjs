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
const { assertRunReady, renderLabelsPdf, SAFE_MARGIN_MM } = require('../apps/web/scripts/render-labels-pdf.cjs');
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
  await fixture('00004', 'BRONZE MARBLE SQM', 'Matt', '2001', 185.5, 'SQM', 'Tiles', '600 x 600 mm'),
].flatMap((label) => [0, 1].map((copyIndex) => ({ ...label, copyIndex })));
// Production incident LPR/2026/0161: browser print rejected this tile even
// though its governed fields should fit both physical sticker stocks.
const incident = await fixture('INCIDENT', 'DUNE MIST (SUEDE FINISH)', 'QUARTZ', '1038', 1112, 'SQFT', 'Tiles', '3275 x 1460 x 20 (mm)');
const base = { id: 'fixture', runNumber: 'LPR/FIXTURE', status: 'prepared', labels };
const results = [];

// A physical sticker drifts and thermal heads cannot print the outermost edge.
// Every printed pixel must stay inside the safe area (shifted by any offset).
async function assertQuietMargin(pngPath, format, offset = { x: 0, y: 0 }) {
  const safe = Math.min(format.width, format.height) < 50 ? SAFE_MARGIN_MM.compact : SAFE_MARGIN_MM.standard;
  const { data, info } = await sharp(pngPath).greyscale().raw().toBuffer({ resolveWithObject: true });
  const pxPerMm = info.width / format.width;
  const band = (mmValue) => Math.max(0, Math.floor((mmValue - 0.35) * pxPerMm));
  const left = band(safe + offset.x), right = band(safe - offset.x), top = band(safe + offset.y), bottom = band(safe - offset.y);
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (x >= left && x < info.width - right && y >= top && y < info.height - bottom) continue;
      assert.ok(data[y * info.width + x] > 200, `${path.basename(pngPath)} prints inside the ${safe} mm quiet margin at ${(x / pxPerMm).toFixed(1)} x ${(y / pxPerMm).toFixed(1)} mm`);
    }
  }
}

const formats = [
  { name: '4x2-landscape', width: 101.6, height: 50.8, points: [288, 144] },
  { name: '4x2-portrait', width: 50.8, height: 101.6, points: [144, 288] },
  { name: '60x45-landscape', width: 60, height: 45, points: [170.079, 127.559] },
  { name: '60x45-portrait', width: 45, height: 60, points: [127.559, 170.079] },
];
for (const format of formats) {
  const run = { ...base, template: { code: 'thermal_4x2', version: 4, pageWidthMm: format.width, pageHeightMm: format.height, columns: 1, rows: 1 } };
  const pdfPath = path.join(output, `${format.name}.pdf`);
  const pdf = await renderLabelsPdf(run);
  writeFileSync(pdfPath, pdf);
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  const info = execFileSync('pdfinfo', ['-f', '1', '-l', '8', pdfPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.match(info, /Pages:\s+8\b/);
  const pageSize = new RegExp(`size:\\s+${format.points[0]}(?:0+)? x ${format.points[1]}(?:0+)? pts`, 'g');
  assert.equal([...info.matchAll(pageSize)].length, 8, 'Every sticker must have exact-size PDF media dimensions');
  const text = execFileSync(process.env.PDFTOTEXT || 'pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  for (const expected of ['ARORA', 'COCO', 'GLOSSY', 'CHROME', 'BRUSH HARD GRAPHITE', '/SQFT', '/SQM', '/PC', '1047', '1065', '2001', '1200 x 600 mm', '1200 x 2400 mm', '600 x 600 mm']) assert.ok(text.includes(expected), `Missing ${expected} on ${format.name}`);
  assert.match(text, /BRONZE\s+MARBLE\s+SQM/, `SQM tile product name missing on ${format.name}`);
  assert.equal((text.match(/LBL\/2026\/00001/g) || []).length, 2, 'Copies should be real duplicate pages');
  assert.equal((text.match(/LBL\/2026\/00004/g) || []).length, 2, 'SQM tile copies should be real duplicate pages');
  assert.equal((text.match(/FINISH/g) || []).length, 8, 'Finish must be present on every label');
  assert.equal((text.match(/1200 x 600 mm/g) || []).length, 2, 'Tile size appears once per tile copy');
  const pages = text.split('\f');
  for (const page of pages.filter((page) => page.includes('LBL/2026/00004'))) {
    assert.ok(page.includes('/SQM') && page.includes('185.5'), 'SQM tile rate and unit must print together on each copy');
  }
  for (const page of pages.filter((page) => page.includes('1200 x'))) {
    assert.ok(page.indexOf('1200 x') < page.indexOf('PRODUCT'), 'Tile size must sit in the brand row above the product');
  }
  for (const forbidden of ['MUST NOT', 'GRN/', 'GST', 'MRP', 'LOT', '3 PC', 'DO NOT PRINT GENERIC SIZE']) assert.ok(!text.includes(forbidden), `Forbidden label text: ${forbidden}`);
  execFileSync('pdftoppm', ['-f', '1', '-singlefile', '-scale-to', '1600', '-png', pdfPath, path.join(output, format.name)], { stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('pdftoppm', ['-f', '5', '-singlefile', '-scale-to', '1600', '-png', pdfPath, path.join(output, `${format.name}-long-product`)], { stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('pdftoppm', ['-f', '7', '-singlefile', '-scale-to', '1600', '-png', pdfPath, path.join(output, `${format.name}-sqm-tile`)], { stdio: ['ignore', 'pipe', 'pipe'] });
  for (const suffix of ['', '-long-product', '-sqm-tile']) {
    await assertQuietMargin(path.join(output, `${format.name}${suffix}.png`), format);
    const { data, info } = await sharp(path.join(output, `${format.name}${suffix}.png`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const decoded = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), info.width, info.height, { inversionAttempts: 'dontInvert' });
    assert.equal(decoded?.data, `MP-LABEL:LBL/2026/${suffix === '-long-product' ? '00003' : suffix === '-sqm-tile' ? '00004' : '00001'}`, 'The generated PDF QR must decode from its rendered physical page');
  }
  const incidentPdf = await renderLabelsPdf({ ...run, labels: [incident] });
  const incidentPath = path.join(output, `${format.name}-incident.pdf`);
  writeFileSync(incidentPath, incidentPdf);
  const incidentText = execFileSync(process.env.PDFTOTEXT || 'pdftotext', ['-layout', incidentPath, '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  for (const expected of ['1038', '3275 x 1460', 'DUNE MIST', 'SUEDE', 'FINISH)', 'QUARTZ', '1,112', '/SQFT']) {
    assert.ok(incidentText.includes(expected), `Production incident missing ${expected} on ${format.name}`);
  }
  assert.equal((incidentText.match(/3275 x 1460/g) || []).length, 1, 'Tile dimensions must print only once');
  execFileSync('pdftoppm', ['-f', '1', '-singlefile', '-scale-to', '1600', '-png', incidentPath, path.join(output, `${format.name}-incident`)], { stdio: ['ignore', 'pipe', 'pipe'] });
  const { data: incidentPixels, info: incidentImage } = await sharp(path.join(output, `${format.name}-incident.png`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const incidentQr = jsQR(new Uint8ClampedArray(incidentPixels.buffer, incidentPixels.byteOffset, incidentPixels.byteLength), incidentImage.width, incidentImage.height, { inversionAttempts: 'dontInvert' });
  assert.equal(incidentQr?.data, 'MP-LABEL:LBL/2026/INCIDENT', `Production incident QR must scan on ${format.name}`);
  await assertQuietMargin(path.join(output, `${format.name}-incident.png`), format);

  // Printer alignment: content moves as a whole and never changes size.
  const shifted = { x: 1.5, y: 1 };
  const shiftedPath = path.join(output, `${format.name}-shifted.pdf`);
  writeFileSync(shiftedPath, await renderLabelsPdf({ ...run, labels: [incident] }, { offsetXMm: shifted.x, offsetYMm: shifted.y }));
  const shiftedInfo = execFileSync('pdfinfo', [shiftedPath], { encoding: 'utf8' });
  assert.match(shiftedInfo, /Pages:\s+1\b/, 'An alignment offset must never add a page');
  execFileSync('pdftoppm', ['-f', '1', '-singlefile', '-scale-to', '1600', '-png', shiftedPath, path.join(output, `${format.name}-shifted`)]);
  await assertQuietMargin(path.join(output, `${format.name}-shifted.png`), format, shifted);
  results.push({ format: format.name, pages: 8, sizePoints: format.points, pdfPath });
}

assert.throws(() => assertRunReady({ ...base, template: { version: 3 } }), /older sticker layout/);
assert.throws(() => assertRunReady({ ...base, template: { code: 'other', version: 4, widthMm: 101.6, heightMm: 50.8 } }), /current 4 x 2 thermal/);
assert.doesNotThrow(() => assertRunReady({ ...base, labels: [{ ...labels[0], payload: { ...labels[0].payload, governedBrandCode: null, brandCode: null, finish: null } }], template: { version: 4, widthMm: 101.6, heightMm: 50.8 } }));
for (const status of ['cancelled', 'confirmed']) assert.throws(() => assertRunReady({ ...base, status, template: { version: 4, widthMm: 101.6, heightMm: 50.8 } }), /no longer prepared/);
assert.throws(() => assertRunReady({ ...base, template: { version: 4, widthMm: 210, heightMm: 297 } }), /exact 4 x 2 inch/);
await assert.rejects(() => renderLabelsPdf({ ...base, labels: [{ ...labels[0], qrDataUrl: 'https://example.com/qr.png' }], template: { version: 4, widthMm: 101.6, heightMm: 50.8 } }), /unsupported source/);
await assert.rejects(() => renderLabelsPdf({
  ...base,
  labels: [{ ...labels[0], payload: { ...labels[0].payload, compactProductValue: 'A'.repeat(220) } }],
  template: { version: 4, widthMm: 101.6, heightMm: 50.8 },
}), /too long to fit legibly within two lines/);
console.log(JSON.stringify({ ok: true, results, preservedCopies: true, finishPrinted: true, renderedQrDecodeChecks: 16, incidentCheckedInAllFormats: true, oldTemplatesRejected: true, externalImagesRejected: true }, null, 2));
