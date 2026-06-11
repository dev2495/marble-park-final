'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { gql, useMutation } from '@apollo/client';
import { AlertTriangle, CheckCircle2, Database, Eye, FileSpreadsheet, Image as ImageIcon, PackagePlus, UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryErrorBanner } from '@/components/query-state';

const BEGIN_UPLOAD = gql`mutation($filename: String!) { beginImportUpload(filename: $filename) { id result } }`;
const APPEND_UPLOAD = gql`mutation($uploadId: String!, $filename: String!, $contentBase64: String!) { appendImportUpload(uploadId: $uploadId, filename: $filename, contentBase64: $contentBase64) { id result } }`;
const PREVIEW_UPLOAD = gql`mutation($uploadId: String!, $filename: String!, $kind: String!) { previewUploadedImport(uploadId: $uploadId, filename: $filename, kind: $kind) { id result } }`;
const APPLY_UPLOAD = gql`mutation($uploadId: String!, $filename: String!, $kind: String!) { applyUploadedImport(uploadId: $uploadId, filename: $filename, kind: $kind) { id result } }`;

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
      ) : <p className="mt-3 text-sm font-semibold text-emerald-700">Already in master data</p>}
    </div>
  );
}

export default function ImportCenterPage() {
  const [status, setStatus] = useState('');
  const [upload, setUpload] = useState<{ uploadId: string; filename: string } | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [beginUpload] = useMutation(BEGIN_UPLOAD);
  const [appendUpload] = useMutation(APPEND_UPLOAD);
  const [previewUpload, previewState] = useMutation(PREVIEW_UPLOAD, {
    onCompleted: (response) => {
      const importPreview = response?.previewUploadedImport?.result;
      setPreview(importPreview);
      setResult(null);
      setStatus(importPreview?.failed ? 'Preview found row errors. Fix Excel and upload again before applying.' : 'Preview is clean. Review the rows and apply when ready.');
    },
    onError: (err) => setStatus(err.message),
  });
  const [applyUpload, applyState] = useMutation(APPLY_UPLOAD, {
    onCompleted: (response) => {
      const importResult = response?.applyUploadedImport?.result;
      setResult(importResult);
      setStatus(importResult?.status === 'applied' ? 'Excel import applied to Product Master.' : importResult?.message || 'Import did not apply.');
    },
    onError: (err) => setStatus(err.message),
  });

  async function uploadAndPreview(file: File) {
    if (!/\.xlsx$/i.test(file.name)) throw new Error('Only .xlsx files are supported here. PDF catalogue extraction has been removed.');
    setPreview(null);
    setResult(null);
    setUpload(null);
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
    if (!upload) return;
    setStatus('Applying clean preview in one transaction...');
    await applyUpload({ variables: { uploadId: upload.uploadId, filename: upload.filename, kind: 'excel' } });
  }

  const active = result || preview;
  const failures = active?.failures || [];
  const previewRows = preview?.previewRows || [];
  const masterGaps = active?.masterGaps || { categories: [], brands: [], finishes: [] };
  const isBusy = previewState.loading || applyState.loading;
  const canApply = Boolean(upload && preview && !preview.failed && !result);
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
            <h1 className="mt-3 font-display text-4xl font-bold tracking-[-0.04em] text-[var(--ink)]">Preview first. Apply only after the sheet is clean.</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--ink-3)]">
              Upload vendor spreadsheets with SKU, name, brand, category, finish, MRP and image fields. The system previews create/update actions, failed rows and new master values before writing to Product Master. PDF catalogue extraction is intentionally removed.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild><Link href="/dashboard/master-data/products"><PackagePlus className="mr-2 h-4 w-4" /> Product Master</Link></Button>
            <Button asChild variant="outline"><Link href="/dashboard/products"><ImageIcon className="mr-2 h-4 w-4" /> Catalogue</Link></Button>
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.78fr_1.22fr]">
        <div className="mp-panel p-6">
          <div className="grid h-12 w-12 place-items-center rounded-r3 bg-[var(--brand-50)] text-[var(--brand-700)]">
            <FileSpreadsheet className="h-6 w-6" />
          </div>
          <h2 className="mt-5 text-2xl font-semibold text-[var(--ink)]">Upload Excel catalogue</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-4)]">
            Supported columns include SKU/code, description/name, category, brand, finish/color, size/dimensions, UOM, MRP/price, floor/dealer price, and image/photo/media URL. Embedded worksheet images placed beside SKU rows are saved only when you apply.
          </p>
          <label className="mt-6 block rounded-r5 border border-dashed border-[var(--line-strong)] bg-[var(--bg-soft)] p-6 text-center transition hover:border-[var(--brand-400)]">
            <UploadCloud className="mx-auto h-9 w-9 text-[var(--brand-700)]" />
            <span className="mt-3 block text-sm font-semibold text-[var(--ink)]">Choose `.xlsx` file</span>
            <span className="mt-1 block text-xs text-[var(--ink-4)]">Step 1 creates a preview. Product data is written only after Apply.</span>
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
          <Button className="mt-5 w-full" size="lg" disabled={!canApply || isBusy} onClick={applyPreview}>
            <Database className="mr-2 h-4 w-4" />Apply clean preview
          </Button>
          {preview?.failed ? <p className="mt-3 text-xs font-semibold text-amber-700">Apply is locked because the preview has failed rows.</p> : null}
        </div>

        <div className="space-y-5">
          <div className="grid gap-3 md:grid-cols-5">
            <Stat label="Rows read" value={active?.total ?? 0} />
            <Stat label="Ready" value={active?.ready ?? active?.applied ?? 0} />
            <Stat label="Create" value={active?.created ?? 0} />
            <Stat label="Update" value={active?.updated ?? 0} />
            <Stat label="Failed" value={active?.failed ?? 0} />
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <GapList title="New categories" items={masterGaps.categories || []} />
            <GapList title="New brands" items={masterGaps.brands || []} />
            <GapList title="New finishes" items={masterGaps.finishes || []} />
          </div>

          <div className="mp-panel p-6">
            <div className="flex items-start gap-3">
              <Eye className="mt-1 h-5 w-5 text-[var(--brand-700)]" />
              <div>
                <h2 className="text-xl font-semibold text-[var(--ink)]">Preview rows</h2>
                <p className="mt-1 text-sm text-[var(--ink-4)]">Review create/update actions and image detection before applying.</p>
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
                        <td className="px-4 py-3 text-xs font-semibold text-[var(--ink-4)]">{row.imageStatus}</td>
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
