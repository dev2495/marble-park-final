'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { gql, useLazyQuery, useQuery } from '@apollo/client';
import {
  Activity, AlertTriangle, ArrowRight, ChevronDown, ChevronRight, Clock3, Download,
  ExternalLink, FileClock, Filter, History, PackageSearch, Printer, RefreshCcw,
  Search, ShieldCheck, SlidersHorizontal, UserRoundCheck, X,
} from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { QueryErrorBanner, QueryLoading } from '@/components/query-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const AUDIT_WORKSPACE = gql`
  query AuditWorkspace($filters: AuditFiltersInput, $cursor: String, $range: String!, $from: DateTime, $to: DateTime) {
    auditEvents(filters: $filters, take: 50, cursor: $cursor) {
      events { id actorUserId action entityType entityId summary metadata critical createdAt actor }
      nextCursor
      total
    }
    auditStats(range: $range)
    auditFacets(from: $from, to: $to)
  }
`;

const MRP_HISTORY = gql`
  query MrpAuditRegister($search: String, $actorUserId: String, $from: String, $to: String, $skip: Int, $take: Int) {
    productMrpHistoryPage(search: $search, actorUserId: $actorUserId, from: $from, to: $to, skip: $skip, take: $take)
  }
`;

const AUDIT_CSV = gql`
  query AuditExport($filters: AuditFiltersInput) { auditEventsCsv(filters: $filters, take: 5000) }
`;

const ranges = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: '7 days' },
  { value: 'month', label: '30 days' },
  { value: 'quarter', label: '90 days' },
  { value: 'all', label: 'All history' },
];

function dateWindow(range: string) {
  const to = new Date();
  if (range === 'all') return { from: undefined, to: undefined };
  const from = new Date(to);
  const days = range === 'today' ? 0 : range === 'week' ? 7 : range === 'month' ? 30 : 90;
  from.setDate(from.getDate() - days);
  from.setHours(0, 0, 0, 0);
  return { from: from.toISOString(), to: to.toISOString() };
}

function fmtDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown time' : date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function money(value: unknown) {
  return value == null ? '—' : `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function actionLabel(value: string) {
  return String(value || '').replace(/[._-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function sourceRoute(event: any) {
  const type = String(event?.entityType || '').toLowerCase();
  const id = encodeURIComponent(String(event?.entityId || ''));
  if (type === 'quote') return `/dashboard/quotes/${id}`;
  if (type.includes('purchaseorder')) return `/dashboard/procurement?view=purchase-orders&search=${id}`;
  if (type.includes('goodsreceipt') || type === 'grn') return `/dashboard/procurement?view=history&search=${id}`;
  if (type === 'product') return `/dashboard/master-data/products?selected=${id}`;
  if (type.includes('tiledesign') || type.includes('tilevariant')) return '/dashboard/master-data/tiles';
  if (type.includes('brand')) return '/dashboard/master-data/brands';
  if (type.includes('finish')) return '/dashboard/master-data/finishes';
  if (type.includes('category')) return '/dashboard/master-data/categories';
  if (type.includes('tilesize')) return '/dashboard/master-data/tile-sizes';
  if (type.includes('inventory') || type.includes('stock')) return '/dashboard/inventory/ledger';
  if (type.includes('user') || type.includes('role')) return '/dashboard/users';
  return null;
}

const secretPattern = /(password|secret|token|cookie|authorization|credential|hash)/i;

function displayValue(key: string, value: unknown) {
  if (secretPattern.test(key)) return '[protected]';
  if (value === null || value === undefined || value === '') return '—';
  const rendered = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return rendered.length > 240 ? `${rendered.slice(0, 237)}…` : rendered;
}

function changedFields(metadata: any) {
  const before = metadata?.before && typeof metadata.before === 'object' ? metadata.before : {};
  const after = metadata?.after && typeof metadata.after === 'object' ? metadata.after : {};
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  const changes = keys.filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])).map((key) => ({
    key,
    before: displayValue(key, before[key]),
    after: displayValue(key, after[key]),
  }));
  if (changes.length) return changes.slice(0, 40);
  return Object.entries(metadata || {})
    .filter(([key]) => !['before', 'after'].includes(key))
    .slice(0, 20)
    .map(([key, value]) => ({ key, before: '—', after: displayValue(key, value) }));
}

