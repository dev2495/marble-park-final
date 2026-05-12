'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { gql, useMutation, useQuery } from '@apollo/client';
import {
  Boxes, ClipboardList, FileCheck2, PackageCheck, PackagePlus, Search, Trash2, Truck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QueryErrorBanner, QueryLoading } from '@/components/query-state';
import { cn } from '@/lib/utils';

const INVENTORY_BALANCES = gql`
  query GrnInventoryBalances($search: String, $take: Int) {
    inventoryBalances(search: $search, take: $take) {
      id
      productId
      onHand
      available
      reserved
      damaged
      lowStockThreshold
      reorderPoint
      updatedAt
      product {
        id
        sku
        name
        category
        brand
        finish
        dimensions
        unit
        sellPrice
      }
    }
  }
`;

const ADJUST_INVENTORY = gql`
  mutation ReceiveInventory($id: ID!, $adjustment: Float!, $type: String!, $notes: String) {
    adjustInventory(id: $id, adjustment: $adjustment, type: $type, notes: $notes) {
      id
      onHand
      available
      reserved
      damaged
      updatedAt
      product { id sku name category brand finish unit }
    }
  }
`;

type Balance = {
  id: string;
  productId: string;
  onHand: number;
  available: number;
  reserved: number;
  damaged: number;
  lowStockThreshold?: number;
  reorderPoint?: number | null;
  updatedAt?: string;
  product?: {
    id: string;
    sku?: string;
    name?: string;
    category?: string;
    brand?: string;
    finish?: string;
    dimensions?: string;
    unit?: string;
    sellPrice?: number;
  } | null;
};

type GrnLine = {
  balanceId: string;
  quantity: string;
  rate: string;
  location: string;
  notes: string;
};

function money(value?: number) {
  return `₹${Number(value || 0).toLocaleString('en-IN')}`;
}

function qty(value?: number) {
  return Number(value || 0).toLocaleString('en-IN');
}

