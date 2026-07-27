/* eslint-disable */
const React = require('react');
const { Document, Page, Text, View, StyleSheet, Image, renderToBuffer } = require('@react-pdf/renderer');

const colors = {
  ink: '#171412',
  paper: '#fffaf2',
  card: '#ffffff',
  line: '#eadbc8',
  muted: '#746454',
  tan: '#b88352',
  green: '#1f6b55',
  blue: '#2858d9',
  red: '#b94040',
};

const styles = StyleSheet.create({
  page: { padding: 28, backgroundColor: colors.paper, color: colors.ink, fontFamily: 'Helvetica' },
  rule: { height: 4, borderRadius: 99, backgroundColor: colors.ink, marginBottom: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  brandRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  logo: { width: 52, height: 52, objectFit: 'contain' },
  logoFallback: { width: 42, height: 42, borderRadius: 13, backgroundColor: colors.ink, color: colors.paper, alignItems: 'center', justifyContent: 'center' },
  logoText: { fontSize: 15, fontWeight: 900 },
  brand: { fontSize: 23, fontWeight: 900, letterSpacing: 1.2 },
  subBrand: { marginTop: 3, fontSize: 7, letterSpacing: 3.2, color: colors.tan, textTransform: 'uppercase' },
  title: { fontSize: 24, fontWeight: 900, letterSpacing: 1, textAlign: 'right' },
  small: { fontSize: 8, color: colors.muted, lineHeight: 1.35 },
  panelGrid: { flexDirection: 'row', gap: 12, marginBottom: 14 },
  panel: { flex: 1, minHeight: 78, padding: 11, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card },
  label: { fontSize: 7, fontWeight: 900, letterSpacing: 1.4, color: colors.tan, textTransform: 'uppercase' },
  value: { marginTop: 4, fontSize: 11.5, fontWeight: 900, color: colors.ink },
  badgeRow: { flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' },
  badge: { paddingHorizontal: 7, paddingVertical: 4, borderRadius: 999, backgroundColor: '#f7eadb', color: colors.tan, fontSize: 7, fontWeight: 900, textTransform: 'uppercase' },
  sectionTitle: { marginTop: 10, marginBottom: 7, fontSize: 10, fontWeight: 900, letterSpacing: 1.4, color: colors.ink, textTransform: 'uppercase' },
  table: { borderWidth: 1, borderColor: colors.line, borderRadius: 14, overflow: 'hidden', backgroundColor: colors.card },
  tableHeader: { flexDirection: 'row', backgroundColor: '#eadbc8', paddingVertical: 7, paddingHorizontal: 7 },
  row: { flexDirection: 'row', minHeight: 68, paddingVertical: 7, paddingHorizontal: 7, borderBottomWidth: 1, borderBottomColor: '#f1e4d5' },
  th: { fontSize: 6.6, fontWeight: 900, letterSpacing: 0.8, color: colors.muted, textTransform: 'uppercase' },
  td: { fontSize: 8.2, color: colors.ink, lineHeight: 1.25 },
  imageCol: { width: '12%' },
  descCol: { width: '31%', paddingRight: 5 },
  qtyCol: { width: '8%', textAlign: 'center' },
  moneyCol: { width: '12%', textAlign: 'right' },
  statusCol: { width: '13%', textAlign: 'center' },
  image: { width: 48, height: 48, objectFit: 'contain', borderRadius: 8, backgroundColor: '#f7eadb' },
  sku: { marginTop: 3, fontSize: 6.8, color: colors.tan, letterSpacing: 0.7 },
  meta: { marginTop: 2, fontSize: 7, color: colors.muted },
  statusReady: { color: colors.green, fontWeight: 900 },
  statusBackorder: { color: colors.red, fontWeight: 900 },
  totalsWrap: { marginTop: 14, flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  notes: { flex: 1, minHeight: 90, padding: 11, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card },
  totals: { width: 210, padding: 11, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 7 },
  totalLabel: { fontSize: 8.2, color: colors.muted, fontWeight: 700 },
  totalValue: { fontSize: 8.4, color: colors.ink, fontWeight: 900 },
  grand: { borderTopWidth: 2, borderTopColor: colors.ink, paddingTop: 8, marginTop: 3 },
  grandText: { fontSize: 14, fontWeight: 900 },
  footer: { position: 'absolute', bottom: 18, left: 28, right: 28, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 7, flexDirection: 'row', justifyContent: 'space-between', color: colors.tan, fontSize: 7.2 },
});

function money(value) {
  return `INR ${Math.round(Number(value || 0)).toLocaleString('en-IN')}`;
}

function fmtDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function safeJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return value;
}

function buildAbsoluteUrl(raw, requestUrl) {
  if (!raw) return null;
  const str = String(raw);
  if (str.startsWith('http://') || str.startsWith('https://') || str.startsWith('data:')) return str;
  try { return new URL(str, requestUrl).href; } catch { return null; }
}

function mediaUrl(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(mediaUrl).find(Boolean) || null;
  if (typeof value === 'object') {
    return value.url || value.src || value.primaryUrl || value.primaryImage || value.primary || mediaUrl(value.gallery);
  }
  return null;
}

function imageSrc(line, product, requestUrl) {
  const lineMedia = safeJson(line.media, {});
  const productMedia = safeJson(product?.media, {});
  const snapshot = safeJson(line.metadata, {})?.snapshot || {};
  const raw =
    line.quoteImage ||
    line.customImageUrl ||
    snapshot.quoteImage ||
    snapshot.customImageUrl ||
    mediaUrl(lineMedia) ||
    mediaUrl(snapshot.media) ||
    mediaUrl(productMedia);
  return buildAbsoluteUrl(raw, requestUrl);
}

async function embeddedImage(raw, requestUrl, apiUrl) {
  const url = buildAbsoluteUrl(raw, requestUrl);
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
      const mime = response.headers.get('content-type')?.split(';')[0] || 'image/png';
      return `data:${mime};base64,${bytes.toString('base64')}`;
    } catch {}
  }
  return null;
}

