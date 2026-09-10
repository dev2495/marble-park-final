/* eslint-disable */
/** Exact-size thermal sticker pages. Downloading never confirms a print run. */
const React = require('react');
const { Document, Page, Text, View, Image, renderToBuffer } = require('@react-pdf/renderer');
const PDFDocument = require('@react-pdf/pdfkit').default;
const sharp = require('sharp');

const e = React.createElement;
const mm = (value) => Number(value) * 72 / 25.4;
const clean = (value) => String(value == null ? '' : value).trim();
const blocked = (message) => new Error(`Label PDF blocked: ${message}`);
const fontMetrics = new PDFDocument({ autoFirstPage: false });
fontMetrics.font('Helvetica-Bold');

function assertRunReady(run) {
  if (!run || !run.template) throw blocked('The print template is unavailable. Prepare a new sticker run.');
  const template = run.template;
  if (template.code && template.code !== 'thermal_4x2') throw blocked('Select the current 4 x 2 thermal sticker template.');
  if (Number(template.version) < 4 || !Number.isFinite(Number(template.version))) {
    throw blocked('This run uses an older sticker layout. Return to Labels and prepare a new run with the current 4 x 2 template.');
  }
  const width = Number(template.pageWidthMm || template.widthMm);
  const height = Number(template.pageHeightMm || template.heightMm);
  const close = (a, b) => Math.abs(a - b) < 0.01;
  const landscape = close(width, 101.6) && close(height, 50.8);
  const portrait = close(width, 50.8) && close(height, 101.6);
  if (!landscape && !portrait) throw blocked('Select an exact 4 x 2 inch or 2 x 4 inch single-sticker template.');
  if (Number(template.columns || 1) !== 1 || Number(template.rows || 1) !== 1) {
    throw blocked('The thermal PDF requires one sticker per page. Prepare a new single-sticker run.');
  }
  if (run.status !== 'prepared') throw blocked('This print run is no longer prepared. Prepare a new sticker run so additional prints remain audited.');
  if (!Array.isArray(run.labels) || !run.labels.length) throw blocked('This print run has no printable labels.');
  if (run.labels.length > 1000) throw blocked('A print run cannot exceed 1,000 physical sticker pages.');
  for (const label of run.labels) {
    const payload = label.payload || {};
    if (!clean(label.labelCode)) throw blocked('A sticker is missing its registered label code. Prepare a new sticker run.');
    if (!clean(payload.compactProductValue || payload.productCode || payload.internalCode || payload.sku)) {
      throw blocked(`${label.labelCode} has no product code or tile design name.`);
    }
    if (!Number.isFinite(Number(payload.mrpInclusive)) || Number(payload.mrpInclusive) <= 0 || !clean(payload.priceUom)) {
      throw blocked(`${label.labelCode} needs a verified rate and price unit before printing.`);
    }
    if (!clean(label.qrDataUrl)) throw blocked(`${label.labelCode} has no QR image. Retry this run before printing.`);
  }
  return { width, height, landscape };
}

async function qrPng(dataUrl) {
  // Only the API's embedded QR is accepted: never retrieve remote image URLs.
  const match = /^data:image\/(svg\+xml|png);base64,([A-Za-z0-9+/=\s]+)$/.exec(clean(dataUrl));
  if (!match) throw blocked('A sticker QR image is unavailable or uses an unsupported source.');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 2 * 1024 * 1024) throw blocked('A sticker QR image is empty or too large.');
  if (match[1] === 'svg+xml') {
    const svg = bytes.toString('utf8');
    if (!/<svg\b/i.test(svg) || /<!DOCTYPE|<!ENTITY|<(?:script|image|foreignObject)\b|(?:href|xlink:href)\s*=|url\s*\(/i.test(svg)) {
      throw blocked('A sticker QR image contains unsupported embedded content.');
    }
  }
  try {
    return await sharp(bytes, { density: 400, limitInputPixels: 20_000_000 })
      .resize(900, 900, { fit: 'contain', background: '#ffffff' })
      .flatten({ background: '#ffffff' }).grayscale().png().toBuffer();
  } catch {
    throw blocked('A sticker QR image could not be decoded. Retry before printing.');
  }
}

