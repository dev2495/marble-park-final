'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import { ArrowUpRight, Barcode, Box, Check, ChevronDown, ChevronLeft, ChevronRight, ClipboardCheck, HelpCircle as CircleHelp, History, Layers3, MapPin, Minus, PackageCheck, PackageSearch, Plus, Printer, QrCode, RotateCcw, ScanLine, Search, Sparkles, Store, Tags, Trash2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ProductImageFrame } from '@/components/product-image-frame';
import { QueryErrorBanner } from '@/components/query-state';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { PhysicalQrScanner } from '@/components/physical-qr-scanner';
import { ScanProductSelector } from '@/components/scan-product-selector';

const SOURCES = gql`query LabelSources($search: String) {
  products(search: $search, take: 50) { id sku internalCode name category brand finish dimensions piecesPerPack media }
  inventoryLots(status: "active", search: $search, take: 80)
  displaySamplesPage(search: $search, status: "active", skip: 0, take: 50, sort: "updated")
  goodsReceiptPage(sort: "newest", skip: 0, take: 12)
  internalLabelTemplates
}`;
const JOBS = gql`query LabelRegister($search: String, $sourceType: String, $printState: String, $skip: Int, $take: Int) { internalLabelJobs(search: $search, sourceType: $sourceType, printState: $printState, skip: $skip, take: $take) }`;
const CREATE = gql`mutation CreateLabelJob($input: InternalLabelJobInput!) { createInternalLabelJob(input: $input) }`;
const PREPARE = gql`mutation PreparePrint($input: InternalLabelPrintRunInput!) { prepareInternalLabelPrintRun(input: $input) }`;
const SCAN = gql`mutation ScanLabel($labelCode: String!, $input: InternalLabelScanInput) { scanInternalLabel(labelCode: $labelCode, input: $input) }`;
const VOID = gql`mutation VoidLabel($id: ID!, $reason: String!) { voidInternalLabel(id: $id, reason: $reason) }`;

type DeskTab = 'receipts' | 'subjects' | 'print' | 'scan';
type SubjectMode = 'product' | 'lot' | 'display';
type PrintOrientation = 'landscape' | 'portrait';
type PrintFilter = 'all' | 'unprinted' | 'printed';
type TrayLabel = {
  id: string;
  jobId: string;
  jobNumber: string;
  labelCode: string;
  source: string;
  sourceType: string;
  productCode: string;
  printCount: number;
};

const MAX_BULK_LABELS = 500;
const MAX_PHYSICAL_PAGES = 1000;

function imageOf(value: any) {
  const media = value?.media || value?.product?.media || {};
  return media.primaryUrl || media.images?.[0]?.url || media.images?.[0] || value?.imageUrl || '';
}
function availableOf(lot: any) { return (lot?.balances || []).reduce((sum: number, row: any) => sum + Number(row.available || 0), 0); }
function suggestedLabels(line: any) {
  const accepted = Math.max(0, Number(line.acceptedQuantity || 0));
  const pack = Math.max(1, Number(line.product?.piecesPerPack || 1));
  return Math.min(500, Math.max(1, Math.ceil(accepted / pack)));
}
function sourceName(job: any) {
  const first = job?.instances?.[0];
  return first?.displaySample?.internalCode || first?.product?.internalCode || first?.product?.sku || job?.sourceType?.replaceAll('_', ' ') || 'Label source';
}
function trayLabelOf(job: any, label: any): TrayLabel {
  return {
    id: String(label.id),
    jobId: String(job.id),
    jobNumber: String(job.jobNumber || 'Label job'),
    labelCode: String(label.labelCode || ''),
    source: sourceName(job),
    sourceType: String(job.sourceType || 'product'),
    productCode: String(label.displaySample?.internalCode || label.product?.internalCode || label.product?.sku || 'Product identity'),
    printCount: Number(label.printCount || 0),
  };
}