function normalizeLines(lines) {
  const parsed = safeJson(lines, []);
  return Array.isArray(parsed) ? parsed : [];
}

function qtyOf(line) {
  return Number(line.qty || line.quantity || 0);
}

function rateOf(line) {
  const price = Number(line.price || line.sellPrice || 0);
  const discount = Number(line.discountPercent || line.discount || 0);
  const special = Number(line.specialRate || line.specialPrice || 0);
  return special > 0 ? special : price * (1 - discount / 100);
}

function groupByArea(lines) {
  const groups = new Map();
  for (const line of lines) {
    const area = String(line.area || line.room || line.section || 'General Selection').trim() || 'General Selection';
    if (!groups.has(area)) groups.set(area, []);
    groups.get(area).push({ ...line, area });
  }
  return Array.from(groups.entries()).map(([area, rows]) => ({ area, rows }));
}

function aggregateChallanQty(challans) {
  const byProduct = new Map();
  for (const challan of challans || []) {
    for (const line of normalizeLines(challan.lines)) {
      const key = line.productId || line.sku || line.name;
      if (!key) continue;
      byProduct.set(key, (byProduct.get(key) || 0) + qtyOf(line));
    }
  }
  return byProduct;
}

async function graphqlRequest(apiUrl, query, variables, token) {
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json();
  if (!response.ok || payload.errors?.length) {
    throw new Error(payload.errors?.[0]?.message || `GraphQL request failed (${response.status})`);
  }
  return payload.data;
}

function requiredSessionToken() {
  const token = String(process.env.PDF_SESSION_TOKEN || '').trim();
  if (!token) throw new Error('Login required');
  return token;
}

