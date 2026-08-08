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
  ink: '#222222',
  paper: '#ffffff',
  cream: '#f6f3f2',
  line: '#ddd6d4',
  tan: '#7f211d',
  gold: '#9d2a24',
  green: '#0d7470',
  muted: '#66615f',
  redAccent: '#9d2a24',
  charcoal: '#171717',
  cardBg: '#ffffff',
};

const styles = StyleSheet.create({
  // Shared
  page: { backgroundColor: colors.paper, paddingTop: 24, paddingLeft: 28, paddingRight: 28, paddingBottom: 34, color: colors.ink, fontFamily: 'Helvetica' },
  pagePadded: { backgroundColor: colors.paper, paddingTop: 28, paddingBottom: 70, paddingLeft: 28, paddingRight: 28, color: colors.ink, fontFamily: 'Helvetica' },
  // ---- Cover page (selection layout) ----
  coverPage: { padding: 0, backgroundColor: '#ffffff', color: colors.ink, fontFamily: 'Helvetica' },
  coverTagline: { position: 'absolute', top: 24, left: 28, right: 28, fontSize: 11, fontStyle: 'italic', fontWeight: 700, color: colors.ink },
  coverHeroBg: { position: 'absolute', top: 60, left: 0, right: 0, height: 460, backgroundColor: colors.line },
  coverHero: { position: 'absolute', top: 60, left: 0, right: 0, height: 460, objectFit: 'cover' },
  coverBrandWordmark: { position: 'absolute', top: 80, left: 28, right: 28, fontSize: 64, fontWeight: 900, letterSpacing: 4, color: '#ffffff', textAlign: 'center', textShadow: '0 2px 8px rgba(0,0,0,0.45)' },
  coverIdentity: { position: 'absolute', top: 82, left: 28, width: 124, height: 152, backgroundColor: '#ffffff', borderWidth: 1, borderColor: colors.line, padding: 8, alignItems: 'center', justifyContent: 'center' },
  coverIdentityLogo: { width: 108, height: 136, objectFit: 'contain' },
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
  topRule: { height: 4, backgroundColor: colors.redAccent, marginBottom: 10 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  logoBox: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.ink, color: colors.paper, alignItems: 'center', justifyContent: 'center' },
  logoText: { fontSize: 15, fontWeight: 800 },
  companyLogoBox: { width: 64, height: 58, backgroundColor: '#ffffff', padding: 1, alignItems: 'center', justifyContent: 'center' },
  companyLogo: { width: 58, height: 56, objectFit: 'contain' },
  brandWrap: { width: '64%', flexDirection: 'row', gap: 10, alignItems: 'center' },
  brand: { fontSize: 23, fontWeight: 900, letterSpacing: 1.6 },
  subBrand: { marginTop: 3, fontSize: 7.5, color: colors.tan, letterSpacing: 3.4, textTransform: 'uppercase' },
  companyMeta: { marginTop: 2, maxWidth: 245, fontSize: 6.8, color: colors.muted, lineHeight: 1.3 },
  quoteIdentity: { width: '33%', alignItems: 'flex-end' },
  quoteTitle: { maxWidth: 182, fontSize: 12.5, lineHeight: 1.15, fontWeight: 900, textAlign: 'right', letterSpacing: 0.4 },
  quoteDate: { marginTop: 3, fontSize: 8.5, color: colors.muted, textAlign: 'right' },
  panels: { flexDirection: 'row', gap: 12, marginTop: 7, marginBottom: 8 },
  panel: { flex: 1, minHeight: 65, backgroundColor: colors.cardBg, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 9 },
  label: { fontSize: 7.2, fontWeight: 900, color: colors.tan, letterSpacing: 1.5, textTransform: 'uppercase' },
  value: { marginTop: 4, fontSize: 12, fontWeight: 900, color: colors.ink },
  text: { marginTop: 3, fontSize: 8.8, lineHeight: 1.35, color: colors.muted },
  badgeRow: { flexDirection: 'row', gap: 6, marginTop: 5, flexWrap: 'wrap' },
  badge: { borderRadius: 999, backgroundColor: colors.cream, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 8, paddingVertical: 4, fontSize: 7.2, fontWeight: 900, color: colors.tan, textTransform: 'uppercase', letterSpacing: 1.1 },
  areaBlock: { marginTop: 10, borderWidth: 1, borderColor: colors.line, borderRadius: 16, backgroundColor: colors.cardBg, overflow: 'hidden' },
  areaHeader: { backgroundColor: colors.ink, color: colors.paper, paddingHorizontal: 12, paddingVertical: 9, flexDirection: 'row', justifyContent: 'space-between' },
  areaTitle: { fontSize: 10, fontWeight: 900, letterSpacing: 1.5, textTransform: 'uppercase' },
  areaCount: { fontSize: 8, color: '#e8c39b' },
  tableHeader: { flexDirection: 'row', backgroundColor: colors.line, paddingVertical: 7, paddingHorizontal: 8 },
  tableRow: { flexDirection: 'row', minHeight: 62, paddingVertical: 6, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: '#f1e3d2' },
  th: { fontSize: 6.8, fontWeight: 900, color: colors.muted, textTransform: 'uppercase', letterSpacing: 1.05 },
  td: { fontSize: 8.6, color: colors.ink, lineHeight: 1.25 },
  imageCol: { width: '13%' },
  image: { width: 46, height: 46, objectFit: 'contain', borderRadius: 6, backgroundColor: colors.cream },
  descCol: { width: '33%', paddingRight: 6 },
  qtyCol: { width: '10%', textAlign: 'center' },
  rateCol: { width: '13%', textAlign: 'right' },
  discountCol: { width: '10%', textAlign: 'right' },
  specialCol: { width: '11%', textAlign: 'right' },
  amountCol: { width: '10%', textAlign: 'right' },
  sku: { marginTop: 4, fontSize: 7.2, color: colors.tan, letterSpacing: 0.8 },
  meta: { marginTop: 3, fontSize: 7.6, color: colors.muted },
  totalsWrap: { marginTop: 9, flexDirection: 'row', gap: 12, alignItems: 'stretch' },
  notesBox: { flex: 1, minHeight: 72, backgroundColor: colors.cardBg, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 9 },
  totalsBox: { width: 200, backgroundColor: colors.cardBg, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 9 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  totalLabel: { fontSize: 8.6, color: colors.muted, fontWeight: 700 },
  totalValue: { fontSize: 8.8, color: colors.ink, fontWeight: 900 },
  grand: { borderTopWidth: 2, borderTopColor: colors.ink, paddingTop: 5, marginTop: 1 },
  grandText: { fontSize: 12, fontWeight: 900, color: colors.ink },
  bottomGrid: { marginTop: 9, flexDirection: 'row', gap: 12 },
  halfBox: { flex: 1, backgroundColor: colors.cardBg, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 9, minHeight: 60 },
  brandStrip: { marginTop: 9, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 7 },
  brandStripTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 },
  brandStripTitle: { fontSize: 7.2, fontWeight: 900, color: colors.tan, letterSpacing: 1.5, textTransform: 'uppercase' },
  brandStripHint: { fontSize: 6.5, color: colors.muted },
  brandLogoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  brandLogoTile: { width: 60, height: 30, borderWidth: 1, borderColor: colors.line, backgroundColor: '#ffffff', padding: 4, alignItems: 'center', justifyContent: 'center' },
  brandLogo: { width: 52, height: 21, objectFit: 'contain' },
  brandLogoName: { fontSize: 6, fontWeight: 800, color: colors.ink, textAlign: 'center' },
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
  const firstGallery = Array.isArray(media.gallery) ? media.gallery[0] : null;
  const raw = line._pdfImage
    || line.quoteImage
    || line.customImageUrl
    || media.primaryUrl
    || media.primary
    || media.primaryImage
    || (typeof firstGallery === 'string' ? firstGallery : firstGallery?.url);
  return buildAbsoluteUrl(raw, requestUrl);
}

function assetMime(url, contentType) {
  const normalized = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (normalized.startsWith('image/')) return normalized;
  const pathname = (() => { try { return new URL(url).pathname.toLowerCase(); } catch { return String(url).toLowerCase(); } })();
  if (pathname.endsWith('.png')) return 'image/png';
  if (pathname.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

async function hydrateImages(payload, requestUrl, apiUrl) {
  const cache = new Map();
  const toDataUri = async (raw) => {
    const absolute = buildAbsoluteUrl(raw, requestUrl);
    if (!absolute || absolute.startsWith('data:')) return absolute;
    if (cache.has(absolute)) return cache.get(absolute);
    const task = (async () => {
      const candidates = [];
      try {
        const parsed = new URL(absolute);
        if (/^\/catalogue-images\//.test(parsed.pathname)) {
          const apiOrigin = new URL(apiUrl).origin;
          candidates.push(`${apiOrigin}${parsed.pathname}${parsed.search}`);
        } else if (/^\/(?:brand|catalogue-art)\//.test(parsed.pathname)) {
          candidates.push(`http://127.0.0.1:${process.env.PORT || 3000}${parsed.pathname}${parsed.search}`);
        }
      } catch {}
      candidates.push(absolute);
      for (const candidate of candidates) {
        try {
          const response = await fetch(candidate);
          if (!response.ok) continue;
          const content = Buffer.from(await response.arrayBuffer());
          if (!content.length) continue;
          return `data:${assetMime(candidate, response.headers.get('content-type'))};base64,${content.toString('base64')}`;
        } catch {}
      }
      return null;
    })();
    cache.set(absolute, task);
    return task;
  };

  const settings = { ...(payload.settings || {}) };
  settings.logoUrl = await toDataUri(settings.logoUrl || '/brand/marble-park-logo.png');
  const brands = await Promise.all(asArray(payload.brands).map(async (brand) => ({
    ...brand,
    metadata: { ...safeJson(brand.metadata, {}), logoUrl: await toDataUri(safeJson(brand.metadata, {}).logoUrl) },
  })));
  const quote = { ...payload.quote };
  quote.lines = await Promise.all(asArray(quote.lines).map(async (line) => ({ ...line, _pdfImage: await toDataUri(imageSrc(line, requestUrl)) })));
  const quoteMeta = safeJson(quote.quoteMeta, {});
  if (quoteMeta.coverImage) quoteMeta.coverImage = await toDataUri(quoteMeta.coverImage);
  quote.quoteMeta = quoteMeta;
  if (quote.coverImage) quote.coverImage = await toDataUri(quote.coverImage);
  return { ...payload, quote, settings, brands };
}

function rateFor(line) {
  const qty = Number(line.qty || line.quantity || 0);
  const basis = String(line.rateBasis || 'PACK').toUpperCase();
  const pricingQuantity = Number(line.pricingQuantity || (basis === 'AREA'
    ? qty * Number(line.coveragePerPack || 0)
    : basis === 'PIECE' ? qty * Number(line.piecesPerPack || line.pcsPerBox || 1) : qty));
  const pricingUom = String(line.pricingUom || (basis === 'PIECE' ? 'PC' : line.unit || line.uom || 'BOX')).toUpperCase();
  const price = Number(line.listPrice ?? line.price ?? line.sellPrice ?? 0);
  const discount = Number(line.discountPercent || line.discount || 0);
  const specialRate = Number(line.specialRate || line.specialPrice || 0);
  const hasStoredUnitRate = line.unitRate !== null && line.unitRate !== undefined && line.unitRate !== '';
  const storedUnitRate = Number(line.unitRate);
  const unitRate = hasStoredUnitRate && Number.isFinite(storedUnitRate) && storedUnitRate >= 0 ? storedUnitRate : specialRate > 0 ? specialRate : price * (1 - discount / 100);
  const hasStoredTaxable = line.taxableValue !== null && line.taxableValue !== undefined && line.taxableValue !== '';
  const quoteDiscountPercent = Number(line.quoteDiscountPercent || 0);
  const lineSubtotal = pricingQuantity * unitRate;
  const quoteDiscountAmount = line.quoteDiscountAmount !== null && line.quoteDiscountAmount !== undefined && line.quoteDiscountAmount !== ''
    ? Number(line.quoteDiscountAmount)
    : lineSubtotal * quoteDiscountPercent / 100;
  const taxableValue = hasStoredTaxable && Number.isFinite(Number(line.taxableValue))
    ? Number(line.taxableValue)
    : Math.max(0, lineSubtotal - quoteDiscountAmount);
  const taxAmount = line.taxAmount !== null && line.taxAmount !== undefined && line.taxAmount !== ''
    ? Number(line.taxAmount)
    : taxableValue * Math.max(0, Number(line.taxRate ?? 18)) / 100;
  const amount = line.grossLineTotal !== null && line.grossLineTotal !== undefined && line.grossLineTotal !== ''
    ? Number(line.grossLineTotal)
    : taxableValue + taxAmount;
  const mrp = line.mrp === null || line.mrp === undefined || line.mrp === '' ? null : Number(line.mrp);
  const mrpUom = basis === 'AREA' ? String(line.pricingUom || 'SQFT').toUpperCase() : basis === 'PIECE' ? 'PC' : String(line.inventoryUom || line.unit || line.uom || 'BOX').toUpperCase();
  const grossMrp = mrp !== null && Number.isFinite(mrp) && mrp > 0 ? mrp * pricingQuantity : null;
  // MRP is tax-inclusive, so compare it with the final tax-inclusive payable.
  const savingFromMrp = grossMrp === null ? null : Math.max(0, grossMrp - amount);
  const finalUnitPayable = pricingQuantity > 0 ? amount / pricingQuantity : 0;
  // % off: prefer the final payable vs MRP when MRP is shown.
  let displayOffPercent = 0;
  if (mrp !== null && Number.isFinite(mrp) && mrp > 0 && finalUnitPayable < mrp) {
    displayOffPercent = Math.round((1 - finalUnitPayable / mrp) * 100);
  } else if (price > 0 && unitRate < price && discount > 0 && !(specialRate > 0)) {
    displayOffPercent = Math.round(discount);
  }
  return { qty, basis, pricingQuantity, pricingUom, price, discount, displayOffPercent, unitRate, lineSubtotal, quoteDiscountPercent, quoteDiscountAmount, taxableValue, taxAmount, amount, mrp, mrpUom, grossMrp, savingFromMrp };
}

function isLegacyQuoteBeforeMrpContract(quote) {
  const createdAt = quote?.createdAt ? new Date(quote.createdAt).getTime() : 0;
  return !createdAt || createdAt < Date.UTC(2026, 7, 4);
}

function assertQuoteCommercialReady(quote, taxMode, options = {}) {
  const quoteDiscountPercent = Number(quote.discountPercent || 0);
  const lines = asArray(quote.lines);
  const legacyLines = lines.length > 0 && lines.every((line) => {
    const mrp = line?.mrp;
    return mrp === null || mrp === undefined || mrp === '';
  });
  if (options.allowLegacy !== false && legacyLines && isLegacyQuoteBeforeMrpContract(quote)) {
    return { legacyPricing: true };
  }
  for (const line of lines) {
    const rate = rateFor(line);
    const taxRate = taxMode === 'non_gst' ? 0 : Math.max(0, Number(line.taxRate ?? 18));
    const payable = Math.max(0, rate.unitRate) * (1 - quoteDiscountPercent / 100) * (1 + taxRate / 100);
    if (rate.mrp === null || !Number.isFinite(rate.mrp) || rate.mrp <= 0) {
      throw new Error(`Quote PDF blocked: MRP is required for ${line.sku || line.name || 'every line'} per ${rate.mrpUom}`);
    }
    if (payable > rate.mrp + 0.5) {
      throw new Error(`Quote PDF blocked: ${line.sku || line.name || 'Line'} payable ${payable.toFixed(2)} per ${rate.mrpUom} exceeds MRP ${rate.mrp.toFixed(2)}`);
    }
  }
  return { legacyPricing: false };
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

function selectedBrands(payload, quoteMeta) {
  if (quoteMeta.showBrandLogos === false) return [];
  const brands = asArray(payload.brands).filter((brand) => {
    const metadata = safeJson(brand.metadata, {});
    const logoUrl = String(metadata.logoUrl || '').trim();
    // Option B: never render text-only / no-logo junk tiles (e.g. Release Contract).
    return brand.status === 'active' && metadata.quoteEnabled !== false && Boolean(logoUrl);
  });
  if (Array.isArray(quoteMeta.selectedBrandIds)) {
    const ids = new Set(quoteMeta.selectedBrandIds.map(String));
    return brands.filter((brand) => ids.has(String(brand.id)));
  }
  const mode = String(payload.settings?.quoteBrandSelectionMode || 'all');
  if (mode === 'none') return [];
  if (mode === 'selected') {
    const defaults = new Set(asArray(payload.settings?.quoteBrandIds).map(String));
    return brands.filter((brand) => defaults.has(String(brand.id)));
  }
  return brands;
}

function BrandStrip({ payload, quoteMeta, requestUrl }) {
  const e = React.createElement;
  const brands = selectedBrands(payload, quoteMeta);
  if (!brands.length) return null;
  return e(View, { style: styles.brandStrip, wrap: false },
    e(View, { style: styles.brandStripTitleRow },
      e(Text, { style: styles.brandStripTitle }, 'Brands selected for this quotation'),
      e(Text, { style: styles.brandStripHint }, `${brands.length} served brand${brands.length === 1 ? '' : 's'}`),
    ),
    e(View, { style: styles.brandLogoGrid },
      ...brands.map((brand) => {
        const src = buildAbsoluteUrl(safeJson(brand.metadata, {}).logoUrl, requestUrl);
        if (!src) return null;
        return e(View, { key: String(brand.id), style: styles.brandLogoTile },
          e(Image, { src, style: styles.brandLogo }),
        );
      }),
    ),
  );
}

async function fetchQuote(id, apiUrl) {
  const publicToken = String(process.env.PDF_PUBLIC_SHARE_TOKEN || '').trim();
  if (publicToken) {
    const query = `query SharedQuoteForPdf($token: String!) { publicQuoteShareDocument(token: $token) }`;
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables: { token: publicToken } }),
    });
    const payload = await response.json();
    const shared = payload.data?.publicQuoteShareDocument;
    if (!response.ok || payload.errors?.length || !shared?.quote) throw new Error(payload.errors?.[0]?.message || 'Quote share link not found');
    const result = { quote: shared.quote, settings: shared.settings || {}, brands: shared.brands || [] };
    assertQuoteCommercialReady(result.quote, safeJson(result.quote.quoteMeta, {}).taxMode === 'non_gst' ? 'non_gst' : 'gst');
    return result;
  }
  const query = `query QuoteForPdf($id: ID!) {
    quote(id: $id) {
      id quoteNumber title projectName validUntil createdAt
      lines quoteMeta displayMode discountPercent notes
      architectId architectName architect
      customer owner lead approval
    }
    documentSettings { data }
    masterProductBrands(status: "active")
  }`;
  const token = requiredSessionToken();
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables: { id } }),
  });
  const payload = await response.json();
  if (!response.ok || payload.errors?.length || !payload.data?.quote) {
    throw new Error(payload.errors?.[0]?.message || 'Quote not found');
  }
  const result = {
    quote: payload.data.quote,
    settings: payload.data.documentSettings?.data || null,
    brands: payload.data.masterProductBrands || [],
  };
  assertQuoteCommercialReady(result.quote, safeJson(result.quote.quoteMeta, {}).taxMode === 'non_gst' ? 'non_gst' : 'gst');
  return result;
}

