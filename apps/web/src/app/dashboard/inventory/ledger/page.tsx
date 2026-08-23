'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { gql, useQuery } from '@apollo/client';
import { ArrowDownLeft, ArrowUpRight, ChevronLeft, ChevronRight, ExternalLink, Filter, History, MapPinned, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryErrorBanner, QueryLoading } from '@/components/query-state';
import { StockControlWorkspace } from '@/components/inventory/stock-control-workspace';
import { cn } from '@/lib/utils';

const DATA = gql`
  query StockLedgerPage($productId: String, $skip: Int, $take: Int) {
    stockLedgerEntries(productId: $productId, skip: $skip, take: $take)
    stockLocations(status: "active")
  }
`;
const PAGE_SIZE = 100;

const movementFamily = (type: string) => {
  const value = String(type || '').toLowerCase();
  if (value.includes('opening')) return 'Opening';
  if (value.includes('grn') || value.includes('receipt') || value.includes('inward')) return 'Receipt';
  if (value.includes('transfer')) return 'Transfer';
  if (value.includes('dispatch') || value.includes('sale')) return 'Dispatch';
  if (value.includes('return')) return 'Return';
  if (value.includes('count') || value.includes('adjust') || value.includes('damage') || value.includes('hold')) return 'Control';
  return 'Other';
};

