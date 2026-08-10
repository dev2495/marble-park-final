'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { gql, useMutation, useQuery } from '@apollo/client';
import { Download, Eye, FileSpreadsheet, Plus, Send, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryErrorBanner } from '@/components/query-state';

const QUOTES = gql`
  query QuotesRegister($ownerId: String, $architectId: String, $status: String, $skip: Float, $take: Float) {
    quotes(ownerId: $ownerId, architectId: $architectId, status: $status, skip: $skip, take: $take) {
      id
      quoteNumber
      title
      projectName
      status
      approvalStatus
      createdAt
      validUntil
      sentAt
      confirmedAt
      lines
      customer
      owner
      architectId
      architectName
      architect
    }
    architects(status: "active", take: 200)
    ownerDashboard { stats userPerformance }
  }
`;

const SEND_QUOTE = gql`mutation SendQuote($id: ID!) { sendQuote(id: $id) { id status sentAt } }`;

function money(value: number) {
  return `₹${Math.round(Number(value || 0)).toLocaleString('en-IN')}`;
}

function quoteTotal(lines: any) {
  const rows = Array.isArray(lines) ? lines : [];
  return rows.reduce((sum, line) => sum + Number(line.qty || line.quantity || 0) * Number(line.price || line.sellPrice || 0), 0);
}

function statusClass(status?: string) {
  if (status === 'confirmed' || status === 'won') return 'bg-[#ecfdf5] text-[#059669]';
  if (status === 'sent') return 'bg-[#eff6ff] text-[#1d4ed8]';
  if (status === 'lost' || status === 'expired') return 'bg-red-50 text-red-700';
  return 'bg-white text-[#27272a]';
}

