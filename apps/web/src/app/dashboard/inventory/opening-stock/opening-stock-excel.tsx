'use client';

import { useRef, useState } from 'react';
import { gql, useApolloClient, useMutation } from '@apollo/client';
import { Download, FileSpreadsheet, ListChecks, Loader2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CountSheetBuilder, saveBase64File } from '@/components/inventory/count-sheet-builder';
import { fileToBase64 } from '@/lib/file-base64';

const TEMPLATE = gql`query OpeningStockWorkbook($filter: CountSheetFilterInput) { openingStockWorkbook(filter: $filter) }`;
const PREVIEW = gql`mutation PreviewOpeningStockWorkbook($filename: String!, $contentBase64: String!) { previewOpeningStockWorkbook(filename: $filename, contentBase64: $contentBase64) }`;

/** Download a count sheet, fill quantities in Excel, upload, preview, then add the lines to the batch. */
export function OpeningStockExcel({ onAdd, existingProductIds, defaultLot }: { onAdd: (lines: any[]) => void; existingProductIds: Set<string>; defaultLot: string }) {
  const client = useApolloClient();
  const [builderOpen, setBuilderOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<any>(null);
  const [fileName, setFileName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, { loading: previewing }] = useMutation(PREVIEW);

  async function downloadAll() {
    setError('');
    setDownloading(true);
    try {
      const { data } = await client.query({ query: TEMPLATE, variables: { filter: {} }, fetchPolicy: 'network-only' });
      const file = data?.openingStockWorkbook;
      if (!file?.contentBase64) throw new Error('The sheet could not be created.');
      saveBase64File(file.filename, file.mimeType, file.contentBase64);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The sheet could not be downloaded.');
    } finally {
      setDownloading(false);
    }
  }

  async function upload(file?: File) {
    if (!file) return;
    setError('');
    setResult(null);
    setFileName(file.name);
    try {
      const response = await preview({ variables: { filename: file.name, contentBase64: await fileToBase64(file) } });
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
    <section className="mp-panel overflow-hidden" aria-labelledby="opening-excel-title">
      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="max-w-2xl">
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[var(--brand-700)]">Excel or CSV</p>
          <h2 id="opening-excel-title" className="mt-1 text-xl font-black text-[var(--ink)]">Count in a spreadsheet, upload once</h2>
          <ol className="mt-2 grid gap-1 text-sm leading-6 text-[var(--ink-3)] sm:grid-cols-3 sm:gap-3">
            <li><b className="text-[var(--ink)]">1. Get a sheet.</b> The full list, or build one by category, brand or hand-picked items.</li>
            <li><b className="text-[var(--ink)]">2. Fill it.</b> Quantity for what you have, plus Unit cost and Lot if known. Leave the rest blank.</li>
            <li><b className="text-[var(--ink)]">3. Upload.</b> Rows are checked, then added to the batch below. Nothing posts until the owner approves.</li>
          </ol>
        </div>
        <div className="flex flex-wrap gap-2 lg:flex-col lg:items-stretch">
          <Button type="button" variant="outline" onClick={() => setBuilderOpen(true)}><ListChecks className="mr-2 h-4 w-4" />Build a count sheet</Button>
          <Button type="button" variant="outline" onClick={downloadAll} disabled={downloading}>{downloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}Full product list</Button>
          <Button type="button" onClick={() => inputRef.current?.click()} disabled={previewing}>{previewing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}Upload filled sheet</Button>
          <input ref={inputRef} type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" aria-label="Upload filled opening stock sheet" onChange={(event) => upload(event.target.files?.[0])} />
        </div>
      </div>
      <p className="border-t border-[var(--line)] bg-[var(--bg-soft)] px-5 py-2 text-xs text-[var(--ink-4)]">Accepted columns: SKU or Product code, and Quantity (also read as Qty, On hand or Count). Optional: Unit cost, Lot. Up to 500 lines per upload; codes that lost a leading zero in Excel still match.</p>
      {error ? <p role="alert" className="mx-5 my-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{error}</p> : null}
      {result ? (
        <div className="m-5 rounded-md border border-[var(--line)] bg-[var(--surface)] p-4" role="status">
          <p className="flex items-center gap-1.5 font-semibold text-[var(--ink)]"><FileSpreadsheet className="h-4 w-4" aria-hidden="true" />{fileName}: {result.matchedCount} rows ready · {Number(result.totalUnits || 0).toLocaleString('en-IN')} units</p>
          <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {result.zeroRows ? <li className="text-[var(--ink-3)]">{result.zeroRows} rows with 0 skipped</li> : null}
            {result.missingCost ? <li className="text-amber-800">{result.missingCost} without unit cost (owner gives a reason when posting)</li> : null}
            {result.missingName ? <li className="text-amber-800">{result.missingName} have no name in Product Master</li> : null}
            {alreadyInBatch ? <li className="text-[var(--ink-3)]">{alreadyInBatch} already in the batch, skipped</li> : null}
            {result.errorCount ? <li className="text-rose-800">{result.errorCount} rows need fixing</li> : <li className="text-emerald-800">No errors</li>}
          </ul>
          {result.truncated ? <p className="mt-2 text-sm text-amber-800">Only the first {result.maxLines} rows were taken. Submit this batch, then upload the rest.</p> : null}
          {result.errors?.length ? <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto text-sm text-rose-900">{result.errors.map((item: any) => <li key={`e-${item.row}-${item.message}`}>Row {item.row}: {item.message}</li>)}</ul> : null}
          {result.notes?.length ? <ul className="mt-2 max-h-28 space-y-1 overflow-y-auto text-sm text-[var(--ink-3)]">{result.notes.map((item: any) => <li key={`n-${item.row}`}>Row {item.row}: {item.message}</li>)}</ul> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" onClick={add} disabled={!fresh.length}>Add {fresh.length} line{fresh.length === 1 ? '' : 's'} to the batch</Button>
            <Button type="button" variant="ghost" onClick={() => setResult(null)}>Discard</Button>
          </div>
        </div>
      ) : null}
      {builderOpen ? <CountSheetBuilder onClose={() => setBuilderOpen(false)} /> : null}
    </section>
  );
}