export default function StockLedgerPage() {
  const [page, setPage] = useState(0);
  const [productId, setProductId] = useState('');
  const [search, setSearch] = useState('');
  const [direction, setDirection] = useState('all');
  const [family, setFamily] = useState('all');
  const [selectedId, setSelectedId] = useState('');
  const { data, loading, error, refetch } = useQuery(DATA, { variables: { productId: productId || undefined, skip: page * PAGE_SIZE, take: PAGE_SIZE + 1 }, fetchPolicy: 'cache-and-network' });
  const locations: any[] = useMemo(() => data?.stockLocations || [], [data?.stockLocations]);
  const ledgerPage: any[] = data?.stockLedgerEntries || [];
  const ledgerRaw = ledgerPage.slice(0, PAGE_SIZE);
  const hasNext = ledgerPage.length > PAGE_SIZE;
  const locationMap = useMemo(() => new Map(locations.map((location) => [location.id, location])), [locations]);
  const ledger = useMemo(() => ledgerRaw.filter((entry) => {
    if (direction !== 'all' && entry.direction !== direction) return false;
    if (family !== 'all' && movementFamily(entry.type) !== family) return false;
    const haystack = [entry.product?.sku, entry.product?.internalCode, entry.product?.name, entry.reason, entry.sourceDocumentNo, entry.referenceId, entry.type, locationMap.get(entry.locationId)?.code].filter(Boolean).join(' ').toLowerCase();
    return !search.trim() || haystack.includes(search.trim().toLowerCase());
  }), [direction, family, ledgerRaw, locationMap, search]);
  const selected = ledgerRaw.find((entry) => entry.id === selectedId);
  const inbound = ledgerRaw.filter((row) => row.direction === 'in').reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  const outbound = ledgerRaw.filter((row) => row.direction !== 'in').reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  const movementFamilies = Array.from(new Set(ledgerRaw.map((row) => movementFamily(row.type)))).sort();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const incomingProductId = params.get('productId') || '';
    const incomingSearch = params.get('search') || '';
    if (incomingProductId) setProductId(incomingProductId);
    if (incomingSearch) setSearch(incomingSearch);
  }, []);
  useEffect(() => { setSelectedId(''); }, [page, productId]);

  const clearFilters = () => { setSearch(''); setDirection('all'); setFamily('all'); setProductId(''); setPage(0); };
  const filtersActive = Boolean(search || productId || direction !== 'all' || family !== 'all');

  return (
    <StockControlWorkspace
      title="Universal stock ledger"
      description="Read-only, source-linked evidence for every opening entry, receipt, transfer, reservation, dispatch, return and approved variance—ordered exactly as the system posted it."
      action={<Button asChild variant="outline"><Link href="/dashboard/inventory/reconciliation">Open reconciliation</Link></Button>}
      metrics={[
        { label: 'Server page', value: page + 1, note: `${ledgerRaw.length} movements loaded` },
        { label: 'Inbound units', value: inbound.toLocaleString('en-IN'), note: `${ledgerRaw.filter((row) => row.direction === 'in').length} positive postings`, tone: 'success' },
        { label: 'Outbound units', value: outbound.toLocaleString('en-IN'), note: `${ledgerRaw.filter((row) => row.direction !== 'in').length} negative postings`, tone: outbound ? 'warning' : 'neutral' },
        { label: 'Movement families', value: movementFamilies.length, note: movementFamilies.join(' · ') || 'No entries' },
        { label: 'Visible results', value: ledger.length, note: filtersActive ? 'Matching this server page / product' : 'All entries on page', tone: filtersActive ? 'info' : 'neutral' },
      ]}
    >
      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
      {loading && !ledgerRaw.length ? <QueryLoading label="Loading immutable stock movements..." /> : null}

      <section className="mp-panel overflow-hidden">
        <div className="border-b border-[var(--line)] p-5">
          <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end"><div><p className="text-[11px] font-black uppercase tracking-[0.16em] text-[var(--brand-700)]">Movement evidence</p><h2 className="mt-1 text-xl font-black text-[var(--ink)]">Search, narrow and inspect the source trail</h2><p className="mt-1 text-sm text-[var(--ink-4)]">Product drill-through is server-scoped; text and movement filters refine the loaded page.</p></div>{filtersActive ? <Button type="button" size="sm" variant="outline" onClick={clearFilters}><X className="mr-1.5 h-4 w-4"/>Clear filters</Button> : null}</div>
          <div className="mt-4 grid gap-2 lg:grid-cols-[minmax(18rem,1fr)_10rem_11rem]"><label className="flex h-11 items-center rounded-md border border-[var(--line)] bg-[var(--surface)] px-3"><Search className="mr-2 h-4 w-4 text-[var(--ink-4)]"/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Document, SKU, item, reason or location" className="w-full bg-transparent text-sm outline-none"/></label><select value={direction} onChange={(event) => setDirection(event.target.value)} className="h-11 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-bold"><option value="all">All directions</option><option value="in">Inbound</option><option value="out">Outbound</option></select><select value={family} onChange={(event) => setFamily(event.target.value)} className="h-11 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-bold"><option value="all">All movement types</option>{movementFamilies.map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
          {productId ? <div className="mt-3 flex items-center justify-between rounded-r3 border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-900"><span className="inline-flex items-center"><Filter className="mr-2 h-3.5 w-3.5"/>Showing the complete server trail for one reconciliation product.</span><button type="button" onClick={() => { setProductId(''); setPage(0); }} className="underline">Show all products</button></div> : null}
        </div>

        <div className="overflow-x-auto custom-scrollbar"><table className="w-full min-w-[1040px] text-left"><thead className="border-b border-[var(--line)] bg-[var(--bg-soft)] text-[10px] font-black uppercase tracking-[0.14em] text-[var(--ink-4)]"><tr><th className="px-4 py-3">Posted</th><th className="px-4 py-3">Product / lot</th><th className="px-4 py-3">Movement</th><th className="px-4 py-3 text-right">Quantity</th><th className="px-4 py-3">Source document</th><th className="px-4 py-3">Location / reason</th><th className="px-4 py-3"></th></tr></thead><tbody className="divide-y divide-[var(--line)]">{ledger.map((entry) => { const isIn = entry.direction === 'in'; const location = locationMap.get(entry.locationId); return <tr key={entry.id} className={cn('group hover:bg-[var(--bg-soft)]/70', selectedId === entry.id && 'bg-[var(--brand-50)]')}><td className="px-4 py-3"><p className="text-sm font-bold text-[var(--ink)]">{new Date(entry.createdAt).toLocaleDateString('en-IN')}</p><p className="mt-0.5 text-xs text-[var(--ink-4)]">{new Date(entry.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</p></td><td className="max-w-xs px-4 py-3"><p className="truncate text-sm font-black text-[var(--ink)]">{entry.product?.internalCode || entry.product?.sku || 'Unknown SKU'}</p><p className="mt-0.5 truncate text-xs text-[var(--ink-4)]">{entry.product?.name || entry.lotNumber || entry.productId}</p></td><td className="px-4 py-3"><span className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1 text-xs font-black text-[var(--ink-3)]">{movementFamily(entry.type)}</span><p className="mt-1 text-[10px] font-bold uppercase text-[var(--ink-4)]">{String(entry.type || '').replaceAll('_', ' ')}</p></td><td className={cn('px-4 py-3 text-right text-base font-black tabular-nums', isIn ? 'text-emerald-700' : 'text-red-700')}><span className="inline-flex items-center">{isIn ? <ArrowDownLeft className="mr-1 h-4 w-4"/> : <ArrowUpRight className="mr-1 h-4 w-4"/>}{isIn ? '+' : '-'}{Number(entry.quantity || 0).toLocaleString('en-IN')}</span></td><td className="px-4 py-3"><p className="text-sm font-black text-[var(--ink)]">{entry.sourceDocumentNo || 'System posting'}</p><p className="mt-0.5 text-xs text-[var(--ink-4)]">{entry.referenceType || entry.sourceType || 'Ledger'}</p></td><td className="max-w-sm px-4 py-3"><p className="text-sm font-bold text-[var(--ink)]">{location?.code || entry.locationId || '—'}</p><p className="mt-0.5 line-clamp-2 text-xs leading-5 text-[var(--ink-4)]">{entry.reason || 'No additional reason recorded'}</p></td><td className="px-4 py-3"><button type="button" aria-label={`Inspect ${entry.sourceDocumentNo || entry.id}`} onClick={() => setSelectedId(selectedId === entry.id ? '' : entry.id)} className="rounded-md border border-[var(--line)] bg-[var(--surface)] p-2 text-[var(--ink-3)] hover:text-[var(--brand-700)]"><History className="h-4 w-4"/></button></td></tr>; })}{!ledger.length && !loading ? <tr><td colSpan={7} className="px-5 py-14 text-center"><Search className="mx-auto h-7 w-7 text-[var(--ink-5)]"/><p className="mt-3 font-black text-[var(--ink)]">{ledgerRaw.length ? 'No movement matches these filters' : 'No ledger entries yet'}</p><p className="mt-1 text-sm text-[var(--ink-4)]">{ledgerRaw.length ? 'Clear a filter or inspect another server page.' : 'Posted openings, GRNs and stock actions will appear here.'}</p></td></tr> : null}</tbody></table></div>
        <div className="flex items-center justify-between border-t border-[var(--line)] bg-[var(--bg-soft)] p-3"><Button type="button" size="sm" variant="outline" disabled={page === 0 || loading} onClick={() => setPage((value) => Math.max(0, value - 1))}><ChevronLeft className="mr-1 h-4 w-4"/>Previous</Button><span className="text-xs font-black uppercase tracking-wider text-[var(--ink-4)]">Server page {page + 1} · {ledgerRaw.length} loaded</span><Button type="button" size="sm" variant="outline" disabled={!hasNext || loading} onClick={() => setPage((value) => value + 1)}>Next<ChevronRight className="ml-1 h-4 w-4"/></Button></div>
      </section>

      {selected ? <section className="mp-panel overflow-hidden border-[var(--brand-200)]"><div className="flex items-start justify-between gap-4 border-b border-[var(--line)] p-5"><div><p className="text-[11px] font-black uppercase tracking-[0.16em] text-[var(--brand-700)]">Selected ledger evidence</p><h2 className="mt-1 text-xl font-black text-[var(--ink)]">{selected.sourceDocumentNo || selected.id}</h2></div><button type="button" onClick={() => setSelectedId('')} className="rounded-md p-2 text-[var(--ink-4)] hover:bg-[var(--bg-soft)]"><X className="h-4 w-4"/></button></div><div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4"><div><p className="text-[10px] font-black uppercase text-[var(--ink-4)]">Physical identity</p><p className="mt-1 text-sm font-black text-[var(--ink)]">{selected.product?.internalCode || selected.product?.sku}</p><p className="mt-1 text-xs text-[var(--ink-4)]">{selected.lotNumber || selected.lotId || 'Product-level movement'}</p></div><div><p className="text-[10px] font-black uppercase text-[var(--ink-4)]">Posting</p><p className="mt-1 text-sm font-black text-[var(--ink)]">{selected.direction} · {selected.quantity}</p><p className="mt-1 text-xs text-[var(--ink-4)]">{String(selected.type || '').replaceAll('_', ' ')}</p></div><div><p className="text-[10px] font-black uppercase text-[var(--ink-4)]">Reference</p><p className="mt-1 text-sm font-black text-[var(--ink)]">{selected.referenceType || 'System'}</p><p className="mt-1 break-all text-xs text-[var(--ink-4)]">{selected.referenceId || 'No external reference'}</p></div><div><p className="text-[10px] font-black uppercase text-[var(--ink-4)]">Audit reason</p><p className="mt-1 text-sm font-semibold leading-5 text-[var(--ink)]">{selected.reason || 'No additional reason'}</p></div></div><div className="flex flex-wrap gap-2 border-t border-[var(--line)] bg-[var(--bg-soft)] p-4"><Button asChild size="sm" variant="outline"><Link href={`/dashboard/inventory/reconciliation?productId=${selected.productId}`}><MapPinned className="mr-2 h-4 w-4"/>Reconcile this product</Link></Button>{selected.referenceId ? <Button asChild size="sm" variant="outline"><Link href="/dashboard/audit"><ExternalLink className="mr-2 h-4 w-4"/>Open system audit</Link></Button> : null}</div></section> : null}
    </StockControlWorkspace>
  );
}