async function fetchOrder(id, apiUrl) {
  const token = requiredSessionToken();
  const data = await graphqlRequest(
    apiUrl,
    `query SalesOrderPdfData($id: ID!) {
      salesOrder(id: $id)
      documentSettings { data }
    }`,
    { id },
    token,
  );
  const order = data?.salesOrder;
  if (!order) throw new Error('Sales order not found');

  let quote = null;
  try {
    const quoteData = await graphqlRequest(
      apiUrl,
      `query QuoteForSalesOrderPdf($id: ID!) {
        quote(id: $id) {
          id
          quoteNumber
          notes
          lines
          quoteMeta
          displayMode
        }
      }`,
      { id: order.quoteId },
      token,
    );
    quote = quoteData?.quote || null;
  } catch {
    quote = null;
  }

  return {
    order,
    quote,
    customer: order.customer || null,
    owner: order.owner || null,
    settings: data.documentSettings?.data || null,
    products: [],
    reservations: normalizeLines(order.lines).map((line) => ({
      productId: line.productId,
      status: line.inventoryStatus || line.reservationStatus || line.stockStatus || 'reserved',
    })),
    challans: [],
  };
}

function buildDocument(payload, requestUrl) {
  const e = React.createElement;
  const { order, quote, customer, owner, settings, products, reservations, challans, logoData } = payload;
  const productMap = new Map((products || []).map((product) => [product.id, product]));
  const reservationMap = new Map((reservations || []).map((reservation) => [reservation.productId, reservation]));
  const dispatchedMap = aggregateChallanQty(challans);
  const lines = normalizeLines(order.lines);
  const groups = groupByArea(lines);
  const subtotal = lines.reduce((sum, line) => sum + qtyOf(line) * rateOf(line), 0);
  const advance = Number(order.advanceAmount || 0);
  const balance = Math.max(0, Number(order.totalAmount || subtotal) - advance);
  const companyName = settings?.companyName || 'Marble Park';
  const support = [settings?.supportPhone, settings?.supportEmail].filter(Boolean).join(' | ');

  const row = (line) => {
    const product = productMap.get(line.productId);
    const key = line.productId || line.sku || line.name;
    const qty = qtyOf(line);
    const dispatched = dispatchedMap.get(key) || 0;
    const remaining = Math.max(0, qty - dispatched);
    const reservation = line.productId ? reservationMap.get(line.productId) : null;
    const ready = !line.productId || reservation?.status === 'reserved';
    const src = imageSrc(line, product, requestUrl);
    return e(View, { key: `${key}-${line.name}-${Math.random()}`, style: styles.row },
      e(View, { style: styles.imageCol }, src ? e(Image, { src, style: styles.image }) : e(Text, { style: styles.small }, 'No image')),
      e(View, { style: styles.descCol },
        e(Text, { style: { ...styles.td, fontWeight: 900 } }, line.name || product?.name || 'Item'),
        e(Text, { style: styles.sku }, line.sku || product?.sku || ''),
        e(Text, { style: styles.meta }, [line.finish || product?.finish, line.dimensions || product?.dimensions, line.unit || product?.unit].filter(Boolean).join(' | ')),
      ),
      e(Text, { style: [styles.td, styles.qtyCol] }, String(qty)),
      e(Text, { style: [styles.td, styles.moneyCol] }, money(rateOf(line))),
      e(Text, { style: [styles.td, styles.moneyCol] }, money(qty * rateOf(line))),
      e(Text, { style: [styles.td, styles.statusCol, ready ? styles.statusReady : styles.statusBackorder] }, ready ? 'Reserved' : 'Pending'),
      e(Text, { style: [styles.td, styles.qtyCol] }, String(dispatched)),
      e(Text, { style: [styles.td, styles.qtyCol] }, String(remaining)),
    );
  };

  return e(Document, null,
    e(Page, { size: 'A4', style: styles.page },
      e(View, { style: styles.rule }),
      e(View, { style: styles.header },
        e(View, { style: styles.brandRow },
          logoData
            ? e(Image, { src: logoData, style: styles.logo })
            : e(View, { style: styles.logoFallback }, e(Text, { style: styles.logoText }, 'MP')),
          e(View, null, e(Text, { style: styles.brand }, companyName), e(Text, { style: styles.subBrand }, 'Retail operations')),
        ),
        e(View, null,
          e(Text, { style: styles.title }, 'SALES ORDER'),
          e(Text, { style: styles.small }, `Date: ${fmtDate(order.createdAt)}`),
        ),
      ),
      e(View, { style: styles.panelGrid },
        e(View, { style: styles.panel },
          e(Text, { style: styles.label }, 'Order to'),
          e(Text, { style: styles.value }, customer?.name || 'Customer'),
          e(Text, { style: styles.small }, customer?.siteAddress || customer?.address || ''),
          e(Text, { style: styles.small }, [customer?.city, customer?.state].filter(Boolean).join(', ')),
        ),
        e(View, { style: styles.panel },
          e(Text, { style: styles.label }, 'Reference'),
          e(Text, { style: styles.value }, order.orderNumber),
          e(Text, { style: styles.small }, `Quote: ${quote?.quoteNumber || order.quoteId}`),
          e(Text, { style: styles.small }, `Sales: ${owner?.name || 'Sales user'}`),
          e(View, { style: styles.badgeRow },
            e(Text, { style: styles.badge }, String(order.paymentMode || '').toUpperCase()),
            e(Text, { style: styles.badge }, String(order.paymentStatus || '').toUpperCase()),
          ),
        ),
      ),
      ...groups.map((group) => e(View, { key: group.area, wrap: false },
        e(Text, { style: styles.sectionTitle }, group.area),
        e(View, { style: styles.table },
          e(View, { style: styles.tableHeader },
            e(Text, { style: [styles.th, styles.imageCol] }, 'Image'),
            e(Text, { style: [styles.th, styles.descCol] }, 'Description'),
            e(Text, { style: [styles.th, styles.qtyCol] }, 'Qty'),
            e(Text, { style: [styles.th, styles.moneyCol] }, 'Rate'),
            e(Text, { style: [styles.th, styles.moneyCol] }, 'Amount'),
            e(Text, { style: [styles.th, styles.statusCol] }, 'Inventory'),
            e(Text, { style: [styles.th, styles.qtyCol] }, 'Sent'),
            e(Text, { style: [styles.th, styles.qtyCol] }, 'Bal'),
          ),
          ...group.rows.map(row),
        ),
      )),
      e(View, { style: styles.totalsWrap },
        e(View, { style: styles.notes },
          e(Text, { style: styles.label }, 'Dispatch instructions'),
          e(Text, { style: styles.small }, 'Dispatch may be split line by line. Rows marked Pending cannot be dispatched until matching inward stock is received and reserved. Use this document to mark sent and balance quantities.'),
          e(Text, { style: [styles.label, { marginTop: 10 }] }, 'Notes'),
          e(Text, { style: styles.small }, order.notes || quote?.notes || 'No special notes.'),
        ),
        e(View, { style: styles.totals },
          e(View, { style: styles.totalRow }, e(Text, { style: styles.totalLabel }, 'Subtotal'), e(Text, { style: styles.totalValue }, money(subtotal))),
          e(View, { style: styles.totalRow }, e(Text, { style: styles.totalLabel }, 'Order total'), e(Text, { style: styles.totalValue }, money(order.totalAmount || subtotal))),
          e(View, { style: styles.totalRow }, e(Text, { style: styles.totalLabel }, 'Advance'), e(Text, { style: styles.totalValue }, money(advance))),
          e(View, { style: styles.grand }, e(View, { style: styles.totalRow }, e(Text, { style: styles.grandText }, 'Balance'), e(Text, { style: styles.grandText }, money(balance)))),
        ),
      ),
      e(View, { style: styles.footer },
        e(Text, null, support || 'Thank you for choosing Marble Park.'),
        e(Text, null, `${order.orderNumber} | Quote PDF: /api/pdf/quote/${order.quoteId}`),
      ),
    ),
  );
}

async function main() {
  const [, , id, requestUrl, apiUrlArg] = process.argv;
  if (!id || !requestUrl) throw new Error('Usage: render-sales-order-pdf.cjs <orderId> <requestUrl> <apiUrl>');
  const apiUrl = apiUrlArg || process.env.QUOTE_PDF_API_URL || process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || 'http://localhost:4000/graphql';
  const payload = await fetchOrder(id, apiUrl);
  payload.logoData = await embeddedImage(payload.settings?.logoUrl || '/brand/marble-park-logo.png', requestUrl, apiUrl);
  const buffer = await renderToBuffer(buildDocument(payload, requestUrl));
  process.stdout.write(buffer);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
