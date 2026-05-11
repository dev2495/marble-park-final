'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { gql, useMutation, useQuery } from '@apollo/client';
import { Download, Eye, FileSpreadsheet, Plus, Send, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryErrorBanner } from '@/components/query-state';

const QUOTES = gql`
  query QuotesRegister($ownerId: String) {
    quotes(ownerId: $ownerId) {
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
    }
    ownerDashboard { stats userPerformance }
  }
`;

const SEND_QUOTE = gql`mutation SendQuote($id: ID!) { sendQuote(id: $id) { id status sentAt } }`;
const CONFIRM_QUOTE = gql`mutation ConfirmQuote($id: ID!) { confirmQuote(id: $id) { id status confirmedAt } }`;

function money(value: number) {
  return `₹${Math.round(Number(value || 0)).toLocaleString('en-IN')}`;
}

function quoteTotal(lines: any) {
  const rows = Array.isArray(lines) ? lines : [];
  return rows.reduce((sum, line) => sum + Number(line.qty || line.quantity || 0) * Number(line.price || line.sellPrice || 0), 0);
}

function statusClass(status?: string) {
  if (status === 'confirmed' || status === 'won') return 'bg-[#ecfdf5] text-[#047857]';
  if (status === 'sent') return 'bg-[#dbeafe] text-[#1d4ed8]';
  if (status === 'lost' || status === 'expired') return 'bg-red-50 text-red-700';
  return 'bg-white text-[#1e293b]';
}

