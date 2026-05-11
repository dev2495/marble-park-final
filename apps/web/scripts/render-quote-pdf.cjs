/* eslint-disable */
/**
 * Quote PDF renderer.
 *
 * Two layout modes, picked from `quote.displayMode` / `quote.quoteMeta`:
 *
 *  1. SELECTION mode (matches the user's sample "Shivdhara" PDF):
 *     - Cover page with hero image + dark ribbon footer carrying client,
 *       mobile, architect, date, sales-manager.
 *     - Subsequent pages: an Area title, then a 4-up grid of cards, each
 *       carrying Utilize / Size / Design Name + product image. NO prices.
 *
 *  2. PRICED mode (default for normal commercial quotes):
 *     - Compact branded header.
 *     - Area-grouped tables with image / description / qty / MRP / discount /
 *       special / total columns and a totals box.
 *
 * The renderer is a child process invoked from the Next.js route handler
 * with `node scripts/render-quote-pdf.cjs <quoteId> <requestUrl> <apiUrl>`.
 * It writes the PDF binary to stdout.
 */
const React = require('react');
const { Document, Page, Text, View, StyleSheet, Image, renderToBuffer } = require('@react-pdf/renderer');

const colors = {
  ink: '#211b16',
  paper: '#fffaf3',
  cream: '#f7efe4',
  line: '#ead7c0',
  tan: '#8b6b4c',
  gold: '#b57942',
  green: '#24544d',
  muted: '#6d5a49',
  redAccent: '#c53d3d',
  charcoal: '#1a1715',
  cardBg: '#ffffff',
};