export default function LabelDeskPage() {
  const [requestedGrn, setRequestedGrn] = useState('');
  const [tab, setTab] = useState<DeskTab>('receipts');
  const [mode, setMode] = useState<SubjectMode>('lot');
  const [sourceSearch, setSourceSearch] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [purpose, setPurpose] = useState('stock_pack');
  const [quantity, setQuantity] = useState('1');
  const [receiptCounts, setReceiptCounts] = useState<Record<string, string>>({});
  const [receiptSelection, setReceiptSelection] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [receiptCreationLoading, setReceiptCreationLoading] = useState(false);
  const [registerSearch, setRegisterSearch] = useState('');
  const [printFilter, setPrintFilter] = useState<PrintFilter>('unprinted');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [expandedJobId, setExpandedJobId] = useState('');
  const [trayLabels, setTrayLabels] = useState<Record<string, TrayLabel>>({});
  const [physicalTemplate, setPhysicalTemplate] = useState('thermal_4x2');
  const [printOrientation, setPrintOrientation] = useState<PrintOrientation>('landscape');
  const [copies, setCopies] = useState('1');
  const [printReason, setPrintReason] = useState('Operational label print');
  const [voidReason, setVoidReason] = useState('Damaged or superseded physical label');
  const [scanResult, setScanResult] = useState<any>(null);
  const [scanPayload, setScanPayload] = useState('');
  const debouncedSource = useDebouncedValue(sourceSearch.trim(), 250);
  const debouncedRegister = useDebouncedValue(registerSearch.trim(), 250);
  const pageSize = 20;
  const { data: sourceData, loading: sourceLoading, error: sourceError, refetch: refetchSources } = useQuery(SOURCES, { variables: { search: debouncedSource || undefined }, fetchPolicy: 'cache-and-network' });
  const { data, loading: jobsLoading, error, refetch } = useQuery(JOBS, { variables: { search: debouncedRegister || undefined, sourceType: sourceFilter === 'all' ? undefined : sourceFilter, printState: printFilter, skip: page * pageSize, take: pageSize + 1 }, fetchPolicy: 'cache-and-network' });
  const [create, createState] = useMutation(CREATE);
  const [prepare, prepareState] = useMutation(PREPARE);
  const [scan, scanState] = useMutation(SCAN, { onCompleted: (response) => setScanResult(response.scanInternalLabel) });
  const [voidLabel, voidState] = useMutation(VOID, {
    onCompleted: (response) => {
      const id = String(response?.voidInternalLabel?.id || '');
      if (id) setTrayLabels((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      refetch();
    },
  });
  const allJobs = data?.internalLabelJobs || [];
  const jobs = allJobs.slice(0, pageSize);
  const hasNext = allJobs.length > pageSize;
  const products = sourceData?.products || [];
  const lots = sourceData?.inventoryLots || [];
  const displays = sourceData?.displaySamplesPage?.items || [];
  const receipts = sourceData?.goodsReceiptPage?.items || [];
  const templates = sourceData?.internalLabelTemplates || [];
  const activeLabels = jobs.reduce((sum: number, job: any) => sum + (job.instances || []).filter((row: any) => row.status === 'active').length, 0);
  const unprintedLabels = jobs.reduce((sum: number, job: any) => sum + (job.instances || []).filter((row: any) => row.status === 'active' && !Number(row.printCount || 0)).length, 0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setRequestedGrn(params.get('grn') || '');
    const requestedTab = params.get('tab');
    if (requestedTab === 'print' || requestedTab === 'scan' || requestedTab === 'subjects') setTab(requestedTab);
  }, []);
  useEffect(() => {
    if (!requestedGrn || !receipts.length) return;
    document.getElementById(`grn-${requestedGrn}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [requestedGrn, receipts.length]);

  function changeMode(next: SubjectMode) {
    setMode(next); setSourceId('');
    setPurpose(next === 'lot' ? 'stock_pack' : next === 'display' ? 'display_sample' : 'shelf');
  }
  function toggleJob(job: any) {
    setExpandedJobId((current) => current === job.id ? '' : job.id);
  }
  function addManyToTray(entries: Array<{ job: any; label: any }>) {
    const uniqueEntries = entries.filter(({ label }) => label?.id && label.status === 'active');
    const newCount = uniqueEntries.filter(({ label }) => !trayLabels[label.id]).length;
    if (Object.keys(trayLabels).length + newCount > MAX_BULK_LABELS) {
      setNotice(`A bulk run can hold ${MAX_BULK_LABELS} unique labels. The tray was filled to that safe limit; print it, then start the next run.`);
    }
    setTrayLabels((current) => {
      const next = { ...current };
      let total = Object.keys(next).length;
      for (const { job, label } of uniqueEntries) {
        if (!next[label.id] && total >= MAX_BULK_LABELS) break;
        if (!next[label.id]) total += 1;
        next[label.id] = trayLabelOf(job, label);
      }
      return next;
    });
  }
  function removeManyFromTray(labelIds: string[]) {
    setTrayLabels((current) => {
      const next = { ...current };
      labelIds.forEach((id) => delete next[id]);
      return next;
    });
  }
  function toggleTrayLabel(job: any, label: any, selected: boolean) {
    if (selected) addManyToTray([{ job, label }]);
    else removeManyFromTray([label.id]);
  }
  async function generate() {
    const subject = mode === 'product' ? { productId: sourceId } : mode === 'lot' ? { lotId: sourceId } : { displaySampleId: sourceId };
    const response = await create({ variables: { input: { ...subject, quantity: Number(quantity), template: purpose, newJob: true } } });
    const job = response.data?.createInternalLabelJob;
    setSourceId(''); setSourceSearch(''); setQuantity('1');
    setPurpose(mode === 'lot' ? 'stock_pack' : mode === 'display' ? 'display_sample' : 'shelf');
    if (job) addManyToTray((job.instances || []).map((label: any) => ({ job, label })));
    setNotice(`${job?.jobNumber || 'Label job'} created and added to the print tray. Review the selection, then prepare one print run.`);
    await Promise.all([refetch(), refetchSources()]);
    setTab('print');
  }
  function toggleReceiptLine(line: any) {
    if (!line.lotId || Number(line.acceptedQuantity || 0) <= 0) return;
    setReceiptSelection((current) => current.includes(line.id) ? current.filter((id) => id !== line.id) : [...current, line.id]);
    setReceiptCounts((current) => ({ ...current, [line.id]: current[line.id] || String(suggestedLabels(line)) }));
  }
  async function generateReceiptLabels() {
    if (receiptCreationLoading) return;
    setActionError('');
    setNotice('');
    const selected = receipts.flatMap((receipt: any) => receipt.lines || []).filter((line: any) => receiptSelection.includes(line.id));
    const requests = selected.map((line: any) => ({ line, count: Number(receiptCounts[line.id] || suggestedLabels(line)) }));
    if (!requests.length) {
      setActionError('Select at least one received line before creating labels.');
      return;
    }
    if (requests.some(({ count }: { count: number }) => !Number.isInteger(count) || count < 1 || count > 500)) {
      setActionError('Enter a whole number from 1 to 500 for each received line. No labels were created.');
      return;
    }
    const requestedCount = requests.reduce((sum: number, request: { count: number }) => sum + request.count, 0);
    if (Object.keys(trayLabels).length + requestedCount > MAX_BULK_LABELS) {
      setActionError(`These lines need ${requestedCount} labels, but the tray has room for ${MAX_BULK_LABELS - Object.keys(trayLabels).length}. Print or clear the current tray, or select fewer lines. No labels were created.`);
      return;
    }
    setReceiptCreationLoading(true);
    let createdCount = 0;
    try {
      for (const { line, count } of requests) {
        const response = await create({ variables: { input: { lotId: line.lotId, quantity: count, template: 'stock_pack', newJob: true } } });
        const job = response.data?.createInternalLabelJob;
        if (!job?.id) throw new Error('The server did not return a created label job. Refresh the register before retrying.');
        addManyToTray((job.instances || []).map((label: any) => ({ job, label })));
        createdCount += 1;
        setReceiptSelection((current) => current.filter((id) => id !== line.id));
        setReceiptCounts((current) => {
          const next = { ...current };
          delete next[line.id];
          return next;
        });
      }
      setNotice(`${createdCount} receipt label job${createdCount === 1 ? '' : 's'} created and added to one print tray. Stock was not changed.`);
      setTab('print');
    } catch (failure) {
      const detail = failure instanceof Error ? failure.message : 'A label job could not be created.';
      setActionError(`${createdCount ? `${createdCount} completed job${createdCount === 1 ? ' is' : 's are'} safe in the print tray. Only unfinished receipt lines remain selected. ` : 'No completed jobs were added to the tray. '}${detail}`);
    } finally {
      await Promise.allSettled([refetch(), refetchSources()]);
      setReceiptCreationLoading(false);
    }
  }
  async function preparePrint() {
    setActionError('');
    const labelIds = Object.keys(trayLabels);
    const copyCount = Number(copies);
    if (!Number.isInteger(copyCount) || copyCount < 1 || copyCount > 50) {
      setActionError('Copies must be a whole number from 1 to 50.');
      return;
    }
    if (!labelIds.length || labelIds.length * copyCount > MAX_PHYSICAL_PAGES || !printReason.trim()) return;
    const printWindow = window.open('', '_blank');
    try {
      const response = await prepare({ variables: { input: { templateCode: physicalTemplate, ...(physicalTemplate === 'thermal_4x2' ? { orientation: printOrientation } : {}), labelIds, copies: copyCount, reason: printReason } } });
      const run = response.data?.prepareInternalLabelPrintRun;
      if (!run?.id) throw new Error('No print preview was returned. Your selected labels remain in the tray.');
      if (printWindow && !printWindow.closed) {
        printWindow.location.href = `/print/labels/${run.id}`;
        printWindow.opener = null;
      } else {
        window.location.href = `/print/labels/${run.id}`;
      }
      setNotice(`${run.runNumber || 'Bulk print run'} prepared with ${labelIds.length} unique labels and ${labelIds.length * copyCount} physical sticker pages.`);
    } catch (failure) {
      printWindow?.close();
      setActionError(failure instanceof Error ? failure.message : 'The print preview could not open. Your selected labels remain in the tray.');
    }
  }
  async function executeScan(payload: string) {
    setScanResult(null);
    setScanPayload(payload);
    await scan({ variables: { labelCode: payload, input: { action: 'physical_identity_lookup', metadata: { surface: 'label_desk' } } } });
  }
  async function continueFromScan(products: any[], target: 'intent' | 'quote') {
    if (!scanPayload || !products.length) return;
    await scan({ variables: { labelCode: scanPayload, input: { action: `scan_similar_${target}`, metadata: { surface: 'label_desk', selectedProductIds: products.map((product) => product.id) } } } });
    const params = new URLSearchParams({ products: products.map((product) => product.id).join(','), scanned: scanPayload });
    window.location.href = target === 'intent' ? `/dashboard/leads/new?${params}` : `/dashboard/quotes/new?${params}`;
  }

  return <div className="space-y-5 pb-12">
    {[sourceError,error,createState.error,prepareState.error,scanState.error,voidState.error].filter(Boolean).map((item:any,index)=><QueryErrorBanner key={index} error={item}/>) }
    {actionError?<div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold leading-6 text-red-900">{actionError}</div>:null}
    <header className="relative overflow-hidden rounded-[1.75rem] border border-[#eadbd5] bg-[radial-gradient(circle_at_82%_12%,rgba(209,120,96,.24),transparent_30%),linear-gradient(125deg,#241b1a_0%,#4a211f_55%,#8f302b_100%)] p-6 text-white shadow-[0_30px_80px_-44px_rgba(86,25,22,.85)] sm:p-8">
      <div className="absolute -right-9 -top-12 h-44 w-44 rounded-full border border-white/10"/><div className="absolute -right-1 -top-6 h-28 w-28 rounded-full border border-white/10"/>
      <div className="relative flex flex-col justify-between gap-6 xl:flex-row xl:items-end"><div><div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.18em] text-[#f4c9bc]"><Sparkles className="h-4 w-4"/>Physical identity desk</div><h1 className="mt-3 max-w-3xl font-display text-3xl font-bold tracking-tight sm:text-4xl">From inward receipt to the right label—without losing the lot.</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-white/75">Choose a recent GRN, confirm the exact physical lot and label count, then print, scan or audit it. Product, carton and showroom labels use the same governed lifecycle.</p></div><div className="grid grid-cols-3 gap-2 sm:min-w-[27rem]"><HeroMetric label="Recent receipts shown" value={receipts.length}/><HeroMetric label="Active on this page" value={activeLabels}/><HeroMetric label="Unprinted on page" value={unprintedLabels}/></div></div>
    </header>

    <nav className="grid grid-cols-2 gap-2 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-2 shadow-sm lg:grid-cols-4" aria-label="Label lifecycle">
      {([['receipts','1 · Recent GRNs',PackageCheck],['subjects','2 · Other subjects',PackageSearch],['print','3 · Print & reprint',Printer],['scan','4 · Scan & verify',ScanLine]] as any[]).map(([id,label,Icon])=><button key={id} onClick={()=>setTab(id)} className={`flex min-h-12 items-center justify-center rounded-xl px-3 text-sm font-semibold transition duration-200 ${tab===id?'bg-[#a92f28] text-white shadow-md':'text-[var(--ink-3)] hover:bg-rose-50 hover:text-[#8e2924]'}`}><Icon className="mr-2 h-4 w-4"/>{label}</button>)}
    </nav>
    {notice?<div role="status" className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-emerald-600 text-white"><Check className="h-4 w-4"/></span>{notice}</div>:null}

    {tab==='receipts'?<section className="space-y-4">
      <div className="flex flex-col justify-between gap-3 rounded-2xl border border-amber-300/50 bg-[var(--surface)] p-5 md:flex-row md:items-center"><div><h2 className="text-lg font-bold text-[var(--ink)]">Label received stock</h2><p className="mt-1 text-sm text-[var(--ink-3)]">Select accepted GRN lines. Each job points to the already-posted exact lot; creating labels never changes quantity.</p></div><Button asChild variant="outline"><Link href="/dashboard/procurement?view=receiving">Open Receiving</Link></Button></div>
      <div className="space-y-3">{receipts.map((grn:any)=><article id={`grn-${grn.id}`} key={grn.id} className={`overflow-hidden rounded-2xl border bg-[var(--surface)] shadow-[0_18px_48px_-40px_rgba(30,20,18,.7)] transition ${requestedGrn===grn.id?'border-[#a92f28] ring-2 ring-[#a92f28]/15':'border-[var(--line)]'}`}><div className="flex flex-col justify-between gap-3 border-b border-[var(--line)] bg-[var(--bg-soft)] p-4 sm:flex-row sm:items-center"><div><div className="flex flex-wrap items-center gap-2"><p className="font-bold text-[var(--ink)]">{grn.grnNumber}</p><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700">Posted</span><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase text-slate-600">{grn.purchaseOrderId?'Against PO':'Manual inward'}</span></div><p className="mt-1 text-xs text-[var(--ink-4)]">{grn.vendorName} · {new Date(grn.receivedDate).toLocaleString('en-IN')} · challan {grn.supplierChallan||'not captured'}</p></div><p className="text-xs font-semibold text-[var(--ink-4)]">{(grn.lines||[]).filter((line:any)=>line.lotId&&Number(line.acceptedQuantity)>0).length} label-ready lot line(s)</p></div><div className="grid gap-3 p-4 lg:grid-cols-2">{(grn.lines||[]).map((line:any)=>{const selected=receiptSelection.includes(line.id);const ready=line.lotId&&Number(line.acceptedQuantity)>0;return <div key={line.id} className={`rounded-xl border bg-[var(--surface)] p-3 transition ${selected?'border-[#b33a32] ring-2 ring-[#b33a32]/15':'border-[var(--line)]'} ${!ready?'opacity-60':''}`}><div className="flex gap-3"><ProductImageFrame src={imageOf(line.product)} alt={line.name} className="h-16 w-16 shrink-0 rounded-xl"/><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><button type="button" disabled={!ready} onClick={()=>toggleReceiptLine(line)} className="min-w-0 text-left"><p className="truncate text-sm font-bold text-[var(--ink)]">{line.product?.internalCode||line.sku} · {line.name}</p><p className="mt-1 text-xs text-[var(--ink-4)]">SKU {line.sku} · accepted {line.acceptedQuantity} pc · damaged {line.damagedQuantity||0}</p></button><button type="button" disabled={!ready} onClick={()=>toggleReceiptLine(line)} aria-label={`Select ${line.name}`} className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border ${selected?'border-[#a92f28] bg-[#a92f28] text-white':'border-[var(--line)] text-transparent'}`}><Check className="h-4 w-4"/></button></div><div className="mt-2 rounded-lg bg-[var(--bg-soft)] px-3 py-2 text-[11px] leading-5 text-[var(--ink-3)]"><b className="text-[var(--ink)]">{line.lot?.lotNumber||line.lotId||'No lot'}</b>{line.lot?.supplierBatch?` · batch ${line.lot.supplierBatch}`:''}<br/>{line.lot?.balances?.map((b:any)=>`${b.location?.code||b.locationId}: ${b.available} available`).join(' · ')||'Lot balance not available'}</div>{selected?<label className="mt-3 flex items-center justify-between gap-3 text-xs font-semibold text-[var(--ink-3)]"><span>Unique physical labels<br/><small className="font-normal text-[var(--ink-4)]">Suggested from {line.product?.piecesPerPack||1} pc/pack; confirm before creating.</small></span><Input className="w-24" type="number" min={1} max={500} value={receiptCounts[line.id]||String(suggestedLabels(line))} onChange={(event)=>setReceiptCounts((current)=>({...current,[line.id]:event.target.value}))}/></label>:null}</div></div></div>})}</div></article>)}{!sourceLoading&&!receipts.length?<Empty icon={PackageCheck} title="No posted receipts yet" text="Post a PO or manual GRN first. The accepted stock lot will appear here automatically."/>:null}</div>
      <div className="sticky bottom-4 z-20 flex flex-col justify-between gap-3 rounded-2xl border border-[#d9aaa0] bg-[#281b1a]/95 p-4 text-white shadow-2xl backdrop-blur sm:flex-row sm:items-center"><div><p className="font-bold">{receiptSelection.length} receipt line{receiptSelection.length===1?'':'s'} selected</p><p className="mt-1 text-xs text-white/65">One auditable label job per exact lot. No stock movement is posted.</p></div><Button disabled={!receiptSelection.length||createState.loading||receiptCreationLoading} onClick={generateReceiptLabels} className="bg-[#d55848] hover:bg-[#bf4538]"><Barcode className="mr-2 h-4 w-4"/>{receiptCreationLoading?'Creating selected jobs…':'Create receipt label jobs'}</Button></div>
    </section>:null}

    {tab==='subjects'?<section className="grid gap-5 xl:grid-cols-[1fr_21rem]">
      <div className="mp-panel overflow-hidden"><div className="border-b border-[var(--line)] bg-[var(--bg-soft)] p-5"><div className="flex items-center gap-2"><QrCode className="h-5 w-5 text-[#d65a4d]"/><h2 className="text-lg font-bold text-[var(--ink)]">Create labels for another subject</h2></div><p className="mt-1 text-sm text-[var(--ink-3)]">Use this for shelf/product identity, an existing lot, cartons, or a registered showroom display.</p></div><div className="p-5"><div className="grid grid-cols-3 rounded-xl border border-[var(--line)] bg-[var(--bg-soft)] p-1.5">{([['product','Product / shelf',PackageSearch],['lot','Exact lot',Box],['display','Display asset',Store]] as any[]).map(([id,label,Icon])=><button key={id} onClick={()=>changeMode(id)} className={`min-h-12 rounded-lg px-2 text-xs font-semibold transition ${mode===id?'bg-[#a92f28] text-white shadow':'text-[var(--ink-3)] hover:bg-[var(--surface)]'}`}><Icon className="mr-1.5 inline h-4 w-4"/>{label}</button>)}</div><label className="relative mt-5 block"><Search className="absolute left-3 top-3 h-4 w-4 text-[var(--ink-4)]"/><Input className="pl-9" value={sourceSearch} onChange={(event)=>setSourceSearch(event.target.value)} placeholder="Search SKU, design, label code, lot, batch or display"/></label><div className="mt-3 grid gap-2">{(mode==='product'?products:mode==='lot'?lots:displays).slice(0,12).map((row:any)=>{const id=row.id;const selected=sourceId===id;const product=row.product||row;return <button type="button" key={id} onClick={()=>setSourceId(id)} className={`flex items-center gap-3 rounded-xl border bg-[var(--surface)] p-3 text-left transition ${selected?'border-[#a92f28] ring-2 ring-[#a92f28]/15':'border-[var(--line)] hover:bg-[var(--bg-soft)]'}`}><ProductImageFrame src={imageOf(row)} alt={product.name||'Label subject'} className="h-14 w-14 shrink-0 rounded-lg"/><span className="min-w-0 flex-1"><b className="block truncate text-sm">{row.internalCode||product.internalCode||product.sku} · {product.name}</b><small className="mt-1 block truncate text-[var(--ink-4)]">{mode==='lot'?`${row.lotNumber} · ${availableOf(row)} available${row.supplierBatch?` · batch ${row.supplierBatch}`:''}`:mode==='display'?`${row.sampleNumber} · ${row.displayZone||'zone pending'} · ${row.condition}`:`${product.sku} · ${product.brand||'brand pending'} · ${product.dimensions||'size pending'}`}</small></span><span className={`grid h-6 w-6 place-items-center rounded-full border ${selected?'border-[#a92f28] bg-[#a92f28] text-white':'border-[var(--line)] text-transparent'}`}><Check className="h-3.5 w-3.5"/></span></button>})}</div><div className="mt-5 grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-[var(--ink-4)]">Label purpose<select value={purpose} onChange={(event)=>setPurpose(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm"><option value="shelf">Shelf / product</option><option value="carton">Carton</option><option value="stock_pack">Exact stock lot / pack</option><option value="display_sample">Showroom display</option></select></label><label className="text-xs font-semibold text-[var(--ink-4)]">New unique labels<Input className="mt-1" type="number" min={1} max={500} value={quantity} onChange={(event)=>setQuantity(event.target.value)}/></label></div><Button className="mt-5 w-full" disabled={createState.loading||!sourceId||Number(quantity)<1||Number(quantity)>500} onClick={generate}><Barcode className="mr-2 h-4 w-4"/>{createState.loading?'Creating…':'Create job and continue to print'}</Button></div></div>
      <aside className="space-y-4"><div className="rounded-2xl border border-sky-200 bg-sky-50 p-5"><CircleHelp className="h-5 w-5 text-sky-700"/><h3 className="mt-3 font-bold text-sky-950">Which subject should I choose?</h3><ul className="mt-3 space-y-3 text-xs leading-5 text-sky-900"><li><b>Product / shelf:</b> identifies a catalogue SKU, not a quantity.</li><li><b>Exact lot:</b> identifies physically received stock and retains batch, receipt and location context.</li><li><b>Display:</b> identifies a non-sellable showroom asset, even when it originated from stock.</li></ul></div><Button asChild variant="outline" className="w-full"><Link href="/dashboard/help#labels-lots"><CircleHelp className="mr-2 h-4 w-4"/>Open label lifecycle help</Link></Button></aside>
    </section>:null}

    {tab==='print'?<div className="label-light-surface"><PrintRegister jobs={jobs} loading={jobsLoading} expandedJobId={expandedJobId} toggleJob={toggleJob} trayLabels={trayLabels} addManyToTray={addManyToTray} removeManyFromTray={removeManyFromTray} toggleTrayLabel={toggleTrayLabel} clearTray={()=>setTrayLabels({})} templates={templates} physicalTemplate={physicalTemplate} setPhysicalTemplate={setPhysicalTemplate} printOrientation={printOrientation} setPrintOrientation={setPrintOrientation} copies={copies} setCopies={setCopies} printReason={printReason} setPrintReason={setPrintReason} voidReason={voidReason} setVoidReason={setVoidReason} voidLabel={voidLabel} voidLoading={voidState.loading} preparePrint={preparePrint} prepareLoading={prepareState.loading} registerSearch={registerSearch} setRegisterSearch={(value:string)=>{setRegisterSearch(value);setPage(0)}} printFilter={printFilter} setPrintFilter={(value:PrintFilter)=>{setPrintFilter(value);setPage(0)}} sourceFilter={sourceFilter} setSourceFilter={(value:string)=>{setSourceFilter(value);setPage(0)}} page={page} setPage={setPage} hasNext={hasNext}/></div>:null}

    {tab==='scan'?<section className="grid gap-5 xl:grid-cols-[1fr_22rem]">
      <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)]">
        <div className="bg-[linear-gradient(120deg,#17302c,#225d52)] p-6 text-white"><div className="flex items-center gap-2"><ScanLine className="h-5 w-5 text-emerald-300"/><h2 className="text-lg font-bold">Scan, identify and act</h2></div><p className="mt-2 max-w-3xl text-sm leading-6 text-white/72">Use the phone camera, a handheld scanner, or the printed human code. A successful scan opens the catalogue identity, exact lot/display context and sales actions.</p><div className="mt-5 rounded-2xl bg-white p-3 text-slate-950"><PhysicalQrScanner busy={scanState.loading} onDetected={executeScan}/></div></div>
        {scanResult?<ScanIdentityResult result={scanResult} busy={scanState.loading} onIntent={(products)=>continueFromScan(products,'intent')} onQuote={(products)=>continueFromScan(products,'quote')} onDismiss={()=>setScanResult(null)}/>:<Empty icon={QrCode} title="Ready for the next scan" text="Camera scanning is available after you tap Scan with camera. No background camera or polling is used."/>}
      </div>
      <aside className="space-y-4"><div className="rounded-2xl border border-amber-200 bg-amber-50 p-5"><ClipboardCheck className="h-5 w-5 text-amber-700"/><h3 className="mt-3 font-bold text-amber-950">Before moving stock</h3><p className="mt-2 text-xs leading-5 text-amber-900">Match the label, product, exact lot, batch and location. A display QR identifies a non-sellable showroom asset and must never be dispatched as saleable stock.</p></div><div className="rounded-2xl border border-sky-200 bg-sky-50 p-5"><Store className="h-5 w-5 text-sky-700"/><h3 className="mt-3 font-bold text-sky-950">Need to create a display?</h3><p className="mt-2 text-xs leading-5 text-sky-900">Purchased items go through GRN, then move from their exact lot. Free vendor samples are registered without increasing stock.</p><Button asChild size="sm" className="mt-4 w-full"><Link href="/dashboard/inventory/display-assets">Open Display Assets</Link></Button></div><Button asChild variant="outline" className="w-full"><Link href="/dashboard/help#labels-lots"><CircleHelp className="mr-2 h-4 w-4"/>Open scan help</Link></Button></aside>
    </section>:null}
  </div>;
}

