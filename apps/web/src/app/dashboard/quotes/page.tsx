'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { gql, useMutation, useQuery } from '@apollo/client';
import { ArrowDownAZ, CalendarClock, Download, Eye, FileSpreadsheet, Plus, Search, Send, ShieldCheck, SlidersHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QueryErrorBanner } from '@/components/query-state';

const QUOTE_REGISTER = gql`
  query QuoteRegister(
    $search: String, $customerSearch: String, $ownerSearch: String, $ownerId: String,
    $architectId: String, $status: String, $dateFrom: DateTime, $dateTo: DateTime,
    $sort: String, $skip: Float, $take: Float
  ) {
    quotePage(search: $search, customerSearch: $customerSearch, ownerSearch: $ownerSearch, ownerId: $ownerId, architectId: $architectId, status: $status, dateFrom: $dateFrom, dateTo: $dateTo, sort: $sort, skip: $skip, take: $take)
    architects(status: "active", take: 200)
  }
`;

const SEND_QUOTE = gql`mutation SendQuote($id: ID!) { sendQuote(id: $id) { id status sentAt } }`;

function money(value: number) {
  return `₹${Math.round(Number(value || 0)).toLocaleString('en-IN')}`;
}

function statusClass(status?: string) {
  if (status === 'confirmed' || status === 'won') return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  if (status === 'sent') return 'bg-blue-50 text-blue-700 ring-blue-200';
  if (status === 'lost' || status === 'expired' || status === 'cancelled') return 'bg-red-50 text-red-700 ring-red-200';
  if (status === 'incomplete_pricing' || status === 'pending_approval') return 'bg-amber-50 text-amber-800 ring-amber-200';
  return 'bg-zinc-50 text-zinc-700 ring-zinc-200';
}

function dateValue(value?: string) {
  return value ? new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}

