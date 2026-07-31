/* eslint-disable */
const kit = require('./lib/finance-pdf-kit.cjs');
const { React, Document, Page, Text, View, renderToBuffer, styles: s, money, date, embeddedImage, fetchGql, header } = kit;

async function main() {
  const [, , id, requestUrl, apiUrl] = process.argv;
  if (!id || !requestUrl || !apiUrl) throw new Error('Usage: render-customer-receipt-pdf.cjs <id> <requestUrl> <apiUrl>');
  const data = await fetchGql('query($id: ID!) { customerPayment(id: $id) documentSettings { data } }', { id }, apiUrl);
  const payment = data.customerPayment; if (!payment) throw new Error('Receipt not found');
  const settings = data.documentSettings?.data || {}; settings.logoUrl = await embeddedImage(settings.logoUrl || '/brand/marble-park-logo.png', requestUrl, apiUrl);
  const e = React.createElement;
  const c1 = { width: '42%', fontSize: 8 }, c2 = { width: '30%', fontSize: 8 }, c3 = { width: '28%', fontSize: 8, textAlign: 'right' };
  const document = e(Document, null, e(Page, { size: 'A4', style: s.page },
    e(View, { style: s.rule }), header(e, settings, payment.status === 'void' ? 'VOID RECEIPT' : 'PAYMENT RECEIPT', payment.receiptNumber, requestUrl),
    e(View, { style: s.panels },
      e(View, { style: s.panel }, e(Text, { style: s.label }, 'Received from'), e(Text, { style: s.value }, payment.customer?.name || 'Customer'), e(Text, { style: s.small }, payment.customer?.mobile || ''), e(Text, { style: s.small }, payment.customer?.siteAddress || '')),
      e(View, { style: s.panel }, e(Text, { style: s.label }, 'Payment detail'), e(Text, { style: s.value }, money(payment.amount)), e(Text, { style: s.small }, `${String(payment.paymentMode || '').toUpperCase()} · ${payment.moneyAccount || 'bank'}`), e(Text, { style: s.small }, `Received: ${date(payment.receivedAt)}`), payment.reference ? e(Text, { style: s.small }, `Ref: ${payment.reference}`) : null),
    ),
    e(View, { style: s.table }, e(View, { style: [s.tr, s.th] }, e(Text, { style: c1 }, 'ALLOCATED TO'), e(Text, { style: c2 }, 'INVOICE'), e(Text, { style: c3 }, 'AMOUNT')),
      ...(payment.allocations || []).filter((row) => row.status === 'posted').map((allocation, index) => e(View, { key: allocation.id || index, style: s.tr }, e(Text, { style: c1 }, allocation.invoice?.salesOrderId ? `Sales order ${allocation.invoice.salesOrderId}` : 'Customer account'), e(Text, { style: c2 }, allocation.invoice?.invoiceNumber || '-'), e(Text, { style: c3 }, money(allocation.amount)))),
      !(payment.allocations || []).filter((row) => row.status === 'posted').length ? e(View, { style: s.tr }, e(Text, { style: { ...c1, width: '100%' } }, 'Advance held as unallocated customer credit.')) : null,
    ),
    e(View, { style: s.total }, e(Text, null, 'Allocated'), e(Text, null, money(Number(payment.amount || 0) - Number(payment.unappliedAmount || 0)))),
    e(View, { style: { marginTop: 5, marginLeft: 'auto', width: 220, flexDirection: 'row', justifyContent: 'space-between', fontSize: 9 } }, e(Text, null, 'Unallocated credit'), e(Text, null, money(payment.unappliedAmount))),
    e(View, { style: s.note }, e(Text, { style: s.label }, 'Narration'), e(Text, { style: s.small }, payment.notes || 'Payment received and posted to the customer account.')),
    e(View, { style: s.footer }, e(Text, null, settings.supportPhone || settings.supportEmail || ''), e(Text, { render: ({ pageNumber, totalPages }) => `${pageNumber}/${totalPages}` })),
  ));
  process.stdout.write(await renderToBuffer(document));
}
main().catch((error) => { console.error(error?.stack || error); process.exit(1); });
