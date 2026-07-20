'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { gql, useLazyQuery, useMutation, useQuery } from '@apollo/client';
import { AlertTriangle, CheckCircle2, Circle, Download, Eye, FileSpreadsheet, Image as ImageIcon, PackagePlus, Pencil, RefreshCcw, Save, ShieldCheck, UploadCloud, Warehouse, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryErrorBanner, QueryLoading } from '@/components/query-state';

const BEGIN_UPLOAD = gql`mutation($filename: String!) { beginImportUpload(filename: $filename) { id result } }`;
const APPEND_UPLOAD = gql`mutation($uploadId: String!, $filename: String!, $contentBase64: String!) { appendImportUpload(uploadId: $uploadId, filename: $filename, contentBase64: $contentBase64) { id result } }`;
const CANCEL_UPLOAD = gql`mutation($uploadId: String!, $filename: String!) { cancelImportUpload(uploadId: $uploadId, filename: $filename) { id result } }`;
const PREVIEW_UPLOAD = gql`mutation($uploadId: String!, $filename: String!, $kind: String!, $reviewRows: JSON) { previewUploadedImport(uploadId: $uploadId, filename: $filename, kind: $kind, reviewRows: $reviewRows) { id result } }`;
const APPLY_UPLOAD = gql`mutation($uploadId: String!, $filename: String!, $kind: String!, $confirmationToken: String!, $reviewRows: JSON) { applyUploadedImport(uploadId: $uploadId, filename: $filename, kind: $kind, confirmationToken: $confirmationToken, reviewRows: $reviewRows) { id result } }`;
const TEMPLATE = gql`query ProductImportTemplate { productImportTemplate }`;
const READINESS = gql`query ProductImportReadiness { productImportReadiness }`;

const inputClass = 'h-10 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] outline-none focus:border-[var(--brand-500)]';
const requiredReviewFields = new Set(['SKU', 'Unique internal code', 'Product name', 'Category', 'Brand', 'Finish', 'Tax code']);

async function blobToBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  return btoa(binary);
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return <div className="rounded-r4 border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm-soft"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-5)]">{label}</p><p className="mt-2 font-display text-3xl font-bold tabular-nums text-[var(--ink)]">{value}</p></div>;
}

function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  const displayLabel = requiredReviewFields.has(label) ? `${label} *` : `${label} (optional)`;
  return <label className={wide ? 'space-y-1.5 md:col-span-2' : 'space-y-1.5'}><span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-5)]">{displayLabel}</span>{children}</label>;
}

function SelectField({ value, options, onChange, placeholder }: { value: string; options: string[]; onChange: (value: string) => void; placeholder: string }) {
  const displayPlaceholder = placeholder === 'Required for tiles' ? 'Optional tile size' : placeholder;
  return <select className={inputClass} value={value || ''} onChange={(event) => onChange(event.target.value)}><option value="">{displayPlaceholder}</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select>;
}

function editableRow(row: any) {
  const provided = row.provided || {};
  return {
    sheet: row.sheet, rowNumber: row.rowNumber, sku: row.sku || '', internalCode: provided.internalCode === false ? '' : row.internalCode || '', name: row.name || '',
    category: row.category || '', brand: row.brand || '', finish: row.finish || '', material: row.material || '', dimensions: row.dimensions || '',
    baseUom: provided.baseUom === false ? '' : row.baseUom || '', purchaseUom: provided.purchaseUom === false ? '' : row.purchaseUom || '',
    salesUom: provided.salesUom === false ? '' : row.salesUom || '', piecesPerPack: provided.piecesPerPack === false ? '' : row.piecesPerPack ?? '',
    coveragePerPack: provided.coveragePerPack === false ? '' : row.coveragePerPack ?? '', sellPrice: provided.sellPrice === false ? '' : row.sellPrice ?? '',
    floorPrice: provided.floorPrice === false ? '' : row.floorPrice ?? '', taxClass: provided.taxClass === false ? '' : row.taxClass || '',
    hsnCode: row.hsnCode || '', allowLoose: provided.allowLoose === false ? '' : row.allowLoose ? 'Yes' : 'No', range: row.range || '', imageUrl: row.imageUrl || '', description: row.description || '',
  };
}