const styles = StyleSheet.create({
  // Shared
  page: { backgroundColor: colors.paper, padding: 28, color: colors.ink, fontFamily: 'Helvetica' },
  pagePadded: { backgroundColor: colors.paper, paddingTop: 28, paddingBottom: 70, paddingLeft: 28, paddingRight: 28, color: colors.ink, fontFamily: 'Helvetica' },
  // ---- Cover page (selection layout) ----
  coverPage: { padding: 0, backgroundColor: '#ffffff', color: colors.ink, fontFamily: 'Helvetica' },
  coverTagline: { position: 'absolute', top: 24, left: 28, right: 28, fontSize: 11, fontStyle: 'italic', fontWeight: 700, color: colors.ink },
  coverHeroBg: { position: 'absolute', top: 60, left: 0, right: 0, height: 460, backgroundColor: colors.line },
  coverHero: { position: 'absolute', top: 60, left: 0, right: 0, height: 460, objectFit: 'cover' },
  coverBrandWordmark: { position: 'absolute', top: 80, left: 28, right: 28, fontSize: 64, fontWeight: 900, letterSpacing: 4, color: '#ffffff', textAlign: 'center', textShadow: '0 2px 8px rgba(0,0,0,0.45)' },
  coverQuotationTab: { position: 'absolute', left: '20%', right: '20%', bottom: 195, backgroundColor: colors.charcoal, paddingVertical: 12, paddingHorizontal: 28, borderRadius: 0 },
  coverQuotationText: { fontSize: 26, fontWeight: 900, color: '#ffffff', textAlign: 'center', letterSpacing: 4 },
  coverRibbon: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: colors.charcoal, color: '#ffffff', paddingVertical: 22, paddingHorizontal: 36 },
  coverRibbonGrid: { flexDirection: 'row', justifyContent: 'space-between' },
  coverRibbonCol: { flexDirection: 'column', gap: 8 },
  coverRibbonLine: { fontSize: 11.5, color: '#ffffff' },
  coverRibbonStrong: { fontWeight: 800 },
  // ---- Selection cards page ----
  areaPageHeader: { fontSize: 14, fontWeight: 900, color: colors.redAccent, letterSpacing: 1.6, textTransform: 'uppercase', marginBottom: 14 },
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 18 },
  selectionCard: { width: '47%', marginBottom: 22, padding: 4 },
  cardLabelRow: { fontSize: 10.5, color: colors.ink, marginBottom: 3 },
  cardLabelKey: { fontWeight: 800, textDecoration: 'underline' },
  cardLabelValue: { color: colors.redAccent, fontWeight: 700 },
  cardLabelValueBlack: { color: colors.ink, fontWeight: 700 },
  cardImageWrap: { marginTop: 10, height: 220, backgroundColor: colors.cream, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  cardImage: { width: '100%', height: '100%', objectFit: 'cover' },
  cardImagePlaceholder: { fontSize: 9.5, color: colors.tan, textAlign: 'center' },
  // ---- Priced quote layout (kept compact) ----
  topRule: { height: 4, backgroundColor: colors.ink, borderRadius: 99, marginBottom: 14 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  logoBox: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.ink, color: colors.paper, alignItems: 'center', justifyContent: 'center' },
  logoText: { fontSize: 15, fontWeight: 800 },
  brandWrap: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  brand: { fontSize: 23, fontWeight: 900, letterSpacing: 1.6 },
  subBrand: { marginTop: 3, fontSize: 7.5, color: colors.tan, letterSpacing: 3.4, textTransform: 'uppercase' },
  quoteTitle: { fontSize: 24, fontWeight: 900, textAlign: 'right', letterSpacing: 1 },
  quoteDate: { marginTop: 3, fontSize: 8.5, color: colors.muted, textAlign: 'right' },
  panels: { flexDirection: 'row', gap: 14, marginTop: 12, marginBottom: 14 },
  panel: { flex: 1, minHeight: 78, backgroundColor: colors.cardBg, borderWidth: 1, borderColor: colors.line, borderRadius: 15, padding: 12 },
  label: { fontSize: 7.2, fontWeight: 900, color: colors.tan, letterSpacing: 1.5, textTransform: 'uppercase' },
  value: { marginTop: 4, fontSize: 12, fontWeight: 900, color: colors.ink },
  text: { marginTop: 3, fontSize: 8.8, lineHeight: 1.35, color: colors.muted },
  badgeRow: { flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' },
  badge: { borderRadius: 999, backgroundColor: colors.cream, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 8, paddingVertical: 4, fontSize: 7.2, fontWeight: 900, color: colors.tan, textTransform: 'uppercase', letterSpacing: 1.1 },
  areaBlock: { marginTop: 10, borderWidth: 1, borderColor: colors.line, borderRadius: 16, backgroundColor: colors.cardBg, overflow: 'hidden' },
  areaHeader: { backgroundColor: colors.ink, color: colors.paper, paddingHorizontal: 12, paddingVertical: 9, flexDirection: 'row', justifyContent: 'space-between' },
  areaTitle: { fontSize: 10, fontWeight: 900, letterSpacing: 1.5, textTransform: 'uppercase' },
  areaCount: { fontSize: 8, color: '#e8c39b' },
  tableHeader: { flexDirection: 'row', backgroundColor: colors.line, paddingVertical: 7, paddingHorizontal: 8 },
  tableRow: { flexDirection: 'row', minHeight: 72, paddingVertical: 7, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: '#f1e3d2' },
  th: { fontSize: 6.8, fontWeight: 900, color: colors.muted, textTransform: 'uppercase', letterSpacing: 1.05 },
  td: { fontSize: 8.6, color: colors.ink, lineHeight: 1.25 },
  imageCol: { width: '13%' },
  image: { width: 52, height: 52, objectFit: 'contain', borderRadius: 8, backgroundColor: colors.cream },
  descCol: { width: '33%', paddingRight: 6 },
  qtyCol: { width: '10%', textAlign: 'center' },
  rateCol: { width: '13%', textAlign: 'right' },
  discountCol: { width: '10%', textAlign: 'right' },
  specialCol: { width: '11%', textAlign: 'right' },
  amountCol: { width: '10%', textAlign: 'right' },
  sku: { marginTop: 4, fontSize: 7.2, color: colors.tan, letterSpacing: 0.8 },
  meta: { marginTop: 3, fontSize: 7.6, color: colors.muted },
  totalsWrap: { marginTop: 14, flexDirection: 'row', gap: 16, alignItems: 'flex-start' },
  notesBox: { flex: 1, minHeight: 92, backgroundColor: colors.cardBg, borderWidth: 1, borderColor: colors.line, borderRadius: 15, padding: 12 },
  totalsBox: { width: 210, backgroundColor: colors.cardBg, borderWidth: 1, borderColor: colors.line, borderRadius: 15, padding: 12 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 7 },
  totalLabel: { fontSize: 8.6, color: colors.muted, fontWeight: 700 },
  totalValue: { fontSize: 8.8, color: colors.ink, fontWeight: 900 },
  grand: { borderTopWidth: 2, borderTopColor: colors.ink, paddingTop: 8, marginTop: 3 },
  grandText: { fontSize: 14, fontWeight: 900, color: colors.ink },
  bottomGrid: { marginTop: 14, flexDirection: 'row', gap: 14 },
  halfBox: { flex: 1, backgroundColor: colors.cardBg, borderWidth: 1, borderColor: colors.line, borderRadius: 15, padding: 12, minHeight: 82 },
  footer: { position: 'absolute', bottom: 18, left: 28, right: 28, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 7, flexDirection: 'row', justifyContent: 'space-between', color: colors.tan, fontSize: 7.4 },
  pageNumber: { color: colors.tan, fontSize: 7.4 },
  // ---- Closing thank-you page ----
  closingPage: { padding: 0, backgroundColor: colors.charcoal, color: '#ffffff', fontFamily: 'Helvetica' },
  closingInner: { padding: 64, alignItems: 'flex-start', justifyContent: 'center', flex: 1 },
  closingHeading: { fontSize: 36, fontWeight: 900, marginBottom: 22, letterSpacing: 1, lineHeight: 1.05 },
  closingText: { fontSize: 11, lineHeight: 1.55, marginBottom: 18, color: '#dcd0c0' },
  closingTermsTitle: { fontSize: 12, fontWeight: 800, marginTop: 22, marginBottom: 8, color: '#ffffff', letterSpacing: 1.4, textTransform: 'uppercase' },
});