export default function QuotesRegisterPage() {
  const [user, setUser] = useState<any>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('all');
  const [architectId, setArchitectId] = useState('all');
  const [page, setPage] = useState(0);
  const pageSize = 30;

  useEffect(() => {
    try {
      setUser(JSON.parse(localStorage.getItem('user') || 'null'));
    } finally {
      setReady(true);
    }
  }, []);

  const ownerId = user?.role === 'sales' ? user.id : undefined;
  const { data, loading, error, refetch } = useQuery(QUOTES, {
    variables: { ownerId, architectId: architectId === 'all' ? undefined : architectId, status: status === 'all' ? undefined : status, skip: page * pageSize, take: pageSize + 1 },
    skip: !ready,
  });
  const [sendQuote, { loading: sending, error: sendError }] = useMutation(SEND_QUOTE, { onCompleted: () => refetch() });

  const quotePage = useMemo<any[]>(() => data?.quotes || [], [data?.quotes]);
  const quotes = quotePage.slice(0, pageSize);
  const hasNext = quotePage.length > pageSize;

  const architects = useMemo(() => data?.architects || [], [data?.architects]);

  const totals = useMemo(() => {
    const all = quotes;
    return {
      count: all.length,
      sent: all.filter((quote: any) => quote.status === 'sent').length,
      confirmed: all.filter((quote: any) => quote.status === 'confirmed').length,
      value: all.reduce((sum: number, quote: any) => sum + quoteTotal(quote.lines), 0),
    };
  }, [quotes]);

  return (
    <div className="space-y-6 pb-10">
      <section className="grid gap-5 xl:grid-cols-[1fr_0.72fr]">
        <div className="relative overflow-hidden rounded-r6 mp-card bg-white border border-[#e4e4e7] p-6 text-[#18181b]">
          <div className="absolute inset-0 hidden" />
          <div className="relative">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-[#71717a]">Quote register</p>
            <h1 className="mt-3 max-w-4xl font-display text-3xl font-bold leading-tight text-[#18181b] tracking-[-0.055em]">Every quotation, PDF, follow-up and confirmation in one desk.</h1>
            <p className="mt-5 max-w-2xl text-sm text-[#52525b]">Sales users see their own register. Owners and admins see the full store pipeline.</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Button asChild size="lg" className="bg-[#2563eb] text-white hover:bg-[#1d4ed8]"><Link href="/dashboard/quotes/new"><Plus className="mr-2 h-5 w-5" /> New quote</Link></Button>
              <Button asChild variant="outline" size="lg" className="border-[#e4e4e7] bg-white text-[#27272a] hover:bg-[#f4f4f5]"><Link href="/dashboard/sales">Sales desk</Link></Button>
              <Button asChild variant="outline" size="lg" className="border-[#e4e4e7] bg-white text-[#27272a] hover:bg-[#f4f4f5]"><Link href="/dashboard/approvals">Approvals</Link></Button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {[
            ['Visible quotes', totals.count],
            ['Sent', totals.sent],
            ['Confirmed', totals.confirmed],
            ['Pipeline value', money(totals.value)],
          ].map(([label, value]) => (
            <div key={label} className="mp-card rounded-r5 p-5">
              <FileSpreadsheet className="h-6 w-6 text-[#2563eb]" />
              <div className="mt-5 text-2xl font-semibold tracking-[-0.01em] text-[#18181b]">{loading ? '...' : value}</div>
              <div className="mt-1 text-xs font-medium uppercase tracking-widest text-[#52525b]">{label}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="mp-card rounded-r5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {['all', 'draft', 'sent', 'confirmed', 'lost'].map((item) => (
              <button key={item} onClick={() => { setStatus(item); setPage(0); }} className={`rounded-2xl px-4 py-2 text-xs font-black uppercase tracking-wider ${status === item ? 'bg-[#18181b] text-white' : 'bg-white/75 text-[#27272a]'}`}>{item}</button>
            ))}
            <label className="ml-1 flex items-center gap-2 rounded-2xl border border-[#e4e4e7] bg-white px-3 py-1.5 text-xs font-black uppercase tracking-wider text-[#52525b]">
              Architect
              <select
                value={architectId}
                onChange={(e) => { setArchitectId(e.target.value); setPage(0); }}
                className="max-w-[14rem] bg-transparent text-xs font-black normal-case tracking-normal text-[#18181b] outline-none"
              >
                <option value="all">All architects</option>
                {architects.map((architect: any) => (
                  <option key={architect.id} value={architect.id}>{architect.name}</option>
                ))}
              </select>
            </label>
          </div>
          <Button asChild><Link href="/dashboard/quotes/new"><Plus className="mr-2 h-4 w-4" /> Build quote</Link></Button>
        </div>
      </section>

      {error ? (
        <QueryErrorBanner error={error} onRetry={() => refetch()} />
      ) : null}
      {sendError ? <QueryErrorBanner error={sendError} /> : null}

      <section className="overflow-hidden rounded-r5 border border-[#e4e4e7]/10 bg-white/80 shadow-xl shadow-[#475569]/8">
        <div className="hidden grid-cols-[1.2fr_1fr_0.9fr_0.72fr_0.55fr_1.25fr] gap-4 border-b border-[#e4e4e7]/10 bg-[#eff6ff]/75 px-5 py-4 text-xs font-medium uppercase tracking-widest text-[#52525b] lg:grid">
          <div>Quote</div><div>Customer</div><div>Architect</div><div>Status</div><div className="text-right">Value</div><div className="text-right">Actions</div>
        </div>
        <div className="divide-y divide-[#cbd5e1]/10">
          {loading && <div className="p-10 text-center text-sm font-bold text-[#52525b]" role="status" aria-live="polite">Loading quotes...</div>}
          {!loading && !error && quotes.length === 0 && <div className="p-10 text-center text-sm font-bold text-[#52525b]">No quotes in this filter.</div>}
          {quotes.map((quote: any) => {
            const value = quoteTotal(quote.lines);
            const pdfHref = `/api/pdf/quote/${quote.id}`;
            return (
              <article key={quote.id} className="grid gap-4 p-5 lg:grid-cols-[1.2fr_1fr_0.9fr_0.72fr_0.55fr_1.25fr] lg:items-center">
                <div>
                  <Link href={`/dashboard/quotes/${quote.id}`} className="text-lg font-semibold text-[#18181b] hover:underline">{quote.quoteNumber}</Link>
                  <p className="mt-1 line-clamp-1 text-sm font-bold text-[#52525b]">{quote.title || quote.projectName || 'Retail quotation'}</p>
                  <p className="mt-1 text-xs font-medium uppercase tracking-wider text-[#71717a]">{quote.owner?.name || 'Unassigned'}</p>
                </div>
                <div>
                  <p className="font-semibold text-[#18181b]">{quote.customer?.name || 'Customer'}</p>
                  <p className="mt-1 text-xs font-bold text-[#52525b]">{quote.customer?.siteAddress || quote.customer?.city || 'Site pending'}</p>
                </div>
                <div>
                  <p className="font-semibold text-[#18181b]">{quote.architectName || quote.architect?.name || '—'}</p>
                  {quote.architect?.firmName ? <p className="mt-1 text-xs font-bold text-[#52525b]">{quote.architect.firmName}</p> : null}
                </div>
                <div><span className={`rounded-full px-3 py-1.5 text-xs font-medium uppercase tracking-wider ${statusClass(quote.status)}`}>{quote.status}</span></div>
                <div className="text-right text-xl font-semibold text-[#18181b]">{money(value)}</div>
                <div className="flex flex-wrap justify-start gap-2 lg:justify-end">
                  <Button asChild variant="outline" size="sm"><Link href={`/dashboard/quotes/${quote.id}`}><Eye className="mr-2 h-4 w-4" /> View</Link></Button>
                  <Button asChild variant="outline" size="sm"><a href={pdfHref} target="_blank" rel="noreferrer"><Download className="mr-2 h-4 w-4" /> PDF</a></Button>
                  {quote.status !== 'sent' && quote.status !== 'confirmed' && <Button disabled={sending} onClick={() => sendQuote({ variables: { id: quote.id } })} variant="warning" size="sm"><Send className="mr-2 h-4 w-4" /> Send</Button>}
                  {quote.status !== 'confirmed' && <Button asChild size="sm"><Link href={`/dashboard/quotes/${quote.id}`}><ShieldCheck className="mr-2 h-4 w-4" /> Convert to SO</Link></Button>}
                </div>
              </article>
            );
          })}
        </div>
      </section>
      <div className="flex items-center justify-between"><Button variant="outline" disabled={page === 0 || loading} onClick={() => setPage((value) => Math.max(0, value - 1))}>Previous</Button><span className="text-xs font-bold uppercase tracking-wider text-[#71717a]">Quote page {page + 1}</span><Button variant="outline" disabled={!hasNext || loading} onClick={() => setPage((value) => value + 1)}>Next</Button></div>
    </div>
  );
}