export default function ImportCenterPage() {
  const [status, setStatus] = useState('');
  const [upload, setUpload] = useState<{ uploadId: string; filename: string } | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [reviewRows, setReviewRows] = useState<any[]>([]);
  const [editing, setEditing] = useState('');
  const [reviewDirty, setReviewDirty] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [templateInfo, setTemplateInfo] = useState<any>(null);
  const readinessState = useQuery(READINESS, { fetchPolicy: 'network-only' });
  const readiness = readinessState.data?.productImportReadiness;
  const [beginUpload] = useMutation(BEGIN_UPLOAD);
  const [appendUpload] = useMutation(APPEND_UPLOAD);
  const [cancelUpload] = useMutation(CANCEL_UPLOAD);
  const [previewUpload, previewState] = useMutation(PREVIEW_UPLOAD, {
    onCompleted: (response) => {
      const next = response?.previewUploadedImport?.result;
      if (!next) return;
      setPreview(next); setResult(null); setReviewed(false); setReviewDirty(false); setEditing('');
      setReviewRows((next.previewRows || []).map(editableRow));
      setStatus(next.message || (next.failed ? 'Correct the highlighted rows and revalidate.' : 'Review is valid. Confirm when every row is correct.'));
    },
    onError: (error) => setStatus(error.message),
  });
  const [applyUpload, applyState] = useMutation(APPLY_UPLOAD, {
    onCompleted: (response) => {
      const next = response?.applyUploadedImport?.result;
      if (!next) return;
      setResult(next); setReviewed(false);
      if (next.status === 'applied') setPreview(null);
      setStatus(next.status === 'applied' ? `${next.created} Product Master SKU${next.created === 1 ? '' : 's'} created with zero stock.` : next.message || 'Import did not apply.');
      void readinessState.refetch();
    },
    onError: (error) => setStatus(error.message),
  });
  const [loadTemplate, templateState] = useLazyQuery(TEMPLATE, { fetchPolicy: 'no-cache' });

  const active = result || preview;
  const options = preview?.masterOptions || readiness?.options || {};
  const isBusy = previewState.loading || applyState.loading;
  const canApply = Boolean(upload && preview?.confirmationToken && !preview.failed && !reviewDirty && preview.total > 0 && reviewed && !result);
  const currentStep = result?.status === 'applied' ? 4 : preview ? 3 : upload ? 2 : 1;
  const rowLabel = `${preview?.total || 0} ${preview?.total === 1 ? 'row' : 'rows'}`;
  const skuLabel = `${preview?.created || 0} ${preview?.created === 1 ? 'SKU' : 'SKUs'}`;
  const statusTone = result?.status === 'applied' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : preview?.failed || reviewDirty ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-[var(--line)] bg-[var(--surface)] text-[var(--ink-2)]';

  function updateRow(index: number, field: string, value: any) {
    setReviewRows((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row));
    setReviewDirty(true); setReviewed(false);
  }

  async function downloadTemplate() {
    if (!readiness?.ready) { setStatus(readiness?.message || 'Complete required master data first.'); return; }
    const response = await loadTemplate();
    const file = response.data?.productImportTemplate;
    if (!file?.contentBase64) return;
    setTemplateInfo(file);
    const bytes = Uint8Array.from(atob(file.contentBase64), (character) => character.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: file.mimeType }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = file.filename; anchor.click(); URL.revokeObjectURL(url);
    setStatus(`Fresh template downloaded from live masters at ${new Date(file.generatedAt).toLocaleTimeString('en-IN')}.`);
  }

  async function uploadAndPreview(file: File) {
    if (!readiness?.ready) throw new Error(readiness?.message || 'Complete required master data before importing SKUs.');
    if (!/\.xlsx$/i.test(file.name)) throw new Error('Only .xlsx Product Master workbooks are supported.');
    if (!file.size || file.size > 25 * 1024 * 1024) throw new Error('Choose a non-empty .xlsx workbook smaller than 25 MB.');
    if (upload) await cancelUpload({ variables: upload }).catch(() => null);
    setPreview(null); setResult(null); setUpload(null); setReviewRows([]); setReviewed(false); setReviewDirty(false); setStatus('Creating secure upload session...');
    const begin = await beginUpload({ variables: { filename: file.name } });
    const uploadId = begin.data?.beginImportUpload?.result?.uploadId;
    if (!uploadId) throw new Error('Upload session was not created. Retry the upload.');
    const chunkSize = 512 * 1024;
    for (let offset = 0; offset < file.size; offset += chunkSize) {
      await appendUpload({ variables: { uploadId, filename: file.name, contentBase64: await blobToBase64(file.slice(offset, offset + chunkSize)) } });
      setStatus(`Uploading ${Math.min(100, Math.round(((offset + chunkSize) / file.size) * 100))}%...`);
    }
    setUpload({ uploadId, filename: file.name }); setStatus('Reading Product Master rows...');
    await previewUpload({ variables: { uploadId, filename: file.name, kind: 'excel', reviewRows: null } });
  }

  async function revalidateReview() {
    if (!upload || !reviewRows.length) return;
    setStatus('Revalidating edited rows against live master data...');
    await previewUpload({ variables: { ...upload, kind: 'excel', reviewRows } });
  }

  async function applyPreview() {
    if (!canApply || !upload) return;
    setStatus('Creating confirmed SKUs atomically...');
    await applyUpload({ variables: { ...upload, kind: 'excel', confirmationToken: preview.confirmationToken, reviewRows } });
  }

  async function discardPreview() {
    if (upload) await cancelUpload({ variables: upload }).catch(() => null);
    setPreview(null); setResult(null); setUpload(null); setReviewRows([]); setReviewed(false); setReviewDirty(false); setEditing(''); setStatus('Preview discarded. Choose a fresh workbook when ready.');
  }

  return <div className="space-y-6 pb-10">
    {readinessState.error ? <QueryErrorBanner error={readinessState.error} onRetry={() => readinessState.refetch()} /> : null}
    {previewState.error ? <QueryErrorBanner error={previewState.error} onRetry={reviewDirty ? revalidateReview : undefined} /> : null}
    {applyState.error ? <QueryErrorBanner error={applyState.error} onRetry={applyPreview} /> : null}

    <section className="mp-card rounded-r6 border border-[var(--line)] p-6"><div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end"><div><p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--ink-4)]">Governed Product Master import</p><h1 className="mt-3 font-display text-4xl font-bold text-[var(--ink)]">Bulk-create saleable SKUs, review every value first.</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--ink-3)]">Complete master data, download the latest live workbook, upload once, correct rows in review, revalidate, and create. Every SKU starts with zero stock; physical inward creates traceable lots and QR labels afterward.</p></div><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={downloadTemplate} disabled={templateState.loading || !readiness?.ready}><Download className="mr-2 h-4 w-4" />Latest Excel template</Button><Button asChild><Link href="/dashboard/master-data/products"><PackagePlus className="mr-2 h-4 w-4" />Product Master</Link></Button></div></div></section>

    <section className="mp-panel p-5"><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold text-[var(--ink)]">Master-data preflight</h2><p className="mt-1 text-sm text-[var(--ink-4)]">Required masters must be active before a workbook can be downloaded or uploaded.</p></div>{readiness?.ready ? <span className="flex items-center gap-2 text-sm font-semibold text-emerald-700"><CheckCircle2 className="h-5 w-5" />Ready</span> : <span className="flex items-center gap-2 text-sm font-semibold text-amber-700"><AlertTriangle className="h-5 w-5" />Action required</span>}</div>{readinessState.loading && !readiness ? <div className="mt-4"><QueryLoading label="Checking live masters..." /></div> : <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{(readiness?.checks || []).map((check: any) => <Link key={check.key} href={check.route} className={`rounded-r3 border p-3 ${check.required && !check.count ? 'border-amber-200 bg-amber-50' : 'border-[var(--line)] bg-[var(--surface)]'}`}><p className="text-xs font-semibold text-[var(--ink-4)]">{check.label}{check.required ? ' *' : ''}</p><p className="mt-1 text-xl font-bold tabular-nums text-[var(--ink)]">{check.count}</p></Link>)}</div>}</section>

    <section className="grid overflow-hidden rounded-r4 border border-[var(--line)] bg-[var(--surface)] sm:grid-cols-4">{['Download live template', 'Upload workbook', 'Edit and validate', 'Create SKUs'].map((label, index) => { const step = index + 1; const complete = currentStep > step || result?.status === 'applied'; const activeStep = currentStep === step; return <div key={label} className={`flex min-h-16 items-center gap-3 border-b border-[var(--line)] px-4 py-3 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0 ${activeStep ? 'bg-[var(--brand-50)]' : ''}`}>{complete ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" /> : <Circle className={`h-5 w-5 shrink-0 ${activeStep ? 'text-[var(--brand-700)]' : 'text-[var(--ink-5)]'}`} />}<div><p className="text-[10px] font-semibold uppercase text-[var(--ink-5)]">Step {step}</p><p className="text-sm font-semibold text-[var(--ink)]">{label}</p></div></div>; })}</section>

    <section className="grid gap-5 xl:grid-cols-[0.72fr_1.28fr]">
      <div className="space-y-5"><div className="mp-panel p-6"><div className="grid h-12 w-12 place-items-center rounded-r3 bg-[var(--brand-50)] text-[var(--brand-700)]"><FileSpreadsheet className="h-6 w-6" /></div><h2 className="mt-5 text-2xl font-semibold text-[var(--ink)]">Workbook intake</h2><p className="mt-2 text-sm leading-6 text-[var(--ink-4)]">Required per row: unique SKU and internal code, name, category, brand, finish, and tax code. Grey workbook headers marked Optional may be left blank, including prices, HSN, images, material, tile size, UOM and box conversion details.</p>{templateInfo?.masterCounts ? <p className="mt-3 text-xs font-semibold text-[var(--ink-4)]">Downloaded with {templateInfo.masterCounts.brands} brands and {templateInfo.masterCounts.categories} categories.</p> : null}<label className={`mt-6 block rounded-r5 border border-dashed p-6 text-center ${readiness?.ready ? 'cursor-pointer border-[var(--line-strong)] bg-[var(--bg-soft)] hover:border-[var(--brand-400)]' : 'cursor-not-allowed border-amber-200 bg-amber-50 opacity-70'}`}><UploadCloud className="mx-auto h-9 w-9 text-[var(--brand-700)]" /><span className="mt-3 block text-sm font-semibold text-[var(--ink)]">Choose `.xlsx` file</span><span className="mt-1 block text-xs text-[var(--ink-4)]">25 MB maximum · 5,000 Product Master rows · preview only</span><input type="file" accept=".xlsx" className="sr-only" disabled={isBusy || !readiness?.ready} onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; try { await uploadAndPreview(file); } catch (error: any) { setStatus(error?.message || 'Upload failed.'); } finally { event.target.value = ''; } }} /></label>{status ? <div className={`mt-5 rounded-r4 border p-4 text-sm font-semibold ${statusTone}`}>{status}</div> : null}{preview ? <><Button className="mt-4 w-full" variant="outline" disabled={!reviewDirty || isBusy} onClick={revalidateReview}><Save className="mr-2 h-4 w-4" />Revalidate edited rows</Button>{!preview.failed && !reviewDirty ? <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-r4 border border-[var(--line)] p-4"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--brand-700)]" /><span><b className="block text-sm text-[var(--ink)]">I reviewed all {rowLabel}</b><span className="mt-1 block text-xs text-[var(--ink-4)]">Create {skuLabel} as saleable Product Master records with zero stock.</span></span></label> : null}<Button className="mt-3 w-full" size="lg" disabled={!canApply || isBusy} onClick={applyPreview}><ShieldCheck className="mr-2 h-4 w-4" />Confirm and create {skuLabel}</Button><Button className="mt-2 w-full" variant="outline" onClick={discardPreview}><RefreshCcw className="mr-2 h-4 w-4" />Discard preview</Button></> : null}</div>
        <div className="mp-panel p-5"><div className="flex items-center gap-3"><Warehouse className="h-5 w-5 text-[var(--brand-700)]" /><h2 className="font-semibold text-[var(--ink)]">After creation</h2></div><div className="mt-4 space-y-3 text-sm text-[var(--ink-3)]"><p><b>Saleable SKU:</b> Product identity only; stock remains zero.</p><p><b>Physical stock:</b> Opening Stock for go-live or GRN for later inward creates lots and availability.</p><p><b>Display sample:</b> Register separately in Tile Master. It remains non-sellable and never increases stock.</p></div><div className="mt-4 grid gap-2"><Button asChild variant="outline"><Link href="/dashboard/inventory/inwards">Receive inward / GRN</Link></Button><Button asChild variant="outline"><Link href="/dashboard/inventory/labels">Print lot or display QR</Link></Button></div></div>
      </div>

      <div className="space-y-5"><div className="grid gap-3 md:grid-cols-5"><Stat label="Rows read" value={active?.total ?? 0} /><Stat label="Ready" value={active?.ready ?? active?.applied ?? 0} /><Stat label="New SKUs" value={active?.created ?? 0} /><Stat label="With images" value={active?.imageCount ?? 0} /><Stat label="Failed" value={active?.failed ?? 0} /></div>
        <div className="mp-panel p-5"><div className="flex items-start gap-3"><Eye className="mt-1 h-5 w-5 text-[var(--brand-700)]" /><div><h2 className="text-xl font-semibold text-[var(--ink)]">Editable row review</h2><p className="mt-1 text-sm text-[var(--ink-4)]">Expand any row, correct it with live master values, then revalidate the complete review.</p></div></div>
          {reviewRows.length ? <div className="mt-5 space-y-3">{reviewRows.map((row, index) => { const source = preview?.previewRows?.find((item: any) => item.sheet === row.sheet && item.rowNumber === row.rowNumber) || {}; const identity = `${row.sheet}-${row.rowNumber}`; const open = editing === identity; return <article key={identity} className={`overflow-hidden rounded-r4 border ${source.errors?.length ? 'border-amber-200' : 'border-[var(--line)]'}`}><div className="flex flex-col justify-between gap-3 bg-[var(--surface)] p-4 sm:flex-row sm:items-center"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-[var(--ink)]">{row.sku || 'Missing SKU'} · {row.name || 'Missing product name'}</p><span className={`rounded px-2 py-1 text-[10px] font-semibold uppercase ${source.errors?.length ? 'bg-amber-100 text-amber-800' : 'bg-emerald-50 text-emerald-700'}`}>{source.errors?.length ? `${source.errors.length} issue${source.errors.length === 1 ? '' : 's'}` : 'valid'}</span></div><p className="mt-1 text-xs text-[var(--ink-4)]">{row.sheet} #{row.rowNumber} · {row.category || 'No category'} · {row.brand || 'No brand'} · {row.internalCode || 'No internal code'}</p>{source.errors?.length ? <p className="mt-2 text-xs font-semibold leading-5 text-amber-800">{source.errors.join(' · ')}</p> : null}</div><Button variant="outline" onClick={() => setEditing(open ? '' : identity)}>{open ? <X className="mr-2 h-4 w-4" /> : <Pencil className="mr-2 h-4 w-4" />}{open ? 'Close' : 'Edit row'}</Button></div>{open ? <div className="border-t border-[var(--line)] bg-[var(--bg-soft)] p-4"><div className="grid gap-4 md:grid-cols-2"><Field label="SKU"><input className={inputClass} value={row.sku} onChange={(event) => updateRow(index, 'sku', event.target.value.toUpperCase())} /></Field><Field label="Unique internal code"><input className={inputClass} value={row.internalCode} onChange={(event) => updateRow(index, 'internalCode', event.target.value.toUpperCase())} /></Field><Field label="Product name" wide><input className={inputClass} value={row.name} onChange={(event) => updateRow(index, 'name', event.target.value)} /></Field><Field label="Category"><SelectField value={row.category} options={options.categories || []} onChange={(value) => updateRow(index, 'category', value)} placeholder="Select category" /></Field><Field label="Brand"><SelectField value={row.brand} options={options.brands || []} onChange={(value) => updateRow(index, 'brand', value)} placeholder="Select brand" /></Field><Field label="Finish"><SelectField value={row.finish} options={options.finishes || []} onChange={(value) => updateRow(index, 'finish', value)} placeholder="Select finish" /></Field><Field label="Material"><SelectField value={row.material} options={options.materials || []} onChange={(value) => updateRow(index, 'material', value)} placeholder="Optional material" /></Field><Field label="Tile size / dimensions"><SelectField value={row.dimensions} options={options.tileSizes || []} onChange={(value) => updateRow(index, 'dimensions', value)} placeholder={row.category === 'Tiles' ? 'Required for tiles' : 'Not required'} /></Field><Field label="Base UOM"><SelectField value={row.baseUom} options={options.uoms || []} onChange={(value) => updateRow(index, 'baseUom', value)} placeholder="Select UOM" /></Field><Field label="Purchase UOM"><SelectField value={row.purchaseUom} options={options.uoms || []} onChange={(value) => updateRow(index, 'purchaseUom', value)} placeholder="Select UOM" /></Field><Field label="Sales UOM"><SelectField value={row.salesUom} options={options.uoms || []} onChange={(value) => updateRow(index, 'salesUom', value)} placeholder="Select UOM" /></Field><Field label="Pieces per pack"><input className={inputClass} type="number" min={1} value={row.piecesPerPack} onChange={(event) => updateRow(index, 'piecesPerPack', event.target.value)} /></Field><Field label="Coverage per pack"><input className={inputClass} type="number" min={0} step="0.001" value={row.coveragePerPack} onChange={(event) => updateRow(index, 'coveragePerPack', event.target.value)} /></Field><Field label="Sell price"><input className={inputClass} type="number" min={0.01} step="0.01" value={row.sellPrice} onChange={(event) => updateRow(index, 'sellPrice', event.target.value)} /></Field><Field label="Floor price"><input className={inputClass} type="number" min={0} step="0.01" value={row.floorPrice} onChange={(event) => updateRow(index, 'floorPrice', event.target.value)} /></Field><Field label="Tax code"><SelectField value={row.taxClass} options={options.taxCodes || []} onChange={(value) => updateRow(index, 'taxClass', value)} placeholder="Select tax" /></Field><Field label="HSN code"><input className={inputClass} value={row.hsnCode} onChange={(event) => updateRow(index, 'hsnCode', event.target.value)} /></Field><Field label="Allow loose sale"><SelectField value={row.allowLoose} options={['No', 'Yes']} onChange={(value) => updateRow(index, 'allowLoose', value)} placeholder="Select Yes or No" /></Field><Field label="Range / series"><input className={inputClass} value={row.range} onChange={(event) => updateRow(index, 'range', event.target.value)} /></Field><Field label="HTTPS image URL" wide><input className={inputClass} value={row.imageUrl} onChange={(event) => updateRow(index, 'imageUrl', event.target.value)} placeholder="Optional when an image is embedded in Excel" /></Field><Field label="Description" wide><textarea className={`${inputClass} min-h-20 py-2`} value={row.description} onChange={(event) => updateRow(index, 'description', event.target.value)} /></Field></div></div> : null}</article>; })}<div className="flex justify-end"><Button disabled={!reviewDirty || isBusy} onClick={revalidateReview}><Save className="mr-2 h-4 w-4" />Save edits and revalidate</Button></div></div> : result?.products?.length ? <div className="mt-5 rounded-r4 border border-emerald-200 bg-emerald-50 p-5"><div className="flex items-center gap-3 text-emerald-800"><CheckCircle2 className="h-6 w-6" /><div><p className="font-semibold">{result.created} SKU{result.created === 1 ? '' : 's'} created</p><p className="mt-1 text-sm">Use inward or approved opening stock to create physical lots and labels.</p></div></div></div> : <div className="mt-5 rounded-r4 border border-[var(--line)] p-8 text-center"><ImageIcon className="mx-auto h-9 w-9 text-[var(--ink-5)]" /><p className="mt-3 text-sm font-semibold text-[var(--ink-3)]">Upload the latest Product Master workbook to begin review.</p></div>}
        </div>
      </div>
    </section>
  </div>;
}
