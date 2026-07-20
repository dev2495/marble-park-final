/* eslint-disable */
const React = require('react');
const { Document, Page, Text, View, StyleSheet, Image, renderToBuffer } = require('@react-pdf/renderer');

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
  c1: { width: '8%', fontSize: 7 }, c2: { width: '20%', fontSize: 7 }, c3: { width: '46%', fontSize: 7 }, c4: { width: '12%', fontSize: 7, textAlign: 'right' }, c5: { width: '14%', fontSize: 7, textAlign: 'right' },
  remarks: { marginTop: 16, minHeight: 52, borderWidth: 1, borderColor: '#dedede', padding: 11 },
  signatures: { marginTop: 48, flexDirection: 'row', justifyContent: 'space-between' }, sign: { width: '42%', borderTopWidth: 1, borderTopColor: '#777777', paddingTop: 7, fontSize: 8, color: '#666666' },
  footer: { position: 'absolute', left: 34, right: 34, bottom: 20, borderTopWidth: 1, borderTopColor: '#dedede', paddingTop: 7, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7, color: '#777777' },
});
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
async function token(apiUrl) { const response = await fetch(apiUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'mutation($input: LoginInput!) { login(input: $input) { token } }', variables: { input: { email: process.env.QUOTE_PDF_EMAIL || process.env.PDF_SERVICE_EMAIL || 'admin@marblepark.com', password: process.env.QUOTE_PDF_PASSWORD || process.env.PDF_SERVICE_PASSWORD || 'password123' } } }) }); const payload = await response.json(); if (!payload.data?.login?.token) throw new Error(payload.errors?.[0]?.message || 'PDF service login failed'); return payload.data.login.token; }
async function fetchData(id, apiUrl) { const auth = await token(apiUrl); const response = await fetch(apiUrl, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${auth}` }, body: JSON.stringify({ query: 'query($id: ID!) { dispatchChallan(id: $id) documentSettings { data } }', variables: { id } }) }); const payload = await response.json(); if (!response.ok || payload.errors?.length || !payload.data?.dispatchChallan) throw new Error(payload.errors?.[0]?.message || 'Dispatch slip not found'); return { challan: payload.data.dispatchChallan, settings: payload.data.documentSettings?.data || {} }; }
function build({ challan, settings }, requestUrl) {
  const e = React.createElement; const lines = Array.isArray(challan.lines) ? challan.lines : []; const logo = absolute(settings.logoUrl, requestUrl);
  return e(Document, null, e(Page, { size: 'A4', style: s.page },
    e(View, { style: s.rule }), e(View, { style: s.header },
      e(View, { style: s.identity }, logo ? e(Image, { src: logo, style: s.logo }) : e(View, { style: s.logoFallback }, e(Text, null, 'MP')), e(View, null, e(Text, { style: s.company }, settings.companyName || 'Marble Park'), e(Text, { style: s.small }, settings.companyAddress || ''), settings.gstNumber ? e(Text, { style: s.small }, `GSTIN ${settings.gstNumber}`) : null)),
      e(View, null, e(Text, { style: s.title }, 'DISPATCH SLIP'), e(Text, { style: s.reference }, challan.challanNumber), e(Text, { style: s.status }, challan.status || 'pending')),
    ),
    e(View, { style: s.panels }, e(View, { style: s.panel }, e(Text, { style: s.label }, 'Dispatch to'), e(Text, { style: s.value }, challan.customer?.name || 'Customer'), e(Text, { style: s.small }, challan.siteAddress || challan.customer?.siteAddress || ''), e(Text, { style: s.small }, challan.customer?.mobile || challan.customer?.phone || '')), e(View, { style: s.panel }, e(Text, { style: s.label }, 'References'), e(Text, { style: s.value }, challan.salesOrder?.orderNumber || challan.quote?.quoteNumber || '-'), e(Text, { style: s.small }, `Prepared: ${date(challan.createdAt)}`), challan.dispatchedAt ? e(Text, { style: s.small }, `Dispatched: ${date(challan.dispatchedAt)}`) : null)),
    e(View, { style: s.metaGrid }, e(View, { style: s.metaCell }, e(Text, { style: s.label }, 'Transporter'), e(Text, { style: s.value }, challan.transporterName || '-')), e(View, { style: s.metaCell }, e(Text, { style: s.label }, 'Vehicle'), e(Text, { style: s.value }, challan.vehicleNumber || '-')), e(View, { style: s.metaCell }, e(Text, { style: s.label }, 'Driver'), e(Text, { style: s.value }, challan.driverName || '-')), e(View, { style: s.metaCell }, e(Text, { style: s.label }, 'Contact'), e(Text, { style: s.value }, challan.contactPhone || '-'))),
    e(View, { style: s.table }, e(View, { style: [s.tr, s.th] }, e(Text, { style: s.c1 }, '#'), e(Text, { style: s.c2 }, 'SKU / CODE'), e(Text, { style: s.c3 }, 'ITEM'), e(Text, { style: s.c4 }, 'QTY'), e(Text, { style: s.c5 }, 'UNIT')), ...lines.map((line, index) => e(View, { key: line.pickLineId || index, style: s.tr, wrap: false }, e(Text, { style: s.c1 }, String(index + 1)), e(Text, { style: s.c2 }, line.sku || ''), e(Text, { style: s.c3 }, [line.name, line.brand, line.finish].filter(Boolean).join(' · ')), e(Text, { style: s.c4 }, String(line.dispatchQty || 0)), e(Text, { style: s.c5 }, line.unit || 'PC')))),
    e(View, { style: s.remarks }, e(Text, { style: s.label }, 'Remarks'), e(Text, { style: s.small }, challan.remarks || 'Goods dispatched in the quantities listed above.')), e(View, { style: s.signatures }, e(Text, { style: s.sign }, 'Warehouse authorised signatory'), e(Text, { style: s.sign }, 'Customer acknowledgement')), e(View, { style: s.footer }, e(Text, null, settings.supportPhone || settings.supportEmail || ''), e(Text, { render: ({ pageNumber, totalPages }) => `${pageNumber}/${totalPages}` })),
  ));
}
async function main() { const [, , id, requestUrl, apiUrl] = process.argv; if (!id || !requestUrl || !apiUrl) throw new Error('Usage: render-dispatch-slip-pdf.cjs <id> <requestUrl> <apiUrl>'); const data = await fetchData(id, apiUrl); data.settings.logoUrl = await embeddedImage(data.settings.logoUrl || '/brand/marble-park-logo.jpg', requestUrl, apiUrl); process.stdout.write(await renderToBuffer(build(data, requestUrl))); }
main().catch((error) => { console.error(error?.stack || error); process.exit(1); });
