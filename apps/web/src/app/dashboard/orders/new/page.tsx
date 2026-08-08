'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { gql, useMutation, useQuery } from '@apollo/client';
import { ArrowLeft, CheckCircle2, IndianRupee, PackagePlus, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QueryErrorBanner } from '@/components/query-state';

const SETUP = gql`query DirectOrderSetup { customers { id name mobile city siteAddress } salesAssignees }`;
const SEARCH_PRODUCTS = gql`query DirectOrderProducts($query: String!) { globalSearch(query: $query) { products } }`;
const CREATE = gql`mutation CreateDirectSalesOrder($input: CreateDirectSalesOrderInput!) { createDirectSalesOrder(input: $input) }`;

const money = (value: number) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const basisFor = (product: any) => {
  const sales = String(product.salesUom || product.unit || 'PC').toUpperCase();
  const inventory = String(product.purchaseUom || product.unit || 'PC').toUpperCase();
  if (['SQFT', 'SQM', 'M2'].includes(sales)) return 'AREA';
  if (sales === 'PC' && inventory !== 'PC') return 'PIECE';
  return 'PACK';
};
const pricingQuantity = (line: any) => line.rateBasis === 'AREA'
  ? Number(line.qty || 0) * Number(line.coveragePerPack || 0)
  : line.rateBasis === 'PIECE' ? Number(line.qty || 0) * Number(line.piecesPerPack || 1) : Number(line.qty || 0);
const totalsFor = (line: any) => {
  const quantity = pricingQuantity(line);
  const list = Number(line.listPrice || 0);
  const discount = Math.max(0, Math.min(100, Number(line.discountPercent || 0)));
  const unitRate = line.specialRate === '' ? list * (1 - discount / 100) : Number(line.specialRate || 0);
  const taxableValue = quantity * unitRate;
  const taxAmount = taxableValue * Number(line.taxRate || 0) / 100;
  const total = taxableValue + taxAmount;
  const finalUnitPayable = quantity > 0 ? total / quantity : 0;
  return { quantity, unitRate, taxableValue, taxAmount, total, finalUnitPayable };
};

