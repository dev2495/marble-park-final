'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { gql, useQuery } from '@apollo/client';
import { AlertTriangle, Bookmark, Boxes, ChevronDown, CircleDollarSign, Download, PackageCheck, PackageOpen, PackagePlus, RotateCcw, Search, SlidersHorizontal, Warehouse } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryErrorBanner } from '@/components/query-state';
import { ProductImageFrame } from '@/components/product-image-frame';

const ME = gql`
  query InventoryPageMe {
    me { id role }
  }
`;

const INVENTORY_CONTROL_TOWER = gql`
  query InventoryControlTower($search: String, $category: String, $brand: String, $stockState: String, $locationId: String, $lotState: String, $sort: String, $cursor: String, $take: Int) {
    inventoryControlTower(search: $search, category: $category, brand: $brand, stockState: $stockState, locationId: $locationId, lotState: $lotState, sort: $sort, cursor: $cursor, take: $take)
  }
`;

const GET_FILTERS = gql`
  query InventoryMasterFilters {
    productCategories
    productBrands
    stockLocations(status: "active")
  }
`;

const GET_LOW_STOCK = gql`
  query LowStockBalances($take: Int) {
    lowStockBalances(take: $take) {
      id
      onHand
      available
      reserved
      lowStockThreshold
      reorderPoint
      isLowStock
      product { id sku name brand category sellPrice media }
      updatedAt
    }
  }
`;

const stockFilters = [
  ['', 'All stock'],
  ['available', 'Available'],
  ['reserved', 'Reserved'],
  ['low_stock', 'Low stock'],
  ['out_of_stock', 'Out of stock'],
];

function money(value: number) {
  return `₹${Math.round(Number(value || 0)).toLocaleString('en-IN')}`;
}

function qty(value: number) {
  return Math.round(Number(value || 0)).toLocaleString('en-IN');
}

function label(value: string) {
  return String(value || '').replaceAll('_', ' ');
}

function tone(value: string) {
  if (value === 'available') return 'bg-emerald-50 text-emerald-800 ring-emerald-200';
  if (value === 'reserved') return 'bg-blue-50 text-blue-800 ring-blue-200';
  if (value === 'low_stock') return 'bg-amber-50 text-amber-900 ring-amber-200';
  return 'bg-red-50 text-red-800 ring-red-200';
}

function productImage(product: any) {
  const media = product?.media || {};
  const gallery = Array.isArray(media.gallery) ? media.gallery.map((entry: any) => typeof entry === 'string' ? entry : entry?.url) : [];
  return [media.primaryUrl, media.primaryImage, media.primary, ...gallery].find(Boolean) || '';
}