export default function QuotesRegisterPage() {
  const [user, setUser] = useState<any>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('all');

  useEffect(() => {
    try {
      setUser(JSON.parse(localStorage.getItem('user') || 'null'));
    } finally {
      setReady(true);
    }
  }, []);

  const ownerId = user?.role === 'sales' ? user.id : undefined;
  const { data, loading, error, refetch } = useQuery(QUOTES, { variables: { ownerId }, skip: !ready });
  const [sendQuote, { loading: sending, error: sendError }] = useMutation(SEND_QUOTE, { onCompleted: () => refetch() });
  const [confirmQuote, { loading: confirming, error: confirmError }] = useMutation(CONFIRM_QUOTE, { onCompleted: () => refetch() });

  const quotes = useMemo(() => {
    const rows = data?.quotes || [];
    if (status === 'all') return rows;
    return rows.filter((quote: any) => quote.status === status);
  }, [data, status]);

  const totals = useMemo(() => {
    const all = data?.quotes || [];
    return {
      count: all.length,
      sent: all.filter((quote: any) => quote.status === 'sent').length,
      confirmed: all.filter((quote: any) => quote.status === 'confirmed').length,
      value: all.reduce((sum: number, quote: any) => sum + quoteTotal(quote.lines), 0),
    };
  }, [data]);

  return (
    <div className="space-y-6 pb-10">
      <section className="grid gap-5 xl:grid-cols-[1fr_0.72fr]">
        <div className="relative overflow-hidden rounded-[2.25rem] bg-[#0e1a3d] p-7 text-white shadow-2xl shadow-[#0e1a3d]/15">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(59,130,246,0.40),transparent_28%),radial-gradient(circle_at_86%_35%,rgba(99,102,241,0.32),transparent_30%)]" />
          <div className="relative">
            <p className="text-[10px] font-black uppercase tracking-[0.28em] text-[#bfdbfe]">Quote register</p>
            <h1 className="mt-3 max-w-4xl text-5xl font-black leading-[0.95] tracking-[-0.055em]">Every quotation, PDF, follow-up and confirmation in one desk.</h1>
            <p className="mt-5 max-w-2xl text-sm font-semibold leading-6 text-[#dbeafe]">Sales users see their own register. Owners and admins see the full store pipeline.</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Button asChild size="lg" className="bg-[#ffffff] text-[#0e1a3d] hover:bg-white"><Link href="/dashboard/quotes/new"><Plus className="mr-2 h-5 w-5" /> New quote</Link></Button>
              <Button asChild variant="outline" size="lg" className="border-white/15 bg-white/10 text-white hover:bg-white/15"><Link href="/dashboard/sales">Sales desk</Link></Button>
              <Button asChild variant="outline" size="lg" className="border-white/15 bg-white/10 text-white hover:bg-white/15"><Link href="/dashboard/approvals">Approvals</Link></Button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {[
            ['Quotes', totals.count],
            ['Sent', totals.sent],
            ['Confirmed', totals.confirmed],
            ['Pipeline value', money(totals.value)],
          ].map(([label, value]) => (
            <div key={label} className="mp-card rounded-[2rem] p-5">
              <FileSpreadsheet className="h-6 w-6 text-[#2563eb]" />
              <div className="mt-5 text-3xl font-black tracking-[-0.04em] text-[#0e1a3d]">{loading ? '...' : value}</div>
              <div className="mt-1 text-[10px] font-black uppercase tracking-widest text-[#475569]">{label}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="mp-card rounded-[2rem] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {['all', 'draft', 'sent', 'confirmed', 'lost'].map((item) => (
              <button key={item} onClick={() => setStatus(item)} className={`rounded-2xl px-4 py-2 text-xs font-black uppercase tracking-wider ${status === item ? 'bg-[#0e1a3d] text-white' : 'bg-white/75 text-[#1e293b]'}`}>{item}</button>
            ))}
          </div>
          <Button asChild><Link href="/dashboard/quotes/new"><Plus className="mr-2 h-4 w-4" /> Build quote</Link></Button>
        </div>
      </section>

      {error ? (
        <QueryErrorBanner error={error} onRetry={() => refetch()} />
      ) : null}
      {sendError ? <QueryErrorBanner error={sendError} /> : null}
      {confirmError ? <QueryErrorBanner error={confirmError} /> : null}

      <section className="overflow-hidden rounded-[2rem] border border-[#cbd5e1]/10 bg-[#ffffff]/80 shadow-xl shadow-[#475569]/8">
        <div className="hidden grid-cols-[1.2fr_1fr_0.72fr_0.55fr_1.25fr] gap-4 border-b border-[#cbd5e1]/10 bg-[#dbeafe]/75 px-5 py-4 text-[10px] font-black uppercase tracking-widest text-[#475569] lg:grid">
          <div>Quote</div><div>Customer</div><div>Status</div><div className="text-right">Value</div><div className="text-right">Actions</div>
        </div>
        <div className="divide-y divide-[#cbd5e1]/10">
          {loading && <div className="p-10 text-center text-sm font-bold text-[#475569]" role="status" aria-live="polite">Loading quotes...</div>}
          {!loading && !error && quotes.length === 0 && <div className="p-10 text-center text-sm font-bold text-[#475569]">No quotes in this filter.</div>}
          {quotes.map((quote: any) => {
            const value = quoteTotal(quote.lines);
            const pdfHref = `/api/pdf/quote/${quote.id}`;
            return (
              <article key={quote.id} className="grid gap-4 p-5 lg:grid-cols-[1.2fr_1fr_0.72fr_0.55fr_1.25fr] lg:items-center">
                <div>
                  <Link href={`/dashboard/quotes/${quote.id}`} className="text-lg font-black text-[#0e1a3d] hover:underline">{quote.quoteNumber}</Link>
                  <p className="mt-1 line-clamp-1 text-sm font-bold text-[#475569]">{quote.title || quote.projectName || 'Retail quotation'}</p>
                  <p className="mt-1 text-[10px] font-black uppercase tracking-wider text-[#94a3b8]">{quote.owner?.name || 'Unassigned'}</p>
                </div>
                <div>
                  <p className="font-black text-[#0e1a3d]">{quote.customer?.name || 'Customer'}</p>
                  <p className="mt-1 text-xs font-bold text-[#475569]">{quote.customer?.siteAddress || quote.customer?.city || 'Site pending'}</p>
                </div>
                <div><span className={`rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-wider ${statusClass(quote.status)}`}>{quote.status}</span></div>
                <div className="text-right text-xl font-black text-[#0e1a3d]">{money(value)}</div>
                <div className="flex flex-wrap justify-start gap-2 lg:justify-end">
                  <Button asChild variant="outline" size="sm"><Link href={`/dashboard/quotes/${quote.id}`}><Eye className="mr-2 h-4 w-4" /> View</Link></Button>
                  <Button asChild variant="outline" size="sm"><a href={pdfHref} target="_blank" rel="noreferrer"><Download className="mr-2 h-4 w-4" /> PDF</a></Button>
                  {quote.approvalStatus === 'pending' && <Button asChild variant="outline" size="sm"><Link href="/dashboard/approvals">Needs owner approval</Link></Button>}
                  {quote.status !== 'sent' && quote.status !== 'confirmed' && quote.approvalStatus !== 'pending' && <Button disabled={sending} onClick={() => sendQuote({ variables: { id: quote.id } })} variant="warning" size="sm"><Send className="mr-2 h-4 w-4" /> Send</Button>}
                  {quote.status !== 'confirmed' && quote.approvalStatus !== 'pending' && <Button disabled={confirming} onClick={() => confirmQuote({ variables: { id: quote.id } })} size="sm"><ShieldCheck className="mr-2 h-4 w-4" /> Confirm</Button>}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
