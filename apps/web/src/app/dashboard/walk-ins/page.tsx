'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { gql, useMutation, useQuery } from '@apollo/client';
import { ChevronLeft, ChevronRight, FileText, Loader2, MessageCircle, Phone, RefreshCcw, ScanLine, UserCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryErrorBanner } from '@/components/query-state';
import { ProductImageFrame } from '@/components/product-image-frame';
import { thumbnailUrl } from '@/lib/media';

const WALK_INS = gql`query ShowroomWalkIns($day: String, $status: String) { showroomWalkIns(day: $day, status: $status) }`;
const START_QUOTE = gql`mutation StartWalkInQuote($visitId: ID!) { startWalkInQuote(visitId: $visitId) }`;
const SET_STATUS = gql`mutation SetWalkInStatus($visitId: ID!, $status: String!) { setWalkInStatus(visitId: $visitId, status: $status) }`;

const STATUS_LABEL: Record<string, string> = { open: 'Waiting', quoting: 'Quote started', closed: 'Closed' };
const STATUS_TONE: Record<string, string> = {
  open: 'bg-amber-100 text-amber-900',
  quoting: 'bg-sky-100 text-sky-900',
  closed: 'bg-[var(--bg-soft)] text-[var(--ink-3)]',
};

function indiaDay(offsetDays = 0, from?: string) {
  const base = from ? new Date(`${from}T12:00:00+05:30`) : new Date();
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(base.getTime() + offsetDays * 86400000));
}