export default function DirectSalesOrderPage() {
  const [customerId, setCustomerId] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [query, setQuery] = useState('');
  const [lines, setLines] = useState<any[]>([]);
  const [paymentMode, setPaymentMode] = useState('cash');
  const [advanceAmount, setAdvanceAmount] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('Cash on order');
  const [promisedDate, setPromisedDate] = useState(() => new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [created, setCreated] = useState<any>(null);
  const [validation, setValidation] = useState('');
  const { data, error } = useQuery(SETUP);
  const { data: searchData, loading: searching, error: searchError } = useQuery(SEARCH_PRODUCTS, { variables: { query }, skip: query.trim().length < 2 });
  const [create, state] = useMutation(CREATE, { onCompleted: (result) => setCreated(result.createDirectSalesOrder) });
  const total = useMemo(() => lines.reduce((sum, line) => sum + totalsFor(line).total, 0), [lines]);
  const salesUsers = data?.salesAssignees || [];

  const add = (product: any) => {
    const rateBasis = basisFor(product);
    const mrpBasis = String(product.mrpRateBasis || '').toUpperCase();
    setLines((current) => [...current, {
      id: crypto.randomUUID(), lineKey: `direct:${product.id}:${Date.now()}`, productId: product.id,
      sku: product.sku, name: product.name, category: product.category, brand: product.brand, finish: product.finish,
      qty: 1, unit: product.purchaseUom || product.unit || 'PC', inventoryUom: product.purchaseUom || product.unit || 'PC',
      pricingUom: product.salesUom || product.unit || 'PC', rateBasis, coveragePerPack: Number(product.coveragePerPack || 0),
      piecesPerPack: Number(product.piecesPerPack || 1), listPrice: Number(product.sellPrice || 0),
      discountPercent: 0, specialRate: '', taxRate: 18,
      mrp: mrpBasis === rateBasis && Number(product.mrp || 0) > 0 ? Number(product.mrp) : '',
      mrpRateBasis: rateBasis, mrpSource: mrpBasis === rateBasis ? 'PRODUCT_MASTER' : 'MANUAL', media: product.media,
    }]);
    setQuery('');
  };
  const update = (id: string, patch: any) => setLines((current) => current.map((line) => line.id === id ? { ...line, ...patch } : line));

  const submit = async () => {
    setValidation('');
    if (!customerId || !ownerId) return setValidation('Select the customer and responsible sales user.');
    if (!lines.length) return setValidation('Add at least one Product Master SKU.');
    const bad = lines.find((line) => {
      const totals = totalsFor(line);
      return Number(line.qty || 0) <= 0 || Number(line.listPrice || 0) <= 0 || Number(line.mrp || 0) <= 0 || totals.finalUnitPayable > Number(line.mrp || 0) + 0.5;
    });
    if (bad) return setValidation(`${bad.sku}: quantity, list rate and tax-inclusive MRP are required, and final payable cannot exceed MRP.`);
    const payload = lines.map(({ id, ...line }) => ({ ...line, ...totalsFor(line), mrp: Number(line.mrp), mrpConfirmedAt: new Date().toISOString(), mrpConfirmedById: ownerId }));
    await create({ variables: { input: { customerId, ownerId, paymentMode, advanceAmount: paymentMode === 'cash' ? Number(advanceAmount || 0) : 0, paymentTerms, promisedDate: promisedDate ? new Date(`${promisedDate}T18:00:00`).toISOString() : undefined, notes, idempotencyKey: crypto.randomUUID(), lines: JSON.stringify(payload) } } });
  };

  return <div className="space-y-6 pb-12">
    {(error || searchError || state.error) ? <QueryErrorBanner error={(error || searchError || state.error)!} /> : null}
    <section className="mp-card rounded-r6 border border-[var(--line)] p-6">
      <Link href="/dashboard/orders" className="inline-flex items-center text-xs font-black uppercase tracking-wider text-[var(--brand-700)]"><ArrowLeft className="mr-2 h-4 w-4"/>Order book</Link>
      <div className="mt-4 flex flex-col justify-between gap-4 lg:flex-row lg:items-end"><div><p className="text-xs font-medium uppercase tracking-wider text-[var(--ink-4)]">Direct order desk</p><h1 className="mt-2 font-display text-3xl font-bold">Create a sales order without a quote.</h1><p className="mt-2 text-sm font-semibold text-[var(--ink-4)]">The order still creates a customer CRM timeline, salesperson attribution, reservations, pending inward demand, dispatch job and account trail.</p></div><div className="rounded-r4 bg-[var(--ink)] px-5 py-4 text-white"><p className="text-xs font-bold uppercase tracking-wider text-white/70">Order total</p><p className="mt-1 text-3xl font-black">{money(total)}</p></div></div>
    </section>
    {created ? <section className="flex flex-wrap items-center justify-between gap-3 rounded-r5 border border-emerald-200 bg-emerald-50 p-5 text-emerald-950"><div className="flex items-center gap-3"><CheckCircle2 className="h-6 w-6"/><div><p className="font-black">{created.orderNumber} created</p><p className="text-sm">Stock and pending inward have been calculated.</p></div></div><div className="flex gap-2"><Button asChild variant="outline"><a href={`/api/pdf/order/${created.id}`} target="_blank" rel="noreferrer">Open PDF</a></Button><Button asChild><Link href="/dashboard/orders">Order book</Link></Button></div></section> : null}
    <section className="grid gap-6 xl:grid-cols-[0.72fr_1.28fr]">
      <div className="space-y-5">
        <div className="mp-panel space-y-4 p-5"><h2 className="text-xl font-semibold">Commercial ownership</h2><label className="block text-xs font-bold uppercase tracking-wider text-[var(--ink-4)]">Customer<select value={customerId} onChange={(event)=>setCustomerId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm"><option value="">Select customer</option>{(data?.customers || []).map((row:any)=><option key={row.id} value={row.id}>{row.name} · {row.city || row.mobile}</option>)}</select></label><label className="block text-xs font-bold uppercase tracking-wider text-[var(--ink-4)]">Responsible sales user<select value={ownerId} onChange={(event)=>setOwnerId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm"><option value="">Select sales user</option>{salesUsers.map((row:any)=><option key={row.id} value={row.id}>{row.name} · {String(row.role).replace('_',' ')}</option>)}</select></label></div>
        <div className="mp-panel space-y-4 p-5"><h2 className="text-xl font-semibold">Payment and promise</h2><div className="grid grid-cols-2 gap-2">{['cash','credit'].map((mode)=><button key={mode} onClick={()=>{setPaymentMode(mode);setPaymentTerms(mode==='credit'?'Net 30':'Cash on order');}} className={`h-10 rounded-xl text-xs font-black uppercase ${paymentMode===mode?'bg-[var(--ink)] text-white':'bg-[var(--muted)]'}`}>{mode}</button>)}</div>{paymentMode==='cash'?<label className="block text-xs font-bold uppercase tracking-wider text-[var(--ink-4)]">Advance received<Input className="mt-2" type="number" min={0} max={total} value={advanceAmount} onChange={(event)=>setAdvanceAmount(event.target.value)}/></label>:null}<label className="block text-xs font-bold uppercase tracking-wider text-[var(--ink-4)]">Payment terms<Input className="mt-2" value={paymentTerms} onChange={(event)=>setPaymentTerms(event.target.value)}/></label><label className="block text-xs font-bold uppercase tracking-wider text-[var(--ink-4)]">Promised date<Input className="mt-2" type="date" value={promisedDate} onChange={(event)=>setPromisedDate(event.target.value)}/></label><label className="block text-xs font-bold uppercase tracking-wider text-[var(--ink-4)]">Notes<textarea value={notes} onChange={(event)=>setNotes(event.target.value)} className="mt-2 min-h-20 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3 text-sm"/></label></div>
      </div>
      <div className="space-y-5"><div className="mp-panel p-5"><div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-5)]"/><Input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Search Product Master SKU, internal code or name" className="pl-10"/></div>{query.length>=2?<div className="mt-3 max-h-64 divide-y divide-[var(--line)] overflow-y-auto rounded-xl border border-[var(--line)]">{searching?<p className="p-4 text-sm">Searching…</p>:(searchData?.globalSearch?.products || []).map((product:any)=><button key={product.id} onClick={()=>add(product)} className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-[var(--muted)]"><span><b className="block text-sm">{product.internalCode || product.sku} · {product.name}</b><span className="text-xs text-[var(--ink-4)]">{product.brand} · {product.category}</span></span><PackagePlus className="h-5 w-5 text-[var(--brand-700)]"/></button>)}</div>:null}</div>
        <div className="space-y-3">{lines.map((line)=>{const calc=totalsFor(line);return <article key={line.id} className="mp-panel p-4"><div className="flex justify-between gap-3"><div><p className="font-black">{line.sku} · {line.name}</p><p className="mt-1 text-xs font-semibold text-[var(--ink-4)]">{line.brand} · billed by {line.rateBasis.toLowerCase()}</p></div><button title="Remove line" onClick={()=>setLines((rows)=>rows.filter((row)=>row.id!==line.id))} className="h-9 w-9 rounded-lg text-red-700 hover:bg-red-50"><Trash2 className="mx-auto h-4 w-4"/></button></div><div className="mt-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-6"><label className="text-[10px] font-bold uppercase text-[var(--ink-4)]">Qty<Input className="mt-1" type="number" min={1} value={line.qty} onChange={(e)=>update(line.id,{qty:Number(e.target.value)})}/></label><label className="text-[10px] font-bold uppercase text-[var(--ink-4)]">Basis<select className="mt-1 h-10 w-full rounded-md border border-[var(--line)] px-2 text-sm" value={line.rateBasis} onChange={(e)=>update(line.id,{rateBasis:e.target.value,mrp:'',mrpRateBasis:e.target.value,mrpSource:'MANUAL'})}><option value="PACK">Box/pack</option><option value="PIECE">Piece</option>{Number(line.coveragePerPack)>0?<option value="AREA">Area</option>:null}</select></label><label className="text-[10px] font-bold uppercase text-[var(--ink-4)]">List rate<Input className="mt-1" type="number" min={0.01} value={line.listPrice} onChange={(e)=>update(line.id,{listPrice:e.target.value})}/></label><label className="text-[10px] font-bold uppercase text-[var(--ink-4)]">Discount %<Input className="mt-1" type="number" min={0} max={100} value={line.discountPercent} onChange={(e)=>update(line.id,{discountPercent:e.target.value,specialRate:''})}/></label><label className="text-[10px] font-bold uppercase text-[var(--ink-4)]">MRP incl tax<Input className="mt-1" type="number" min={0.01} value={line.mrp} onChange={(e)=>update(line.id,{mrp:e.target.value,mrpSource:'MANUAL'})}/></label><div className="rounded-lg bg-[var(--muted)] p-2 text-right"><p className="text-[10px] font-bold uppercase text-[var(--ink-4)]">Payable</p><p className="mt-2 font-black text-emerald-700">{money(calc.total)}</p><p className={`text-[10px] font-bold ${calc.finalUnitPayable>Number(line.mrp||0)?'text-red-700':'text-[var(--ink-4)]'}`}>{money(calc.finalUnitPayable)} / unit</p></div></div></article>})}</div>
        {validation?<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">{validation}</p>:null}<Button className="w-full" size="lg" disabled={state.loading || !lines.length || !customerId || !ownerId} onClick={submit}><IndianRupee className="mr-2 h-5 w-5"/>{state.loading?'Creating order…':'Create direct sales order'}</Button>
      </div>
    </section>
  </div>;
}
