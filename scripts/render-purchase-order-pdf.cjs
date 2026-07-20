/* eslint-disable */
const React = require('react');
const { Document, Page, Text, View, StyleSheet, Image, renderToBuffer } = require('@react-pdf/renderer');

const s = StyleSheet.create({
  page: { padding: 34, fontFamily: 'Helvetica', color: '#211b16', backgroundColor: '#fffdf9' },
  rule: { height: 4, backgroundColor: '#9f2924', marginBottom: 18 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  identity: { flexDirection: 'row', gap: 12, alignItems: 'center', maxWidth: 330 },
  logo: { width: 52, height: 52, objectFit: 'contain', backgroundColor: '#ffffff' },
  logoFallback: { width: 52, height: 52, backgroundColor: '#171717', color: '#ffffff', alignItems: 'center', justifyContent: 'center', fontWeight: 800 },
  company: { fontSize: 20, fontWeight: 900 },
  small: { marginTop: 3, fontSize: 8, lineHeight: 1.35, color: '#665b54' },
  title: { fontSize: 23, fontWeight: 900, textAlign: 'right' },
  reference: { marginTop: 4, fontSize: 9, fontWeight: 700, textAlign: 'right', color: '#9f2924' },
  panels: { marginTop: 22, flexDirection: 'row', gap: 12 },
  panel: { flex: 1, minHeight: 92, borderWidth: 1, borderColor: '#e2d8ce', padding: 12, backgroundColor: '#ffffff' },
  label: { fontSize: 7, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 1.2, color: '#9f2924' },
  value: { marginTop: 5, fontSize: 11, fontWeight: 900 },
  table: { marginTop: 20, borderWidth: 1, borderColor: '#e2d8ce' },
  tr: { flexDirection: 'row', minHeight: 32, borderBottomWidth: 1, borderBottomColor: '#eee7e1', paddingHorizontal: 7, paddingVertical: 7 },
  th: { backgroundColor: '#211b16', color: '#ffffff' },
  c1: { width: '8%', fontSize: 7 }, c2: { width: '18%', fontSize: 7 }, c3: { width: '34%', fontSize: 7 }, c4: { width: '10%', fontSize: 7, textAlign: 'right' }, c5: { width: '14%', fontSize: 7, textAlign: 'right' }, c6: { width: '16%', fontSize: 7, textAlign: 'right' },
  total: { marginTop: 14, marginLeft: 'auto', width: 210, flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 2, borderTopColor: '#211b16', paddingTop: 9, fontSize: 13, fontWeight: 900 },
  notes: { marginTop: 22, borderWidth: 1, borderColor: '#e2d8ce', padding: 12, minHeight: 58, backgroundColor: '#ffffff' },
  signatures: { marginTop: 44, flexDirection: 'row', justifyContent: 'space-between' },
  sign: { width: '42%', borderTopWidth: 1, borderTopColor: '#766b63', paddingTop: 7, fontSize: 8, color: '#665b54' },
  footer: { position: 'absolute', bottom: 20, left: 34, right: 34, borderTopWidth: 1, borderTopColor: '#e2d8ce', paddingTop: 7, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7, color: '#766b63' },
});

function money(value) { return `Rs. ${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function date(value) { const d = value ? new Date(value) : new Date(); return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString('en-IN'); }
function absolute(raw, requestUrl) { if (!raw) return null; try { return new URL(String(raw), requestUrl).href; } catch { return null; } }
async function embeddedImage(raw, requestUrl, apiUrl) {
  const url = absolute(raw, requestUrl);
  if (!url || url.startsWith('data:')) return url;
  const parsed = new URL(url);
  const candidates = [];
  if (parsed.pathname.startsWith('/catalogue-images/')) candidates.push(`${new URL(apiUrl).origin}${parsed.pathname}${parsed.search}`);
  else if (/^\/(?:brand|catalogue-art)\//.test(parsed.pathname)) candidates.push(`http://127.0.0.1:${process.env.PORT || 3000}${parsed.pathname}${parsed.search}`);
  candidates.push(url);
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate);
      if (!response.ok) continue;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length) continue;
      const mime = response.headers.get('content-type')?.split(';')[0] || (parsed.pathname.endsWith('.png') ? 'image/png' : 'image/jpeg');
      return `data:${mime};base64,${bytes.toString('base64')}`;
    } catch {}
  }
  return null;
}

async function token(apiUrl) {
  const response = await fetch(apiUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'mutation($input: LoginInput!) { login(input: $input) { token } }', variables: { input: { email: process.env.QUOTE_PDF_EMAIL || process.env.PDF_SERVICE_EMAIL || 'admin@marblepark.com', password: process.env.QUOTE_PDF_PASSWORD || process.env.PDF_SERVICE_PASSWORD || 'password123' } } }) });
  const payload = await response.json();
  if (!payload.data?.login?.token) throw new Error(payload.errors?.[0]?.message || 'PDF service login failed');
  return payload.data.login.token;
}

