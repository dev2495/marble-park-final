'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { gql, useMutation, useQuery } from '@apollo/client';
import { motion } from 'framer-motion';
import { CalendarClock, CheckCircle2, ClipboardList, IndianRupee, PackageCheck, PackageSearch, Send, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QueryErrorBanner } from '@/components/query-state';
import { cn } from '@/lib/utils';

const PROCUREMENT = gql`
  query ProcurementDesk {
    procurementSummary
    purchaseDemandQueue(take: 250)
    purchaseOrders(take: 80)
    goodsReceiptNotes(take: 20)
    vendors(status: "active", take: 150)
    stockLocations(status: "active")
  }
`;

const CREATE_PO = gql`
  mutation CreatePurchaseOrder($input: CreatePurchaseOrderInput!) {
    createPurchaseOrder(input: $input)
  }
`;

const RECEIVE_PO = gql`
  mutation ReceivePurchaseOrder($input: ReceivePurchaseOrderInput!) {
    receivePurchaseOrder(input: $input)
  }
`;

function money(value: number) {
  return `₹${Math.round(Number(value || 0)).toLocaleString('en-IN')}`;
}

function statusTone(status?: string) {
  if (status === 'received' || status === 'allocated') return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  if (status === 'partial_received') return 'bg-blue-50 text-blue-700 ring-blue-200';
  if (status === 'ordered') return 'bg-amber-50 text-amber-800 ring-amber-200';
  if (status === 'cancelled') return 'bg-red-50 text-red-700 ring-red-200';
  return 'bg-zinc-50 text-zinc-700 ring-zinc-200';
}