function downloadText(filename: string, value: string) {
  const url = URL.createObjectURL(new Blob([value], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function EmptyState({ icon: Icon = FileClock, title, detail }: { icon?: any; title: string; detail: string }) {
  return <div className="grid min-h-56 place-items-center px-6 py-12 text-center"><div><Icon className="mx-auto h-7 w-7 text-[var(--ink-5)]" /><p className="mt-4 font-semibold text-[var(--ink)]">{title}</p><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--ink-4)]">{detail}</p></div></div>;
}

export default function AuditWorkspacePage() {
  const [tab, setTab] = useState<'events' | 'mrp'>('events');
  const [range, setRange] = useState('month');
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const [actorUserId, setActorUserId] = useState('');
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [expandedId, setExpandedId] = useState('');
  const [mrpSkip, setMrpSkip] = useState(0);
  const [exportAudit, exportState] = useLazyQuery(AUDIT_CSV, { fetchPolicy: 'no-cache' });
  const window = useMemo(() => dateWindow(range), [range]);
  const filters = useMemo(() => ({
    ...(search ? { search } : {}),
    ...(entityType ? { entityType } : {}),
    ...(action ? { action } : {}),
    ...(actorUserId ? { actorUserId } : {}),
    ...(criticalOnly ? { criticalOnly: true } : {}),
    ...(window.from ? { from: window.from, to: window.to } : {}),
  }), [search, entityType, action, actorUserId, criticalOnly, window]);

  useEffect(() => {
    const params = new URLSearchParams(globalThis.location?.search || '');
    const requestedTab = params.get('tab');
    if (requestedTab === 'mrp') setTab('mrp');
    if (params.get('entityType')) setEntityType(params.get('entityType') || '');
    if (params.get('entityId')) {
      const value = params.get('entityId') || '';
      setSearchDraft(value);
      setSearch(value);
    }
  }, []);

  const { data, loading, error, refetch, fetchMore } = useQuery(AUDIT_WORKSPACE, {
    variables: { filters, cursor: null, range, from: window.from, to: window.to },
    fetchPolicy: 'cache-and-network',
    notifyOnNetworkStatusChange: true,
  });
  const { data: mrpData, loading: mrpLoading, error: mrpError, refetch: refetchMrp } = useQuery(MRP_HISTORY, {
    variables: { search: search || undefined, actorUserId: actorUserId || undefined, from: window.from, to: window.to, skip: mrpSkip, take: 25 },
    skip: tab !== 'mrp',
    fetchPolicy: 'cache-and-network',
  });
  const page = data?.auditEvents || {};
  const events = page.events || [];
  const stats = data?.auditStats || {};
  const facets = data?.auditFacets || {};
  const history = mrpData?.productMrpHistoryPage || {};
  const activeFilterCount = [search, entityType, action, actorUserId, criticalOnly ? 'critical' : ''].filter(Boolean).length;

  function applySearch() {
    setSearch(searchDraft.trim());
    setMrpSkip(0);
  }

  function clearFilters() {
    setSearchDraft(''); setSearch(''); setEntityType(''); setAction(''); setActorUserId(''); setCriticalOnly(false); setMrpSkip(0);
  }

  async function exportCsv() {
    const result = await exportAudit({ variables: { filters } });
    const csv = result.data?.auditEventsCsv;
    if (csv) downloadText(`marble-park-audit-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  const kpis = [
    { label: 'Recorded actions', value: Number(stats.totalEvents || 0).toLocaleString('en-IN'), note: range === 'all' ? 'Complete retained history' : ranges.find((item) => item.value === range)?.label, icon: Activity, tone: 'text-blue-700 bg-blue-50' },
    { label: 'Active users', value: Number(stats.activeActors || 0).toLocaleString('en-IN'), note: 'Actors in selected period', icon: UserRoundCheck, tone: 'text-emerald-700 bg-emerald-50' },
    { label: 'High-impact actions', value: Number(stats.criticalCount || 0).toLocaleString('en-IN'), note: 'Approvals, confirmations and access', icon: ShieldCheck, tone: 'text-amber-700 bg-amber-50' },
    { label: 'Tracked domains', value: Number(facets.entityTypes?.length || 0).toLocaleString('en-IN'), note: 'Business entity types', icon: PackageSearch, tone: 'text-violet-700 bg-violet-50' },
  ];

  return <div className="space-y-5 pb-12 print:space-y-3">
    <header className="overflow-hidden rounded-r6 border border-[var(--line)] bg-[linear-gradient(120deg,#171212_0%,#55231f_58%,#a72f28_100%)] px-5 py-6 text-white shadow-md-soft sm:px-7 lg:px-9 lg:py-8 print:border-0 print:bg-white print:px-0 print:py-2 print:text-black print:shadow-none">
      <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-3xl"><p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-red-100">Governance · one trace across the stack</p><h1 className="mt-3 font-display text-3xl font-bold tracking-[-0.03em] sm:text-4xl">Audit & change control</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-red-50/80">Search who changed what, open the source record, compare before and after values, and review the append-only MRP register without exposing protected credentials.</p></div>
        <div className="flex flex-wrap gap-2 print:hidden"><Button type="button" variant="outline" className="border-white/25 bg-white/10 text-white hover:bg-white/20" onClick={() => void refetch()}><RefreshCcw className="mr-2 h-4 w-4" />Refresh</Button><Button type="button" variant="outline" className="border-white/25 bg-white/10 text-white hover:bg-white/20" onClick={() => globalThis.print()}><Printer className="mr-2 h-4 w-4" />Print view</Button><Button type="button" className="bg-white text-[#7d2923] hover:bg-red-50" disabled={exportState.loading} onClick={() => void exportCsv()}><Download className="mr-2 h-4 w-4" />{exportState.loading ? 'Preparing' : 'Export CSV'}</Button></div>
      </div>
    </header>

    {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
    {mrpError ? <QueryErrorBanner error={mrpError} onRetry={() => refetchMrp()} /> : null}
    {exportState.error ? <QueryErrorBanner error={exportState.error} /> : null}

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {kpis.map(({ label, value, note, icon: Icon, tone }) => <article key={label} className="mp-panel p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-4)]">{label}</p><p className="mt-2 text-3xl font-bold tracking-tight text-[var(--ink)]">{loading && !data ? '—' : value}</p><p className="mt-1 text-xs text-[var(--ink-4)]">{note}</p></div><span className={cn('grid h-10 w-10 place-items-center rounded-md', tone)}><Icon className="h-5 w-5" /></span></div></article>)}
    </section>

    <nav className="flex gap-1 rounded-r4 border border-[var(--line)] bg-[var(--surface)] p-1 print:hidden" aria-label="Audit registers">
      <button type="button" onClick={() => setTab('events')} className={cn('flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-3 text-sm font-semibold transition', tab === 'events' ? 'bg-[var(--ink)] text-white shadow-sm' : 'text-[var(--ink-3)] hover:bg-[var(--bg-soft)]')}><History className="h-4 w-4" />All system events</button>
      <button type="button" onClick={() => setTab('mrp')} className={cn('flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-3 text-sm font-semibold transition', tab === 'mrp' ? 'bg-[var(--ink)] text-white shadow-sm' : 'text-[var(--ink-3)] hover:bg-[var(--bg-soft)]')}><FileClock className="h-4 w-4" />SKU MRP history</button>
    </nav>

    <section className="mp-panel p-4 print:hidden">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <form onSubmit={(event) => { event.preventDefault(); applySearch(); }} className="flex min-w-0 flex-1 gap-2"><div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-5)]" /><Input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} className="pl-9" placeholder={tab === 'mrp' ? 'Search SKU, internal code or product name' : 'Search action, summary, entity type or exact record ID'} /></div><Button type="submit">Search</Button></form>
        <div className="flex flex-wrap gap-2"><select value={range} onChange={(event) => { setRange(event.target.value); setMrpSkip(0); }} className="h-10 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--ink)]">{ranges.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><Button type="button" variant="outline" onClick={() => setAdvanced((value) => !value)}><SlidersHorizontal className="mr-2 h-4 w-4" />Filters{activeFilterCount ? <span className="ml-2 rounded-full bg-[var(--brand-700)] px-1.5 py-0.5 text-[10px] text-white">{activeFilterCount}</span> : null}</Button>{activeFilterCount ? <Button type="button" variant="ghost" onClick={clearFilters}><X className="mr-1 h-4 w-4" />Clear</Button> : null}</div>
      </div>
      {advanced ? <div className="mt-4 grid gap-3 border-t border-[var(--line)] pt-4 md:grid-cols-2 xl:grid-cols-4">
        <label className="space-y-1.5"><span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--ink-4)]">Business domain</span><select value={entityType} onChange={(event) => { setEntityType(event.target.value); setMrpSkip(0); }} className="h-10 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)]"><option value="">All entity types</option>{(facets.entityTypes || []).map((item: any) => <option key={item.value} value={item.value}>{item.value} ({item.count})</option>)}</select></label>
        <label className="space-y-1.5"><span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--ink-4)]">Action</span><select value={action} onChange={(event) => setAction(event.target.value)} disabled={tab === 'mrp'} className="h-10 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] disabled:opacity-50"><option value="">All actions</option>{(facets.actions || []).map((item: any) => <option key={item.value} value={item.value}>{item.value} ({item.count})</option>)}</select></label>
        <label className="space-y-1.5"><span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--ink-4)]">Changed by</span><select value={actorUserId} onChange={(event) => { setActorUserId(event.target.value); setMrpSkip(0); }} className="h-10 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)]"><option value="">All users</option>{(facets.actors || []).map((item: any) => <option key={item.id} value={item.id}>{item.name || item.email || item.id} ({item.count})</option>)}</select></label>
        <label className={cn('flex h-10 items-center gap-3 self-end rounded-md border border-[var(--line)] bg-[var(--bg-soft)] px-3', tab === 'mrp' && 'opacity-50')}><input type="checkbox" checked={criticalOnly} disabled={tab === 'mrp'} onChange={(event) => setCriticalOnly(event.target.checked)} className="h-4 w-4 accent-[var(--brand-700)]" /><span className="text-sm font-semibold text-[var(--ink)]">High-impact only</span></label>
      </div> : null}
    </section>

    {tab === 'events' ? <>
      <section className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr] print:hidden">
        <article className="mp-panel p-4"><div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold text-[var(--ink)]">Activity over time</h2><p className="mt-1 text-xs text-[var(--ink-4)]">Retained audit actions by day</p></div>{Number(stats.sampledEvents || 0) < Number(stats.totalEvents || 0) ? <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-800">Top breakdowns sample 5,000; total is exact</span> : null}</div><div className="mt-4 h-56">{stats.eventsByDay?.length ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={stats.eventsByDay}><defs><linearGradient id="auditFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#a72f28" stopOpacity={0.34} /><stop offset="100%" stopColor="#a72f28" stopOpacity={0.02} /></linearGradient></defs><CartesianGrid vertical={false} strokeDasharray="3 3" /><XAxis dataKey="day" tick={{ fontSize: 10 }} minTickGap={28} /><YAxis allowDecimals={false} tick={{ fontSize: 10 }} /><Tooltip /><Area dataKey="count" type="monotone" stroke="#a72f28" fill="url(#auditFill)" strokeWidth={2.4} /></AreaChart></ResponsiveContainer> : <EmptyState title="No activity in this period" detail="Choose a wider period or clear the filters." />}</div></article>
        <article className="mp-panel p-4"><div><h2 className="font-semibold text-[var(--ink)]">Most frequent actions</h2><p className="mt-1 text-xs text-[var(--ink-4)]">Volume, not a risk score</p></div><div className="mt-4 h-56">{stats.topActions?.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={stats.topActions.slice(0, 7)} layout="vertical" margin={{ left: 10, right: 10 }}><CartesianGrid horizontal={false} strokeDasharray="3 3" /><XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} /><YAxis type="category" dataKey="action" width={116} tick={{ fontSize: 9 }} tickFormatter={(value) => String(value).slice(0, 18)} /><Tooltip /><Bar dataKey="count" fill="#812b25" radius={[0, 5, 5, 0]} /></BarChart></ResponsiveContainer> : <EmptyState title="No action mix yet" detail="Actions will appear after governed business changes are posted." />}</div></article>
      </section>

      <section className="mp-panel overflow-hidden">
        <div className="flex flex-col gap-2 border-b border-[var(--line)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-semibold text-[var(--ink)]">Event register</h2><p className="mt-1 text-xs text-[var(--ink-4)]">{Number(page.total || 0).toLocaleString('en-IN')} matching event(s) · expand a row for field-level changes</p></div><span className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--ink-4)]"><Clock3 className="h-3.5 w-3.5" />Newest first</span></div>
        {loading && !events.length ? <div className="p-5"><QueryLoading label="Loading audit events…" /></div> : null}
        <div className="divide-y divide-[var(--line)]">
          {events.map((event: any) => {
            const expanded = expandedId === event.id;
            const changes = changedFields(event.metadata);
            const href = sourceRoute(event);
            return <article key={event.id} className={cn('transition-colors', expanded && 'bg-[var(--bg-soft)]')}>
              <button type="button" onClick={() => setExpandedId(expanded ? '' : event.id)} className="grid w-full gap-3 px-4 py-4 text-left hover:bg-[var(--bg-soft)] lg:grid-cols-[1.1fr_1.1fr_1.8fr_1fr_2rem] lg:items-center">
                <div><p className="text-sm font-semibold text-[var(--ink)]">{event.actor?.name || event.actor?.email || 'System actor'}</p><p className="mt-1 text-xs text-[var(--ink-4)]">{fmtDate(event.createdAt)}</p></div>
                <div><span className={cn('inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider', event.critical ? 'bg-amber-100 text-amber-900' : 'bg-[var(--bg-soft)] text-[var(--ink-3)]')}>{actionLabel(event.action)}</span></div>
                <p className="text-sm leading-6 text-[var(--ink-2)]">{event.summary}</p>
                <div><p className="text-xs font-semibold text-[var(--ink)]">{event.entityType}</p><p className="mt-1 truncate font-mono text-[10px] text-[var(--ink-5)]">{event.entityId}</p></div>
                {expanded ? <ChevronDown className="h-4 w-4 text-[var(--ink-4)]" /> : <ChevronRight className="h-4 w-4 text-[var(--ink-4)]" />}
              </button>
              {expanded ? <div className="border-t border-[var(--line)] px-4 py-4 lg:pl-[calc(27.5%+1rem)]">
                <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--ink-4)]">Recorded changes</p><p className="mt-1 text-xs text-[var(--ink-4)]">Protected authentication values are never displayed.</p></div>{href ? <Button asChild size="sm" variant="outline"><Link href={href}>Open source record <ExternalLink className="ml-2 h-3.5 w-3.5" /></Link></Button> : null}</div>
                {changes.length ? <div className="mt-4 overflow-x-auto rounded-md border border-[var(--line)]"><table className="w-full min-w-[620px] text-left text-xs"><thead className="bg-[var(--surface)] text-[10px] uppercase tracking-wider text-[var(--ink-4)]"><tr><th className="px-3 py-2">Field</th><th className="px-3 py-2">Before</th><th className="px-3 py-2">After / recorded value</th></tr></thead><tbody className="divide-y divide-[var(--line)]">{changes.map((change) => <tr key={change.key}><th className="px-3 py-2 font-semibold text-[var(--ink)]">{actionLabel(change.key)}</th><td className="max-w-sm break-words px-3 py-2 text-[var(--ink-4)]">{change.before}</td><td className="max-w-sm break-words px-3 py-2 font-medium text-[var(--ink-2)]">{change.after}</td></tr>)}</tbody></table></div> : <p className="mt-4 rounded-md border border-dashed border-[var(--line)] p-4 text-sm text-[var(--ink-4)]">This legacy event has no field-level metadata. Its actor, action, entity and timestamp remain preserved above.</p>}
              </div> : null}
            </article>;
          })}
          {!loading && !events.length ? <EmptyState icon={Filter} title="No audit events match" detail="Clear one or more filters or select a wider date period. No placeholder records are generated." /> : null}
        </div>
        {page.nextCursor ? <div className="border-t border-[var(--line)] p-4 print:hidden"><Button type="button" variant="outline" className="w-full" disabled={loading} onClick={() => fetchMore({ variables: { cursor: page.nextCursor }, updateQuery: (previous, { fetchMoreResult }) => fetchMoreResult ? { ...fetchMoreResult, auditEvents: { ...fetchMoreResult.auditEvents, events: [...(previous.auditEvents?.events || []), ...(fetchMoreResult.auditEvents?.events || [])] }, auditStats: previous.auditStats, auditFacets: previous.auditFacets } : previous })}>Load older events <ArrowRight className="ml-2 h-4 w-4" /></Button></div> : null}
      </section>
    </> : <section className="mp-panel overflow-hidden">
      <div className="flex flex-col gap-2 border-b border-[var(--line)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-semibold text-[var(--ink)]">Append-only MRP history</h2><p className="mt-1 text-xs text-[var(--ink-4)]">{Number(history.total || 0).toLocaleString('en-IN')} verified revision(s). Product names and master fields remain in the general audit trail; this register is price-specific.</p></div><Button asChild size="sm" variant="outline" className="print:hidden"><Link href="/dashboard/master-data/pricing-readiness">Open pricing readiness <ArrowRight className="ml-2 h-3.5 w-3.5" /></Link></Button></div>
      {mrpLoading && !history.items?.length ? <div className="p-5"><QueryLoading label="Loading MRP revisions…" /></div> : null}
      <div className="overflow-x-auto"><table className="w-full min-w-[920px] text-left"><thead className="border-b border-[var(--line)] bg-[var(--bg-soft)] text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-4)]"><tr><th className="px-4 py-3">SKU / product</th><th className="px-4 py-3">Previous MRP</th><th className="px-4 py-3">New MRP</th><th className="px-4 py-3">Reason & source</th><th className="px-4 py-3">Changed by</th><th className="px-4 py-3">Effective / recorded</th></tr></thead><tbody className="divide-y divide-[var(--line)]">{(history.items || []).map((row: any) => <tr key={row.id} className="align-top hover:bg-[var(--bg-soft)]"><td className="px-4 py-4"><p className="font-semibold text-[var(--ink)]">{row.product?.sku || row.product?.internalCode}</p><p className="mt-1 max-w-xs text-xs leading-5 text-[var(--ink-4)]">{row.product?.name}</p></td><td className="px-4 py-4 text-sm text-[var(--ink-4)]">{money(row.previousMrpInclusive)}</td><td className="px-4 py-4"><p className="font-semibold text-[var(--ink)]">{money(row.newMrpInclusive)}</p><p className="mt-1 text-[10px] uppercase tracking-wider text-[var(--ink-5)]">per {row.priceUom || 'PC'}</p></td><td className="px-4 py-4"><p className="max-w-sm text-sm text-[var(--ink-2)]">{row.reason || 'Initial governed MRP'}</p><p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--ink-5)]">{row.source || 'manual'}</p></td><td className="px-4 py-4"><p className="text-sm font-semibold text-[var(--ink)]">{row.actor?.name || row.actor?.email || 'System'}</p><p className="mt-1 text-xs capitalize text-[var(--ink-4)]">{row.actor?.role || ''}</p></td><td className="px-4 py-4 text-xs leading-5 text-[var(--ink-4)]"><p>{row.effectiveFrom ? fmtDate(row.effectiveFrom) : 'Immediate'}</p><p>{fmtDate(row.createdAt)}</p></td></tr>)}</tbody></table></div>
      {!mrpLoading && !history.items?.length ? <EmptyState title="No MRP revisions match" detail="MRP is appended here when a SKU is created or its governed MRP is changed with a reason." /> : null}
      {history.total > 0 ? <div className="flex items-center justify-between gap-3 border-t border-[var(--line)] p-4 print:hidden"><p className="text-xs font-semibold text-[var(--ink-4)]">Showing {mrpSkip + 1}–{Math.min(mrpSkip + Number(history.items?.length || 0), Number(history.total || 0))} of {history.total}</p><div className="flex gap-2"><Button type="button" size="sm" variant="outline" disabled={!history.hasPreviousPage} onClick={() => setMrpSkip(Math.max(0, mrpSkip - 25))}>Previous</Button><Button type="button" size="sm" variant="outline" disabled={!history.hasNextPage} onClick={() => setMrpSkip(mrpSkip + 25)}>Next</Button></div></div> : null}
    </section>}

    <aside className="flex items-start gap-3 rounded-r4 border border-blue-200 bg-blue-50/70 p-4 text-sm text-blue-950 print:hidden"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" /><div><p className="font-semibold">Retention and interpretation</p><p className="mt-1 leading-6 text-blue-900/80">Audit rows are append-only operational evidence, not permission to reverse commercial history. Use the owning workflow’s cancel, void, correction or approval action so the reversal creates its own trace.</p></div></aside>
  </div>;
}
