'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { gql, useLazyQuery, useMutation, useQuery } from '@apollo/client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCircle2, Database, Download,
  FileCheck2, FileSpreadsheet, History, Loader2, PackageSearch, RefreshCw, Save,
  Search, ShieldCheck, Upload, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { cn } from '@/lib/utils';

const BOOT = gql`
  query ProductMrpControlBoot {
    me { id name role }
    productMrpBulkFilterOptions
  }
`;
const READINESS = gql`
  query ProductPricingReadiness($search:String,$status:String,$sort:String,$brand:String,$category:String,$includeCost:Boolean,$skip:Int,$take:Int){
    productPricingReadinessPage(search:$search,status:$status,sort:$sort,brand:$brand,category:$category,includeCost:$includeCost,skip:$skip,take:$take)
  }
`;
const WORKBOOK = gql`
  query ProductMrpBulkWorkbook($search:String,$mrpStatus:String,$brand:String,$category:String,$selectedIds:[String!],$excludedIds:[String!],$selectAllMatching:Boolean){
    productMrpBulkWorkbook(search:$search,mrpStatus:$mrpStatus,brand:$brand,category:$category,selectedIds:$selectedIds,excludedIds:$excludedIds,selectAllMatching:$selectAllMatching)
  }
`;
const PREVIEW = gql`
  mutation PreviewProductMrpBulkWorkbook($filename:String!,$contentBase64:String!){
    previewProductMrpBulkWorkbook(filename:$filename,contentBase64:$contentBase64)
  }
`;
const APPLY = gql`
  mutation ApplyProductMrpBulkWorkbook($filename:String!,$contentBase64:String!,$confirmationToken:String!,$reason:String!,$effectiveFrom:String!){
    applyProductMrpBulkWorkbook(filename:$filename,contentBase64:$contentBase64,confirmationToken:$confirmationToken,reason:$reason,effectiveFrom:$effectiveFrom)
  }
`;
const COMPLETE = gql`
  mutation CompleteProductPricing($input:ProductPricingCompletionInput!){
    completeProductPricing(input:$input){id sku defaultMrpInclusive defaultNrpInclusive floorPriceInclusive priceRateBasis priceUom updatedAt}
  }
`;

type Tab = 'bulk' | 'missing';
type FilterOption = { value: string; label: string; count?: number };
const MAX_WORKBOOK_BYTES = 5 * 1024 * 1024;