export default function ProcurementPage() {
  const [selectedDemand, setSelectedDemand] = useState<Record<string, boolean>>({});
  const [vendorId, setVendorId] = useState('');
  const [vendorName, setVendorName] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [poNotes, setPoNotes] = useState('');
  const [activePoId, setActivePoId] = useState('');
  const [receiveRows, setReceiveRows] = useState<Record<string, string>>({});
  const [receiveMessage, setReceiveMessage] = useState('');
  const [supplierChallan, setSupplierChallan] = useState('');
  const [supplierBill, setSupplierBill] = useState('');
  const [receiveLocationId, setReceiveLocationId] = useState('');

  const { data, loading, error, refetch } = useQuery(PROCUREMENT, {
    pollInterval: 120000,
    skipPollAttempt: () => typeof document !== 'undefined' && document.hidden,
    notifyOnNetworkStatusChange: false,
  });
  const [createPo, { loading: creatingPo, error: createPoError }] = useMutation(CREATE_PO, { onCompleted: () => { setSelectedDemand({}); setVendorId(''); setVendorName(''); setExpectedDate(''); setPoNotes(''); refetch(); } });
  const [receivePo, { loading: receivingPo, error: receivePoError }] = useMutation(RECEIVE_PO, { onCompleted: (result) => { setReceiveMessage(`Posted ${result.receivePurchaseOrder?.grnNumber || 'GRN'} and updated inventory/backorder allocation.`); setReceiveRows({}); setSupplierChallan(''); setSupplierBill(''); refetch(); } });

  const summary = data?.procurementSummary || {};
  const demands = useMemo<any[]>(() => data?.purchaseDemandQueue || [], [data?.purchaseDemandQueue]);
  const purchaseOrders = useMemo<any[]>(() => data?.purchaseOrders || [], [data?.purchaseOrders]);
  const grns = useMemo<any[]>(() => data?.goodsReceiptNotes || [], [data?.goodsReceiptNotes]);
  const vendors = useMemo<any[]>(() => data?.vendors || [], [data?.vendors]);
  const locations = useMemo<any[]>(() => data?.stockLocations || [], [data?.stockLocations]);
  const defaultLocation = useMemo(() => locations.find((location) => location.defaultStockScope) || locations[0], [locations]);
  const receiveLocation = useMemo(() => locations.find((location) => location.id === receiveLocationId) || defaultLocation, [defaultLocation, locations, receiveLocationId]);
  const activePo = useMemo(() => purchaseOrders.find((po) => po.id === activePoId) || purchaseOrders.find((po) => ['ordered', 'partial_received'].includes(po.status)) || purchaseOrders[0], [purchaseOrders, activePoId]);
  const selectedIds = Object.entries(selectedDemand).filter(([, checked]) => checked).map(([id]) => id);
  const selectedRows = demands.filter((row) => selectedIds.includes(row.id));
  const selectedValue = selectedRows.reduce((sum, row) => sum + Number(row.quantity || 0) * Number(row.metadata?.unitCost || 0), 0);

  useEffect(() => {
    if (!receiveLocationId && defaultLocation?.id) setReceiveLocationId(defaultLocation.id);
  }, [defaultLocation?.id, receiveLocationId]);

  const submitPo = () => {
    if (!selectedIds.length) return;
    createPo({
      variables: {
        input: {
          demandIds: selectedIds,
          vendorId: vendorId || undefined,
          vendorName: vendorName || vendors.find((vendor) => vendor.id === vendorId)?.name || selectedRows[0]?.vendorName || selectedRows[0]?.brand || 'Vendor confirmation pending',
          expectedDate: expectedDate ? new Date(expectedDate).toISOString() : undefined,
          notes: poNotes || 'Created from sales-order purchase demand.',
        },
      },
    });
  };

  const submitReceive = () => {
    if (!activePo) return;
    const lines = (activePo.lines || [])
      .map((line: any) => {
        const remaining = Math.max(0, Number(line.orderedQuantity || 0) - Number(line.receivedQuantity || 0));
        const typed = receiveRows[line.id];
        const receivedQuantity = typed === undefined ? remaining : Number(typed || 0);
        return {
          purchaseOrderLineId: line.id,
          receivedQuantity,
          damagedQuantity: 0,
          location: receiveLocation ? `${receiveLocation.code} · ${receiveLocation.name}` : 'Default plant',
          locationId: receiveLocation?.id,
        };
      })
      .filter((line: any) => Number(line.receivedQuantity || 0) > 0);
    if (!lines.length) return;
    receivePo({
      variables: {
        input: {
          purchaseOrderId: activePo.id,
          supplierChallan: supplierChallan || undefined,
          supplierBill: supplierBill || undefined,
          locationId: receiveLocation?.id || undefined,
          lines: JSON.stringify(lines),
          notes: 'Received from procurement desk.',
        },
      },
    });
  };

  return (
    <div className="space-y-7 pb-10">
      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
      {createPoError ? <QueryErrorBanner error={createPoError} /> : null}
      {receivePoError ? <QueryErrorBanner error={receivePoError} /> : null}
      {receiveMessage ? <div className="rounded-r4 border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800">{receiveMessage}</div> : null}

      <section className="relative overflow-hidden rounded-r6 border border-[var(--line)] bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 p-6 text-white shadow-sm-soft">
        <div className="absolute right-10 top-8 h-32 w-32 rounded-full bg-blue-400/25 blur-3xl" />
        <div className="relative flex flex-col justify-between gap-6 xl:flex-row xl:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-200">Procurement control</p>
            <h1 className="mt-3 font-display text-3xl font-bold tracking-[-0.03em] text-white">Turn shortages into vendor orders, then receive against PO.</h1>
            <p className="mt-3 max-w-3xl text-sm font-medium leading-6 text-blue-100">
              Sales orders create purchase demand automatically. Inventory teams group those rows into a PO, record ETA, receive GRN, and the system allocates arrived stock back to waiting customers.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-r4 border border-white/15 bg-white/10 p-4"><p className="text-2xl font-black">{summary.openDemand || 0}</p><p className="text-[10px] font-black uppercase tracking-widest text-blue-100">Open demand</p></div>
            <div className="rounded-r4 border border-white/15 bg-white/10 p-4"><p className="text-2xl font-black">{summary.activePurchaseOrders || 0}</p><p className="text-[10px] font-black uppercase tracking-widest text-blue-100">Active POs</p></div>
            <div className="rounded-r4 border border-white/15 bg-white/10 p-4"><p className="text-2xl font-black">{summary.recentGrn || 0}</p><p className="text-[10px] font-black uppercase tracking-widest text-blue-100">7d GRNs</p></div>
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="mp-panel overflow-hidden">
          <div className="border-b border-[var(--line)] p-5">
            <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-4)]">Demand queue</p>
                <h2 className="mt-2 text-2xl font-black text-[var(--ink)]">Customer orders waiting for purchase</h2>
              </div>
              <Button asChild variant="secondary"><Link href="/dashboard/pending-inward"><PackageSearch className="mr-2 h-4 w-4" /> Pending inward</Link></Button>
            </div>
          </div>

          <div className="max-h-[36rem] overflow-y-auto p-3 custom-scrollbar">
            {loading ? <div className="p-6 text-sm font-bold text-[var(--ink-3)]">Loading demand...</div> : null}
            {!loading && !demands.length ? (
              <div className="grid min-h-[18rem] place-items-center text-center">
                <div>
                  <CheckCircle2 className="mx-auto h-11 w-11 text-emerald-600" />
                  <h3 className="mt-3 text-xl font-black text-[var(--ink)]">No purchase demand open.</h3>
                  <p className="mt-2 text-sm font-semibold text-[var(--ink-3)]">New backorders and tile special orders will appear here after sales-order conversion.</p>
                </div>
              </div>
            ) : demands.map((row, index) => {
              const checked = !!selectedDemand[row.id];
              return (
                <motion.button
                  key={row.id}
                  type="button"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.02 }}
                  onClick={() => setSelectedDemand((current) => ({ ...current, [row.id]: !checked }))}
                  className={cn('mb-2 w-full rounded-r4 border p-4 text-left transition-all', checked ? 'border-[var(--brand-400)] bg-[var(--brand-50)] shadow-sm-soft' : 'border-[var(--line)] bg-[var(--surface)] hover:border-[var(--line-strong)]')}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-base font-black text-[var(--ink)]">{row.sku} · {row.name}</p>
                      <p className="mt-1 text-xs font-bold uppercase tracking-wider text-[var(--ink-4)]">{row.salesOrder?.orderNumber || 'Order'} · {row.customer?.name || 'Customer'} · {row.owner?.name || 'Sales'}</p>
                    </div>
                    <span className={cn('shrink-0 rounded-full px-3 py-1 text-[10px] font-black uppercase ring-1', statusTone(row.status))}>{row.status}</span>
                  </div>
                  <div className="mt-4 grid grid-cols-4 gap-2 text-center text-xs font-bold text-[var(--ink-4)]">
                    <span>Qty <b className="block text-lg text-[var(--ink)]">{row.quantity}</b></span>
                    <span>Ordered <b className="block text-lg text-amber-700">{row.orderedQuantity}</b></span>
                    <span>Received <b className="block text-lg text-emerald-700">{row.receivedQuantity}</b></span>
                    <span>Vendor <b className="block truncate text-[var(--ink)]">{row.vendorName || row.brand || 'Assign'}</b></span>
                  </div>
                </motion.button>
              );
            })}
          </div>

          <div className="border-t border-[var(--line)] bg-[var(--bg-soft)] p-5">
            <div className="grid gap-3 md:grid-cols-[1fr_12rem]">
              <select
                value={vendorId}
                onChange={(event) => {
                  setVendorId(event.target.value);
                  setVendorName(vendors.find((vendor) => vendor.id === event.target.value)?.name || '');
                }}
                className="h-11 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-bold text-[var(--ink)] shadow-sm-soft outline-none focus:border-[var(--brand-400)]"
              >
                <option value="">Select vendor from master</option>
                {vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
              </select>
              <Input type="date" value={expectedDate} onChange={(event) => setExpectedDate(event.target.value)} />
            </div>
            <textarea value={poNotes} onChange={(event) => setPoNotes(event.target.value)} placeholder="PO note / vendor follow-up detail" className="mt-3 min-h-[72px] w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm font-medium text-[var(--ink)] outline-none focus:border-[var(--brand-400)]" />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-bold uppercase tracking-wider text-[var(--ink-4)]">{selectedIds.length} row(s) selected · Estimated {money(selectedValue)}</p>
              <Button onClick={submitPo} disabled={!selectedIds.length || creatingPo}><Send className="mr-2 h-4 w-4" /> Create vendor PO</Button>
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <div className="mp-panel p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-4)]">GRN receive</p>
                <h2 className="mt-2 text-2xl font-black text-[var(--ink)]">Receive against purchase order</h2>
              </div>
              <Button asChild variant="secondary"><Link href="/dashboard/inventory/inwards"><PackageCheck className="mr-2 h-4 w-4" /> Full GRN page</Link></Button>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <select value={activePo?.id || ''} onChange={(event) => setActivePoId(event.target.value)} className="h-11 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-bold text-[var(--ink)]">
                {purchaseOrders.map((po) => <option key={po.id} value={po.id}>{po.poNumber} · {po.vendorName} · {po.status}</option>)}
              </select>
              <Input value={supplierChallan} onChange={(event) => setSupplierChallan(event.target.value)} placeholder="Supplier challan no." />
              <Input value={supplierBill} onChange={(event) => setSupplierBill(event.target.value)} placeholder="Supplier bill no." />
              <select value={receiveLocation?.id || ''} onChange={(event) => setReceiveLocationId(event.target.value)} className="h-11 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-bold text-[var(--ink)]">
                {locations.map((location) => <option key={location.id} value={location.id}>{location.defaultStockScope ? 'Default · ' : ''}{location.code} · {location.name}</option>)}
              </select>
              <Button onClick={submitReceive} disabled={!activePo || receivingPo}><Truck className="mr-2 h-4 w-4" /> Post GRN</Button>
            </div>

            <div className="mt-4 space-y-2">
              {!activePo ? <div className="rounded-r4 border border-dashed border-[var(--line)] p-6 text-center text-sm font-bold text-[var(--ink-4)]">No purchase order selected.</div> : (activePo.lines || []).map((line: any) => {
                const remaining = Math.max(0, Number(line.orderedQuantity || 0) - Number(line.receivedQuantity || 0));
                return (
                  <div key={line.id} className="rounded-r4 border border-[var(--line)] bg-[var(--surface)] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-[var(--ink)]">{line.sku} · {line.name}</p>
                        <p className="mt-1 text-xs font-bold uppercase tracking-wider text-[var(--ink-4)]">Ordered {line.orderedQuantity} · Received {line.receivedQuantity} · Remaining {remaining}</p>
                      </div>
                      <Input type="number" min={0} max={remaining} value={receiveRows[line.id] ?? String(remaining)} onChange={(event) => setReceiveRows((current) => ({ ...current, [line.id]: event.target.value }))} className="w-24 text-center font-black" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {purchaseOrders.slice(0, 6).map((po: any) => (
              <button key={po.id} onClick={() => setActivePoId(po.id)} className={cn('rounded-r4 border p-4 text-left shadow-sm-soft transition', activePo?.id === po.id ? 'border-[var(--brand-400)] bg-[var(--brand-50)]' : 'border-[var(--line)] bg-[var(--surface)]')}>
                <ClipboardList className="h-5 w-5 text-[var(--brand-700)]" />
                <p className="mt-3 text-sm font-black text-[var(--ink)]">{po.poNumber}</p>
                <p className="mt-1 text-xs font-bold text-[var(--ink-4)]">{po.vendorName}</p>
                <span className={cn('mt-3 inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase ring-1', statusTone(po.status))}>{po.status}</span>
              </button>
            ))}
          </div>

          <div className="mp-panel p-5">
            <div className="flex items-center gap-2"><CalendarClock className="h-5 w-5 text-[var(--brand-700)]" /><h3 className="font-black text-[var(--ink)]">Recent GRNs</h3></div>
            <div className="mt-3 space-y-2">
              {grns.map((grn: any) => (
                <div key={grn.id} className="flex items-center justify-between rounded-r4 border border-[var(--line)] bg-[var(--surface)] p-3 text-sm">
                  <div><p className="font-black text-[var(--ink)]">{grn.grnNumber}</p><p className="text-xs font-bold text-[var(--ink-4)]">{grn.vendorName}</p></div>
                  <span className="text-xs font-bold text-emerald-700">{grn.lines?.reduce((sum: number, line: any) => sum + Number(line.acceptedQuantity || 0), 0)} accepted</span>
                </div>
              ))}
              {!grns.length ? <p className="rounded-r4 border border-dashed border-[var(--line)] p-4 text-center text-sm font-bold text-[var(--ink-4)]">No GRN posted yet.</p> : null}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
