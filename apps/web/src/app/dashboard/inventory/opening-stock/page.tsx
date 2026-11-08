'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { gql, useMutation, useQuery } from '@apollo/client';
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ClipboardCheck, History, Layers3, Loader2, PackagePlus, Plus, Search, Trash2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QueryErrorBanner } from '@/components/query-state';
import { StockControlWorkspace } from '@/components/inventory/stock-control-workspace';
import { OpeningStockExcel } from './opening-stock-excel';

const DATA = gql`query OpeningStockDesk($search: String, $recordId: String) {
  products(search: $search, take: 80) { id sku internalCode name category brand salesUom piecesPerPack }
  stockLocations(status: "active")
  openingStockSessions(take: 40, recordId: $recordId)
  me { id role }
}`;
const CREATE = gql`mutation CreateOpening($input: OpeningStockInput!) { createOpeningStockSession(input: $input) }`;
const POST = gql`mutation PostOpening($id: ID!, $ownerOverrideReason: String) { approveOpeningStockSession(id: $id, ownerOverrideReason: $ownerOverrideReason) }`;
const CANCEL = gql`mutation CancelOpening($id: ID!, $reason: String!) { cancelOpeningStockSession(id: $id, reason: $reason) }`;

type Tab = 'waiting' | 'new' | 'history';
const WAITING = ['draft', 'submitted'];