function money(value) {
  return `Rs. ${Math.round(Number(value || 0)).toLocaleString('en-IN')}`;
}
function fmtDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}
function safeJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return value;
}
function asArray(value) { return Array.isArray(value) ? value : []; }

function buildAbsoluteUrl(raw, requestUrl) {
  if (!raw) return null;
  const str = String(raw);
  if (str.startsWith('http://') || str.startsWith('https://') || str.startsWith('data:')) return str;
  try {
    return new URL(str, requestUrl).href;
  } catch {
    return null;
  }
}

function imageSrc(line, requestUrl) {
  const media = safeJson(line.media, {});
  const raw = line.quoteImage || line.customImageUrl || media.primary || (Array.isArray(media.gallery) ? media.gallery[0] : null);
  return buildAbsoluteUrl(raw, requestUrl);
}

function rateFor(line) {
  const qty = Number(line.qty || line.quantity || 0);
  const price = Number(line.price || line.sellPrice || 0);
  const discount = Number(line.discountPercent || line.discount || 0);
  const specialRate = Number(line.specialRate || line.specialPrice || 0);
  const unitRate = specialRate > 0 ? specialRate : price * (1 - discount / 100);
  return { qty, price, discount, unitRate, amount: qty * unitRate };
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

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function fetchQuote(id, apiUrl) {
  // Try Prisma first (fastest, fewer hops in production).
  try {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    try {
      const [quote, settings, brands] = await Promise.all([
        prisma.quote.findUnique({
          where: { id },
          include: {
            customer: true,
            owner: { select: { id: true, name: true, email: true, role: true, phone: true } },
            lead: true,
          },
        }),
        prisma.appSetting.findFirst({ orderBy: { updatedAt: 'desc' } }),
        prisma.productBrand.findMany({ where: { status: 'active' }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], take: 80 }),
      ]);
      if (quote) return { quote, settings, brands };
    } finally {
      await prisma.$disconnect();
    }
  } catch {
    // Fall back to GraphQL when Prisma isn't reachable from this process.
  }

  const query = `query QuoteForPdf($id: ID!) {
    quote(id: $id) {
      id quoteNumber title projectName validUntil createdAt
      lines quoteMeta displayMode discountPercent notes
      customer owner lead approval
    }
  }`;
  const fetchViaGraphql = async (token) => {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ query, variables: { id } }),
    });
    const payload = await response.json();
    return { response, payload };
  };

  let { response, payload } = await fetchViaGraphql();
  if (payload.errors?.some((error) => /login required|auth|unauthorized/i.test(error.message || ''))) {
    const token = await getPdfServiceToken(apiUrl);
    ({ response, payload } = await fetchViaGraphql(token));
  }
  if (!response.ok || payload.errors?.length || !payload.data?.quote) {
    throw new Error(payload.errors?.[0]?.message || 'Quote not found');
  }
  return { quote: payload.data.quote, settings: null, brands: [] };
}

