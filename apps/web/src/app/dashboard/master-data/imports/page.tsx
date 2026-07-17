'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { gql, useLazyQuery, useMutation } from '@apollo/client';
import { AlertTriangle, CheckCircle2, Circle, Download, Eye, FileSpreadsheet, Image as ImageIcon, PackagePlus, RefreshCcw, ShieldCheck, UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryErrorBanner } from '@/components/query-state';

const BEGIN_UPLOAD = gql`mutation($filename: String!) { beginImportUpload(filename: $filename) { id result } }`;
const APPEND_UPLOAD = gql`mutation($uploadId: String!, $filename: String!, $contentBase64: String!) { appendImportUpload(uploadId: $uploadId, filename: $filename, contentBase64: $contentBase64) { id result } }`;
const CANCEL_UPLOAD = gql`mutation($uploadId: String!, $filename: String!) { cancelImportUpload(uploadId: $uploadId, filename: $filename) { id result } }`;
const PREVIEW_UPLOAD = gql`mutation($uploadId: String!, $filename: String!, $kind: String!) { previewUploadedImport(uploadId: $uploadId, filename: $filename, kind: $kind) { id result } }`;
const APPLY_UPLOAD = gql`mutation($uploadId: String!, $filename: String!, $kind: String!, $confirmationToken: String!) { applyUploadedImport(uploadId: $uploadId, filename: $filename, kind: $kind, confirmationToken: $confirmationToken) { id result } }`;
const TEMPLATE = gql`query ProductImportTemplate { productImportTemplate }`;

async function blobToBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-r4 border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm-soft">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-5)]">{label}</p>
      <p className="mt-2 font-display text-3xl font-bold tabular-nums text-[var(--ink)]">{value}</p>
    </div>
  );
}

function GapList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-r4 border border-[var(--line)] bg-[var(--surface)] p-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-5)]">{title}</p>
      {items.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {items.slice(0, 18).map((item) => <span key={item} className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">{item}</span>)}
          {items.length > 18 ? <span className="rounded-full bg-[var(--bg-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--ink-4)]">+{items.length - 18} more</span> : null}
        </div>
      ) : <p className="mt-3 text-sm font-semibold text-emerald-700">All values are governed</p>}
    </div>
  );
}