function productFontSize(value, landscape) {
  const length = clean(value).length;
  if (landscape) return length <= 24 ? 13.5 : length <= 40 ? 12 : length <= 64 ? 10 : length <= 90 ? 9 : 8;
  return length <= 20 ? 13.5 : length <= 36 ? 11.5 : length <= 55 ? 10 : length <= 85 ? 8.5 : 7.5;
}

function rateText(value) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(Number(value));
}

function fitText(value, width, height, preferredFont, maxLines = Number.POSITIVE_INFINITY) {
  for (let fontSize = preferredFont; fontSize >= 7; fontSize -= 0.5) {
    fontMetrics.fontSize(fontSize);
    const lines = [];
    let remaining = clean(value);
    while (remaining) {
      let end = 1;
      while (end <= remaining.length && fontMetrics.widthOfString(remaining.slice(0, end)) <= width - 4) end += 1;
      end = Math.max(1, end - 1);
      if (end < remaining.length) {
        const breakAt = Math.max(remaining.lastIndexOf(' ', end), remaining.lastIndexOf('-', end));
        if (breakAt >= end / 3) end = breakAt + 1;
      }
      lines.push(remaining.slice(0, end).trim());
      remaining = remaining.slice(end).trim();
    }
    if (lines.length <= maxLines && lines.length * fontSize * 1.1 <= height) return { text: lines.join('\n'), fontSize };
  }
  throw blocked(maxLines < Number.POSITIVE_INFINITY
    ? 'A product code or design name is too long to fit legibly within two lines on this sticker. Shorten the printable master value before printing.'
    : 'A master code or design name is too long to fit legibly on this sticker. Shorten the printable master value before printing.');
}

function singleLineFont(value, width, preferredFont = 20) {
  for (let fontSize = preferredFont; fontSize >= 8; fontSize -= 0.5) {
    fontMetrics.fontSize(fontSize);
    if (fontMetrics.widthOfString(value) <= width - 4) return fontSize;
  }
  throw blocked('The rate is too long to fit legibly on this sticker. Check the master rate before printing.');
}

function Field({ caption, value, style, fontSize = 10 }) {
  return e(View, { style },
    e(Text, { style: { fontSize: 5.3, letterSpacing: 0.7, fontFamily: 'Helvetica-Bold', marginBottom: mm(0.5) } }, caption),
    e(Text, { style: { fontSize, fontFamily: 'Helvetica-Bold', lineHeight: 1.06 }, hyphenationCallback: (word) => [word] }, value),
  );
}

