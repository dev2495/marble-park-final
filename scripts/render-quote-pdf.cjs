const React = require('react');
const { Document, Page, Text, View, StyleSheet, Image, renderToBuffer } = require('@react-pdf/renderer');

const styles = StyleSheet.create({
  page: {
    flexDirection: 'column',
    backgroundColor: '#fffaf3',
    padding: 34,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottomWidth: 2,
    borderBottomColor: '#211b16',
    paddingBottom: 18,
    marginBottom: 18,
  },
  brand: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#211b16',
    letterSpacing: 1.5,
  },
  subBrand: {
    marginTop: 4,
    fontSize: 9,
    color: '#8b6b4c',
    letterSpacing: 2.6,
  },
  title: {
    fontSize: 25,
    color: '#211b16',
    textAlign: 'right',
    fontWeight: 'bold',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  panel: {
    width: '48%',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#ead7c0',
    borderRadius: 14,
    padding: 13,
  },
  label: {
    fontSize: 8,
    color: '#8b6b4c',
    textTransform: 'uppercase',
    letterSpacing: 1.4,
    fontWeight: 'bold',
  },
  value: {
    marginTop: 4,
    fontSize: 12,
    color: '#211b16',
    fontWeight: 'bold',
  },
  muted: {
    marginTop: 4,
    fontSize: 9,
    color: '#5f4b3b',
  },
  table: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#ead7c0',
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#ffffff',
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#ead7c0',
    padding: 8,
  },
  tableRow: {
    flexDirection: 'row',
    minHeight: 78,
    padding: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f2e4d3',
  },
  imageCol: { width: '16%' },
  image: {
    width: 58,
    height: 58,
    objectFit: 'contain',
    borderRadius: 8,
    backgroundColor: '#f3eadf',
  },
  descCol: { width: '34%', paddingRight: 8 },
  qtyCol: { width: '14%', textAlign: 'center' },
  rateCol: { width: '18%', textAlign: 'right' },
  amountCol: { width: '18%', textAlign: 'right' },
  th: {
    fontSize: 8,
    color: '#5f4b3b',
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  td: {
    fontSize: 10,
    color: '#211b16',
  },
  sku: {
    marginTop: 4,
    fontSize: 8,
    color: '#8b6b4c',
    letterSpacing: 0.7,
  },
  totals: {
    marginTop: 18,
    alignItems: 'flex-end',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '42%',
    paddingVertical: 5,
  },
  grandTotal: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#211b16',
  },
  footer: {
    position: 'absolute',
    bottom: 25,
    left: 34,
    right: 34,
    textAlign: 'center',
    color: '#8b6b4c',
    fontSize: 8,
    borderTopWidth: 1,
    borderTopColor: '#ead7c0',
    paddingTop: 10,
  },
});

function money(value) {
  return `₹${Math.round(Number(value || 0)).toLocaleString('en-IN')}`;
}

function mediaImage(media, requestUrl) {
  const fallback = '/catalogue-art/faucet.svg';
  const raw = typeof media === 'string' ? (() => {
    try {
      return JSON.parse(media);
    } catch {
      return { primary: media };
    }
  })() : media;
  const src = raw?.primary || raw?.gallery?.[0] || fallback;
  return src.startsWith('http') ? src : new URL(src, requestUrl).href;
}

async function fetchQuote(id, apiUrl) {
  try {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    const quote = await prisma.quote.findUnique({ where: { id }, include: { customer: true } });
    await prisma.$disconnect();
    if (quote) return quote;
  } catch (error) {
    // Fall back to GraphQL for environments where Prisma is unavailable to the renderer.
  }

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query: `query QuoteForPdf($id: ID!) {
        quote(id: $id) {
          id
          quoteNumber
          title
          projectName
          validUntil
          lines
          customer
        }
      }`,
      variables: { id },
    }),
  });
  const payload = await response.json();
  if (!response.ok || payload.errors?.length || !payload.data?.quote) {
    throw new Error(payload.errors?.[0]?.message || 'Quote not found');
  }
  return payload.data.quote;
}