async function getPdfServiceToken(apiUrl) {
  const email = process.env.QUOTE_PDF_EMAIL || process.env.PDF_SERVICE_EMAIL || 'admin@marblepark.com';
  const password = process.env.QUOTE_PDF_PASSWORD || process.env.PDF_SERVICE_PASSWORD || 'password123';
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query: `mutation PdfServiceLogin($input: LoginInput!) { login(input: $input) { token } }`,
      variables: { input: { email, password } },
    }),
  });
  const payload = await response.json();
  if (!response.ok || payload.errors?.length || !payload.data?.login?.token) {
    throw new Error(payload.errors?.[0]?.message || 'PDF service login failed');
  }
  return payload.data.login.token;
}

// ============= Selection layout =============

function CoverPage({ quote, settings, requestUrl, quoteMeta }) {
  const e = React.createElement;
  const heroUrl = buildAbsoluteUrl(quoteMeta.coverImage || quote.coverImage || (quote.customer && quote.customer.coverImage), requestUrl);
  const company = (settings && settings.companyName) || quoteMeta.companyName || 'MARBLE PARK';
  const customerName = quote.customer?.name || 'Premium Client';
  const customerMobile = quote.customer?.mobile || quote.customer?.phone || '';
  const architect = quote.customer?.architectName || quoteMeta.architectName || '';
  const sales = quote.owner?.name || quoteMeta.preparedBy || 'Marble Park Team';
  const salesPhone = quote.owner?.phone || (settings && settings.supportPhone) || '';
  const date = fmtDate(quote.createdAt) || fmtDate(new Date());
  const tagline = quoteMeta.tagline || 'Below Are The Best Quoted Rates, For The Material You Have Selected For Your Prestegious Project.';

  return e(Page, { size: 'A4', style: styles.coverPage },
    // Tagline
    e(Text, { style: styles.coverTagline }, tagline),
    // Hero block: image fills band, OR a tinted placeholder
    heroUrl
      ? e(Image, { src: heroUrl, style: styles.coverHero })
      : e(View, { style: styles.coverHeroBg }),
    // Brand wordmark over the hero
    e(Text, { style: styles.coverBrandWordmark }, String(company).toUpperCase()),
    // QUOTATION pill
    e(View, { style: styles.coverQuotationTab },
      e(Text, { style: styles.coverQuotationText }, 'QUOTATION'),
    ),
    // Client / project ribbon at bottom
    e(View, { style: styles.coverRibbon },
      e(View, { style: styles.coverRibbonGrid },
        e(View, { style: styles.coverRibbonCol },
          e(Text, { style: styles.coverRibbonLine },
            e(Text, { style: styles.coverRibbonStrong }, 'CLIENT NAME :- '),
            customerName,
          ),
          customerMobile
            ? e(Text, { style: styles.coverRibbonLine },
                e(Text, { style: styles.coverRibbonStrong }, 'MOBILE NO :- '),
                customerMobile,
              )
            : null,
          architect
            ? e(Text, { style: styles.coverRibbonLine },
                e(Text, { style: styles.coverRibbonStrong }, 'ARCHITECT NAME :- '),
                architect,
              )
            : null,
        ),
        e(View, { style: styles.coverRibbonCol },
          e(Text, { style: styles.coverRibbonLine },
            e(Text, { style: styles.coverRibbonStrong }, 'Date :- '),
            date,
          ),
          sales
            ? e(Text, { style: styles.coverRibbonLine },
                e(Text, { style: styles.coverRibbonStrong }, 'Sales Manager. PH :- '),
                `${sales}${salesPhone ? ` PH:- ${salesPhone}` : ''}`,
              )
            : null,
          quote.quoteNumber
            ? e(Text, { style: styles.coverRibbonLine },
                e(Text, { style: styles.coverRibbonStrong }, 'Quote No :- '),
                quote.quoteNumber,
              )
            : null,
        ),
      ),
    ),
  );
}

/**
 * Selection card matching the "Utilize / Size / Design Name + image" pattern
 * from the user's sample. Kept on a 2-column grid so 4 cards fit per page on
 * portrait A4 (with the area title above).
 */