function Sticker({ label, geometry }) {
  const { width, height, landscape } = geometry;
  const payload = label.payload;
  const product = clean(payload.compactProductValue || payload.productCode || payload.internalCode || payload.sku).toUpperCase();
  const brand = clean(payload.governedBrandCode || payload.brandCode).toUpperCase() || 'PENDING';
  const finish = clean(payload.finish).toUpperCase() || 'NOT SET';
  const innerWidth = width - 3.6;
  const productFont = productFontSize(product, landscape);
  const detailWidth = mm(landscape ? innerWidth - 42.4 : innerWidth);
  const productFit = fitText(product, detailWidth, mm(landscape ? 13.5 : 13.2), productFont, 2);
  const brandFit = fitText(brand, detailWidth, mm(4.5), brand.length > 20 ? 9 : 11);
  const finishFit = fitText(finish, detailWidth, mm(4.2), finish.length > 35 ? 8 : 9);
  const price = `Rs. ${rateText(payload.mrpInclusive)}`;
  const rateFont = singleLineFont(price, detailWidth - mm(9));
  const qrSize = landscape ? 37.8 : 42;
  const bodyStyle = landscape
    ? { flexDirection: 'row', height: mm(42) }
    : { flexDirection: 'column', height: mm(92.8) };
  const detailsStyle = landscape
    ? { width: mm(innerWidth - 40.4), paddingLeft: mm(2), borderLeftWidth: 0.65, borderColor: '#111111' }
    : { width: '100%', paddingTop: mm(1.3), borderTopWidth: 0.65, borderColor: '#111111' };
  return e(Page, {
    key: `${label.id || label.labelCode}:${label.copyIndex || 0}`,
    size: [mm(width), mm(height)], wrap: false,
    style: { padding: mm(1.8), backgroundColor: '#ffffff', color: '#111111', fontFamily: 'Helvetica' },
  },
  e(View, { wrap: false, style: { width: mm(innerWidth), height: mm(height - 3.6) } },
    e(View, { style: { height: mm(4.4), borderBottomWidth: 0.65, borderColor: '#111111', marginBottom: mm(0.8), flexDirection: 'row', alignItems: 'center' } },
      e(Text, { style: { fontSize: 6.5, fontFamily: 'Helvetica-Bold', letterSpacing: 1 } }, 'MP  MARBLE PARK'),
    ),
    e(View, { style: bodyStyle },
      e(View, { style: { width: landscape ? mm(40.4) : '100%', height: landscape ? '100%' : mm(48), alignItems: 'center', justifyContent: 'center', paddingRight: landscape ? mm(1.2) : 0 } },
        e(Image, { src: { data: label.qrPng, format: 'png' }, style: { width: mm(qrSize), height: mm(qrSize) } }),
        e(Text, { style: { fontFamily: 'Helvetica-Bold', fontSize: 6.5, marginTop: mm(0.5), textAlign: 'center' } }, clean(label.labelCode)),
      ),
      e(View, { style: detailsStyle },
        e(Field, { caption: 'BRAND', value: brandFit.text, fontSize: brandFit.fontSize, style: { height: mm(7.5) } }),
        e(Field, { caption: 'PRODUCT', value: productFit.text, fontSize: productFit.fontSize, style: { height: mm(landscape ? 16.5 : 16.2) } }),
        e(Field, { caption: 'FINISH', value: finishFit.text, fontSize: finishFit.fontSize, style: { height: mm(7), paddingTop: mm(0.3) } }),
        e(View, { style: { borderTopWidth: 0.8, borderColor: '#111111', paddingTop: mm(0.9), flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' } },
          e(Text, { style: { fontSize: 5.8, fontFamily: 'Helvetica-Bold', letterSpacing: 0.7 } }, 'RATE'),
          e(View, { style: { alignItems: 'flex-end' } },
            e(Text, { style: { fontFamily: 'Helvetica-Bold', fontSize: rateFont, lineHeight: 1 } }, price),
            e(Text, { style: { fontFamily: 'Helvetica-Bold', fontSize: 7, marginTop: mm(0.4) } }, `/${clean(payload.priceUom).toUpperCase()}`),
          ),
        ),
      ),
    ),
  ));
}

async function renderLabelsPdf(run) {
  const geometry = assertRunReady(run);
  const qrCache = new Map();
  // Copies share one converted image; serial conversion bounds native image memory.
  for (const label of run.labels) {
    if (!qrCache.has(label.qrDataUrl)) qrCache.set(label.qrDataUrl, await qrPng(label.qrDataUrl));
  }
  const labels = run.labels.map((label) => ({ ...label, qrPng: qrCache.get(label.qrDataUrl) }));
  return renderToBuffer(e(Document, { title: `Marble Park stickers ${clean(run.runNumber)}`, author: 'Marble Park', creator: 'Marble Park Retail OS' },
    ...labels.map((label, index) => e(Sticker, { key: `${label.id || label.labelCode}:${index}`, label, geometry })),
  ));
}

async function fetchRun(id, apiUrl) {
  const token = clean(process.env.PDF_SESSION_TOKEN);
  if (!token) throw new Error('Login required');
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ query: 'query LabelRunForPdf($id: ID!) { internalLabelPrintRun(id: $id) }', variables: { id } }),
    signal: AbortSignal.timeout(25_000),
  });
  const payload = await response.json();
  if (!response.ok || payload.errors?.length || !payload.data?.internalLabelPrintRun) {
    throw new Error(payload.errors?.[0]?.message || 'Label print run not found');
  }
  return payload.data.internalLabelPrintRun;
}

async function main() {
  const [, , id, requestUrl, apiUrl] = process.argv;
  if (!id || !requestUrl || !apiUrl) throw new Error('Usage: render-labels-pdf.cjs <runId> <requestUrl> <apiUrl>');
  process.stdout.write(await renderLabelsPdf(await fetchRun(id, apiUrl)));
}

module.exports = { assertRunReady, renderLabelsPdf };
if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exit(1);
  });
}
