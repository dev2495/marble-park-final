/* eslint-disable */
const kit = require('./lib/finance-pdf-kit.cjs');
const { React, Document, Page, Text, View, renderToBuffer, styles: s, money, date, embeddedImage, fetchGql, header } = kit;

async function main() {
  const [, , id, requestUrl, apiUrl] = process.argv;
  if (!id || !requestUrl || !apiUrl) throw new Error('Usage: render-sales-invoice-pdf.cjs <id> <requestUrl> <apiUrl>');
  const data = await fetchGql('query($id: ID!) { salesInvoice(id: $id) documentSettings { data } }', { id }, apiUrl);
  const invoice = data.salesInvoice; if (!invoice) throw new Error('Invoice not found');
  const settings = data.documentSettings?.data || {}; settings.logoUrl = await embeddedImage(settings.logoUrl || '/brand/marble-park-logo.png', requestUrl, apiUrl);
  const e = React.createElement;
  const c1 = { width: '7%', fontSize: 7 }, c2 = { width: '22%', fontSize: 7 }, c3 = { width: '35%', fontSize: 7 }, c4 = { width: '12%', fontSize: 7, textAlign: 'right' }, c5 = { width: '12%', fontSize: 7, textAlign: 'right' }, c6 = { width: '12%', fontSize: 7, textAlign: 'right' };
  const document = e(Document, null, e(Page, { size: 'A4', style: s.page },
    e(View, { style: s.rule }), header(e, settings, 'TAX INVOICE', invoice.invoiceNumber, requestUrl),
    e(View, { style: s.panels },
      e(View, { style: s.panel }, e(Text, { style: s.label }, 'Bill to'), e(Text, { style: s.value }, invoice.customer?.name || 'Customer'), e(Text, { style: s.small }, [invoice.customer?.siteAddress, invoice.customer?.city].filter(Boolean).join(', ')), invoice.customer?.gstNo ? e(Text, { style: s.small }, `GSTIN ${invoice.customer.gstNo}`) : null),
      e(View, { style: s.panel }, e(Text, { style: s.label }, 'Order / dispatch'), e(Text, { style: s.value }, invoice.salesOrder?.orderNumber || '-'), e(Text, { style: s.small }, `Invoice date: ${date(invoice.issueDate)}`), e(Text, { style: s.small }, `Due date: ${date(invoice.dueDate)}`)),
    ),
    e(View, { style: s.table },
      e(View, { style: [s.tr, s.th] }, e(Text, { style: c1 }, '#'), e(Text, { style: c2 }, 'SKU / CODE'), e(Text, { style: c3 }, 'DESCRIPTION'), e(Text, { style: c4 }, 'QTY'), e(Text, { style: c5 }, 'RATE'), e(Text, { style: c6 }, 'AMOUNT')),
      ...(invoice.lines || []).map((line, index) => e(View, { key: line.id || index, style: s.tr, wrap: false }, e(Text, { style: c1 }, String(index + 1)), e(Text, { style: c2 }, line.sku || ''), e(Text, { style: c3 }, [line.name, line.brand, line.finish].filter(Boolean).join(' · ')), e(Text, { style: c4 }, `${line.quantity || 0} ${line.unit || 'PC'}`), e(Text, { style: c5 }, money(line.unitPrice)), e(Text, { style: c6 }, money(line.grossLineTotal)))),
    ),
    e(View, { style: s.total }, e(Text, null, 'Taxable value'), e(Text, null, money(invoice.taxableValue))),
    e(View, { style: { marginTop: 5, marginLeft: 'auto', width: 220, flexDirection: 'row', justifyContent: 'space-between', fontSize: 9 } }, e(Text, null, `GST ${Number(invoice.taxAmount || 0) > 0 ? '' : '(not charged)'}`), e(Text, null, money(invoice.taxAmount))),
    e(View, { style: s.total }, e(Text, null, 'Invoice total'), e(Text, null, money(invoice.totalAmount))),
    e(View, { style: s.note }, e(Text, { style: s.label }, 'Terms / note'), e(Text, { style: s.small }, [invoice.paymentTerms || 'Payment due as agreed.', invoice.notes || ''].filter(Boolean).join('\n'))),
    e(View, { style: s.footer }, e(Text, null, settings.supportPhone || settings.supportEmail || ''), e(Text, { render: ({ pageNumber, totalPages }) => `${pageNumber}/${totalPages}` })),
  ));
  process.stdout.write(await renderToBuffer(document));
}
main().catch((error) => { console.error(error?.stack || error); process.exit(1); });
