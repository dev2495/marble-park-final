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
};

const styles = StyleSheet.create({
  page: { backgroundColor: colors.paper, padding: 28, color: colors.ink, fontFamily: 'Helvetica' },
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
  panel: { flex: 1, minHeight: 78, backgroundColor: '#ffffff', borderWidth: 1, borderColor: colors.line, borderRadius: 15, padding: 12 },
  label: { fontSize: 7.2, fontWeight: 900, color: colors.tan, letterSpacing: 1.5, textTransform: 'uppercase' },
  value: { marginTop: 4, fontSize: 12, fontWeight: 900, color: colors.ink },
  text: { marginTop: 3, fontSize: 8.8, lineHeight: 1.35, color: colors.muted },
  badgeRow: { flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' },
  badge: { borderRadius: 999, backgroundColor: colors.cream, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 8, paddingVertical: 4, fontSize: 7.2, fontWeight: 900, color: colors.tan, textTransform: 'uppercase', letterSpacing: 1.1 },
  areaBlock: { marginTop: 10, borderWidth: 1, borderColor: colors.line, borderRadius: 16, backgroundColor: '#ffffff', overflow: 'hidden' },
  areaHeader: { backgroundColor: colors.ink, color: colors.paper, paddingHorizontal: 12, paddingVertical: 9, flexDirection: 'row', justifyContent: 'space-between' },
  areaTitle: { fontSize: 10, fontWeight: 900, letterSpacing: 1.5, textTransform: 'uppercase' },
  areaCount: { fontSize: 8, color: '#e8c39b' },
  tableHeader: { flexDirection: 'row', backgroundColor: colors.line, paddingVertical: 7, paddingHorizontal: 8 },
  tableRow: { flexDirection: 'row', minHeight: 72, paddingVertical: 7, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: '#f1e3d2' },
  th: { fontSize: 6.8, fontWeight: 900, color: colors.muted, textTransform: 'uppercase', letterSpacing: 1.05 },
  td: { fontSize: 8.6, color: colors.ink, lineHeight: 1.25 },
  imageCol: { width: '13%' },
  image: { width: 52, height: 52, objectFit: 'contain', borderRadius: 8, backgroundColor: colors.cream },
  descColPriced: { width: '33%', paddingRight: 6 },
  descColSelection: { width: '57%', paddingRight: 8 },
  qtyCol: { width: '10%', textAlign: 'center' },
  rateCol: { width: '13%', textAlign: 'right' },
  discountCol: { width: '10%', textAlign: 'right' },
  specialCol: { width: '11%', textAlign: 'right' },
  amountCol: { width: '10%', textAlign: 'right' },
  sku: { marginTop: 4, fontSize: 7.2, color: colors.tan, letterSpacing: 0.8 },
  meta: { marginTop: 3, fontSize: 7.6, color: colors.muted },
  totalsWrap: { marginTop: 14, flexDirection: 'row', gap: 16, alignItems: 'flex-start' },
  notesBox: { flex: 1, minHeight: 92, backgroundColor: '#ffffff', borderWidth: 1, borderColor: colors.line, borderRadius: 15, padding: 12 },
  totalsBox: { width: 210, backgroundColor: '#ffffff', borderWidth: 1, borderColor: colors.line, borderRadius: 15, padding: 12 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 7 },
  totalLabel: { fontSize: 8.6, color: colors.muted, fontWeight: 700 },
  totalValue: { fontSize: 8.8, color: colors.ink, fontWeight: 900 },
  grand: { borderTopWidth: 2, borderTopColor: colors.ink, paddingTop: 8, marginTop: 3 },
  grandText: { fontSize: 14, fontWeight: 900, color: colors.ink },
  brandStrip: { marginTop: 14, backgroundColor: '#ffffff', borderWidth: 1, borderColor: colors.line, borderRadius: 15, padding: 11 },
  brandGrid: { marginTop: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  brandChip: { minWidth: 68, borderRadius: 12, backgroundColor: colors.cream, borderWidth: 1, borderColor: colors.line, padding: 7, alignItems: 'center' },
  brandLogo: { width: 58, height: 24, objectFit: 'contain' },
  brandInitials: { fontSize: 9, fontWeight: 900, color: colors.ink, textTransform: 'uppercase' },
  bottomGrid: { marginTop: 14, flexDirection: 'row', gap: 14 },
  halfBox: { flex: 1, backgroundColor: '#ffffff', borderWidth: 1, borderColor: colors.line, borderRadius: 15, padding: 12, minHeight: 82 },
  footer: { position: 'absolute', bottom: 18, left: 28, right: 28, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 7, flexDirection: 'row', justifyContent: 'space-between', color: colors.tan, fontSize: 7.4 },
  pageNumber: { color: colors.tan, fontSize: 7.4 },
});

function money(value) { return `Rs. ${Math.round(Number(value || 0)).toLocaleString('en-IN')}`; }
function fmtDate(value) { return value ? new Date(value).toLocaleDateString('en-IN') : ''; }
function safeJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'string') { try { return JSON.parse(value); } catch { return fallback; } }
  return value;
}
function asArray(value) { return Array.isArray(value) ? value : []; }
function imageSrc(line, requestUrl) {
  const media = safeJson(line.media, {});
  const raw = line.quoteImage || line.customImageUrl || media.primary || media.gallery?.[0] || '/catalogue-art/faucet.svg';
  return String(raw).startsWith('http') ? raw : new URL(raw, requestUrl).href;
}
function initials(name) { return String(name || 'MP').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'MP'; }
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

