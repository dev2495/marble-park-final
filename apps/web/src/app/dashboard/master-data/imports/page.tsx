'use client';

import { useEffect, useMemo, useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import { ClipboardCheck, Database, Eye, UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const DATA = gql`query { importBatches }`;
const MASTER_DATA = gql`query { masterProductCategories(status: "active") masterProductBrands(status: "active") masterProductFinishes(status: "active") }`;
const ROWS = gql`query($importBatchId: String!) { importRows(importBatchId: $importBatchId) }`;
const PROCESS_PDF = gql`mutation($filePath: String!) { processPdfImport(filePath: $filePath) { id result } }`;
const PROCESS_EXCEL = gql`mutation($filePath: String!) { processExcelImport(filePath: $filePath) { id result } }`;
const UPDATE_ROW = gql`mutation($id: String!, $input: UpdateImportRowInput!) { updateImportRow(id: $id, input: $input) { id result } }`;
const SUBMIT = gql`mutation($importBatchId: String!) { submitImportBatchForApproval(importBatchId: $importBatchId) { id result } }`;
const APPLY = gql`mutation($importBatchId: String!) { applyImportBatch(importBatchId: $importBatchId) { id result } }`;

function names(rows: any[] | undefined, fallback: string[]) {
  const values = (rows || []).map((row: any) => typeof row === 'string' ? row : row?.name).filter(Boolean);
  return Array.from(new Set(values.length ? values : fallback));
}

function rowValue(row: any, key: string) {
  return row?.normalized?.[key] ?? row?.[key] ?? '';
}

export default function ImportCenterPage() {
  const { data, refetch, loading } = useQuery(DATA);
  const { data: masterData } = useQuery(MASTER_DATA);
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const { data: rowData, refetch: refetchRows } = useQuery(ROWS, { variables: { importBatchId: selectedBatchId }, skip: !selectedBatchId });
  const [drafts, setDrafts] = useState<Record<string, any>>({});
  const [status, setStatus] = useState('');
  const [processPdf] = useMutation(PROCESS_PDF, { onCompleted: (result) => { refetch(); const id = result?.processPdfImport?.result?.importBatchId; if (id) setSelectedBatchId(id); } });
  const [processExcel] = useMutation(PROCESS_EXCEL, { onCompleted: (result) => { refetch(); const id = result?.processExcelImport?.result?.importBatchId; if (id) setSelectedBatchId(id); } });
  const [updateRow, { loading: savingRow }] = useMutation(UPDATE_ROW, { onCompleted: () => { refetch(); refetchRows(); setStatus('Row review saved.'); } });
  const [submit] = useMutation(SUBMIT, { onCompleted: () => { refetch(); setStatus('Submitted to owner approval.'); }, onError: (error) => setStatus(error.message) });
  const [apply] = useMutation(APPLY, { onCompleted: () => { refetch(); refetchRows(); setStatus('Approved import applied to product master.'); }, onError: (error) => setStatus(error.message) });
  const batches = data?.importBatches || [];
  const rows = rowData?.importRows || [];
  const categories = names(masterData?.masterProductCategories, ['Catalogue Products']);
  const brands = names(masterData?.masterProductBrands, ['Imported PDF']);
  const finishes = names(masterData?.masterProductFinishes, ['Standard']);
  const selectedBatch = batches.find((batch: any) => batch.id === selectedBatchId);
  const needsReview = useMemo(() => rows.filter((row: any) => row.status === 'needs_review').length, [rows]);

  useEffect(() => {
    if (!selectedBatchId && batches[0]?.id) setSelectedBatchId(batches[0].id);
  }, [batches, selectedBatchId]);

  function draftFor(row: any) {
    return drafts[row.id] || {
      sku: rowValue(row, 'sku') || row.sku || '',
      name: rowValue(row, 'name') || row.description || '',
      category: rowValue(row, 'category') || row.categoryCode || '',
      brand: rowValue(row, 'brand') || row.brand || '',
      finish: rowValue(row, 'finish') || '',
      sellPrice: Number(rowValue(row, 'sellPrice') || row.newMrp || 0),
      dimensions: rowValue(row, 'dimensions') || '',
      description: rowValue(row, 'description') || row.description || '',
    };
  }

  function setDraft(row: any, patch: any) {
    setDrafts((current) => ({ ...current, [row.id]: { ...draftFor(row), ...patch } }));
  }

  return <div className="space-y-7 pb-10">
    <section className="rounded-[2.25rem] bg-[#211b16] p-7 text-white shadow-2xl shadow-[#211b16]/15"><p className="text-[10px] font-black uppercase tracking-[0.26em] text-[#e8c39b]">Import center</p><h1 className="mt-3 text-5xl font-black tracking-[-0.05em]">PDF and Excel imports with mandatory master-data review.</h1><p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-[#d9c4a9]">Uploads are staged first. Missing brand, category or finish must be resolved here before owner approval and product-master apply.</p></section>

    <section className="grid gap-6 xl:grid-cols-[0.72fr_1.28fr]">
      <div className="space-y-5">
        <div className="mp-card rounded-[2rem] p-6"><Database className="h-8 w-8 text-[#b57942]" /><h2 className="mt-4 text-2xl font-black text-[#211b16]">Upload catalogue</h2><p className="mt-2 text-sm font-bold text-[#8b6b4c]">PDF imports also stage extracted images into Image Review for owner-approved mapping.</p><input type="file" accept=".pdf,.xlsx,.xls" className="mt-5 block w-full text-sm font-bold" onChange={async (e) => { const file=e.target.files?.[0]; if(!file) return; setStatus('Uploading...'); const fd=new FormData(); fd.append('file', file); const upload=await fetch('/api/upload',{method:'POST', body:fd}).then(r=>r.json()); setStatus('Staging rows and extracting images where possible...'); if(file.name.toLowerCase().endsWith('.pdf')) await processPdf({variables:{filePath: upload.filePath}}); else await processExcel({variables:{filePath: upload.filePath}}); setStatus('Staged. Review rows below before approval.'); e.target.value=''; }} />{status && <p className="mt-4 rounded-2xl bg-[#ead7c0]/70 p-3 text-xs font-black uppercase tracking-wider text-[#7a4f2e]">{status}</p>}</div>
        <div className="mp-card rounded-[2rem] p-6"><h2 className="text-2xl font-black text-[#211b16]">Batches</h2><div className="mt-5 space-y-3">{loading && <p className="text-sm font-bold text-[#8b6b4c]">Loading...</p>}{batches.map((batch:any)=><article key={batch.id} className={`rounded-[1.4rem] p-4 ${selectedBatchId===batch.id?'bg-[#211b16] text-white':'bg-white/75 text-[#211b16]'}`}><button className="w-full text-left" onClick={()=>setSelectedBatchId(batch.id)}><p className="font-black">{batch.brand || 'Mixed'} · {batch.rowCount} rows</p><p className={`text-xs font-bold ${selectedBatchId===batch.id?'text-[#d9c4a9]':'text-[#8b6b4c]'}`}>{batch.status} · review {batch.summary?.needsReview ?? 0} · ready {batch.summary?.ready ?? 0}</p></button></article>)}</div></div>
      </div>

      <div className="mp-card rounded-[2rem] p-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#8b6b4c]">Batch review</p><h2 className="text-2xl font-black text-[#211b16]">{selectedBatch ? `${selectedBatch.brand || 'Mixed'} import` : 'Select an import batch'}</h2><p className="mt-1 text-xs font-bold text-[#8b6b4c]">{needsReview} row(s) need master data before owner approval.</p></div><div className="flex gap-2">{selectedBatch?.status==='pending_review'&&<Button disabled={needsReview>0} variant="warning" onClick={()=>submit({variables:{importBatchId:selectedBatch.id}})}><UploadCloud className="mr-2 h-4 w-4" /> Submit</Button>}{selectedBatch?.status==='approved'&&<Button onClick={()=>apply({variables:{importBatchId:selectedBatch.id}})}><ClipboardCheck className="mr-2 h-4 w-4" /> Apply</Button>}</div></div>
        <div className="mt-5 max-h-[54rem] space-y-3 overflow-y-auto pr-1 custom-scrollbar">{rows.map((row:any)=>{ const draft=draftFor(row); return <article key={row.id} className={`rounded-[1.5rem] border p-4 ${row.status==='needs_review'?'border-[#c76f38]/40 bg-[#fff2e8]':'border-white/70 bg-white/75'}`}><div className="flex items-start justify-between gap-3"><div><p className="font-black text-[#211b16]">{draft.sku || 'Missing SKU'} · {draft.name || 'Missing name'}</p><p className="text-xs font-bold text-[#8b6b4c]">{row.status} · ₹{Number(draft.sellPrice || 0).toLocaleString('en-IN')}</p></div><span className="rounded-full bg-[#211b16] px-3 py-1 text-[10px] font-black uppercase tracking-wider text-white">{row.status}</span></div><div className="mt-4 grid gap-3 lg:grid-cols-3"><label className="space-y-1"><span className="text-[10px] font-black uppercase tracking-wider text-[#8b6b4c]">SKU</span><Input value={draft.sku} onChange={(e)=>setDraft(row,{sku:e.target.value})}/></label><label className="space-y-1 lg:col-span-2"><span className="text-[10px] font-black uppercase tracking-wider text-[#8b6b4c]">Name</span><Input value={draft.name} onChange={(e)=>setDraft(row,{name:e.target.value})}/></label><label className="space-y-1"><span className="text-[10px] font-black uppercase tracking-wider text-[#8b6b4c]">Brand</span><select value={draft.brand || ''} onChange={(e)=>setDraft(row,{brand:e.target.value})} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-bold"><option value="">Select brand</option>{brands.map((item:string)=><option key={item} value={item}>{item}</option>)}</select></label><label className="space-y-1"><span className="text-[10px] font-black uppercase tracking-wider text-[#8b6b4c]">Category</span><select value={draft.category || ''} onChange={(e)=>setDraft(row,{category:e.target.value})} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-bold"><option value="">Select category</option>{categories.map((item:string)=><option key={item} value={item}>{item}</option>)}</select></label><label className="space-y-1"><span className="text-[10px] font-black uppercase tracking-wider text-[#8b6b4c]">Finish</span><select value={draft.finish || ''} onChange={(e)=>setDraft(row,{finish:e.target.value})} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-bold"><option value="">Select finish</option>{finishes.map((item:string)=><option key={item} value={item}>{item}</option>)}</select></label><label className="space-y-1"><span className="text-[10px] font-black uppercase tracking-wider text-[#8b6b4c]">MRP</span><Input type="number" value={draft.sellPrice} onChange={(e)=>setDraft(row,{sellPrice:Number(e.target.value)})}/></label><label className="space-y-1 lg:col-span-2"><span className="text-[10px] font-black uppercase tracking-wider text-[#8b6b4c]">Dimensions</span><Input value={draft.dimensions} onChange={(e)=>setDraft(row,{dimensions:e.target.value})}/></label></div><div className="mt-4 flex justify-end"><Button size="sm" disabled={savingRow} onClick={()=>updateRow({variables:{id:row.id,input:draft}})}><Eye className="mr-2 h-4 w-4"/>Save review</Button></div></article>})}{selectedBatchId && !rows.length && <p className="rounded-2xl bg-white/70 p-4 text-sm font-bold text-[#8b6b4c]">No rows available for this batch.</p>}</div>
      </div>
    </section>
  </div>;
}
