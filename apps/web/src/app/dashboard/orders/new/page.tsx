'use client';

// Direct sales order: an order without a quote. Lines are priced exactly like
// a quote (Product Master MRP and unit, NRP, optional special, GST on top or a
// bill without GST), so what is shown here is what the server saves.
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { gql, useLazyQuery, useMutation, useQuery } from '@apollo/client';
import type { TaxMode } from '../../quotes/_workspace/model';
import { AlertTriangle, ArrowLeft, CheckCircle2, IndianRupee, PackagePlus, Search, Trash2, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QueryErrorBanner } from '@/components/query-state';
import { CustomerPicker } from '@/components/quick-add/quick-add';
import { maskedMobile } from '@/lib/customer-display';
import { describeApolloError } from '@/lib/apollo-errors';
import {
  DEFAULT_AREA, isTileLine, lineFromProduct, lineIssues, money, mrpUom, patchLine, priceLines, pricingBasis,
  quoteTypeForProduct, serializeLines, tilePriceUom, type Line,
} from '../../quotes/_workspace/model';

const SETUP = gql`query DirectOrderSetup { me { id role } salesAssignees }`;
const SEARCH_PRODUCTS = gql`query DirectOrderProducts($query: String!) { globalSearch(query: $query) { products } }`;
const PRODUCTS_BY_IDS = gql`query DirectOrderProductsByIds($ids: [ID!]!) { productsByIds(ids: $ids) { id sku internalCode name category brand finish dimensions unit baseUom purchaseUom salesUom piecesPerPack coveragePerPack defaultMrpInclusive defaultNrpInclusive floorPriceInclusive priceRateBasis priceUom mrpSource media status } }`;
const STOCK = gql`query DirectOrderStock($productId: String) { inventoryBalances(productId: $productId, take: 1) { id available onHand reserved } }`;
const CREDIT = gql`query DirectOrderCredit($customerId: ID!) { directOrderCustomerCredit(customerId: $customerId) }`;
const ORDER_STOCK = gql`query DirectOrderCreated($id: ID!) { salesOrder(id: $id) }`;
const CREATE = gql`mutation CreateDirectSalesOrder($input: CreateDirectSalesOrderInput!) { createDirectSalesOrder(input: $input) }`;

const FLOOR_ROLES = ['owner', 'admin'];
const label = 'block text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]';
const field = 'mt-1.5 h-10 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] outline-none focus:border-[var(--brand-400)]';