function SelectionCard({ row, requestUrl }) {
  const e = React.createElement;
  const utilize = row.area || row.room || 'General Selection';
  const size = row.tileSize || row.size || row.dimensions || (row.unit && row.qty ? `${row.qty} ${row.unit}` : '—');
  const designName = row.tileCode || row.sku || row.name || row.designName || '—';
  const src = imageSrc(row, requestUrl);
  return e(View, { style: styles.selectionCard, wrap: false },
    e(Text, { style: styles.cardLabelRow },
      e(Text, { style: styles.cardLabelKey }, 'Utilize '), ':- ',
      e(Text, { style: styles.cardLabelValue }, utilize),
    ),
    e(Text, { style: styles.cardLabelRow },
      e(Text, { style: styles.cardLabelKey }, 'Size '), ':- ',
      e(Text, { style: styles.cardLabelValueBlack }, size),
    ),
    e(Text, { style: styles.cardLabelRow },
      e(Text, { style: styles.cardLabelKey }, 'Design Name '), ':- ',
      e(Text, { style: styles.cardLabelValueBlack }, designName),
    ),
    e(View, { style: styles.cardImageWrap },
      src
        ? e(Image, { src, style: styles.cardImage })
        : e(Text, { style: styles.cardImagePlaceholder }, 'Image not available'),
    ),
  );
}

function SelectionAreaPage({ group, requestUrl }) {
  const e = React.createElement;
  // 2 cards per row; up to 4 cards per page so the layout breathes.
  const pageChunks = chunk(group.rows, 4);
  return pageChunks.map((rowsForPage, pageIdx) =>
    e(Page, { key: `${group.area}-${pageIdx}`, size: 'A4', style: styles.pagePadded },
      e(Text, { style: styles.areaPageHeader }, `${group.area}${pageChunks.length > 1 ? ` (${pageIdx + 1}/${pageChunks.length})` : ''}`),
      e(View, { style: styles.cardGrid },
        ...rowsForPage.map((row, idx) => e(SelectionCard, { key: `${row.sku || row.tileCode || idx}`, row, requestUrl })),
      ),
      e(View, { style: styles.footer },
        e(Text, null, 'Marble Park · Premium Bath Solutions'),
        e(Text, { render: ({ pageNumber, totalPages }) => `${pageNumber}/${totalPages}`, style: styles.pageNumber }),
      ),
    ),
  );
}

function ClosingPage({ settings, terms, bank }) {
  const e = React.createElement;
  return e(Page, { size: 'A4', style: styles.closingPage },
    e(View, { style: styles.closingInner },
      e(Text, { style: styles.closingHeading }, 'Thank You.'),
      e(Text, { style: styles.closingText }, 'We appreciate the opportunity to be part of your project. Selections above can be revised area-wise before final order confirmation.'),
      e(Text, { style: styles.closingTermsTitle }, 'Terms & Conditions'),
      e(Text, { style: styles.closingText }, terms),
      e(Text, { style: styles.closingTermsTitle }, 'Bank Details'),
      e(Text, { style: styles.closingText }, bank),
      settings?.supportEmail ? e(Text, { style: styles.closingText }, `For any questions: ${settings.supportEmail}${settings.supportPhone ? ` · ${settings.supportPhone}` : ''}`) : null,
    ),
  );
}

// ============= Priced layout (inherited compact style) =============

