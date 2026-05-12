'use client';

import { gql, useQuery } from '@apollo/client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AreaChart, Area, BarChart, Bar, ResponsiveContainer, Tooltip, XAxis, YAxis,
  CartesianGrid, Cell, PieChart, Pie,
} from 'recharts';
import {
  Activity, AlertTriangle, ArrowRight, Calendar, ChevronDown, ChevronRight, CircleUserRound,
  Database, Download, FileSpreadsheet, Filter, History, KeyRound, LogIn, LogOut, RefreshCw,
  Search, ShieldAlert, ShoppingBag, Truck, UserCog, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QueryErrorBanner } from '@/components/query-state';
import { UserAvatar } from '@/components/user-avatar';
import {
  GreetingStrip, KpiTile, MotionGrid, MotionItem, Panel, EmptyState,
  moneyShort, type Tone,
} from '@/components/dashboard/primitives';
import { cn } from '@/lib/utils';

/**
 * /dashboard/audit — Owner + Admin only.
 *
 * Full event timeline + filters + aggregates + CSV export. Powered by
 * `auditEvents` (cursor-paginated) and `auditStats` (windowed aggregates)
 * from the backend AuditModule.
 *
 * Layout: greeting · 4 KPI tiles · 2 charts side-by-side · entity-type
 * distribution donut + filter bar · paged event timeline with avatar +
 * action chip + critical badge + expandable metadata.
 *
 * Filters supported:
 *   • Range (today / week / month / quarter / all)
 *   • Action prefix shortcuts (Quotes / Imports / Users / Auth / Customers)
 *   • Free-text search on summary
 *   • Critical-only toggle (high-impact actions: approve/delete/role-change/…)
 */

const AUDIT_STATS = gql`
  query AuditStats($range: String) {
    auditStats(range: $range)
  }
`;

const AUDIT_EVENTS = gql`
  query AuditEvents($filters: AuditFiltersInput, $take: Int, $cursor: String) {
    auditEvents(filters: $filters, take: $take, cursor: $cursor) {
      events {
        id actorUserId action entityType entityId summary metadata critical createdAt actor
      }
      nextCursor
      total
    }
  }
`;

const RANGES = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Last 7 days' },
  { value: 'month', label: 'Last 30 days' },
  { value: 'quarter', label: 'Last 90 days' },
  { value: 'all', label: 'All time' },
];

const ACTION_FAMILIES: Array<{ id: string; label: string; prefix?: string; icon: any; tone: Tone }> = [
  { id: 'all', label: 'All actions', icon: Activity, tone: 'neutral' },
  { id: 'quote', label: 'Quotes', prefix: 'quote.', icon: FileSpreadsheet, tone: 'brand' },
  { id: 'import', label: 'Imports', prefix: 'import.', icon: Database, tone: 'violet' },
  { id: 'user', label: 'Users', prefix: 'user.', icon: UserCog, tone: 'sky' },
  { id: 'auth', label: 'Auth', prefix: 'auth.', icon: LogIn, tone: 'success' },
  { id: 'customer', label: 'Customers', prefix: 'customer.', icon: CircleUserRound, tone: 'warning' },
  { id: 'password', label: 'Password', prefix: 'password.', icon: KeyRound, tone: 'danger' },
];

const ENTITY_TONE: Record<string, Tone> = {
  Quote: 'brand', ImportBatch: 'violet', User: 'sky', Customer: 'warning',
  CatalogReviewTask: 'success', SalesOrder: 'success', DispatchJob: 'warning',
};

const COLORS = ['#2563eb', '#059669', '#d97706', '#7c3aed', '#0ea5e9', '#dc2626', '#db2777', '#14b8a6'];

function entityHref(entityType: string, entityId: string): string | null {
  if (!entityId) return null;
  switch (entityType) {
    case 'Quote': return `/dashboard/quotes/${entityId}`;
    case 'Lead':  return `/dashboard/leads/${entityId}`;
    case 'Customer': return `/dashboard/customers`;
    case 'User': return `/dashboard/users`;
    case 'ImportBatch': return `/dashboard/master-data/imports`;
    case 'SalesOrder': return `/dashboard/orders`;
    case 'DispatchJob': return `/dashboard/dispatch`;
    default: return null;
  }
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
}