function requiredSessionToken() {
  const token = String(process.env.PDF_SESSION_TOKEN || '').trim();
  if (!token) throw new Error('Login required');
  return token;
}

// ============= Selection layout =============

function CoverPage({ quote, settings, requestUrl, quoteMeta }) {
  const e = React.createElement;
  const heroUrl = buildAbsoluteUrl(quoteMeta.coverImage || quote.coverImage || (quote.customer && quote.customer.coverImage), requestUrl);
  const company = (settings && settings.companyName) || quoteMeta.companyName || 'MARBLE PARK';
  const companyLogo = buildAbsoluteUrl((settings && settings.logoUrl) || '/brand/marble-park-logo.png', requestUrl);
  const customerName = quote.customer?.name || 'Premium Client';
  const customerMobile = quote.customer?.mobile || quote.customer?.phone || '';
  const architect = quote.architectName || quote.architect?.name || quoteMeta.architectName || quote.customer?.architectName || '';
  const sales = quote.owner?.name || quoteMeta.preparedBy || 'Marble Park Team';
  const salesPhone = quote.owner?.phone || (settings && settings.supportPhone) || '';
  const date = fmtDate(quote.createdAt) || fmtDate(new Date());
  const tagline = quoteMeta.tagline || (settings && settings.documentTagline) || 'Premium bath, tile and surface selections for considered spaces.';

  return e(Page, { size: 'A4', style: styles.coverPage },
    // Tagline
    e(Text, { style: styles.coverTagline }, tagline),
    // Hero block: image fills band, OR a tinted placeholder
    heroUrl
      ? e(Image, { src: heroUrl, style: styles.coverHero })
      : e(View, { style: styles.coverHeroBg }),
    companyLogo
      ? e(View, { style: styles.coverIdentity }, e(Image, { src: companyLogo, style: styles.coverIdentityLogo }))
      : e(Text, { style: styles.coverBrandWordmark }, String(company).toUpperCase()),
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

function ClosingPage({ payload, settings, terms, bank, quoteMeta, requestUrl }) {
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
      e(BrandStrip, { payload, quoteMeta, requestUrl }),
    ),
  );
}