async function fetchQuote(id, apiUrl) {
  try {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    const [quote, settings, brands] = await Promise.all([
      prisma.quote.findUnique({ where: { id }, include: { customer: true, owner: { select: { id: true, name: true, email: true, role: true, phone: true } }, lead: true } }),
      prisma.appSetting.findFirst({ orderBy: { updatedAt: 'desc' } }),
      prisma.productBrand.findMany({ where: { status: 'active' }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], take: 80 }),
    ]);
    await prisma.$disconnect();
    if (quote) return { quote, settings, brands };
  } catch (error) {
    // Fall back to GraphQL for environments where Prisma is unavailable to the renderer.
  }

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query: `query QuoteForPdf($id: ID!) {
        quote(id: $id) { id quoteNumber title projectName validUntil lines quoteMeta displayMode discountPercent notes customer owner lead }
      }`,
      variables: { id },
    }),
  });
  const payload = await response.json();
  if (!response.ok || payload.errors?.length || !payload.data?.quote) throw new Error(payload.errors?.[0]?.message || 'Quote not found');
  return { quote: payload.data.quote, settings: null, brands: [] };
}

function AreaTable({ group, showPrices, requestUrl }) {
  const e = React.createElement;
  const descStyle = showPrices ? styles.descColPriced : styles.descColSelection;
  return e(View, { style: styles.areaBlock, wrap: false },
    e(View, { style: styles.areaHeader }, e(Text, { style: styles.areaTitle }, group.area), e(Text, { style: styles.areaCount }, `${group.rows.length} selection row(s)`)),
    e(View, { style: styles.tableHeader },
      e(Text, { style: [styles.th, styles.imageCol] }, 'Image'),
      e(Text, { style: [styles.th, descStyle] }, 'Description'),
      e(Text, { style: [styles.th, styles.qtyCol] }, 'Qty'),
      showPrices ? e(Text, { style: [styles.th, styles.rateCol] }, 'MRP') : null,
      showPrices ? e(Text, { style: [styles.th, styles.discountCol] }, 'Disc.') : null,
      showPrices ? e(Text, { style: [styles.th, styles.specialCol] }, 'Special') : null,
      showPrices ? e(Text, { style: [styles.th, styles.amountCol] }, 'Total') : null,
    ),
    ...group.rows.map((line, index) => {
      const rate = rateFor(line);
      const isTile = line.type === 'tile' || String(line.category || '').toLowerCase() === 'tiles';
      return e(View, { key: `${line.sku || line.tileCode || index}`, style: styles.tableRow },
        e(View, { style: styles.imageCol }, isTile && !line.quoteImage ? e(View, { style: styles.image }, e(Text, { style: { fontSize: 7, color: colors.tan, textAlign: 'center', marginTop: 21 } }, 'Tile code')) : e(Image, { src: imageSrc(line, requestUrl), style: styles.image })),
        e(View, { style: descStyle },
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

function buildDocument(payload, requestUrl) {
  const e = React.createElement;
  const quote = payload.quote;
  const settings = payload.settings || {};
  const lines = asArray(quote.lines);
  const quoteMeta = safeJson(quote.quoteMeta, {});
  const showPrices = quote.displayMode !== 'selection' && quoteMeta.showPrices !== false;
  const groups = groupByArea(lines);
  const subtotal = lines.reduce((sum, line) => sum + rateFor(line).amount, 0);
  const discountAmount = subtotal * (Number(quote.discountPercent || 0) / 100);
  const taxable = Math.max(0, subtotal - discountAmount);
  const tax = taxable * 0.18;
  const total = taxable + tax;
  const uniqueBrandNames = Array.from(new Set(lines.map((line) => line.brand).filter(Boolean)));
  const brandMap = new Map((payload.brands || []).map((brand) => [String(brand.name).toLowerCase(), brand]));
  const servedBrands = uniqueBrandNames.length ? uniqueBrandNames : (payload.brands || []).slice(0, 8).map((brand) => brand.name);
  const terms = quoteMeta.terms || 'Prices are valid until the quote validity date. Delivery depends on stock availability. Installation, unloading, plumbing and civil work are excluded unless mentioned.';
  const bank = quoteMeta.bankDetails || 'Bank details will be shared by Marble Park accounts team at order confirmation.';
  const remarks = quoteMeta.remarks || quote.notes || 'Selections can be revised area-wise before final order confirmation.';

  return e(Document, null,
    e(Page, { size: 'A4', style: styles.page },
      e(View, { style: styles.topRule }),
      e(View, { style: styles.header },
        e(View, { style: styles.brandWrap }, e(View, { style: styles.logoBox }, e(Text, { style: styles.logoText }, 'MP')), e(View, null, e(Text, { style: styles.brand }, settings.companyName || 'MARBLE PARK'), e(Text, { style: styles.subBrand }, 'Retail Ops'))),
        e(View, null, e(Text, { style: styles.quoteTitle }, showPrices ? 'QUOTATION' : 'SELECTION SUMMARY'), e(Text, { style: styles.quoteDate }, `Date: ${fmtDate(new Date())}`)),
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
        e(Text, { style: styles.badge }, showPrices ? 'Prices shown' : 'Prices hidden'),
      ),
      ...groups.map((group) => e(AreaTable, { key: group.area, group, showPrices, requestUrl })),
      showPrices ? e(View, { style: styles.totalsWrap },
        e(View, { style: styles.notesBox }, e(Text, { style: styles.label }, 'Remarks'), e(Text, { style: styles.text }, remarks)),
        e(View, { style: styles.totalsBox },
          e(View, { style: styles.totalRow }, e(Text, { style: styles.totalLabel }, 'Subtotal'), e(Text, { style: styles.totalValue }, money(subtotal))),
          e(View, { style: styles.totalRow }, e(Text, { style: styles.totalLabel }, `Discount ${Number(quote.discountPercent || 0)}%`), e(Text, { style: styles.totalValue }, money(discountAmount))),
          e(View, { style: styles.totalRow }, e(Text, { style: styles.totalLabel }, 'GST 18%'), e(Text, { style: styles.totalValue }, money(tax))),
          e(View, { style: [styles.totalRow, styles.grand] }, e(Text, { style: styles.grandText }, 'Total'), e(Text, { style: styles.grandText }, money(total))),
        ),
      ) : e(View, { style: styles.notesBox }, e(Text, { style: styles.label }, 'Selection Summary'), e(Text, { style: styles.text }, 'This PDF is intentionally price-hidden for selection discussion. The office team can generate a priced quotation from the same quote whenever required.')),
      quoteMeta.showBrandLogos === false ? null : e(View, { style: styles.brandStrip },
        e(Text, { style: styles.label }, 'Brands We Serve'),
        e(View, { style: styles.brandGrid },
          ...servedBrands.slice(0, 14).map((name) => {
            const brand = brandMap.get(String(name).toLowerCase());
            const logoUrl = safeJson(brand?.metadata, {}).logoUrl;
            return e(View, { key: name, style: styles.brandChip }, logoUrl ? e(Image, { src: String(logoUrl).startsWith('http') ? logoUrl : new URL(logoUrl, requestUrl).href, style: styles.brandLogo }) : e(Text, { style: styles.brandInitials }, initials(name)));
          }),
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
    ),
  );
}

async function main() {
  const [, , id, requestUrl, apiUrl] = process.argv;
  if (!id || !requestUrl || !apiUrl) throw new Error('Usage: render-quote-pdf.cjs <id> <requestUrl> <apiUrl>');
  const payload = await fetchQuote(id, apiUrl);
  const buffer = await renderToBuffer(buildDocument(payload, requestUrl));
  process.stdout.write(buffer);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
