'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { gql, useMutation, useQuery } from '@apollo/client';
import {
  ArrowDownCircle, Boxes, ClipboardList, PackageCheck, PackagePlus, Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QueryErrorBanner, QueryLoading } from '@/components/query-state';
import { cn } from '@/lib/utils';

const INVENTORY_BALANCES = gql`
  query InwardInventoryBalances($search: String, $take: Int) {
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
    vendors(status: "active", take: 150)
    stockLocations(status: "active")
  }
`;

const CREATE_MANUAL_GRN = gql`
  mutation CreateManualGoodsReceipt($input: ManualGoodsReceiptInput!) {
    createManualGoodsReceipt(input: $input)
  }
`;

type MovementType = 'inward';

type Balance = {
  id: string;
  productId: string;
  onHand: number;
  available: number;
  reserved: number;
  damaged: number;
  updatedAt: string;
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

const movementOptions: Array<{ type: MovementType; label: string; caption: string; icon: any; tone: string }> = [
  { type: 'inward', label: 'Manual vendor GRN', caption: 'Receipt without a PO, with supplier reference and audit trail.', icon: PackagePlus, tone: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
];

function money(value?: number) {
  return `₹${Number(value || 0).toLocaleString('en-IN')}`;
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="rounded-r3 border border-[var(--line)] bg-[var(--surface)]/78 p-3 shadow-sm-soft">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-5)]">{label}</p>
      <p className={cn('mt-1 font-display text-2xl font-bold tabular-nums text-[var(--ink)]', accent)}>{Number(value || 0).toLocaleString('en-IN')}</p>
    </div>
  );
}

function previewBalance(balance: Balance | undefined, type: MovementType, quantity: number) {
  if (!balance || !quantity) return null;
  const next = {
    onHand: Number(balance.onHand || 0),
    available: Number(balance.available || 0),
    reserved: Number(balance.reserved || 0),
    damaged: Number(balance.damaged || 0),
  };
  if (type === 'inward') {
    next.onHand += quantity;
    next.available += quantity;
  }
  return next;
}