async function fetchData(id, apiUrl) {
  const auth = await token(apiUrl);
  const query = 'query($id: ID!) { purchaseOrder(id: $id) documentSettings { data } }';
  const response = await fetch(apiUrl, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${auth}` }, body: JSON.stringify({ query, variables: { id } }) });
  const payload = await response.json();
  if (!response.ok || payload.errors?.length || !payload.data?.purchaseOrder) throw new Error(payload.errors?.[0]?.message || 'Purchase order not found');
  return { order: payload.data.purchaseOrder, settings: payload.data.documentSettings?.data || {} };
}

function build({ order, settings }, requestUrl) {
  const e = React.createElement;
  const lines = Array.isArray(order.lines) ? order.lines : [];
  const subtotal = lines.reduce((sum, line) => sum + Number(line.orderedQuantity || 0) * Number(line.unitCost || 0), 0);
  const logo = absolute(settings.logoUrl, requestUrl);
  return e(Document, null, e(Page, { size: 'A4', style: s.page },
    e(View, { style: s.rule }),
    e(View, { style: s.header },
      e(View, { style: s.identity }, logo ? e(Image, { src: logo, style: s.logo }) : e(View, { style: s.logoFallback }, e(Text, null, 'MP')), e(View, null, e(Text, { style: s.company }, settings.companyName || 'Marble Park'), e(Text, { style: s.small }, settings.companyAddress || ''), settings.gstNumber ? e(Text, { style: s.small }, `GSTIN ${settings.gstNumber}`) : null)),
      e(View, null, e(Text, { style: s.title }, 'PURCHASE ORDER'), e(Text, { style: s.reference }, order.poNumber), e(Text, { style: s.small }, `Date: ${date(order.orderedAt || order.createdAt)}`)),
    ),
    e(View, { style: s.panels },
      e(View, { style: s.panel }, e(Text, { style: s.label }, 'Supplier'), e(Text, { style: s.value }, order.vendorName || 'Vendor'), e(Text, { style: s.small }, order.vendor?.address || ''), order.vendor?.gstNumber ? e(Text, { style: s.small }, `GSTIN ${order.vendor.gstNumber}`) : null),
      e(View, { style: s.panel }, e(Text, { style: s.label }, 'Delivery'), e(Text, { style: s.value }, settings.companyName || 'Marble Park'), e(Text, { style: s.small }, settings.companyAddress || ''), e(Text, { style: s.small }, `Expected: ${date(order.expectedDate)}`)),
    ),
    e(View, { style: s.table },
      e(View, { style: [s.tr, s.th] }, e(Text, { style: s.c1 }, '#'), e(Text, { style: s.c2 }, 'SKU / CODE'), e(Text, { style: s.c3 }, 'DESCRIPTION'), e(Text, { style: s.c4 }, 'QTY'), e(Text, { style: s.c5 }, 'UNIT COST'), e(Text, { style: s.c6 }, 'VALUE')),
      ...lines.map((line, index) => e(View, { key: line.id || index, style: s.tr, wrap: false }, e(Text, { style: s.c1 }, String(index + 1)), e(Text, { style: s.c2 }, line.metadata?.internalCode || line.sku || ''), e(Text, { style: s.c3 }, [line.name, line.brand, line.finish].filter(Boolean).join(' · ')), e(Text, { style: s.c4 }, `${line.orderedQuantity || 0} ${line.unit || 'PC'}`), e(Text, { style: s.c5 }, money(line.unitCost)), e(Text, { style: s.c6 }, money(Number(line.orderedQuantity || 0) * Number(line.unitCost || 0))))),
    ),
    e(View, { style: s.total }, e(Text, null, 'Order value'), e(Text, null, money(subtotal))),
    e(View, { style: s.notes }, e(Text, { style: s.label }, 'Instructions / terms'), e(Text, { style: s.small }, order.notes || 'Supply against this purchase order only. Quantity and condition are subject to GRN verification.')),
    e(View, { style: s.signatures }, e(Text, { style: s.sign }, 'Supplier acceptance'), e(Text, { style: s.sign }, `For ${settings.companyName || 'Marble Park'}`)),
    e(View, { style: s.footer }, e(Text, null, settings.supportPhone || settings.supportEmail || ''), e(Text, { render: ({ pageNumber, totalPages }) => `${pageNumber}/${totalPages}` })),
  ));
}

async function main() { const [, , id, requestUrl, apiUrl] = process.argv; if (!id || !requestUrl || !apiUrl) throw new Error('Usage: render-purchase-order-pdf.cjs <id> <requestUrl> <apiUrl>'); const data = await fetchData(id, apiUrl); data.settings.logoUrl = await embeddedImage(data.settings.logoUrl || '/brand/marble-park-logo.jpg', requestUrl, apiUrl); process.stdout.write(await renderToBuffer(build(data, requestUrl))); }
main().catch((error) => { console.error(error?.stack || error); process.exit(1); });
