'use client';

import { useMemo, useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import { Barcode, Box, CheckCircle2, Printer, QrCode, ScanLine, Store, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QueryErrorBanner } from '@/components/query-state';

const DATA = gql`query LabelDesk {
  internalLabelJobs(take: 80)
  inventoryLots(status: "active", take: 180)
  displaySamples(status: "active", take: 180)
}`;
const CREATE = gql`mutation CreateLabelJob($input: InternalLabelJobInput!) { createInternalLabelJob(input: $input) }`;
const PRINT = gql`mutation PrintLabelJob($id: ID!) { printInternalLabelJob(id: $id) }`;
const SCAN = gql`mutation ScanLabel($labelCode: String!, $input: InternalLabelScanInput) { scanInternalLabel(labelCode: $labelCode, input: $input) }`;
const VOID = gql`mutation VoidLabel($id: ID!, $reason: String!) { voidInternalLabel(id: $id, reason: $reason) }`;

export default function LabelDeskPage() {
  const [mode, setMode] = useState<'lot' | 'display'>('lot');
  const [sourceId, setSourceId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [scanCode, setScanCode] = useState('');
  const [scanResult, setScanResult] = useState<any>(null);
  const [printJob, setPrintJob] = useState<any>(null);
  const { data, error, refetch } = useQuery(DATA, { fetchPolicy: 'cache-and-network' });
  const [create, createState] = useMutation(CREATE, { onCompleted: () => refetch() });
  const [print, printState] = useMutation(PRINT, { onCompleted: (response) => { setPrintJob(response.printInternalLabelJob); refetch(); } });
  const [scan, scanState] = useMutation(SCAN, { onCompleted: (response) => setScanResult(response.scanInternalLabel) });
  const [voidLabel, voidState] = useMutation(VOID, { onCompleted: () => { refetch(); setPrintJob(null); } });
  const jobs = useMemo<any[]>(() => data?.internalLabelJobs || [], [data?.internalLabelJobs]);
  const lots = data?.inventoryLots || [];
  const displays = data?.displaySamples || [];
  const activeLabels = useMemo(() => jobs.flatMap((job: any) => job.instances || []).filter((label: any) => label.status === 'active').length, [jobs]);

  async function generate() {
    if (!sourceId) return;
    await create({ variables: { input: mode === 'lot' ? { lotId: sourceId, quantity: Number(quantity), template: 'stock_pack' } : { displaySampleId: sourceId, quantity: Number(quantity), template: 'display_sample' } } });
    setSourceId('');
    setQuantity('1');
  }

  return <div className="space-y-5 pb-10">
    {[error, createState.error, printState.error, scanState.error, voidState.error].filter(Boolean).map((item: any, index) => <QueryErrorBanner key={index} error={item}/>) }
    <header className="flex flex-col justify-between gap-4 border-b border-[var(--line)] pb-5 pt-2 lg:flex-row lg:items-end">
      <div><p className="text-xs font-semibold uppercase text-[var(--ink-4)]">Internal traceability</p><h1 className="mt-1 font-display text-3xl font-bold text-[var(--ink)]">Labels and QR scan desk</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-3)]">Non-GS1 labels identify the exact Product Master SKU, inward lot or showroom display. Reprints and every scan remain in the audit trail.</p></div>
      <div className="flex gap-6"><div><p className="text-2xl font-semibold tabular-nums text-[var(--ink)]">{jobs.length}</p><p className="text-xs text-[var(--ink-4)]">Label jobs</p></div><div><p className="text-2xl font-semibold tabular-nums text-emerald-700">{activeLabels}</p><p className="text-xs text-[var(--ink-4)]">Active labels</p></div></div>
    </header>

    <section className="grid gap-5 xl:grid-cols-[22rem_1fr]">
      <div className="space-y-5">
        <div className="mp-panel p-4"><div className="flex items-center gap-2"><QrCode className="h-5 w-5 text-[var(--brand-700)]"/><h2 className="font-semibold text-[var(--ink)]">Generate labels</h2></div><div className="mt-4 inline-flex rounded-md border border-[var(--line)] p-1"><button onClick={() => { setMode('lot'); setSourceId(''); }} className={`h-9 rounded px-3 text-sm font-semibold ${mode === 'lot' ? 'bg-[var(--ink)] text-white' : 'text-[var(--ink-3)]'}`}><Box className="mr-2 inline h-4 w-4"/>Stock lot</button><button onClick={() => { setMode('display'); setSourceId(''); }} className={`h-9 rounded px-3 text-sm font-semibold ${mode === 'display' ? 'bg-[var(--ink)] text-white' : 'text-[var(--ink-3)]'}`}><Store className="mr-2 inline h-4 w-4"/>Display</button></div><label className="mt-4 block text-xs font-semibold text-[var(--ink-4)]">Source<select value={sourceId} onChange={(event) => setSourceId(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-[var(--line)] bg-[var(--bg-soft)] px-3 text-sm"><option value="">Select {mode === 'lot' ? 'lot' : 'display'}</option>{mode === 'lot' ? lots.map((lot: any) => <option key={lot.id} value={lot.id}>{lot.product?.internalCode || lot.product?.sku} · {lot.lotNumber}</option>) : displays.map((display: any) => <option key={display.id} value={display.id}>{display.internalCode} · {display.product?.name}</option>)}</select></label><label className="mt-3 block text-xs font-semibold text-[var(--ink-4)]">Number of labels<Input className="mt-1" type="number" min={1} max={500} value={quantity} onChange={(event) => setQuantity(event.target.value)}/></label><Button className="mt-4 w-full" disabled={createState.loading || !sourceId || Number(quantity) < 1} onClick={generate}><Barcode className="mr-2 h-4 w-4"/>Generate</Button></div>
        <div className="mp-panel p-4"><div className="flex items-center gap-2"><ScanLine className="h-5 w-5 text-[var(--brand-700)]"/><h2 className="font-semibold text-[var(--ink)]">Scan / type code</h2></div><div className="mt-4 flex gap-2"><Input autoCapitalize="characters" value={scanCode} onChange={(event) => setScanCode(event.target.value.toUpperCase())} placeholder="LB/2026/0001-0001"/><Button title="Lookup label" disabled={scanState.loading || !scanCode} onClick={() => scan({ variables: { labelCode: scanCode, input: { action: 'stock_lookup' } } })}><ScanLine className="h-4 w-4"/></Button></div>{scanResult ? <div className={`mt-4 rounded-md border p-3 ${scanResult.result === 'success' ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}><div className="flex items-center gap-2">{scanResult.result === 'success' ? <CheckCircle2 className="h-4 w-4 text-emerald-700"/> : <XCircle className="h-4 w-4 text-red-700"/>}<p className="text-sm font-semibold text-[var(--ink)]">{scanResult.result.replace('_', ' ')}</p></div>{scanResult.label ? <div className="mt-3 text-xs leading-5 text-[var(--ink-3)]"><p><b>{scanResult.label.product?.internalCode || scanResult.label.product?.sku}</b> · {scanResult.label.product?.name}</p><p>{scanResult.label.lot?.lotNumber || scanResult.label.displaySample?.sampleNumber}</p></div> : null}</div> : null}</div>
      </div>

      <div className="mp-panel overflow-hidden"><div className="border-b border-[var(--line)] p-4"><h2 className="font-semibold text-[var(--ink)]">Label jobs</h2><p className="mt-1 text-xs text-[var(--ink-4)]">Print opens an exact preview and increments the reprint counter.</p></div><div className="divide-y divide-[var(--line)]">{jobs.map((job: any) => <div key={job.id} className="grid gap-3 p-4 md:grid-cols-[1fr_auto_auto] md:items-center"><div><div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-[var(--ink)]">{job.jobNumber}</p><span className="rounded bg-[var(--bg-soft)] px-2 py-1 text-xs font-semibold">{job.template.replace('_', ' ')}</span></div><p className="mt-1 text-xs text-[var(--ink-4)]">{job.quantity} labels · {job.sourceType.replace('_', ' ')} · {new Date(job.requestedAt).toLocaleString('en-IN')}</p></div><p className="text-xs font-medium text-[var(--ink-3)]">Printed {Math.max(0, ...(job.instances || []).map((item: any) => item.printCount || 0))}×</p><Button variant="outline" disabled={printState.loading} onClick={() => print({ variables: { id: job.id } })}><Printer className="mr-2 h-4 w-4"/>Print</Button></div>)}</div></div>
    </section>

    {printJob ? <section className="mp-panel overflow-hidden print:border-0 print:shadow-none"><div className="flex items-center justify-between border-b border-[var(--line)] p-4 print:hidden"><div><h2 className="font-semibold text-[var(--ink)]">Print preview · {printJob.jobNumber}</h2><p className="text-xs text-[var(--ink-4)]">Use the browser print dialog for A4 label sheets or a label printer.</p></div><div className="flex gap-2"><Button variant="outline" onClick={() => setPrintJob(null)}>Close</Button><Button onClick={() => window.print()}><Printer className="mr-2 h-4 w-4"/>Print now</Button></div></div><div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-3 print:p-0">{(printJob.labels || []).map((label: any) => <article key={label.id} className="break-inside-avoid rounded-md border border-black/20 p-3 text-black"><div className="flex gap-3"><img src={label.qrDataUrl} alt={`QR ${label.labelCode}`} className="h-24 w-24"/><div className="min-w-0 text-[10px] leading-4"><p className="text-xs font-bold">{label.payload.internalCode || label.payload.sku}</p><p className="line-clamp-2">{label.payload.productName}</p><p>{label.payload.dimensions}</p><p>{label.payload.lotNumber || label.payload.displaySample}</p><p className="mt-1 font-mono text-[9px]">{label.labelCode}</p></div></div>{label.status === 'active' ? <button className="mt-2 text-[10px] text-red-700 print:hidden" onClick={() => { const reason = window.prompt('Reason to void this label'); if (reason) voidLabel({ variables: { id: label.id, reason } }); }}>Void label</button> : null}</article>)}</div></section> : null}
  </div>;
}
