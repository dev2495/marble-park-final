'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { gql, useQuery } from '@apollo/client';
import { AlertTriangle, Boxes, CircleDollarSign, PackageCheck, PackageOpen, PackagePlus, RotateCcw, Search, SlidersHorizontal, Warehouse } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryErrorBanner } from '@/components/query-state';
import { ProductImageFrame } from '@/components/product-image-frame';

const INVENTORY_CONTROL_TOWER = gql`
  query InventoryControlTower($search: String, $category: String, $brand: String, $stockState: String, $cursor: String, $take: Int) {
    inventoryControlTower(search: $search, category: $category, brand: $brand, stockState: $stockState, cursor: $cursor, take: $take)
  }
`;

const GET_FILTERS = gql`
  query InventoryMasterFilters {
    productCategories
    productBrands
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
  const [cursor, setCursor] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const deferredSearch = useDeferredValue(search.trim());

  const { data, loading, error, refetch, fetchMore } = useQuery(INVENTORY_CONTROL_TOWER, {
    variables: {
      search: deferredSearch || undefined,
      category: category || undefined,
      brand: brand || undefined,
      stockState: stockState || undefined,
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
    setCursor('');
    setRows([]);
  };

  const stats = [
    [CircleDollarSign, 'Stock cost value', money(summary.onHandValue), 'on-hand cost basis', 'text-emerald-700'],
    [Boxes, 'Available units', qty(summary.available), 'ready to reserve or sell', 'text-emerald-700'],
    [Warehouse, 'Reserved units', qty(summary.reserved), 'held for open orders', 'text-blue-700'],
    [PackageOpen, 'Left to procure', qty(summary.outOfStock), 'out-of-stock balances', 'text-amber-700'],
    [AlertTriangle, 'Low-stock SKUs', qty(summary.lowStock), 'at or below threshold', 'text-red-700'],
    [PackageCheck, 'Retail value', money(summary.retailValue), 'available sell-price basis', 'text-indigo-700'],
    [AlertTriangle, 'Missing sell prices', qty(summary.zeroSellPrice), 'SKUs needing list-price completion', 'text-orange-700'],
    [AlertTriangle, 'Cost gaps on stock', qty(summary.zeroCostOnHand), 'on-hand units without cost basis', 'text-rose-700'],
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
        {stats.map(([Icon, title, value, caption, iconTone]) => (
          <div key={title} className="mp-card rounded-r5 border border-[var(--line)] p-4 shadow-sm">
            <Icon className={`h-5 w-5 ${iconTone}`} />
            <p className="mt-4 truncate text-2xl font-black text-[var(--ink)]">{loading && !rows.length ? '...' : value}</p>
            <p className="mt-1 text-[10px] font-black uppercase tracking-[0.14em] text-[var(--ink-4)]">{title}</p>
            <p className="mt-1 text-xs font-semibold text-[var(--ink-5)]">{caption}</p>
          </div>
        ))}
      </section>

      {lowStockRows.length > 0 ? (
        <section className="mp-card rounded-r5 border border-red-200/70 bg-red-50/60 p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-red-700">Low-stock alerts</p>
              <h2 className="mt-2 text-2xl font-semibold text-[var(--ink)]">{lowStockRows.length} SKU{lowStockRows.length === 1 ? '' : 's'} need attention</h2>
              <p className="mt-1 text-sm font-bold text-[var(--ink-4)]">The alert uses each balance&apos;s reorder point, falling back to its low-stock threshold.</p>
            </div>
            <Link href="/dashboard/procurement" className="rounded-xl bg-red-700 px-4 py-2 text-xs font-black uppercase tracking-wider text-white">Open procurement</Link>
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
          {rows.map((row: any) => <article key={row.id} className="grid gap-4 p-5 lg:grid-cols-[1.5fr_0.85fr_0.65fr_0.65fr_0.65fr_0.9fr_0.9fr] lg:items-center">
            <div className="flex min-w-0 items-center gap-3"><ProductImageFrame src={productImage(row.product)} alt={row.product?.name || 'Product'} className="h-14 w-14 shrink-0 rounded-2xl" imageClassName="p-1" /><div className="min-w-0"><p className="truncate text-sm font-black text-[var(--ink)]">{row.product?.name || 'Unnamed product'}</p><p className="truncate text-xs font-bold uppercase tracking-wider text-[var(--ink-4)]">{row.product?.sku || 'No SKU'} · {row.product?.brand || 'Unbranded'}</p><p className="mt-1 text-xs font-semibold text-[var(--ink-5)]">{row.product?.category || 'Uncategorised'} · {row.product?.unit || 'PC'}</p></div></div>
            <div><span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ring-1 ${tone(row.stockState)}`}>{label(row.stockState)}</span><p className="mt-2 text-[10px] font-bold uppercase tracking-wider text-[var(--ink-5)]">Updated {row.updatedAt ? new Date(row.updatedAt).toLocaleDateString('en-IN') : '—'}</p></div>
            <div className="text-left lg:text-center"><span className="text-lg font-black text-[var(--ink)]">{qty(row.onHand)}</span><p className="text-[10px] font-bold uppercase text-[var(--ink-5)]">units</p></div>
            <div className="text-left lg:text-center"><span className="text-lg font-black text-emerald-700">{qty(row.available)}</span><p className="text-[10px] font-bold uppercase text-[var(--ink-5)]">ready</p></div>
            <div className="text-left lg:text-center"><span className="text-lg font-black text-blue-700">{qty(row.reserved)}</span><p className="text-[10px] font-bold uppercase text-[var(--ink-5)]">held</p></div>
            <div className="text-left lg:text-right"><p className="text-sm font-black text-[var(--ink)]">{money(row.onHandValue)}</p><p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ink-5)]">cost basis</p></div>
            <div className="text-left lg:text-right"><p className="text-sm font-black text-[var(--ink)]">{money(row.retailValue)}</p><p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ink-5)]">sell-price basis</p></div>
          </article>)}
        </div>
        {tower.nextCursor ? <div className="border-t border-[var(--line)] p-4 text-center"><button type="button" disabled={loading} onClick={loadMore} className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-2 text-xs font-black uppercase tracking-wider text-[var(--brand-700)] disabled:opacity-50">{loading ? 'Loading...' : 'Load more balances'}</button></div> : null}
      </section>
    </div>
  );
}