function buildDocument(quote, requestUrl) {
  const e = React.createElement;
  const lines = Array.isArray(quote.lines) ? quote.lines : [];
  const subtotal = lines.reduce((sum, line) => {
    const qty = Number(line.qty || line.quantity || 0);
    const price = Number(line.price || line.sellPrice || 0);
    return sum + qty * price;
  }, 0);
  const tax = subtotal * 0.18;
  const total = subtotal + tax;

  return e(
    Document,
    null,
    e(
      Page,
      { size: 'A4', style: styles.page },
      e(
        View,
        { style: styles.header },
        e(View, null, e(Text, { style: styles.brand }, 'MARBLE PARK'), e(Text, { style: styles.subBrand }, 'RETAIL OPS')),
        e(View, null, e(Text, { style: styles.title }, 'QUOTATION'), e(Text, { style: styles.muted }, `Date: ${new Date().toLocaleDateString()}`)),
      ),
      e(
        View,
        { style: styles.row },
        e(
          View,
          { style: styles.panel },
          e(Text, { style: styles.label }, 'Quotation To'),
          e(Text, { style: styles.value }, quote.customer?.name || 'Premium Client'),
          e(Text, { style: styles.muted }, quote.customer?.siteAddress || 'Site Address Not Provided'),
        ),
        e(
          View,
          { style: styles.panel },
          e(Text, { style: styles.label }, 'Quote Reference'),
          e(Text, { style: styles.value }, quote.quoteNumber || 'QT/2026/XXX'),
          e(Text, { style: { ...styles.label, marginTop: 9 } }, 'Valid Until'),
          e(Text, { style: styles.value }, quote.validUntil ? new Date(quote.validUntil).toLocaleDateString() : '30 Days from issue'),
        ),
      ),
      e(
        View,
        { style: styles.table },
        e(
          View,
          { style: styles.tableHeader },
          e(Text, { style: { ...styles.th, ...styles.imageCol } }, 'Image'),
          e(Text, { style: { ...styles.th, ...styles.descCol } }, 'Description'),
          e(Text, { style: { ...styles.th, ...styles.qtyCol } }, 'Qty'),
          e(Text, { style: { ...styles.th, ...styles.rateCol } }, 'Unit Price'),
          e(Text, { style: { ...styles.th, ...styles.amountCol } }, 'Total'),
        ),
        ...lines.map((line, index) => {
          const qty = Number(line.qty || line.quantity || 0);
          const price = Number(line.price || line.sellPrice || 0);
          return e(
            View,
            { key: index, style: styles.tableRow },
            e(View, { style: styles.imageCol }, e(Image, { src: mediaImage(line.media, requestUrl), style: styles.image })),
            e(View, { style: styles.descCol }, e(Text, { style: styles.td }, line.name || 'Product'), e(Text, { style: styles.sku }, line.sku || '')),
            e(Text, { style: { ...styles.td, ...styles.qtyCol } }, `${qty} ${line.unit || 'PC'}`),
            e(Text, { style: { ...styles.td, ...styles.rateCol } }, money(price)),
            e(Text, { style: { ...styles.td, ...styles.amountCol } }, money(qty * price)),
          );
        }),
      ),
      e(
        View,
        { style: styles.totals },
        e(View, { style: styles.totalRow }, e(Text, { style: styles.td }, 'Subtotal'), e(Text, { style: styles.td }, money(subtotal))),
        e(View, { style: styles.totalRow }, e(Text, { style: styles.td }, 'GST 18%'), e(Text, { style: styles.td }, money(tax))),
        e(
          View,
          { style: { ...styles.totalRow, borderTopWidth: 2, borderTopColor: '#211b16', marginTop: 5, paddingTop: 6 } },
          e(Text, { style: styles.grandTotal }, 'Total'),
          e(Text, { style: styles.grandTotal }, money(total)),
        ),
      ),
      e(Text, { style: styles.footer }, 'Thank you for choosing Marble Park. For inquiries, contact support@marblepark.in'),
    ),
  );
}

async function main() {
  const [, , id, requestUrl, apiUrl] = process.argv;
  if (!id || !requestUrl || !apiUrl) throw new Error('Usage: render-quote-pdf.cjs <id> <requestUrl> <apiUrl>');
  const quote = await fetchQuote(id, apiUrl);
  const buffer = await renderToBuffer(buildDocument(quote, requestUrl));
  process.stdout.write(buffer);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