export default function InventoryPage() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [brand, setBrand] = useState('');
  const [stockState, setStockState] = useState('');
  const [locationId, setLocationId] = useState('');
  const [lotState, setLotState] = useState('');
  const [sort, setSort] = useState('updated_desc');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [cursor, setCursor] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const deferredSearch = useDeferredValue(search.trim());

  const { data: meData } = useQuery(ME);
  const canConfigureAlerts = meData?.me?.role === 'admin' || meData?.me?.role === 'owner';

  const { data, loading, error, refetch, fetchMore } = useQuery(INVENTORY_CONTROL_TOWER, {
    variables: {
      search: deferredSearch || undefined,
      category: category || undefined,
      brand: brand || undefined,
      stockState: stockState || undefined,
      locationId: locationId || undefined,
      lotState: lotState || undefined,
      sort,
      take: 30,
    },
    notifyOnNetworkStatusChange: true,
  });
  const { data: filterData, error: filterError } = useQuery(GET_FILTERS);
  const { data: lowStockData, error: lowStockError } = useQuery(GET_LOW_STOCK, { variables: { take: 24 } });

  const tower = data?.inventoryControlTower || { items: [], summary: {}, total: 0 };
  const summary = tower.summary || {};
  const categories = useMemo<string[]>(() => (filterData?.productCategories || []).filter(Boolean).sort(), [filterData?.productCategories]);
  const brands = useMemo<string[]>(() => (filterData?.productBrands || []).filter(Boolean).sort(), [filterData?.productBrands]);
  const locations = useMemo<any[]>(() => (filterData?.stockLocations || []).filter((row: any) => row.code !== 'IN-TRANSIT'), [filterData?.stockLocations]);
  const lowStockRows: any[] = lowStockData?.lowStockBalances || [];

  useEffect(() => {
    if (!cursor && !loading) setRows(tower.items || []);
  }, [tower.items, cursor, loading]);

  const resetPage = (next: () => void) => {
    setCursor('');
    setRows([]);
    next();
  };

  const loadMore = async () => {
    if (!tower.nextCursor || loading) return;
    const result = await fetchMore({ variables: { cursor: tower.nextCursor } });
    const nextRows = result.data?.inventoryControlTower?.items || [];
    setRows((current) => [...current, ...nextRows.filter((row: any) => !current.some((existing) => existing.id === row.id))]);
    setCursor(tower.nextCursor);
  };

  const clearFilters = () => {
    setSearch('');
    setCategory('');
    setBrand('');
    setStockState('');
    setLocationId('');
    setLotState('');
    setSort('updated_desc');
    setCursor('');
    setRows([]);
  };

  const saveView = () => {
    localStorage.setItem('mp.inventory.view', JSON.stringify({ category, brand, stockState, locationId, lotState, sort }));
  };

  useEffect(() => {
    const saved = localStorage.getItem('mp.inventory.view');
    if (!saved) return;
    try {
      const view = JSON.parse(saved);
      setCategory(view.category || ''); setBrand(view.brand || ''); setStockState(view.stockState || '');
      setLocationId(view.locationId || ''); setLotState(view.lotState || ''); setSort(view.sort || 'updated_desc');
    } catch { localStorage.removeItem('mp.inventory.view'); }
  }, []);

  const exportCsv = () => {
    const cells = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const csv = [['SKU','Product','Brand','Category','On hand','Available','Reserved','Hold','Damaged','Cost value','Retail value'], ...rows.map((row: any) => [row.product?.sku,row.product?.name,row.product?.brand,row.product?.category,row.onHand,row.available,row.reserved,row.hold,row.damaged,row.onHandValue,row.retailValue])].map((line) => line.map(cells).join(',')).join('\n');
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); link.download = 'marble-park-inventory-view.csv'; link.click(); URL.revokeObjectURL(link.href);
  };

  const stats = [
    [CircleDollarSign, 'Stock cost value', money(summary.onHandValue), 'on-hand cost basis', 'text-emerald-700', ''],
    [Boxes, 'Available units', qty(summary.available), 'ready to reserve or sell', 'text-emerald-700', 'available'],
    [Warehouse, 'Reserved units', qty(summary.reserved), 'held for open orders', 'text-blue-700', 'reserved'],
    [PackagePlus, 'Inbound units', qty(summary.inbound), 'ordered and not received', 'text-cyan-700', ''],
    [PackageOpen, 'Out of stock', qty(summary.outOfStock), 'balances needing action', 'text-amber-700', 'out_of_stock'],
    [AlertTriangle, 'Low-stock SKUs', qty(summary.lowStock), 'at or below threshold', 'text-red-700', 'low_stock'],
    [PackageCheck, 'Retail value', money(summary.retailValue), 'available list-rate basis', 'text-indigo-700', ''],
    [AlertTriangle, 'Data exceptions', qty(Number(summary.zeroSellPrice || 0) + Number(summary.zeroCostOnHand || 0)), 'missing list rate or cost', 'text-rose-700', ''],
  ] as const;

  const compositeError = error || filterError || lowStockError;
  return (
    <div className="space-y-6 pb-10">
      {compositeError ? <QueryErrorBanner error={compositeError} onRetry={() => refetch()} /> : null}

      <section className="mp-card rounded-r6 border border-[var(--line)] p-6 text-[var(--ink)] shadow-md-soft">
        <div className="flex flex-col justify-between gap-6 xl:flex-row xl:items-end">
          <div className="max-w-4xl">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--brand-700)]">Inventory control tower</p>
            <h1 className="mt-3 font-display text-3xl font-bold tracking-[-0.02em]">One view for on-hand truth, reservations and what still needs inward.</h1>
            <p className="mt-3 text-sm font-semibold leading-6 text-[var(--ink-4)]">Product Master records remain visible at zero stock. Physical availability changes only through opening stock, GRN, reservation, dispatch, return, or approved adjustment.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="lg" className="bg-[var(--brand-600)] text-white hover:bg-[var(--brand-700)]"><Link href="/dashboard/procurement"><PackagePlus className="mr-2 h-5 w-5" /> Procurement desk</Link></Button>
            <Button asChild size="lg" variant="outline"><Link href="/dashboard/inventory/inwards">Manual GRN</Link></Button>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
        {stats.map(([Icon, title, value, caption, iconTone, state]) => (
          <button type="button" onClick={() => state && resetPage(() => setStockState(state))} key={title} className="mp-card rounded-r5 border border-[var(--line)] p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--brand-300)] disabled:cursor-default">
            <Icon className={`h-5 w-5 ${iconTone}`} />
            <p className="mt-4 truncate text-2xl font-black text-[var(--ink)]">{loading && !rows.length ? '...' : value}</p>
            <p className="mt-1 text-[10px] font-black uppercase tracking-[0.14em] text-[var(--ink-4)]">{title}</p>
            <p className="mt-1 text-xs font-semibold text-[var(--ink-5)]">{caption}</p>
          </button>
        ))}
      </section>

      {lowStockRows.length > 0 ? (
        <section className="mp-card rounded-r5 border border-red-200/70 bg-red-50/60 p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-red-700">Low-stock alerts</p>
              <h2 className="mt-2 text-2xl font-semibold text-[var(--ink)]">{lowStockRows.length} SKU{lowStockRows.length === 1 ? '' : 's'} need attention</h2>
              <p className="mt-1 text-sm font-bold text-[var(--ink-4)]">Warning and critical thresholds drive bell alerts for owner, admin, and inventory managers.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {canConfigureAlerts ? (
                <Link href="/dashboard/inventory/stock-alerts" className="rounded-xl border border-red-300 bg-white px-4 py-2 text-xs font-black uppercase tracking-wider text-red-800">Configure alerts</Link>
              ) : null}
              <Link href="/dashboard/procurement" className="rounded-xl bg-red-700 px-4 py-2 text-xs font-black uppercase tracking-wider text-white">Open procurement</Link>
            </div>
          </div>
          <div className="mt-4 overflow-x-auto custom-scrollbar">
            <table className="w-full min-w-[760px] text-left">
              <thead className="text-xs font-medium uppercase tracking-widest text-red-800/80"><tr><th className="px-3 py-2">Product</th><th className="px-3 py-2 text-center">Available</th><th className="px-3 py-2 text-center">Threshold</th><th className="px-3 py-2 text-center">Reorder point</th><th className="px-3 py-2 text-right">Updated</th></tr></thead>
              <tbody className="divide-y divide-red-200/60">
                {lowStockRows.map((row: any) => <tr key={row.id} className="text-sm"><td className="px-3 py-2"><div className="font-semibold text-[var(--ink)]">{row.product?.name}</div><div className="text-xs font-medium uppercase tracking-wider text-[var(--ink-4)]">{row.product?.sku} · {row.product?.brand}</div></td><td className="px-3 py-2 text-center"><span className="rounded-full bg-red-200/80 px-3 py-1 text-sm font-black text-red-900">{qty(row.available)}</span></td><td className="px-3 py-2 text-center font-black text-blue-800">{qty(row.lowStockThreshold)}</td><td className="px-3 py-2 text-center font-black text-blue-800">{row.reorderPoint == null ? '—' : qty(row.reorderPoint)}</td><td className="px-3 py-2 text-right text-xs font-bold text-[var(--ink-4)]">{row.updatedAt ? new Date(row.updatedAt).toLocaleDateString('en-IN') : '—'}</td></tr>)}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="mp-card rounded-r5 border border-[var(--line)] p-4 shadow-sm lg:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--ink-5)]" />
            <input value={search} onChange={(event) => resetPage(() => setSearch(event.target.value))} placeholder="Search SKU, internal code, product or brand" aria-label="Search inventory" className="h-12 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] pl-12 pr-4 text-sm font-semibold text-[var(--ink)] outline-none focus:border-[var(--brand-500)] focus:ring-4 focus:ring-[var(--ring)]" />
          </div>
          <div className="flex flex-wrap gap-2">
            <select value={category} onChange={(event) => resetPage(() => setCategory(event.target.value))} aria-label="Filter by category" className="h-12 min-w-44 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-bold text-[var(--ink)] outline-none focus:border-[var(--brand-500)]"><option value="">All categories</option>{categories.map((value) => <option key={value} value={value}>{value}</option>)}</select>
            <select value={brand} onChange={(event) => resetPage(() => setBrand(event.target.value))} aria-label="Filter by brand" className="h-12 min-w-40 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-bold text-[var(--ink)] outline-none focus:border-[var(--brand-500)]"><option value="">All brands</option>{brands.map((value) => <option key={value} value={value}>{value}</option>)}</select>
            <select value={locationId} onChange={(event) => resetPage(() => setLocationId(event.target.value))} aria-label="Filter by location" className="h-12 min-w-40 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-bold text-[var(--ink)]"><option value="">All locations</option>{locations.map((row: any) => <option key={row.id} value={row.id}>{row.name || row.code}</option>)}</select>
            <select value={lotState} onChange={(event) => resetPage(() => setLotState(event.target.value))} aria-label="Filter by lot state" className="h-12 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-bold"><option value="">All quality states</option><option value="hold">On hold</option><option value="damaged">Damaged</option></select>
            <select value={sort} onChange={(event) => resetPage(() => setSort(event.target.value))} aria-label="Sort inventory" className="h-12 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-bold"><option value="updated_desc">Recently updated</option><option value="updated_asc">Oldest update</option><option value="available_desc">Available high-low</option><option value="available_asc">Available low-high</option><option value="value_desc">Stock quantity high-low</option></select>
            <button type="button" onClick={saveView} title="Save this filter view" className="inline-flex h-12 items-center rounded-2xl border border-[var(--line)] px-4 text-xs font-black uppercase"><Bookmark className="mr-2 h-4 w-4" /> Save view</button>
            <button type="button" onClick={exportCsv} title="Export loaded rows" className="inline-flex h-12 items-center rounded-2xl border border-[var(--line)] px-4 text-xs font-black uppercase"><Download className="mr-2 h-4 w-4" /> CSV</button>
            <button type="button" onClick={clearFilters} className="inline-flex h-12 items-center gap-2 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-xs font-black uppercase tracking-wider text-[var(--ink-3)] hover:border-[var(--brand-500)]"><RotateCcw className="h-4 w-4" /> Reset</button>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2 overflow-x-auto pb-1 custom-scrollbar">
          <SlidersHorizontal className="mr-1 h-4 w-4 shrink-0 text-[var(--ink-5)]" />
          {stockFilters.map(([value, title]) => <button key={value || 'all'} type="button" onClick={() => resetPage(() => setStockState(value))} className={`shrink-0 rounded-xl px-3 py-2 text-xs font-black uppercase tracking-wider ${stockState === value ? 'bg-[var(--ink)] text-white' : 'bg-[var(--muted)] text-[var(--ink-3)]'}`}>{title}</button>)}
          <span className="ml-auto hidden shrink-0 text-xs font-bold text-[var(--ink-4)] md:block">{Number(tower.total || 0).toLocaleString('en-IN')} matching balance(s)</span>
        </div>
      </section>

      <section className="overflow-hidden rounded-r5 border border-[var(--line)] bg-[var(--surface)] shadow-md-soft">
        <div className="hidden grid-cols-[1.5fr_0.85fr_0.65fr_0.65fr_0.65fr_0.9fr_0.9fr] gap-4 border-b border-[var(--line)] bg-[var(--muted)] px-5 py-4 text-[10px] font-black uppercase tracking-[0.16em] text-[var(--ink-4)] lg:grid"><div>Product master</div><div>State</div><div className="text-center">On hand</div><div className="text-center">Available</div><div className="text-center">Reserved</div><div className="text-right">Cost value</div><div className="text-right">Retail value</div></div>
        <div className="divide-y divide-[var(--line)]">
          {loading && !rows.length ? <div className="p-12 text-center text-sm font-bold text-[var(--ink-4)]">Loading inventory balances...</div> : null}
          {!loading && !rows.length ? <div className="p-12 text-center"><Boxes className="mx-auto h-8 w-8 text-[var(--brand-600)]" /><p className="mt-3 font-black text-[var(--ink)]">No inventory balances match this view.</p><p className="mt-1 text-sm font-semibold text-[var(--ink-4)]">Clear a filter or add the first Product Master SKU.</p></div> : null}
          {rows.map((row: any) => <article key={row.id} className="p-5">
            <div className="grid gap-4 lg:grid-cols-[1.5fr_0.85fr_0.65fr_0.65fr_0.65fr_0.9fr_0.9fr] lg:items-center">
            <div className="flex min-w-0 items-center gap-3"><ProductImageFrame src={productImage(row.product)} alt={row.product?.name || 'Product'} className="h-14 w-14 shrink-0 rounded-2xl" imageClassName="p-1" /><div className="min-w-0"><p className="truncate text-sm font-black text-[var(--ink)]">{row.product?.name || 'Unnamed product'}</p><p className="truncate text-xs font-bold uppercase tracking-wider text-[var(--ink-4)]">{row.product?.sku || 'No SKU'} · {row.product?.brand || 'Unbranded'}</p><p className="mt-1 text-xs font-semibold text-[var(--ink-5)]">{row.product?.category || 'Uncategorised'} · {row.product?.unit || 'PC'}</p></div></div>
            <div><span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ring-1 ${tone(row.stockState)}`}>{label(row.stockState)}</span><p className="mt-2 text-[10px] font-bold uppercase tracking-wider text-[var(--ink-5)]">Updated {row.updatedAt ? new Date(row.updatedAt).toLocaleDateString('en-IN') : '—'}</p></div>
            <div className="text-left lg:text-center"><span className="text-lg font-black text-[var(--ink)]">{qty(row.onHand)}</span><p className="text-[10px] font-bold uppercase text-[var(--ink-5)]">units</p></div>
            <div className="text-left lg:text-center"><span className="text-lg font-black text-emerald-700">{qty(row.available)}</span><p className="text-[10px] font-bold uppercase text-[var(--ink-5)]">ready</p></div>
            <div className="text-left lg:text-center"><span className="text-lg font-black text-blue-700">{qty(row.reserved)}</span><p className="text-[10px] font-bold uppercase text-[var(--ink-5)]">held</p></div>
            <div className="text-left lg:text-right"><p className="text-sm font-black text-[var(--ink)]">{money(row.onHandValue)}</p><p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ink-5)]">cost basis</p></div>
            <div className="text-left lg:text-right"><p className="text-sm font-black text-[var(--ink)]">{money(row.retailValue)}</p><p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ink-5)]">list-rate basis</p></div>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] pt-3">
              <div className="flex flex-wrap gap-2">{(row.completenessCodes || []).map((code: string) => <span key={code} className="rounded-lg bg-amber-50 px-2 py-1 text-[10px] font-black text-amber-900">{label(code)}</span>)}</div>
              <button type="button" aria-expanded={Boolean(expanded[row.id])} onClick={() => setExpanded((current) => ({ ...current, [row.id]: !current[row.id] }))} className="inline-flex items-center text-xs font-black uppercase text-[var(--brand-700)]">{row.lots?.length || 0} lot(s)<ChevronDown className={`ml-1 h-4 w-4 transition ${expanded[row.id] ? 'rotate-180' : ''}`} /></button>
            </div>
            {expanded[row.id] ? <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{(row.lots || []).map((lot: any) => <div key={lot.id} className="rounded-xl border border-[var(--line)] bg-[var(--muted)] p-3"><div className="flex justify-between gap-2"><p className="text-xs font-black text-[var(--ink)]">{lot.lotNumber}</p><span className="text-[10px] font-black uppercase text-[var(--ink-4)]">{lot.qualityStatus}</span></div><p className="mt-1 text-[10px] font-semibold text-[var(--ink-5)]">Received {lot.receivedAt ? new Date(lot.receivedAt).toLocaleDateString('en-IN') : '—'} · Cost {money(lot.unitCost)}</p>{(lot.locations || []).map((place: any) => <div key={place.id} className="mt-2 flex justify-between border-t border-[var(--line)] pt-2 text-xs"><span className="font-bold">{place.locationName || place.locationCode}</span><span className="font-black">{qty(place.available)} available · {qty(place.reserved)} reserved</span></div>)}</div>)}</div> : null}
          </article>)}
        </div>
        {tower.nextCursor ? <div className="border-t border-[var(--line)] p-4 text-center"><button type="button" disabled={loading} onClick={loadMore} className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-2 text-xs font-black uppercase tracking-wider text-[var(--brand-700)] disabled:opacity-50">{loading ? 'Loading...' : 'Load more balances'}</button></div> : null}
      </section>
    </div>
  );
}