function PricedAreaTable({ group, showPrices, requestUrl }) {
  const e = React.createElement;
  return e(View, { style: styles.areaBlock, wrap: false },
    e(View, { style: styles.areaHeader },
      e(Text, { style: styles.areaTitle }, group.area),
      e(Text, { style: styles.areaCount }, `${group.rows.length} item(s)`),
    ),
    e(View, { style: styles.tableHeader },
      e(Text, { style: [styles.th, styles.imageCol] }, 'Image'),
      e(Text, { style: [styles.th, styles.descCol] }, 'Description'),
      e(Text, { style: [styles.th, styles.qtyCol] }, 'Qty'),
      showPrices ? e(Text, { style: [styles.th, styles.rateCol] }, 'MRP') : null,
      showPrices ? e(Text, { style: [styles.th, styles.discountCol] }, 'Disc.') : null,
      showPrices ? e(Text, { style: [styles.th, styles.specialCol] }, 'Special') : null,
      showPrices ? e(Text, { style: [styles.th, styles.amountCol] }, 'Total') : null,
    ),
    ...group.rows.map((line, index) => {
      const rate = rateFor(line);
      const src = imageSrc(line, requestUrl);
      return e(View, { key: `${line.sku || line.tileCode || index}`, style: styles.tableRow },
        e(View, { style: styles.imageCol },
          src ? e(Image, { src, style: styles.image }) : e(View, { style: styles.image }, e(Text, { style: { fontSize: 7, color: colors.tan, textAlign: 'center', marginTop: 21 } }, 'No image')),
        ),
        e(View, { style: styles.descCol },
          e(Text, { style: styles.td }, line.name || line.description || line.sku || line.tileCode || 'Selection item'),
          e(Text, { style: styles.sku }, [line.sku || line.tileCode || '', line.brand || '', line.finish || '', line.tileSize || ''].filter(Boolean).join(' · ')),
          line.notes || line.description ? e(Text, { style: styles.meta }, line.notes || line.description) : null,
        ),
        e(Text, { style: [styles.td, styles.qtyCol] }, `${rate.qty} ${line.unit || line.uom || 'PC'}`),
        showPrices ? e(Text, { style: [styles.td, styles.rateCol] }, money(rate.price)) : null,
        showPrices ? e(Text, { style: [styles.td, styles.discountCol] }, rate.discount ? `${rate.discount}%` : '-') : null,
        showPrices ? e(Text, { style: [styles.td, styles.specialCol] }, money(rate.unitRate)) : null,
        showPrices ? e(Text, { style: [styles.td, styles.amountCol] }, money(rate.amount)) : null,
      );
    }),
  );
}

