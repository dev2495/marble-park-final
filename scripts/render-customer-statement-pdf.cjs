/* eslint-disable */
const kit = require('./lib/finance-pdf-kit.cjs');
const { React, Document, Page, Text, View, renderToBuffer, styles: s, money, date, embeddedImage, fetchGql, header } = kit;

async function main() {
  const [, , id, requestUrl, apiUrl] = process.argv;
  if (!id || !requestUrl || !apiUrl) throw new Error('Usage: render-customer-statement-pdf.cjs <customerId> <requestUrl> <apiUrl>');
  const data = await fetchGql('query($id: ID!) { customerAccount(customerId: $id) documentSettings { data } }', { id }, apiUrl);
  const account = data.customerAccount; if (!account) throw new Error('Customer account not found');
  const settings = data.documentSettings?.data || {}; settings.logoUrl = await embeddedImage(settings.logoUrl || '/brand/marble-park-logo.png', requestUrl, apiUrl);
  const e = React.createElement;
  const c1 = { width: '16%', fontSize: 7 }, c2 = { width: '18%', fontSize: 7 }, c3 = { width: '38%', fontSize: 7 }, c4 = { width: '14%', fontSize: 7, textAlign: 'right' }, c5 = { width: '14%', fontSize: 7, textAlign: 'right' };
  let running = 0;
  const rows = [...(account.ledger || [])].reverse().map((entry) => { running += Number(entry.debit || 0) - Number(entry.credit || 0); return { ...entry, running }; });
  const document = e(Document, null, e(Page, { size: 'A4', style: s.page },
    e(View, { style: s.rule }), header(e, settings, 'CUSTOMER STATEMENT', account.customer?.name || 'Customer', requestUrl),
    e(View, { style: s.panels },
      e(View, { style: s.panel }, e(Text, { style: s.label }, 'Customer'), e(Text, { style: s.value }, account.customer?.name || 'Customer'), e(Text, { style: s.small }, [account.customer?.siteAddress, account.customer?.city].filter(Boolean).join(', ')), e(Text, { style: s.small }, account.customer?.mobile || '')),
      e(View, { style: s.panel }, e(Text, { style: s.label }, 'Account position'), e(Text, { style: s.value }, money(account.summary?.balance)), e(Text, { style: s.small }, `Open invoices: ${money(account.summary?.openInvoices)}`), e(Text, { style: s.small }, `Available customer credit: ${money(account.summary?.unallocatedCredit)}`)),
    ),
    e(View, { style: s.table }, e(View, { style: [s.tr, s.th] }, e(Text, { style: c1 }, 'DATE'), e(Text, { style: c2 }, 'TYPE'), e(Text, { style: c3 }, 'NARRATION'), e(Text, { style: c4 }, 'DEBIT'), e(Text, { style: c5 }, 'CREDIT')),
      ...rows.map((entry, index) => e(View, { key: entry.id || index, style: s.tr, wrap: false }, e(Text, { style: c1 }, date(entry.effectiveAt)), e(Text, { style: c2 }, entry.sourceLabel || entry.sourceType), e(Text, { style: c3 }, entry.narration || ''), e(Text, { style: c4 }, Number(entry.debit || 0) ? money(entry.debit) : ''), e(Text, { style: c5 }, Number(entry.credit || 0) ? money(entry.credit) : ''))),
    ),
    e(View, { style: s.total }, e(Text, null, 'Closing balance'), e(Text, null, money(account.summary?.balance))),
    e(View, { style: s.footer }, e(Text, null, settings.supportPhone || settings.supportEmail || ''), e(Text, { render: ({ pageNumber, totalPages }) => `${pageNumber}/${totalPages}` })),
  ));
  process.stdout.write(await renderToBuffer(document));
}
main().catch((error) => { console.error(error?.stack || error); process.exit(1); });
