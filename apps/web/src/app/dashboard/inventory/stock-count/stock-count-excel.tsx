'use client';

import { useRef, useState } from 'react';
import { gql, useApolloClient, useMutation } from '@apollo/client';
import { Download, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { saveBase64File } from '@/components/inventory/count-sheet-builder';
import { fileToBase64 } from '@/lib/file-base64';

const TEMPLATE = gql`query StockCountWorkbook($locationId: String!, $search: String) { stockCountWorkbook(locationId: $locationId, search: $search) }`;
const PREVIEW = gql`mutation PreviewStockCountWorkbook($filename: String!, $contentBase64: String!, $locationId: String!) { previewStockCountWorkbook(filename: $filename, contentBase64: $contentBase64, locationId: $locationId) }`;

/** Print or share a count sheet for one location, then upload what was counted to fill the session. */
export function StockCountExcel({ locationId, locationName, search, loadedLotIds, onApply }: { locationId: string; locationName: string; search: string; loadedLotIds: Set<string>; onApply: (counts: Record<string, string>) => void }) {
  const client = useApolloClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<any>(null);
  const [preview, { loading: previewing }] = useMutation(PREVIEW);
  const [notice, setNotice] = useState('');

  async function download() {
    setError('');
    setDownloading(true);
    try {
      const { data } = await client.query({ query: TEMPLATE, variables: { locationId, search: search || undefined }, fetchPolicy: 'network-only' });
      const file = data?.stockCountWorkbook;
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
    try {
      const response = await preview({ variables: { filename: file.name, contentBase64: await fileToBase64(file), locationId } });
      setResult(response.data?.previewStockCountWorkbook || null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The file could not be read.');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function apply() {
    const counts: any[] = result?.counts || [];
    // The session submits only lots shown on this screen (up to 500); say so rather than drop counts quietly.
    const offScreen = counts.filter((count) => !loadedLotIds.has(count.lotId));
    onApply(Object.fromEntries(counts.filter((count) => loadedLotIds.has(count.lotId)).map((count) => [count.lotId, String(count.counted)])));
    setNotice(offScreen.length ? `${offScreen.length} counted lots are not on screen (only 500 load at a time). Search by brand or code, submit, then upload the same sheet again for the rest.` : '');
    setResult(null);
  }

  return (
    <section className="mp-panel overflow-hidden" aria-labelledby="count-excel-title">
      <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-2xl">
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[var(--brand-700)]">Excel or CSV</p>
          <h2 id="count-excel-title" className="mt-1 text-xl font-black text-[var(--ink)]">Count on paper or in a spreadsheet</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--ink-3)]">Download every active lot at <b>{locationName || 'this location'}</b>{search ? ` matching “${search}”` : ''} with its book quantity. Fill <b>Counted</b>, upload, and the counts fill in below for review before you submit.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={download} disabled={downloading || !locationId}>{downloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}Download count sheet</Button>
          <Button type="button" onClick={() => inputRef.current?.click()} disabled={previewing || !locationId}>{previewing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}Upload counted sheet</Button>
          <input ref={inputRef} type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" aria-label="Upload counted stock sheet" onChange={(event) => upload(event.target.files?.[0])} />
        </div>
      </div>
      {notice ? <p role="status" className="mx-5 mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{notice}</p> : null}
      {error ? <p role="alert" className="mx-5 mb-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{error}</p> : null}
      {result ? (
        <div className="mx-5 mb-5 rounded-md border border-[var(--line)] bg-[var(--bg-soft)] p-4" role="status">
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--ink)]"><FileSpreadsheet className="h-4 w-4" aria-hidden="true" />{result.matchedCount} lots counted</span>
            <span className={result.varianceCount ? 'text-amber-800' : 'text-emerald-800'}>{result.varianceCount} differ from book</span>
            {result.errorCount ? <span className="text-rose-800">{result.errorCount} rows need fixing</span> : null}
          </p>
          {result.errors?.length ? <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-sm text-rose-900">{result.errors.map((item: any) => <li key={`${item.row}-${item.message}`}>Row {item.row}: {item.message}</li>)}</ul> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" onClick={apply} disabled={!result.matchedCount}>Fill {result.matchedCount} counts below</Button>
            <Button type="button" variant="ghost" onClick={() => setResult(null)}>Discard</Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