function ScanIdentityResult({result,busy,onIntent,onQuote,onDismiss}:{result:any;busy:boolean;onIntent:(products:any[])=>Promise<void>;onQuote:(products:any[])=>Promise<void>;onDismiss:()=>void}) {
  const label=result?.label; const product=label?.product; const lot=label?.lot; const display=label?.displaySample;
  const ok=result?.result==='success';
  if(!label)return <div className="m-5 rounded-2xl border border-red-200 bg-red-50 p-5"><div className="flex items-center gap-2 text-red-900"><span className="grid h-8 w-8 place-items-center rounded-full bg-red-600 text-white"><XCircle className="h-4 w-4"/></span><b>No registered production label found</b></div><p className="mt-3 text-sm leading-6 text-red-800">{result?.message || 'This QR or code is not in the governed production label register. Print a fresh label from this page before using the physical item.'}</p></div>;
  const available=(lot?.balances||[]).reduce((sum:number,row:any)=>sum+Number(row.available||0),0);
  return <div className="space-y-4 p-5"><div className={`overflow-hidden rounded-2xl border ${ok?'border-emerald-200 bg-emerald-50':'border-red-200 bg-red-50'}`}>
    <div className="flex flex-col justify-between gap-3 border-b border-black/5 p-5 sm:flex-row sm:items-center"><div className="flex items-center gap-3"><span className={`grid h-9 w-9 place-items-center rounded-full text-white ${ok?'bg-emerald-600':'bg-red-600'}`}>{ok?<Check className="h-4 w-4"/>:<XCircle className="h-4 w-4"/>}</span><div><p className="font-bold capitalize">{String(result.result).replaceAll('_',' ')} physical identity</p><p className="mt-0.5 font-mono text-[11px] text-[var(--ink-4)]">{label.labelCode}</p></div></div><span className={`self-start rounded-full px-3 py-1 text-[10px] font-bold uppercase ${display?'bg-violet-100 text-violet-800':lot?'bg-blue-100 text-blue-800':'bg-slate-100 text-slate-700'}`}>{display?'Display asset':lot?'Exact stock lot':'Catalogue / shelf'}</span></div>
    <div className="grid gap-5 p-5 lg:grid-cols-[10rem_1fr]"><ProductImageFrame src={imageOf(label)} alt={product?.name||'Scanned item'} className="aspect-square rounded-2xl"/><div className="min-w-0"><p className="text-xs font-bold uppercase tracking-[.14em] text-[var(--ink-4)]">{display?.internalCode||product?.internalCode||product?.sku}</p><h3 className="mt-1 text-2xl font-bold text-[var(--ink)]">{product?.name}</h3><p className="mt-2 text-sm text-[var(--ink-3)]">{product?.brandMaster?.code||product?.brand||'Brand pending'} · {product?.finish||product?.tileDesignMaster?.surface||'Finish pending'} · {product?.dimensions||product?.tileSizeMaster?.name||'Size pending'}</p><div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4"><Fact label="Warehouse SKU" value={product?.sku}/><Fact label="Display code" value={display?.internalCode||product?.internalCode||'—'}/><Fact label="Inventory UOM" value={product?.purchaseUom||product?.unit||'PC'}/><Fact label="Selling UOM" value={product?.salesUom||product?.unit||'PC'}/></div>{lot?<div className="mt-3 rounded-xl border border-blue-200 bg-white/70 p-3 text-xs leading-5 text-blue-950"><b>{lot.lotNumber}</b>{lot.supplierBatch?` · supplier batch ${lot.supplierBatch}`:''} · <b>{available} available</b><br/>{(lot.balances||[]).map((row:any)=><span key={row.id} className="mr-3 inline-flex items-center gap-1"><MapPin className="h-3 w-3"/>{row.location?.code||row.locationId}: {row.available}</span>)}</div>:null}{display?<div className="mt-3 rounded-xl border border-violet-200 bg-white/70 p-3 text-xs leading-5 text-violet-950"><b>{display.sampleNumber}</b> · {display.status} · {display.condition}<br/><MapPin className="mr-1 inline h-3 w-3"/>{display.displayZone||'Zone pending'} · non-sellable asset</div>:null}
      {!ok?<p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold leading-5 text-red-900">This label, product, lot or display is no longer active. Do not use the physical item for a new intent, quote or stock movement until the source record is corrected.</p>:null}<div className={`mt-5 grid gap-2 ${ok&&lot?'sm:grid-cols-2':'sm:grid-cols-1'}`}><Button asChild variant="outline"><Link href={`/dashboard/products?product=${product?.id}`}><ArrowUpRight className="mr-2 h-4 w-4"/>Open catalogue</Link></Button>{ok&&lot?<Button asChild variant="outline"><Link href={`/dashboard/inventory/display-assets?product=${product?.id}&lot=${lot.id}&location=${lot.balances?.find((row:any)=>Number(row.available)>0)?.locationId||''}`}><Store className="mr-2 h-4 w-4"/>Move to display</Link></Button>:null}</div>
    </div></div></div>{ok?<ScanProductSelector result={result} busy={busy} primaryLabel="Quick quote with selected" onPrimary={onQuote} secondaryLabel="Add selected to intent" onSecondary={onIntent} onDismiss={onDismiss}/>:null}</div>;
}
function Fact({label,value}:{label:string;value:any}){return <div className="rounded-xl bg-white/65 p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ink-4)]">{label}</p><p className="mt-1 truncate text-xs font-bold text-[var(--ink)]">{value||'—'}</p></div>}

function PrintRegister(props:any) {
  const {
    jobs, loading, expandedJobId, toggleJob, trayLabels, addManyToTray, removeManyFromTray,
    toggleTrayLabel, clearTray, templates, physicalTemplate, setPhysicalTemplate, copies,
    setCopies, printReason, setPrintReason, voidReason, setVoidReason, voidLabel, voidLoading,
    preparePrint, prepareLoading, registerSearch, setRegisterSearch, page, setPage, hasNext,
    printOrientation, setPrintOrientation, printFilter, setPrintFilter, sourceFilter, setSourceFilter,
  } = props;
  const selectedLabels = Object.values(trayLabels) as TrayLabel[];
  const selectedIds = new Set(selectedLabels.map((label) => label.id));
  const copyCount = Number(copies);
  const validCopies = Number.isInteger(copyCount) && copyCount >= 1 && copyCount <= 50;
  const physicalPages = validCopies ? selectedLabels.length * copyCount : NaN;
  const exceedsPageLimit = physicalPages > MAX_PHYSICAL_PAGES;
  const selectedByJob = selectedLabels.reduce((groups: Record<string, TrayLabel[]>, label) => {
    groups[label.jobId] = [...(groups[label.jobId] || []), label];
    return groups;
  }, {});
  const selectedJobGroups = Object.values(selectedByJob);

  function activeLabelsFor(job: any) {
    return (job.instances || []).filter((label: any) => label.status === 'active');
  }
  function matchingLabelsFor(job: any) {
    const active = activeLabelsFor(job);
    if (printFilter === 'unprinted') return active.filter((label: any) => !Number(label.printCount || 0));
    if (printFilter === 'printed') return active.filter((label: any) => Number(label.printCount || 0) > 0);
    return active;
  }
  const sourceFilteredJobs = jobs.filter((job: any) => sourceFilter === 'all' || job.sourceType === sourceFilter);
  const filteredJobs = sourceFilteredJobs.filter((job: any) => matchingLabelsFor(job).length > 0);
  const visibleEntries = filteredJobs.flatMap((job: any) => matchingLabelsFor(job).map((label: any) => ({ job, label })));
  const visibleUnprintedEntries = filteredJobs.flatMap((job: any) => activeLabelsFor(job).filter((label: any) => !Number(label.printCount || 0)).map((label: any) => ({ job, label })));

  function toggleWholeJob(job: any) {
    const matching = matchingLabelsFor(job);
    const allSelected = matching.length > 0 && matching.every((label: any) => selectedIds.has(label.id));
    if (allSelected) removeManyFromTray(matching.map((label: any) => label.id));
    else addManyToTray(matching.map((label: any) => ({ job, label })));
  }

  return <section data-testid="bulk-print-workspace" className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
    <div className="mp-panel min-w-0 overflow-hidden">
      <div className="border-b border-[var(--line)] bg-[#fffaf7] p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.18em] text-[#a92f28]"><Layers3 className="h-4 w-4"/>Bulk sticker workspace</div>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-[var(--ink)]">Choose many. Print once.</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--ink-3)]">Add matching batches or individual labels, choose how the sticker sits on your roll, then print the whole tray in one run. Your tray stays selected while you search or change pages.</p>
          </div>
          <label className="relative w-full lg:max-w-md">
            <Search className="absolute left-3.5 top-3.5 h-4 w-4 text-[var(--ink-4)]"/>
            <Input data-testid="bulk-label-search" className="h-11 bg-white pl-10" value={registerSearch} onChange={(event)=>setRegisterSearch(event.target.value)} placeholder="Search job, QR, SKU, product, lot or display"/>
          </label>
        </div>
        <div className="mt-5 flex flex-col gap-3 border-t border-[#eadfd9] pt-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {([['all','All active'],['unprinted','Not printed'],['printed','Printed before']] as const).map(([id,label])=><button key={id} type="button" aria-pressed={printFilter===id} onClick={()=>setPrintFilter(id)} className={`rounded-full border px-3 py-2 text-xs font-bold transition ${printFilter===id?'border-[#2b201f] bg-[#2b201f] text-white':'border-[#dfd2cc] bg-white text-[var(--ink-3)] hover:border-[#b87b70]'}`}>{label}</button>)}
            <label className="relative">
              <select value={sourceFilter} onChange={(event)=>setSourceFilter(event.target.value)} className="h-9 appearance-none rounded-full border border-[#dfd2cc] bg-white pl-3 pr-9 text-xs font-bold text-[var(--ink-3)]">
                <option value="all">All label types</option>
                <option value="inventory_lot">Exact stock lots</option>
                <option value="product">Product / shelf</option>
                <option value="display_sample">Display assets</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-[var(--ink-4)]"/>
            </label>
          </div>
          <p className="text-xs font-semibold text-[var(--ink-4)]"><b className="text-[var(--ink)]">{visibleEntries.length}</b> matching labels on page {page+1}</p>
        </div>
      </div>

      <div className="flex flex-col gap-3 border-b border-[var(--line)] bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <Button data-testid="select-visible-labels" variant="outline" size="sm" disabled={loading||!visibleEntries.length} onClick={()=>addManyToTray(visibleEntries)}><Tags className="mr-2 h-4 w-4"/>Add {visibleEntries.length} matching</Button>
          <Button variant="outline" size="sm" disabled={loading||!visibleUnprintedEntries.length} onClick={()=>addManyToTray(visibleUnprintedEntries)}><Sparkles className="mr-2 h-4 w-4"/>Add unprinted</Button>
          <Button variant="ghost" size="sm" disabled={!visibleEntries.some(({label}:any)=>selectedIds.has(label.id))} onClick={()=>removeManyFromTray(visibleEntries.map(({label}:any)=>label.id))}>Clear visible</Button>
        </div>
        <span className="text-[11px] font-semibold text-[var(--ink-4)]">Up to {MAX_BULK_LABELS} unique labels per run</span>
      </div>

      <div className="divide-y divide-[var(--line)]">
        {filteredJobs.map((job:any)=>{
          const active = activeLabelsFor(job);
          const matching = matchingLabelsFor(job);
          const unprinted = active.filter((label:any)=>!Number(label.printCount||0));
          const selectedCount = matching.filter((label:any)=>selectedIds.has(label.id)).length;
          const allSelected = matching.length > 0 && selectedCount === matching.length;
          const partiallySelected = selectedCount > 0 && !allSelected;
          const first = job.instances?.[0];
          return <article key={job.id} className={selectedCount?'bg-[#fffaf7]':'bg-[var(--surface)]'}>
            <div className="grid gap-3 p-4 sm:grid-cols-[2.75rem_3.25rem_minmax(0,1fr)_auto] sm:items-center">
              <button type="button" disabled={loading} aria-label={`${allSelected?'Remove':'Add'} all matching labels from ${job.jobNumber}`} onClick={()=>toggleWholeJob(job)} className={`grid h-10 w-10 place-items-center rounded-xl border transition ${selectedCount?'border-[#a92f28] bg-[#a92f28] text-white':'border-[#daccc6] bg-white text-transparent hover:border-[#a92f28]'}`}>
                {partiallySelected?<Minus className="h-4 w-4"/>:<Check className="h-4 w-4"/>}
              </button>
              <ProductImageFrame src={imageOf(first)} alt={sourceName(job)} className="hidden h-12 w-12 rounded-xl sm:block"/>
              <button type="button" onClick={()=>toggleJob(job)} className="min-w-0 text-left">
                <div className="flex flex-wrap items-center gap-2"><b className="font-mono text-sm text-[var(--ink)]">{job.jobNumber}</b><span className="rounded-full bg-[#f2e5df] px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-[#8e2924]">{String(job.template).replaceAll('_',' ')}</span></div>
                <p className="mt-1 truncate text-sm font-bold text-[var(--ink)]">{sourceName(job)}</p>
                <p className="mt-1 text-xs text-[var(--ink-4)]">{String(job.sourceType).replaceAll('_',' ')} · {new Date(job.requestedAt).toLocaleString('en-IN')}</p>
              </button>
              <div className="flex flex-wrap items-center justify-between gap-3 sm:justify-end">
                <div className="flex gap-4 text-right text-[11px]"><p><b className="block text-base tabular-nums text-[var(--ink)]">{unprinted.length}</b><span className="text-[var(--ink-4)]">unprinted</span></p><p><b className="block text-base tabular-nums text-[#a92f28]">{selectedCount}</b><span className="text-[var(--ink-4)]">in tray</span></p></div>
                <Button variant="outline" size="sm" onClick={()=>toggleJob(job)}>{expandedJobId===job.id?'Hide':'Review'}<ChevronDown className={`ml-2 h-4 w-4 transition ${expandedJobId===job.id?'rotate-180':''}`}/></Button>
              </div>
            </div>
            {expandedJobId===job.id?<div className="border-t border-[var(--line)] bg-[#f8f4f1] p-4">
              <div className="mb-3 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
                <div><p className="text-sm font-bold text-[var(--ink)]">Individual stickers</p><p className="mt-1 text-xs text-[var(--ink-4)]">Use this only when the complete job is not required.</p></div>
                <label className="text-xs font-semibold text-[var(--ink-4)] sm:w-72">Void reason<Input className="mt-1 bg-white" value={voidReason} onChange={(event)=>setVoidReason(event.target.value)}/></label>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">{(job.instances||[]).map((label:any)=>{
                const selected=selectedIds.has(label.id);
                const activeLabel=label.status==='active';
                return <div key={label.id} className={`flex items-start gap-3 rounded-xl border p-3 text-xs transition ${!activeLabel?'border-slate-200 bg-slate-100 text-slate-500':selected?'border-[#d48d81] bg-white ring-2 ring-[#a92f28]/10':'border-[#dfd5d0] bg-white'}`}>
                  <input aria-label={`Select label ${label.labelCode}`} className="mt-1 h-4 w-4 accent-[#a92f28]" type="checkbox" disabled={!activeLabel} checked={selected} onChange={(event)=>toggleTrayLabel(job,label,event.target.checked)}/>
                  <span className="min-w-0 flex-1"><b className="block truncate font-mono text-[var(--ink)]">{label.labelCode}</b><span className="mt-1 block truncate">{label.displaySample?.internalCode||label.product?.internalCode||label.product?.sku} · {label.lot?.lotNumber||label.displaySample?.sampleNumber||'Product identity'}</span><span className="mt-1 block text-[var(--ink-4)]">{Number(label.printCount||0)?`Printed ${label.printCount}×`:'Never printed'} · {label.status}</span></span>
                  {activeLabel?<button type="button" className="text-[10px] font-bold text-red-700 underline" disabled={!voidReason.trim()||voidLoading} onClick={()=>voidLabel({variables:{id:label.id,reason:voidReason}})}>Void</button>:null}
                </div>})}
              </div>
            </div>:null}
          </article>})}
      </div>
      {!loading&&!filteredJobs.length?<Empty icon={History} title="No matching labels" text="Change the print-state or label-type filters, or search for another job, QR, SKU, lot or display."/>:null}
      <div className="flex items-center justify-between border-t border-[var(--line)] bg-white p-4"><p className="text-xs text-[var(--ink-4)]">Page {page+1} · 20 jobs per page · tray selection is preserved</p><div className="flex gap-2"><Button aria-label="Previous label jobs" size="icon" variant="outline" disabled={page===0} onClick={()=>setPage((p:number)=>Math.max(0,p-1))}><ChevronLeft className="h-4 w-4"/></Button><Button aria-label="Next label jobs" size="icon" variant="outline" disabled={!hasNext} onClick={()=>setPage((p:number)=>p+1)}><ChevronRight className="h-4 w-4"/></Button></div></div>
    </div>

    <aside data-testid="bulk-print-tray" className="order-first xl:order-last xl:sticky xl:top-5">
      <div className="overflow-hidden rounded-[1.6rem] border border-[#3d2c2a] bg-[#251d1c] text-white shadow-[0_28px_70px_-38px_rgba(49,18,16,.9)]">
        <div className="border-b border-white/10 p-5">
          <div className="flex items-start justify-between gap-3"><div><p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.2em] text-[#e7a99d]"><Tags className="h-4 w-4"/>Print tray</p><h3 className="mt-2 text-2xl font-bold text-white">One run, many stickers</h3></div>{selectedLabels.length?<button type="button" aria-label="Clear print tray" onClick={clearTray} className="grid h-9 w-9 place-items-center rounded-full border border-white/15 text-white/70 transition hover:bg-white/10 hover:text-white"><Trash2 className="h-4 w-4"/></button>:null}</div>
          <div className="mt-5 grid grid-cols-3 gap-2">
            <TrayMetric testId="bulk-selected-count" label="Selected" value={selectedLabels.length}/>
            <TrayMetric label="Jobs" value={selectedJobGroups.length}/>
            <TrayMetric label="Pages" value={physicalPages}/>
          </div>
        </div>
        <div className="space-y-5 bg-[#fffaf7] p-5 text-[var(--ink)]">
          {physicalTemplate === 'thermal_4x2' ? <fieldset className="rounded-2xl border border-[#e2d5cf] bg-white p-4">
            <legend className="px-1 text-xs font-bold">Sticker orientation</legend>
            <div className="grid grid-cols-2 gap-2">
              {([['landscape','Landscape','4 × 2 in'],['portrait','Portrait','2 × 4 in']] as const).map(([value,label,size])=><label key={value} className="cursor-pointer">
                <input type="radio" name="label-orientation" value={value} checked={printOrientation===value} data-testid={`label-orientation-${value}`} onChange={()=>setPrintOrientation(value)} className="peer sr-only"/>
                <span className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-xl border border-[#e2d5cf] bg-white px-2 py-3 transition hover:border-[#b87468] peer-checked:border-[#a92f28] peer-checked:bg-[#fff3ef] peer-checked:ring-1 peer-checked:ring-[#a92f28] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[#a92f28]">
                  <span aria-hidden="true" className={`grid place-items-center rounded border-2 border-[#2b201f] bg-[#fffdfb] ${value==='landscape'?'h-7 w-14':'h-12 w-6'}`}><QrCode className="h-4 w-4"/></span>
                  <span className="text-center text-[11px] font-bold leading-4">{label}<small className="block text-[10px] font-semibold text-[var(--ink-4)]">{size}</small></span>
                </span>
              </label>)}
            </div>
            <p className="mt-3 text-[11px] leading-5 text-[var(--ink-3)]">Match the width and height of one sticker on the roll. This changes the actual print page, not just the preview.</p>
            <p className="mt-2 border-t border-[#eee2dc] pt-2 text-[10px] leading-4 text-[var(--ink-4)]">Printer: {printOrientation==='landscape'?'101.6 mm wide × 50.8 mm high':'50.8 mm wide × 101.6 mm high'} · 100% scale · all pages · 1 printer copy. Set extra copies below.</p>
          </fieldset> : null}
          <label className="block text-xs font-bold text-[var(--ink-3)]">Physical label template
            <select className="mt-1.5 h-11 w-full rounded-xl border border-[#d9cbc5] bg-white px-3 text-sm font-semibold" value={physicalTemplate} onChange={(event)=>setPhysicalTemplate(event.target.value)}>{templates.map((template:any)=><option key={`${template.code}-${template.version}`} value={template.code}>{template.name} · v{template.version}</option>)}</select>
          </label>
          <div>
            <p className="text-xs font-bold text-[var(--ink-3)]">Copies of every selected sticker</p>
            <div className="mt-1.5 grid grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] overflow-hidden rounded-xl border border-[#d9cbc5] bg-white">
              <button type="button" aria-label="Reduce copies" disabled={!validCopies||copyCount<=1} onClick={()=>setCopies(String(copyCount-1))} className="grid h-11 place-items-center border-r border-[#e4dad5] disabled:opacity-30"><Minus className="h-4 w-4"/></button>
              <Input aria-label="Copies of every selected sticker" aria-invalid={!validCopies} aria-describedby={!validCopies?'label-copies-error':undefined} data-testid="bulk-label-copies" className="h-11 rounded-none border-0 text-center text-base font-bold shadow-none focus-visible:ring-0" type="number" min={1} max={50} step={1} value={copies} onChange={(event)=>setCopies(event.target.value)}/>
              <button type="button" aria-label="Increase copies" disabled={!validCopies||copyCount>=50} onClick={()=>setCopies(String(copyCount+1))} className="grid h-11 place-items-center border-l border-[#e4dad5] disabled:opacity-30"><Plus className="h-4 w-4"/></button>
            </div>
            {!validCopies?<p id="label-copies-error" role="alert" className="mt-2 text-xs font-semibold text-red-700">Enter a whole number from 1 to 50.</p>:<p className="mt-2 text-[10px] leading-4 text-[var(--ink-4)]">{copyCount} cop{copyCount===1?'y':'ies'} of each label will be included in the print run. Leave printer-dialog copies at 1.</p>}
          </div>
          <div>
            <label className="text-xs font-bold text-[var(--ink-3)]">Why are these being printed?<Input className="mt-1.5 h-11 bg-white" value={printReason} onChange={(event)=>setPrintReason(event.target.value)} placeholder="Required for the audit trail"/></label>
            <div className="mt-2 flex flex-wrap gap-1.5">{['Operational bulk label print','Replace damaged labels','Stock relabelling'].map((reason)=><button type="button" key={reason} onClick={()=>setPrintReason(reason)} className="rounded-full border border-[#e0d2cc] bg-white px-2.5 py-1.5 text-[10px] font-semibold text-[var(--ink-3)] hover:border-[#b87468]">{reason}</button>)}</div>
          </div>
          <div>
            <div className="flex items-center justify-between"><p className="text-xs font-bold text-[var(--ink-3)]">Selected batches</p>{selectedLabels.length?<button type="button" onClick={clearTray} className="text-[10px] font-bold text-[#a92f28] underline">Clear all</button>:null}</div>
            <div className="mt-2 max-h-52 space-y-2 overflow-y-auto pr-1">{selectedJobGroups.map((group)=>{
              const first=group[0];
              return <div key={first.jobId} className="flex items-center gap-2 rounded-xl border border-[#e4d8d2] bg-white p-2.5"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#f2e5df] text-[#a92f28]"><Barcode className="h-4 w-4"/></span><span className="min-w-0 flex-1"><b className="block truncate font-mono text-[11px]">{first.jobNumber}</b><small className="block truncate text-[10px] text-[var(--ink-4)]">{first.source} · {group.length} selected</small></span><button type="button" aria-label={`Remove ${first.jobNumber} from tray`} onClick={()=>removeManyFromTray(group.map((label)=>label.id))} className="grid h-7 w-7 place-items-center rounded-full text-[var(--ink-4)] hover:bg-red-50 hover:text-red-700"><XCircle className="h-4 w-4"/></button></div>})}{!selectedLabels.length?<div className="rounded-xl border border-dashed border-[#d8c9c2] bg-[#fffdfb] p-4 text-center"><Tags className="mx-auto h-5 w-5 text-[#b79e95]"/><p className="mt-2 text-xs font-bold">Your tray is empty</p><p className="mt-1 text-[10px] leading-4 text-[var(--ink-4)]">Add a complete job, all matching labels, or review a job and pick individual stickers.</p></div>:null}</div>
          </div>
          {exceedsPageLimit?<p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs font-semibold leading-5 text-amber-900">This would create {physicalPages.toLocaleString('en-IN')} pages. Reduce the selection or copies to {MAX_PHYSICAL_PAGES} pages or fewer.</p>:null}
          <Button data-testid="bulk-print-prepare" className="h-12 w-full bg-[#a92f28] text-sm hover:bg-[#8d2722]" disabled={prepareLoading||!selectedLabels.length||!printReason.trim()||!validCopies||exceedsPageLimit} onClick={preparePrint}><Printer className="mr-2 h-4 w-4"/>{prepareLoading?'Preparing run…':!validCopies?'Enter whole-number copies':`Prepare ${physicalPages} sticker page${physicalPages===1?'':'s'}`}</Button>
          <p className="text-center text-[10px] leading-4 text-[var(--ink-4)]">Previewing does not change print counts. Confirm only after the printer completes the physical run.</p>
        </div>
      </div>
    </aside>
  </section>;
}
function TrayMetric({label,value,testId}:{label:string;value:number;testId?:string}) { return <div className="rounded-xl border border-white/10 bg-white/[.07] p-3"><p data-testid={testId} className="text-xl font-bold tabular-nums">{Number.isFinite(value)?value.toLocaleString('en-IN'):'—'}</p><p className="mt-1 text-[9px] font-bold uppercase tracking-wider text-white/45">{label}</p></div>; }
function HeroMetric({label,value}:{label:string;value:number}) { return <div className="rounded-2xl border border-white/10 bg-white/10 p-3 backdrop-blur"><p className="text-2xl font-bold tabular-nums">{Number(value||0).toLocaleString('en-IN')}</p><p className="mt-1 text-[10px] font-semibold leading-4 text-white/60">{label}</p></div>; }
function Empty({icon:Icon,title,text}:{icon:any;title:string;text:string}) { return <div className="grid min-h-52 place-items-center p-8 text-center"><div><span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[var(--bg-soft)]"><Icon className="h-6 w-6 text-[var(--ink-4)]"/></span><p className="mt-4 font-bold text-[var(--ink)]">{title}</p><p className="mx-auto mt-1 max-w-md text-sm leading-5 text-[var(--ink-4)]">{text}</p></div></div>; }
