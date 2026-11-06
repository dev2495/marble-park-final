'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { gql, useApolloClient, useQuery } from '@apollo/client';
import { Check, ChevronLeft, ChevronRight, Download, Loader2, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDebouncedValue } from '@/hooks/use-debounced-value';

const OPTIONS = gql`query CountSheetOptions { countSheetOptions }`;
const CANDIDATES = gql`query CountSheetCandidates($filter: CountSheetFilterInput, $skip: Int, $take: Int) { countSheetCandidates(filter: $filter, skip: $skip, take: $take) }`;
const TEMPLATE = gql`query OpeningStockWorkbook($filter: CountSheetFilterInput) { openingStockWorkbook(filter: $filter) }`;

const PAGE = 50;
const MAX_ROWS = 6000;

export function saveBase64File(filename: string, mimeType: string, contentBase64: string) {
  const bytes = Uint8Array.from(atob(contentBase64), (char) => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function Chips({ label, items, selected, onToggle }: { label: string; items: Array<{ name: string; count: number }>; selected: string[]; onToggle: (name: string) => void }) {
  const [filter, setFilter] = useState('');
  const visible = items.filter((item) => item.name.toLowerCase().includes(filter.toLowerCase()));
  return (
    <fieldset className="min-w-0">
      <legend className="flex w-full items-center justify-between text-xs font-bold uppercase tracking-wider text-[var(--ink-4)]">{label}{selected.length ? <span className="normal-case tracking-normal text-[var(--brand-700)]">{selected.length} chosen</span> : null}</legend>
      {items.length > 8 ? <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder={`Find ${label.toLowerCase()}…`} aria-label={`Find ${label.toLowerCase()}`} className="mt-2 h-9 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)]" /> : null}
      <div className="mt-2 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
        {visible.map((item) => {
          const on = selected.includes(item.name);
          return <button key={item.name} type="button" aria-pressed={on} onClick={() => onToggle(item.name)} className={`h-8 rounded-full border px-3 text-xs font-semibold ${on ? 'border-[var(--ink)] bg-[var(--ink)] text-[var(--surface)]' : 'border-[var(--line)] bg-[var(--surface)] text-[var(--ink-3)] hover:border-[var(--line-strong)]'}`}>{item.name} <span className="opacity-70">{item.count.toLocaleString('en-IN')}</span></button>;
        })}
        {!visible.length ? <p className="text-xs text-[var(--ink-4)]">No match.</p> : null}
      </div>
    </fieldset>
  );
}

/**
 * Pick exactly which products go on a count sheet: filter by text, category
 * and brand, then take everything that matches or tick individual items.
 */
export function CountSheetBuilder({ onClose }: { onClose: () => void }) {
  const client = useApolloClient();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
  const [mode, setMode] = useState<'all' | 'picked'>('all');
  const [picked, setPicked] = useState<Map<string, any>>(new Map());
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const debounced = useDebouncedValue(search.trim(), 300);
  const filter = useMemo(() => ({ search: debounced || undefined, categories: categories.length ? categories : undefined, brands: brands.length ? brands : undefined }), [debounced, categories, brands]);
  const { data: optionData } = useQuery(OPTIONS);
  const { data, loading } = useQuery(CANDIDATES, { variables: { filter, skip: page * PAGE, take: PAGE }, fetchPolicy: 'cache-and-network' });
  const total: number = data?.countSheetCandidates?.total ?? 0;
  const rows: any[] = data?.countSheetCandidates?.rows || [];
  const sheetCount = mode === 'all' ? Math.max(0, total - excluded.size) : picked.size;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  useEffect(() => { setPage(0); setExcluded(new Set()); }, [filter]);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>('input')?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); opener?.focus?.(); };
  }, [onClose]);

  const toggle = (list: string[], set: (next: string[]) => void, name: string) => set(list.includes(name) ? list.filter((item) => item !== name) : [...list, name]);
  const isOn = (row: any) => (mode === 'all' ? !excluded.has(row.id) : picked.has(row.id));
  function toggleRow(row: any) {
    if (mode === 'all') {
      setExcluded((current) => { const next = new Set(current); if (next.has(row.id)) next.delete(row.id); else next.add(row.id); return next; });
    } else {
      setPicked((current) => { const next = new Map(current); if (next.has(row.id)) next.delete(row.id); else next.set(row.id, row); return next; });
    }
  }
  function pickPage(on: boolean) {
    if (mode === 'all') setExcluded((current) => { const next = new Set(current); rows.forEach((row) => (on ? next.delete(row.id) : next.add(row.id))); return next; });
    else setPicked((current) => { const next = new Map(current); rows.forEach((row) => (on ? next.set(row.id, row) : next.delete(row.id))); return next; });
  }

  async function download() {
    setError('');
    setDownloading(true);
    try {
      const sheetFilter = mode === 'all'
        ? { ...filter, excludeIds: excluded.size ? Array.from(excluded) : undefined }
        : { productIds: Array.from(picked.keys()) };
      const { data: file } = await client.query({ query: TEMPLATE, variables: { filter: sheetFilter }, fetchPolicy: 'network-only' });
      const result = file?.openingStockWorkbook;
      if (!result?.contentBase64) throw new Error('The sheet could not be created.');
      saveBase64File(result.filename, result.mimeType, result.contentBase64);
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The sheet could not be downloaded.');
    } finally {
      setDownloading(false);
    }
  }

  const tooMany = sheetCount > MAX_ROWS;
  return createPortal(
    <div className="fixed inset-0 z-[10000] grid place-items-center bg-black/60 p-3 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="count-sheet-title" className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-r5 border border-[var(--line)] bg-[var(--surface)] shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-3">
          <div>
            <h2 id="count-sheet-title" className="font-display text-xl font-semibold text-[var(--ink)]">Build a count sheet</h2>
            <p className="text-sm text-[var(--ink-3)]">Filter, then take everything that matches or tick only the items you want.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-11 w-11 place-items-center rounded-full border border-[var(--line)] hover:bg-[var(--bg-soft)]"><X className="h-5 w-5" /></button>
        </div>
        <div className="grid min-h-0 flex-1 gap-0 overflow-hidden lg:grid-cols-[19rem_minmax(0,1fr)]">
          <aside className="space-y-5 overflow-y-auto border-b border-[var(--line)] p-5 lg:border-b-0 lg:border-r">
            <label className="block">
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--ink-4)]">Search</span>
              <span className="mt-2 flex h-10 items-center rounded-md border border-[var(--line)] px-3"><Search className="mr-2 h-4 w-4 text-[var(--ink-4)]" aria-hidden="true" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Code, name or brand" className="min-w-0 flex-1 bg-transparent text-sm text-[var(--ink)] outline-none" /></span>
            </label>
            <Chips label="Category" items={optionData?.countSheetOptions?.categories || []} selected={categories} onToggle={(name) => toggle(categories, setCategories, name)} />
            <Chips label="Brand" items={optionData?.countSheetOptions?.brands || []} selected={brands} onToggle={(name) => toggle(brands, setBrands, name)} />
            {(search || categories.length || brands.length) ? <Button type="button" variant="ghost" size="sm" onClick={() => { setSearch(''); setCategories([]); setBrands([]); }}>Clear filters</Button> : null}
          </aside>
          <section className="flex min-h-0 flex-col" aria-label="Products on the sheet">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] px-5 py-3">
              <div className="flex rounded-full border border-[var(--line)] p-0.5" role="radiogroup" aria-label="What goes on the sheet">
                {([['all', `All ${total.toLocaleString('en-IN')} matching`], ['picked', `Only ticked (${picked.size})`]] as const).map(([value, label]) => (
                  <button key={value} type="button" role="radio" aria-checked={mode === value} onClick={() => setMode(value)} className={`h-9 rounded-full px-4 text-sm font-semibold ${mode === value ? 'bg-[var(--ink)] text-[var(--surface)]' : 'text-[var(--ink-3)]'}`}>{label}</button>
                ))}
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => pickPage(true)} disabled={!rows.length}>Tick this page</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => pickPage(false)} disabled={!rows.length}>Untick this page</Button>
              </div>
            </div>
            <ul className="min-h-0 flex-1 divide-y divide-[var(--line)] overflow-y-auto" aria-busy={loading}>
              {rows.map((row) => {
                const on = isOn(row);
                return (
                  <li key={row.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-5 py-2.5 hover:bg-[var(--bg-soft)]">
                      <input type="checkbox" checked={on} onChange={() => toggleRow(row)} className="h-5 w-5 accent-[#9d2a24]" />
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-sm font-semibold ${String(row.name || '').trim() ? 'text-[var(--ink)]' : 'text-amber-800'}`}>{String(row.name || '').trim() || 'Name missing in Product Master'}</span>
                        <span className="block truncate text-xs text-[var(--ink-4)]">{row.internalCode || row.sku} · {row.brand || 'No brand'} · {row.category}{row.dimensions ? ` · ${row.dimensions}` : ''}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
              {!loading && !rows.length ? <li className="p-8 text-center text-sm text-[var(--ink-3)]">No active products match these filters.</li> : null}
            </ul>
            <div className="flex items-center justify-between border-t border-[var(--line)] px-5 py-2 text-sm text-[var(--ink-3)]">
              <Button type="button" variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft className="mr-1 h-4 w-4" />Previous</Button>
              <span>Page {page + 1} of {pages}</span>
              <Button type="button" variant="ghost" size="sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next<ChevronRight className="ml-1 h-4 w-4" /></Button>
            </div>
          </section>
        </div>
        <div className="flex flex-col gap-2 border-t border-[var(--line)] bg-[var(--bg-soft)] px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-[var(--ink-2)]" aria-live="polite"><Check className="mr-1 inline h-4 w-4 align-[-3px]" aria-hidden="true" /><b>{sheetCount.toLocaleString('en-IN')}</b> products will be on the sheet{tooMany ? ` · narrow to ${MAX_ROWS.toLocaleString('en-IN')} or fewer` : ''}{mode === 'all' && excluded.size ? ` (${excluded.size} unticked)` : ''}.</p>
          {error ? <p role="alert" className="text-sm text-rose-800">{error}</p> : null}
          <Button type="button" onClick={download} disabled={downloading || !sheetCount || tooMany}>{downloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}Download sheet</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
