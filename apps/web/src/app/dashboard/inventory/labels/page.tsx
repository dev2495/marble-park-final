'use client';

import { useMemo, useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import { Barcode, Box, ChevronLeft, ChevronRight, PackageSearch, Printer, QrCode, ScanLine, Store, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QueryErrorBanner } from '@/components/query-state';
import { useDebouncedValue } from '@/hooks/use-debounced-value';

const SOURCES = gql`query LabelSources($search: String) {
  products(search: $search, take: 50) { id sku internalCode name category brand }
  inventoryLots(status: "active", search: $search, take: 50)
  displaySamples(status: "active", take: 120)
  internalLabelTemplates
}`;
const JOBS = gql`query LabelRegister($search: String, $skip: Int, $take: Int) { internalLabelJobs(search: $search, skip: $skip, take: $take) }`;
const CREATE = gql`mutation CreateLabelJob($input: InternalLabelJobInput!) { createInternalLabelJob(input: $input) }`;
const PREPARE = gql`mutation PreparePrint($input: InternalLabelPrintRunInput!) { prepareInternalLabelPrintRun(input: $input) }`;
const SCAN = gql`mutation ScanLabel($labelCode: String!, $input: InternalLabelScanInput) { scanInternalLabel(labelCode: $labelCode, input: $input) }`;
const VOID = gql`mutation VoidLabel($id: ID!, $reason: String!) { voidInternalLabel(id: $id, reason: $reason) }`;

type SubjectMode = 'product' | 'lot' | 'display';

export default function LabelDeskPage() {
  const [mode, setMode] = useState<SubjectMode>('product');
  const [sourceSearch, setSourceSearch] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [purpose, setPurpose] = useState('shelf');
  const [quantity, setQuantity] = useState('1');
  const [registerSearch, setRegisterSearch] = useState('');
  const [page, setPage] = useState(0);
  const [expandedJobId, setExpandedJobId] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [physicalTemplate, setPhysicalTemplate] = useState('a4_70x37');
  const [copies, setCopies] = useState('1');
  const [printReason, setPrintReason] = useState('Operational label print');
  const [voidReason, setVoidReason] = useState('Damaged or superseded physical label');
  const [scanCode, setScanCode] = useState('');
  const [scanResult, setScanResult] = useState<any>(null);
  const debouncedSource = useDebouncedValue(sourceSearch.trim(), 250);
  const debouncedRegister = useDebouncedValue(registerSearch.trim(), 250);
  const pageSize = 25;
  const { data: sourceData, error: sourceError } = useQuery(SOURCES, { variables: { search: debouncedSource || undefined }, fetchPolicy: 'cache-and-network' });
  const { data, error, refetch } = useQuery(JOBS, { variables: { search: debouncedRegister || undefined, skip: page * pageSize, take: pageSize + 1 }, fetchPolicy: 'cache-and-network' });
  const [create, createState] = useMutation(CREATE, { onCompleted: () => { setSourceId(''); setQuantity('1'); refetch(); } });
  const [prepare, prepareState] = useMutation(PREPARE);
  const [scan, scanState] = useMutation(SCAN, { onCompleted: (response) => setScanResult(response.scanInternalLabel) });
  const [voidLabel, voidState] = useMutation(VOID, { onCompleted: () => refetch() });
  const allJobs = data?.internalLabelJobs || [];
  const jobs = allJobs.slice(0, pageSize);
  const hasNext = allJobs.length > pageSize;
  const products = sourceData?.products || [];
  const lots = sourceData?.inventoryLots || [];
  const displays = useMemo(() => (sourceData?.displaySamples || []).filter((row: any) => !debouncedSource || [row.internalCode,row.sampleNumber,row.product?.sku,row.product?.name].join(' ').toLowerCase().includes(debouncedSource.toLowerCase())), [sourceData?.displaySamples, debouncedSource]);
  const templates = sourceData?.internalLabelTemplates || [];
  const expanded = jobs.find((job: any) => job.id === expandedJobId);

  function changeMode(next: SubjectMode) {
    setMode(next); setSourceId('');
    setPurpose(next === 'lot' ? 'stock_pack' : next === 'display' ? 'display_sample' : 'shelf');
  }
  function toggleJob(job: any) {
    if (expandedJobId === job.id) { setExpandedJobId(''); setSelectedIds([]); return; }
    setExpandedJobId(job.id);
    setSelectedIds((job.instances || []).filter((row: any) => row.status === 'active').map((row: any) => row.id));
  }
  async function generate() {
    const subject = mode === 'product' ? { productId: sourceId } : mode === 'lot' ? { lotId: sourceId } : { displaySampleId: sourceId };
    await create({ variables: { input: { ...subject, quantity: Number(quantity), template: purpose, newJob: true } } });
  }
  async function preparePrint() {
    if (!expanded || !selectedIds.length) return;
    const response = await prepare({ variables: { input: { labelJobId: expanded.id, templateCode: physicalTemplate, labelIds: selectedIds, copies: Number(copies), reason: printReason } } });
    const run = response.data?.prepareInternalLabelPrintRun;
    if (run?.id) window.open(`/print/labels/${run.id}`, '_blank', 'noopener,noreferrer');
  }

  return <div className="space-y-5 pb-10">
    {[sourceError,error,createState.error,prepareState.error,scanState.error,voidState.error].filter(Boolean).map((item:any,index)=><QueryErrorBanner key={index} error={item}/>)}
    <header className="flex flex-col justify-between gap-4 border-b border-[var(--line)] pb-5 pt-2 lg:flex-row lg:items-end"><div><p className="text-xs font-semibold uppercase text-[var(--ink-4)]">Shared platform · every SKU</p><h1 className="mt-1 font-display text-3xl font-bold text-[var(--ink)]">Labels, print runs and scan</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-3)]">Create product, exact-lot, showroom, shelf or carton labels. Previewing never counts as printing; a print is recorded only after explicit confirmation on the isolated print surface.</p></div><div className="flex gap-6"><div><p className="text-2xl font-semibold tabular-nums text-[var(--ink)]">{jobs.length}</p><p className="text-xs text-[var(--ink-4)]">Jobs on this page</p></div><div><p className="text-2xl font-semibold tabular-nums text-emerald-700">{templates.length}</p><p className="text-xs text-[var(--ink-4)]">Versioned layouts</p></div></div></header>

    <section className="grid gap-5 xl:grid-cols-[24rem_1fr]">
      <div className="space-y-5">
        <div className="mp-panel p-4"><div className="flex items-center gap-2"><QrCode className="h-5 w-5 text-[var(--brand-700)]"/><h2 className="font-semibold text-[var(--ink)]">Create a new label job</h2></div><div className="mt-4 grid grid-cols-3 rounded-md border border-[var(--line)] p-1">{([['product','SKU',PackageSearch],['lot','Lot',Box],['display','Display',Store]] as any[]).map(([id,label,Icon])=><button key={id} onClick={()=>changeMode(id)} className={`h-10 rounded px-2 text-xs font-semibold ${mode===id?'bg-[var(--ink)] text-white':'text-[var(--ink-3)]'}`}><Icon className="mr-1 inline h-4 w-4"/>{label}</button>)}</div>
          <label className="mt-4 block text-xs font-semibold text-[var(--ink-4)]">Search source<Input className="mt-1" value={sourceSearch} onChange={(event)=>setSourceSearch(event.target.value)} placeholder="SKU, display code, design, lot or batch"/></label>
          <label className="mt-3 block text-xs font-semibold text-[var(--ink-4)]">Subject<select value={sourceId} onChange={(event)=>setSourceId(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-[var(--line)] bg-[var(--bg-soft)] px-3 text-sm"><option value="">Select {mode}</option>{mode==='product'?products.map((p:any)=><option key={p.id} value={p.id}>{p.internalCode||p.sku} · {p.name}</option>):mode==='lot'?lots.map((lot:any)=><option key={lot.id} value={lot.id}>{lot.product?.internalCode||lot.product?.sku} · {lot.lotNumber} {lot.supplierBatch?`· ${lot.supplierBatch}`:''}</option>):displays.map((d:any)=><option key={d.id} value={d.id}>{d.internalCode} · {d.product?.name}</option>)}</select></label>
          <label className="mt-3 block text-xs font-semibold text-[var(--ink-4)]">Purpose<select value={purpose} onChange={(event)=>setPurpose(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-[var(--line)] bg-[var(--bg-soft)] px-3"><option value="shelf">Shelf / product</option><option value="carton">Carton</option><option value="stock_pack">Exact stock lot / pack</option><option value="display_sample">Showroom display</option></select></label>
          <label className="mt-3 block text-xs font-semibold text-[var(--ink-4)]">New unique labels<Input className="mt-1" type="number" min={1} max={500} value={quantity} onChange={(event)=>setQuantity(event.target.value)}/></label><Button className="mt-4 w-full" disabled={createState.loading||!sourceId||Number(quantity)<1||Number(quantity)>500} onClick={generate}><Barcode className="mr-2 h-4 w-4"/>Create new job</Button>
        </div>
        <div className="mp-panel p-4"><div className="flex items-center gap-2"><ScanLine className="h-5 w-5 text-[var(--brand-700)]"/><h2 className="font-semibold text-[var(--ink)]">Scan real QR payload</h2></div><p className="mt-2 text-xs leading-5 text-[var(--ink-4)]">Accepts MP-LABEL payload, old JSON payload, lookup URL or a typed label code.</p><div className="mt-3 flex gap-2"><Input autoCapitalize="characters" value={scanCode} onChange={(event)=>setScanCode(event.target.value)} placeholder="Scan now…"/><Button aria-label="Scan label" disabled={scanState.loading||!scanCode.trim()} onClick={()=>scan({variables:{labelCode:scanCode,input:{action:'stock_lookup'}}})}><ScanLine className="h-4 w-4"/></Button></div>{scanResult?<div className={`mt-4 rounded-md border p-3 ${scanResult.result==='success'?'border-emerald-200 bg-emerald-50':'border-red-200 bg-red-50'}`}><p className="text-sm font-semibold">{scanResult.result.replace('_',' ')}</p>{scanResult.label?<p className="mt-2 text-xs">{scanResult.label.displaySample?.internalCode||scanResult.label.product?.internalCode||scanResult.label.product?.sku} · {scanResult.label.product?.name}<br/>{scanResult.label.lot?.lotNumber||scanResult.label.displaySample?.sampleNumber||'Product label'}</p>:null}</div>:null}</div>
      </div>

      <div className="mp-panel overflow-hidden"><div className="flex flex-col gap-3 border-b border-[var(--line)] p-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-semibold text-[var(--ink)]">Searchable label register</h2><p className="mt-1 text-xs text-[var(--ink-4)]">Search job, label, SKU, display code, product or lot.</p></div><Input className="sm:w-80" value={registerSearch} onChange={(event)=>{setRegisterSearch(event.target.value);setPage(0);}} placeholder="Search register"/></div><div className="divide-y divide-[var(--line)]">{jobs.map((job:any)=><div key={job.id}><button onClick={()=>toggleJob(job)} className="grid w-full gap-3 p-4 text-left md:grid-cols-[1fr_auto_auto] md:items-center hover:bg-[var(--bg-soft)]"><div><div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-[var(--ink)]">{job.jobNumber}</p><span className="rounded bg-[var(--bg-soft)] px-2 py-1 text-xs font-semibold">{job.template.replace('_',' ')}</span></div><p className="mt-1 text-xs text-[var(--ink-4)]">{job.quantity} labels · {job.sourceType.replace('_',' ')} · {new Date(job.requestedAt).toLocaleString('en-IN')}</p></div><p className="text-xs font-medium text-[var(--ink-3)]">{(job.instances||[]).filter((x:any)=>x.status==='active').length} active</p><span className="text-xs font-semibold text-[var(--brand-700)]">{expandedJobId===job.id?'Close':'Select / print'}</span></button>{expandedJobId===job.id?<div className="border-t border-[var(--line)] bg-[var(--bg-soft)] p-4"><div className="flex flex-wrap gap-2">{(job.instances||[]).map((label:any)=><label key={label.id} className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs ${label.status==='active'?'bg-[var(--surface)]':'bg-slate-100 text-slate-500'}`}><input type="checkbox" disabled={label.status!=='active'} checked={selectedIds.includes(label.id)} onChange={(event)=>setSelectedIds((current)=>event.target.checked?[...current,label.id]:current.filter((id)=>id!==label.id))}/><span><b>{label.labelCode}</b><br/>{label.displaySample?.internalCode||label.product?.internalCode||label.product?.sku} · printed {label.printCount||0}×</span>{label.status==='active'?<button type="button" className="ml-2 text-red-700 underline" disabled={!voidReason.trim()||voidState.loading} onClick={(event)=>{event.preventDefault();voidLabel({variables:{id:label.id,reason:voidReason}})}}>Void</button>:<span>{label.status}</span>}</label>)}</div><div className="mt-4 grid gap-3 lg:grid-cols-[1fr_7rem_1fr]"><label className="text-xs font-semibold text-[var(--ink-4)]">Physical layout<select className="mt-1 h-10 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3" value={physicalTemplate} onChange={(event)=>setPhysicalTemplate(event.target.value)}>{templates.map((t:any)=><option key={`${t.code}-${t.version}`} value={t.code}>{t.name} · v{t.version}</option>)}</select></label><label className="text-xs font-semibold text-[var(--ink-4)]">Copies<Input className="mt-1" type="number" min={1} max={50} value={copies} onChange={(event)=>setCopies(event.target.value)}/></label><label className="text-xs font-semibold text-[var(--ink-4)]">Print / reprint reason<Input className="mt-1" value={printReason} onChange={(event)=>setPrintReason(event.target.value)}/></label></div><label className="mt-3 block text-xs font-semibold text-[var(--ink-4)]">Void reason<Input className="mt-1" value={voidReason} onChange={(event)=>setVoidReason(event.target.value)}/></label><div className="mt-4 flex flex-wrap justify-between gap-2"><div className="flex gap-2"><Button variant="outline" onClick={()=>setSelectedIds((job.instances||[]).filter((x:any)=>x.status==='active').map((x:any)=>x.id))}>Select active</Button><Button variant="outline" onClick={()=>setSelectedIds([])}>Clear</Button></div><Button disabled={prepareState.loading||!selectedIds.length||!printReason.trim()} onClick={preparePrint}><Printer className="mr-2 h-4 w-4"/>Prepare {selectedIds.length} selected</Button></div></div>:null}</div>)}</div><div className="flex items-center justify-between border-t border-[var(--line)] p-4"><p className="text-xs text-[var(--ink-4)]">Page {page+1}</p><div className="flex gap-2"><Button aria-label="Previous label jobs" size="icon" variant="outline" disabled={page===0} onClick={()=>setPage((p)=>Math.max(0,p-1))}><ChevronLeft className="h-4 w-4"/></Button><Button aria-label="Next label jobs" size="icon" variant="outline" disabled={!hasNext} onClick={()=>setPage((p)=>p+1)}><ChevronRight className="h-4 w-4"/></Button></div></div></div>
    </section>
  </div>;
}