function PricedDocumentBody(payload, requestUrl) {
  const e = React.createElement;
  const quote = payload.quote;
  const settings = payload.settings || {};
  const lines = asArray(quote.lines);
  const quoteMeta = safeJson(quote.quoteMeta, {});
  const groups = groupByArea(lines);
  const subtotal = lines.reduce((sum, line) => sum + rateFor(line).amount, 0);
  const discountAmount = subtotal * (Number(quote.discountPercent || 0) / 100);
  const taxable = Math.max(0, subtotal - discountAmount);
  const tax = taxable * 0.18;
  const total = taxable + tax;
  const terms = quoteMeta.terms || 'Prices are valid until the quote validity date. Delivery depends on stock availability. Installation, unloading, plumbing and civil work are excluded unless mentioned.';
  const bank = quoteMeta.bankDetails || 'Bank details will be shared by Marble Park accounts team at order confirmation.';
  const remarks = quoteMeta.remarks || quote.notes || 'Selections can be revised area-wise before final order confirmation.';

  return e(Page, { size: 'A4', style: styles.page },
    e(View, { style: styles.topRule }),
    e(View, { style: styles.header },
      e(View, { style: styles.brandWrap },
        e(View, { style: styles.logoBox }, e(Text, { style: styles.logoText }, 'MP')),
        e(View, null,
          e(Text, { style: styles.brand }, settings.companyName || 'MARBLE PARK'),
          e(Text, { style: styles.subBrand }, 'Retail Ops'),
        ),
      ),
      e(View, null,
        e(Text, { style: styles.quoteTitle }, 'QUOTATION'),
        e(Text, { style: styles.quoteDate }, `Date: ${fmtDate(quote.createdAt) || fmtDate(new Date())}`),
      ),
    ),
    e(View, { style: styles.panels },
      e(View, { style: styles.panel },
        e(Text, { style: styles.label }, 'Quotation To'),
        e(Text, { style: styles.value }, quote.customer?.name || 'Premium Client'),
        e(Text, { style: styles.text }, quote.customer?.siteAddress || quote.customer?.city || 'Site address pending'),
        quote.customer?.architectName ? e(Text, { style: styles.text }, `Architect: ${quote.customer.architectName}`) : null,
        quote.customer?.designerName ? e(Text, { style: styles.text }, `Designer: ${quote.customer.designerName}`) : null,
      ),
      e(View, { style: styles.panel },
        e(Text, { style: styles.label }, 'Quote Reference'),
        e(Text, { style: styles.value }, quote.quoteNumber || 'QT/PENDING'),
        e(Text, { style: [styles.label, { marginTop: 9 }] }, 'Valid Until'),
        e(Text, { style: styles.value }, fmtDate(quote.validUntil) || '30 days'),
        e(Text, { style: [styles.label, { marginTop: 9 }] }, 'Sales Person'),
        e(Text, { style: styles.value }, quote.owner?.name || quoteMeta.preparedBy || 'Marble Park Team'),
      ),
    ),
    e(View, { style: styles.badgeRow },
      e(Text, { style: styles.badge }, quote.projectName || quote.title || 'Retail selection'),
      e(Text, { style: styles.badge }, `${groups.length} area(s)`),
      e(Text, { style: styles.badge }, 'Prices shown'),
    ),
    ...groups.map((group) => e(PricedAreaTable, { key: group.area, group, showPrices: true, requestUrl })),
    e(View, { style: styles.totalsWrap },
      e(View, { style: styles.notesBox },
        e(Text, { style: styles.label }, 'Remarks'),
        e(Text, { style: styles.text }, remarks),
      ),
      e(View, { style: styles.totalsBox },
        e(View, { style: styles.totalRow }, e(Text, { style: styles.totalLabel }, 'Subtotal'), e(Text, { style: styles.totalValue }, money(subtotal))),
        e(View, { style: styles.totalRow }, e(Text, { style: styles.totalLabel }, `Discount ${Number(quote.discountPercent || 0)}%`), e(Text, { style: styles.totalValue }, money(discountAmount))),
        e(View, { style: styles.totalRow }, e(Text, { style: styles.totalLabel }, 'GST 18%'), e(Text, { style: styles.totalValue }, money(tax))),
        e(View, { style: [styles.totalRow, styles.grand] }, e(Text, { style: styles.grandText }, 'Total'), e(Text, { style: styles.grandText }, money(total))),
      ),
    ),
    e(View, { style: styles.bottomGrid },
      e(View, { style: styles.halfBox }, e(Text, { style: styles.label }, 'Terms and Conditions'), e(Text, { style: styles.text }, terms)),
      e(View, { style: styles.halfBox }, e(Text, { style: styles.label }, 'Bank Details'), e(Text, { style: styles.text }, bank)),
    ),
    e(View, { style: styles.footer },
      e(Text, null, `Prepared by: ${quote.owner?.name || quoteMeta.preparedBy || 'Marble Park Team'}`),
      e(Text, null, `Thank you for choosing Marble Park. ${settings.supportEmail || 'support@marblepark.in'}`),
      e(Text, { render: ({ pageNumber, totalPages }) => `${pageNumber}/${totalPages}`, style: styles.pageNumber }),
    ),
  );
}

// ============= Top-level document selection =============

function buildDocument(payload, requestUrl) {
  const e = React.createElement;
  const quote = payload.quote;
  const settings = payload.settings;
  const quoteMeta = safeJson(quote.quoteMeta, {});
  const lines = asArray(quote.lines);
  const groups = groupByArea(lines);
  const isSelection = quote.displayMode === 'selection' || quoteMeta.layout === 'selection';

  if (isSelection) {
    const terms = quoteMeta.terms || 'Selection summary is for design coordination only. Final pricing, taxes, and delivery terms will be confirmed when the order is placed. Tile codes and shades may have small lot variations.';
    const bank = quoteMeta.bankDetails || 'Bank details will be shared by Marble Park accounts team at order confirmation.';
    return e(Document, null,
      e(CoverPage, { quote, settings, requestUrl, quoteMeta }),
      ...groups.flatMap((group) => SelectionAreaPage({ group, requestUrl })),
      e(ClosingPage, { settings, terms, bank }),
    );
  }
  return e(Document, null, PricedDocumentBody(payload, requestUrl));
}

async function main() {
  const [, , id, requestUrl, apiUrl] = process.argv;
  if (!id || !requestUrl || !apiUrl) {
    throw new Error('Usage: render-quote-pdf.cjs <id> <requestUrl> <apiUrl>');
  }
  const payload = await fetchQuote(id, apiUrl);
  const buffer = await renderToBuffer(buildDocument(payload, requestUrl));
  process.stdout.write(buffer);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