export default function QuotesRegisterPage() {
  const [user, setUser] = useState<any>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('all');
  const [architectId, setArchitectId] = useState('all');
  const [search, setSearch] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [ownerSearch, setOwnerSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sort, setSort] = useState('newest');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => {
    try { setUser(JSON.parse(localStorage.getItem('user') || 'null')); } finally { setReady(true); }
  }, []);

  const ownerId = user?.role === 'sales' ? user.id : undefined;
  const variables = {
    search: search.trim() || undefined,
    customerSearch: customerSearch.trim() || undefined,
    ownerSearch: ownerSearch.trim() || undefined,
    ownerId,
    architectId: architectId === 'all' ? undefined : architectId,
    status: status === 'all' ? undefined : status,
    dateFrom: dateFrom ? new Date(`${dateFrom}T00:00:00`).toISOString() : undefined,
    dateTo: dateTo ? new Date(`${dateTo}T23:59:59`).toISOString() : undefined,
    sort,
    skip: page * pageSize,
    take: pageSize,
  };
  const { data, loading, error, refetch } = useQuery(QUOTE_REGISTER, { variables, skip: !ready, fetchPolicy: 'cache-and-network' });
  const [sendQuote, { loading: sending, error: sendError }] = useMutation(SEND_QUOTE, { onCompleted: () => refetch() });
  const result = data?.quotePage || {};
  const quotes = useMemo<any[]>(() => result.rows || [], [result.rows]);
  const architects = useMemo<any[]>(() => data?.architects || [], [data?.architects]);
  const summary = result.statusSummary || {};
  const activeFilters = [search, customerSearch, ownerSearch, architectId !== 'all' ? architectId : '', dateFrom, dateTo].filter(Boolean).length;
  const resetFilters = () => { setSearch(''); setCustomerSearch(''); setOwnerSearch(''); setArchitectId('all'); setDateFrom(''); setDateTo(''); setStatus('all'); setSort('newest'); setPage(0); };
  const chooseSort = (next: string) => { setSort(next); setPage(0); };

  return (
    <div className="space-y-5 pb-10">
      <section className="relative overflow-hidden rounded-r6 border border-[#ead8d4] bg-[linear-gradient(118deg,#241514_0%,#54221f_58%,#a5372e_100%)] p-6 text-white shadow-2xl shadow-[#7b2b25]/15 lg:p-8">
        <div className="absolute -right-20 -top-28 h-72 w-72 rounded-full border border-white/10" />
        <div className="relative flex flex-col justify-between gap-6 xl:flex-row xl:items-end">
          <div className="max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#efc7c0]">Retail commercial desk</p>
            <h1 className="mt-3 font-display text-3xl font-bold tracking-[-0.04em] lg:text-4xl">Quote pipeline, pricing readiness and next action—at a glance.</h1>
            <p className="mt-3 max-w-2xl text-sm font-medium leading-6 text-white/70">Every value is read from the governed commercial snapshot used by the PDF and Sales Order conversion.</p>
          </div>
          <div className="flex flex-wrap gap-2"><Button asChild size="lg" className="bg-white text-[#7f2923] hover:bg-[#fff4f2]"><Link href="/dashboard/quotes/new"><Plus className="mr-2 h-5 w-5" /> Build quote</Link></Button><Button asChild variant="outline" size="lg" className="border-white/25 bg-white/10 text-white hover:bg-white/20"><Link href="/dashboard/approvals"><ShieldCheck className="mr-2 h-5 w-5" /> Approvals</Link></Button></div>
        </div>
        <div className="relative mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ['Filtered quotes', Number(result.total || 0), 'All matching records'],
            ['Pipeline value', money(result.filteredValue || 0), 'Authoritative quote total'],
            ['Sent', Number(summary.sent?.count || 0), money(summary.sent?.value || 0)],
            ['Confirmed', Number(summary.confirmed?.count || 0), money(summary.confirmed?.value || 0)],
          ].map(([label, value, note]) => <div key={String(label)} className="rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur"><p className="text-2xl font-black">{loading && !data ? '…' : value}</p><p className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[#efc7c0]">{label}</p><p className="mt-2 text-xs text-white/60">{note}</p></div>)}
        </div>
      </section>

      <section className="rounded-r5 border border-[#e4e4e7] bg-white p-4 shadow-lg shadow-slate-200/40">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="relative min-w-0 flex-1"><Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#71717a]"/><Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Search quote number, project, customer, architect or owner…" className="h-12 pl-11"/></div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setFiltersOpen((value) => !value)} className="h-12"><SlidersHorizontal className="mr-2 h-4 w-4"/>Filters{activeFilters ? <span className="ml-2 rounded-full bg-[#a52b23] px-2 py-0.5 text-[10px] text-white">{activeFilters}</span> : null}</Button>
            <select aria-label="Sort quotes" value={sort} onChange={(event) => chooseSort(event.target.value)} className="h-12 rounded-md border border-[#d4d4d8] bg-white px-3 text-sm font-semibold"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="value_desc">Highest value</option><option value="value_asc">Lowest value</option><option value="validity">Expiring first</option><option value="customer">Customer A–Z</option><option value="owner">Owner A–Z</option></select>
            {activeFilters || status !== 'all' || sort !== 'newest' ? <Button type="button" variant="ghost" onClick={resetFilters} className="h-12"><X className="mr-2 h-4 w-4"/>Reset</Button> : null}
          </div>
        </div>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1 custom-scrollbar">
          {['all', 'incomplete_pricing', 'draft', 'pending_approval', 'sent', 'confirmed', 'lost'].map((item) => <button key={item} onClick={() => { setStatus(item); setPage(0); }} className={`whitespace-nowrap rounded-full px-4 py-2 text-[11px] font-black uppercase tracking-wider transition ${status === item ? 'bg-[#18181b] text-white' : 'bg-[#f4f4f5] text-[#52525b] hover:bg-[#e4e4e7]'}`}>{item.replaceAll('_', ' ')}</button>)}
        </div>
        {filtersOpen ? <div className="mt-4 grid gap-3 rounded-xl border border-[#e4e4e7] bg-[#fafafa] p-4 md:grid-cols-2 xl:grid-cols-5">
          <label className="space-y-1"><span className="text-[10px] font-bold uppercase tracking-wider text-[#71717a]">Customer contains</span><Input value={customerSearch} onChange={(event) => { setCustomerSearch(event.target.value); setPage(0); }} placeholder="Customer name"/></label>
          <label className="space-y-1"><span className="text-[10px] font-bold uppercase tracking-wider text-[#71717a]">Owner contains</span><Input value={ownerSearch} onChange={(event) => { setOwnerSearch(event.target.value); setPage(0); }} placeholder="Sales user"/></label>
          <label className="space-y-1"><span className="text-[10px] font-bold uppercase tracking-wider text-[#71717a]">Architect</span><select value={architectId} onChange={(event) => { setArchitectId(event.target.value); setPage(0); }} className="h-10 w-full rounded-md border border-[#d4d4d8] bg-white px-3 text-sm"><option value="all">All architects</option>{architects.map((architect: any) => <option key={architect.id} value={architect.id}>{architect.name}</option>)}</select></label>
          <label className="space-y-1"><span className="text-[10px] font-bold uppercase tracking-wider text-[#71717a]">Created from</span><Input type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setPage(0); }}/></label>
          <label className="space-y-1"><span className="text-[10px] font-bold uppercase tracking-wider text-[#71717a]">Created to</span><Input type="date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); setPage(0); }}/></label>
        </div> : null}
      </section>

      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
      {sendError ? <QueryErrorBanner error={sendError} /> : null}

      <section className="overflow-hidden rounded-r5 border border-[#e4e4e7] bg-white shadow-xl shadow-slate-200/45">
        <div className="hidden grid-cols-[1.25fr_1fr_0.9fr_0.72fr_0.85fr_0.72fr_1fr] gap-4 border-b border-[#e4e4e7] bg-[#f7f4f3] px-5 py-4 text-[10px] font-black uppercase tracking-[0.14em] text-[#52525b] lg:grid">
          <button onClick={() => chooseSort(sort === 'quote_asc' ? 'quote_desc' : 'quote_asc')} className="flex items-center gap-1 text-left">Quote <ArrowDownAZ className="h-3 w-3"/></button>
          <button onClick={() => chooseSort('customer')} className="text-left">Customer</button><button onClick={() => chooseSort('architect')} className="text-left">Architect</button><button onClick={() => chooseSort('status')} className="text-left">Status</button><button onClick={() => chooseSort('validity')} className="text-left">Validity</button><button onClick={() => chooseSort(sort === 'value_desc' ? 'value_asc' : 'value_desc')} className="text-right">Value</button><div className="text-right">Actions</div>
        </div>
        <div className="divide-y divide-[#e4e4e7]">
          {loading && !quotes.length ? <div className="grid min-h-48 place-items-center text-sm font-semibold text-[#71717a]" role="status">Loading governed quote totals…</div> : null}
          {!loading && !error && quotes.length === 0 ? <div className="grid min-h-56 place-items-center p-8 text-center"><div><FileSpreadsheet className="mx-auto h-8 w-8 text-[#a52b23]"/><p className="mt-3 font-bold text-[#18181b]">No quotes match these filters.</p><p className="mt-1 text-sm text-[#71717a]">Reset filters or build a new quotation.</p></div></div> : null}
          {quotes.map((quote: any) => {
            const commercial = quote.commercial || {};
            const expires = quote.validUntil ? new Date(quote.validUntil) : null;
            const expired = expires ? expires.getTime() < Date.now() && !['confirmed', 'won', 'closed'].includes(quote.status) : false;
            return <article key={quote.id} className="grid gap-4 p-5 transition hover:bg-[#fffaf9] lg:grid-cols-[1.25fr_1fr_0.9fr_0.72fr_0.85fr_0.72fr_1fr] lg:items-center">
              <div><Link href={`/dashboard/quotes/${quote.id}`} className="text-lg font-black text-[#18181b] hover:text-[#a52b23]">{quote.quoteNumber}</Link><p className="mt-1 line-clamp-1 text-sm font-semibold text-[#52525b]">{quote.title || quote.projectName || 'Retail quotation'}</p><p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-[#71717a]">{commercial.itemCount || 0} lines · {commercial.quantity || 0} units · {dateValue(quote.createdAt)}</p></div>
              <div><p className="font-bold text-[#18181b]">{quote.customer?.name || 'Customer'}</p><p className="mt-1 line-clamp-1 text-xs font-semibold text-[#71717a]">{quote.customer?.siteAddress || quote.customer?.city || 'Site pending'}</p></div>
              <div><p className="font-semibold text-[#18181b]">{quote.architectName || quote.architect?.name || '—'}</p><p className="mt-1 text-xs text-[#71717a]">{quote.owner?.name || 'Unassigned owner'}</p></div>
              <div><span className={`inline-flex rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-wider ring-1 ${statusClass(quote.status)}`}>{String(quote.status || '').replaceAll('_', ' ')}</span></div>
              <div><p className={`flex items-center gap-1 text-sm font-bold ${expired ? 'text-red-700' : 'text-[#18181b]'}`}><CalendarClock className="h-4 w-4"/>{dateValue(quote.validUntil)}</p><p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-[#71717a]">{expired ? 'Expired—review before use' : quote.sentAt ? `Sent ${dateValue(quote.sentAt)}` : 'Not sent'}</p></div>
              <div className="lg:text-right"><p className="text-xl font-black text-[#18181b]">{money(commercial.grandTotal ?? quote.commercialTotal)}</p><p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-[#71717a]">incl. {money(commercial.taxAmount || 0)} tax</p></div>
              <div className="flex flex-wrap gap-2 lg:justify-end"><Button asChild variant="outline" size="sm"><Link href={`/dashboard/quotes/${quote.id}`}><Eye className="mr-1 h-4 w-4"/>View</Link></Button>{commercial.pricingReady ? <Button asChild variant="outline" size="sm"><a href={`/api/pdf/quote/${quote.id}`} target="_blank" rel="noreferrer"><Download className="mr-1 h-4 w-4"/>PDF</a></Button> : <Button asChild variant="outline" size="sm" className="border-amber-300 bg-amber-50 text-amber-900"><Link href={`/dashboard/quotes/${quote.id}?pdfError=commercial-pricing`}><ShieldCheck className="mr-1 h-4 w-4"/>Fix pricing</Link></Button>}{!['sent', 'confirmed', 'won', 'closed'].includes(quote.status) ? <Button disabled={sending || !commercial.pricingReady} onClick={() => sendQuote({ variables: { id: quote.id } })} variant="warning" size="sm"><Send className="mr-1 h-4 w-4"/>Send</Button> : null}</div>
            </article>;
          })}
        </div>
      </section>

      <div className="flex flex-col gap-3 rounded-r4 border border-[#e4e4e7] bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs font-semibold text-[#52525b]">Showing {quotes.length ? page * pageSize + 1 : 0}–{Math.min((page + 1) * pageSize, Number(result.total || 0))} of {Number(result.total || 0)} quotes</p>
        <div className="flex items-center gap-2"><label className="flex items-center gap-2 text-xs font-semibold text-[#52525b]">Rows<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(0); }} className="h-9 rounded-md border border-[#d4d4d8] bg-white px-2"><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label><Button variant="outline" disabled={page === 0 || loading} onClick={() => setPage((value) => Math.max(0, value - 1))}>Previous</Button><span className="min-w-20 text-center text-xs font-black">Page {Number(result.page || page + 1)}</span><Button variant="outline" disabled={!result.hasNext || loading} onClick={() => setPage((value) => value + 1)}>Next</Button></div>
      </div>
    </div>
  );
}