function timeOf(value: string) {
  return new Date(value).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

export default function WalkInsPage() {
  const router = useRouter();
  const today = indiaDay();
  const [day, setDay] = useState(today);
  const [status, setStatus] = useState('');
  const { data, loading, error, refetch } = useQuery(WALK_INS, { variables: { day, status: status || undefined }, fetchPolicy: 'cache-and-network', pollInterval: 30000 });
  const [startQuote] = useMutation(START_QUOTE);
  const [setVisitStatus] = useMutation(SET_STATUS);
  const [busyId, setBusyId] = useState('');
  const [actionError, setActionError] = useState('');
  const visits: any[] = useMemo(() => data?.showroomWalkIns || [], [data?.showroomWalkIns]);
  const counts = useMemo(() => ({
    total: visits.length,
    open: visits.filter((visit) => visit.status === 'open').length,
    scanned: visits.reduce((sum, visit) => sum + visit.products.length, 0),
  }), [visits]);

  async function quote(visit: any) {
    setActionError('');
    setBusyId(visit.id);
    try {
      const result = (await startQuote({ variables: { visitId: visit.id } })).data?.startWalkInQuote;
      if (!result?.customerId) throw new Error('No customer was returned for this walk-in.');
      const params = new URLSearchParams({ customer: result.customerId });
      if (result.productIds?.length) params.set('products', result.productIds.join(','));
      router.push(`/dashboard/quotes/new?${params.toString()}`);
    } catch (failure) {
      setActionError(failure instanceof Error ? failure.message : 'The quote could not be started.');
      setBusyId('');
    }
  }

  async function changeStatus(visit: any, next: string) {
    setActionError('');
    setBusyId(visit.id);
    try {
      await setVisitStatus({ variables: { visitId: visit.id, status: next } });
      await refetch();
    } catch (failure) {
      setActionError(failure instanceof Error ? failure.message : 'The walk-in could not be updated.');
    } finally {
      setBusyId('');
    }
  }

  return (
    <div className="space-y-5 pb-10">
      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-[var(--ink)]">Showroom walk-ins</h1>
          <p className="mt-1 text-sm text-[var(--ink-3)]">Customers who checked in from the showroom scan poster, with every product they scanned. Start a quote in one tap.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => refetch()}><RefreshCcw className="mr-2 h-4 w-4" />Refresh</Button>
          <Button asChild variant="outline"><Link href="/print/showroom-poster" target="_blank"><ScanLine className="mr-2 h-4 w-4" />Scan poster</Link></Button>
        </div>
      </header>

      <section aria-label="Choose day and status" className="flex flex-col gap-3 rounded-r4 border border-[var(--line)] bg-[var(--surface)] p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="icon" aria-label="Previous day" onClick={() => setDay(indiaDay(-1, day))}><ChevronLeft className="h-4 w-4" /></Button>
          <label htmlFor="walk-in-day" className="sr-only">Day</label>
          <input id="walk-in-day" type="date" value={day} max={today} onChange={(event) => setDay(event.target.value || today)} className="h-10 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)]" />
          <Button type="button" variant="outline" size="icon" aria-label="Next day" disabled={day >= today} onClick={() => setDay(indiaDay(1, day))}><ChevronRight className="h-4 w-4" /></Button>
          {day !== today ? <Button type="button" variant="ghost" size="sm" onClick={() => setDay(today)}>Today</Button> : null}
        </div>
        <div className="flex flex-wrap gap-2" role="toolbar" aria-label="Status">
          {[['', 'All'], ['open', 'Waiting'], ['quoting', 'Quote started'], ['closed', 'Closed']].map(([value, label]) => (
            <button key={value || 'all'} type="button" aria-pressed={status === value} onClick={() => setStatus(value)} className={`h-9 rounded-full border px-4 text-sm font-semibold ${status === value ? 'border-[var(--ink)] bg-[var(--ink)] text-[var(--surface)]' : 'border-[var(--line)] text-[var(--ink-3)]'}`}>{label}</button>
          ))}
        </div>
      </section>

      <p className="text-sm text-[var(--ink-3)]" aria-live="polite">{loading && !data ? 'Loading walk-ins…' : `${counts.total} walk-in${counts.total === 1 ? '' : 's'} · ${counts.open} waiting · ${counts.scanned} products scanned`}</p>
      {actionError ? <p role="alert" className="rounded-r3 border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{actionError}</p> : null}

      {!loading && !visits.length ? (
        <div className="rounded-r4 border border-dashed border-[var(--line)] bg-[var(--surface)] p-10 text-center">
          <p className="font-semibold text-[var(--ink)]">No walk-ins {day === today ? 'yet today' : 'on this day'}.</p>
          <p className="mt-1 text-sm text-[var(--ink-3)]">Customers appear here when they check in from the showroom scan poster.</p>
        </div>
      ) : null}

      <ul className="space-y-3">
        {visits.map((visit) => {
          const busy = busyId === visit.id;
          const mobile = String(visit.mobile || '');
          return (
            <li key={visit.id} className="rounded-r4 border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm-soft">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-[var(--ink)]">{visit.name}</h2>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_TONE[visit.status] || ''}`}>{STATUS_LABEL[visit.status] || visit.status}</span>
                    {visit.customer ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800"><UserCheck className="h-3.5 w-3.5" aria-hidden="true" />Existing customer</span> : null}
                  </div>
                  <p className="mt-1 text-sm text-[var(--ink-3)]">
                    <a href={`tel:${mobile}`} className="font-mono text-[var(--ink-2)] underline-offset-2 hover:underline">{mobile}</a>
                    {visit.city ? ` · ${visit.city}` : ''} · checked in {timeOf(visit.createdAt)}{visit.handledBy ? ` · handled by ${visit.handledBy}` : ''}
                  </p>
                  {visit.note ? <p className="mt-1 text-sm text-[var(--ink-2)]">Looking for: {visit.note}</p> : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={() => quote(visit)} disabled={busy}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}{visit.products.length ? `Quote ${visit.products.length} product${visit.products.length === 1 ? '' : 's'}` : 'Start quote'}</Button>
                  <Button asChild variant="outline" size="icon" aria-label={`WhatsApp ${visit.name}`}><a href={`https://wa.me/91${mobile}`} target="_blank" rel="noreferrer"><MessageCircle className="h-4 w-4" /></a></Button>
                  <Button asChild variant="outline" size="icon" aria-label={`Call ${visit.name}`}><a href={`tel:${mobile}`}><Phone className="h-4 w-4" /></a></Button>
                  {visit.status !== 'closed'
                    ? <Button type="button" variant="ghost" disabled={busy} onClick={() => changeStatus(visit, 'closed')}><X className="mr-1.5 h-4 w-4" />Close</Button>
                    : <Button type="button" variant="ghost" disabled={busy} onClick={() => changeStatus(visit, 'open')}>Reopen</Button>}
                </div>
              </div>
              {visit.products.length ? (
                <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" aria-label={`Products ${visit.name} scanned`}>
                  {visit.products.map((product: any) => (
                    <li key={product.id} className={`overflow-hidden rounded-r3 border border-[var(--line)] ${product.active ? '' : 'opacity-60'}`}>
                      <ProductImageFrame src={thumbnailUrl(product.media) || undefined} alt="" className="aspect-[4/3] w-full" imageClassName="p-1" sizes="200px" />
                      <div className="p-2">
                        <p className="line-clamp-2 text-sm font-semibold text-[var(--ink)]">{product.name || product.code}</p>
                        <p className="truncate text-xs text-[var(--ink-4)]">{[product.size, product.finish].filter(Boolean).join(' · ') || product.code}</p>
                        <p className="text-xs text-[var(--ink-3)]">{product.mrp ? `MRP ₹${product.mrp.toLocaleString('en-IN')}` : 'No MRP'}{product.scanCount > 1 ? ` · scanned ${product.scanCount}×` : ''}{product.active ? '' : ' · inactive'}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-3 text-sm text-[var(--ink-4)]">No products scanned yet.</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
