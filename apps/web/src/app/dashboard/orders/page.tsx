'use client';

import { useDeferredValue, useEffect, useState } from 'react';
import Link from 'next/link';
import { gql, useQuery } from '@apollo/client';
import { AlertTriangle, Bookmark, ChevronDown, Download, IndianRupee, PackageCheck, PackageOpen, Plus, Receipt, RotateCcw, Search, Truck, WalletCards } from 'lucide-react';
import { QueryErrorBanner } from '@/components/query-state';

const CONTROL_TOWER = gql`
  query SalesOrderControlTower($search: String, $fulfillmentStatus: String, $paymentMode: String, $range: String, $brand: String, $category: String, $locationId: String, $promisedRisk: String, $completeness: String, $sort: String, $cursor: String, $take: Float) {
    salesOrderControlTower(search: $search, fulfillmentStatus: $fulfillmentStatus, paymentMode: $paymentMode, range: $range, brand: $brand, category: $category, locationId: $locationId, promisedRisk: $promisedRisk, completeness: $completeness, sort: $sort, cursor: $cursor, take: $take)
  }
`;
const FILTERS = gql`query OrderControlFilters { productCategories productBrands stockLocations(status: "active") }`;

function money(value: number) {
  return `₹${Math.round(Number(value || 0)).toLocaleString('en-IN')}`;
}

function qty(value: number) {
  return Math.round(Number(value || 0)).toLocaleString('en-IN');
}

function statusLabel(value: string) {
  return String(value || 'open').replaceAll('_', ' ');
}

function statusTone(value: string) {
  const status = String(value || '').toLowerCase();
  if (status === 'delivered' || status === 'dispatched') return 'bg-emerald-50 text-emerald-800 ring-emerald-200';
  if (status === 'pending_inward') return 'bg-amber-50 text-amber-900 ring-amber-200';
  if (status === 'partial_dispatch' || status === 'partial_ready') return 'bg-blue-50 text-blue-800 ring-blue-200';
  if (status === 'ready_to_pick') return 'bg-cyan-50 text-cyan-800 ring-cyan-200';
  return 'bg-slate-100 text-slate-700 ring-slate-200';
}

const statusFilters = [
  ['all', 'All orders'],
  ['ready_to_pick', 'Ready to pick'],
  ['pending_inward', 'Pending inward'],
  ['partial_dispatch', 'Partially dispatched'],
  ['left_to_dispatch', 'Left to dispatch'],
  ['dispatched', 'Dispatched'],
  ['delivered', 'Delivered'],
];

