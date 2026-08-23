'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { gql, useMutation, useQuery } from '@apollo/client';
import { AlertTriangle, Check, CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck, Eye, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QueryErrorBanner, QueryLoading } from '@/components/query-state';
import { StockControlWorkspace } from '@/components/inventory/stock-control-workspace';
import { cn } from '@/lib/utils';

const DATA = gql`
  query StockCountPage($search: String, $locationId: String) {
    inventoryLots(search: $search, locationId: $locationId, status: "active", take: 200)
    stockLocations(status: "active")
    stockCountSessions(take: 80)
    inventoryPeriodCloses(take: 12)
  }
`;
const CREATE = gql`mutation CreateStockCountSession($input: StockCountInput!) { createStockCountSession(input: $input) }`;
const APPROVE = gql`mutation ApproveStockCountSession($id: ID!) { approveStockCountSession(id: $id) }`;

const PAGE_SIZE = 30;

export default function StockCountPage() {
  const [search, setSearch] = useState('');
  const [locationId, setLocationId] = useState('');
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [countType, setCountType] = useState('cycle');
  const [periodKey, setPeriodKey] = useState('');
  const [lotFilter, setLotFilter] = useState('all');
  const [sessionFilter, setSessionFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const { data, loading, error, refetch } = useQuery(DATA, { variables: { search: search || undefined, locationId: locationId || undefined }, fetchPolicy: 'cache-and-network' });
  const [create, { loading: creating, error: createError }] = useMutation(CREATE, { onCompleted: () => { setCounts({}); setNotes(''); setPage(0); refetch(); } });
  const [approve, { loading: approving, error: approveError }] = useMutation(APPROVE, { onCompleted: () => refetch() });

  const lots = useMemo<any[]>(() => (data?.inventoryLots || []).flatMap((lot: any) => (lot.balances || []).map((balance: any) => ({ ...balance, lot, product: lot.product }))), [data?.inventoryLots]);
  const locations = useMemo<any[]>(() => data?.stockLocations || [], [data?.stockLocations]);
  const defaultLocation = useMemo(() => locations.find((location) => location.defaultStockScope) || locations[0], [locations]);
  const selectedLocation = useMemo(() => locations.find((location) => location.id === locationId) || defaultLocation, [defaultLocation, locationId, locations]);
  const sessions = useMemo<any[]>(() => data?.stockCountSessions || [], [data?.stockCountSessions]);
  const closedPeriods = useMemo<any[]>(() => data?.inventoryPeriodCloses || [], [data?.inventoryPeriodCloses]);
  const selectedLines = useMemo(() => lots
    .filter((row) => counts[row.lotId] !== undefined && counts[row.lotId] !== '')
    .map((row) => ({ productId: row.product.id, lotId: row.lotId, locationId: row.locationId, countedQuantity: Number(counts[row.lotId] || 0), expectedQuantity: Number(row.onHand || 0), variance: Number(counts[row.lotId] || 0) - Number(row.onHand || 0), reason: notes || 'Physical count' })), [lots, counts, notes]);
  const varianceLines = selectedLines.filter((line) => line.variance !== 0);
  const filteredLots = useMemo(() => lots.filter((row) => {
    const entered = counts[row.lotId] !== undefined && counts[row.lotId] !== '';
    const variance = entered && Number(counts[row.lotId]) !== Number(row.onHand || 0);
    if (lotFilter === 'uncounted') return !entered;
    if (lotFilter === 'entered') return entered;
    if (lotFilter === 'variance') return variance;
    return true;
  }), [counts, lotFilter, lots]);
  const pageCount = Math.max(1, Math.ceil(filteredLots.length / PAGE_SIZE));
  const pageLots = filteredLots.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const filteredSessions = sessionFilter === 'all' ? sessions : sessions.filter((session) => session.status === sessionFilter);
  const selectedSession = sessions.find((session) => session.id === selectedSessionId) || filteredSessions[0];
  const needsVarianceNote = varianceLines.length > 0 && notes.trim().length < 5;

  const submit = () => {
    if (!selectedLines.length || needsVarianceNote) return;
    create({ variables: { input: { scope: 'lot_location', countType, periodKey: periodKey || undefined, effectiveAt: new Date().toISOString(), device: 'web', locationId: selectedLocation?.id || undefined, notes, submit: true, lines: JSON.stringify(selectedLines.map(({ expectedQuantity, variance, ...line }) => line)) } } });
  };

  useEffect(() => {
    if (!locationId && defaultLocation?.id) setLocationId(defaultLocation.id);
  }, [defaultLocation?.id, locationId]);
  useEffect(() => { setPage(0); }, [locationId, lotFilter, search]);
  useEffect(() => { if (page >= pageCount) setPage(Math.max(0, pageCount - 1)); }, [page, pageCount]);

  return (
    <StockControlWorkspace
      title="Physical stock count"
      description="A guided count desk for exact lot-and-location truth: scope the work, capture quantities quickly, review every variance, submit evidence, then post through an independent decision."
      action={<Button asChild variant="outline"><Link href="/dashboard/inventory/reconciliation">Review reconciliation</Link></Button>}
      metrics={[
        { label: 'Scope', value: lots.length.toLocaleString('en-IN'), note: `${selectedLocation?.code || '—'} · active lots loaded` },
        { label: 'Progress', value: `${selectedLines.length}/${lots.length || 0}`, note: `${Math.round((selectedLines.length / Math.max(lots.length, 1)) * 100)}% of loaded scope entered`, tone: selectedLines.length ? 'info' : 'neutral' },
        { label: 'Variance lines', value: varianceLines.length, note: varianceLines.length ? `${varianceLines.reduce((sum, line) => sum + Math.abs(line.variance), 0)} units differ from book` : 'No entered variance', tone: varianceLines.length ? 'warning' : 'success' },
        { label: 'Awaiting post', value: sessions.filter((row) => !['posted', 'cancelled'].includes(row.status)).length, note: 'Submitted count sessions', tone: sessions.some((row) => !['posted', 'cancelled'].includes(row.status)) ? 'warning' : 'success' },
        { label: 'Latest period close', value: closedPeriods[0]?.periodKey || 'Not closed', note: closedPeriods[0] ? `${closedPeriods[0].status} · ${new Date(closedPeriods[0].effectiveAt).toLocaleDateString('en-IN')}` : 'Monthly/year-end close not started' },
      ]}
    >
      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
      {createError ? <QueryErrorBanner error={createError} /> : null}
      {approveError ? <QueryErrorBanner error={approveError} /> : null}

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(22rem,0.75fr)]">
        <div className="mp-panel overflow-hidden">
          <div className="border-b border-[var(--line)] p-5">
            <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end"><div><p className="text-[11px] font-black uppercase tracking-[0.16em] text-[var(--brand-700)]">1 · Define count scope</p><h2 className="mt-1 text-xl font-black text-[var(--ink)]">Exact lots at one stock location</h2><p className="mt-1 text-sm text-[var(--ink-4)]">Search narrows the server result; the list is paged locally for fast entry.</p></div><select value={selectedLocation?.id || ''} onChange={(event) => setLocationId(event.target.value)} className="h-11 min-w-64 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-bold text-[var(--ink)]">{locations.map((location) => <option key={location.id} value={location.id}>{location.defaultStockScope ? 'Default · ' : ''}{location.code} · {location.name}</option>)}</select></div>
            <div className="mt-4 grid gap-2 lg:grid-cols-[minmax(18rem,1fr)_auto]"><label className="flex h-11 items-center rounded-md border border-[var(--line)] bg-[var(--surface)] px-3"><Search className="mr-2 h-4 w-4 text-[var(--ink-4)]"/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search SKU, item, lot, batch or GRN" className="w-full bg-transparent text-sm outline-none"/></label><div className="flex overflow-x-auto rounded-md border border-[var(--line)] bg-[var(--bg-soft)] p-1">{[['all','All'],['uncounted','Uncounted'],['entered','Entered'],['variance','Variance']].map(([value,label]) => <button key={value} type="button" onClick={() => setLotFilter(value)} className={cn('min-h-9 whitespace-nowrap rounded px-3 text-xs font-black', lotFilter === value ? 'bg-[var(--surface)] text-[var(--brand-700)] shadow-sm' : 'text-[var(--ink-4)]')}>{label}</button>)}</div></div>
          </div>
          <div className="grid gap-3 border-b border-[var(--line)] bg-[var(--bg-soft)] p-4 sm:grid-cols-2"><label className="text-xs font-bold text-[var(--ink-4)]">Count purpose<select value={countType} onChange={(event) => { setCountType(event.target.value); if (event.target.value === 'cycle') setPeriodKey(''); }} className="mt-1 h-10 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)]"><option value="cycle">Cycle / spot count</option><option value="monthly">Monthly close count</option><option value="year_end">Year-end count</option></select></label><label className="text-xs font-bold text-[var(--ink-4)]">Period key<Input className="mt-1" value={periodKey} onChange={(event) => setPeriodKey(event.target.value)} placeholder={countType === 'year_end' ? '2026-27' : '2026-08'} disabled={countType === 'cycle'} /></label></div>
          {loading && !lots.length ? <div className="p-5"><QueryLoading label="Loading countable lots..." /></div> : null}
          <div className="divide-y divide-[var(--line)]">{pageLots.map((row) => { const entered = counts[row.lotId] !== undefined && counts[row.lotId] !== ''; const variance = entered ? Number(counts[row.lotId]) - Number(row.onHand || 0) : 0; return <div key={`${row.lotId}:${row.locationId}`} className={cn('grid gap-3 p-4 transition-colors lg:grid-cols-[minmax(0,1fr)_9rem_auto] lg:items-center', entered ? variance ? 'bg-amber-50/55' : 'bg-emerald-50/35' : 'hover:bg-[var(--bg-soft)]')}><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-black text-[var(--ink)]">{row.product?.internalCode || row.product?.sku} · {row.product?.name}</p>{entered ? <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-black uppercase', variance ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800')}>{variance ? `Variance ${variance > 0 ? '+' : ''}${variance}` : 'Matches book'}</span> : null}</div><p className="mt-1 text-xs font-medium text-[var(--ink-4)]">Lot {row.lot?.lotNumber} · book {row.onHand} · available {row.available} · hold {row.hold || 0} · damaged {row.damaged}</p></div><Input aria-label={`Counted quantity for ${row.lot?.lotNumber}`} type="number" min={0} value={counts[row.lotId] || ''} onChange={(event) => setCounts((current) => ({ ...current, [row.lotId]: event.target.value }))} placeholder="Counted"/><div className="flex gap-1"><button type="button" onClick={() => setCounts((current) => ({ ...current, [row.lotId]: String(row.onHand || 0) }))} className="min-h-9 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2.5 text-xs font-bold text-[var(--ink-3)] hover:bg-[var(--bg-soft)]">Use book</button><button type="button" onClick={() => setCounts((current) => ({ ...current, [row.lotId]: '0' }))} className="min-h-9 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2.5 text-xs font-bold text-[var(--ink-3)] hover:bg-[var(--bg-soft)]">Zero</button></div></div>; })}{!pageLots.length && !loading ? <div className="p-10 text-center"><Search className="mx-auto h-7 w-7 text-[var(--ink-5)]"/><p className="mt-3 font-black text-[var(--ink)]">No lot matches this scope</p><p className="mt-1 text-sm text-[var(--ink-4)]">Clear the search or choose another entry state.</p></div> : null}</div>
          <div className="flex items-center justify-between border-t border-[var(--line)] bg-[var(--bg-soft)] p-3"><Button type="button" size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}><ChevronLeft className="mr-1 h-4 w-4"/>Previous</Button><span className="text-xs font-black uppercase tracking-wider text-[var(--ink-4)]">Page {page + 1} of {pageCount} · {filteredLots.length} lot(s)</span><Button type="button" size="sm" variant="outline" disabled={page + 1 >= pageCount} onClick={() => setPage((value) => value + 1)}>Next<ChevronRight className="ml-1 h-4 w-4"/></Button></div>
        </div>

        <div className="space-y-5">
          <div className="mp-panel overflow-hidden xl:sticky xl:top-4">
            <div className="border-b border-[var(--line)] p-5"><p className="text-[11px] font-black uppercase tracking-[0.16em] text-[var(--brand-700)]">2 · Review this session</p><h2 className="mt-1 text-xl font-black text-[var(--ink)]">{selectedLines.length ? `${selectedLines.length} lot(s) ready` : 'Start entering physical counts'}</h2></div>
            <div className="grid grid-cols-3 divide-x divide-[var(--line)] border-b border-[var(--line)]"><div className="p-4"><p className="text-[10px] font-black uppercase text-[var(--ink-4)]">Entered</p><p className="mt-1 text-xl font-black text-[var(--ink)]">{selectedLines.length}</p></div><div className="p-4"><p className="text-[10px] font-black uppercase text-[var(--ink-4)]">Matched</p><p className="mt-1 text-xl font-black text-emerald-700">{selectedLines.length - varianceLines.length}</p></div><div className="p-4"><p className="text-[10px] font-black uppercase text-[var(--ink-4)]">Variance</p><p className="mt-1 text-xl font-black text-amber-700">{varianceLines.length}</p></div></div>
            <div className="max-h-52 overflow-y-auto divide-y divide-[var(--line)] custom-scrollbar">{varianceLines.slice(0, 12).map((line) => { const lot = lots.find((row) => row.lotId === line.lotId); return <div key={line.lotId} className="flex items-center justify-between gap-3 px-4 py-3"><div className="min-w-0"><p className="truncate text-xs font-black text-[var(--ink)]">{lot?.product?.internalCode || lot?.product?.sku}</p><p className="truncate text-[10px] text-[var(--ink-4)]">{lot?.lot?.lotNumber} · book {line.expectedQuantity}</p></div><span className="shrink-0 rounded-full bg-amber-100 px-2 py-1 text-xs font-black text-amber-800">{line.variance > 0 ? '+' : ''}{line.variance}</span></div>; })}{selectedLines.length && !varianceLines.length ? <div className="p-5 text-center"><CheckCircle2 className="mx-auto h-7 w-7 text-emerald-600"/><p className="mt-2 text-sm font-black text-[var(--ink)]">Entered lines match book stock</p></div> : null}</div>
            <div className="space-y-3 border-t border-[var(--line)] bg-[var(--bg-soft)] p-5"><label className="block text-xs font-bold text-[var(--ink-4)]">Count evidence / note<textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={varianceLines.length ? 'Required: explain the physical variance or inspection evidence' : 'Optional count note'} className={cn('mt-1 min-h-[82px] w-full rounded-md border bg-[var(--surface)] px-3 py-2 text-sm outline-none', needsVarianceNote ? 'border-amber-400' : 'border-[var(--line)]')} /></label>{needsVarianceNote ? <p className="flex items-start gap-2 text-xs font-bold text-amber-800"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0"/>A specific note is required because physical and book quantity differ.</p> : null}<Button className="w-full" onClick={submit} disabled={!selectedLines.length || creating || needsVarianceNote || (countType !== 'cycle' && !periodKey)}><ClipboardCheck className="mr-2 h-4 w-4"/>Submit {selectedLines.length || ''} counted lot(s)</Button><p className="text-center text-xs text-[var(--ink-4)]">Submission records evidence; stock changes only after posting.</p></div>
          </div>
        </div>
      </section>

      <section className="mp-panel overflow-hidden">
        <div className="flex flex-col justify-between gap-3 border-b border-[var(--line)] p-5 sm:flex-row sm:items-end"><div><p className="text-[11px] font-black uppercase tracking-[0.16em] text-[var(--brand-700)]">3 · Review and post</p><h2 className="mt-1 text-xl font-black text-[var(--ink)]">Count session register</h2><p className="mt-1 text-sm text-[var(--ink-4)]">Select a session to inspect its lot-level expected, counted and variance evidence.</p></div><select value={sessionFilter} onChange={(event) => setSessionFilter(event.target.value)} className="h-10 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-bold"><option value="all">All session states</option><option value="draft">Draft</option><option value="submitted">Submitted</option><option value="posted">Posted</option></select></div>
        <div className="grid min-h-72 lg:grid-cols-[22rem_1fr]"><div className="divide-y divide-[var(--line)] border-r border-[var(--line)]">{filteredSessions.map((session) => <button key={session.id} type="button" onClick={() => setSelectedSessionId(session.id)} className={cn('w-full p-4 text-left hover:bg-[var(--bg-soft)]', selectedSession?.id === session.id && 'bg-[var(--brand-50)]')}><div className="flex items-center justify-between gap-2"><p className="font-black text-[var(--ink)]">{session.countNumber}</p><span className={cn('rounded-full px-2 py-0.5 text-[10px] font-black uppercase', session.status === 'posted' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800')}>{session.status}</span></div><p className="mt-1 text-xs text-[var(--ink-4)]">{session.countType?.replace('_', ' ')} · {session.location?.code || 'All locations'} · {session.lines?.length || 0} lines</p></button>)}{!filteredSessions.length ? <p className="p-8 text-center text-sm text-[var(--ink-4)]">No count session matches this state.</p> : null}</div><div className="p-5">{selectedSession ? <><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div><p className="text-xs font-black uppercase tracking-wider text-[var(--ink-4)]">{selectedSession.status} session</p><h3 className="mt-1 text-xl font-black text-[var(--ink)]">{selectedSession.countNumber}</h3><p className="mt-1 text-sm text-[var(--ink-4)]">{selectedSession.periodKey || 'Cycle count'} · variance {selectedSession.totalVariance || 0}</p></div>{selectedSession.status !== 'posted' ? <Button disabled={approving} onClick={() => approve({ variables: { id: selectedSession.id } })}><Check className="mr-2 h-4 w-4"/>Post approved variance</Button> : <span className="inline-flex items-center rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-black text-emerald-800"><CheckCircle2 className="mr-1.5 h-4 w-4"/>Posted to ledger</span>}</div><div className="mt-5 overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="border-y border-[var(--line)] bg-[var(--bg-soft)] text-[10px] font-black uppercase tracking-wider text-[var(--ink-4)]"><tr><th className="p-3">Product / lot</th><th className="p-3">Expected</th><th className="p-3">Counted</th><th className="p-3">Variance</th></tr></thead><tbody className="divide-y divide-[var(--line)]">{(selectedSession.lines || []).map((line: any) => <tr key={line.id}><td className="p-3"><p className="font-black text-[var(--ink)]">{line.product?.internalCode || line.product?.sku}</p><p className="text-xs text-[var(--ink-4)]">{line.lot?.lotNumber}</p></td><td className="p-3 tabular-nums">{line.expectedQuantity}</td><td className="p-3 font-black tabular-nums">{line.countedQuantity}</td><td className={cn('p-3 font-black tabular-nums', Number(line.variance) ? 'text-amber-700' : 'text-emerald-700')}>{Number(line.variance) > 0 ? '+' : ''}{line.variance}</td></tr>)}</tbody></table></div></> : <div className="grid min-h-56 place-items-center text-center"><div><Eye className="mx-auto h-8 w-8 text-[var(--ink-5)]"/><p className="mt-3 font-black text-[var(--ink)]">Select a count session</p><p className="mt-1 text-sm text-[var(--ink-4)]">Its evidence and posting action will appear here.</p></div></div>}</div></div>
      </section>
    </StockControlWorkspace>
  );
}
