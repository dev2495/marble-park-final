/* eslint-disable */
const kit = require('./lib/finance-pdf-kit.cjs');
const { React, Document, Page, Text, View, renderToBuffer, styles: s, money, date, embeddedImage, fetchGql, header } = kit;
const { formatBoxQuantity } = require('../packages/pricing-contract/box-quantity');

// A boxed tile is billed in pieces (rate per piece, amount unchanged); it reads
// in boxes like the order: "38 BOX" with "380 pc" beneath.
function invoiceQty(line) {
  const qty = formatBoxQuantity(line.quantity || 0, { unit: line.unit || 'PC', piecesPerUnit: Number(line.piecesPerUnit || 1), piecesPerBox: line.piecesPerBox, soldBy: line.soldBy });
  if (!qty.isBoxed) return `${line.quantity || 0} ${line.unit || 'PC'}`;
  return `${qty.boxes}${qty.loosePieces ? ` + ${qty.loosePieces} pc` : ''} ${qty.unitLabel}\n${qty.piecesLabel}`;
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

async function main() {
  const [, , id, requestUrl, apiUrl] = process.argv;
  if (!id || !requestUrl || !apiUrl) throw new Error('Usage: render-sales-invoice-pdf.cjs <id> <requestUrl> <apiUrl>');
  const data = await fetchGql('query($id: ID!) { salesInvoice(id: $id) documentSettings { data } }', { id }, apiUrl);
  const invoice = data.salesInvoice; if (!invoice) throw new Error('Invoice not found');
  const settings = data.documentSettings?.data || {}; settings.logoUrl = await embeddedImage(settings.logoUrl || '/brand/marble-park-logo.png', requestUrl, apiUrl);
  const e = React.createElement;
  // Settings > "Show GST split on invoices". Off (default): the invoice prints exactly as before.
  const split = invoice.gstSplit && invoice.gstSplit.enabled ? invoice.gstSplit : null;
  const baseTitle = split ? split.documentTitle : 'TAX INVOICE';
  const title = invoice.status === 'void' ? `VOID ${baseTitle}` : baseTitle;
  const c1 = { width: '7%', fontSize: 7 }, c2 = { width: '22%', fontSize: 7, paddingRight: 8 }, c3 = { width: split ? '25%' : '35%', fontSize: 7, paddingRight: 8 }, cH = { width: '10%', fontSize: 7 }, c4 = { width: '12%', fontSize: 7, textAlign: 'right' }, c5 = { width: '12%', fontSize: 7, textAlign: 'right' }, c6 = { width: '12%', fontSize: 7, textAlign: 'right' };
  const smallTotal = { marginTop: 5, marginLeft: 'auto', width: 220, flexDirection: 'row', justifyContent: 'space-between', fontSize: 9 };
  const taxRows = !split
    ? [e(View, { key: 'gst', style: smallTotal }, e(Text, null, `GST ${Number(invoice.taxAmount || 0) > 0 ? '' : '(not charged)'}`), e(Text, null, money(invoice.taxAmount)))]
    : split.withoutGst
      ? [e(View, { key: 'gst', style: smallTotal }, e(Text, null, 'GST (not charged)'), e(Text, null, money(0)))]
      : split.interState
        ? [e(View, { key: 'igst', style: smallTotal }, e(Text, null, 'IGST'), e(Text, null, money(split.igst)))]
        : [e(View, { key: 'cgst', style: smallTotal }, e(Text, null, 'CGST'), e(Text, null, money(split.cgst))), e(View, { key: 'sgst', style: smallTotal }, e(Text, null, 'SGST'), e(Text, null, money(split.sgst)))];
  const hsnById = new Map(((split && split.lines) || []).map((row) => [row.id, row.hsnCode]));
  const document = e(Document, null, e(Page, { size: 'A4', style: s.page },
    e(View, { style: s.rule }), header(e, settings, title, invoice.invoiceNumber, requestUrl),
    e(View, { style: s.panels },
      e(View, { style: s.panel }, e(Text, { style: s.label }, 'Bill to'), e(Text, { style: s.value }, invoice.customer?.name || 'Customer'), e(Text, { style: s.small }, [invoice.customer?.siteAddress, invoice.customer?.city].filter(Boolean).join(', ')), invoice.customer?.gstNo ? e(Text, { style: s.small }, `GSTIN ${invoice.customer.gstNo}`) : null, split && split.placeOfSupply ? e(Text, { style: s.small }, `Place of supply: ${split.placeOfSupply} (${split.placeOfSupplyCode})`) : null),
      e(View, { style: s.panel }, e(Text, { style: s.label }, 'Order / dispatch'), e(Text, { style: s.value }, invoice.salesOrder?.orderNumber || '-'), e(Text, { style: s.small }, `Invoice date: ${date(invoice.issueDate)}`), e(Text, { style: s.small }, `Due date: ${date(invoice.dueDate)}`), invoice.status === 'void' ? e(Text, { style: s.small }, `Voided: ${date(invoice.voidedAt)}${invoice.metadata?.voidReason ? ` · ${invoice.metadata.voidReason}` : ''}`) : null),
    ),
    e(View, { style: s.table },
      e(View, { style: [s.tr, s.th] }, e(Text, { style: c1 }, '#'), e(Text, { style: c2 }, 'SKU / CODE'), e(Text, { style: c3 }, 'DESCRIPTION'), split ? e(Text, { style: cH }, 'HSN') : null, e(Text, { style: c4 }, 'QTY'), e(Text, { style: c5 }, 'RATE'), e(Text, { style: c6 }, 'AMOUNT')),
      ...(invoice.lines || []).map((line, index) => e(View, { key: line.id || index, style: s.tr, wrap: false }, e(Text, { style: c1 }, String(index + 1)), e(Text, { style: c2, hyphenationCallback: codeBreaks }, breakable(line.sku || '')), e(Text, { style: c3 }, [line.name, line.brand, line.finish].filter(Boolean).join(' · ')), split ? e(Text, { style: cH }, hsnById.get(line.id) || line.hsnCode || '-') : null, e(Text, { style: c4 }, invoiceQty(line)), e(Text, { style: c5 }, (Number(line.piecesPerUnit || 1) > 1 || line.soldBy) ? `${money(line.unitPrice)}\n/pc` : money(line.unitPrice)), e(Text, { style: c6 }, money(line.grossLineTotal)))),
    ),
    e(View, { style: s.total }, e(Text, null, 'Taxable value'), e(Text, null, money(invoice.taxableValue))),
    ...taxRows,
    e(View, { style: s.total }, e(Text, null, 'Invoice total'), e(Text, null, money(invoice.totalAmount))),
    e(View, { style: s.note }, e(Text, { style: s.label }, 'Terms / note'), e(Text, { style: s.small }, [invoice.paymentTerms || 'Payment due as agreed.', invoice.notes || ''].filter(Boolean).join('\n'))),
    e(View, { style: s.footer }, e(Text, null, settings.supportPhone || settings.supportEmail || ''), e(Text, { render: ({ pageNumber, totalPages }) => `${pageNumber}/${totalPages}` })),
  ));
  const buffer = await renderToBuffer(document);
  process.stderr.write(`\nMP_DOCUMENT_NUMBER=${JSON.stringify(String(invoice.invoiceNumber || ''))}\n`); // names the downloaded file
  process.stdout.write(buffer);
}
main().catch((error) => { console.error(error?.stack || error); process.exit(1); });
