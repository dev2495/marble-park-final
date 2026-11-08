'use client';

import { use, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { gql, useQuery } from '@apollo/client';
import { RefreshCw } from 'lucide-react';
import { Banner, ChartCard, Chip, DataTable, EmptyState, KpiGrid, PeriodSwitch } from '@/components/owner/kit';
import { QueryErrorBanner } from '@/components/query-state';
import { REPORTS } from '../report-config';

const REPORT = gql`query OwnerReport($kind: String!, $filters: OwnerReportFilters) { ownerReport(kind: $kind, filters: $filters) }`;
const OPTIONS = gql`query OwnerReportOptions { ownerReportOptions }`;
const select = 'min-h-11 min-w-0 flex-1 rounded-[10px] border border-[var(--line)] bg-[var(--surface)] px-3 text-[13px] text-[var(--ink-2)] md:min-w-[150px] md:flex-none';

export default function ReportPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const router = useRouter();
  const config = REPORTS.find((report) => report.slug === slug);
  const [filters, setFilters] = useState<Record<string, string | undefined>>({});
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    setFilters(Object.fromEntries(['preset', 'from', 'to', 'brand', 'category', 'ownerId', 'locationId', 'tab'].map((key) => [key, query.get(key) || undefined])));
    setReady(true);
  }, [slug]);
  const clean = useMemo(() => Object.fromEntries(Object.entries(filters).filter(([, value]) => value)), [filters]);
  const customPending = clean.preset === 'custom' && !(clean.from && clean.to);
  const { data: optionData } = useQuery(OPTIONS, { fetchPolicy: 'cache-first' });
  const { data, previousData, loading, error, refetch } = useQuery(REPORT, { variables: { kind: slug, filters: clean }, skip: !ready || !config || customPending, fetchPolicy: 'cache-and-network' });
  const report = (data || previousData)?.ownerReport;
  const live = report?.kind === slug ? report : null;
  const options = optionData?.ownerReportOptions;
  function update(next: Record<string, string | undefined>) {
    const merged = { ...filters, ...next };
    setFilters(merged);
    const query = new URLSearchParams(Object.entries(merged).filter(([, value]) => value) as Array<[string, string]>).toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  }
  if (!config) return <EmptyState empty={{ title: 'Report not found', body: 'Choose a report from the list.' }} />;
  const asOf = live ? new Date(live.asOf).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '';
  const charts: any[] = live?.charts || [];
  const full = charts.filter((chart) => chart.span === 'full');
  const paired = charts.filter((chart) => chart.span !== 'full');
  const even = paired.some((chart) => chart.span === 'even') || (paired.length === 2 && paired[0].span !== 2);
  return (
    <div className="space-y-[18px] pb-12" key={slug}>
      <header>
        <p className="mb-1.5 text-xs text-[var(--ink-4)]">{config.group}</p>
        <div className="flex items-start justify-between gap-3">
          <h1 className="font-display text-[clamp(24px,3.2vw,32px)] font-semibold leading-[1.15] text-[var(--ink)]">{config.question}</h1>
          <button type="button" onClick={() => refetch()} aria-label="Refresh report" className="grid h-11 w-11 shrink-0 place-items-center rounded-[10px] border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-3)]"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /></button>
        </div>
        <p className="mt-1.5 max-w-[70ch] text-sm text-[var(--ink-3)]">{config.why}</p>
        {config.period || config.brand || config.category || config.owner || config.location ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {config.period ? <PeriodSwitch value={filters.preset || 'month'} onChange={(preset) => update({ preset })} /> : null}
            {config.period && filters.preset === 'custom' ? <><input type="date" aria-label="From date" value={filters.from || ''} onChange={(event) => update({ from: event.target.value })} className={select} /><input type="date" aria-label="To date" value={filters.to || ''} onChange={(event) => update({ to: event.target.value })} className={select} /></> : null}
            {config.brand ? <select aria-label="Brand" value={filters.brand || ''} onChange={(event) => update({ brand: event.target.value || undefined })} className={select}><option value="">All brands</option>{(options?.brands || []).map((name: string) => <option key={name} value={name}>{name}</option>)}</select> : null}
            {config.category ? <select aria-label="Category" value={filters.category || ''} onChange={(event) => update({ category: event.target.value || undefined })} className={select}><option value="">All categories</option>{(options?.categories || []).map((name: string) => <option key={name} value={name}>{name}</option>)}</select> : null}
            {config.owner && options?.owners?.length ? <select aria-label="Salesperson" value={filters.ownerId || ''} onChange={(event) => update({ ownerId: event.target.value || undefined })} className={select}><option value="">All salespeople</option>{options.owners.map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}</select> : null}
            {config.location && (options?.locations?.length || 0) > 1 ? <select aria-label="Location" value={filters.locationId || ''} onChange={(event) => update({ locationId: event.target.value || undefined })} className={select}><option value="">All locations</option>{options.locations.map((row: any) => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}</select> : null}
          </div>
        ) : null}
      </header>
      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
      {customPending ? <p className="text-sm text-[var(--ink-3)]">Choose both dates to see this period.</p> : null}
      {!live && loading ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="ox-card h-[116px] animate-pulse bg-[var(--bg-soft)] motion-reduce:animate-none" />)}</div> : null}
      {live ? <div className={`space-y-[18px] transition-opacity ${loading ? 'opacity-70' : ''}`}>
        {(live.notices || []).map((notice: any, index: number) => <Banner key={index} notice={notice} />)}
        <KpiGrid kpis={live.kpis} />
        {live.empty ? <EmptyState empty={live.empty} /> : <>
          {live.tabs?.length ? <div className="flex gap-1 overflow-x-auto border-b border-[var(--line)]" role="tablist">{live.tabs.map((tab: any) => <button key={tab.id} type="button" role="tab" aria-selected={tab.id === live.tab} onClick={() => update({ tab: tab.id })} className={`-mb-px min-h-11 whitespace-nowrap border-b-2 px-3 text-[13.5px] ${tab.id === live.tab ? 'border-[var(--ox-brand)] font-medium text-[var(--ox-brand-text)]' : 'border-transparent text-[var(--ink-3)]'}`}>{tab.label}{tab.count != null ? <span className="ml-1 text-[var(--ink-4)]">{Number(tab.count).toLocaleString('en-IN')}</span> : null}</button>)}</div> : null}
          {live.tabNote ? <div className="flex items-center gap-2"><Chip value={live.tabNote.severity} /><span className="text-xs text-[var(--ink-4)]">{live.tabNote.text}</span></div> : null}
          <div className="ox-enter space-y-[18px]" key={`${live.tab || ''}`}>
            {paired.length ? <div className={`grid gap-4 ${paired.length > 1 ? (even ? 'lg:grid-cols-2' : 'lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]') : ''}`}>{paired.map((chart) => <ChartCard key={chart.key} chart={chart} />)}</div> : null}
            {full.map((chart) => <ChartCard key={chart.key} chart={chart} onHeat={(brand, category) => router.push(`/dashboard/inventory?brand=${encodeURIComponent(brand)}&category=${encodeURIComponent(category)}`)} />)}
            {live.table ? <DataTable kind={slug} filters={clean} table={live.table} /> : null}
          </div>
        </>}
        <p className="flex flex-wrap gap-2.5 text-xs text-[var(--ink-4)]"><span>As of {asOf}</span><span>·</span><span>Data since {live.dataSince}</span></p>
      </div> : null}
    </div>
  );
}