const dateLabel = (value?: string) => (value ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const units = (session: any) => (session.lines || []).reduce((sum: number, line: any) => sum + Number(line.quantity || 0), 0);
const missingCostLines = (session: any) => (session.lines || []).filter((line: any) => Number(line.unitCost || 0) <= 0);

function SessionLines({ session }: { session: any }) {
  const [filter, setFilter] = useState('');
  const overlapIds = new Set<string>(session.overlap?.productIds || []);
  const term = filter.trim().toLowerCase();
  const rows = (session.lines || []).filter((line: any) => !term || [line.product?.sku, line.product?.internalCode, line.product?.name].some((value) => String(value || '').toLowerCase().includes(term)));
  return (
    <div className="mt-4">
      {(session.lines || []).length > 12 ? (
        <label className="mb-2 flex h-10 max-w-sm items-center rounded-md border border-[var(--line)] px-3"><Search className="mr-2 h-4 w-4 text-[var(--ink-4)]" aria-hidden="true" /><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Find a line by code or name" aria-label="Find a line" className="w-full bg-transparent text-sm outline-none" /></label>
      ) : null}
      <div className="max-h-[26rem] overflow-auto rounded-md border border-[var(--line)]">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="sticky top-0 bg-[var(--bg-soft)] text-xs font-bold uppercase tracking-wider text-[var(--ink-4)]"><tr><th className="p-3">Product</th><th className="p-3">Lot</th><th className="p-3 text-right">Qty</th><th className="p-3">Cost</th></tr></thead>
          <tbody className="divide-y divide-[var(--line)]">
            {rows.map((line: any) => (
              <tr key={line.id} className={overlapIds.has(line.productId) ? 'bg-rose-50/60' : ''}>
                <td className="p-3"><p className="font-semibold text-[var(--ink)]">{line.product?.internalCode || line.product?.sku}</p><p className="text-xs text-[var(--ink-4)]">{line.product?.name || 'Name missing in Product Master'}</p>{overlapIds.has(line.productId) ? <p className="text-xs font-semibold text-rose-800">Already posted as opening stock</p> : null}</td>
                <td className="p-3 font-mono text-xs">{line.lot?.lotNumber || line.lotCode}</td>
                <td className="p-3 text-right font-semibold tabular-nums">{Number(line.quantity).toLocaleString('en-IN')}</td>
                <td className="p-3">{Number(line.unitCost || 0) > 0 ? <span className="tabular-nums">₹{Number(line.unitCost).toLocaleString('en-IN')}</span> : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">Missing</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WaitingCard({ session, isOwner, onPost, onCancel, busy }: { session: any; isOwner: boolean; onPost: (reason: string) => void; onCancel: (reason: string) => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const missing = missingCostLines(session).length;
  const overlap = session.overlap;
  const needsReason = missing > 0;
  return (
    <article className={`rounded-r4 border bg-[var(--surface)] p-5 shadow-sm-soft ${overlap ? 'border-rose-300' : 'border-[var(--line)]'}`} aria-labelledby={`session-${session.id}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={`session-${session.id}`} className="text-lg font-black text-[var(--ink)]">{session.sessionNumber}</h3>
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-900">Waiting for owner</span>
          </div>
          <p className="mt-1 text-sm text-[var(--ink-3)]">{session.location?.name} · stock date {dateLabel(session.effectiveAt)} · by {session.createdByName || 'staff'} on {dateLabel(session.createdAt)}</p>
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <span className="font-semibold text-[var(--ink)]">{(session.lines || []).length} items · {units(session).toLocaleString('en-IN')} units</span>
            {missing ? <span className="text-amber-800">{missing} without cost</span> : <span className="text-emerald-800">All costed</span>}
          </p>
          {session.notes ? <p className="mt-1 text-sm text-[var(--ink-3)]">Note: {session.notes}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => setOpen(!open)} aria-expanded={open}><ChevronDown className={`mr-2 h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />{open ? 'Hide items' : 'Show items'}</Button>
          <Button type="button" variant="ghost" onClick={() => setCancelling(!cancelling)}><XCircle className="mr-2 h-4 w-4" />Cancel</Button>
        </div>
      </div>

      {overlap ? (
        <div role="alert" className="mt-4 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{overlap.allLines ? <b>All {overlap.lineCount} items</b> : <b>{overlap.lineCount} of {(session.lines || []).length} items</b>} were already posted as opening stock in {overlap.sessionNumbers.join(', ')}. Posting adds them again. {overlap.allLines ? 'This looks like the same file uploaded twice: cancel it unless this is genuinely extra stock.' : 'Check these items before posting.'}</span>
        </div>
      ) : null}

      {cancelling ? (
        <div className="mt-4 flex flex-col gap-2 rounded-md border border-[var(--line)] bg-[var(--bg-soft)] p-3 sm:flex-row sm:items-end">
          <label className="flex-1 text-xs font-bold text-[var(--ink-4)]">Why cancel?<Input className="mt-1" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder={overlap?.allLines ? `Duplicate of ${overlap.sessionNumbers[0]}` : 'e.g. Wrong file uploaded'} /></label>
          <Button type="button" variant="outline" disabled={busy || cancelReason.trim().length < 5} onClick={() => onCancel(cancelReason.trim())}>Cancel this session</Button>
        </div>
      ) : null}

      {open ? <SessionLines session={session} /> : null}

      <div className="mt-4 border-t border-[var(--line)] pt-4">
        {isOwner ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            {needsReason ? <label className="flex-1 text-xs font-bold text-[var(--ink-4)]">Reason for posting without cost ({missing} items)<Input className="mt-1" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. Physical count verified, supplier costs to follow" /></label> : <p className="flex-1 text-sm text-[var(--ink-3)]">Ready to post. Lots and stock ledger entries are created in one step.</p>}
            <Button type="button" disabled={busy || (needsReason && reason.trim().length < 12)} onClick={() => onPost(reason.trim())}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}Post {units(session).toLocaleString('en-IN')} units to stock</Button>
          </div>
        ) : <p className="text-sm text-[var(--ink-3)]">An owner or admin posts this session. You can still cancel it if it was submitted by mistake.</p>}
        {isOwner && needsReason && reason.trim().length > 0 && reason.trim().length < 12 ? <p className="mt-1 text-xs text-amber-800">Use at least 12 characters so the reason is clear later.</p> : null}
      </div>
    </article>
  );
}

export default function OpeningStockPage() {
  const [tab, setTab] = useState<Tab>('waiting');
  const [tabChosen, setTabChosen] = useState(false);
  const [search, setSearch] = useState('');
  const [recordId, setRecordId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [effectiveAt, setEffectiveAt] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<any[]>([]);
  const [message, setMessage] = useState('');
  const [busyId, setBusyId] = useState('');
  const [historyId, setHistoryId] = useState('');
  const [historyFilter, setHistoryFilter] = useState('all');
  const [productPage, setProductPage] = useState(0);
  useEffect(() => { const id = new URLSearchParams(window.location.search).get('recordId') || ''; setRecordId(id); setHistoryId(id); }, []);
  const { data, error, refetch } = useQuery(DATA, { variables: { recordId: recordId || undefined, search: search || undefined }, fetchPolicy: 'cache-and-network' });
  const [create, { loading: creating, error: createError }] = useMutation(CREATE);
  const [post, { error: postError }] = useMutation(POST);
  const [cancel, { error: cancelError }] = useMutation(CANCEL);
  const products = data?.products || [];
  const locations = data?.stockLocations || [];
  const sessions: any[] = useMemo(() => data?.openingStockSessions || [], [data?.openingStockSessions]);
  const waiting = useMemo(() => sessions.filter((session) => WAITING.includes(session.status)), [sessions]);
  const history = useMemo(() => sessions.filter((session) => !WAITING.includes(session.status) && (historyFilter === 'all' || session.status === historyFilter)), [sessions, historyFilter]);
  const isOwner = ['owner', 'admin'].includes(data?.me?.role || '');
  const canViewCost = isOwner;
  const selectedLocation = locationId || locations.find((row: any) => row.defaultStockScope)?.id || locations[0]?.id || '';
  const totalUnits = useMemo(() => lines.reduce((sum, row) => sum + Number(row.quantity || 0), 0), [lines]);
  const missingReferences = lines.filter((row) => !String(row.lotCode || '').trim()).length;
  const missingCosts = lines.filter((row) => Number(row.unitCost || 0) <= 0).length;
  const invalidQuantities = lines.filter((row) => !(Number(row.quantity || 0) > 0) || !Number.isInteger(Number(row.quantity))).length;
  const productPageCount = Math.max(1, Math.ceil(products.length / 12));
  const visibleProducts = products.slice(productPage * 12, (productPage + 1) * 12);
  const selectedHistory = history.find((session) => session.id === historyId) || history[0];
  const postedUnits = sessions.filter((session) => session.status === 'posted').reduce((sum, session) => sum + units(session), 0);

  // Land on the waiting list when something needs the owner, otherwise on a new batch.
  useEffect(() => {
    if (!data || tabChosen) return;
    setTab(waiting.length ? 'waiting' : 'new');
  }, [data, tabChosen, waiting.length]);
  const choose = (next: Tab) => { setTab(next); setTabChosen(true); };

  function addProduct(product: any) {
    if (lines.some((row) => row.productId === product.id)) return;
    setLines((current) => [...current, { productId: product.id, sku: product.sku, internalCode: product.internalCode, name: product.name, lotCode: `OPEN-${effectiveAt.slice(0, 7)}`, quantity: '', unitCost: '', qualityStatus: 'available', packCount: '', labelTemplate: 'stock_pack' }]);
  }
  function update(index: number, key: string, value: any) {
    setLines((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, [key]: value } : row)));
  }
  async function submit() {
    setMessage('');
    try {
      await create({ variables: { input: { locationId: selectedLocation, effectiveAt: new Date(`${effectiveAt}T12:00:00`).toISOString(), notes, submit: true, lines: JSON.stringify(lines.map(({ sku, internalCode, name, unitCost, ...row }) => ({ ...row, quantity: Number(row.quantity), ...(canViewCost && unitCost !== '' ? { unitCost: Number(unitCost) } : {}), packCount: Number(row.packCount || 0) }))) } } });
      setLines([]); setNotes(''); setSearch(''); setProductPage(0);
      await refetch();
      setMessage(`Batch submitted with ${totalUnits.toLocaleString('en-IN')} units. It is now waiting for the owner to post it.`);
      choose('waiting');
    } catch (caught: any) { setMessage(caught.message || 'Unable to create opening stock'); }
  }
  async function postSession(session: any, reason: string) {
    setMessage(''); setBusyId(session.id);
    try {
      await post({ variables: { id: session.id, ownerOverrideReason: reason || undefined } });
      await refetch();
      setMessage(`${session.sessionNumber} posted: ${units(session).toLocaleString('en-IN')} units are now in stock.`);
    } catch { /* shown by the error banner */ } finally { setBusyId(''); }
  }
  async function cancelSession(session: any, reason: string) {
    setMessage(''); setBusyId(session.id);
    try {
      await cancel({ variables: { id: session.id, reason } });
      await refetch();
      setMessage(`${session.sessionNumber} cancelled. Nothing was added to stock.`);
    } catch { /* shown by the error banner */ } finally { setBusyId(''); }
  }

  const submitBlocker = !lines.length ? 'Add items first' : invalidQuantities ? `${invalidQuantities} line${invalidQuantities === 1 ? ' needs' : 's need'} a whole quantity` : missingReferences ? `${missingReferences} line${missingReferences === 1 ? ' needs' : 's need'} a lot code` : notes.trim().length < 8 ? 'Add a short note about this count (8+ characters)' : '';
  const tabs: Array<[Tab, string, number | null, any]> = [['waiting', 'Waiting for owner', waiting.length, ClipboardCheck], ['new', 'New opening batch', lines.length || null, PackagePlus], ['history', 'History', null, History]];

  return <StockControlWorkspace
    title="Opening stock"
    description="Bring physically counted stock into the system: build a batch from a spreadsheet or by picking items, submit it, and the owner posts it to stock."
    action={<Button asChild variant="outline"><Link href="/dashboard/inventory/control">Open close controls</Link></Button>}
    metrics={[
      { label: 'Waiting for owner', value: waiting.length, note: waiting.length ? `${waiting.reduce((sum, session) => sum + units(session), 0).toLocaleString('en-IN')} units to review` : 'Nothing to approve', tone: waiting.length ? 'warning' : 'success' },
      { label: 'Possible duplicates', value: waiting.filter((session) => session.overlap).length, note: 'Items already posted before', tone: waiting.some((session) => session.overlap) ? 'warning' : 'neutral' },
      { label: 'Posted so far', value: postedUnits.toLocaleString('en-IN'), note: `units in ${sessions.filter((session) => session.status === 'posted').length} sessions`, tone: 'success' },
      { label: 'Current batch', value: totalUnits.toLocaleString('en-IN'), note: `${lines.length} items not yet submitted`, tone: lines.length ? 'info' : 'neutral' },
    ]}
  >
    {[error, createError, postError, cancelError].filter(Boolean).map((item: any, index) => <QueryErrorBanner key={index} error={item} />)}
    {message ? <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">{message}</p> : null}

    <nav aria-label="Opening stock sections" className="flex gap-1 overflow-x-auto rounded-r4 border border-[var(--line)] bg-[var(--surface)] p-1 shadow-sm-soft">
      {tabs.map(([id, label, count, Icon]) => (
        <button key={id} type="button" aria-current={tab === id ? 'page' : undefined} onClick={() => choose(id)} className={`flex min-h-11 shrink-0 items-center gap-2 rounded-r3 px-4 text-sm font-bold ${tab === id ? 'bg-[var(--ink)] text-[var(--surface)]' : 'text-[var(--ink-3)] hover:bg-[var(--bg-soft)]'}`}>
          <Icon className="h-4 w-4" aria-hidden="true" />{label}{count ? <span className={`rounded-full px-2 py-0.5 text-xs ${tab === id ? 'bg-[var(--surface)] text-[var(--ink)]' : id === 'waiting' ? 'bg-amber-100 text-amber-900' : 'bg-[var(--bg-soft)]'}`}>{count}</span> : null}
        </button>
      ))}
    </nav>

    {tab === 'waiting' ? (
      <section aria-label="Sessions waiting for the owner" className="space-y-4">
        {waiting.length ? waiting.map((session) => <WaitingCard key={session.id} session={session} isOwner={isOwner} busy={busyId === session.id} onPost={(reason) => postSession(session, reason)} onCancel={(reason) => cancelSession(session, reason)} />) : (
          <div className="grid place-items-center rounded-r4 border border-dashed border-[var(--line)] bg-[var(--surface)] p-12 text-center">
            <CheckCircle2 className="h-8 w-8 text-emerald-600" aria-hidden="true" />
            <p className="mt-3 font-bold text-[var(--ink)]">Nothing is waiting for approval.</p>
            <p className="mt-1 text-sm text-[var(--ink-3)]">Every submitted batch has been posted or cancelled.</p>
            <Button type="button" className="mt-4" onClick={() => choose('new')}><PackagePlus className="mr-2 h-4 w-4" />Start a new batch</Button>
          </div>
        )}
      </section>
    ) : null}

    {tab === 'new' ? (
      <section aria-label="New opening batch" className="space-y-5">
        <div className="mp-panel p-5">
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[var(--brand-700)]">Step 1 · Where and when</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto]">
            <label className="text-xs font-semibold text-[var(--ink-4)]">Stock location<select value={selectedLocation} onChange={(event) => setLocationId(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)]">{locations.map((row: any) => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}</select></label>
            <label className="text-xs font-semibold text-[var(--ink-4)]">Stock date (the day this count is true for)<Input className="mt-1 h-11" type="date" value={effectiveAt} onChange={(event) => setEffectiveAt(event.target.value)} /></label>
            <div className="flex items-end"><Button type="button" variant="outline" className="h-11" onClick={() => { const now = new Date(); setEffectiveAt(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`); }}>Use 1st of this month</Button></div>
          </div>
        </div>

        <div>
          <p className="mb-2 text-[11px] font-black uppercase tracking-[0.16em] text-[var(--brand-700)]">Step 2 · Add items: from a spreadsheet, or pick them below</p>
          <OpeningStockExcel existingProductIds={new Set(lines.map((row) => row.productId))} defaultLot={`OPEN-${effectiveAt.slice(0, 7)}`} onAdd={(added) => { setLines((current) => [...current, ...added]); setMessage(`${added.length} line${added.length === 1 ? '' : 's'} added from the spreadsheet. Check them below, then submit.`); }} />
        </div>

        <div className="grid gap-5 xl:grid-cols-[20rem_minmax(0,1fr)]">
          <aside className="mp-panel overflow-hidden" aria-label="Pick items">
            <div className="border-b border-[var(--line)] p-4">
              <p className="text-sm font-black text-[var(--ink)]">Pick items one by one</p>
              <label className="mt-3 flex h-10 items-center rounded-md border border-[var(--line)] px-3"><Search className="mr-2 h-4 w-4 text-[var(--ink-4)]" aria-hidden="true" /><input value={search} onChange={(event) => { setSearch(event.target.value); setProductPage(0); }} placeholder="Code, brand or name" aria-label="Search products to add" className="w-full bg-transparent text-sm outline-none" /></label>
            </div>
            <div className="max-h-[28rem] divide-y divide-[var(--line)] overflow-y-auto">
              {visibleProducts.map((product: any) => {
                const added = lines.some((row) => row.productId === product.id);
                return <button type="button" key={product.id} onClick={() => addProduct(product)} disabled={added} className="flex w-full items-start justify-between gap-2 p-3.5 text-left hover:bg-[var(--bg-soft)] disabled:opacity-60"><span className="min-w-0"><span className="block truncate text-sm font-black text-[var(--ink)]">{product.internalCode || product.sku}</span><span className="mt-0.5 line-clamp-2 block text-xs leading-5 text-[var(--ink-4)]">{product.name || 'Name missing in Product Master'}</span><span className="mt-0.5 block text-xs font-semibold text-[var(--ink-4)]">{product.brand} · {product.category}</span></span>{added ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-label="Added" /> : <Plus className="h-4 w-4 shrink-0 text-[var(--brand-700)]" aria-hidden="true" />}</button>;
              })}
              {!visibleProducts.length ? <p className="p-8 text-center text-sm text-[var(--ink-4)]">No product matches this search.</p> : null}
            </div>
            <div className="flex items-center justify-between border-t border-[var(--line)] bg-[var(--bg-soft)] p-2">
              <button type="button" aria-label="Previous products" disabled={productPage === 0} onClick={() => setProductPage((value) => Math.max(0, value - 1))} className="grid h-9 w-9 place-items-center rounded-md disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
              <span className="text-xs font-bold text-[var(--ink-4)]">{productPage + 1} / {productPageCount}</span>
              <button type="button" aria-label="Next products" disabled={productPage + 1 >= productPageCount} onClick={() => setProductPage((value) => value + 1)} className="grid h-9 w-9 place-items-center rounded-md disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </aside>

          <div className="mp-panel overflow-hidden">
            <div className="flex flex-col justify-between gap-2 border-b border-[var(--line)] p-4 sm:flex-row sm:items-center">
              <div><p className="text-[11px] font-black uppercase tracking-[0.16em] text-[var(--brand-700)]">Step 3 · Check and submit</p><h2 className="mt-1 text-lg font-black text-[var(--ink)]">{lines.length} items · {totalUnits.toLocaleString('en-IN')} units</h2></div>
              {lines.length ? <Button type="button" variant="ghost" size="sm" onClick={() => { if (window.confirm(`Remove all ${lines.length} items from this batch?`)) setLines([]); }}><Trash2 className="mr-1.5 h-4 w-4" />Clear batch</Button> : null}
            </div>
            {lines.length ? (
              <div className="max-h-[32rem] overflow-auto">
                <table className="w-full min-w-[820px] text-sm">
                  <thead className="sticky top-0 bg-[var(--bg-soft)] text-left text-[11px] font-semibold uppercase text-[var(--ink-4)]"><tr><th className="p-3">Product</th><th className="p-3">Lot</th><th className="p-3">Qty</th>{canViewCost ? <th className="p-3">Unit cost</th> : null}<th className="p-3">Condition</th><th className="p-3">Stickers</th><th className="p-3"><span className="sr-only">Remove</span></th></tr></thead>
                  <tbody className="divide-y divide-[var(--line)]">
                    {lines.map((row, index) => (
                      <tr key={row.productId}>
                        <td className="p-3"><p className="font-semibold text-[var(--ink)]">{row.internalCode || row.sku}</p><p className="max-w-[18rem] truncate text-xs text-[var(--ink-4)]">{row.name || 'Name missing in Product Master'}</p></td>
                        <td className="px-2"><Input className="w-36" value={row.lotCode} onChange={(event) => update(index, 'lotCode', event.target.value)} placeholder="Lot code" aria-label={`Lot for ${row.sku}`} data-needs-value /></td>
                        <td className="px-2"><Input className="w-24" type="number" min={1} value={row.quantity} onChange={(event) => update(index, 'quantity', event.target.value)} placeholder="Qty" aria-label={`Quantity for ${row.sku}`} data-needs-value /></td>
                        {canViewCost ? <td className="px-2"><Input className="w-28" type="number" min={0} value={row.unitCost} onChange={(event) => update(index, 'unitCost', event.target.value)} placeholder="Cost ₹" aria-label={`Unit cost for ${row.sku}`} /></td> : null}
                        <td className="px-2"><select value={row.qualityStatus} onChange={(event) => update(index, 'qualityStatus', event.target.value)} aria-label={`Condition for ${row.sku}`} className="h-10 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2"><option value="available">Available</option><option value="inspection">Inspection</option><option value="damaged">Damaged</option></select></td>
                        <td className="px-2"><Input className="w-20" type="number" min={0} value={row.packCount} onChange={(event) => update(index, 'packCount', event.target.value)} placeholder="0" aria-label={`Stickers to print for ${row.sku}`} /></td>
                        <td className="pr-3"><button type="button" aria-label={`Remove ${row.sku}`} onClick={() => setLines((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="grid h-9 w-9 place-items-center rounded-md text-red-700 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="grid min-h-48 place-items-center p-6 text-center"><div><Layers3 className="mx-auto h-8 w-8 text-[var(--ink-5)]" aria-hidden="true" /><p className="mt-3 font-bold text-[var(--ink)]">No items yet</p><p className="mt-1 text-sm text-[var(--ink-4)]">Upload a spreadsheet above or pick items on the left.</p></div></div>
            )}
            <div className="space-y-3 border-t border-[var(--line)] bg-[var(--bg-soft)] p-4">
              <label className="block text-xs font-bold text-[var(--ink-4)]">Note about this count<Input className="mt-1" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="e.g. Godown count of 31 Oct by Amita and Marvi" data-needs-value /></label>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className={`rounded-full px-2.5 py-1 font-bold ${invalidQuantities ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'}`}>{invalidQuantities ? `${invalidQuantities} need a quantity` : 'Quantities OK'}</span>
                <span className={`rounded-full px-2.5 py-1 font-bold ${missingReferences ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>{missingReferences ? `${missingReferences} need a lot` : 'Lots OK'}</span>
                <span className={`rounded-full px-2.5 py-1 font-bold ${missingCosts ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>{missingCosts ? `${missingCosts} without cost (owner gives a reason)` : 'All costed'}</span>
              </div>
              <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
                {submitBlocker ? <p className="text-sm text-[var(--ink-3)]" role="status">{submitBlocker}</p> : null}
                <Button onClick={submit} disabled={creating || Boolean(submitBlocker)}>{creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PackagePlus className="mr-2 h-4 w-4" />}Submit {totalUnits ? `${totalUnits.toLocaleString('en-IN')} units ` : ''}for owner approval</Button>
              </div>
            </div>
          </div>
        </div>
      </section>
    ) : null}

    {tab === 'history' ? (
      <section className="mp-panel overflow-hidden" aria-label="Opening stock history">
        <div className="flex flex-col justify-between gap-3 border-b border-[var(--line)] p-5 sm:flex-row sm:items-center">
          <h2 className="text-lg font-black text-[var(--ink)]">Posted and cancelled sessions</h2>
          <div className="flex gap-1 rounded-full border border-[var(--line)] p-0.5" role="toolbar" aria-label="Filter history">
            {[['all', 'All'], ['posted', 'Posted'], ['cancelled', 'Cancelled']].map(([value, label]) => <button key={value} type="button" aria-pressed={historyFilter === value} onClick={() => setHistoryFilter(value)} className={`h-9 rounded-full px-4 text-sm font-semibold ${historyFilter === value ? 'bg-[var(--ink)] text-[var(--surface)]' : 'text-[var(--ink-3)]'}`}>{label}</button>)}
          </div>
        </div>
        <div className="grid min-h-72 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <div className="max-h-[40rem] divide-y divide-[var(--line)] overflow-y-auto border-r border-[var(--line)]">
            {history.map((session) => (
              <button key={session.id} type="button" onClick={() => setHistoryId(session.id)} aria-current={selectedHistory?.id === session.id} className={`w-full p-4 text-left hover:bg-[var(--bg-soft)] ${selectedHistory?.id === session.id ? 'bg-[var(--brand-50)]' : ''}`}>
                <span className="flex items-center justify-between"><span className="font-black text-[var(--ink)]">{session.sessionNumber}</span><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${session.status === 'posted' ? 'bg-emerald-100 text-emerald-800' : 'bg-[var(--bg-soft)] text-[var(--ink-3)]'}`}>{session.status}</span></span>
                <span className="mt-1 block text-xs text-[var(--ink-4)]">{(session.lines || []).length} items · {units(session).toLocaleString('en-IN')} units · {dateLabel(session.effectiveAt)}</span>
              </button>
            ))}
            {!history.length ? <p className="p-8 text-center text-sm text-[var(--ink-4)]">No sessions here yet.</p> : null}
          </div>
          <div className="p-5">
            {selectedHistory ? (
              <>
                <h3 className="text-xl font-black text-[var(--ink)]">{selectedHistory.sessionNumber} · {selectedHistory.location?.name}</h3>
                <p className="mt-1 text-sm text-[var(--ink-3)]">Stock date {dateLabel(selectedHistory.effectiveAt)} · submitted by {selectedHistory.createdByName || 'staff'}{selectedHistory.status === 'posted' ? ` · posted ${dateLabel(selectedHistory.postedAt)}${selectedHistory.approvedByName ? ` by ${selectedHistory.approvedByName}` : ''}` : ''}{selectedHistory.status === 'cancelled' ? ` · cancelled${selectedHistory.cancelledByName ? ` by ${selectedHistory.cancelledByName}` : ''}: ${selectedHistory.metadata?.cancelReason || ''}` : ''}</p>
                <p className="mt-1 text-sm font-semibold text-[var(--ink)]">{(selectedHistory.lines || []).length} items · {units(selectedHistory).toLocaleString('en-IN')} units · {missingCostLines(selectedHistory).length} without cost</p>
                <SessionLines session={selectedHistory} />
                {selectedHistory.status === 'posted' ? <div className="mt-4 flex flex-wrap gap-2"><Button asChild size="sm" variant="outline"><Link href={`/dashboard/inventory/ledger?search=${encodeURIComponent(selectedHistory.sessionNumber)}`}>Trace ledger entries<ArrowRight className="ml-2 h-4 w-4" /></Link></Button><Button asChild size="sm" variant="outline"><Link href="/dashboard/inventory">Open stock position</Link></Button></div> : null}
              </>
            ) : <p className="text-sm text-[var(--ink-3)]">Choose a session to see its items.</p>}
          </div>
        </div>
      </section>
    ) : null}
  </StockControlWorkspace>;
}
