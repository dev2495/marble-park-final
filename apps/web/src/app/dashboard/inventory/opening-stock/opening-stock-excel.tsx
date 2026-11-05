'use client';

import { useRef, useState } from 'react';
import { gql, useApolloClient, useMutation, useQuery } from '@apollo/client';
import { Download, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';

const CATEGORIES = gql`query OpeningStockCategories { productCategories }`;
const TEMPLATE = gql`query OpeningStockWorkbook($category: String) { openingStockWorkbook(category: $category) }`;
const PREVIEW = gql`mutation PreviewOpeningStockWorkbook($filename: String!, $contentBase64: String!) { previewOpeningStockWorkbook(filename: $filename, contentBase64: $contentBase64) }`;

async function fileBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function saveBase64(filename: string, mimeType: string, contentBase64: string) {
  const bytes = Uint8Array.from(atob(contentBase64), (char) => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** Download a count sheet, fill quantities in Excel, upload, preview, then add the lines to the batch. */
export function OpeningStockExcel({ onAdd, existingProductIds, defaultLot }: { onAdd: (lines: any[]) => void; existingProductIds: Set<string>; defaultLot: string }) {
  const client = useApolloClient();
  const { data: categoryData } = useQuery(CATEGORIES);
  const [category, setCategory] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<any>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, { loading: previewing }] = useMutation(PREVIEW);
  const categories: string[] = categoryData?.productCategories || [];

  async function download() {
    setError('');
    setDownloading(true);
    try {
      const { data } = await client.query({ query: TEMPLATE, variables: { category: category || undefined }, fetchPolicy: 'network-only' });
      const file = data?.openingStockWorkbook;
      if (!file?.contentBase64) throw new Error('The template could not be created.');
      saveBase64(file.filename, file.mimeType, file.contentBase64);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The template could not be downloaded.');
    } finally {
      setDownloading(false);
    }
  }

  async function upload(file?: File) {
    if (!file) return;
    setError('');
    setResult(null);
    try {
      const response = await preview({ variables: { filename: file.name, contentBase64: await fileBase64(file) } });
      setResult(response.data?.previewOpeningStockWorkbook || null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The file could not be read.');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  const fresh = (result?.lines || []).filter((line: any) => !existingProductIds.has(line.productId));
  const alreadyInBatch = (result?.lines?.length || 0) - fresh.length;

  function add() {
    onAdd(fresh.map((line: any) => ({
      productId: line.productId, sku: line.sku, internalCode: line.internalCode, name: line.name,
      lotCode: line.lotCode || defaultLot, quantity: String(line.quantity), unitCost: line.unitCost ? String(line.unitCost) : '',
      qualityStatus: 'available', packCount: '', labelTemplate: 'stock_pack',
    })));
    setResult(null);
  }

  return (
    <section className="mp-panel p-5" aria-labelledby="opening-excel-title">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[var(--brand-700)]">Excel upload</p>
          <h2 id="opening-excel-title" className="mt-1 text-xl font-black text-[var(--ink)]">Count in Excel, upload once</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--ink-3)]">Download the count sheet, fill <b>Quantity</b> (and <b>Unit cost</b>) for every item you physically have, then upload it. Rows are checked and added to the batch below. Nothing posts until the owner approves. Up to 500 lines per upload: download one category at a time for large ranges.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-bold text-[var(--ink-4)]">Category
            <select value={category} onChange={(event) => setCategory(event.target.value)} className="mt-1 block h-10 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)]">
              <option value="">All categories</option>
              {categories.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <Button type="button" variant="outline" onClick={download} disabled={downloading}>{downloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}Download count sheet</Button>
          <Button type="button" onClick={() => inputRef.current?.click()} disabled={previewing}>{previewing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}Upload filled sheet</Button>
          <input ref={inputRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" aria-label="Upload filled opening stock sheet" onChange={(event) => upload(event.target.files?.[0])} />
        </div>
      </div>
      {error ? <p role="alert" className="mt-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{error}</p> : null}
      {result ? (
        <div className="mt-4 rounded-md border border-[var(--line)] bg-[var(--bg-soft)] p-4" role="status">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
            <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--ink)]"><FileSpreadsheet className="h-4 w-4" aria-hidden="true" />{result.matchedCount} rows ready · {Number(result.totalUnits || 0).toLocaleString('en-IN')} units</span>
            {result.missingCost ? <span className="text-amber-800">{result.missingCost} without unit cost (owner must give a reason to post)</span> : null}
            {result.errorCount ? <span className="text-rose-800">{result.errorCount} rows need fixing</span> : <span className="text-emerald-800">No errors</span>}
            {alreadyInBatch ? <span className="text-[var(--ink-3)]">{alreadyInBatch} already in the batch, skipped</span> : null}
          </div>
          {result.truncated ? <p className="mt-2 text-sm text-amber-800">Only the first {result.maxLines} rows were taken. Submit this batch, then upload the rest (or download one category at a time).</p> : null}
          {result.errors?.length ? (
            <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto text-sm text-rose-900">
              {result.errors.map((item: any) => <li key={`${item.row}-${item.message}`}>Row {item.row}: {item.message}</li>)}
            </ul>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" onClick={add} disabled={!fresh.length}>Add {fresh.length} line{fresh.length === 1 ? '' : 's'} to the batch</Button>
            <Button type="button" variant="ghost" onClick={() => setResult(null)}>Discard</Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