// Today in the user's own time zone, plus some days, as yyyy-mm-dd.
function localDate(daysAhead: number) {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function unitLabel(value: unknown) {
  return String(value || 'PC').toUpperCase();
}

export default function DirectSalesOrderPage() {
  const [customer, setCustomer] = useState<any>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [ownerId, setOwnerId] = useState('');
  const [query, setQuery] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [taxMode, setTaxMode] = useState<TaxMode>('gst');
  const [paymentMode, setPaymentMode] = useState<'cash' | 'credit'>('cash');
  const [advanceAmount, setAdvanceAmount] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('Cash on order');
  const [promisedDate, setPromisedDate] = useState(() => localDate(1));
  const [notes, setNotes] = useState('');
  const [created, setCreated] = useState<any>(null);
  const [validation, setValidation] = useState('');
  const [adding, setAdding] = useState('');

  const setup = useQuery(SETUP);
  const search = useQuery(SEARCH_PRODUCTS, { variables: { query: query.trim() }, skip: query.trim().length < 2 });
  const [loadProducts] = useLazyQuery(PRODUCTS_BY_IDS, { fetchPolicy: 'network-only' });
  const credit = useQuery(CREDIT, { variables: { customerId: customer?.id || '' }, skip: !customer?.id, fetchPolicy: 'network-only' });
  const [create, state] = useMutation(CREATE);

  const me = setup.data?.me;
  const salesUsers: any[] = useMemo(() => setup.data?.salesAssignees || [], [setup.data?.salesAssignees]);
  const canPassFloor = FLOOR_ROLES.includes(String(me?.role || ''));
  // The person making the order is the sales person when they sell; office staff choose.
  useEffect(() => {
    if (ownerId || !me?.id || !salesUsers.length) return;
    if (salesUsers.some((user) => user.id === me.id)) setOwnerId(me.id);
  }, [me?.id, ownerId, salesUsers]);

  const pricing = useMemo(() => priceLines(lines, taxMode, 'PERCENT', 0), [lines, taxMode]);
  const withGst = taxMode === 'gst';
  const rowByKey = useMemo(() => new Map(pricing.rows.map((row: any) => [row._k, row])), [pricing.rows]);
  const issuesByKey = useMemo(() => new Map(lines.map((line) => [line._k, lineIssues(line, rowByKey.get(line._k), quoteTypeForProduct(line))])), [lines, rowByKey]);
  const totals = useMemo(() => pricing.rows.reduce((sum: any, row: any) => ({
    taxable: sum.taxable + Number(row.taxableValue || 0),
    gst: sum.gst + Number(row.taxAmount || 0),
    total: sum.total + Number(row.total || 0),
  }), { taxable: 0, gst: 0, total: 0 }), [pricing.rows]);
  const blocking = lines.flatMap((line) => (issuesByKey.get(line._k) || []).filter((issue) => issue.blocking).map((issue) => ({ line, issue })));
  const belowFloor = lines.filter((line) => (issuesByKey.get(line._k) || []).some((issue) => issue.key === 'floor'));
  const creditPosition = credit.data?.directOrderCustomerCredit;
  const creditShort = paymentMode === 'credit' && creditPosition && (creditPosition.creditHold || (creditPosition.available != null && totals.total > creditPosition.available + 0.01));
  const advance = Number(advanceAmount || 0);
  const advanceInvalid = paymentMode === 'cash' && (advance < 0 || advance > totals.total + 0.01);

  const add = async (product: any) => {
    setAdding(product.id);
    try {
      const result = await loadProducts({ variables: { ids: [product.id] } });
      const full = result.data?.productsByIds?.[0] || product;
      setLines((current) => [...current, { ...lineFromProduct(full, DEFAULT_AREA), baseUom: full.baseUom || 'PC', stockUnit: full.unit || full.purchaseUom || 'PC' }]);
      setQuery('');
    } finally {
      setAdding('');
    }
  };
  const update = (key: string, patch: Record<string, any>) => setLines((current) => current.map((line) => line._k === key ? patchLine(line, patch) : line));

  const submit = async () => {
    setValidation('');
    if (!customer?.id) return setValidation('Choose the customer.');
    if (!ownerId) return setValidation('Choose the sales person responsible for this order.');
    if (!lines.length) return setValidation('Add at least one product.');
    if (blocking.length) return setValidation(`${blocking[0].line.sku}: ${blocking[0].issue.message}.`);
    if (belowFloor.length && !canPassFloor) return setValidation(`${belowFloor[0].sku} is below the owner floor rate. Raise the rate, or make a quote so the owner can approve it.`);
    if (creditShort) return setValidation(creditPosition.creditHold ? (creditPosition.holdReason || 'This customer is on credit hold.') : `This order is more than the customer's credit room of ${money(creditPosition.available)}.`);
    if (advanceInvalid) return setValidation('Advance must be between zero and the order total.');
    try {
      const result = await create({ variables: { input: {
        customerId: customer.id, ownerId, paymentMode,
        advanceAmount: paymentMode === 'cash' ? advance : 0,
        paymentTerms, notes,
        promisedDate: promisedDate ? new Date(`${promisedDate}T18:00:00`).toISOString() : undefined,
        idempotencyKey: crypto.randomUUID(),
        taxMode,
        lines: serializeLines(lines, rowByKey, taxMode, 'PERCENT', 0, 'EXCLUSIVE'),
      } } });
      setCreated(result.data?.createDirectSalesOrder);
      setCustomer(null); setLines([]); setAdvanceAmount(''); setNotes(''); setPaymentMode('cash'); setTaxMode('gst'); setPaymentTerms('Cash on order'); setPromisedDate(localDate(1));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      setValidation(describeApolloError(error, 'CreateDirectSalesOrder').message);
    }
  };

  const results: any[] = search.data?.globalSearch?.products || [];

  return <div className="space-y-5 pb-12">
    {setup.error || search.error ? <QueryErrorBanner error={(setup.error || search.error)!} /> : null}
    <section className="mp-card flex flex-col justify-between gap-4 rounded-r6 border border-[var(--line)] p-5 lg:flex-row lg:items-end">
      <div>
        <Link href="/dashboard/orders" className="inline-flex items-center text-xs font-semibold uppercase tracking-wider text-[var(--brand-700)]"><ArrowLeft className="mr-1.5 h-4 w-4"/>Order book</Link>
        <h1 className="mt-3 font-display text-2xl font-bold sm:text-3xl">Direct sales order</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--ink-3)]">For a sale without a quote. Prices follow Product Master like a quote, as a GST bill (GST added on top) or without GST. Stock is reserved, shortfalls go to purchase, and a dispatch job is made.</p>
      </div>
      <div className="min-w-[15rem] rounded-r4 bg-[var(--ink)] px-5 py-4 text-[var(--surface)]">
        {withGst ? <>
          <div className="flex justify-between gap-4 text-xs text-white/70"><span>Taxable</span><span className="tabular-nums">{money(totals.taxable)}</span></div>
          <div className="mt-0.5 flex justify-between gap-4 text-xs text-white/70"><span>GST added</span><span className="tabular-nums">{money(totals.gst)}</span></div>
        </> : <div className="text-xs text-white/70">Without GST bill</div>}
        <div className="mt-2 flex items-baseline justify-between gap-4 border-t border-white/20 pt-2"><span className="text-xs font-semibold uppercase tracking-wider text-white/70">Order total</span><span className="text-2xl font-black tabular-nums">{money(totals.total)}</span></div>
      </div>
    </section>

    {created ? <CreatedOrder order={created} /> : null}

    <section className="grid gap-5 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div className="space-y-5">
        <div className="mp-panel space-y-4 p-5">
          <h2 className="text-lg font-semibold">Customer and sales person</h2>
          <div>
            <span className={label}>Customer</span>
            {customer ? (
              <div className="mt-1.5 flex items-start justify-between gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3">
                <div className="min-w-0"><p className="truncate font-semibold text-[var(--ink)]">{customer.name}</p><p className="text-xs text-[var(--ink-4)]">{[maskedMobile(customer.mobile), customer.city].filter(Boolean).join(' · ') || 'No phone saved'}</p></div>
                <button type="button" onClick={() => setPickerOpen(true)} className="shrink-0 text-xs font-semibold text-[var(--brand-700)] hover:underline">Change</button>
              </div>
            ) : (
              <button type="button" onClick={() => setPickerOpen(true)} className="mt-1.5 flex h-10 w-full items-center gap-2 rounded-lg border border-dashed border-[var(--line-strong)] px-3 text-sm font-semibold text-[var(--brand-700)] hover:bg-[var(--surface-2)]"><UserRound className="h-4 w-4"/>Find by phone or name, or add new</button>
            )}
          </div>
          <label className={label}>Sales person
            <select value={ownerId} onChange={(event) => setOwnerId(event.target.value)} className={field}>
              <option value="">Choose sales person</option>
              {salesUsers.map((row) => <option key={row.id} value={row.id}>{row.name} · {String(row.role).replace('_', ' ')}</option>)}
            </select>
          </label>
        </div>

        <div className="mp-panel space-y-4 p-5">
          <h2 className="text-lg font-semibold">Bill, payment and delivery</h2>
          <div>
            <span className={label}>Bill</span>
            <div className="mt-1.5 grid grid-cols-2 gap-1 rounded-lg bg-[var(--surface-2)] p-1">
              {([['gst', 'GST bill'], ['non_gst', 'Without GST']] as const).map(([mode, text]) => <button key={mode} type="button" aria-pressed={taxMode === mode} onClick={() => setTaxMode(mode)} className={`h-9 rounded-md text-xs font-bold uppercase tracking-wider ${taxMode === mode ? 'bg-[var(--ink)] text-[var(--surface)]' : 'text-[var(--ink-3)]'}`}>{text}</button>)}
            </div>
            <p className="mt-1 text-xs text-[var(--ink-4)]">{withGst ? 'GST is added on top of each rate.' : 'No GST is charged on any line.'}</p>
          </div>
          <span className={label}>Payment</span>
          <div className="-mt-2.5 grid grid-cols-2 gap-1 rounded-lg bg-[var(--surface-2)] p-1">
            {(['cash', 'credit'] as const).map((mode) => <button key={mode} type="button" onClick={() => { setPaymentMode(mode); setPaymentTerms(mode === 'credit' ? 'Net 30' : 'Cash on order'); }} className={`h-9 rounded-md text-xs font-bold uppercase tracking-wider ${paymentMode === mode ? 'bg-[var(--ink)] text-[var(--surface)]' : 'text-[var(--ink-3)]'}`}>{mode}</button>)}
          </div>
          {paymentMode === 'credit' ? (
            !customer ? <p className="text-xs text-[var(--ink-4)]">Choose the customer to see their credit room.</p>
              : credit.loading ? <p className="text-xs text-[var(--ink-4)]">Checking credit…</p>
              : creditPosition ? <div className={`rounded-lg p-3 text-xs ${creditShort ? 'bg-[var(--danger-bg,#fef2f2)] text-[var(--danger,#b91c1c)]' : 'bg-[var(--surface-2)] text-[var(--ink-3)]'}`}>
                {creditPosition.creditHold ? <b>On credit hold{creditPosition.holdReason ? `: ${creditPosition.holdReason}` : ''}</b>
                  : creditPosition.available == null ? <span>No credit limit set. Outstanding {money(creditPosition.exposure)}.</span>
                  : <span>Credit room <b>{money(creditPosition.available)}</b> of {money(creditPosition.creditLimit)} · outstanding {money(creditPosition.exposure)}</span>}
              </div> : null
          ) : (
            <label className={label}>Advance received<Input className="mt-1.5" type="number" min={0} max={totals.total} value={advanceAmount} onChange={(event) => setAdvanceAmount(event.target.value)} placeholder="₹ 0 (optional)"/>
              {advanceInvalid ? <span className="mt-1 block normal-case tracking-normal text-[var(--danger,#b91c1c)]">Cannot be more than the order total.</span> : null}
            </label>
          )}
          <label className={label}>Payment terms<Input className="mt-1.5" value={paymentTerms} onChange={(event) => setPaymentTerms(event.target.value)}/></label>
          <label className={label}>Promised date<Input className="mt-1.5" type="date" min={localDate(0)} value={promisedDate} onChange={(event) => setPromisedDate(event.target.value)}/></label>
          <label className={label}>Notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-1.5 min-h-20 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 text-sm normal-case tracking-normal text-[var(--ink)]" placeholder="Delivery or site instructions"/></label>
        </div>
      </div>

      <div className="min-w-0 space-y-4">
        <div className="mp-panel p-4">
          <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-5)]"/><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Add product: code, name or brand" className="pl-10"/></div>
          {query.trim().length >= 2 ? <div className="mt-2 max-h-72 divide-y divide-[var(--line)] overflow-y-auto rounded-lg border border-[var(--line)]">
            {search.loading ? <p className="p-3 text-sm text-[var(--ink-4)]">Searching…</p>
              : !results.length ? <p className="p-3 text-sm text-[var(--ink-4)]">No product matches “{query.trim()}”.</p>
              : results.map((product) => {
                const inactive = String(product.status || 'active').toLowerCase() !== 'active';
                const mrp = Number(product.defaultMrpInclusive || 0);
                return <button key={product.id} type="button" disabled={inactive || adding === product.id} onClick={() => add(product)} className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-50">
                  <span className="min-w-0"><b className="block truncate text-sm text-[var(--ink)]">{product.internalCode || product.sku} · {product.name}</b><span className="block truncate text-xs text-[var(--ink-4)]">{[product.brand, product.category, product.finish].filter(Boolean).join(' · ')}{inactive ? ' · inactive' : ''}</span></span>
                  <span className="flex shrink-0 items-center gap-3 text-right text-xs">{mrp > 0 ? <span><b className="block text-[var(--ink)]">{money(mrp)}</b><span className="text-[var(--ink-4)]">MRP / {unitLabel(product.priceUom || product.salesUom || product.unit).toLowerCase()}</span></span> : <span className="font-semibold text-[var(--warning)]">MRP missing</span>}<PackagePlus className="h-5 w-5 text-[var(--brand-700)]"/></span>
                </button>;
              })}
          </div> : null}
        </div>

        {!lines.length ? <div className="rounded-r5 border border-dashed border-[var(--line-strong)] p-8 text-center text-sm text-[var(--ink-4)]">Search above to add products to this order.</div> : null}
        {lines.map((line) => <OrderLine key={line._k} line={line} row={rowByKey.get(line._k)} issues={issuesByKey.get(line._k) || []} canPassFloor={canPassFloor} withGst={withGst} onChange={(patch) => update(line._k, patch)} onRemove={() => setLines((rows) => rows.filter((row) => row._k !== line._k))} />)}

        {belowFloor.length && canPassFloor ? <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0"/>{belowFloor.length} line{belowFloor.length === 1 ? ' is' : 's are'} below the floor rate. Creating the order records your approval.</p> : null}
        {validation ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800">{validation}</p> : null}
        <Button className="w-full" size="lg" disabled={state.loading || !lines.length} onClick={submit}><IndianRupee className="mr-2 h-5 w-5"/>{state.loading ? 'Creating order…' : `Create order · ${money(totals.total)}`}</Button>
      </div>
    </section>
    <CustomerPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={(picked) => { setCustomer(picked); setPickerOpen(false); setValidation(''); }} />
  </div>;
}

function OrderLine({ line, row, issues, canPassFloor, withGst, onChange, onRemove }: { line: Line; row: any; issues: Array<{ key: string; message: string; blocking: boolean }>; canPassFloor: boolean; withGst: boolean; onChange: (patch: Record<string, any>) => void; onRemove: () => void }) {
  const stock = useQuery(STOCK, { variables: { productId: line.productId }, skip: !line.productId, fetchPolicy: 'cache-and-network' });
  const balance = stock.data?.inventoryBalances?.[0];
  const tile = isTileLine(line);
  const basis = pricingBasis(line);
  const tileUnit = tile ? tilePriceUom(line.pricingUom) : '';
  const stockUnit = unitLabel(line.inventoryUom || line.unit);
  const qty = Number(line.qty || 0);
  // Stock is counted in base units (pieces for a tile sold by the box); the order in selling units.
  const perUnit = String(line.baseUom || 'PC').toUpperCase() === 'PC' && ['BOX', 'PACK', 'CARTON'].includes(String(line.stockUnit || stockUnit).toUpperCase())
    ? Math.max(1, Math.trunc(Number(line.piecesPerPack || 1))) : 1;
  const available = balance ? Math.floor(Math.max(0, Number(balance.available || 0)) / perUnit) : null;
  const short = available != null && qty > available ? qty - available : 0;
  const mrp = Number(row?.mrpInclusive || line.mrpInclusive || 0);
  const shown = issues.filter((issue) => issue.key !== 'family');
  return <article className="mp-panel p-4">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="font-bold text-[var(--ink)]">{line.internalCode || line.sku} · {line.name}</p>
        <p className="mt-0.5 text-xs text-[var(--ink-4)]">{[line.brand, line.finish, line.tileSize && tile ? line.tileSize : ''].filter(Boolean).join(' · ')}</p>
      </div>
      <button type="button" title="Remove line" aria-label={`Remove ${line.name}`} onClick={onRemove} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-red-700 hover:bg-red-50"><Trash2 className="h-4 w-4"/></button>
    </div>
    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,8rem)_minmax(0,9rem)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,9rem)]">
      {tile && tileUnit !== 'PC' ? (
        <label className={label}>Area ({tileUnit.toLowerCase()})<Input className="mt-1.5" type="number" min={0} value={line.requestedArea || ''} onChange={(e) => onChange({ requestedArea: e.target.value === '' ? '' : Number(e.target.value) })} placeholder="Enter area"/><span className="mt-1 block normal-case tracking-normal text-[var(--ink-4)]">{qty} {stockUnit.toLowerCase()}</span></label>
      ) : tile ? (
        <label className={label}>Pieces<Input className="mt-1.5" type="number" min={0} value={line.requestedPieces || ''} onChange={(e) => onChange({ requestedPieces: e.target.value === '' ? '' : Number(e.target.value) })} placeholder="Enter pieces"/><span className="mt-1 block normal-case tracking-normal text-[var(--ink-4)]">{qty} {stockUnit.toLowerCase()}</span></label>
      ) : (
        <label className={label}>Qty ({stockUnit.toLowerCase()})<Input className="mt-1.5" type="number" min={1} step={1} value={line.qty || ''} onChange={(e) => onChange({ qty: e.target.value === '' ? '' : Math.max(0, Math.trunc(Number(e.target.value))) })} placeholder="Qty"/></label>
      )}
      <div className={label}>MRP / {mrpUom(line).toLowerCase()}
        <p className="mt-1.5 flex h-10 items-center rounded-lg bg-[var(--surface-2)] px-3 text-sm font-semibold normal-case tracking-normal text-[var(--ink)]">{mrp > 0 ? money(mrp) : <span className="text-[var(--warning)]">Missing</span>}</p>
        <span className="mt-1 block normal-case tracking-normal text-[var(--ink-4)]">{mrp > 0 ? `Product Master · ${basis === 'AREA' ? 'per area' : basis === 'PIECE' ? 'per piece' : 'per box'}` : <Link href="/dashboard/master-data/pricing-readiness?tab=missing" className="text-[var(--brand-700)] underline">Add in MRP Control Desk</Link>}</span>
      </div>
      <label className={label}>NRP
        <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_7.5rem] gap-1">
          <Input type="number" min={0} max={line.nrpMode === 'PERCENT_OFF_MRP' ? 100 : undefined} value={line.nrpInput === 0 || line.nrpInput == null ? '' : line.nrpInput} onChange={(e) => onChange({ nrpInput: e.target.value })} placeholder={line.nrpMode === 'FIXED_NRP' ? 'NRP ₹' : '% off'}/>
          <select className="h-10 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 text-xs font-semibold normal-case tracking-normal" value={line.nrpMode} onChange={(e) => onChange({ nrpMode: e.target.value, nrpInput: '' })}><option value="PERCENT_OFF_MRP">% off MRP</option><option value="FIXED_NRP">Set NRP ₹</option></select>
        </div>
        <span className="mt-1 block normal-case tracking-normal text-[var(--brand-700)]">NRP {money(row?.nrpInclusive || 0)}</span>
      </label>
      <label className={label}>Special (optional)
        <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_7.5rem] gap-1">
          <Input disabled={line.specialMode === 'NONE'} type="number" min={0} max={line.specialMode === 'PERCENT_OFF_NRP' ? 100 : undefined} value={line.specialInput === 0 || line.specialInput == null ? '' : line.specialInput} onChange={(e) => onChange({ specialInput: e.target.value })} placeholder={line.specialMode === 'FIXED_SPECIAL_RATE' ? 'Rate ₹' : line.specialMode === 'PERCENT_OFF_NRP' ? '% off' : '—'}/>
          <select className="h-10 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 text-xs font-semibold normal-case tracking-normal" value={line.specialMode} onChange={(e) => onChange({ specialMode: e.target.value, specialInput: '' })}><option value="NONE">No special</option><option value="PERCENT_OFF_NRP">% off NRP</option><option value="FIXED_SPECIAL_RATE">Set rate ₹</option></select>
        </div>
        <span className="mt-1 block normal-case tracking-normal text-[var(--info,#1d4ed8)]">Rate {money(row?.specialRateInclusive || 0)} / {mrpUom(line).toLowerCase()}</span>
      </label>
      <div className="rounded-lg bg-[var(--surface-2)] p-2.5 text-right text-xs text-[var(--ink-4)]">
        {withGst ? <>
          <p>Taxable <span className="tabular-nums text-[var(--ink-3)]">{money(row?.taxableValue || 0)}</span></p>
          <p>GST <span className="tabular-nums text-[var(--ink-3)]">{money(row?.taxAmount || 0)}</span></p>
        </> : <p>Without GST</p>}
        <p className="mt-1 text-base font-black tabular-nums text-[var(--ink)]">{money(row?.total || 0)}</p>
      </div>
    </div>
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      {available != null ? <span className={short ? 'font-semibold text-[var(--warning)]' : 'text-[var(--ink-4)]'}>{available} {stockUnit.toLowerCase()} in stock{short ? ` · ${short} to order from supplier` : ''}</span> : stock.loading ? <span className="text-[var(--ink-4)]">Checking stock…</span> : <span className="text-[var(--ink-4)]">No stock record · all {qty} to order</span>}
      {shown.map((issue) => <span key={issue.key} className={issue.blocking ? 'font-semibold text-[var(--danger,#b91c1c)]' : 'font-semibold text-[var(--warning)]'}>{issue.key === 'floor' && !canPassFloor ? `${issue.message.replace(' · owner approval', '')} · make a quote for owner approval` : issue.message}</span>)}
    </div>
  </article>;
}

