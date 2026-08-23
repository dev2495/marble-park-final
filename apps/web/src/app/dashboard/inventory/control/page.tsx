'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import {
  AlertTriangle, ArrowRight, Ban, BadgeCheck, CalendarCheck, Check, CheckCircle2,
  ClipboardCheck, History, Scale, Search, ShieldCheck, Truck, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QueryErrorBanner, QueryLoading } from '@/components/query-state';
import { StockControlWorkspace } from '@/components/inventory/stock-control-workspace';
import { cn } from '@/lib/utils';

const DATA = gql`query InventoryControlDesk {
  inventoryControlTower(take: 1)
  stockReconciliation(take: 50)
  stockAdjustmentRequests(take: 100)
  inventoryPeriodCloses(take: 50)
  stockCountSessions(take: 50)
  openingStockSessions(take: 30)
  stockTransfers(take: 100)
  inventoryLots(status: "active", take: 200)
}`;
const REQUEST = gql`mutation RequestAdjustment($input: StockAdjustmentRequestInput!) { requestStockAdjustment(input: $input) }`;
const DECIDE = gql`mutation DecideAdjustment($id: ID!, $action: String!, $input: StockAdjustmentDecisionInput) { decideStockAdjustment(id: $id, action: $action, input: $input) }`;
const CLOSE = gql`mutation ClosePeriod($input: InventoryPeriodCloseInput!) { closeInventoryPeriod(input: $input) }`;

type Desk = 'board' | 'adjustments' | 'close';

const DESKS: Array<{ id: Desk; label: string; caption: string; icon: any }> = [
  { id: 'board', label: 'Control board', caption: 'Priorities and exceptions', icon: ShieldCheck },
  { id: 'adjustments', label: 'Adjustments', caption: 'Request, approve and audit', icon: Scale },
  { id: 'close', label: 'Period close', caption: 'Validate and lock', icon: CalendarCheck },
];

const statusTone = (status: string) => status === 'posted' || status === 'closed' || status === 'approved'
  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
  : status === 'rejected' || status === 'cancelled'
    ? 'bg-slate-100 text-slate-700 border-slate-200'
    : 'bg-amber-50 text-amber-800 border-amber-200';