function money(value: unknown, digits = 2) {
  if (value == null || value === '') return 'Missing';
  return `₹${Number(value).toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function imageOf(media: any) {
  const source = typeof media === 'string' ? (() => { try { return JSON.parse(media); } catch { return {}; } })() : media || {};
  const gallery = Array.isArray(source.gallery) ? source.gallery : Array.isArray(source.images) ? source.images : [];
  return source.primaryUrl || source.primaryImage || source.primary || (typeof gallery[0] === 'string' ? gallery[0] : gallery[0]?.url) || '';
}

function toBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(new Error('The workbook could not be read'));
    reader.readAsDataURL(file);
  });
}

function downloadWorkbook(payload: any) {
  const bytes = atob(payload.contentBase64);
  const data = new Uint8Array(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) data[index] = bytes.charCodeAt(index);
  const url = URL.createObjectURL(new Blob([data], { type: payload.mimeType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = payload.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ProductIdentity({ row, selectable, checked, onToggle }: { row:any; selectable?:boolean; checked?:boolean; onToggle?:()=>void }) {
  const image = imageOf(row.media);
  const body = <>
    {selectable ? <span className={cn('mt-1 grid h-5 w-5 shrink-0 place-items-center rounded border', checked ? 'border-[#962f29] bg-[#962f29] text-white' : 'border-[#cfbdb7] bg-white')} aria-hidden>{checked ? <Check className="h-3.5 w-3.5"/> : null}</span> : null}
    <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--bg-soft)]">
      {image ? <img src={image} alt="" className="h-full w-full object-contain p-1"/> : <PackageSearch className="m-3 h-6 w-6 text-[var(--ink-4)]"/>}
    </div>
    <div className="min-w-0">
      <p className="truncate text-sm font-black text-[var(--ink)]">{row.internalCode || row.sku} <span className="font-semibold text-[var(--ink-3)]">· {row.name}</span></p>
      <p className="mt-1 truncate text-[11px] font-semibold text-[var(--ink-4)]">{row.sku} · {row.brandCode || row.brand || 'No brand'} · {row.category || 'Uncategorised'}{row.finish ? ` · ${row.finish}` : ''}</p>
    </div>
  </>;
  if (!selectable) return <div className="flex min-w-0 items-center gap-3">{body}</div>;
  return <button type="button" onClick={onToggle} aria-pressed={checked} className="flex min-w-0 items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-[#962f29]/30">{body}</button>;
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
      setMessage('MRP verified. Queue refreshed.');
      await onSaved();
    } catch (error:any) { setMessage(error?.message || 'Pricing could not be saved.'); }
  }
  const cost = row.cost || {};
  return <article className="grid gap-4 border-b border-[var(--line)] p-4 last:border-b-0 xl:grid-cols-[minmax(280px,1.25fr)_minmax(430px,1.8fr)_minmax(220px,.8fr)] xl:items-center">
    <ProductIdentity row={row}/>
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      <label className="grid gap-1 text-[10px] font-black uppercase tracking-wider text-[var(--ink-4)]">MRP incl. GST *<Input type="number" min="0.01" step="0.01" value={form.mrp} onChange={e=>setForm({...form,mrp:e.target.value})} placeholder={isTile?'₹ / sq ft':'Required'}/></label>
      <label className="grid gap-1 text-[10px] font-black uppercase tracking-wider text-[var(--ink-4)]">NRP incl. GST<Input type="number" min="0.01" step="0.01" value={form.nrp} onChange={e=>setForm({...form,nrp:e.target.value})} placeholder="Optional"/></label>
      <label className="grid gap-1 text-[10px] font-black uppercase tracking-wider text-[var(--ink-4)]">Floor incl. GST<Input type="number" min="0.01" step="0.01" value={form.floor} onChange={e=>setForm({...form,floor:e.target.value})} placeholder="Optional"/></label>
      <label className="grid gap-1 text-[10px] font-black uppercase tracking-wider text-[var(--ink-4)]">Basis<select disabled={isTile} value={isTile?'AREA':form.basis} onChange={e=>setForm({...form,basis:e.target.value})} className="h-10 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 text-xs"><option value="PIECE">Piece</option><option value="BOX">Box</option><option value="AREA">Area</option></select></label>
      <label className="grid gap-1 text-[10px] font-black uppercase tracking-wider text-[var(--ink-4)]">Rate UOM<Input disabled={isTile} value={isTile?'SQFT':form.uom} onChange={e=>setForm({...form,uom:e.target.value.toUpperCase()})}/></label>
      <label className="grid gap-1 text-[10px] font-black uppercase tracking-wider text-[var(--ink-4)]">MRP source<select value={form.source} onChange={e=>setForm({...form,source:e.target.value})} className="h-10 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 text-xs"><option value="MANUAL">Manual verification</option><option value="PACKAGE">Printed package</option><option value="BRAND_LIST">Brand price list</option></select></label>
      {mrpChanged?<label className="grid gap-1 text-[10px] font-black uppercase tracking-wider text-[#9f342d] sm:col-span-2 lg:col-span-3">MRP change reason *<Input value={reason} onChange={e=>setReason(e.target.value)} placeholder="Example: Revised brand price list"/></label>:null}
      <div className="sm:col-span-2 lg:col-span-3"><Button onClick={submit} disabled={loading||invalid}>{loading?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<Save className="mr-2 h-4 w-4"/>}Verify and continue</Button>{message?<span className={cn('ml-3 text-xs font-bold',message.startsWith('MRP verified')?'text-emerald-700':'text-red-700')}>{message}</span>:null}</div>
    </div>
    <aside className="rounded-xl border border-[var(--line)] bg-[var(--bg-soft)] p-3">
      <p className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[.14em] text-[var(--ink-4)]"><Database className="h-3.5 w-3.5"/>Actual lot cost · owner/admin</p>
      <p className="mt-2 text-lg font-black text-[var(--ink)]">{cost.weightedUnitCost==null?'No costed stock':money(cost.weightedUnitCost)}</p>
      <p className="mt-1 text-[10px] font-semibold leading-4 text-[var(--ink-4)]">Read-only weighted cost from {cost.completeCostLots||0} received lot(s).</p>
    </aside>
  </article>;
}

function ProductMrpControlPage(){
  const params = useSearchParams();
  const initialTab: Tab = params.get('tab') === 'missing' ? 'missing' : 'bulk';
  const [tab,setTab]=useState<Tab>(initialTab);
  const [search,setSearch]=useState(params.get('search') || '');
  const [brand,setBrand]=useState('');
  const [category,setCategory]=useState('');
  const [mrpStatus,setMrpStatus]=useState('all');
  const [sort,setSort]=useState('sku');
  const [page,setPage]=useState(0);
  const [selected,setSelected]=useState<Set<string>>(new Set());
  const [excluded,setExcluded]=useState<Set<string>>(new Set());
  const [selectAllMatching,setSelectAllMatching]=useState(false);
  const [file,setFile]=useState<File|null>(null);
  const [fileBase64,setFileBase64]=useState('');
  const [fileReading,setFileReading]=useState(false);
  const [preview,setPreview]=useState<any>(null);
  const [applied,setApplied]=useState<any>(null);
  const [reason,setReason]=useState('');
  const [effectiveFrom,setEffectiveFrom]=useState(new Date().toISOString().slice(0,10));
  const [confirmed,setConfirmed]=useState(false);
  const [notice,setNotice]=useState('');
  const inputRef=useRef<HTMLInputElement>(null);
  const previewRef=useRef<HTMLDivElement>(null);
  const debounced=useDebouncedValue(search.trim(),300);
  const pageSize=40;
  const {data:boot,loading:bootLoading,error:bootError}=useQuery(BOOT,{fetchPolicy:'network-only',errorPolicy:'all'});
  const privileged=['owner','admin'].includes(String(boot?.me?.role||'').toLowerCase());
  const {data,loading,error,refetch}=useQuery(READINESS,{variables:{search:debounced||undefined,status:tab==='missing'?'missing':mrpStatus,sort,brand:brand||undefined,category:category||undefined,includeCost:tab==='missing',skip:page*pageSize,take:pageSize},skip:!privileged,fetchPolicy:'network-only'});
  const [getWorkbook,{loading:downloading}]=useLazyQuery(WORKBOOK,{fetchPolicy:'no-cache'});
  const [previewWorkbook,{loading:previewing}]=useMutation(PREVIEW);
  const [applyWorkbook,{loading:applying}]=useMutation(APPLY);
  const result=data?.productPricingReadinessPage||{};
  const rows:any[]=result.rows||[];
  const filters=boot?.productMrpBulkFilterOptions||{};
  const brandOptions:FilterOption[]=[{value:'',label:'All brands'},...(filters.brands||[]).map((option:FilterOption)=>({...option,description:`${option.count||0} SKU(s)`}))];
  const categoryOptions:FilterOption[]=[{value:'',label:'All categories'},...(filters.categories||[]).map((option:FilterOption)=>({...option,description:`${option.count||0} SKU(s)`}))];
  const selectedCount=selectAllMatching?Math.max(0,Number(result.filtered||0)-excluded.size):selected.size;
  const pageSelected=rows.length>0&&rows.every(row=>selectAllMatching?!excluded.has(row.id):selected.has(row.id));
  const progress=result.totalActive?Math.round(Number(result.ready||0)/Number(result.totalActive)*100):100;

  useEffect(()=>{setPage(0);setSelected(new Set());setExcluded(new Set());setSelectAllMatching(false);setPreview(null);setApplied(null);},[tab,debounced,brand,category,mrpStatus]);
  useEffect(()=>{
    if(!preview)return;
    window.requestAnimationFrame(()=>previewRef.current?.scrollIntoView({behavior:'smooth',block:'start'}));
  },[preview]);

  function isSelected(id:string){return selectAllMatching?!excluded.has(id):selected.has(id)}
  function toggle(id:string){
    if(selectAllMatching)setExcluded(current=>{const next=new Set(current);next.has(id)?next.delete(id):next.add(id);return next});
    else setSelected(current=>{const next=new Set(current);next.has(id)?next.delete(id):next.add(id);return next});
  }
  function togglePage(){
    if(selectAllMatching){setExcluded(current=>{const next=new Set(current);rows.forEach(row=>pageSelected?next.add(row.id):next.delete(row.id));return next})}
    else setSelected(current=>{const next=new Set(current);rows.forEach(row=>pageSelected?next.delete(row.id):next.add(row.id));return next})
  }
  function clearSelection(){setSelected(new Set());setExcluded(new Set());setSelectAllMatching(false)}
  async function exportSelected(){
    setNotice('');
    try{
      const response=await getWorkbook({variables:{search:debounced||undefined,mrpStatus,brand:brand||undefined,category:category||undefined,selectedIds:Array.from(selected),excludedIds:Array.from(excluded),selectAllMatching}});
      downloadWorkbook(response.data.productMrpBulkWorkbook);
      setNotice(`Downloaded a governed workbook for ${response.data.productMrpBulkWorkbook.selectedCount.toLocaleString('en-IN')} SKU(s).`);
    }catch(error:any){setNotice(error?.message||'The workbook could not be downloaded.')}
  }
  async function chooseFile(chosen:File|null){
    setPreview(null);setApplied(null);setConfirmed(false);setNotice('');setFile(null);setFileBase64('');setFileReading(false);
    if(!chosen&&inputRef.current)inputRef.current.value='';
    if(!chosen)return;
    if(!/\.xlsx$/i.test(chosen.name)){
      setNotice('Choose the .xlsx workbook downloaded from this MRP page.');
      if(inputRef.current)inputRef.current.value='';
      return;
    }
    if(!chosen.size||chosen.size>MAX_WORKBOOK_BYTES){
      setNotice('The MRP workbook must be smaller than 5 MB.');
      if(inputRef.current)inputRef.current.value='';
      return;
    }
    setFile(chosen);setFileReading(true);
    try{
      const encoded=await toBase64(chosen);
      if(!encoded)throw new Error('The workbook is empty or could not be read.');
      setFileBase64(encoded);
      setNotice('Workbook ready. Select “Validate and preview” to check it without changing any MRP.');
    }catch(error:any){
      setFile(null);setFileBase64('');setNotice(error?.message||'The workbook could not be read.');
      if(inputRef.current)inputRef.current.value='';
    }finally{setFileReading(false)}
  }
  async function runPreview(){
    if(!file){setNotice('Upload the completed MRP workbook first.');return;}
    setNotice('');setApplied(null);setConfirmed(false);
    try{
      const encoded=fileBase64||await toBase64(file);
      if(!encoded)throw new Error('The workbook is empty or could not be read.');
      if(!fileBase64)setFileBase64(encoded);
      const response=await previewWorkbook({variables:{filename:file.name,contentBase64:encoded}});
      const nextPreview=response.data.previewProductMrpBulkWorkbook;
      setPreview(nextPreview);
      setNotice(nextPreview.changed?`Preview ready: ${nextPreview.changed.toLocaleString('en-IN')} MRP change(s). Nothing has been updated yet.`:nextPreview.message);
    }
    catch(error:any){setPreview(null);setNotice(error?.message||'The workbook did not pass validation.')}
  }
  async function applyChanges(){
    if(!file||!preview?.confirmationToken)return;
    setNotice('');
    try{
      const response=await applyWorkbook({variables:{filename:file.name,contentBase64:fileBase64,confirmationToken:preview.confirmationToken,reason:reason.trim(),effectiveFrom:new Date(`${effectiveFrom}T00:00:00+05:30`).toISOString()}});
      setApplied(response.data.applyProductMrpBulkWorkbook);setPreview(null);setConfirmed(false);setFile(null);setFileBase64('');setReason('');if(inputRef.current)inputRef.current.value='';clearSelection();await refetch();
    }catch(error:any){setNotice(error?.message||'No MRP values were updated.')}
  }

  if(bootLoading&&!boot?.me)return <LoadingBlock label="Opening the governed MRP desk…"/>;
  if(bootError&&!boot?.me)return <ErrorBlock message={bootError.message}/>;
  if(boot?.me&&!privileged)return <AccessState/>;

  return <div className="space-y-5 pb-12">
    <section className="overflow-hidden rounded-[26px] border border-[#7f1d1d]/20 bg-[linear-gradient(118deg,#201615_0%,#57231f_58%,#9f352d_100%)] p-6 text-white shadow-[0_22px_60px_-32px_rgba(69,24,20,.8)]">
      <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
        <div><p className="text-[10px] font-black uppercase tracking-[.22em] text-[#f4c6bd]">Owner pricing control</p><h1 className="mt-3 max-w-3xl font-display text-4xl font-bold tracking-[-.04em] text-[#fff8f4]">MRP changes, ready for the next brand price list.</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-white/75">Select Product Master SKUs, work in one protected Excel packet, preview every change, then post only MRP with permanent history and audit.</p></div>
        <div className="grid grid-cols-3 gap-2"><Metric value={result.totalMissing??'—'} label="MRP missing"/><Metric value={`${progress}%`} label="Ready"/><Metric value={result.totalActive??'—'} label="Active SKUs"/></div>
      </div>
    </section>

    <nav aria-label="MRP control sections" className="mp-panel grid grid-cols-2 gap-2 p-2 sm:w-fit">
      <TabButton active={tab==='bulk'} onClick={()=>setTab('bulk')} icon={<FileSpreadsheet className="h-4 w-4"/>}>Bulk MRP updates</TabButton>
      <TabButton active={tab==='missing'} onClick={()=>setTab('missing')} icon={<AlertTriangle className="h-4 w-4"/>}>Missing MRP <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-900">{result.totalMissing??'—'}</span></TabButton>
    </nav>

    {tab==='bulk'?<>
      <section className="grid gap-2 md:grid-cols-4">
        <Step number="1" title="Select" text="Filter any active Product Master SKUs." active={!file}/>
        <Step number="2" title="Excel" text="Download and fill only New MRP." active={!!file&&!preview}/>
        <Step number="3" title="Preview" text="Validate changes without posting." active={!!preview}/>
        <Step number="4" title="Confirm" text="Post one atomic, audited batch." active={!!applied}/>
      </section>
      <section className="mp-panel grid gap-3 p-4 lg:grid-cols-[minmax(280px,1.6fr)_minmax(190px,.75fr)_minmax(190px,.75fr)_160px]">
        <label className="grid gap-1 text-[10px] font-black uppercase tracking-wider text-[var(--ink-4)]">Search Product Master<div className="relative"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[var(--ink-4)]"/><Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="SKU, product code, name or brand…" className="pl-9"/></div></label>
        <Field label="Brand"><SearchableSelect value={brand} onValueChange={setBrand} options={brandOptions} placeholder="All brands" searchPlaceholder="Search brands…"/></Field>
        <Field label="Category"><SearchableSelect value={category} onValueChange={setCategory} options={categoryOptions} placeholder="All categories" searchPlaceholder="Search categories…"/></Field>
        <Field label="MRP status"><select value={mrpStatus} onChange={e=>setMrpStatus(e.target.value)} className="h-10 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 text-sm"><option value="all">All active</option><option value="ready">MRP ready</option><option value="missing">MRP missing</option></select></Field>
      </section>
      {preview?<div ref={previewRef} className="scroll-mt-5"><PreviewPanel preview={preview} reason={reason} setReason={setReason} effectiveFrom={effectiveFrom} setEffectiveFrom={setEffectiveFrom} confirmed={confirmed} setConfirmed={setConfirmed} applying={applying} onApply={applyChanges}/></div>:null}
      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1.7fr)_minmax(350px,.7fr)]">
        <section className="mp-card overflow-hidden rounded-2xl">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] p-4">
            <div><h2 className="text-xl font-black text-[var(--ink)]">Product Master selection</h2><p className="mt-1 text-xs font-semibold text-[var(--ink-4)]">{result.filtered??0} matching SKU(s) · 40 per page · selected across pages</p></div>
            <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={togglePage} disabled={!rows.length}>{pageSelected?'Clear page':'Select page'}</Button><Button variant="outline" onClick={()=>{setSelectAllMatching(true);setSelected(new Set());setExcluded(new Set())}} disabled={!result.filtered}>Select all {Number(result.filtered||0).toLocaleString('en-IN')}</Button></div>
          </header>
          {error?<ErrorBlock message={error.message} compact/>:null}
          {loading&&!rows.length?<LoadingBlock label="Loading Product Master…" compact/>:null}
          {!loading&&!error&&!rows.length?<EmptyBlock title="No matching products" text="Clear a filter or search a different SKU, product code, name or brand."/>:null}
          {rows.map(row=><div key={row.id} className={cn('grid gap-3 border-b border-[var(--line)] p-4 last:border-0 md:grid-cols-[minmax(0,1fr)_210px] md:items-center',isSelected(row.id)&&'bg-[#fff8f4]')}><ProductIdentity row={row} selectable checked={isSelected(row.id)} onToggle={()=>toggle(row.id)}/><div className="text-left md:text-right"><p className={cn('text-base font-black tabular-nums',row.defaultMrpInclusive?'text-[var(--ink)]':'text-amber-800')}>{money(row.defaultMrpInclusive)}{row.defaultMrpInclusive?<span className="ml-1 text-[10px] font-black text-[var(--ink-4)]">/{String(row.priceUom||row.salesUom||row.unit||'PC').toUpperCase()}</span>:null}</p><p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ink-4)]">Current Product Master MRP</p></div></div>)}
          <Pager page={page} previous={!!result.hasPreviousPage} next={!!result.hasNextPage} onPage={setPage}/>
        </section>
        <aside className="space-y-4 2xl:sticky 2xl:top-5 2xl:self-start">
          <section className="overflow-hidden rounded-2xl border border-[#cdaaa0] bg-[#fffaf7] shadow-[0_18px_42px_-32px_rgba(75,35,28,.65)]">
            <div className="border-b border-[#ead8d2] bg-[#fbede8] p-4"><p className="text-[10px] font-black uppercase tracking-[.18em] text-[#8f332d]">Selection packet</p><div className="mt-2 flex items-end justify-between"><p className="text-4xl font-black tabular-nums text-[#34211d]">{selectedCount.toLocaleString('en-IN')}</p>{selectedCount?<button type="button" onClick={clearSelection} className="text-xs font-black text-[#8f332d]">Clear</button>:null}</div><p className="mt-1 text-xs font-semibold text-[#79635d]">SKU(s) ready for Excel export</p></div>
            <div className="space-y-3 p-4">
              {selectAllMatching?<p className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs font-semibold text-blue-900">All matching filtered products selected{excluded.size?`, except ${excluded.size}`:''}. Changing a filter clears this selection.</p>:null}
              <Button className="w-full" onClick={exportSelected} disabled={!selectedCount||downloading}>{downloading?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<Download className="mr-2 h-4 w-4"/>}Download selected Excel</Button>
              <div className="relative py-1 text-center text-[10px] font-black uppercase tracking-widest text-[var(--ink-4)]"><span className="relative z-10 bg-[#fffaf7] px-2">then</span><span className="absolute left-0 right-0 top-1/2 border-t border-[#ead8d2]"/></div>
              <input ref={inputRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={e=>chooseFile(e.target.files?.[0]||null)}/>
              <button type="button" onClick={()=>inputRef.current?.click()} className="grid w-full place-items-center rounded-xl border border-dashed border-[#cdaaa0] bg-white px-4 py-6 text-center transition hover:border-[#962f29] hover:bg-[#fff7f2]"><Upload className="h-5 w-5 text-[#962f29]"/><b className="mt-2 text-sm text-[var(--ink)]">Upload completed workbook</b><span className="mt-1 text-[11px] text-[var(--ink-4)]">.xlsx only · maximum 5 MB</span></button>
              {file?<div className="flex items-center gap-2 rounded-lg border border-[#e6d7d1] bg-white p-3"><FileSpreadsheet className="h-5 w-5 shrink-0 text-emerald-700"/><div className="min-w-0 flex-1"><p className="truncate text-xs font-black">{file.name}</p><p className="text-[10px] text-[var(--ink-4)]">{Math.ceil(file.size/1024).toLocaleString('en-IN')} KB</p></div><button type="button" onClick={()=>chooseFile(null)} aria-label="Remove workbook"><X className="h-4 w-4"/></button></div>:null}
              <Button variant="outline" className="w-full" onClick={runPreview} disabled={!file||fileReading||previewing}>{fileReading||previewing?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<FileCheck2 className="mr-2 h-4 w-4"/>}{fileReading?'Reading workbook…':previewing?'Validating workbook…':'Validate and preview'}</Button>
              {notice?<p role="status" aria-live="polite" className={cn('rounded-lg border p-3 text-xs font-bold leading-5',preview?.changed?'border-emerald-200 bg-emerald-50 text-emerald-900':'border-amber-200 bg-amber-50 text-amber-900')}>{notice}</p>:null}
            </div>
          </section>
          <Link href="/dashboard/audit" className="flex items-center justify-between rounded-xl border border-[var(--line)] bg-white p-4 text-sm font-black text-[var(--ink)] hover:border-[#cdaaa0]"><span className="flex items-center gap-2"><History className="h-4 w-4 text-[#962f29]"/>Open MRP audit history</span><ArrowRight className="h-4 w-4"/></Link>
        </aside>
      </div>
      {applied?<section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><div className="flex gap-3"><CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-700"/><div><h2 className="font-black text-emerald-950">MRP batch posted</h2><p className="mt-1 text-sm font-semibold text-emerald-900">{applied.message}</p><p className="mt-2 text-xs text-emerald-800">Batch {applied.batchId} · every SKU has its own MRP history and audit record.</p></div></div></section>:null}
    </>:<MissingQueue search={search} setSearch={setSearch} sort={sort} setSort={setSort} rows={rows} result={result} loading={loading} error={error} page={page} setPage={setPage} refetch={refetch}/>}
  </div>;
}

export default function PricingReadinessPage(){
  return <Suspense fallback={<LoadingBlock label="Opening the governed MRP desk…"/>}><ProductMrpControlPage/></Suspense>;
}

function PreviewPanel({preview,reason,setReason,effectiveFrom,setEffectiveFrom,confirmed,setConfirmed,applying,onApply}:{preview:any;reason:string;setReason:(v:string)=>void;effectiveFrom:string;setEffectiveFrom:(v:string)=>void;confirmed:boolean;setConfirmed:(v:boolean)=>void;applying:boolean;onApply:()=>void}){
  return <section className="mp-card overflow-hidden rounded-2xl border-emerald-200">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] bg-emerald-50 p-5"><div><p className="text-[10px] font-black uppercase tracking-[.18em] text-emerald-800">Validated preview · no data changed</p><h2 className="mt-1 text-2xl font-black text-emerald-950">{preview.changed} MRP change{preview.changed===1?'':'s'} ready</h2><p className="mt-1 text-xs font-semibold text-emerald-800">{preview.unchanged} unchanged row(s) skipped · all changes apply together or none apply</p></div><ShieldCheck className="h-8 w-8 text-emerald-700"/></header>
    {preview.changed?<><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left"><thead><tr className="border-b border-[var(--line)] bg-[var(--bg-soft)] text-[10px] font-black uppercase tracking-wider text-[var(--ink-4)]"><th className="p-3">Product</th><th className="p-3">Brand</th><th className="p-3 text-right">Previous MRP</th><th className="p-3 text-right">New MRP</th><th className="p-3 text-right">Difference</th></tr></thead><tbody>{preview.rows.map((row:any)=><tr key={row.productId} className="border-b border-[var(--line)] last:border-0"><td className="p-3"><b className="block text-sm">{row.internalCode||row.sku}</b><span className="text-xs text-[var(--ink-4)]">{row.name}</span></td><td className="p-3 text-xs font-bold">{row.brandCode||row.brand||'—'}</td><td className="p-3 text-right text-sm font-bold tabular-nums">{money(row.previousMrp)}</td><td className="p-3 text-right text-sm font-black tabular-nums text-emerald-800">{money(row.newMrp)}</td><td className="p-3 text-right text-xs font-bold tabular-nums">{row.previousMrp==null?'Initial':`${Number(row.newMrp)-Number(row.previousMrp)>=0?'+':''}${money(Number(row.newMrp)-Number(row.previousMrp))}`}</td></tr>)}</tbody></table></div>{preview.previewTruncated?<p className="border-t border-[var(--line)] p-3 text-center text-xs font-bold text-[var(--ink-4)]">Showing the first 200 changes; all validated rows will be applied.</p>:null}
    <div className="grid gap-4 border-t border-[var(--line)] bg-[#fffaf7] p-5 lg:grid-cols-[1fr_230px_auto] lg:items-end"><label className="grid gap-1 text-[10px] font-black uppercase tracking-wider text-[var(--ink-4)]">Business reason *<Input value={reason} maxLength={240} onChange={e=>setReason(e.target.value)} placeholder="Example: Jaquar price list effective 14 September 2026"/></label><label className="grid gap-1 text-[10px] font-black uppercase tracking-wider text-[var(--ink-4)]">Effective date *<Input type="date" value={effectiveFrom} onChange={e=>setEffectiveFrom(e.target.value)}/></label><Button onClick={onApply} disabled={applying||!confirmed||reason.trim().length<5||!effectiveFrom}>{applying?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<ShieldCheck className="mr-2 h-4 w-4"/>}Apply {preview.changed} MRP changes</Button><label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#dfc7bf] bg-white p-3 lg:col-span-3"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#962f29]"/><span className="text-xs font-semibold leading-5 text-[var(--ink-3)]"><b className="text-[var(--ink)]">I reviewed this preview.</b> I understand this changes only Product Master MRP; NRP, floor, cost, UOM and all other product data remain unchanged.</span></label></div></>:<EmptyBlock title="No changed MRP values" text="Enter values in the yellow New MRP column, save the workbook, then upload it again."/>}
  </section>;
}

function MissingQueue({search,setSearch,sort,setSort,rows,result,loading,error,page,setPage,refetch}:{[key:string]:any}){
  return <><section className="mp-panel flex flex-wrap items-end gap-3 p-4"><label className="grid min-w-[280px] flex-1 gap-1 text-[10px] font-black uppercase tracking-wider text-[var(--ink-4)]">Find missing SKU, code, item or brand<Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search the missing MRP queue…"/></label><Field label="Sort"><select value={sort} onChange={e=>setSort(e.target.value)} className="h-10 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 text-sm"><option value="sku">SKU</option><option value="brand">Brand</option><option value="recent">Recently changed</option></select></Field><Link href="/dashboard/master-data/products" className="inline-flex h-10 items-center rounded-lg border border-[var(--line)] px-4 text-xs font-black"><ArrowLeft className="mr-2 h-4 w-4"/>Product Master</Link></section><section className="mp-card overflow-hidden rounded-2xl"><header className="flex items-center justify-between border-b border-[var(--line)] p-4"><div><h2 className="text-xl font-black text-[var(--ink)]">Missing MRP queue</h2><p className="mt-1 text-xs font-semibold text-[var(--ink-4)]">{result.filtered??0} matching SKU(s) · use this for individual completion</p></div><Button variant="outline" onClick={()=>refetch()}><RefreshCw className="mr-2 h-4 w-4"/>Refresh</Button></header>{error?<ErrorBlock message={error.message} compact/>:null}{loading&&!rows.length?<LoadingBlock label="Loading the missing MRP queue…" compact/>:rows.map((row:any)=><PricingRow key={`${row.id}-${row.updatedAt}`} row={row} onSaved={async()=>{await refetch()}}/>)}{!loading&&!rows.length&&!error?<EmptyBlock title="Every matching SKU has MRP" text="Use Bulk MRP updates when the next brand price list arrives." icon={<CheckCircle2 className="h-10 w-10 text-emerald-600"/>}/>:null}<Pager page={page} previous={!!result.hasPreviousPage} next={!!result.hasNextPage} onPage={setPage}/></section></>;
}

function Metric({value,label}:{value:any;label:string}){return <div className="min-w-24 rounded-xl border border-white/15 bg-white/10 p-3"><p className="text-2xl font-black tabular-nums">{value}</p><p className="mt-1 text-[9px] font-black uppercase tracking-wider text-white/65">{label}</p></div>}
function TabButton({active,onClick,icon,children}:{active:boolean;onClick:()=>void;icon:React.ReactNode;children:React.ReactNode}){return <button type="button" role="tab" aria-selected={active} onClick={onClick} className={cn('flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-xs font-black transition',active?'bg-[#221b19] text-white shadow-md':'text-[var(--ink-3)] hover:bg-[var(--bg-soft)]')}>{icon}{children}</button>}
function Step({number,title,text,active}:{number:string;title:string;text:string;active:boolean}){return <div className={cn('rounded-xl border p-3 transition',active?'border-[#c98d80] bg-[#fff4ef]':'border-[var(--line)] bg-white')}><div className="flex items-center gap-2"><span className={cn('grid h-6 w-6 place-items-center rounded-full text-[10px] font-black',active?'bg-[#962f29] text-white':'bg-[var(--bg-soft)] text-[var(--ink-4)]')}>{number}</span><b className="text-xs text-[var(--ink)]">{title}</b></div><p className="mt-2 text-[11px] leading-4 text-[var(--ink-4)]">{text}</p></div>}
function Field({label,children}:{label:string;children:React.ReactNode}){return <label className="grid gap-1 text-[10px] font-black uppercase tracking-wider text-[var(--ink-4)]">{label}{children}</label>}
function Pager({page,previous,next,onPage}:{page:number;previous:boolean;next:boolean;onPage:(page:number)=>void}){return <footer className="flex items-center justify-between border-t border-[var(--line)] p-4"><Button variant="outline" disabled={!previous} onClick={()=>onPage(Math.max(0,page-1))}><ArrowLeft className="mr-2 h-4 w-4"/>Previous</Button><span className="text-xs font-black text-[var(--ink-4)]">Page {page+1}</span><Button variant="outline" disabled={!next} onClick={()=>onPage(page+1)}>Next<ArrowRight className="ml-2 h-4 w-4"/></Button></footer>}
function LoadingBlock({label,compact=false}:{label:string;compact?:boolean}){return <div className={cn('grid place-items-center text-center text-sm font-bold text-[var(--ink-4)]',compact?'p-10':'min-h-[55vh]')}><Loader2 className="mb-3 h-6 w-6 animate-spin text-[#962f29]"/>{label}</div>}
function ErrorBlock({message,compact=false}:{message:string;compact?:boolean}){return <div role="alert" className={cn('rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800',compact?'m-4':'mx-auto mt-20 max-w-2xl')}><AlertTriangle className="mr-2 inline h-4 w-4"/>{message}</div>}
function EmptyBlock({title,text,icon}:{title:string;text:string;icon?:React.ReactNode}){return <div className="grid place-items-center p-12 text-center">{icon||<PackageSearch className="h-9 w-9 text-[var(--ink-4)]"/>}<h3 className="mt-3 text-xl font-black text-[var(--ink)]">{title}</h3><p className="mt-1 max-w-lg text-sm text-[var(--ink-4)]">{text}</p></div>}
function AccessState(){return <div className="mx-auto mt-20 max-w-xl rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center"><ShieldCheck className="mx-auto h-9 w-9 text-amber-800"/><h1 className="mt-4 text-2xl font-black text-amber-950">Owner or admin access required</h1><p className="mt-2 text-sm leading-6 text-amber-900">Bulk MRP changes alter customer-facing prices and are therefore limited to authorised owner and admin accounts.</p><Link href="/dashboard/master-data" className="mt-5 inline-flex text-sm font-black text-amber-950">Return to Master Data</Link></div>}
