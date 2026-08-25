'use client';

import { use, useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import { CheckCircle2, Printer, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryErrorBanner } from '@/components/query-state';

const RUN = gql`query LabelPrintRun($id: ID!) { internalLabelPrintRun(id: $id) }`;
const CONFIRM = gql`mutation ConfirmLabelPrint($id: ID!) { confirmInternalLabelPrintRun(id: $id) }`;
const CANCEL = gql`mutation CancelLabelPrint($id: ID!, $reason: String!) { cancelInternalLabelPrintRun(id: $id, reason: $reason) }`;

export default function LabelPrintPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = use(params);
  const [dialogOpened, setDialogOpened] = useState(false);
  const [decision, setDecision] = useState('');
  const [cancelReason, setCancelReason] = useState('Browser print dialog cancelled or printer did not complete');
  const { data, loading, error } = useQuery(RUN, { variables: { id: runId }, fetchPolicy: 'network-only' });
  const [confirm, confirmState] = useMutation(CONFIRM, { onCompleted: () => setDecision('confirmed') });
  const [cancel, cancelState] = useMutation(CANCEL, { onCompleted: () => setDecision('cancelled') });
  const run = data?.internalLabelPrintRun;
  const template = run?.template || {};
  const labels = run?.labels || [];
  const pageWidth = Number(template.pageWidthMm || template.widthMm || 210);
  const pageHeight = Number(template.pageHeightMm || template.heightMm || 297);
  const columns = Number(template.columns || 1);
  const printCss = `
    @page { size: ${pageWidth}mm ${pageHeight}mm; margin: 0; }
    :root .label-sheet, :root .label-sheet article,
    :root.dark .label-sheet, :root.dark .label-sheet article { background: #fff !important; color: #000 !important; }
    @media screen {
      .print-controls { background: #202126 !important; color: #fff !important; }
      .print-meta { color: #cbd5e1 !important; }
      .print-steps { background: #f8f5f3 !important; color: #171717 !important; }
    }
    @media print {
      html, body { width: ${pageWidth}mm !important; min-height: ${pageHeight}mm !important; margin: 0 !important; padding: 0 !important; background: white !important; color: black !important; }
      .print-controls { display: none !important; }
      .label-sheet { box-shadow: none !important; margin: 0 !important; }
    }
  `;
  if (loading) return <div className="grid min-h-screen place-items-center bg-white text-black">Preparing exact-size labels…</div>;
  return <main className="min-h-screen bg-[#f4f1ef] p-4 text-black print:bg-white print:p-0">
    <style dangerouslySetInnerHTML={{__html:printCss}}/>
    {error?<div className="print-controls mx-auto max-w-3xl"><QueryErrorBanner error={error}/></div>:null}
    <section className="print-controls mx-auto mb-5 max-w-5xl overflow-hidden rounded-2xl border border-[#e4d8d3] shadow-[0_24px_70px_-48px_rgba(73,32,28,.7)]"><div className="h-1.5 bg-[linear-gradient(90deg,#2a201f,#a92f28,#d77761)]"/><div className="p-5 sm:p-6"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><p className="text-xs font-bold uppercase tracking-[.16em] text-[#e38a7f]">Isolated physical print · {run?.runNumber}</p><h1 className="mt-2 text-2xl font-black">{template.name}</h1><p className="print-meta mt-1 text-sm">{labels.length} rendered label{labels.length===1?'':'s'} · exact {template.widthMm} × {template.heightMm} mm cells · QR contains the real MP-LABEL identity.</p></div><Button className="bg-[#a92f28] hover:bg-[#8d2722]" disabled={decision==='confirmed'||decision==='cancelled'} onClick={()=>{setDialogOpened(true);window.print();}}><Printer className="mr-2 h-4 w-4"/>Open print dialog</Button></div><div className="print-steps mt-4 grid gap-2 rounded-xl p-3 text-xs sm:grid-cols-3"><p><b>1 · Preview</b><br/>Confirm product, lot and label stock.</p><p><b>2 · Print</b><br/>Only the white sheet below is sent.</p><p><b>3 · Audit</b><br/>Confirm only after physical output succeeds.</p></div>
      {dialogOpened&&!decision?<div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4"><p className="font-bold text-blue-950">Did the printer complete this run?</p><p className="mt-1 text-xs text-blue-800">Confirm only after physical output succeeds. If the dialog was cancelled or printing failed, cancel the run; label print counts remain unchanged.</p><div className="mt-3 flex flex-col gap-2 sm:flex-row"><Button disabled={confirmState.loading} onClick={()=>confirm({variables:{id:runId}})}><CheckCircle2 className="mr-2 h-4 w-4"/>Confirm printed</Button><input value={cancelReason} onChange={(event)=>setCancelReason(event.target.value)} className="h-10 flex-1 rounded-md border border-blue-200 bg-white px-3 text-sm"/><Button variant="outline" disabled={cancelState.loading||!cancelReason.trim()} onClick={()=>cancel({variables:{id:runId,reason:cancelReason}})}><XCircle className="mr-2 h-4 w-4"/>Cancel / failed</Button></div></div>:null}
      {decision?<div className={`mt-4 rounded-lg p-3 text-sm font-bold ${decision==='confirmed'?'bg-emerald-50 text-emerald-800':'bg-amber-50 text-amber-800'}`}>{decision==='confirmed'?'Print confirmed and audited. Reprinting will create a new run.':'Run cancelled; no label print counts were changed.'}</div>:null}</div>
    </section>
    <section className="label-sheet mx-auto grid bg-white shadow-xl" style={{width:`${pageWidth}mm`,minHeight:`${pageHeight}mm`,gridTemplateColumns:`repeat(${columns}, ${Number(template.widthMm||70)}mm)`,gridAutoRows:`${Number(template.heightMm||37)}mm`,columnGap:`${Number(template.gapXMm||0)}mm`,rowGap:`${Number(template.gapYMm||0)}mm`,padding:`${Number(template.marginTopMm||0)}mm ${Number(template.marginRightMm||0)}mm ${Number(template.marginBottomMm||0)}mm ${Number(template.marginLeftMm||0)}mm`}}>
      {labels.map((label:any,index:number)=><article key={`${label.id}-${label.copyIndex}-${index}`} className="overflow-hidden border border-black/30 bg-white p-[1.6mm] text-black [break-inside:avoid]" style={{width:`${Number(template.widthMm||70)}mm`,height:`${Number(template.heightMm||37)}mm`}}><div className="flex h-full items-center gap-[1.6mm]"><div className="shrink-0"><img src={label.qrDataUrl} alt={`QR ${label.labelCode}`} className="h-[23mm] w-[23mm]"/><p className="mt-[.4mm] text-center font-mono text-[5.6pt] font-bold">{label.labelCode}</p></div><div className="min-w-0 flex-1 text-[7pt] leading-[1.14]"><div className="mb-[.6mm] flex items-center justify-between border-b border-black/25 pb-[.5mm]"><p className="truncate text-[9.3pt] font-black">{label.payload.productCode||label.payload.internalCode||label.payload.sku}</p><span className="ml-1 rounded bg-[#a92f28] px-[1.2mm] py-[.3mm] text-[5.5pt] font-black tracking-wide text-white">MP</span></div><p className="line-clamp-2 font-bold">{label.payload.productName}</p><p className="truncate">{[label.payload.brandCode||label.payload.brand,label.payload.dimensions,label.payload.finish].filter(Boolean).join(' · ')}</p><p className="mt-[.6mm] truncate text-[8pt] font-black">MRP ₹{Number(label.payload.mrpInclusive||0).toLocaleString('en-IN',{maximumFractionDigits:2})} / {String(label.payload.priceUom||'PC').toUpperCase()}</p><p className="mt-[.4mm] truncate font-black">{label.payload.lotNumber||label.payload.displaySample||'PRODUCT / SHELF'}</p>{label.payload.sourceDocument?<p className="truncate">{label.payload.sourceDocument}{label.payload.locations?.length?` · ${label.payload.locations.join(', ')}`:''}</p>:null}</div></div></article>)}
    </section>
  </main>;
}
