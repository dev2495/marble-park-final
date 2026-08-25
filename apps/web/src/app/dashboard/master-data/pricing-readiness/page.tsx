'use client';

import { useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, CheckCircle2, Database, Loader2, PackageSearch, Save, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDebouncedValue } from '@/hooks/use-debounced-value';

const READINESS = gql`
  query ProductPricingReadiness($search:String,$status:String,$sort:String,$skip:Int,$take:Int){
    productPricingReadinessPage(search:$search,status:$status,sort:$sort,skip:$skip,take:$take)
  }
`;
const COMPLETE = gql`
  mutation CompleteProductPricing($input:ProductPricingCompletionInput!){
    completeProductPricing(input:$input){id sku defaultMrpInclusive defaultNrpInclusive floorPriceInclusive priceRateBasis priceUom updatedAt}
  }
`;

function money(value: unknown, digits = 0) {
  const amount = Number(value || 0);
  return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function imageOf(media: any) {
  const source = typeof media === 'string' ? (() => { try { return JSON.parse(media); } catch { return {}; } })() : media || {};
  const gallery = Array.isArray(source.gallery) ? source.gallery : Array.isArray(source.images) ? source.images : [];
  return source.primaryUrl || source.primaryImage || source.primary || (typeof gallery[0] === 'string' ? gallery[0] : gallery[0]?.url) || '';
}

function PricingRow({ row, onSaved }: { row:any; onSaved:() => Promise<any> }) {
  const isTile = String(row.category || '').toLowerCase() === 'tiles';
  const fallbackUom = String(row.salesUom || row.unit || 'PC').toUpperCase();
  const fallbackBasis = fallbackUom === 'PC' ? 'PIECE' : fallbackUom === 'SQFT' ? 'AREA' : 'BOX';
  const [form,setForm]=useState({
    mrp: row.defaultMrpInclusive == null ? '' : String(row.defaultMrpInclusive),
    nrp: row.defaultNrpInclusive == null ? '' : String(row.defaultNrpInclusive),
    floor: row.floorPriceInclusive == null ? '' : String(row.floorPriceInclusive),
    basis: isTile ? 'AREA' : row.priceRateBasis || fallbackBasis,
    uom: isTile ? 'SQFT' : row.priceUom || fallbackUom,
    source: row.mrpSource || 'MANUAL',
  });
  const [message,setMessage]=useState('');
  const [reason,setReason]=useState('');
  const [save,{loading}]=useMutation(COMPLETE);
  const mrpChanged = row.defaultMrpInclusive != null && Math.abs(Number(form.mrp) - Number(row.defaultMrpInclusive)) > 0.0001;
  const invalid = Number(form.mrp) <= 0 || (form.nrp !== '' && Number(form.nrp) > Number(form.mrp)) || (form.floor !== '' && Number(form.floor) > Number(form.nrp || form.mrp)) || (mrpChanged && reason.trim().length < 3);
  async function submit() {
    setMessage('');
    try {
      await save({variables:{input:{productId:row.id,defaultMrpInclusive:Number(form.mrp),defaultNrpInclusive:form.nrp===''?null:Number(form.nrp),floorPriceInclusive:form.floor===''?null:Number(form.floor),priceRateBasis:isTile?'AREA':form.basis,priceUom:isTile?'SQFT':form.uom,mrpSource:form.source,mrpChangeReason:mrpChanged?reason.trim():undefined,pricingEffectiveFrom:new Date().toISOString(),expectedUpdatedAt:row.updatedAt}}});
      setMessage('MRP verified. Loading the next SKU…');
      await onSaved();
    } catch (error:any) { setMessage(error?.message || 'Pricing could not be saved.'); }
  }
  const cost = row.cost || {};
  return <article className="grid gap-4 border-b border-[var(--line)] p-4 last:border-b-0 xl:grid-cols-[minmax(280px,1.25fr)_minmax(430px,1.8fr)_minmax(220px,.8fr)] xl:items-center">
    <div className="flex min-w-0 items-center gap-3">
      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-r3 bg-[var(--bg-soft)]">{imageOf(row.media)?<img src={imageOf(row.media)} alt="" className="h-full w-full object-contain p-1"/>:<PackageSearch className="m-4 h-6 w-6 text-[var(--ink-4)]"/>}</div>
      <div className="min-w-0"><p className="truncate text-sm font-black text-[var(--ink)]">{row.internalCode||row.sku} · {row.name}</p><p className="mt-1 truncate text-xs font-semibold text-[var(--ink-4)]">{row.sku} · {row.brandCode||row.brand||'No brand'} · {row.category}</p><span className={`mt-2 inline-flex rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-wider ${row.defaultMrpInclusive?'bg-emerald-50 text-emerald-800':'bg-amber-50 text-amber-800'}`}>{row.defaultMrpInclusive?'MRP ready':'MRP missing'}</span></div>
    </div>
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      <label className="grid gap-1 text-[10px] font-black uppercase tracking-wider text-[var(--ink-4)]">MRP incl. GST *<Input type="number" min="0.01" step="0.01" value={form.mrp} onChange={e=>setForm({...form,mrp:e.target.value})} placeholder={isTile?'₹ / sq ft':'Required'}/></label>
      <label className="grid gap-1 text-[10px] font-black uppercase tracking-wider text-[var(--ink-4)]">NRP incl. GST<Input type="number" min="0.01" step="0.01" value={form.nrp} onChange={e=>setForm({...form,nrp:e.target.value})} placeholder="Optional"/></label>
      <label className="grid gap-1 text-[10px] font-black uppercase tracking-wider text-[var(--ink-4)]">Floor incl. GST<Input type="number" min="0.01" step="0.01" value={form.floor} onChange={e=>setForm({...form,floor:e.target.value})} placeholder="Optional"/></label>
      <label className="grid gap-1 text-[10px] font-black uppercase tracking-wider text-[var(--ink-4)]">Basis<select disabled={isTile} value={isTile?'AREA':form.basis} onChange={e=>setForm({...form,basis:e.target.value})} className="h-10 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-xs"><option value="PIECE">Piece</option><option value="BOX">Box</option><option value="AREA">Area</option></select></label>
      <label className="grid gap-1 text-[10px] font-black uppercase tracking-wider text-[var(--ink-4)]">Rate UOM<Input disabled={isTile} value={isTile?'SQFT':form.uom} onChange={e=>setForm({...form,uom:e.target.value.toUpperCase()})}/></label>
      <label className="grid gap-1 text-[10px] font-black uppercase tracking-wider text-[var(--ink-4)]">MRP source<select value={form.source} onChange={e=>setForm({...form,source:e.target.value})} className="h-10 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-xs"><option value="MANUAL">Manual verification</option><option value="PACKAGE">Printed package</option><option value="BRAND_LIST">Brand price list</option></select></label>
      {mrpChanged?<label className="grid gap-1 text-[10px] font-black uppercase tracking-wider text-[#9f342d] sm:col-span-2 lg:col-span-3">MRP change reason *<Input value={reason} onChange={e=>setReason(e.target.value)} placeholder="Example: Revised brand price list"/></label>:null}
      <div className="sm:col-span-2 lg:col-span-3"><Button onClick={submit} disabled={loading||invalid} className="w-full sm:w-auto">{loading?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<Save className="mr-2 h-4 w-4"/>}Verify and continue</Button>{message?<span className={`ml-3 text-xs font-bold ${message.startsWith('MRP verified')?'text-emerald-700':'text-red-700'}`}>{message}</span>:null}</div>
    </div>
    <aside className="rounded-r3 border border-[var(--line)] bg-[var(--bg-soft)] p-3">
      <p className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[.14em] text-[var(--ink-4)]"><Database className="h-3.5 w-3.5"/>Actual lot cost · owner only</p>
      <p className="mt-2 text-lg font-black text-[var(--ink)]">{cost.weightedUnitCost==null?'No costed stock':money(cost.weightedUnitCost,2)}</p>
      <p className="mt-1 text-[10px] font-semibold leading-4 text-[var(--ink-4)]">Read-only weighted cost from {cost.completeCostLots||0} received lot(s). {cost.coveragePercent==null?'No stock on hand.':`${cost.coveragePercent}% of on-hand quantity cost-covered.`}</p>
    </aside>
  </article>;
}

export default function PricingReadinessPage(){
  const pageSize=25; const [search,setSearch]=useState(''); const [status,setStatus]=useState('missing'); const [sort,setSort]=useState('sku'); const [page,setPage]=useState(0); const debounced=useDebouncedValue(search.trim(),300);
  const {data,loading,error,refetch}=useQuery(READINESS,{variables:{search:debounced||undefined,status,sort,skip:page*pageSize,take:pageSize},fetchPolicy:'network-only'});
  const result=data?.productPricingReadinessPage||{}; const rows=result.rows||[]; const progress=result.totalActive?Math.round(Number(result.ready||0)/Number(result.totalActive)*100):100;
  return <div className="space-y-5 pb-10">
    <section className="overflow-hidden rounded-r6 border border-[#7f1d1d]/20 bg-[linear-gradient(115deg,#201615_0%,#5d2723_62%,#a33b31_100%)] p-6 text-white shadow-lg">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-[10px] font-black uppercase tracking-[.2em] text-[#f8c7bf]">Pricing readiness desk</p><h1 className="mt-3 max-w-3xl font-display text-4xl font-bold tracking-[-.04em]">Complete every Product Master MRP before sales reaches the quote.</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-white/75">MRP is the selling-policy source. Floor is an optional approval threshold. Actual cost remains read-only from PO → GRN → inventory lot.</p></div><div className="grid grid-cols-3 gap-2"><Metric value={result.totalMissing??'—'} label="MRP missing"/><Metric value={`${progress}%`} label="Ready"/><Metric value={result.totalActive??'—'} label="Active SKUs"/></div></div>
      <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-[#f7d99a] transition-all" style={{width:`${progress}%`}}/></div>
    </section>
    <section className="mp-panel flex flex-wrap items-end gap-3 p-4"><label className="grid min-w-[260px] flex-1 gap-1 text-[10px] font-black uppercase tracking-wider text-[var(--ink-4)]">Find SKU, code, item or brand<Input value={search} onChange={e=>{setSearch(e.target.value);setPage(0)}} placeholder="Search the pricing queue…"/></label><label className="grid gap-1 text-[10px] font-black uppercase tracking-wider text-[var(--ink-4)]">View<select value={status} onChange={e=>{setStatus(e.target.value);setPage(0)}} className="h-10 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm"><option value="missing">Missing MRP</option><option value="all">All pricing</option></select></label><label className="grid gap-1 text-[10px] font-black uppercase tracking-wider text-[var(--ink-4)]">Sort<select value={sort} onChange={e=>{setSort(e.target.value);setPage(0)}} className="h-10 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm"><option value="sku">SKU</option><option value="brand">Brand</option><option value="recent">Recently changed</option></select></label><Link href="/dashboard/master-data/products" className="inline-flex h-10 items-center rounded-md border border-[var(--line)] px-4 text-xs font-black"><ArrowLeft className="mr-2 h-4 w-4"/>Product Master</Link></section>
    <section className="mp-card overflow-hidden rounded-r5"><header className="flex items-center justify-between border-b border-[var(--line)] p-4"><div><h2 className="text-xl font-black text-[var(--ink)]">{status==='missing'?'Next MRP records':'Pricing register'}</h2><p className="mt-1 text-xs font-semibold text-[var(--ink-4)]">{result.filtered??0} matching SKU(s) · server-paged for scale</p></div><ShieldCheck className="h-6 w-6 text-emerald-700"/></header>{error?<p role="alert" className="m-4 rounded-md bg-red-50 p-4 text-sm font-bold text-red-800">{error.message}</p>:null}{loading&&!rows.length?<p className="p-10 text-center text-sm font-bold text-[var(--ink-4)]">Loading the readiness queue…</p>:rows.map((row:any)=><PricingRow key={`${row.id}-${row.updatedAt}`} row={row} onSaved={async()=>{await refetch()}}/>)}{!loading&&!rows.length&&!error?<div className="grid place-items-center p-12 text-center"><CheckCircle2 className="h-10 w-10 text-emerald-600"/><h3 className="mt-3 text-xl font-black">All matching SKUs have MRP</h3><p className="mt-1 text-sm text-[var(--ink-4)]">Quotes and labels can now use Product Master pricing without manual MRP entry.</p></div>:null}<footer className="flex items-center justify-between border-t border-[var(--line)] p-4"><Button variant="outline" disabled={!result.hasPreviousPage} onClick={()=>setPage(p=>Math.max(0,p-1))}><ArrowLeft className="mr-2 h-4 w-4"/>Previous</Button><span className="text-xs font-black text-[var(--ink-4)]">Page {page+1}</span><Button variant="outline" disabled={!result.hasNextPage} onClick={()=>setPage(p=>p+1)}>Next<ArrowRight className="ml-2 h-4 w-4"/></Button></footer></section>
  </div>;
}

function Metric({value,label}:{value:any;label:string}){return <div className="min-w-24 rounded-r3 border border-white/15 bg-white/10 p-3"><p className="text-2xl font-black tabular-nums">{value}</p><p className="mt-1 text-[9px] font-black uppercase tracking-wider text-white/65">{label}</p></div>}
