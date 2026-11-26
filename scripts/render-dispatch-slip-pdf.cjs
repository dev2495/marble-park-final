/* eslint-disable */
const React = require('react');
const { Document, Page, Text, View, StyleSheet, Image, renderToBuffer } = require('@react-pdf/renderer');
const { formatBoxQuantity } = require('../packages/pricing-contract/box-quantity');

// Challan lines count pieces; a boxed tile reads in boxes with the pieces beneath.
function lineQuantity(line) {
  return formatBoxQuantity(line.dispatchQty || 0, { unit: line.unit || 'PC', orderUnit: line.orderUnit, piecesPerUnit: line.piecesPerUnit ?? 1, piecesPerBox: line.piecesPerBox, soldBy: line.soldBy });
}
// Box-sold: whole boxes ("39"); piece-sold: "38 + 2 pc".
function qtyText(qty) {
  return qty.isBoxed ? `${qty.boxes}${qty.loosePieces ? ` + ${qty.loosePieces} pc` : ''}` : String(qty.boxes);
}
// Total boxes (and loose pieces) across boxed lines, then a total per other unit.
function totalsText(quantities) {
  const boxed = quantities.filter((qty) => qty.isBoxed);
  const parts = [];
  if (boxed.length) {
    const boxes = boxed.reduce((sum, qty) => sum + qty.boxes, 0);
    const loose = boxed.reduce((sum, qty) => sum + qty.loosePieces, 0);
    parts.push(`${boxes} Box${loose ? ` + ${loose} pc` : ''}`);
  }
  const other = new Map();
  for (const qty of quantities.filter((row) => !row.isBoxed)) other.set(qty.unitLabel, Number(((other.get(qty.unitLabel) || 0) + qty.boxes).toFixed(3)));
  for (const [unit, total] of other) parts.push(`${total} ${unit}`);
  return parts.join(' · ');
}

// Long codes have no spaces; a hair-space break point after each separator
// (and inside very long runs) lets them wrap inside their column.
const CODE_GAP = '\u200A';
function breakable(value) {
  return String(value || '')
    .replace(/([-\/_.,])(?=\S)/g, `$1${CODE_GAP}`)
    .replace(/([^\s\u200A]{10})(?=[^\s\u200A])/g, `$1${CODE_GAP}`);
}
// Pass as hyphenationCallback: the hair spaces become plain break points, so a
// code wraps without the extra hyphen the PDF would otherwise add.
function codeBreaks(word) {
  return word.split(/(\u200A)/).filter(Boolean);
}

