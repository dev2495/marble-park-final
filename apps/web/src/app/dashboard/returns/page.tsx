'use client';

import { useMemo, useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import { AlertTriangle, CheckCircle2, PackageCheck, RotateCcw, Search, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QueryErrorBanner, QueryLoading } from '@/components/query-state';

const DATA = gql`
  query ReturnsPage($search: String) {
    returnableDispatchLines(search: $search, take: 120)
    returnOrders(take: 60)
    stockLocations(status: "active")
  }
`;

const CREATE = gql`
  mutation CreateReturnOrder($input: ReturnOrderInput!) {
    createReturnOrder(input: $input)
  }
`;

const money = (value: number) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export default function ReturnsPage() {
  const [search, setSearch] = useState('');
  const [selectedLineId, setSelectedLineId] = useState('');
  const [qty, setQty] = useState('1');
  const [reason, setReason] = useState('');
  const [disposition, setDisposition] = useState('inspect');
  const [locationId, setLocationId] = useState('');
  const [refundMode, setRefundMode] = useState('none');
  const [refundAmount, setRefundAmount] = useState('0');
  const [returnKey, setReturnKey] = useState(() => crypto.randomUUID());
  const { data, loading, error, refetch } = useQuery(DATA, { variables: { search: search || undefined }, fetchPolicy: 'cache-and-network' });
  const [create, createState] = useMutation(CREATE, {
    onCompleted: () => {
      setSelectedLineId(''); setQty('1'); setReason(''); setDisposition('inspect'); setRefundMode('none'); setRefundAmount('0'); setReturnKey(crypto.randomUUID()); refetch();
    },
  });

  const lines = useMemo<any[]>(() => data?.returnableDispatchLines || [], [data?.returnableDispatchLines]);
  const returns = useMemo<any[]>(() => data?.returnOrders || [], [data?.returnOrders]);
  const locations = useMemo<any[]>(() => (data?.stockLocations || []).filter((row: any) => row.code !== 'IN-TRANSIT'), [data?.stockLocations]);
  const defaultLocationId = locations.find((row: any) => row.defaultStockScope)?.id || locations[0]?.id || '';
  const selected = lines.find((row) => row.id === selectedLineId) || null;
  const receiveLocationId = locationId || defaultLocationId;

  const submit = () => {
    const quantity = Number(qty || 0);
    if (!selected || quantity <= 0 || quantity > Number(selected.returnableQuantity || 0) || !receiveLocationId) return;
    create({ variables: { input: {
      salesOrderId: selected.salesOrderId,
      challanId: selected.challanId,
      customerId: selected.challan?.customerId,
      locationId: receiveLocationId,
      reason: reason.trim() || 'Customer return',
      refundMode: refundMode === 'none' ? undefined : refundMode,
      refundAmount: refundMode === 'none' ? 0 : Number(refundAmount || 0),
      receive: true,
      idempotencyKey: returnKey,
      lines: JSON.stringify([{ dispatchLineId: selected.id, productId: selected.productId, sku: selected.sku, name: selected.name, quantity, disposition }]),
      metadata: { source: 'delivered_challan_return', challanNumber: selected.challan?.challanNumber },
    } } });
  };

  return <div className="space-y-5 pb-10">
    <header className="flex flex-col justify-between gap-4 border-b border-[var(--line)] pb-5 pt-2 lg:flex-row lg:items-end">
      <div><p className="text-xs font-semibold uppercase text-[var(--ink-4)]">Reverse logistics</p><h1 className="mt-1 font-display text-3xl font-bold text-[var(--ink)]">Returns from delivered challans</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-3)]">Select the delivered line so the system restores the original inward lot, caps the returnable quantity, and records the inspection outcome.</p></div>
      <div className="grid grid-cols-2 gap-2 text-center"><div className="rounded-md border border-[var(--line)] bg-[var(--surface)] px-4 py-3"><p className="text-xl font-semibold tabular-nums text-[var(--ink)]">{lines.length}</p><p className="text-xs text-[var(--ink-4)]">Returnable lines</p></div><div className="rounded-md border border-[var(--line)] bg-[var(--surface)] px-4 py-3"><p className="text-xl font-semibold tabular-nums text-[var(--ink)]">{returns.length}</p><p className="text-xs text-[var(--ink-4)]">Recent returns</p></div></div>
    </header>
    {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
    {createState.error ? <QueryErrorBanner error={createState.error} /> : null}
    <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
      <div className="mp-panel overflow-hidden">
        <div className="border-b border-[var(--line)] p-4"><div className="flex h-10 items-center rounded-md border border-[var(--line)] bg-[var(--bg-soft)] px-3"><Search className="mr-2 h-4 w-4 text-[var(--ink-4)]"/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search SKU or product name" className="w-full bg-transparent text-sm outline-none"/></div></div>
        {loading && !lines.length ? <div className="p-5"><QueryLoading label="Loading delivered items..."/></div> : null}
        <div className="max-h-[38rem] divide-y divide-[var(--line)] overflow-y-auto">{lines.map((line: any) => <button key={line.id} type="button" onClick={() => { setSelectedLineId(line.id); setQty('1'); }} className={`grid w-full gap-3 p-4 text-left sm:grid-cols-[1fr_auto] ${selectedLineId === line.id ? 'bg-[var(--brand-50)]' : 'hover:bg-[var(--bg-soft)]'}`}><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-[var(--ink)]">{line.sku}</span><span className="rounded bg-[var(--bg-soft)] px-2 py-1 text-xs text-[var(--ink-4)]">{line.lot?.lotNumber}</span></div><p className="mt-1 truncate text-sm text-[var(--ink-3)]">{line.name}</p><p className="mt-2 text-xs text-[var(--ink-4)]">{line.challan?.challanNumber} · {line.salesOrder?.orderNumber} · {line.challan?.customer?.name}</p></div><div className="text-left sm:text-right"><p className="text-xl font-semibold tabular-nums text-[var(--ink)]">{line.returnableQuantity}</p><p className="text-xs text-[var(--ink-4)]">returnable</p><p className="mt-2 text-xs text-[var(--ink-4)]">{line.location?.code}</p></div></button>)}</div>
        {!loading && !lines.length ? <div className="grid min-h-56 place-items-center p-6 text-center"><div><CheckCircle2 className="mx-auto h-8 w-8 text-emerald-700"/><p className="mt-3 font-semibold text-[var(--ink)]">No delivered quantity is awaiting return</p></div></div> : null}
      </div>
      <div className="space-y-4">
        <div className="mp-panel p-4"><div className="flex items-center gap-2"><RotateCcw className="h-5 w-5 text-[var(--brand-700)]"/><h2 className="text-lg font-semibold text-[var(--ink)]">Receive return</h2></div>{selected ? <div className="mt-4 space-y-3"><div className="rounded-md border border-[var(--line)] bg-[var(--bg-soft)] p-3"><p className="font-semibold text-[var(--ink)]">{selected.sku} · {selected.name}</p><p className="mt-1 text-xs text-[var(--ink-4)]">Source {selected.challan?.challanNumber} · lot {selected.lot?.lotNumber} · maximum {selected.returnableQuantity}</p></div><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-[var(--ink-4)]">Quantity<Input className="mt-1" type="number" min={1} max={selected.returnableQuantity} value={qty} onChange={(event) => setQty(event.target.value)}/></label><label className="text-xs font-semibold text-[var(--ink-4)]">Receive at<select value={receiveLocationId} onChange={(event) => setLocationId(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm">{locations.map((row: any) => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}</select></label></div><label className="block text-xs font-semibold text-[var(--ink-4)]">Inspection outcome<select value={disposition} onChange={(event) => setDisposition(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm"><option value="inspect">Hold for inspection</option><option value="resell">Return to available stock</option><option value="damaged">Damaged stock</option><option value="supplier_return">Return to supplier hold</option><option value="scrap">Scrap / write-off queue</option></select></label><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-[var(--ink-4)]">Financial action<select value={refundMode} onChange={(event) => setRefundMode(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm"><option value="none">No refund now</option><option value="store_credit">Store credit</option><option value="refund">Refund due</option><option value="order_adjustment">Adjust customer balance</option></select></label>{refundMode !== 'none' ? <label className="text-xs font-semibold text-[var(--ink-4)]">Amount<Input className="mt-1" type="number" min={0} value={refundAmount} onChange={(event) => setRefundAmount(event.target.value)} placeholder="0"/></label> : null}</div><textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Return reason and inspection note" className="min-h-20 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--brand-500)]"/><div className="flex items-center justify-between gap-3"><p className="text-xs text-[var(--ink-4)]">{refundMode === 'none' ? 'Inventory-only return' : `${refundMode.replace('_', ' ')} ${money(Number(refundAmount || 0))}`}</p><Button onClick={submit} disabled={createState.loading || !reason.trim() || Number(qty || 0) <= 0 || Number(qty || 0) > Number(selected.returnableQuantity || 0)}><PackageCheck className="mr-2 h-4 w-4"/>Post received return</Button></div></div> : <div className="grid min-h-64 place-items-center text-center"><div><ShieldCheck className="mx-auto h-8 w-8 text-[var(--ink-5)]"/><p className="mt-3 font-semibold text-[var(--ink)]">Select a delivered line</p><p className="mt-1 text-sm text-[var(--ink-4)]">Lot and quantity controls will load here.</p></div></div>}</div>
        <div className="mp-panel overflow-hidden"><div className="border-b border-[var(--line)] p-4"><h2 className="text-lg font-semibold text-[var(--ink)]">Recent return register</h2></div><div className="max-h-72 divide-y divide-[var(--line)] overflow-y-auto">{returns.map((row: any) => <div key={row.id} className="p-3"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-[var(--ink)]">{row.returnNumber}</p><p className="mt-1 text-xs text-[var(--ink-4)]">{row.reason}</p></div><span className={`rounded px-2 py-1 text-xs font-semibold ${row.status === 'received' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{row.status}</span></div>{Number(row.refundAmount || 0) > 0 ? <p className="mt-2 text-xs font-semibold text-[var(--ink-3)]">{row.refundMode?.replace('_', ' ')} · {money(row.refundAmount)}</p> : null}{(row.lines || []).map((line: any) => <p key={line.id} className="mt-1 text-xs text-[var(--ink-4)]">{line.sku} · {line.quantity} · {line.disposition}</p>)}</div>)}</div></div>
      </div>
    </section>
    {selected && Number(qty || 0) > Number(selected.returnableQuantity || 0) ? <div className="flex items-center gap-2 text-sm font-semibold text-red-700"><AlertTriangle className="h-4 w-4"/>Quantity exceeds the delivered balance.</div> : null}
  </div>;
}