export default function InventoryControlPage() {
  const now = new Date();
  const [desk, setDesk] = useState<Desk>('board');
  const [lotId, setLotId] = useState('');
  const [lotSearch, setLotSearch] = useState('');
  const [requestStatus, setRequestStatus] = useState('pending');
  const [rejectingId, setRejectingId] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [adjustment, setAdjustment] = useState({ type: 'increase', quantity: '1', reason: '' });
  const [period, setPeriod] = useState({ periodType: 'monthly', periodKey: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`, countSessionId: '', effectiveAt: now.toISOString().slice(0, 10), notes: '' });
  const { data, loading, error, refetch } = useQuery(DATA, { fetchPolicy: 'cache-and-network' });
  const [request, requestState] = useMutation(REQUEST, { onCompleted: () => { setAdjustment({ type: 'increase', quantity: '1', reason: '' }); setLotId(''); refetch(); } });
  const [decide, decideState] = useMutation(DECIDE, { onCompleted: () => { setRejectingId(''); setRejectReason(''); refetch(); } });
  const [close, closeState] = useMutation(CLOSE, { onCompleted: () => { setPeriod((current) => ({ ...current, countSessionId: '', notes: '' })); refetch(); } });

  const requests = useMemo<any[]>(() => data?.stockAdjustmentRequests || [], [data?.stockAdjustmentRequests]);
  const closes = useMemo<any[]>(() => data?.inventoryPeriodCloses || [], [data?.inventoryPeriodCloses]);
  const counts = useMemo<any[]>(() => data?.stockCountSessions || [], [data?.stockCountSessions]);
  const openings = useMemo<any[]>(() => data?.openingStockSessions || [], [data?.openingStockSessions]);
  const transfers = useMemo<any[]>(() => data?.stockTransfers || [], [data?.stockTransfers]);
  const lots = useMemo<any[]>(() => data?.inventoryLots || [], [data?.inventoryLots]);
  const tower = data?.inventoryControlTower?.summary || {};
  const reconciliation = data?.stockReconciliation?.summary || {};
  const reconciliationRows = useMemo<any[]>(() => data?.stockReconciliation?.rows || [], [data?.stockReconciliation?.rows]);
  const pendingRequests = useMemo(() => requests.filter((row) => row.status === 'pending'), [requests]);
  const openCounts = useMemo(() => counts.filter((row) => !['posted', 'cancelled'].includes(row.status)), [counts]);
  const openTransfers = useMemo(() => transfers.filter((row) => ['submitted', 'approved', 'in_transit'].includes(row.status)), [transfers]);
  const pendingOpenings = useMemo(() => openings.filter((row) => row.status !== 'posted'), [openings]);
  const selectedLot = lots.find((lot: any) => lot.id === lotId);
  const visibleLots = useMemo(() => {
    const query = lotSearch.trim().toLowerCase();
    return lots.filter((lot: any) => !query || [lot.lotNumber, lot.supplierBatch, lot.product?.sku, lot.product?.internalCode, lot.product?.name, lot.goodsReceiptLines?.[0]?.goodsReceiptNote?.grnNumber].filter(Boolean).join(' ').toLowerCase().includes(query)).slice(0, 24);
  }, [lotSearch, lots]);
  const shownRequests = requestStatus === 'all' ? requests : requests.filter((row) => row.status === requestStatus);
  const eligibleCounts = counts.filter((count) => count.status === 'posted' && count.countType === period.periodType && (!period.periodKey || count.periodKey === period.periodKey));
  const selectedCount = counts.find((count) => count.id === period.countSessionId);
  const closeChecks = [
    { label: 'Matching physical count posted', complete: Boolean(selectedCount), detail: selectedCount ? `${selectedCount.countNumber} · variance ${selectedCount.totalVariance || 0}` : 'Select the posted count for this exact period.' },
    { label: 'Transfers cleared', complete: openTransfers.length === 0, detail: openTransfers.length ? `${openTransfers.length} transfer(s) still submitted, approved or in transit.` : 'No stock is in an unfinished transfer.' },
    { label: 'Reconciliation clear', complete: Number(reconciliation.critical || 0) === 0, detail: Number(reconciliation.critical || 0) ? `${reconciliation.critical} critical stock mismatch(es) require review.` : `${Number(reconciliation.productsChecked || 0).toLocaleString('en-IN')} products reconcile.` },
    { label: 'Close note recorded', complete: period.notes.trim().length >= 8, detail: period.notes.trim().length >= 8 ? 'Review evidence is documented.' : 'Describe what was checked before locking the period.' },
  ];
  const closeReady = closeChecks.every((check) => check.complete);

  async function submitAdjustment() {
    const balance = selectedLot?.balances?.find((row: any) => Number(row.onHand) > 0) || selectedLot?.balances?.[0];
    if (!selectedLot || !balance) return;
    await request({ variables: { input: { productId: selectedLot.productId, lotId: selectedLot.id, locationId: balance.locationId, quantity: Number(adjustment.quantity), type: adjustment.type, reason: adjustment.reason } } });
  }

  const runbook = [
    { label: 'Capture physical truth', detail: openCounts.length ? `${openCounts.length} count session(s) awaiting posting` : 'No submitted count is waiting', href: '/dashboard/inventory/stock-count', action: 'Open count desk', state: openCounts.length ? 'attention' : 'ready', icon: ClipboardCheck },
    { label: 'Resolve balance exceptions', detail: Number(reconciliation.critical || 0) ? `${reconciliation.critical} critical · ${reconciliation.warnings || 0} warning` : `${Number(reconciliation.productsChecked || 0).toLocaleString('en-IN')} products aligned`, href: '/dashboard/inventory/reconciliation', action: 'Investigate', state: Number(reconciliation.critical || 0) ? 'blocked' : 'ready', icon: BadgeCheck },
    { label: 'Decide governed corrections', detail: pendingRequests.length ? `${pendingRequests.length} request(s) need an owner decision` : 'No adjustment approval is waiting', href: '#adjustments', action: 'Review requests', state: pendingRequests.length ? 'attention' : 'ready', icon: Scale, desk: 'adjustments' as Desk },
    { label: 'Finish stock in transit', detail: openTransfers.length ? `${openTransfers.length} open transfer(s)` : 'No unfinished transfer', href: '/dashboard/inventory/transfers', action: 'Open transfers', state: openTransfers.length ? 'attention' : 'ready', icon: Truck },
    { label: 'Close the reviewed period', detail: closes[0] ? `Latest close ${closes[0].periodKey}` : 'No inventory period has been closed', href: '#close', action: 'Open close desk', state: closes[0] ? 'ready' : 'attention', icon: CalendarCheck, desk: 'close' as Desk },
  ];

  return <StockControlWorkspace
    title="Stock control cockpit"
    description="One operating desk for physical counts, investigated variances, approved corrections, trace evidence and period lock. Start with exceptions; open forms only when action is required."
    action={<Button asChild><Link href="/dashboard/inventory/stock-count"><ClipboardCheck className="mr-2 h-4 w-4"/>Start physical count</Link></Button>}
    metrics={[
      { label: 'Control status', value: Number(reconciliation.critical || 0) ? 'Blocked' : pendingRequests.length || openTransfers.length ? 'Work due' : 'Ready', note: Number(reconciliation.critical || 0) ? `${reconciliation.critical} critical reconciliation mismatch(es)` : 'No critical stock mismatch', tone: Number(reconciliation.critical || 0) ? 'danger' : pendingRequests.length || openTransfers.length ? 'warning' : 'success' },
      { label: 'On hand', value: Number(tower.total || 0).toLocaleString('en-IN'), note: `${Number(tower.available || 0).toLocaleString('en-IN')} available · ${Number(tower.reserved || 0).toLocaleString('en-IN')} reserved` },
      { label: 'Restricted stock', value: (Number(tower.hold || 0) + Number(tower.damaged || 0)).toLocaleString('en-IN'), note: `${Number(tower.hold || 0).toLocaleString('en-IN')} hold · ${Number(tower.damaged || 0).toLocaleString('en-IN')} damaged`, tone: Number(tower.hold || 0) + Number(tower.damaged || 0) ? 'warning' : 'success' },
      { label: 'Open control work', value: openCounts.length + pendingRequests.length + pendingOpenings.length, note: `${openCounts.length} counts · ${pendingRequests.length} corrections · ${pendingOpenings.length} openings`, tone: openCounts.length + pendingRequests.length + pendingOpenings.length ? 'warning' : 'success' },
      { label: 'Movement blockers', value: openTransfers.length, note: openTransfers.length ? 'Must finish before period close' : 'No unfinished stock transfer', tone: openTransfers.length ? 'danger' : 'success' },
    ]}
  >
    {[error, requestState.error, decideState.error, closeState.error].filter(Boolean).map((item: any, index) => <QueryErrorBanner key={index} error={item}/>) }
    {loading && !data ? <QueryLoading label="Building the live control board..."/> : null}

    <div className="grid gap-2 rounded-r4 border border-[var(--line)] bg-[var(--surface)] p-2 shadow-sm-soft sm:grid-cols-3">
      {DESKS.map((item) => { const Icon = item.icon; const active = desk === item.id; return <button key={item.id} type="button" onClick={() => setDesk(item.id)} className={cn('flex min-h-16 items-center gap-3 rounded-r3 border px-4 text-left transition-all', active ? 'border-[var(--brand-700)] bg-[var(--brand-700)] text-white shadow-sm' : 'border-transparent hover:border-[var(--line)] hover:bg-[var(--bg-soft)]')}><span className={cn('grid h-9 w-9 place-items-center rounded-r2', active ? 'bg-white/14' : 'bg-[var(--brand-50)] text-[var(--brand-700)]')}><Icon className="h-4 w-4"/></span><span><span className="block text-sm font-black">{item.label}</span><span className={cn('mt-0.5 block text-xs', active ? 'text-white/70' : 'text-[var(--ink-4)]')}>{item.caption}</span></span></button>; })}
    </div>

    {desk === 'board' ? <section className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
      <div className="mp-panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--line)] p-5"><div><p className="text-[11px] font-black uppercase tracking-[0.16em] text-[var(--brand-700)]">Today’s control runbook</p><h2 className="mt-1 text-xl font-black text-[var(--ink)]">Work in the order that protects stock truth</h2></div><span className="rounded-full border border-[var(--line)] bg-[var(--bg-soft)] px-3 py-1 text-xs font-bold text-[var(--ink-3)]">{runbook.filter((row) => row.state !== 'ready').length} action(s) due</span></div>
        <div className="divide-y divide-[var(--line)]">{runbook.map((row, index) => { const Icon = row.icon; return <div key={row.label} className="grid gap-3 p-4 sm:grid-cols-[2.5rem_1fr_auto] sm:items-center"><span className={cn('grid h-9 w-9 place-items-center rounded-full text-sm font-black', row.state === 'blocked' ? 'bg-red-100 text-red-800' : row.state === 'attention' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800')}>{row.state === 'ready' ? <Check className="h-4 w-4"/> : index + 1}</span><div><p className="flex items-center gap-2 font-black text-[var(--ink)]"><Icon className="h-4 w-4 text-[var(--ink-4)]"/>{row.label}</p><p className="mt-1 text-sm text-[var(--ink-4)]">{row.detail}</p></div>{row.desk ? <Button size="sm" variant="outline" onClick={() => setDesk(row.desk!)}>{row.action}<ArrowRight className="ml-2 h-3.5 w-3.5"/></Button> : <Button asChild size="sm" variant="outline"><Link href={row.href}>{row.action}<ArrowRight className="ml-2 h-3.5 w-3.5"/></Link></Button>}</div>; })}</div>
      </div>
      <aside className="mp-panel overflow-hidden">
        <div className="border-b border-[var(--line)] p-5"><p className="text-[11px] font-black uppercase tracking-[0.16em] text-red-700">Exception inbox</p><h2 className="mt-1 text-xl font-black text-[var(--ink)]">Resolve before promises</h2></div>
        <div className="divide-y divide-[var(--line)]">
          {reconciliationRows.filter((row) => row.status !== 'ok').slice(0, 4).map((row) => <Link key={row.productId} href={`/dashboard/inventory/ledger?productId=${row.productId}`} className="group block p-4 hover:bg-[var(--bg-soft)]"><div className="flex items-start gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-r2 bg-red-50 text-red-700"><AlertTriangle className="h-4 w-4"/></span><span className="min-w-0"><span className="block truncate text-sm font-black text-[var(--ink)]">{row.sku} · {row.name}</span><span className="mt-1 block text-xs leading-5 text-[var(--ink-4)]">{row.issues?.[0]?.message || 'Stock sources do not align.'}</span><span className="mt-2 inline-flex items-center text-xs font-bold text-[var(--brand-700)]">Trace ledger <ArrowRight className="ml-1 h-3 w-3"/></span></span></div></Link>)}
          {!reconciliationRows.some((row) => row.status !== 'ok') && !pendingRequests.length && !openTransfers.length ? <div className="p-7 text-center"><CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600"/><p className="mt-3 font-black text-[var(--ink)]">No blocking exception</p><p className="mt-1 text-sm text-[var(--ink-4)]">Counts, transfers and balances have no current action in this desk.</p></div> : null}
          {pendingRequests.slice(0, 2).map((row) => <button key={row.id} type="button" onClick={() => setDesk('adjustments')} className="block w-full p-4 text-left hover:bg-[var(--bg-soft)]"><p className="text-sm font-black text-[var(--ink)]">Approval · {row.product?.internalCode || row.product?.sku}</p><p className="mt-1 text-xs text-[var(--ink-4)]">{row.type.replaceAll('_', ' ')} {row.quantity} · {row.lot?.lotNumber}</p></button>)}
        </div>
      </aside>
    </section> : null}

    {desk === 'adjustments' ? <section className="grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">
      <div className="mp-panel overflow-hidden">
        <div className="border-b border-[var(--line)] p-5"><p className="text-[11px] font-black uppercase tracking-[0.16em] text-[var(--brand-700)]">Governed correction</p><h2 className="mt-1 text-xl font-black text-[var(--ink)]">1. Select the exact physical lot</h2><p className="mt-1 text-sm text-[var(--ink-4)]">Search by SKU, item, lot, batch or GRN. A correction never targets a generic product total.</p></div>
        <div className="border-b border-[var(--line)] p-4"><label className="flex h-11 items-center rounded-r2 border border-[var(--line)] bg-[var(--surface)] px-3"><Search className="mr-2 h-4 w-4 text-[var(--ink-4)]"/><input value={lotSearch} onChange={(event) => setLotSearch(event.target.value)} placeholder="SKU, item, lot, supplier batch or GRN" className="w-full bg-transparent text-sm outline-none"/></label></div>
        <div className="max-h-72 overflow-y-auto divide-y divide-[var(--line)] custom-scrollbar">{visibleLots.map((lot) => { const balance = lot.balances?.[0]; const selected = lot.id === lotId; return <button key={lot.id} type="button" onClick={() => setLotId(lot.id)} className={cn('w-full p-4 text-left transition-colors', selected ? 'bg-[var(--brand-50)]' : 'hover:bg-[var(--bg-soft)]')}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-black text-[var(--ink)]">{lot.product?.internalCode || lot.product?.sku} · {lot.product?.name}</p><p className="mt-1 text-xs text-[var(--ink-4)]">Lot {lot.lotNumber} · {balance?.location?.code || 'No location'} · GRN {lot.goodsReceiptLines?.[0]?.goodsReceiptNote?.grnNumber || 'opening/manual'}</p></div><span className="shrink-0 text-right text-sm font-black text-[var(--ink)]">{Number(balance?.onHand || 0).toLocaleString('en-IN')}<span className="block text-[10px] font-semibold text-[var(--ink-4)]">on hand</span></span></div></button>; })}{!visibleLots.length ? <p className="p-8 text-center text-sm text-[var(--ink-4)]">No active lot matches this search.</p> : null}</div>
        <div className="border-t border-[var(--line)] bg-[var(--bg-soft)] p-5"><h3 className="font-black text-[var(--ink)]">2. Describe the correction</h3>{selectedLot ? <div className="mt-3 rounded-r3 border border-[var(--line)] bg-[var(--surface)] p-3"><p className="text-sm font-black text-[var(--ink)]">{selectedLot.product?.internalCode || selectedLot.product?.sku}</p><p className="mt-1 text-xs text-[var(--ink-4)]">{selectedLot.lotNumber} · {selectedLot.balances?.[0]?.location?.name} · available {selectedLot.balances?.[0]?.available || 0}</p></div> : <p className="mt-2 text-sm text-[var(--ink-4)]">Choose a lot above to unlock the request.</p>}<div className="mt-3 grid gap-3 sm:grid-cols-[1fr_8rem]"><label className="text-xs font-bold text-[var(--ink-4)]">Adjustment type<select value={adjustment.type} onChange={(event) => setAdjustment({ ...adjustment, type: event.target.value })} className="mt-1 h-10 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm"><option value="increase">Increase on hand</option><option value="decrease">Decrease available</option><option value="damage">Mark damaged</option><option value="damage_release">Release damaged</option><option value="hold">Place on hold</option><option value="hold_release">Release hold</option><option value="scrap_damage">Scrap damaged</option></select></label><label className="text-xs font-bold text-[var(--ink-4)]">Quantity<Input className="mt-1" type="number" min={1} value={adjustment.quantity} onChange={(event) => setAdjustment({ ...adjustment, quantity: event.target.value })}/></label></div><label className="mt-3 block text-xs font-bold text-[var(--ink-4)]">Evidence / reason<Input className="mt-1" value={adjustment.reason} onChange={(event) => setAdjustment({ ...adjustment, reason: event.target.value })} placeholder="Example: two pieces damaged during rack inspection"/></label><Button className="mt-3 w-full" disabled={requestState.loading || !lotId || adjustment.reason.trim().length < 5} onClick={submitAdjustment}><ClipboardCheck className="mr-2 h-4 w-4"/>Submit for independent approval</Button></div>
      </div>
      <div className="mp-panel overflow-hidden">
        <div className="flex flex-col justify-between gap-3 border-b border-[var(--line)] p-5 sm:flex-row sm:items-end"><div><p className="text-[11px] font-black uppercase tracking-[0.16em] text-[var(--brand-700)]">Decision register</p><h2 className="mt-1 text-xl font-black text-[var(--ink)]">Pending work and full audit trail</h2></div><select value={requestStatus} onChange={(event) => setRequestStatus(event.target.value)} className="h-10 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-bold"><option value="pending">Pending approval</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="all">All decisions</option></select></div>
        <div className="divide-y divide-[var(--line)]">{shownRequests.map((row) => <div key={row.id} className="p-4"><div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-start"><div><div className="flex flex-wrap items-center gap-2"><p className="font-black text-[var(--ink)]">{row.product?.internalCode || row.product?.sku} · {row.lot?.lotNumber}</p><span className={cn('rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wider', statusTone(row.status))}>{row.status}</span></div><p className="mt-1 text-sm text-[var(--ink-3)]">{row.type.replaceAll('_', ' ')} · <b>{row.quantity} units</b> · {row.location?.code}</p><p className="mt-1 text-xs leading-5 text-[var(--ink-4)]">{row.reason}</p></div>{row.status === 'pending' ? <div className="flex gap-2"><Button size="sm" disabled={decideState.loading} onClick={() => decide({ variables: { id: row.id, action: 'approve' } })}><Check className="mr-1.5 h-4 w-4"/>Approve</Button><Button size="sm" variant="outline" onClick={() => setRejectingId(rejectingId === row.id ? '' : row.id)}><X className="mr-1.5 h-4 w-4"/>Reject</Button></div> : <p className="text-xs font-semibold text-[var(--ink-4)]">Decided {row.decidedAt ? new Date(row.decidedAt).toLocaleString('en-IN') : '—'}</p>}</div>{rejectingId === row.id ? <div className="mt-3 flex flex-col gap-2 rounded-r3 border border-red-200 bg-red-50 p-3 sm:flex-row"><Input value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} placeholder="Specific rejection reason"/><Button variant="destructive" disabled={rejectReason.trim().length < 5 || decideState.loading} onClick={() => decide({ variables: { id: row.id, action: 'reject', input: { reason: rejectReason.trim() } } })}>Confirm rejection</Button></div> : null}</div>)}{!shownRequests.length ? <div className="p-10 text-center"><CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600"/><p className="mt-3 font-black text-[var(--ink)]">No {requestStatus === 'all' ? '' : requestStatus} adjustment request</p><p className="mt-1 text-sm text-[var(--ink-4)]">The register will retain every submitted and decided request.</p></div> : null}</div>
      </div>
    </section> : null}

    {desk === 'close' ? <section className="grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">
      <div className="mp-panel overflow-hidden">
        <div className="border-b border-[var(--line)] p-5"><p className="text-[11px] font-black uppercase tracking-[0.16em] text-[var(--brand-700)]">Close assistant</p><h2 className="mt-1 text-xl font-black text-[var(--ink)]">Lock only a proven period</h2><p className="mt-1 text-sm leading-6 text-[var(--ink-4)]">A close needs the matching posted count and no unfinished transfer. This desk also surfaces reconciliation risk before the irreversible lock.</p></div>
        <div className="space-y-4 p-5"><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold text-[var(--ink-4)]">Period type<select value={period.periodType} onChange={(event) => setPeriod({ ...period, periodType: event.target.value, countSessionId: '' })} className="mt-1 h-10 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3"><option value="monthly">Monthly</option><option value="year_end">Year end</option></select></label><label className="text-xs font-bold text-[var(--ink-4)]">Period key<Input className="mt-1" value={period.periodKey} onChange={(event) => setPeriod({ ...period, periodKey: event.target.value, countSessionId: '' })} placeholder={period.periodType === 'monthly' ? '2026-08' : '2026-27'}/></label></div><label className="block text-xs font-bold text-[var(--ink-4)]">Posted physical count<select value={period.countSessionId} onChange={(event) => setPeriod({ ...period, countSessionId: event.target.value })} className="mt-1 h-11 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm"><option value="">Select exact period count</option>{eligibleCounts.map((count) => <option key={count.id} value={count.id}>{count.countNumber} · {count.periodKey} · variance {count.totalVariance || 0}</option>)}</select></label>{!eligibleCounts.length ? <Link href="/dashboard/inventory/stock-count" className="flex items-center justify-between rounded-r3 border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-900"><span>No posted {period.periodType.replace('_', '-')} count matches {period.periodKey || 'this period'}.</span><span className="inline-flex items-center">Create count <ArrowRight className="ml-1 h-3.5 w-3.5"/></span></Link> : null}<label className="block text-xs font-bold text-[var(--ink-4)]">Effective date<Input className="mt-1" type="date" value={period.effectiveAt} onChange={(event) => setPeriod({ ...period, effectiveAt: event.target.value })}/></label><label className="block text-xs font-bold text-[var(--ink-4)]">Review evidence / close note<Input className="mt-1" value={period.notes} onChange={(event) => setPeriod({ ...period, notes: event.target.value })} placeholder="Count reviewed, transfers cleared, exceptions resolved"/></label></div>
        <div className="border-t border-[var(--line)] bg-[var(--bg-soft)] p-5"><Button className="w-full" disabled={closeState.loading || !closeReady} onClick={() => close({ variables: { input: { ...period, effectiveAt: new Date(`${period.effectiveAt}T23:59:59`).toISOString() } } })}><Ban className="mr-2 h-4 w-4"/>Close and lock {period.periodKey || 'period'}</Button><p className="mt-2 text-center text-xs text-[var(--ink-4)]">Closing prevents stock postings dated inside this period. It does not delete or rewrite ledger history.</p></div>
      </div>
      <div className="space-y-5"><div className="mp-panel overflow-hidden"><div className="border-b border-[var(--line)] p-5"><p className="text-[11px] font-black uppercase tracking-[0.16em] text-[var(--brand-700)]">Release gate</p><h2 className="mt-1 text-xl font-black text-[var(--ink)]">Four checks before lock</h2></div><div className="divide-y divide-[var(--line)]">{closeChecks.map((check) => <div key={check.label} className="flex items-start gap-3 p-4"><span className={cn('mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full', check.complete ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800')}>{check.complete ? <Check className="h-4 w-4"/> : <AlertTriangle className="h-4 w-4"/>}</span><div><p className="font-black text-[var(--ink)]">{check.label}</p><p className="mt-1 text-sm text-[var(--ink-4)]">{check.detail}</p></div></div>)}</div></div>
        <div className="mp-panel overflow-hidden"><div className="flex items-center justify-between border-b border-[var(--line)] p-5"><div><p className="text-[11px] font-black uppercase tracking-[0.16em] text-[var(--brand-700)]">Closed period register</p><h2 className="mt-1 text-xl font-black text-[var(--ink)]">Snapshot history</h2></div><History className="h-5 w-5 text-[var(--ink-4)]"/></div><div className="divide-y divide-[var(--line)]">{closes.slice(0, 8).map((row) => <div key={row.id} className="grid gap-2 p-4 sm:grid-cols-[1fr_auto_auto] sm:items-center"><div><p className="font-black text-[var(--ink)]">{row.closeNumber} · {row.periodKey}</p><p className="mt-1 text-xs text-[var(--ink-4)]">{row.periodType.replace('_', ' ')} · {row.closedAt ? new Date(row.closedAt).toLocaleDateString('en-IN') : row.status}</p></div><p className="text-sm font-bold tabular-nums text-[var(--ink-3)]">{Number(row.totalQuantity || 0).toLocaleString('en-IN')} units</p><p className="text-sm font-black tabular-nums text-[var(--ink)]">₹{Number(row.totalValue || 0).toLocaleString('en-IN')}</p></div>)}{!closes.length ? <p className="p-8 text-center text-sm text-[var(--ink-4)]">No period has been closed yet.</p> : null}</div></div>
      </div>
    </section> : null}
  </StockControlWorkspace>;
}
