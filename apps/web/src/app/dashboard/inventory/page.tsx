'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { gql, useMutation, useQuery } from '@apollo/client';
import {
  AlertTriangle, Boxes, PackagePlus, RotateCcw, Search, ShieldAlert, ShieldCheck,
  SlidersHorizontal, Undo2, Warehouse,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QueryErrorBanner } from '@/components/query-state';
import { cn } from '@/lib/utils';

const GET_INVENTORY = gql`
  query InventoryBalances($search: String, $take: Int) {
    inventoryBalances(search: $search, take: $take) {
      id
      productId
      onHand
      available
      reserved
      damaged
      lowStockThreshold
      reorderPoint
      isLowStock
      product { id sku name brand sellPrice category finish unit media }
      updatedAt
    }
  }
`;

const GET_DASHBOARD = gql`
  query InventoryDashboard {
    inventoryDashboard { summary }
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

const UPDATE_INVENTORY = gql`
  mutation UpdateInventoryPolicy($id: ID!, $input: UpdateInventoryInput!) {
    updateInventory(id: $id, input: $input) {
      id
      available
      lowStockThreshold
      reorderPoint
      isLowStock
      updatedAt
    }
  }
`;

const ADJUST_INVENTORY = gql`
  mutation AdjustInventoryControl($id: ID!, $adjustment: Float!, $type: String!, $notes: String) {
    adjustInventory(id: $id, adjustment: $adjustment, type: $type, notes: $notes) {
      id
      onHand
      available
      reserved
      damaged
      lowStockThreshold
      reorderPoint
      isLowStock
      updatedAt
      product { id sku name brand category finish unit media sellPrice }
    }
  }
