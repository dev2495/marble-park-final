'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { gql, useMutation } from '@apollo/client';
import { AlertTriangle, ArrowRight, ArrowUpRight, Clock, Download, Inbox, Loader2, Search } from 'lucide-react';
import { saveBase64File } from '@/components/inventory/count-sheet-builder';
import { BarsChart, DonutChart, HBarChart, Heatmap, Legend, ScatterPlot } from './charts';

const EXPORT = gql`mutation ExportOwnerReport($kind: String!, $filters: OwnerReportFilters) { exportOwnerReport(kind: $kind, filters: $filters) }`;

export function inr(value: number | null | undefined, compact = true) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  const abs = Math.abs(Number(value));
  if (compact && abs >= 1e7) return `₹${(Number(value) / 1e7).toFixed(2)} Cr`;
  if (compact && abs >= 1e5) return `₹${(Number(value) / 1e5).toFixed(1)} L`;
  return `₹${Math.round(Number(value)).toLocaleString('en-IN')}`;
}
export const pct = (value: number | null | undefined, digits = 0) => (value == null || Number.isNaN(Number(value)) ? '—' : `${(Number(value) * 100).toFixed(digits)}%`);
export const num = (value: number | null | undefined) => (value == null ? '—' : Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 }));

export function formatKpi(value: any, format?: string) {
  if (format === 'text') return String(value ?? '—');
  if (format === 'inr') return inr(value);
  if (format === 'pct') return pct(value);
  if (format === 'pct1') return pct(value, 1);
  return num(value);
}

function CountUp({ value, format }: { value: any; format?: string }) {
  const final = formatKpi(value, format);
  const [shown, setShown] = useState(final);
  const previous = useRef<number>(0);
  useEffect(() => {
    const target = Number(value);
    if (format === 'text' || value == null || !Number.isFinite(target) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setShown(final); return; }
    const from = previous.current; const started = performance.now(); let frame = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - started) / 900); const eased = 1 - (1 - p) ** 3;
      const current = from + (target - from) * eased;
      setShown(p < 1 ? formatKpi(format === 'num' ? Math.round(current) : current, format) : final);
      if (p < 1) frame = requestAnimationFrame(step); else previous.current = target;
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, format, final]);
  return <>{shown}</>;
}

export function KpiCard({ kpi, index = 0, small = false }: { kpi: any; index?: number; small?: boolean }) {
  const body = <>
    <div className="flex items-start justify-between gap-2"><p className="text-[13px] leading-4 text-[var(--ink-4)]">{kpi.label}</p>{kpi.href ? <ArrowUpRight className="h-4 w-4 shrink-0 text-[var(--ink-4)] opacity-60" aria-hidden="true" /> : null}</div>
    <p className={`ox-num mt-2 truncate leading-tight text-[var(--ink)] ${small ? 'text-[22px]' : 'text-[clamp(24px,2.3vw,30px)]'}`}><CountUp value={kpi.value} format={kpi.format} /></p>
    <p className="mt-1.5 text-xs leading-4 text-[var(--ink-4)]">{kpi.delta != null ? <span className={`mr-1.5 font-semibold ${kpi.delta >= 0 ? 'text-[var(--ox-ok)]' : 'text-[var(--ox-bad)]'}`}>{kpi.delta >= 0 ? '▲' : '▼'} {Math.abs(kpi.delta * 100).toFixed(0)}%</span> : null}{kpi.sub}</p>
  </>;
  const cls = `ox-card ox-lift block min-w-0 ${small ? 'p-3.5' : 'min-h-[116px] p-4'} ${kpi.warn ? 'ring-1 ring-inset ring-[var(--ox-warn)]/45' : ''}`;
  const style = { animationDelay: `${Math.min(index, 12) * 45}ms` };
  return kpi.href ? <Link href={kpi.href} className={cls} style={style}>{body}</Link> : <div className={cls} style={style}>{body}</div>;
}

export function KpiGrid({ kpis, className = 'grid-cols-2 md:grid-cols-3 xl:grid-cols-5', small }: { kpis: any[]; className?: string; small?: boolean }) {
  return <div className={`ox-stagger grid gap-3 ${className}`}>{kpis.map((kpi, index) => <KpiCard key={kpi.key} kpi={kpi} index={index} small={small} />)}</div>;
}

