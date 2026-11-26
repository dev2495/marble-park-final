/* eslint-disable */
const kit = require('./lib/finance-pdf-kit.cjs');
const { React, Document, Page, Text, View, renderToBuffer, styles: s, money, date, embeddedImage, fetchGql, header } = kit;

async function main() {
  const [, , id, requestUrl, apiUrl] = process.argv;
  if (!id || !requestUrl || !apiUrl) throw new Error('Usage: render-customer-statement-pdf.cjs <customerId> <requestUrl> <apiUrl>');
  // Optional ?from=YYYY-MM-DD&to=YYYY-MM-DD on the PDF address picks the period.
  let from = null; let to = null;
  try { const params = new URL(requestUrl).searchParams; from = params.get('from') || null; to = params.get('to') || null; } catch {}
  const data = await fetchGql('query($id: ID!, $from: String, $to: String) { customerAccount(customerId: $id) customerStatement(customerId: $id, from: $from, to: $to, take: 5000) documentSettings { data } }', { id, from, to }, apiUrl);
  const account = data.customerAccount; if (!account) throw new Error('Customer account not found');
  const statement = data.customerStatement || { entries: [], openingBalance: 0, closingBalance: account.summary?.balance || 0, total: 0 };
  const settings = data.documentSettings?.data || {}; settings.logoUrl = await embeddedImage(settings.logoUrl || '/brand/marble-park-logo.png', requestUrl, apiUrl);
  const e = React.createElement;
  const c1 = { width: '13%', fontSize: 7 }, c2 = { width: '15%', fontSize: 7 }, c3 = { width: '33%', fontSize: 7 }, c4 = { width: '13%', fontSize: 7, textAlign: 'right' }, c5 = { width: '13%', fontSize: 7, textAlign: 'right' }, c6 = { width: '13%', fontSize: 7, textAlign: 'right' };
  // Opening balance, every entry in the period oldest first, closing = opening + debits - credits.
  const rows = statement.entries || [];
  const period = [statement.from ? date(statement.from) : 'Start of account', statement.to ? date(new Date(new Date(statement.to).getTime() - 1)) : date(new Date())].join(' to ');
  const document = e(Document, null, e(Page, { size: 'A4', style: s.page },
    e(View, { style: s.rule }), header(e, settings, 'CUSTOMER STATEMENT', account.customer?.name || 'Customer', requestUrl),
    e(View, { style: s.panels },
      e(View, { style: s.panel }, e(Text, { style: s.label }, 'Customer'), e(Text, { style: s.value }, account.customer?.name || 'Customer'), e(Text, { style: s.small }, [account.customer?.siteAddress, account.customer?.city].filter(Boolean).join(', ')), e(Text, { style: s.small }, account.customer?.mobile || '')),
      e(View, { style: s.panel }, e(Text, { style: s.label }, 'Statement period'), e(Text, { style: s.value }, period), e(Text, { style: s.small }, `Opening balance: ${money(statement.openingBalance)}`), e(Text, { style: s.small }, `Debits ${money(statement.totalDebit)} · Credits ${money(statement.totalCredit)}`), e(Text, { style: s.small }, `Open invoices today: ${money(account.summary?.openInvoices)} · Customer credit: ${money(account.summary?.unallocatedCredit)}`)),
    ),
    e(View, { style: s.table }, e(View, { style: [s.tr, s.th], fixed: true }, e(Text, { style: c1 }, 'DATE'), e(Text, { style: c2 }, 'TYPE'), e(Text, { style: c3 }, 'NARRATION'), e(Text, { style: c4 }, 'DEBIT'), e(Text, { style: c5 }, 'CREDIT'), e(Text, { style: c6 }, 'BALANCE')),
      e(View, { style: s.tr, wrap: false }, e(Text, { style: c1 }, ''), e(Text, { style: c2 }, ''), e(Text, { style: c3 }, 'Opening balance'), e(Text, { style: c4 }, ''), e(Text, { style: c5 }, ''), e(Text, { style: c6 }, money(statement.openingBalance))),
      ...rows.map((entry, index) => e(View, { key: entry.id || index, style: s.tr, wrap: false }, e(Text, { style: c1 }, date(entry.effectiveAt)), e(Text, { style: c2 }, entry.sourceLabel || entry.sourceType), e(Text, { style: c3 }, entry.narration || ''), e(Text, { style: c4 }, Number(entry.debit || 0) ? money(entry.debit) : ''), e(Text, { style: c5 }, Number(entry.credit || 0) ? money(entry.credit) : ''), e(Text, { style: c6 }, money(entry.runningBalance)))),
      Number(statement.total || 0) > rows.length ? e(View, { style: s.tr }, e(Text, { style: { ...c3, width: '100%' } }, `Showing the first ${rows.length} of ${statement.total} entries. Choose a shorter period for the rest.`)) : null,
    ),
    e(View, { style: s.total }, e(Text, null, 'Closing balance'), e(Text, null, money(Number(statement.total || 0) > rows.length && rows.length ? rows[rows.length - 1].runningBalance : statement.closingBalance))),
    e(View, { style: s.footer }, e(Text, null, settings.supportPhone || settings.supportEmail || ''), e(Text, { render: ({ pageNumber, totalPages }) => `${pageNumber}/${totalPages}` })),
  ));
  const buffer = await renderToBuffer(document);
  process.stderr.write(`\nMP_DOCUMENT_NUMBER=${JSON.stringify(String(account.customer?.name || ''))}\n`); // names the downloaded file
  process.stdout.write(buffer);
}
main().catch((error) => { console.error(error?.stack || error); process.exit(1); });