export default function ImportCenterPage() {
  const [status, setStatus] = useState('');
  const [upload, setUpload] = useState<{ uploadId: string; filename: string } | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [reviewed, setReviewed] = useState(false);
  const [templateInfo, setTemplateInfo] = useState<any>(null);
  const [beginUpload] = useMutation(BEGIN_UPLOAD);
  const [appendUpload] = useMutation(APPEND_UPLOAD);
  const [cancelUpload] = useMutation(CANCEL_UPLOAD);
  const [previewUpload, previewState] = useMutation(PREVIEW_UPLOAD, {
    onCompleted: (response) => {
      const importPreview = response?.previewUploadedImport?.result;
      setPreview(importPreview);
      setResult(null);
      setReviewed(false);
      setStatus(importPreview?.message || (importPreview?.failed ? 'Preview found row errors. Fix Excel and upload again before applying.' : 'Preview is clean. Review the rows and apply when ready.'));
    },
    onError: (err) => setStatus(err.message),
  });
  const [applyUpload, applyState] = useMutation(APPLY_UPLOAD, {
    onCompleted: (response) => {
      const importResult = response?.applyUploadedImport?.result;
      setResult(importResult);
      if (importResult?.status === 'applied') setPreview(null);
      setReviewed(false);
      setStatus(importResult?.status === 'applied' ? 'Excel import applied to Product Master.' : importResult?.message || 'Import did not apply.');
    },
    onError: (err) => setStatus(err.message),
  });
  const [loadTemplate, templateState] = useLazyQuery(TEMPLATE, { fetchPolicy: 'no-cache' });

  async function downloadTemplate() {
    const response = await loadTemplate();
    const file = response.data?.productImportTemplate;
    if (!file?.contentBase64) return;
    setTemplateInfo(file);
    const bytes = Uint8Array.from(atob(file.contentBase64), (character) => character.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: file.mimeType }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = file.filename;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus(`Fresh template downloaded with ${file.masterCounts?.brands || 0} brands, ${file.masterCounts?.categories || 0} categories and current governed dropdowns.`);
  }

  async function uploadAndPreview(file: File) {
    if (!/\.xlsx$/i.test(file.name)) throw new Error('Only .xlsx files are supported here. PDF catalogue extraction has been removed.');
    if (!file.size || file.size > 25 * 1024 * 1024) throw new Error('Choose a non-empty .xlsx workbook smaller than 25 MB.');
    if (upload) await cancelUpload({ variables: upload }).catch(() => null);
    setPreview(null);
    setResult(null);
    setUpload(null);
    setReviewed(false);
    setStatus('Creating upload session...');
    const begin = await beginUpload({ variables: { filename: file.name } });
    const uploadId = begin.data?.beginImportUpload?.result?.uploadId;
    if (!uploadId) throw new Error('Upload session was not created.');
    const chunkSize = 512 * 1024;
    for (let offset = 0; offset < file.size; offset += chunkSize) {
      const contentBase64 = await blobToBase64(file.slice(offset, offset + chunkSize));
      await appendUpload({ variables: { uploadId, filename: file.name, contentBase64 } });
      setStatus(`Uploading ${Math.min(100, Math.round(((offset + chunkSize) / file.size) * 100))}%...`);
    }
    setUpload({ uploadId, filename: file.name });
    setStatus('Reading Excel and building preview...');
    await previewUpload({ variables: { uploadId, filename: file.name, kind: 'excel' } });
  }

  async function applyPreview() {
    if (!upload || !preview?.confirmationToken || !reviewed) return;
    setStatus('Creating the confirmed SKUs in one transaction...');
    await applyUpload({ variables: { uploadId: upload.uploadId, filename: upload.filename, kind: 'excel', confirmationToken: preview.confirmationToken } });
  }

  async function discardPreview() {
    if (upload) await cancelUpload({ variables: upload }).catch(() => null);
    setPreview(null);
    setUpload(null);
    setReviewed(false);
    setStatus('Choose the corrected or replacement workbook.');
  }

  const active = result || preview;
  const failures = active?.failures || [];
  const previewRows = preview?.previewRows || [];
  const masterGaps = active?.masterGaps || { categories: [], brands: [], finishes: [], materials: [], tileSizes: [] };
  const isBusy = previewState.loading || applyState.loading;
  const canApply = Boolean(upload && preview?.confirmationToken && !preview.failed && preview.total > 0 && reviewed && !result);
  const currentStep = result?.status === 'applied' ? 4 : preview ? 3 : upload ? 2 : 1;
  const previewRowLabel = `${preview?.total || 0} ${preview?.total === 1 ? 'row' : 'rows'}`;
  const previewSkuLabel = `${preview?.created || 0} ${preview?.created === 1 ? 'SKU' : 'SKUs'}`;
  const statusTone = useMemo(() => {
    if (result?.status === 'applied') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
    if (preview?.failed || result?.status === 'blocked_by_validation') return 'border-amber-200 bg-amber-50 text-amber-900';
    return 'border-[var(--line)] bg-[var(--surface)] text-[var(--ink-2)]';
  }, [preview, result]);

  return (
    <div className="space-y-6 pb-10">
      {previewState.error ? <QueryErrorBanner error={previewState.error} /> : null}
      {applyState.error ? <QueryErrorBanner error={applyState.error} /> : null}

      <section className="mp-card rounded-r6 border border-[var(--line)] p-6">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--ink-4)]">Excel Product Master import</p>
            <h1 className="mt-3 font-display text-4xl font-bold tracking-[-0.04em] text-[var(--ink)]">Create clean Product Master SKUs in bulk.</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--ink-3)]">
              Download a fresh workbook containing live brand, category, finish, material, tile size, UOM and tax dropdowns. Add one new SKU per row, attach an image or URL, preview every result, then confirm once. Existing SKUs remain protected for individual editing.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={downloadTemplate} disabled={templateState.loading}><Download className="mr-2 h-4 w-4" /> Excel template</Button>
            <Button asChild><Link href="/dashboard/master-data/products"><PackagePlus className="mr-2 h-4 w-4" /> Product Master</Link></Button>
            <Button asChild variant="outline"><Link href="/dashboard/products"><ImageIcon className="mr-2 h-4 w-4" /> Catalogue</Link></Button>
          </div>
        </div>
      </section>

      <section className="grid overflow-hidden rounded-r4 border border-[var(--line)] bg-[var(--surface)] sm:grid-cols-4">
        {['Download live template', 'Upload workbook', 'Review every row', 'Create SKUs'].map((label, index) => {
          const step = index + 1;
          const complete = currentStep > step || result?.status === 'applied';
          const activeStep = currentStep === step;
          return <div key={label} className={`flex min-h-16 items-center gap-3 border-b border-[var(--line)] px-4 py-3 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0 ${activeStep ? 'bg-[var(--brand-50)]' : ''}`}>
            {complete ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" /> : <Circle className={`h-5 w-5 shrink-0 ${activeStep ? 'text-[var(--brand-700)]' : 'text-[var(--ink-5)]'}`} />}
            <div><p className="text-[10px] font-semibold uppercase text-[var(--ink-5)]">Step {step}</p><p className="text-sm font-semibold text-[var(--ink)]">{label}</p></div>
          </div>;
        })}
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.78fr_1.22fr]">
        <div className="mp-panel p-6">
          <div className="grid h-12 w-12 place-items-center rounded-r3 bg-[var(--brand-50)] text-[var(--brand-700)]">
            <FileSpreadsheet className="h-6 w-6" />
          </div>
          <h2 className="mt-5 text-2xl font-semibold text-[var(--ink)]">Workbook intake</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-4)]">
            Use the downloaded template. Required: SKU, internal code, name, category and governed UOM/tax values. For tiles, select a live tile size and enter pack conversion. Images may be HTTPS URLs or JPG/PNG/WebP pictures inserted into the Product Image cell.
          </p>
          {templateInfo?.masterCounts ? <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold text-[var(--ink-3)]">
            <span className="rounded bg-[var(--bg-soft)] px-2 py-1">{templateInfo.masterCounts.categories} categories</span>
            <span className="rounded bg-[var(--bg-soft)] px-2 py-1">{templateInfo.masterCounts.brands} brands</span>
            <span className="rounded bg-[var(--bg-soft)] px-2 py-1">{templateInfo.masterCounts.tileSizes} tile sizes</span>
          </div> : null}
          <label className="mt-6 block rounded-r5 border border-dashed border-[var(--line-strong)] bg-[var(--bg-soft)] p-6 text-center transition hover:border-[var(--brand-400)]">
            <UploadCloud className="mx-auto h-9 w-9 text-[var(--brand-700)]" />
            <span className="mt-3 block text-sm font-semibold text-[var(--ink)]">Choose `.xlsx` file</span>
            <span className="mt-1 block text-xs text-[var(--ink-4)]">Maximum 25 MB and 5,000 product rows. Upload creates a read-only preview.</span>
            <input
              type="file"
              accept=".xlsx"
              className="sr-only"
              disabled={isBusy}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                try {
                  await uploadAndPreview(file);
                } catch (err: any) {
                  setStatus(err?.message || 'Upload failed.');
                } finally {
                  event.target.value = '';
                }
              }}
            />
          </label>
          {status ? <div className={`mt-5 rounded-r4 border p-4 text-sm font-semibold ${statusTone}`}>{status}</div> : null}
          {preview && !preview.failed && !result ? <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-r4 border border-[var(--line)] bg-[var(--surface)] p-4">
            <input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--brand-700)]" />
            <span><span className="block text-sm font-semibold text-[var(--ink)]">I reviewed all {previewRowLabel}</span><span className="mt-1 block text-xs leading-5 text-[var(--ink-4)]">Create {previewSkuLabel} with zero opening stock. No existing product will be updated.</span></span>
          </label> : null}
          <Button className="mt-5 w-full" size="lg" disabled={!canApply || isBusy} onClick={applyPreview}>
            <ShieldCheck className="mr-2 h-4 w-4" />Confirm and create {previewSkuLabel}
          </Button>
          {preview?.failed ? <p className="mt-3 text-xs font-semibold text-amber-700">Confirmation is locked. Correct every failed row and upload the workbook again.</p> : null}
          {preview && !result ? <Button className="mt-2 w-full" variant="outline" onClick={discardPreview}><RefreshCcw className="mr-2 h-4 w-4" />Discard preview</Button> : null}
        </div>

        <div className="space-y-5">
          <div className="grid gap-3 md:grid-cols-5">
            <Stat label="Rows read" value={active?.total ?? 0} />
            <Stat label="Ready" value={active?.ready ?? active?.applied ?? 0} />
            <Stat label="New SKUs" value={active?.created ?? 0} />
            <Stat label="With images" value={active?.imageCount ?? 0} />
            <Stat label="Failed" value={active?.failed ?? 0} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <GapList title="Unknown categories" items={masterGaps.categories || []} />
            <GapList title="Unknown brands" items={masterGaps.brands || []} />
            <GapList title="Unknown finishes" items={masterGaps.finishes || []} />
            <GapList title="Unknown materials" items={masterGaps.materials || []} />
            <GapList title="Unknown tile sizes" items={masterGaps.tileSizes || []} />
          </div>

          <div className="mp-panel p-6">
            <div className="flex items-start gap-3">
              <Eye className="mt-1 h-5 w-5 text-[var(--brand-700)]" />
              <div>
                <h2 className="text-xl font-semibold text-[var(--ink)]">Preview rows</h2>
                <p className="mt-1 text-sm text-[var(--ink-4)]">Check identity, governed masters, units, price, image and row errors before confirmation.</p>
              </div>
            </div>

            {previewRows.length ? (
              <div className="mt-5 max-h-[30rem] overflow-auto rounded-r4 border border-[var(--line)] custom-scrollbar">
                <table className="w-full min-w-[860px] text-sm">
                  <thead className="bg-[var(--bg-soft)] text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-5)]">
                    <tr><th className="px-4 py-3">Row</th><th className="px-4 py-3">SKU</th><th className="px-4 py-3">Name</th><th className="px-4 py-3">Master data</th><th className="px-4 py-3">Price</th><th className="px-4 py-3">Image</th><th className="px-4 py-3">Action</th></tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--line)]">
                    {previewRows.map((row: any) => (
                      <tr key={`${row.sheet}-${row.rowNumber}-${row.sku}`} className={row.errors?.length ? 'bg-amber-50/70' : ''}>
                        <td className="px-4 py-3 text-xs font-semibold text-[var(--ink-4)]">{row.sheet} #{row.rowNumber}</td>
                        <td className="px-4 py-3 font-semibold text-[var(--ink)]">{row.sku || 'Missing'}</td>
                        <td className="px-4 py-3 text-[var(--ink-2)]">{row.name || 'Missing name'}</td>
                        <td className="px-4 py-3 text-xs text-[var(--ink-4)]">{[row.category, row.brand, row.finish].filter(Boolean).join(' / ')}</td>
                        <td className="px-4 py-3 font-semibold">₹{Number(row.sellPrice || 0).toLocaleString('en-IN')}</td>
                        <td className="px-4 py-3 text-xs font-semibold text-[var(--ink-4)]">{row.imagePreviewUrl ? <span className="flex items-center gap-2"><img src={row.imagePreviewUrl} alt="" className="h-10 w-10 rounded bg-white object-contain" />URL ready</span> : row.imageStatus === 'embedded_image_detected' ? <span className="flex items-center gap-2 text-emerald-700"><ImageIcon className="h-4 w-4" />Embedded</span> : 'No image'}</td>
                        <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${row.errors?.length ? 'bg-amber-100 text-amber-800' : row.action === 'created' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>{row.errors?.length ? 'fix row' : row.action}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : result?.products?.length ? (
              <div className="mt-5 max-h-[28rem] overflow-y-auto rounded-r4 border border-[var(--line)] custom-scrollbar">
                <table className="w-full text-sm">
                  <thead className="bg-[var(--bg-soft)] text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-5)]">
                    <tr><th className="px-4 py-3">SKU</th><th className="px-4 py-3">Action</th><th className="px-4 py-3">Product ID</th></tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--line)]">
                    {result.products.map((product: any) => (
                      <tr key={`${product.id}-${product.sku}`}>
                        <td className="px-4 py-3 font-semibold text-[var(--ink)]">{product.sku}</td>
                        <td className="px-4 py-3"><span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">{product.action}</span></td>
                        <td className="px-4 py-3 text-xs text-[var(--ink-4)]">{product.id}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="mt-5 rounded-r4 border border-[var(--line)] bg-[var(--surface)] p-8 text-center">
                <CheckCircle2 className="mx-auto h-9 w-9 text-[var(--ink-5)]" />
                <p className="mt-3 text-sm font-semibold text-[var(--ink-3)]">Upload an Excel catalogue to see preview rows here.</p>
              </div>
            )}
          </div>

          {failures.length ? (
            <div className="mp-panel p-6">
              <div className="flex items-center gap-3 text-amber-700"><AlertTriangle className="h-5 w-5" /><h2 className="text-lg font-semibold">Rows needing correction</h2></div>
              <div className="mt-4 space-y-2">
                {failures.map((failure: any, index: number) => (
                  <div key={index} className="rounded-r3 border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    <b>{failure.sheet} row {failure.rowNumber}</b>{failure.sku ? ` · ${failure.sku}` : ''}: {failure.error}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