export function Banner({ notice }: { notice: any }) {
  const partial = notice.level === 'partial';
  return (
    <div className={`flex items-start gap-3 rounded-[10px] border p-3 text-[13px] ${partial ? 'border-[var(--ox-warn)]/30 bg-[var(--ox-warn-bg)] text-[var(--ink-2)]' : 'border-[var(--line)] bg-[var(--surface-2)] text-[var(--ink-3)]'}`} role={partial ? 'status' : undefined}>
      {partial ? <AlertTriangle className="mt-px h-4 w-4 shrink-0 text-[var(--ox-warn)]" aria-hidden="true" /> : <Clock className="mt-px h-4 w-4 shrink-0" aria-hidden="true" />}
      <p>{notice.text}{notice.href ? <> <Link href={notice.href} className="font-medium text-[var(--ox-brand-text)] underline underline-offset-2">{notice.action || 'Open'}</Link></> : null}</p>
    </div>
  );
}

export function EmptyState({ empty }: { empty: any }) {
  return (
    <div className="ox-card px-5 py-14 text-center">
      <div className="mx-auto mb-3.5 grid h-14 w-14 place-items-center rounded-2xl bg-[var(--bg-soft)] text-[var(--ink-4)]"><Inbox className="h-6 w-6" aria-hidden="true" /></div>
      <h2 className="font-display text-xl font-medium text-[var(--ink)]">{empty.title}</h2>
      <p className="mx-auto mt-2 max-w-md text-[13.5px] text-[var(--ink-3)]">{empty.body}</p>
      {empty.href ? <Link href={empty.href} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-[10px] border border-[var(--line)] bg-[var(--surface)] px-4 text-[13.5px] font-medium text-[var(--ink-2)]">{empty.action}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link> : null}
    </div>
  );
}

export function ChartCard({ chart, onHeat }: { chart: any; onHeat?: (row: string, col: string) => void }) {
  const legend = chart.legend || (chart.type === 'bars' ? [...(chart.series || []).map((s: any) => ({ name: s.name, color: s.color })), ...(chart.line ? [{ name: `${chart.line.name} %`, color: 'c2' }] : [])] : null);
  const hasData = chart.type === 'bars' ? chart.series.some((s: any) => s.data.some((v: number) => v > 0)) || chart.line?.data.some((v: number) => v > 0)
    : chart.type === 'hbar' ? chart.rows.some((r: any) => r.v > 0 || r.g > 0) : chart.type === 'donut' ? chart.slices.some((s: any) => s.v > 0) : chart.type === 'scatter' ? chart.pts.length > 0 : chart.rows?.length > 0;
  const head = <><h3 className="font-display text-base font-semibold text-[var(--ink)]">{chart.title}</h3>{chart.sub ? <p className="mt-0.5 text-xs text-[var(--ink-4)]">{chart.sub}</p> : null}</>;
  return (
    <section className="ox-card ox-lift min-w-0 p-4 sm:p-[18px]">
      {chart.href ? <Link href={chart.href} className="group block">{head}</Link> : head}
      {!hasData ? <div className="grid min-h-[170px] place-items-center text-center text-[13px] text-[var(--ink-4)]">Nothing to show yet</div>
        : chart.type === 'bars' ? <><BarsChart {...chart} />{legend ? <Legend items={legend} /> : null}</>
          : chart.type === 'hbar' ? <><HBarChart {...chart} />{legend ? <Legend items={legend} /> : null}</>
            : chart.type === 'donut' ? <DonutChart {...chart} />
              : chart.type === 'scatter' ? <ScatterPlot {...chart} />
                : <Heatmap {...chart} onPick={onHeat} />}
      {chart.foot ? <p className="mt-2 text-center text-xs text-[var(--ink-4)]">{chart.foot}</p> : null}
    </section>
  );
}

const CHIP: Record<string, string> = { confirmed: 'ok', won: 'ok', sent: 'brand', draft: 'mute', superseded: 'mute', incomplete_pricing: 'warn', 'Ran out': 'bad', 'Running low': 'warn', 'Catalogue only': 'mute', Healthy: 'ok', Open: 'warn', Quoted: 'brand', Confirmed: 'ok', Closed: 'mute', Overdue: 'bad', Due: 'brand', Blocking: 'bad', Warning: 'warn', Info: 'mute' };
const CHIP_STYLE: Record<string, string> = { ok: 'bg-[var(--ox-ok-bg)] text-[var(--ox-ok)]', warn: 'bg-[var(--ox-warn-bg)] text-[var(--ox-warn)]', bad: 'bg-[var(--ox-bad-bg)] text-[var(--ox-bad)]', brand: 'bg-[var(--ox-brand-soft)] text-[var(--ox-brand-text)]', mute: 'bg-[var(--bg-soft)] text-[var(--ink-4)]' };
export function Chip({ value }: { value: string }) {
  const label = value === 'incomplete_pricing' ? 'Incomplete pricing' : String(value).replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${CHIP_STYLE[CHIP[value] || 'mute']}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{label}</span>;
}

const NUMERIC = ['inr', 'pct', 'num'];
function Cell({ column, row }: { column: any; row: any }) {
  const value = row[column.key];
  if (column.kind === 'chip') return value ? <Chip value={value} /> : <span className="text-[var(--ink-4)]">—</span>;
  if (value == null || value === '') return <span className="text-[var(--ink-4)]">—</span>;
  if (column.kind === 'inr') return <>{inr(value, false)}</>;
  if (column.kind === 'pct') return <>{pct(value, column.d ?? 0)}</>;
  if (column.kind === 'num') return <>{num(value)}</>;
  return <>{String(value)}</>;
}

export function DataTable({ kind, filters, table }: { kind: string; filters: any; table: any }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: number } | null>(null);
  const [page, setPage] = useState(0);
  const [exportFile, { loading: exporting, error: exportError }] = useMutation(EXPORT);
  useEffect(() => { setPage(0); setQuery(''); setSort(null); }, [table]);
  const pageSize = 25;
  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    let list = term ? table.rows.filter((row: any) => table.columns.some((c: any) => String(row[c.key] ?? '').toLowerCase().includes(term) || (c.sub && String(row[c.sub] ?? '').toLowerCase().includes(term)))) : table.rows;
    if (sort) list = [...list].sort((a: any, b: any) => { const x = a[sort.key]; const y = b[sort.key]; if (x == null) return 1; if (y == null) return -1; return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.dir; });
    return list;
  }, [table, query, sort]);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pages - 1);
  const slice = rows.slice(current * pageSize, (current + 1) * pageSize);
  async function excel() {
    const result = await exportFile({ variables: { kind, filters } }).catch(() => null);
    const file = result?.data?.exportOwnerReport;
    if (file) saveBase64File(file.filename, file.mimeType, file.contentBase64);
  }
  function csv() {
    const cols = table.columns.flatMap((c: any) => (c.sub ? [c, { key: c.sub, label: c.sub }] : [c]));
    const text = [cols.map((c: any) => JSON.stringify(c.label)).join(','), ...rows.map((row: any) => cols.map((c: any) => JSON.stringify(row[c.key] ?? '')).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([`﻿${text}`], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = `marble-park-${table.exportName}.csv`; a.click(); URL.revokeObjectURL(url);
  }
  return (
    <section className="ox-card min-w-0 overflow-hidden" aria-label={table.title}>
      <div className="flex flex-wrap items-center gap-2.5 border-b border-[var(--line)] px-4 py-3.5">
        <strong className="text-sm text-[var(--ink)]">{table.title}</strong>
        <label className="flex h-10 min-w-[150px] max-w-[280px] flex-1 items-center rounded-[10px] border border-[var(--line)] px-3"><Search className="mr-2 h-4 w-4 text-[var(--ink-4)]" aria-hidden="true" /><input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="Search list…" aria-label={`Search ${table.title}`} className="w-full bg-transparent text-[13px] text-[var(--ink)] outline-none" /></label>
        <span className="ml-auto text-[12.5px] text-[var(--ink-4)]">{num(rows.length)} rows</span>
        <button type="button" onClick={excel} disabled={exporting || !table.rows.length} className="inline-flex h-10 items-center gap-1.5 rounded-[10px] bg-[var(--ox-brand)] px-3.5 text-[13px] font-medium text-white disabled:opacity-50">{exporting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}Excel</button>
        <button type="button" onClick={csv} disabled={!rows.length} className="inline-flex h-10 items-center rounded-[10px] border border-[var(--line)] bg-[var(--surface)] px-3.5 text-[13px] font-medium text-[var(--ink-2)] disabled:opacity-50">CSV</button>
      </div>
      {exportError ? <p role="alert" className="px-4 pt-2 text-[13px] text-[var(--ox-bad)]">{exportError.message}</p> : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-[13px]">
          <thead><tr>{table.columns.map((column: any) => <th key={column.key} scope="col" className="whitespace-nowrap border-b border-[var(--line)] bg-[var(--surface-2)] p-0 text-xs font-medium text-[var(--ink-4)]"><button type="button" onClick={() => { setPage(0); setSort((s) => (s && s.key === column.key ? { key: column.key, dir: -s.dir } : { key: column.key, dir: -1 })); }} aria-sort={undefined} className={`flex min-h-10 w-full items-center gap-1 px-3.5 py-2.5 ${NUMERIC.includes(column.kind) ? 'justify-end' : ''} ${sort?.key === column.key ? 'text-[var(--ink)]' : ''}`}>{column.label}{sort && sort.key === column.key ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''}</button></th>)}</tr></thead>
          <tbody>
            {slice.map((row: any, index: number) => <tr key={row.id || row.href || index} tabIndex={row.href ? 0 : undefined} onClick={() => row.href && router.push(row.href)} onKeyDown={(event) => { if (event.key === 'Enter' && row.href) router.push(row.href); }} className={`border-b border-[var(--line)] transition-colors hover:bg-[var(--surface-2)] ${row.href ? 'cursor-pointer' : ''}`}>
              {table.columns.map((column: any) => <td key={column.key} className={`whitespace-nowrap px-3.5 py-2.5 align-middle text-[var(--ink-2)] ${NUMERIC.includes(column.kind) ? 'text-right' : ''} ${column.mono ? 'font-mono text-[12.5px] text-[var(--ink-3)]' : ''}`}><Cell column={column} row={row} />{column.sub && row[column.sub] ? <span className="mt-px block max-w-[320px] truncate text-xs font-normal text-[var(--ink-4)]">{row[column.sub]}</span> : null}</td>)}
            </tr>)}
            {!slice.length ? <tr><td colSpan={table.columns.length} className="px-4 py-9 text-center text-[var(--ink-4)]">{query ? 'Nothing matches your search' : table.empty || 'Nothing here yet'}</td></tr> : null}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-[12.5px] text-[var(--ink-4)]"><span>Page {current + 1} of {pages}</span><span className="ml-auto" /><button type="button" disabled={current === 0} onClick={() => setPage(current - 1)} className="h-10 rounded-[10px] border border-[var(--line)] px-3 disabled:opacity-40">‹ Prev</button><button type="button" disabled={current >= pages - 1} onClick={() => setPage(current + 1)} className="h-10 rounded-[10px] border border-[var(--line)] px-3 disabled:opacity-40">Next ›</button></div>
    </section>
  );
}

export function PeriodSwitch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const options = [['today', 'Today'], ['week', 'Week'], ['month', 'Month'], ['quarter', 'Quarter'], ['custom', 'Custom']];
  return <div className="inline-flex max-w-full gap-0.5 overflow-x-auto rounded-[10px] border border-[var(--line)] bg-[var(--bg-soft)] p-[3px]" role="radiogroup" aria-label="Period">{options.map(([id, label]) => <button key={id} type="button" role="radio" aria-checked={value === id} onClick={() => onChange(id)} className={`min-h-[38px] whitespace-nowrap rounded-lg px-2 text-xs transition-colors sm:px-3 sm:text-[13px] ${value === id ? 'bg-[var(--surface)] font-medium text-[var(--ink)] shadow-sm' : 'text-[var(--ink-3)]'}`}>{label}</button>)}</div>;
}