`;

type InventoryBalance = {
  id: string;
  productId: string;
  onHand: number;
  available: number;
  reserved: number;
  damaged: number;
  lowStockThreshold?: number;
  reorderPoint?: number | null;
  isLowStock?: boolean;
  updatedAt?: string;
  product?: {
    id: string;
    sku?: string;
    name?: string;
    brand?: string;
    sellPrice?: number;
    category?: string;
    finish?: string;
    unit?: string;
    media?: any;
  } | null;
};

type ControlAction = 'release' | 'damage' | 'adjustment';

const controlActions: Array<{ type: ControlAction; label: string; caption: string; icon: any; tone: string }> = [
  { type: 'release', label: 'Release reserve', caption: 'Return reserved quantity back to available stock.', icon: Undo2, tone: 'text-sky-700 bg-sky-50 border-sky-200' },
  { type: 'damage', label: 'Mark damaged', caption: 'Move available stock into damaged stock after inspection.', icon: ShieldAlert, tone: 'text-red-700 bg-red-50 border-red-200' },
  { type: 'adjustment', label: 'Physical adjustment', caption: 'Correct stock after physical count. Use negative quantity to reduce.', icon: RotateCcw, tone: 'text-violet-700 bg-violet-50 border-violet-200' },
];

function money(value: number) {
  return `₹${Math.round(value || 0).toLocaleString('en-IN')}`;
}

function qty(value?: number) {
  return Number(value || 0).toLocaleString('en-IN');
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="rounded-r3 border border-[var(--line)] bg-[var(--surface)]/78 p-3 shadow-sm-soft">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-5)]">{label}</p>
      <p className={cn('mt-1 font-display text-2xl font-bold tabular-nums text-[var(--ink)]', accent)}>{qty(value)}</p>
    </div>
  );
}

function imageFor(item: InventoryBalance) {
  return item.product?.media?.primary || '/catalogue-art/faucet.svg';
}

export default function InventoryPage() {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [controlAction, setControlAction] = useState<ControlAction>('release');
  const [controlQty, setControlQty] = useState('');
  const [controlRef, setControlRef] = useState('');
  const [controlNotes, setControlNotes] = useState('');
  const [policyThreshold, setPolicyThreshold] = useState('');
  const [policyReorder, setPolicyReorder] = useState('');
  const [message, setMessage] = useState('');

  const { data, loading, error, refetch } = useQuery(GET_INVENTORY, { variables: { search: search || undefined, take: 220 }, fetchPolicy: 'cache-and-network' });
  const { data: dashboardData, error: dashboardError, refetch: refetchDashboard } = useQuery(GET_DASHBOARD);
  const { data: lowStockData, error: lowStockError, refetch: refetchLowStock } = useQuery(GET_LOW_STOCK, { variables: { take: 24 } });
  const [updateInventory, { loading: savingPolicy, error: policyError }] = useMutation(UPDATE_INVENTORY);
  const [adjustInventory, { loading: savingMovement, error: movementError }] = useMutation(ADJUST_INVENTORY);

  const lowStockRows: InventoryBalance[] = lowStockData?.lowStockBalances || [];
  const balances: InventoryBalance[] = data?.inventoryBalances || [];
  const selected = useMemo(() => balances.find((item) => item.id === selectedId) || balances[0], [balances, selectedId]);
  const dashboard = dashboardData?.inventoryDashboard?.summary || {};
  const reservedRows = useMemo(() => balances.filter((item) => Number(item.reserved || 0) > 0), [balances]);
  const activeAction = controlActions.find((item) => item.type === controlAction) || controlActions[0];
  const ActiveActionIcon = activeAction.icon;

  useEffect(() => {
    if (!selected) return;
    setPolicyThreshold(String(selected.lowStockThreshold ?? 5));
    setPolicyReorder(selected.reorderPoint === null || selected.reorderPoint === undefined ? '' : String(selected.reorderPoint));
    setControlQty('');
    setControlRef('');
    setControlNotes('');
    setMessage('');
  }, [selected?.id]);

  const refreshAll = async () => {
    await Promise.all([refetch(), refetchDashboard(), refetchLowStock()]);
  };

  const savePolicy = async () => {
    if (!selected) return;
    setMessage('');
    await updateInventory({
      variables: {
        id: selected.id,
        input: {
          lowStockThreshold: Math.max(0, Number(policyThreshold || 0)),
          reorderPoint: policyReorder.trim() === '' ? null : Math.max(0, Number(policyReorder)),
        },
      },
    });
    setMessage(`Low-stock policy saved for ${selected.product?.sku || 'SKU'}.`);
    await refreshAll();
  };

  const postControl = async () => {
    if (!selected) return;
    setMessage('');
    const amount = Number(controlQty || 0);
    if (!amount) {
      setMessage('Enter a quantity before posting the stock control action.');
      return;
    }
    if (controlAction !== 'adjustment' && amount <= 0) {
      setMessage('Release reserve and mark damaged require a positive quantity.');
      return;
    }
    const notes = [
      controlRef.trim() ? `Ref: ${controlRef.trim()}` : '',
      controlNotes.trim(),
      selected.product?.sku ? `SKU: ${selected.product.sku}` : '',
    ].filter(Boolean).join(' • ');
    await adjustInventory({ variables: { id: selected.id, adjustment: amount, type: controlAction, notes: notes || undefined } });
    setMessage(`${activeAction.label} posted for ${selected.product?.sku || 'SKU'}.`);
    setControlQty('');
    setControlRef('');
    setControlNotes('');
    await refreshAll();
  };

  const stats = [
    { label: 'Stock valuation', value: money(dashboard.totalValue || 0), icon: ShieldCheck, tone: 'text-emerald-700 bg-emerald-50' },
    { label: 'Available qty', value: qty(dashboard.totalAvailable || 0), icon: Boxes, tone: 'text-emerald-700 bg-emerald-50' },
    { label: 'Reserved qty', value: qty(dashboard.totalReserved || 0), icon: Warehouse, tone: 'text-blue-700 bg-blue-50' },
    { label: 'Low stock', value: qty(dashboard.lowStock || 0), icon: AlertTriangle, tone: 'text-red-700 bg-red-50' },
  ];

  return (
    <div className="space-y-7 pb-10">
      <section className="grid gap-5 lg:grid-cols-[0.82fr_1.18fr]">
        <div className="mp-hero relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_16%,rgba(59,130,246,0.22),transparent_32%),radial-gradient(circle_at_88%_85%,rgba(16,185,129,0.18),transparent_28%)]" />
          <div className="relative">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--ink-4)]">Inventory truth</p>
            <h1 className="mt-4 font-display text-3xl font-bold leading-tight tracking-[-0.02em] text-[var(--ink)]">Stock dashboard, reservations and exception controls.</h1>
            <p className="mt-5 text-sm leading-6 text-[var(--ink-3)]">GRN inward adds stock. Quote confirmation reserves stock. Dispatch consumes stock. This page handles policy, reserved visibility, damage and count corrections.</p>
            <div className="mt-7 flex flex-wrap gap-2">
              <Button asChild size="lg" className="bg-[#2563eb] text-white hover:bg-[#1d4ed8]"><Link href="/dashboard/inventory/inwards"><PackagePlus className="mr-2 h-5 w-5" /> New GRN inward</Link></Button>
              <Button asChild size="lg" variant="outline"><Link href="/dashboard/dispatch">Open dispatch</Link></Button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {stats.map((stat) => (
            <div key={stat.label} className="mp-kpi mp-kpi-tint-neutral">
              <div className={cn('grid h-12 w-12 place-items-center rounded-2xl', stat.tone)}><stat.icon className="h-6 w-6" strokeWidth={1.5} /></div>
              <div className="mt-5 text-3xl font-black tracking-tight text-[var(--ink)]">{stat.value}</div>
              <div className="mt-1 text-sm font-black text-[var(--ink-3)]">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
      {dashboardError ? <QueryErrorBanner error={dashboardError} /> : null}
      {lowStockError ? <QueryErrorBanner error={lowStockError} /> : null}
      {policyError ? <QueryErrorBanner error={policyError} /> : null}
      {movementError ? <QueryErrorBanner error={movementError} /> : null}
      {message ? <div className={cn('rounded-r4 border p-4 text-sm font-semibold', message.includes('posted') || message.includes('saved') ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800')}>{message}</div> : null}

      {lowStockRows.length > 0 ? (
        <section className="mp-card rounded-r5 border border-red-200/70 bg-red-50/60 p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-red-700">Low-stock alerts</p>
              <h2 className="mt-2 text-2xl font-semibold text-[var(--ink)]">{lowStockRows.length} SKU{lowStockRows.length === 1 ? '' : 's'} need re-ordering</h2>
              <p className="mt-1 text-sm font-bold text-[var(--ink-3)]">Set policy per SKU in Inventory controls below. Reorder point overrides threshold when present.</p>
            </div>
          </div>
          <div className="mt-4 overflow-x-auto custom-scrollbar">
            <table className="w-full min-w-[760px] text-left">
              <thead className="text-xs font-medium uppercase tracking-widest text-red-800/80">
                <tr>
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2 text-center">Available</th>
                  <th className="px-3 py-2 text-center">Threshold</th>
                  <th className="px-3 py-2 text-center">Reorder pt.</th>
                  <th className="px-3 py-2 text-right">Last updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-red-200/60">
                {lowStockRows.map((row) => (
                  <tr key={row.id} className="text-sm">
                    <td className="px-3 py-2">
                      <div className="font-semibold text-[var(--ink)]">{row.product?.name}</div>
                      <div className="text-xs font-medium uppercase tracking-wider text-[var(--ink-3)]">{row.product?.sku} · {row.product?.brand}</div>
                    </td>
                    <td className="px-3 py-2 text-center"><span className="rounded-full bg-red-200/80 px-3 py-1 text-sm font-black text-red-900">{row.available}</span></td>
                    <td className="px-3 py-2 text-center font-black text-[#1d4ed8]">{row.lowStockThreshold}</td>
                    <td className="px-3 py-2 text-center font-black text-[#1d4ed8]">{row.reorderPoint ?? '—'}</td>
                    <td className="px-3 py-2 text-right text-xs font-bold text-[var(--ink-3)]">{row.updatedAt ? new Date(row.updatedAt).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="mp-panel overflow-hidden">
          <div className="border-b border-[var(--line)] p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-[var(--ink)]">Inventory register</h2>
                <p className="mt-1 text-sm text-[var(--ink-4)]">Click a SKU to view policy and stock-control actions.</p>
              </div>
              <div className="relative max-w-xl flex-1 lg:max-w-sm">
                <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--ink-4)]" />
                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search SKU, brand or product..." aria-label="Search inventory" className="h-[3rem] pl-12" />
              </div>
            </div>
          </div>

          <div className="max-h-[44rem] overflow-y-auto p-3 custom-scrollbar">
            {loading && !balances.length ? <p className="px-5 py-12 text-center text-sm font-bold text-[var(--ink-4)]">Loading inventory...</p> : null}
            {!loading && !balances.length ? <p className="px-5 py-12 text-center text-sm font-bold text-[var(--ink-4)]">No inventory rows found.</p> : null}
            {balances.map((item) => {
              const active = selected?.id === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={cn('mb-2 w-full rounded-r4 border p-3 text-left transition-all', active ? 'border-[var(--brand-400)] bg-[var(--brand-50)] shadow-sm-soft' : 'border-[var(--line)] bg-[var(--surface)] hover:bg-[var(--bg-soft)]')}
                >
                  <div className="flex items-center gap-3">
                    <img src={imageFor(item)} alt="" className="h-12 w-12 rounded-2xl bg-[var(--bg-soft)] object-contain p-1" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-[var(--ink)]">{item.product?.name}</div>
                      <div className="truncate text-xs font-medium uppercase tracking-wider text-[var(--ink-4)]">{item.product?.sku} · {item.product?.brand} · {item.product?.category}</div>
                    </div>
                    <div className="text-right">
                      <div className={cn('rounded-full px-3 py-1 text-sm font-black', item.isLowStock ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700')}>Avail {qty(item.available)}</div>
                      <div className="mt-1 text-xs font-semibold text-[var(--ink-4)]">{money((item.available || 0) * (item.product?.sellPrice || 0))}</div>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-4 gap-2 text-center text-[11px] font-medium text-[var(--ink-4)]">
                    <span>On hand <b className="block text-[var(--ink)]">{qty(item.onHand)}</b></span>
                    <span>Available <b className="block text-emerald-600">{qty(item.available)}</b></span>
                    <span>Reserved <b className="block text-blue-600">{qty(item.reserved)}</b></span>
                    <span>Damaged <b className="block text-red-600">{qty(item.damaged)}</b></span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-5">
          <div className="mp-panel p-5">
            <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--ink-4)]">Selected SKU</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--ink)]">{selected?.product?.name || 'Choose a SKU'}</h2>
                <p className="mt-1 text-sm text-[var(--ink-4)]"><span className="font-semibold text-[var(--ink-2)]">{selected?.product?.sku || '—'}</span> · {selected?.product?.brand || 'No brand'} · {selected?.product?.category || 'No category'}</p>
              </div>
              <span className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1 text-xs font-semibold text-[var(--ink-3)]">{selected?.product?.unit || 'PC'}</span>
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
              <div className="grid h-10 w-10 place-items-center rounded-md border border-[var(--brand-100)] bg-[var(--brand-50)] text-[var(--brand-700)]"><SlidersHorizontal className="h-5 w-5" /></div>
              <div>
                <h3 className="text-lg font-semibold text-[var(--ink)]">Low-stock policy</h3>
                <p className="text-sm text-[var(--ink-4)]">Set per-SKU alert thresholds for purchase planning.</p>
              </div>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-4)]">Low stock threshold</span>
                <Input type="number" min={0} step={1} value={policyThreshold} onChange={(event) => setPolicyThreshold(event.target.value)} placeholder="e.g. 5" />
              </label>
              <label className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-4)]">Reorder point</span>
                <Input type="number" min={0} step={1} value={policyReorder} onChange={(event) => setPolicyReorder(event.target.value)} placeholder="Optional override" />
              </label>
            </div>
            <Button className="mt-5" onClick={savePolicy} disabled={!selected || savingPolicy}>Save policy</Button>
          </div>

          <div className="mp-panel p-5">
            <div className="flex items-center gap-3">
              <div className={cn('grid h-10 w-10 place-items-center rounded-md border', activeAction.tone)}><ActiveActionIcon className="h-5 w-5" /></div>
              <div>
                <h3 className="text-lg font-semibold text-[var(--ink)]">Inventory controls</h3>
                <p className="text-sm text-[var(--ink-4)]">Manual exceptions only. Normal reserve and consume happen through quote and dispatch flows.</p>
              </div>
            </div>

            <div className="mt-5 grid gap-2 sm:grid-cols-3">
              {controlActions.map((option) => {
                const Icon = option.icon;
                const active = controlAction === option.type;
                return (
                  <button key={option.type} type="button" onClick={() => setControlAction(option.type)} className={cn('rounded-r3 border p-3 text-left transition-all', active ? `${option.tone} shadow-sm-soft` : 'border-[var(--line)] bg-[var(--surface)] hover:bg-[var(--bg-soft)]')}>
                    <Icon className="h-4 w-4" />
                    <p className="mt-2 text-sm font-semibold">{option.label}</p>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-[var(--ink-4)]">{activeAction.caption}</p>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-4)]">Quantity</span>
                <Input type="number" step={1} value={controlQty} onChange={(event) => setControlQty(event.target.value)} placeholder={controlAction === 'adjustment' ? 'e.g. -2 or 5' : 'e.g. 2'} />
              </label>
              <label className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-4)]">Reference / reason</span>
                <Input value={controlRef} onChange={(event) => setControlRef(event.target.value)} placeholder="Audit ref or reason" />
              </label>
              <label className="space-y-2 sm:col-span-2">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-4)]">Notes</span>
                <textarea value={controlNotes} onChange={(event) => setControlNotes(event.target.value)} placeholder="Count sheet, damage note, customer cancellation, approval context..." className="min-h-[86px] w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--ink)] shadow-sm-soft outline-none transition-colors placeholder:text-[var(--ink-5)] focus:border-[var(--brand-400)] focus:ring-2 focus:ring-[var(--ring)]" />
              </label>
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <Button onClick={postControl} disabled={!selected || !controlQty || savingMovement}>Post control action</Button>
              <Button type="button" variant="outline" onClick={() => { setControlQty(''); setControlRef(''); setControlNotes(''); setMessage(''); }}>Clear</Button>
            </div>
          </div>
        </div>
      </section>

      <section className="mp-panel p-5">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--ink-4)]">Reserved stock</p>
            <h2 className="mt-2 text-2xl font-semibold text-[var(--ink)]">Customer-held inventory</h2>
            <p className="mt-1 text-sm text-[var(--ink-4)]">Quote confirmation creates these reservations. Dispatch consumes reserved quantities when challans are shipped.</p>
          </div>
          <Button asChild variant="outline"><Link href="/dashboard/orders">Open sales orders</Link></Button>
        </div>
        <div className="mt-5 overflow-x-auto custom-scrollbar">
          <table className="w-full min-w-[860px] text-left">
            <thead className="text-xs font-medium uppercase tracking-widest text-[var(--ink-4)]">
              <tr>
                <th className="px-3 py-2">Product</th>
                <th className="px-3 py-2 text-center">On hand</th>
                <th className="px-3 py-2 text-center">Available</th>
                <th className="px-3 py-2 text-center">Reserved</th>
                <th className="px-3 py-2 text-right">Value held</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line-soft)]">
              {reservedRows.length ? reservedRows.map((item) => (
                <tr key={item.id}>
                  <td className="px-3 py-3">
                    <div className="font-semibold text-[var(--ink)]">{item.product?.name}</div>
                    <div className="text-xs text-[var(--ink-4)]">{item.product?.sku} · {item.product?.brand} · {item.product?.category}</div>
                  </td>
                  <td className="px-3 py-3 text-center font-semibold tabular-nums text-[var(--ink)]">{qty(item.onHand)}</td>
                  <td className="px-3 py-3 text-center font-semibold tabular-nums text-emerald-600">{qty(item.available)}</td>
                  <td className="px-3 py-3 text-center"><span className="rounded-full bg-blue-100 px-3 py-1 text-sm font-black text-blue-700">{qty(item.reserved)}</span></td>
                  <td className="px-3 py-3 text-right font-semibold text-[var(--ink)]">{money((item.reserved || 0) * (item.product?.sellPrice || 0))}</td>
                </tr>
              )) : (
                <tr><td colSpan={5} className="px-3 py-10 text-center text-sm text-[var(--ink-4)]">No reserved stock right now.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