// ============= Priced layout (inherited compact style) =============

function PricedAreaTable({ group, showPrices, requestUrl, taxMode }) {
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
      showPrices ? e(Text, { style: [styles.th, styles.discountCol] }, 'List rate') : null,
      showPrices ? e(Text, { style: [styles.th, styles.specialCol] }, 'Special') : null,
      showPrices ? e(Text, { style: [styles.th, styles.amountCol] }, 'Total') : null,
    ),
    ...group.rows.map((line, index) => {
      const rate = rateFor(line);
      const src = imageSrc(line, requestUrl);
      return e(View, { key: `${line.sku || line.tileCode || index}`, style: styles.tableRow },
        e(View, { style: styles.imageCol },
          src ? e(Image, { src, style: styles.image }) : e(View, { style: styles.image }, e(Text, { style: { fontSize: 7, color: colors.tan, textAlign: 'center', marginTop: 18 } }, 'No image')),
        ),
        e(View, { style: styles.descCol },
          e(Text, { style: styles.td }, line.name || line.description || line.sku || line.tileCode || 'Selection item'),
          e(Text, { style: styles.sku }, [line.sku || line.tileCode || '', line.brand || '', line.finish || '', line.tileSize || ''].filter(Boolean).join(' · ')),
          line.notes || line.description ? e(Text, { style: styles.meta }, line.notes || line.description) : null,
        ),
        e(Text, { style: [styles.td, styles.qtyCol] }, `${rate.pricingQuantity} ${rate.pricingUom}`),
        showPrices ? e(Text, { style: [styles.td, styles.rateCol] }, `${money(rate.mrp)}\nper ${rate.mrpUom}`) : null,
        showPrices ? e(Text, { style: [styles.td, styles.discountCol] }, money(rate.price)) : null,
        showPrices ? e(Text, { style: [styles.td, styles.specialCol] }, `${money(rate.unitRate)}${rate.displayOffPercent ? `\n${rate.displayOffPercent}% off` : ''}${rate.savingFromMrp !== null && rate.savingFromMrp > 0 ? `\nSave ${money(rate.savingFromMrp)}` : ''}`) : null,
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
  const taxMode = quoteMeta.taxMode === 'non_gst' ? 'non_gst' : 'gst';
  assertQuoteCommercialReady(quote, taxMode);
  const pricedLines = lines.map((line) => rateFor(line));
  const subtotal = pricedLines.reduce((sum, rate) => sum + rate.lineSubtotal, 0);
  const discountAmount = pricedLines.reduce((sum, rate) => sum + rate.quoteDiscountAmount, 0);
  const taxable = pricedLines.reduce((sum, rate) => sum + rate.taxableValue, 0);
  const tax = taxMode === 'non_gst' ? 0 : pricedLines.reduce((sum, rate) => sum + rate.taxAmount, 0);
  const total = pricedLines.reduce((sum, rate) => sum + rate.amount, 0);
  const savingFromMrp = pricedLines.reduce((sum, rate) => sum + Number(rate.savingFromMrp || 0), 0);
  const DEFAULT_TERMS = 'Prices are valid until the quote validity date. Installation, unloading, plumbing and civil work are excluded unless mentioned.';
  const rawTermsSource = quoteMeta.terms || settings.defaultTerms || DEFAULT_TERMS;
  const rawTerms = String(rawTermsSource)
    .replace(/\s*Delivery depends on stock availability\.\s*/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim() || DEFAULT_TERMS;
  const terms = taxMode === 'non_gst' ? String(rawTerms).split('\n').filter((line) => !/\bGST\b/i.test(line)).join('\n') : rawTerms;
  const bank = quoteMeta.bankDetails || settings.bankDetails || 'Bank details will be shared by Marble Park accounts team at order confirmation.';
  const rawRemarks = String(quoteMeta.remarks || quote.notes || '').trim();
  const remarks = !rawRemarks || /^prepared from quote studio\.?$/i.test(rawRemarks)
    ? 'Selections can be revised area-wise before final order confirmation.'
    : rawRemarks;
  const companyLogo = buildAbsoluteUrl(settings.logoUrl || '/brand/marble-park-logo.png', requestUrl);
  const contactLine = [settings.companyAddress, settings.gstNumber ? `GSTIN ${settings.gstNumber}` : '', settings.supportPhone, settings.supportEmail].filter(Boolean).join(' · ');

  return e(Page, { size: 'A4', style: styles.page },
    e(View, { style: styles.topRule }),
    e(View, { style: styles.header },
      e(View, { style: styles.brandWrap },
        companyLogo ? e(View, { style: styles.companyLogoBox }, e(Image, { src: companyLogo, style: styles.companyLogo })) : e(View, { style: styles.logoBox }, e(Text, { style: styles.logoText }, 'MP')),
        e(View, null,
          e(Text, { style: styles.brand }, settings.companyName || 'MARBLE PARK'),
          e(Text, { style: styles.subBrand }, settings.documentTagline || 'Premium Bath & Surface Studio'),
          contactLine ? e(Text, { style: styles.companyMeta }, contactLine) : null,
        ),
      ),
      e(View, { style: styles.quoteIdentity },
        e(Text, { style: styles.quoteTitle }, settings.quotationTitle || 'PROFORMA / QUOTATION'),
        e(Text, { style: styles.quoteDate }, `Date: ${fmtDate(quote.createdAt) || fmtDate(new Date())}`),
      ),
    ),
    e(View, { style: styles.panels },
      e(View, { style: styles.panel },
        e(Text, { style: styles.label }, 'Quotation To'),
        e(Text, { style: styles.value }, quote.customer?.name || 'Premium Client'),
        e(Text, { style: styles.text }, quote.customer?.siteAddress || quote.customer?.city || 'Site address pending'),
        (quote.architectName || quote.architect?.name || quoteMeta.architectName || quote.customer?.architectName)
          ? e(Text, { style: styles.text }, `Architect: ${quote.architectName || quote.architect?.name || quoteMeta.architectName || quote.customer?.architectName}`)
          : null,
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
    ...groups.map((group) => e(PricedAreaTable, { key: group.area, group, showPrices: true, requestUrl, taxMode })),
    e(View, { style: styles.totalsWrap },
      e(View, { style: styles.notesBox },
        e(Text, { style: styles.label }, 'Remarks'),
        e(Text, { style: styles.text }, remarks),
      ),
      e(View, { style: styles.totalsBox },
        savingFromMrp > 0 ? e(View, { style: styles.totalRow }, e(Text, { style: styles.totalLabel }, 'Saving from MRP'), e(Text, { style: [styles.totalValue, { color: '#087f5b' }] }, money(savingFromMrp))) : null,
        e(View, { style: styles.totalRow }, e(Text, { style: styles.totalLabel }, 'Subtotal'), e(Text, { style: styles.totalValue }, money(subtotal))),
        e(View, { style: styles.totalRow }, e(Text, { style: styles.totalLabel }, `Discount ${Number(quote.discountPercent || 0)}%`), e(Text, { style: styles.totalValue }, money(discountAmount))),
        taxMode === 'gst' ? e(View, { style: styles.totalRow }, e(Text, { style: styles.totalLabel }, 'GST'), e(Text, { style: styles.totalValue }, money(tax))) : null,
        e(View, { style: [styles.totalRow, styles.grand] }, e(Text, { style: styles.grandText }, 'Total'), e(Text, { style: styles.grandText }, money(total))),
      ),
    ),
    e(View, { style: styles.bottomGrid },
      e(View, { style: styles.halfBox }, e(Text, { style: styles.label }, 'Terms and Conditions'), e(Text, { style: styles.text }, terms)),
      e(View, { style: styles.halfBox }, e(Text, { style: styles.label }, 'Bank Details'), e(Text, { style: styles.text }, bank)),
    ),
    e(BrandStrip, { payload, quoteMeta, requestUrl }),
    e(View, { style: styles.footer },
      e(Text, null, `Prepared by: ${quote.owner?.name || quoteMeta.preparedBy || 'Marble Park Team'}`),
      e(Text, null, settings.documentFooter || `Thank you for choosing ${settings.companyName || 'Marble Park'}. ${settings.supportEmail || ''}`),
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
    const terms = quoteMeta.terms || settings?.defaultTerms || 'Selection summary is for design coordination only. Final pricing, taxes, and delivery terms will be confirmed when the order is placed. Tile codes and shades may have small lot variations.';
    const bank = quoteMeta.bankDetails || settings?.bankDetails || 'Bank details will be shared by Marble Park accounts team at order confirmation.';
    return e(Document, null,
      e(CoverPage, { quote, settings, requestUrl, quoteMeta }),
      ...groups.flatMap((group) => SelectionAreaPage({ group, requestUrl })),
      e(ClosingPage, { payload, settings, terms, bank, quoteMeta, requestUrl }),
    );
  }
  return e(Document, null, PricedDocumentBody(payload, requestUrl));
}

async function main() {
  const [, , id, requestUrl, apiUrl] = process.argv;
  if (!id || !requestUrl || !apiUrl) {
    throw new Error('Usage: render-quote-pdf.cjs <id> <requestUrl> <apiUrl>');
  }
  const payload = await hydrateImages(await fetchQuote(id, apiUrl), requestUrl, apiUrl);
  const buffer = await renderToBuffer(buildDocument(payload, requestUrl));
  process.stdout.write(buffer);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