export default function InventoryInwardsPage() {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [movementType, setMovementType] = useState<MovementType>('inward');
  const [quantity, setQuantity] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [vendorName, setVendorName] = useState('');
  const [locationId, setLocationId] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [message, setMessage] = useState('');

  const { data, loading, error, refetch } = useQuery(INVENTORY_BALANCES, {
    variables: { search: search || undefined, take: 80 },
    fetchPolicy: 'cache-and-network',
  });
  const [createManualGrn, { loading: saving, error: saveError }] = useMutation(CREATE_MANUAL_GRN, {
    onCompleted: () => {
      setMessage('Manual GRN posted. Inventory balances are updated and any waiting backorder was auto-allocated.');
      setQuantity('');
      setVendorId('');
      setVendorName('');
      setLocationId('');
      setReference('');
      setNotes('');
      void refetch();
    },
  });

  const balances = useMemo<Balance[]>(() => data?.inventoryBalances || [], [data?.inventoryBalances]);
  const vendors = useMemo<any[]>(() => data?.vendors || [], [data?.vendors]);
  const locations = useMemo<any[]>(() => data?.stockLocations || [], [data?.stockLocations]);
  const defaultLocation = useMemo(() => locations.find((location) => location.defaultStockScope) || locations[0], [locations]);
  const selectedLocation = useMemo(() => locations.find((location) => location.id === locationId) || defaultLocation, [defaultLocation, locationId, locations]);
  const selected = useMemo(() => balances.find((item) => item.id === selectedId) || balances[0], [balances, selectedId]);
  const selectedProduct = selected?.product;
  const qty = Number(quantity || 0);
  const preview = previewBalance(selected, movementType, qty);
  const movement = movementOptions.find((item) => item.type === movementType) || movementOptions[0];
  const MovementIcon = movement.icon;

  useEffect(() => {
    if (!locationId && defaultLocation?.id) setLocationId(defaultLocation.id);
  }, [defaultLocation?.id, locationId]);

  const submitMovement = async () => {
    if (!selected || !qty) return;
    setMessage('');
    await createManualGrn({
      variables: {
        input: {
          vendorName: vendorName || reference || 'Manual vendor receipt',
          vendorId: vendorId || undefined,
          supplierChallan: reference || undefined,
          locationId: selectedLocation?.id || undefined,
          reason: 'manual_vendor_receipt_without_po',
          notes: notes || undefined,
          lines: JSON.stringify([{
            productId: selected.productId,
            receivedQuantity: qty,
            damagedQuantity: 0,
            location: selectedLocation ? `${selectedLocation.code} · ${selectedLocation.name}` : 'Default plant',
            locationId: selectedLocation?.id,
          }]),
        },
      },
    });
  };

  return (
    <div className="space-y-6 pb-10">
      <section className="mp-card rounded-r6 border border-[var(--line)] p-6">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--ink-4)]">GRN receiving</p>
            <h1 className="mt-3 font-display text-3xl font-bold tracking-[-0.02em] text-[var(--ink)]">Receive vendor stock against PO, or post a controlled manual GRN.</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--ink-3)]">
              Sales shortages should normally flow through Procurement → PO → GRN. Use manual GRN only for a verified vendor receipt that was not created from a purchase order.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild><Link href="/dashboard/procurement"><ClipboardList className="mr-2 h-4 w-4" /> Procurement desk</Link></Button>
            <Button asChild variant="outline"><Link href="/dashboard/inventory"><Boxes className="mr-2 h-4 w-4" /> Inventory list</Link></Button>
            <Button asChild variant="outline"><Link href="/dashboard/master-data/imports"><ClipboardList className="mr-2 h-4 w-4" /> Catalogue imports</Link></Button>
          </div>
        </div>
      </section>

      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
      {saveError ? <QueryErrorBanner error={saveError} /> : null}
      {message ? <div className="rounded-r4 border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">{message}</div> : null}

      <section className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="mp-panel overflow-hidden">
          <div className="border-b border-[var(--line)] p-5">
            <h2 className="text-lg font-semibold text-[var(--ink)]">Select inventory SKU</h2>
            <p className="mt-1 text-sm text-[var(--ink-4)]">Search by SKU, name or brand, then post a movement.</p>
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
              <p className="mx-auto mt-2 max-w-sm text-sm text-[var(--ink-4)]">Create the SKU in Product Master first. Inventory inward can only receive stock against known SKUs.</p>
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
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--ink-4)]">Selected SKU</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--ink)]">{selectedProduct?.name || 'Choose a SKU'}</h2>
                <p className="mt-1 text-sm text-[var(--ink-4)]"><span className="font-semibold text-[var(--ink-2)]">{selectedProduct?.sku || '—'}</span> · {selectedProduct?.brand || 'No brand'} · {selectedProduct?.category || 'No category'}</p>
              </div>
              <span className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1 text-xs font-semibold text-[var(--ink-3)]">{selectedProduct?.unit || 'PC'}</span>
            </div>

            {selected ? (
              <div className="mt-5 grid gap-3 sm:grid-cols-4">
                <Stat label="On hand" value={selected.onHand} />
                <Stat label="Available" value={selected.available} accent="text-emerald-600" />
                <Stat label="Reserved" value={selected.reserved} accent="text-blue-600" />
                <Stat label="Damaged" value={selected.damaged} accent="text-red-600" />
              </div>
            ) : null}
          </div>

          <div className="mp-panel p-5">
            <div className="flex items-center gap-3">
              <div className={cn('grid h-10 w-10 place-items-center rounded-md border', movement.tone)}><MovementIcon className="h-5 w-5" /></div>
              <div>
                <h3 className="text-lg font-semibold text-[var(--ink)]">Post stock movement</h3>
                <p className="text-sm text-[var(--ink-4)]">{movement.caption}</p>
              </div>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="space-y-2 sm:col-span-2">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-4)]">Movement type</span>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {movementOptions.map((option) => {
                    const Icon = option.icon;
                    const active = movementType === option.type;
                    return (
                      <button
                        key={option.type}
                        type="button"
                        onClick={() => setMovementType(option.type)}
                        className={cn('rounded-r3 border p-3 text-left transition-all', active ? `${option.tone} shadow-sm-soft` : 'border-[var(--line)] bg-[var(--surface)] hover:bg-[var(--bg-soft)]')}
                      >
                        <Icon className="h-4 w-4" />
                        <p className="mt-2 text-sm font-semibold">{option.label}</p>
                      </button>
                    );
                  })}
                </div>
              </label>

              <label className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-4)]">Quantity</span>
                <Input type="number" min={1} step={1} value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder="e.g. 12" />
              </label>
              <label className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-4)]">Vendor master</span>
                <select
                  value={vendorId}
                  onChange={(event) => {
                    setVendorId(event.target.value);
                    setVendorName(vendors.find((vendor) => vendor.id === event.target.value)?.name || '');
                  }}
                  className="h-10 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--ink)] shadow-sm-soft outline-none transition-colors focus:border-[var(--brand-400)] focus:ring-2 focus:ring-[var(--ring)]"
                >
                  <option value="">Select supplier from Vendor Master</option>
                  {vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
                </select>
              </label>
              <label className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-4)]">Supplier challan / bill</span>
                <Input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Vendor challan or bill number" />
              </label>
              <label className="space-y-2 sm:col-span-2">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-4)]">Receive into plant / stock location</span>
                <select
                  value={selectedLocation?.id || ''}
                  onChange={(event) => setLocationId(event.target.value)}
                  className="h-10 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--ink)] shadow-sm-soft outline-none transition-colors focus:border-[var(--brand-400)] focus:ring-2 focus:ring-[var(--ring)]"
                >
                  {locations.map((location) => <option key={location.id} value={location.id}>{location.defaultStockScope ? 'Default · ' : ''}{location.code} · {location.name}</option>)}
                </select>
              </label>
              <label className="space-y-2 sm:col-span-2">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-4)]">Notes</span>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Supplier name, storage location, approval note, or customer reservation context"
                  className="min-h-[86px] w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--ink)] shadow-sm-soft outline-none transition-colors placeholder:text-[var(--ink-5)] focus:border-[var(--brand-400)] focus:ring-2 focus:ring-[var(--ring)]"
                />
              </label>
            </div>

            {preview ? (
              <div className="mt-5 rounded-r4 border border-[var(--line)] bg-[var(--bg-soft)] p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-4)]">Balance preview after save</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-4">
                  <Stat label="On hand" value={preview.onHand} />
                  <Stat label="Available" value={preview.available} accent="text-emerald-600" />
                  <Stat label="Reserved" value={preview.reserved} accent="text-blue-600" />
                  <Stat label="Damaged" value={preview.damaged} accent="text-red-600" />
                </div>
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button onClick={submitMovement} disabled={!selected || !qty || !vendorName || saving}>
                <ArrowDownCircle className="mr-2 h-4 w-4" />
                {saving ? 'Posting...' : 'Post manual GRN'}
              </Button>
              <Button type="button" variant="outline" onClick={() => { setQuantity(''); setVendorId(''); setVendorName(''); setLocationId(defaultLocation?.id || ''); setReference(''); setNotes(''); setMessage(''); }}>Clear</Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