// After creating: what was reserved from stock and what waits for inward, per item.
function CreatedOrder({ order }: { order: any }) {
  const detail = useQuery(ORDER_STOCK, { variables: { id: order.id }, fetchPolicy: 'network-only' });
  const full = detail.data?.salesOrder;
  const lines: any[] = Array.isArray(full?.lines) ? full.lines : [];
  const held = new Map<string, { reserved: number; waiting: number }>();
  for (const reservation of full?.reservations || []) {
    const entry = held.get(reservation.productId) || { reserved: 0, waiting: 0 };
    const quantity = Number(reservation.sellingQuantity ?? reservation.quantity ?? 0);
    if (reservation.status === 'reserved') entry.reserved += quantity;
    else entry.waiting += quantity;
    held.set(reservation.productId, entry);
  }
  const waitingTotal = Array.from(held.values()).reduce((sum, entry) => sum + entry.waiting, 0);
  return <section className="rounded-r5 border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3"><CheckCircle2 className="h-6 w-6"/><div><p className="font-bold">{order.orderNumber} created · {money(Number(order.totalAmount || 0))}</p><p className="text-sm">{full?.documents?.taxMode === 'non_gst' ? 'Without GST bill. ' : 'GST bill. '}{String(order.paymentMode || '').toUpperCase() === 'CREDIT' ? 'On credit.' : 'Cash.'} A dispatch job is ready.</p></div></div>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline"><a href={`/api/pdf/order/${order.id}`} target="_blank" rel="noreferrer">Open PDF</a></Button>
        {waitingTotal > 0 ? <Button asChild variant="outline"><Link href={`/dashboard/pending-inward?search=${encodeURIComponent(order.orderNumber || '')}`}>Pending inward</Link></Button> : null}
        <Button asChild><Link href={`/dashboard/orders?search=${encodeURIComponent(order.orderNumber || '')}`}>Open order</Link></Button>
      </div>
    </div>
    {detail.loading && !full ? <p className="mt-3 text-sm">Checking stock…</p> : lines.length ? <div className="mt-3 overflow-x-auto rounded-lg border border-emerald-200 bg-white/70">
      <table className="w-full min-w-[28rem] text-sm">
        <thead><tr className="text-left text-xs uppercase tracking-wider text-emerald-900/70"><th className="px-3 py-2 font-semibold">Item</th><th className="px-3 py-2 text-right font-semibold">Ordered</th><th className="px-3 py-2 text-right font-semibold">Reserved</th><th className="px-3 py-2 text-right font-semibold">Pending inward</th></tr></thead>
        <tbody>{lines.map((line, index) => {
          const entry = held.get(line.productId) || { reserved: 0, waiting: 0 };
          const unit = String(line.inventoryUom || line.unit || 'PC').toLowerCase();
          return <tr key={`${line.lineKey || index}`} className="border-t border-emerald-100">
            <td className="px-3 py-2"><b className="font-semibold">{line.name}</b><span className="block text-xs text-emerald-900/70">{line.internalCode || line.sku}</span></td>
            <td className="px-3 py-2 text-right tabular-nums">{Number(line.qty || line.quantity || 0)} {unit}</td>
            <td className="px-3 py-2 text-right tabular-nums">{Number(entry.reserved.toFixed(2))} {unit}</td>
            <td className={`px-3 py-2 text-right tabular-nums ${entry.waiting ? 'font-semibold text-amber-800' : ''}`}>{Number(entry.waiting.toFixed(2))} {unit}</td>
          </tr>;
        })}</tbody>
      </table>
    </div> : null}
  </section>;
}