export default function InventoryInwardsPage() {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [vendor, setVendor] = useState('');
  const [grnRef, setGrnRef] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [remarks, setRemarks] = useState('');
  const [rows, setRows] = useState<GrnLine[]>([]);
  const [message, setMessage] = useState('');

  const { data, loading, error, refetch } = useQuery(INVENTORY_BALANCES, {
    variables: { search: search || undefined, take: 80 },
    fetchPolicy: 'cache-and-network',
  });
  const [receiveInventory, { loading: saving, error: saveError }] = useMutation(ADJUST_INVENTORY);

  const balances: Balance[] = data?.inventoryBalances || [];
  const selected = useMemo(() => balances.find((item) => item.id === selectedId) || balances[0], [balances, selectedId]);
  const byId = useMemo(() => new Map(balances.map((item) => [item.id, item] as const)), [balances]);

  const addSelectedLine = () => {
    if (!selected) return;
    setMessage('');
    setRows((current) => {
      if (current.some((line) => line.balanceId === selected.id)) return current;
      return [...current, { balanceId: selected.id, quantity: '', rate: selected.product?.sellPrice ? String(selected.product.sellPrice) : '', location: '', notes: '' }];
    });
  };

  const updateLine = (index: number, patch: Partial<GrnLine>) => {
    setRows((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  };

  const removeLine = (index: number) => {
    setRows((current) => current.filter((_, i) => i !== index));
  };

  const totalQty = rows.reduce((sum, line) => sum + Math.max(0, Number(line.quantity || 0)), 0);
  const totalValue = rows.reduce((sum, line) => sum + Math.max(0, Number(line.quantity || 0)) * Math.max(0, Number(line.rate || 0)), 0);
  const selectedUnit = selected?.product?.unit || 'PC';

  const submitGrn = async () => {
    setMessage('');
    const validRows = rows.filter((line) => Number(line.quantity || 0) > 0 && byId.has(line.balanceId));
    if (!validRows.length) {
      setMessage('Add at least one SKU with received quantity before posting GRN.');
      return;
    }
    if (!grnRef.trim()) {
      setMessage('GRN / challan reference is required for audit trail.');
      return;
    }

    await Promise.all(validRows.map((line) => {
      const balance = byId.get(line.balanceId);
      const product = balance?.product;
      const notes = [
        `GRN: ${grnRef.trim()}`,
        vendor.trim() ? `Vendor: ${vendor.trim()}` : '',
        invoiceDate ? `Date: ${invoiceDate}` : '',
        line.location.trim() ? `Location: ${line.location.trim()}` : '',
        line.rate ? `Rate: ${line.rate}` : '',
        remarks.trim(),
        line.notes.trim(),
        product?.sku ? `SKU: ${product.sku}` : '',
      ].filter(Boolean).join(' • ');
      return receiveInventory({ variables: { id: line.balanceId, adjustment: Number(line.quantity), type: 'inward', notes } });
    }));

    setMessage(`GRN ${grnRef.trim()} posted. ${qty(totalQty)} units received and inventory availability updated.`);
    setRows([]);
    setRemarks('');
    await refetch();
  };

  return (
    <div className="space-y-6 pb-10">
      <section className="mp-hero relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_18%,rgba(16,185,129,0.18),transparent_28%),radial-gradient(circle_at_92%_12%,rgba(59,130,246,0.14),transparent_28%)]" />
        <div className="relative flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--ink-4)]">Goods receipt note</p>
            <h1 className="mt-3 font-display text-3xl font-bold tracking-[-0.02em] text-[var(--ink)]">Receive vendor stock against existing SKUs.</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--ink-3)]">
              This is only for inward/GRN entry. Quote confirmation reserves stock automatically, dispatch consumes stock automatically, and exceptions live in Inventory controls.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline"><Link href="/dashboard/inventory"><Boxes className="mr-2 h-4 w-4" /> Inventory controls</Link></Button>
            <Button asChild variant="outline"><Link href="/dashboard/master-data/imports"><ClipboardList className="mr-2 h-4 w-4" /> Catalogue imports</Link></Button>
          </div>
        </div>
      </section>

      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
      {saveError ? <QueryErrorBanner error={saveError} /> : null}
      {message ? <div className={cn('rounded-r4 border p-4 text-sm font-semibold', message.includes('posted') ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800')}>{message}</div> : null}

      <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="mp-panel overflow-hidden">
          <div className="border-b border-[var(--line)] p-5">
            <h2 className="text-lg font-semibold text-[var(--ink)]">Pick SKU to receive</h2>
            <p className="mt-1 text-sm text-[var(--ink-4)]">Search existing inventory SKUs. New SKU creation stays in Product Master.</p>
            <div className="mt-4 flex h-10 items-center rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 shadow-sm-soft">
              <Search className="mr-2 h-4 w-4 text-[var(--ink-4)]" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search SKU, name, brand..."
                className="w-full bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-5)]"
              />
            </div>
          </div>

          {loading && !balances.length ? <div className="p-5"><QueryLoading label="Loading inventory SKUs..." /></div> : null}

          {!loading && !balances.length ? (
            <div className="p-8 text-center">
              <PackageCheck className="mx-auto h-10 w-10 text-[var(--ink-5)]" />
              <h3 className="mt-3 text-lg font-semibold text-[var(--ink)]">No inventory SKUs found</h3>
              <p className="mx-auto mt-2 max-w-sm text-sm text-[var(--ink-4)]">Create the SKU in Product Master first, then receive it here.</p>
              <Button asChild className="mt-5"><Link href="/dashboard/master-data/products">Open Product Master</Link></Button>
            </div>
          ) : (
            <div className="max-h-[34rem] overflow-y-auto p-3 custom-scrollbar">
              {balances.map((balance) => {
                const product = balance.product;
                const active = selected?.id === balance.id;
                return (
                  <button
                    key={balance.id}
                    type="button"
                    onClick={() => setSelectedId(balance.id)}
                    className={cn(
                      'mb-2 w-full rounded-r3 border p-3 text-left transition-all',
                      active ? 'border-[var(--brand-400)] bg-[var(--brand-50)] shadow-sm-soft' : 'border-[var(--line)] bg-[var(--surface)] hover:border-[var(--line-strong)] hover:bg-[var(--bg-soft)]',
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[var(--ink)]">{product?.sku || 'NO-SKU'} · {product?.name || 'Unnamed SKU'}</p>
                        <p className="mt-1 truncate text-xs text-[var(--ink-4)]">{product?.category || 'Uncategorized'} · {product?.brand || 'No brand'} · {product?.finish || 'No finish'}</p>
                      </div>
                      <span className="shrink-0 rounded-full bg-[var(--bg-soft)] px-2 py-1 text-xs font-semibold tabular-nums text-[var(--ink)]">Avail {balance.available}</span>
                    </div>
                    <div className="mt-3 grid grid-cols-4 gap-2 text-center text-[11px] font-medium text-[var(--ink-4)]">
                      <span>On hand <b className="block text-[var(--ink)]">{balance.onHand}</b></span>
                      <span>Reserved <b className="block text-[var(--ink)]">{balance.reserved}</b></span>
                      <span>Damaged <b className="block text-[var(--ink)]">{balance.damaged}</b></span>
                      <span>{money(product?.sellPrice)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-5">
          <div className="mp-panel p-5">
            <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--ink-4)]">Selected for GRN</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--ink)]">{selected?.product?.name || 'Choose a SKU'}</h2>
                <p className="mt-1 text-sm text-[var(--ink-4)]"><span className="font-semibold text-[var(--ink-2)]">{selected?.product?.sku || '—'}</span> · {selected?.product?.brand || 'No brand'} · {selected?.product?.category || 'No category'}</p>
              </div>
              <span className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1 text-xs font-semibold text-[var(--ink-3)]">{selectedUnit}</span>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-4">
              <div className="rounded-r3 border border-[var(--line)] bg-[var(--surface)]/78 p-3"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-5)]">On hand</p><p className="mt-1 font-display text-2xl font-bold tabular-nums text-[var(--ink)]">{qty(selected?.onHand)}</p></div>
              <div className="rounded-r3 border border-[var(--line)] bg-[var(--surface)]/78 p-3"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-5)]">Available</p><p className="mt-1 font-display text-2xl font-bold tabular-nums text-emerald-600">{qty(selected?.available)}</p></div>
              <div className="rounded-r3 border border-[var(--line)] bg-[var(--surface)]/78 p-3"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-5)]">Reserved</p><p className="mt-1 font-display text-2xl font-bold tabular-nums text-blue-600">{qty(selected?.reserved)}</p></div>
              <div className="rounded-r3 border border-[var(--line)] bg-[var(--surface)]/78 p-3"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-5)]">Damaged</p><p className="mt-1 font-display text-2xl font-bold tabular-nums text-red-600">{qty(selected?.damaged)}</p></div>
            </div>
            <Button type="button" onClick={addSelectedLine} disabled={!selected} className="mt-5"><PackagePlus className="mr-2 h-4 w-4" /> Add selected SKU to GRN</Button>
          </div>

          <div className="mp-panel p-5">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700"><Truck className="h-5 w-5" /></div>
              <div>
                <h3 className="text-lg font-semibold text-[var(--ink)]">GRN header</h3>
                <p className="text-sm text-[var(--ink-4)]">Saved in inventory movement notes for audit and vendor traceability.</p>
              </div>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-4)]">Vendor / supplier</span>
                <Input value={vendor} onChange={(event) => setVendor(event.target.value)} placeholder="e.g. Hindware distributor" />
              </label>
              <label className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-4)]">GRN / challan ref</span>
                <Input value={grnRef} onChange={(event) => setGrnRef(event.target.value)} placeholder="GRN-0001 / bill no." />
              </label>
              <label className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-4)]">Invoice date</span>
                <Input type="date" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} />
              </label>
              <label className="space-y-2 sm:col-span-2">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-4)]">GRN remarks</span>
                <textarea
                  value={remarks}
                  onChange={(event) => setRemarks(event.target.value)}
                  placeholder="Transport details, received by, storage note, pending invoice differences..."
                  className="min-h-[72px] w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--ink)] shadow-sm-soft outline-none transition-colors placeholder:text-[var(--ink-5)] focus:border-[var(--brand-400)] focus:ring-2 focus:ring-[var(--ring)]"
                />
              </label>
            </div>
          </div>
        </div>
      </section>

      <section className="mp-panel p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--ink-4)]">GRN lines</p>
            <h2 className="mt-2 text-2xl font-semibold text-[var(--ink)]">Received SKUs</h2>
            <p className="mt-1 text-sm text-[var(--ink-4)]">Each line posts one inward movement. Backordered quote items auto-reserve when matching stock arrives.</p>
          </div>
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <div className="rounded-r3 border border-[var(--line)] bg-[var(--bg-soft)] px-4 py-2"><span className="text-[var(--ink-4)]">Total qty</span><b className="ml-2 text-[var(--ink)]">{qty(totalQty)}</b></div>
            <div className="rounded-r3 border border-[var(--line)] bg-[var(--bg-soft)] px-4 py-2"><span className="text-[var(--ink-4)]">Approx value</span><b className="ml-2 text-[var(--ink)]">{money(totalValue)}</b></div>
          </div>
        </div>

        <div className="mt-5 overflow-x-auto custom-scrollbar">
          <table className="w-full min-w-[980px] text-left">
            <thead className="text-xs font-medium uppercase tracking-widest text-[var(--ink-4)]">
              <tr>
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2 text-center">Current avail</th>
                <th className="px-3 py-2">Qty received</th>
                <th className="px-3 py-2">Rate</th>
                <th className="px-3 py-2">Location</th>
                <th className="px-3 py-2">Line note</th>
                <th className="px-3 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line-soft)]">
              {rows.length ? rows.map((line, index) => {
                const balance = byId.get(line.balanceId);
                const product = balance?.product;
                return (
                  <tr key={line.balanceId}>
                    <td className="px-3 py-3">
                      <div className="font-semibold text-[var(--ink)]">{product?.sku || 'NO-SKU'}</div>
                      <div className="text-xs text-[var(--ink-4)]">{product?.name || 'Unnamed SKU'} · {product?.brand || 'No brand'}</div>
                    </td>
                    <td className="px-3 py-3 text-center font-semibold tabular-nums text-[var(--ink)]">{qty(balance?.available)}</td>
                    <td className="px-3 py-3"><Input type="number" min={1} step={1} value={line.quantity} onChange={(event) => updateLine(index, { quantity: event.target.value })} placeholder="0" /></td>
                    <td className="px-3 py-3"><Input type="number" min={0} step={0.01} value={line.rate} onChange={(event) => updateLine(index, { rate: event.target.value })} placeholder="Rate" /></td>
                    <td className="px-3 py-3"><Input value={line.location} onChange={(event) => updateLine(index, { location: event.target.value })} placeholder="Rack / bay" /></td>
                    <td className="px-3 py-3"><Input value={line.notes} onChange={(event) => updateLine(index, { notes: event.target.value })} placeholder="Optional" /></td>
                    <td className="px-3 py-3 text-right"><Button type="button" variant="ghost" size="sm" onClick={() => removeLine(index)}><Trash2 className="h-4 w-4" /></Button></td>
                  </tr>
                );
              }) : (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-sm text-[var(--ink-4)]">No GRN lines yet. Select a SKU and add it to this receipt.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button onClick={submitGrn} disabled={!rows.length || saving}>
            <FileCheck2 className="mr-2 h-4 w-4" />
            {saving ? 'Posting GRN...' : 'Post GRN inward'}
          </Button>
          <Button type="button" variant="outline" onClick={() => { setRows([]); setMessage(''); }}>Clear lines</Button>
        </div>
      </section>
    </div>
  );
}