const s = StyleSheet.create({
  page: { padding: 34, fontFamily: 'Helvetica', color: '#202020', backgroundColor: '#ffffff' },
  rule: { height: 4, backgroundColor: '#9f2924', marginBottom: 18 },
  header: { flexDirection: 'row', justifyContent: 'space-between' },
  identity: { flexDirection: 'row', gap: 12, maxWidth: 350 },
  logo: { width: 50, height: 50, objectFit: 'contain' },
  logoFallback: { width: 50, height: 50, backgroundColor: '#171717', color: '#ffffff', alignItems: 'center', justifyContent: 'center', fontWeight: 800 },
  company: { fontSize: 20, fontWeight: 900 }, small: { marginTop: 3, fontSize: 8, lineHeight: 1.35, color: '#626262' },
  title: { fontSize: 23, fontWeight: 900, textAlign: 'right' }, reference: { marginTop: 4, color: '#9f2924', fontSize: 10, fontWeight: 900, textAlign: 'right' },
  status: { marginTop: 8, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: '#f7eee9', color: '#8a2622', fontSize: 7, fontWeight: 900, textTransform: 'uppercase', textAlign: 'center' },
  panels: { flexDirection: 'row', gap: 12, marginTop: 22 }, panel: { flex: 1, minHeight: 88, borderWidth: 1, borderColor: '#dedede', padding: 12 },
  label: { fontSize: 7, fontWeight: 900, letterSpacing: 1.2, textTransform: 'uppercase', color: '#9f2924' }, value: { marginTop: 5, fontSize: 11, fontWeight: 900 },
  metaGrid: { marginTop: 14, flexDirection: 'row', flexWrap: 'wrap', borderWidth: 1, borderColor: '#dedede' }, metaCell: { width: '50%', minHeight: 45, padding: 10, borderBottomWidth: 1, borderRightWidth: 1, borderColor: '#eeeeee' },
  table: { marginTop: 18, borderWidth: 1, borderColor: '#dedede' }, tr: { flexDirection: 'row', minHeight: 34, paddingHorizontal: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#eeeeee' }, th: { backgroundColor: '#202020', color: '#ffffff' },
  c1: { width: '8%', fontSize: 7 }, c2: { width: '20%', fontSize: 7, paddingRight: 8 }, c3: { width: '46%', fontSize: 7, paddingRight: 8 }, c4: { width: '12%', fontSize: 7, textAlign: 'right' }, c5: { width: '14%', fontSize: 7, textAlign: 'right' },
  qtyMain: { fontSize: 8, fontWeight: 900, textAlign: 'right' }, qtySub: { marginTop: 2, fontSize: 6, color: '#777777', textAlign: 'right' }, totalRow: { backgroundColor: '#f6f6f6' }, totalText: { fontSize: 8, fontWeight: 900 },
  remarks: { marginTop: 16, minHeight: 52, borderWidth: 1, borderColor: '#dedede', padding: 11 },
  signatures: { marginTop: 48, flexDirection: 'row', justifyContent: 'space-between' }, sign: { width: '42%', borderTopWidth: 1, borderTopColor: '#777777', paddingTop: 7, fontSize: 8, color: '#666666' },
  footer: { position: 'absolute', left: 34, right: 34, bottom: 20, borderTopWidth: 1, borderTopColor: '#dedede', paddingTop: 7, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7, color: '#777777' },
});
// Challans made before the transport form carry stand-in values; print them as not entered.
const PLACEHOLDER = { vehicleNumber: 'PENDING', driverName: 'Dispatch desk', transporterName: 'Store vehicle', contactPhone: '0000000000' };
function transportValue(challan, field) {
  const value = String(challan[field] || '').trim();
  if (challan.transportMode === 'self_pickup') {
    if (field === 'transporterName') return 'Customer pickup';
    if (field === 'vehicleNumber') return '-';
  }
  // Each stand-in value reads "Not entered" on its own (some old challans carry only one of them).
  const legacyPlaceholder = !challan.transportMode && Object.keys(PLACEHOLDER).some((key) => challan[key] === PLACEHOLDER[key]);
  if (!value || (legacyPlaceholder && value === PLACEHOLDER[field])) return 'Not entered';
  return value;
}
function date(value) { const d = value ? new Date(value) : new Date(); return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString('en-IN'); }
function absolute(raw, base) { if (!raw) return null; try { return new URL(String(raw), base).href; } catch { return null; } }
async function embeddedImage(raw, requestUrl, apiUrl) {
  const url = absolute(raw, requestUrl); if (!url || url.startsWith('data:')) return url;
  const parsed = new URL(url); const candidates = [];
  if (parsed.pathname.startsWith('/catalogue-images/')) candidates.push(`${new URL(apiUrl).origin}${parsed.pathname}${parsed.search}`);
  else if (/^\/(?:brand|catalogue-art)\//.test(parsed.pathname)) candidates.push(`http://127.0.0.1:${process.env.PORT || 3000}${parsed.pathname}${parsed.search}`);
  candidates.push(url);
  for (const candidate of candidates) { try { const response = await fetch(candidate); if (!response.ok) continue; const bytes = Buffer.from(await response.arrayBuffer()); if (!bytes.length) continue; const mime = response.headers.get('content-type')?.split(';')[0] || (parsed.pathname.endsWith('.png') ? 'image/png' : 'image/jpeg'); return `data:${mime};base64,${bytes.toString('base64')}`; } catch {} }
  return null;
}
function token() { const value = String(process.env.PDF_SESSION_TOKEN || '').trim(); if (!value) throw new Error('Login required'); return value; }
async function fetchData(id, apiUrl) { const auth = token(); const response = await fetch(apiUrl, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${auth}` }, body: JSON.stringify({ query: 'query($id: ID!) { dispatchChallan(id: $id) documentSettings { data } }', variables: { id } }) }); const payload = await response.json(); if (!response.ok || payload.errors?.length || !payload.data?.dispatchChallan) throw new Error(payload.errors?.[0]?.message || 'Dispatch slip not found'); return { challan: payload.data.dispatchChallan, settings: payload.data.documentSettings?.data || {} }; }
function build({ challan, settings }, requestUrl) {
  const e = React.createElement; const lines = Array.isArray(challan.lines) ? challan.lines : []; const quantities = lines.map(lineQuantity); const logo = absolute(settings.logoUrl, requestUrl);
  return e(Document, null, e(Page, { size: 'A4', style: s.page },
    e(View, { style: s.rule }), e(View, { style: s.header },
      e(View, { style: s.identity }, logo ? e(Image, { src: logo, style: s.logo }) : e(View, { style: s.logoFallback }, e(Text, null, 'MP')), e(View, null, e(Text, { style: s.company }, settings.companyName || 'Marble Park'), e(Text, { style: s.small }, settings.companyAddress || ''), settings.gstNumber ? e(Text, { style: s.small }, `GSTIN ${settings.gstNumber}`) : null)),
      e(View, null, e(Text, { style: s.title }, 'DISPATCH SLIP'), e(Text, { style: s.reference }, challan.challanNumber), e(Text, { style: s.status }, challan.status || 'pending')),
    ),
    e(View, { style: s.panels }, e(View, { style: s.panel }, e(Text, { style: s.label }, 'Dispatch to'), e(Text, { style: s.value }, challan.customer?.name || 'Customer'), e(Text, { style: s.small }, challan.siteAddress || challan.customer?.siteAddress || ''), e(Text, { style: s.small }, challan.customer?.mobile || challan.customer?.phone || '')), e(View, { style: s.panel }, e(Text, { style: s.label }, 'References'), e(Text, { style: s.value }, challan.salesOrder?.orderNumber || challan.quote?.quoteNumber || '-'), e(Text, { style: s.small }, `Prepared: ${date(challan.createdAt)}`), challan.dispatchedAt ? e(Text, { style: s.small }, `Dispatched: ${date(challan.dispatchedAt)}`) : null)),
    e(View, { style: s.metaGrid }, e(View, { style: s.metaCell }, e(Text, { style: s.label }, 'Transporter'), e(Text, { style: s.value }, transportValue(challan, 'transporterName'))), e(View, { style: s.metaCell }, e(Text, { style: s.label }, 'Vehicle'), e(Text, { style: s.value }, transportValue(challan, 'vehicleNumber'))), e(View, { style: s.metaCell }, e(Text, { style: s.label }, challan.transportMode === 'self_pickup' ? 'Collected by' : 'Driver'), e(Text, { style: s.value }, transportValue(challan, 'driverName'))), e(View, { style: s.metaCell }, e(Text, { style: s.label }, 'Contact'), e(Text, { style: s.value }, transportValue(challan, 'contactPhone')))),
    e(View, { style: s.table }, e(View, { style: [s.tr, s.th] }, e(Text, { style: s.c1 }, '#'), e(Text, { style: s.c2 }, 'SKU / CODE'), e(Text, { style: s.c3 }, 'ITEM'), e(Text, { style: s.c4 }, 'QTY'), e(Text, { style: s.c5 }, 'UNIT')), ...lines.map((line, index) => { const qty = quantities[index]; return e(View, { key: line.pickLineId || index, style: s.tr, wrap: false }, e(Text, { style: s.c1 }, String(index + 1)), e(Text, { style: s.c2, hyphenationCallback: codeBreaks }, breakable(line.sku || '')), e(Text, { style: s.c3 }, [line.name, line.brand, line.finish].filter(Boolean).join(' · ')), e(View, { style: s.c4 }, e(Text, { style: s.qtyMain }, qtyText(qty)), qty.isBoxed ? e(Text, { style: s.qtySub }, `${qty.piecesLabel} · ${qty.piecesPerBox} pc/box`) : null), e(Text, { style: s.c5 }, qty.isBoxed ? qty.unitLabel : (line.unit || 'PC'))); }),
      lines.length ? e(View, { style: [s.tr, s.totalRow], wrap: false }, e(Text, { style: s.c1 }, ''), e(Text, { style: s.c2 }, ''), e(Text, { style: [s.c3, s.totalText] }, `Total (${lines.length} item${lines.length === 1 ? '' : 's'})`), e(Text, { style: [s.c4, s.totalText, { width: '26%' }] }, totalsText(quantities))) : null),
    e(View, { style: s.remarks }, e(Text, { style: s.label }, 'Remarks'), e(Text, { style: s.small }, challan.remarks || 'Goods dispatched in the quantities listed above.')), e(View, { style: s.signatures }, e(Text, { style: s.sign }, 'Warehouse authorised signatory'), e(Text, { style: s.sign }, 'Customer acknowledgement')), e(View, { style: s.footer }, e(Text, null, settings.supportPhone || settings.supportEmail || ''), e(Text, { render: ({ pageNumber, totalPages }) => `${pageNumber}/${totalPages}` })),
  ));
}
async function main() { const [, , id, requestUrl, apiUrl] = process.argv; if (!id || !requestUrl || !apiUrl) throw new Error('Usage: render-dispatch-slip-pdf.cjs <id> <requestUrl> <apiUrl>'); const data = await fetchData(id, apiUrl); data.settings.logoUrl = await embeddedImage(data.settings.logoUrl || '/brand/marble-park-logo.png', requestUrl, apiUrl); const buffer = await renderToBuffer(build(data, requestUrl)); process.stderr.write(`\nMP_DOCUMENT_NUMBER=${JSON.stringify(String(data.challan?.challanNumber || ''))}\n`); // names the downloaded file
  process.stdout.write(buffer); }
main().catch((error) => { console.error(error?.stack || error); process.exit(1); });