export default function AuditPage() {
  const [user, setUser] = useState<any>(null);
  const [range, setRange] = useState('week');
  const [actionFamily, setActionFamily] = useState('all');
  const [search, setSearch] = useState('');
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    try { setUser(JSON.parse(localStorage.getItem('user') || 'null')); } catch {}
  }, []);

  // Authorize on the client too — we don't want non-admin/owner peeking at
  // the URL. The server query also gates with requireRoles.
  const role = user?.role;
  const authorized = role === 'admin' || role === 'owner';

  const statsQuery = useQuery(AUDIT_STATS, { variables: { range }, skip: !authorized });
  const family = ACTION_FAMILIES.find((f) => f.id === actionFamily) || ACTION_FAMILIES[0];

  // Build server-side filters
  const filters = useMemo(() => {
    const f: any = {};
    if (family.prefix) f.actionPrefix = family.prefix;
    if (search.trim()) f.search = search.trim();
    if (criticalOnly) f.criticalOnly = true;
    // Date range
    const now = new Date();
    if (range !== 'all') {
      const from = new Date(now);
      const days = range === 'today' ? 1 : range === 'week' ? 7 : range === 'month' ? 30 : 90;
      from.setDate(now.getDate() - days);
      from.setHours(0, 0, 0, 0);
      f.from = from.toISOString();
    }
    return f;
  }, [family, search, range, criticalOnly]);

  const eventsQuery = useQuery(AUDIT_EVENTS, {
    variables: { filters, take: 100 },
    skip: !authorized,
  });

  const stats = statsQuery.data?.auditStats || {};
  const events: any[] = eventsQuery.data?.auditEvents?.events || [];
  const total = eventsQuery.data?.auditEvents?.total || 0;

  const tiles: Array<{ label: string; value: any; caption: string; icon: any; tone: Tone; numeric?: boolean }> = [
    { label: 'Events · this window', value: Number(stats.totalEvents || 0), caption: `${RANGES.find((r) => r.value === range)?.label || ''}`, icon: Activity, tone: 'brand', numeric: true },
    { label: 'Critical events', value: Number(stats.criticalCount || 0), caption: 'Approvals · deletes · role changes', icon: ShieldAlert, tone: (stats.criticalCount || 0) > 0 ? 'danger' : 'success', numeric: true },
    { label: 'Active users', value: Number(stats.activeActors || 0), caption: 'Distinct people who acted', icon: CircleUserRound, tone: 'success', numeric: true },
    { label: 'Distinct actions', value: (stats.topActions || []).length || 0, caption: 'Different action types in window', icon: History, tone: 'violet', numeric: true },
  ];

  const eventsByDay = (stats.eventsByDay || []).map((d: any) => ({
    ...d,
    label: new Date(d.day).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }),
  }));
  const topActors: any[] = stats.topActors || [];
  const topActions: any[] = stats.topActions || [];
  const byEntityType: any[] = stats.byEntityType || [];

  // CSV export — fetches via GraphQL then triggers a download.
  async function exportCsv() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/graphql';
    const token = localStorage.getItem('auth_token') || '';
    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: token ? `Bearer ${token}` : '' },
        body: JSON.stringify({
          query: `query AuditCsv($filters: AuditFiltersInput, $take: Int) { auditEventsCsv(filters: $filters, take: $take) }`,
          variables: { filters, take: 2000 },
        }),
      });
      const json = await res.json();
      const csv = json?.data?.auditEventsCsv;
      if (!csv) throw new Error(json?.errors?.[0]?.message || 'No CSV');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `marble-park-audit-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('CSV export failed', err);
      alert('CSV export failed. See console.');
    }
  }

  if (!authorized) {
    return (
      <div className="rounded-r5 border border-[#e4e6ec] bg-white p-8 text-center">
        <ShieldAlert className="mx-auto h-10 w-10 text-[#dc2626]" />
        <h2 className="mt-3 font-display text-2xl font-bold text-[#18181b]">Restricted</h2>
        <p className="mt-1 text-sm text-[#52525b]">The audit log is owner + admin only. Ask your admin to give you access if you need it.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {statsQuery.error ? <QueryErrorBanner error={statsQuery.error} onRetry={() => statsQuery.refetch()} /> : null}
      {eventsQuery.error ? <QueryErrorBanner error={eventsQuery.error} onRetry={() => eventsQuery.refetch()} /> : null}

      <GreetingStrip
        role={role || 'admin'}
        user={user}
        subtitle="Track every change in the system — who did what, when, and what was affected."
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => { statsQuery.refetch(); eventsQuery.refetch(); }}>
              <RefreshCw className="mr-1.5 h-4 w-4" /> Refresh
            </Button>
            <Button size="sm" onClick={exportCsv}>
              <Download className="mr-1.5 h-4 w-4" /> Export CSV
            </Button>
          </>
        }
      />

      {/* KPI tiles */}
      <MotionGrid className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {tiles.map((t) => <MotionItem key={t.label}><KpiTile {...t} loading={statsQuery.loading} /></MotionItem>)}
      </MotionGrid>

      {/* Charts: timeline + top actors */}
      <section className="grid gap-3 xl:grid-cols-[1.5fr_1fr]">
        <Panel title="Activity timeline" subtitle={`Events per day · ${RANGES.find((r) => r.value === range)?.label}`} tone="brand">
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={eventsByDay} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="audit-tl" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563eb" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#2563eb" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(113,113,122,0.10)" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} axisLine={false} interval={Math.ceil(eventsByDay.length / 8)} />
                <YAxis tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} axisLine={false} width={28} allowDecimals={false} />
                <Tooltip />
                <Area type="monotone" dataKey="count" stroke="#2563eb" strokeWidth={2} fill="url(#audit-tl)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Top actors" subtitle="Most active users in window" tone="success">
          {topActors.length ? (
            <ul className="space-y-2">
              {topActors.map((a: any, i: number) => (
                <li key={a.userId} className="flex items-center justify-between rounded-r3 border border-[#f0f2f7] bg-white px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#f0f2f7] text-[10px] font-semibold text-[#52525b]">{i + 1}</span>
                    <UserAvatar user={a.actor} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[#18181b]">{a.actor?.name || a.userId}</p>
                      <p className="truncate text-[11px] capitalize text-[#71717a]">{String(a.actor?.role || '').replace('_', ' ')}</p>
                    </div>
                  </div>
                  <span className="rounded-full bg-[#eef4ff] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-[#1d4ed8]">{a.count}</span>
                </li>
              ))}
            </ul>
          ) : <EmptyState>No activity in this window.</EmptyState>}
        </Panel>
      </section>

      {/* Charts: top actions + entity types */}
      <section className="grid gap-3 xl:grid-cols-[1fr_1fr]">
        <Panel title="Top actions" subtitle="Most-performed actions" tone="violet">
          {topActions.length ? (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topActions} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(113,113,122,0.10)" horizontal={false} />
                  <XAxis type="number" tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="action" tick={{ fill: '#52525b', fontSize: 11 }} tickLine={false} axisLine={false} width={140} />
                  <Tooltip cursor={{ fill: 'rgba(124,58,237,0.04)' }} />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]} animationDuration={900}>
                    {topActions.map((a, i) => (
                      <Cell key={i} fill={a.critical ? '#dc2626' : COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyState>No actions in this window.</EmptyState>}
        </Panel>

        <Panel title="Affected entity types" subtitle="What got touched" tone="sky">
          {byEntityType.length ? (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={byEntityType} dataKey="count" nameKey="entityType" innerRadius={48} outerRadius={84} paddingAngle={3} stroke="white" strokeWidth={2} animationDuration={900}>
                    {byEntityType.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="-mt-4 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                {byEntityType.slice(0, 8).map((e, i) => (
                  <div key={e.entityType} className="flex items-center gap-1.5">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                    <span className="truncate text-[#52525b]">{e.entityType}</span>
                    <span className="ml-auto font-semibold text-[#18181b]">{e.count}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : <EmptyState>No entities affected.</EmptyState>}
        </Panel>
      </section>

      {/* Filter bar */}
      <Panel title="Event log" subtitle={`${total.toLocaleString('en-IN')} events match · showing ${events.length}`} tone="neutral" rightAction={
        <span className="text-xs text-[#71717a]">{eventsQuery.loading ? 'Loading…' : 'Live'}</span>
      }>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {/* Range */}
          <div className="inline-flex rounded-md border border-[#e4e6ec] bg-white p-0.5">
            {RANGES.map((r) => (
              <button
                key={r.value}
                onClick={() => setRange(r.value)}
                className={cn(
                  'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                  range === r.value ? 'bg-[#eef4ff] text-[#1d4ed8]' : 'text-[#52525b] hover:bg-[#f0f2f7]',
                )}
              >
                {r.label}
              </button>
            ))}
          </div>

          {/* Action family */}
          <div className="inline-flex flex-wrap rounded-md border border-[#e4e6ec] bg-white p-0.5">
            {ACTION_FAMILIES.map((f) => (
              <button
                key={f.id}
                onClick={() => setActionFamily(f.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors',
                  actionFamily === f.id ? 'bg-[#eef4ff] text-[#1d4ed8]' : 'text-[#52525b] hover:bg-[#f0f2f7]',
                )}
              >
                <f.icon className="h-3 w-3" /> {f.label}
              </button>
            ))}
          </div>

          {/* Critical toggle */}
          <button
            onClick={() => setCriticalOnly((v) => !v)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
              criticalOnly
                ? 'border-[#fecaca] bg-[#fff1f2] text-[#b91c1c]'
                : 'border-[#e4e6ec] bg-white text-[#52525b] hover:bg-[#f0f2f7]',
            )}
          >
            <ShieldAlert className="h-3.5 w-3.5" />
            Critical only
          </button>

          {/* Search */}
          <div className="relative ml-auto w-full max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#71717a]" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search summary…"
              className="h-8 pl-8 text-xs"
            />
            {search ? (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#71717a] hover:text-[#18181b]">
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        </div>

        {/* Event timeline */}
        {events.length ? (
          <ol className="space-y-1.5">
            {events.map((ev) => {
              const isOpen = expandedId === ev.id;
              const href = entityHref(ev.entityType, ev.entityId);
              const entityTone: Tone = ENTITY_TONE[ev.entityType] || 'neutral';
              return (
                <li key={ev.id} className={cn('rounded-r3 border bg-white transition-colors', isOpen ? 'border-[#bfdbfe] bg-[#f5f9ff]' : 'border-[#f0f2f7] hover:border-[#e4e6ec]')}>
                  <button
                    type="button"
                    onClick={() => setExpandedId(isOpen ? null : ev.id)}
                    className="flex w-full items-start gap-3 px-3 py-2.5 text-left"
                  >
                    <UserAvatar user={ev.actor || { name: ev.actorUserId }} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold text-[#18181b]">{ev.actor?.name || ev.actorUserId}</p>
                        <span className={`mp-kpi-icon-${entityTone} rounded-full px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide`}>
                          {ev.entityType}
                        </span>
                        <span className="rounded-md bg-[#f0f2f7] px-1.5 py-px text-[10px] font-medium mp-mono text-[#52525b]">{ev.action}</span>
                        {ev.critical ? (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-[#fecaca] px-1.5 py-px text-[10px] font-semibold text-[#b91c1c]">
                            <ShieldAlert className="h-2.5 w-2.5" /> critical
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 truncate text-sm text-[#27272a]">{ev.summary}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 text-[11px] text-[#71717a]">
                      <span>{formatWhen(ev.createdAt)}</span>
                      <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', isOpen && 'rotate-180')} />
                    </div>
                  </button>
                  {isOpen ? (
                    <div className="border-t border-[#e4e6ec] px-3 py-3">
                      <div className="grid gap-3 text-xs sm:grid-cols-2">
                        <div>
                          <p className="font-semibold uppercase tracking-wider text-[#71717a]">Actor</p>
                          <p className="mt-1 text-[#27272a]">{ev.actor?.name || ev.actorUserId}</p>
                          <p className="text-[#52525b]">{ev.actor?.email}</p>
                          <p className="capitalize text-[#71717a]">{String(ev.actor?.role || '').replace('_', ' ')}</p>
                        </div>
                        <div>
                          <p className="font-semibold uppercase tracking-wider text-[#71717a]">Target</p>
                          <p className="mt-1 mp-mono text-[#27272a]">{ev.entityType}</p>
                          <p className="mp-mono text-[10px] text-[#52525b]">{ev.entityId}</p>
                          {href ? (
                            <Link href={href} className="mt-1 inline-flex items-center gap-1 text-[#1d4ed8] hover:underline">
                              Open <ArrowRight className="h-3 w-3" />
                            </Link>
                          ) : null}
                        </div>
                        <div>
                          <p className="font-semibold uppercase tracking-wider text-[#71717a]">Timestamp</p>
                          <p className="mt-1 text-[#27272a]">{new Date(ev.createdAt).toLocaleString('en-IN')}</p>
                        </div>
                        {ev.metadata && Object.keys(ev.metadata).length ? (
                          <div className="sm:col-span-2">
                            <p className="font-semibold uppercase tracking-wider text-[#71717a]">Metadata</p>
                            <pre className="mt-1 max-h-48 overflow-auto rounded-md border border-[#e4e6ec] bg-[#fafafa] p-2 text-[11px] text-[#27272a]">
                              {JSON.stringify(ev.metadata, null, 2)}
                            </pre>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        ) : (
          <EmptyState>{eventsQuery.loading ? 'Loading…' : 'No events match these filters.'}</EmptyState>
        )}
      </Panel>
    </div>
  );
}