export default function OrdersPage() {
  const [range, setRange] = useState('all');
  const [paymentMode, setPaymentMode] = useState('');
  const [fulfillmentStatus, setFulfillmentStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [brand, setBrand] = useState('');
  const [category, setCategory] = useState('');
  const [locationId, setLocationId] = useState('');
  const [promisedRisk, setPromisedRisk] = useState('');
  const [completeness, setCompleteness] = useState('');
  const [sort, setSort] = useState('newest');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [cursor, setCursor] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const deferredSearch = useDeferredValue(search);
  const { data, loading, error, refetch, fetchMore } = useQuery(CONTROL_TOWER, {
    variables: { search: deferredSearch || undefined, fulfillmentStatus, paymentMode: paymentMode || undefined, range, brand: brand || undefined, category: category || undefined, locationId: locationId || undefined, promisedRisk: promisedRisk || undefined, completeness: completeness || undefined, sort, take: 25 },
    notifyOnNetworkStatusChange: true,
  });
  const { data: filterData, error: filterError } = useQuery(FILTERS);
  const tower = data?.salesOrderControlTower || { items: [], summary: {}, total: 0 };

  useEffect(() => {
    if (!cursor) setItems(tower.items || []);
  }, [tower.items, cursor]);

  const summary = tower.summary || {};
  const brands: string[] = [...(filterData?.productBrands || [])].filter(Boolean).sort();
  const categories: string[] = [...(filterData?.productCategories || [])].filter(Boolean).sort();
  const locations: any[] = (filterData?.stockLocations || []).filter((row: any) => row.code !== 'IN-TRANSIT');
  const resetPage = (next: () => void) => {
    setCursor('');
    setItems([]);
    next();
  };
  const loadMore = async () => {
    if (!tower.nextCursor || loading) return;
    const result = await fetchMore({ variables: { cursor: tower.nextCursor } });
    const nextItems = result.data?.salesOrderControlTower?.items || [];
    setItems((current) => [...current, ...nextItems.filter((row: any) => !current.some((existing) => existing.id === row.id))]);
    setCursor(tower.nextCursor);
  };
  useEffect(() => {
    const saved = localStorage.getItem('mp.orders.view'); if (!saved) return;
    try { const view = JSON.parse(saved); setBrand(view.brand || ''); setCategory(view.category || ''); setLocationId(view.locationId || ''); setPromisedRisk(view.promisedRisk || ''); setCompleteness(view.completeness || ''); setSort(view.sort || 'newest'); } catch { localStorage.removeItem('mp.orders.view'); }
  }, []);
  const saveView = () => localStorage.setItem('mp.orders.view', JSON.stringify({ brand, category, locationId, promisedRisk, completeness, sort }));
  const clearAdvanced = () => { setBrand(''); setCategory(''); setLocationId(''); setPromisedRisk(''); setCompleteness(''); setSort('newest'); setCursor(''); setItems([]); };
  const exportCsv = () => {
    const quote = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const csv = [['Order','Customer','Status','Payment','Total','Advance','Left to dispatch','Pending inward'], ...items.map((row: any) => [row.orderNumber,row.customer?.name,row.fulfillmentStatus,row.paymentMode,row.totalAmount,row.advanceAmount,row.quantities?.leftToDispatch,row.quantities?.backordered])].map((line) => line.map(quote).join(',')).join('\n');
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); link.download = 'marble-park-order-view.csv'; link.click(); URL.revokeObjectURL(link.href);
  };

  return (
    <div className="space-y-6 pb-10">
      {error || filterError ? <QueryErrorBanner error={(error || filterError)!} onRetry={() => refetch()} /> : null}
      <section className="mp-card rounded-r6 border border-[var(--line)] p-6 text-[var(--ink)] shadow-md-soft">
        <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-end">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--brand-700)]">Operations control tower</p>
            <h1 className="mt-3 font-display text-3xl font-bold tracking-[-0.02em]">Order book, stock readiness and dispatch balance.</h1>
            <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-[var(--ink-4)]">Every quantity below is read from SalesOrderLine, reservations and dispatch records. A pending inward line stays visible until receiving creates available stock.</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-black uppercase tracking-wider text-[var(--ink-4)]">
            <Link href="/dashboard/orders/new" className="inline-flex items-center rounded-xl bg-[var(--brand-600)] px-4 py-2 text-white"><Plus className="mr-2 h-4 w-4"/>Direct order</Link>
            <span className="rounded-full bg-[var(--brand-50)] px-3 py-2">{Number(tower.total || 0).toLocaleString('en-IN')} matching orders</span>
            <span className="rounded-full bg-emerald-50 px-3 py-2 text-emerald-800">Live stock lifecycle</span>
          </div>
        </div>
      </section>

      <section className="mp-card flex flex-col gap-3 rounded-r5 border border-[var(--line)] p-3 shadow-sm lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--ink-5)]" />
          <input value={search} onChange={(event) => resetPage(() => setSearch(event.target.value))} placeholder="Search order, quote, customer, SKU or brand" aria-label="Search orders" className="h-12 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] pl-12 pr-4 text-sm font-semibold text-[var(--ink)] outline-none focus:border-[var(--brand-500)] focus:ring-4 focus:ring-[var(--ring)]" />
        </div>
        <div className="flex flex-wrap gap-2">
          {['all', 'today', 'week', 'month'].map((value) => <button key={value} type="button" onClick={() => resetPage(() => setRange(value))} className={`rounded-xl px-3 py-2 text-xs font-black uppercase tracking-wider ${range === value ? 'bg-[var(--ink)] text-white' : 'bg-[var(--muted)] text-[var(--ink-3)]'}`}>{value}</button>)}
          <span className="mx-1 hidden h-8 w-px bg-[var(--line)] sm:block" />
          {[['', 'All payment'], ['cash', 'Cash'], ['credit', 'Credit']].map(([value, label]) => <button key={label} type="button" onClick={() => resetPage(() => setPaymentMode(value))} className={`rounded-xl px-3 py-2 text-xs font-black uppercase tracking-wider ${paymentMode === value ? 'bg-[var(--brand-600)] text-white' : 'bg-[var(--muted)] text-[var(--ink-3)]'}`}>{label}</button>)}
        </div>
      </section>

      <section className="mp-card grid min-w-0 gap-2 overflow-hidden rounded-r5 border border-[var(--line)] p-3 shadow-sm sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8">
        <select value={brand} onChange={(event) => resetPage(() => setBrand(event.target.value))} aria-label="Filter orders by brand" className="h-11 w-full min-w-0 max-w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-bold"><option value="">All brands</option>{brands.map((value) => <option key={value}>{value}</option>)}</select>
        <select value={category} onChange={(event) => resetPage(() => setCategory(event.target.value))} aria-label="Filter orders by category" className="h-11 w-full min-w-0 max-w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-bold"><option value="">All categories</option>{categories.map((value) => <option key={value}>{value}</option>)}</select>
        <select value={locationId} onChange={(event) => resetPage(() => setLocationId(event.target.value))} aria-label="Filter orders by stock location" className="h-11 w-full min-w-0 max-w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-bold"><option value="">All locations</option>{locations.map((row) => <option key={row.id} value={row.id}>{row.name || row.code}</option>)}</select>
        <select value={promisedRisk} onChange={(event) => resetPage(() => setPromisedRisk(event.target.value))} aria-label="Filter promise risk" className="h-11 w-full min-w-0 max-w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-bold"><option value="">All promises</option><option value="overdue">Overdue</option><option value="due_7">Due in 7 days</option><option value="missing">Promise missing</option></select>
        <select value={completeness} onChange={(event) => resetPage(() => setCompleteness(event.target.value))} aria-label="Filter commercial completeness" className="h-11 w-full min-w-0 max-w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-bold"><option value="">All commercial data</option><option value="unpriced">Any pricing gap</option><option value="missing_mrp">MRP confirmation missing</option><option value="missing_list">List rate missing</option></select>
        <select value={sort} onChange={(event) => resetPage(() => setSort(event.target.value))} aria-label="Sort orders" className="h-11 w-full min-w-0 max-w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-bold"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="promise">Promise date</option><option value="value_desc">Value high-low</option></select>
        <button type="button" onClick={saveView} className="inline-flex h-11 min-w-0 items-center justify-center rounded-xl border border-[var(--line)] text-xs font-black uppercase"><Bookmark className="mr-2 h-4 w-4" />Save view</button>
        <div className="flex min-w-0 gap-2"><button type="button" title="Export loaded rows" onClick={exportCsv} className="inline-flex h-11 min-w-0 flex-1 items-center justify-center rounded-xl border border-[var(--line)] text-xs font-black uppercase"><Download className="mr-1 h-4 w-4" />CSV</button><button type="button" title="Reset advanced filters" onClick={clearAdvanced} className="h-11 shrink-0 rounded-xl border border-[var(--line)] px-3"><RotateCcw className="h-4 w-4" /></button></div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
        {[
          [Receipt, 'Order book', qty(summary.orders), 'orders', ''],
          [IndianRupee, 'Total value', money(summary.totalValue), 'commercial', ''],
          [WalletCards, 'Balance due', money(summary.balanceValue), 'after advance', ''],
          [PackageCheck, 'Ready to pick', qty(summary.readyToPickQty), 'units', 'ready_to_pick'],
          [Truck, 'Left to dispatch', qty(summary.leftToDispatchQty), 'units', 'left_to_dispatch'],
          [PackageOpen, 'Pending inward', qty(summary.pendingInwardQty), 'units', 'pending_inward'],
          [AlertTriangle, 'Promise risk', qty(Number(summary.overdueOrders || 0) + Number(summary.dueSoonOrders || 0)), 'overdue / due soon', 'promise'],
          [AlertTriangle, 'Pricing gaps', qty(summary.unpricedOrders), 'orders', 'unpriced'],
        ].map(([Icon, label, value, caption, action]: any) => <button type="button" onClick={() => action === 'promise' ? resetPage(() => setPromisedRisk('overdue')) : action === 'unpriced' ? resetPage(() => setCompleteness('unpriced')) : action ? resetPage(() => setFulfillmentStatus(action)) : undefined} key={label} className="mp-card rounded-r5 border border-[var(--line)] p-4 text-left shadow-sm transition hover:border-[var(--brand-300)]"><Icon className="h-5 w-5 text-[var(--brand-600)]" /><p className="mt-4 truncate text-2xl font-black text-[var(--ink)]">{loading && !items.length ? '...' : value}</p><p className="mt-1 text-[10px] font-black uppercase tracking-[0.14em] text-[var(--ink-4)]">{label}</p><p className="mt-1 text-xs font-semibold text-[var(--ink-5)]">{caption}</p></button>)}
      </section>

      <section className="mp-card rounded-r5 border border-[var(--line)] p-3 shadow-sm">
        <div className="flex items-center gap-2 overflow-x-auto pb-2 custom-scrollbar">
          {statusFilters.map(([value, label]) => <button key={value} type="button" onClick={() => resetPage(() => setFulfillmentStatus(value))} className={`shrink-0 rounded-xl px-3 py-2 text-xs font-black uppercase tracking-wider ${fulfillmentStatus === value ? 'bg-[var(--ink)] text-white' : 'bg-[var(--muted)] text-[var(--ink-3)]'}`}>{label}</button>)}
        </div>
      </section>

      <section className="overflow-hidden rounded-r5 border border-[var(--line)] bg-[var(--surface)] shadow-md-soft">
        <div className="hidden grid-cols-[1.1fr_1fr_1fr_0.8fr_1fr] gap-4 border-b border-[var(--line)] bg-[var(--muted)] px-5 py-4 text-[10px] font-black uppercase tracking-[0.16em] text-[var(--ink-4)] lg:grid">
          <div>Order / customer</div><div>Fulfilment</div><div>Payment</div><div className="text-right">Value</div><div>Documents</div>
        </div>
        <div className="divide-y divide-[var(--line)]">
          {loading && !items.length ? <div className="p-12 text-center text-sm font-bold text-[var(--ink-4)]">Loading operational order data...</div> : null}
          {!loading && !items.length ? <div className="p-12 text-center"><Receipt className="mx-auto h-8 w-8 text-[var(--brand-600)]" /><p className="mt-3 font-black text-[var(--ink)]">No orders match this view.</p><p className="mt-1 text-sm font-semibold text-[var(--ink-4)]">Change the search or status filter to inspect another part of the order book.</p></div> : null}
          {items.map((order: any) => {
            const quantities = order.quantities || {};
            const docs = order.documents || {};
            const orderPdf = docs.salesOrderPdf?.url || docs.salesOrderPdfUrl || `/api/pdf/order/${order.id}`;
            const primaryHref = order.fulfillmentStatus === 'pending_inward' ? '/dashboard/pending-inward' : order.fulfillmentStatus === 'delivered' ? `/dashboard/payments?customerId=${order.customerId}` : '/dashboard/dispatch';
            const primaryLabel = order.fulfillmentStatus === 'pending_inward' ? 'Resolve inward' : order.fulfillmentStatus === 'delivered' ? 'View account' : 'Continue fulfilment';
            return <article key={order.id} className="p-5">
              <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr_1fr_0.8fr_1fr] lg:items-center">
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="text-lg font-black text-[var(--ink)]">{order.orderNumber}</p><span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ring-1 ${statusTone(order.fulfillmentStatus)}`}>{statusLabel(order.fulfillmentStatus)}</span></div>{order.quoteId ? <Link href={`/dashboard/quotes/${order.quoteId}`} className="mt-1 block truncate text-xs font-bold text-[var(--brand-700)] hover:underline">Quote {order.quoteNumber || order.quoteId}</Link> : <p className="mt-1 text-xs font-bold text-[var(--brand-700)]">Direct sales order</p>}<p className="mt-2 truncate text-sm font-black text-[var(--ink)]">{order.customer?.name || 'Customer'}</p><p className="text-xs font-semibold text-[var(--ink-4)]">{order.owner?.name || 'Sales user'} · {order.lines?.length || 0} line(s)</p></div>
              <div className="space-y-2 text-xs font-bold text-[var(--ink-3)]"><div className="flex justify-between gap-3"><span>Reserved / ready</span><span className="text-emerald-700">{qty(quantities.reserved)} / {qty(quantities.readyToPick)}</span></div><div className="flex justify-between gap-3"><span>Left to dispatch</span><span className="text-[var(--brand-700)]">{qty(quantities.leftToDispatch)}</span></div><div className="flex justify-between gap-3"><span>Pending inward</span><span className="text-amber-800">{qty(quantities.backordered)}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-[var(--muted)]"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${quantities.ordered ? Math.min(100, (quantities.dispatched / quantities.ordered) * 100) : 0}%` }} /></div><p className="text-[10px] uppercase tracking-wider text-[var(--ink-5)]">{qty(quantities.dispatched)} / {qty(quantities.ordered)} dispatched</p></div>
              <div><span className={`inline-flex rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-wider ${order.paymentMode === 'cash' ? 'bg-emerald-50 text-emerald-800' : 'bg-blue-50 text-blue-800'}`}>{order.paymentMode} · {order.paymentStatus}</span><p className="mt-2 text-xs font-bold text-[var(--ink-4)]">Advance {money(order.advanceAmount)}</p><p className="mt-1 text-xs font-bold text-[var(--ink-4)]">{order.paymentTerms || 'Terms not recorded'}</p></div>
              <div className="text-left lg:text-right"><p className="text-xl font-black text-[var(--ink)]">{money(order.totalAmount)}</p><p className="mt-1 text-xs font-semibold text-[var(--ink-4)]">Due {money(Math.max(0, Number(order.totalAmount || 0) - Number(order.advanceAmount || 0)))}</p><p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ink-5)]">{order.promisedDate ? `Promise ${new Date(order.promisedDate).toLocaleDateString('en-IN')}` : 'No promise date'}</p></div>
              <div className="flex flex-wrap gap-2"><Link href={primaryHref} className="inline-flex items-center rounded-xl bg-[var(--brand-600)] px-3 py-2 text-[10px] font-black uppercase tracking-wider text-white"><Truck className="mr-1.5 h-3.5 w-3.5" />{primaryLabel}</Link><a href={orderPdf} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-xl border border-[var(--line)] px-3 py-2 text-[10px] font-black uppercase"><Download className="mr-1.5 h-3.5 w-3.5" /> PDF</a><button type="button" aria-expanded={Boolean(expanded[order.id])} onClick={() => setExpanded((current) => ({ ...current, [order.id]: !current[order.id] }))} className="inline-flex items-center rounded-xl bg-[var(--muted)] px-3 py-2 text-[10px] font-black uppercase">Details<ChevronDown className={`ml-1 h-4 w-4 ${expanded[order.id] ? 'rotate-180' : ''}`} /></button></div>
              </div>
              {expanded[order.id] ? <div className="mt-4 grid gap-2 border-t border-[var(--line)] pt-4 md:grid-cols-2 xl:grid-cols-3">{(order.lines || []).map((line: any) => <div key={line.id} className="rounded-xl bg-[var(--muted)] p-3"><div className="flex justify-between gap-3"><p className="truncate text-xs font-black">{line.sku} · {line.name}</p><span className="text-[10px] font-black uppercase text-[var(--ink-4)]">{statusLabel(line.status)}</span></div><p className="mt-2 text-xs font-semibold text-[var(--ink-4)]">List {money(line.listPrice)} · MRP {line.mrp == null ? 'missing' : money(line.mrp)} · Net {money(line.unitPrice)}</p><p className="mt-1 text-[10px] font-bold uppercase text-[var(--ink-5)]">{qty(line.remainingQuantity)} left · {line.mrpConfirmedAt ? 'MRP confirmed' : 'MRP confirmation missing'}</p></div>)}</div> : null}
            </article>;
          })}
        </div>
        {tower.nextCursor ? <div className="border-t border-[var(--line)] p-4 text-center"><button type="button" disabled={loading} onClick={loadMore} className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-2 text-xs font-black uppercase tracking-wider text-[var(--brand-700)] disabled:opacity-50">{loading ? 'Loading...' : 'Load more orders'}</button></div> : null}
      </section>
    </div>
  );
}
