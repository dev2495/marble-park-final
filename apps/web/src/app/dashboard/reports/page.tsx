'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { gql, useApolloClient, useQuery } from '@apollo/client';
import {
  Activity, AlertTriangle, BarChart3, Boxes, Calendar as CalendarIcon, Check, ChevronDown,
  ClipboardList, Download, Filter, LayoutDashboard, MoreHorizontal, Package, RefreshCw, Save,
  Sparkles, TrendingDown, TrendingUp, Trophy, Truck, Users, Wallet,
} from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { QueryErrorBanner } from '@/components/query-state';
import { HelpButton } from '@/components/help/help-button';

// ===========================================================================
// GraphQL
// ===========================================================================
const REPORTS_BOARD = gql`
  query ReportsBoard($tab: String!, $from: DateTime, $to: DateTime, $compare: Boolean, $segment: String) {
    reportsBoard(tab: $tab, from: $from, to: $to, compare: $compare, segment: $segment)
  }
`;

const REPORT_CSV = gql`
  query ReportCsvX($kind: String!, $from: DateTime, $to: DateTime, $limit: Int, $days: Int) {
    reportCsv(kind: $kind, from: $from, to: $to, limit: $limit, days: $days)
  }
`;

// ===========================================================================
// Types
// ===========================================================================
type Kpi = {
  id: string;
  label: string;
  value: number;
  delta: number;
  prior?: number;
  tone: 'good' | 'bad' | 'blue' | 'amber' | 'violet' | 'sky';
  spark?: number[];
  format: 'money' | 'percent' | 'count' | 'days';
};

const TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'sales', label: 'Sales', icon: TrendingUp },
  { id: 'pipeline', label: 'Pipeline', icon: Activity },
  { id: 'inventory', label: 'Inventory', icon: Boxes },
  { id: 'procurement', label: 'Procurement', icon: ClipboardList },
  { id: 'money', label: 'Money', icon: Wallet },
] as const;
type TabId = (typeof TABS)[number]['id'];

const PRESETS = [
  { id: '7d', label: '7d', days: 7 },
  { id: '30d', label: '30d', days: 30 },
  { id: '90d', label: '90d', days: 90 },
  { id: 'qtd', label: 'QTD', days: 0 },
  { id: 'ytd', label: 'YTD', days: 0 },
];

// ===========================================================================
// Helpers
// ===========================================================================
function moneyShort(n: number) {
  const v = Number(n || 0);
  if (Math.abs(v) >= 10000000) return `₹${(v / 10000000).toFixed(2)}Cr`;
  if (Math.abs(v) >= 100000) return `₹${(v / 100000).toFixed(2)}L`;
  if (Math.abs(v) >= 1000) return `₹${(v / 1000).toFixed(1)}k`;
  return `₹${Math.round(v).toLocaleString('en-IN')}`;
}
function moneyFull(n: number) {
  return `₹${Math.round(Number(n || 0)).toLocaleString('en-IN')}`;
}
function fmtKpi(value: number, format: Kpi['format']) {
  if (format === 'money') return moneyShort(value);
  if (format === 'percent') return `${value.toFixed(value < 10 ? 1 : 0)}%`;
  if (format === 'days') return `${value.toFixed(value < 10 ? 1 : 0)}d`;
  return Number(value).toLocaleString('en-IN');
}

function useHashState() {
  const [hash, setHash] = useState<string>('');
  useEffect(() => {
    const handler = () => setHash(window.location.hash.slice(1));
    handler();
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);
  const update = useCallback((next: Record<string, string | null>) => {
    const current = new URLSearchParams(hash);
    for (const [k, v] of Object.entries(next)) {
      if (v == null || v === '') current.delete(k);
      else current.set(k, v);
    }
    const newHash = current.toString();
    if (typeof window !== 'undefined' && window.location.hash.slice(1) !== newHash) {
      window.location.hash = newHash;
    }
    setHash(newHash);
  }, [hash]);
  const params = useMemo(() => new URLSearchParams(hash), [hash]);
  return { params, update };
}

function rangeFromPreset(presetId: string): { from: Date; to: Date } {
  const to = new Date();
  let from: Date;
  if (presetId === 'qtd') {
    const month = to.getMonth();
    const qStart = Math.floor(month / 3) * 3;
    from = new Date(to.getFullYear(), qStart, 1);
  } else if (presetId === 'ytd') {
    from = new Date(to.getFullYear(), 0, 1);
  } else {
    const preset = PRESETS.find((p) => p.id === presetId);
    const days = preset?.days || 30;
    from = new Date(to.getTime() - days * 86400000);
  }
  return { from, to };
}

// ===========================================================================
// Page
// ===========================================================================
export default function ReportsPage() {
  const { params, update } = useHashState();
  const tab = (params.get('tab') as TabId) || 'overview';
  const preset = params.get('preset') || '30d';
  const compare = params.get('compare') === '1';
  const segment = params.get('segment') || 'all';

  const range = useMemo(() => rangeFromPreset(preset), [preset]);

  const { data, loading, error, refetch } = useQuery(REPORTS_BOARD, {
    variables: { tab, from: range.from.toISOString(), to: range.to.toISOString(), compare, segment },
    fetchPolicy: 'cache-and-network',
  });

  const board = data?.reportsBoard;

  return (
    <div className="space-y-4 pb-24">
      {/* Tab row + actions */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex flex-wrap rounded-xl border border-[var(--line)] bg-[var(--surface)] p-1 shadow-sm-soft">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => update({ tab: t.id })}
              className={
                tab === t.id
                  ? 'inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-3)] px-3 py-1.5 text-xs font-bold text-[var(--bg)] shadow-sm'
                  : 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-[var(--ink-2)] hover:text-[var(--ink)]'
              }
            >
              <t.icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <HelpButton topicId="reports" variant="inline" label="Help" />
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* Date range + compare bar */}
      <section className="flex flex-wrap items-center justify-between gap-2 rounded-r4 border border-[var(--line)] bg-[var(--surface)] px-3 py-2 shadow-sm-soft">
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border border-[var(--line)] bg-[var(--surface)] p-0.5">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => update({ preset: p.id })}
                className={
                  preset === p.id
                    ? 'rounded bg-[var(--surface-3)] px-2.5 py-1 text-[11px] font-bold text-[var(--bg)]'
                    : 'rounded px-2.5 py-1 text-[11px] font-bold text-[var(--ink-2)] hover:text-[var(--ink)]'
                }
              >
                {p.label}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-[var(--ink-4)]">
            {range.from.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – {range.to.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
        </div>
        <button
          type="button"
          onClick={() => update({ compare: compare ? null : '1' })}
          className="inline-flex items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-[11px] font-semibold text-[var(--ink-2)] hover:bg-[var(--bg-soft)]"
        >
          <span className={`relative inline-block h-4 w-7 rounded-full transition ${compare ? 'bg-[var(--brand-600)]' : 'bg-[var(--line-strong)]'}`}>
            <span className={`absolute top-0.5 ${compare ? 'right-0.5' : 'left-0.5'} h-3 w-3 rounded-full bg-white transition-all`} />
          </span>
          Compare to prior period
        </button>
      </section>

      {error && !board ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}

      {/* Tab body */}
      {!board && loading ? <LoadingShell /> : null}
      {board && tab === 'overview' ? <OverviewTab board={board} compare={compare} onJump={(t) => update({ tab: t })} /> : null}
      {board && tab === 'sales' ? <SalesTab board={board} segment={segment} onSegment={(s) => update({ segment: s })} /> : null}
      {board && tab === 'pipeline' ? <PipelineTab board={board} /> : null}
      {board && tab === 'inventory' ? <InventoryTab board={board} /> : null}
      {board && tab === 'procurement' ? <ProcurementTab board={board} /> : null}
      {board && tab === 'money' ? <MoneyTab board={board} /> : null}
    </div>
  );
}

// ===========================================================================
// Shell components
// ===========================================================================
function LoadingShell() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-6">
        {[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="h-28 animate-pulse rounded-r5 bg-[var(--bg-soft)]" />)}
      </div>
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="h-72 animate-pulse rounded-r5 bg-[var(--bg-soft)]" />
        <div className="h-72 animate-pulse rounded-r5 bg-[var(--bg-soft)]" />
      </div>
    </div>
  );
}

function Panel({ title, sub, action, children, className }: { title: string; sub?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-r5 border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm-soft ${className || ''}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-bold text-[var(--ink)]">
          {title}
          {sub ? <span className="ml-1 font-medium text-[var(--ink-4)]">· {sub}</span> : null}
        </h3>
        {action || <button type="button" className="grid h-6 w-6 place-items-center rounded text-[var(--ink-4)] hover:bg-[var(--bg-soft)] hover:text-[var(--ink-2)]"><MoreHorizontal className="h-3.5 w-3.5" /></button>}
      </div>
      {children}
    </div>
  );
}

function KpiTile({ kpi, onClick }: { kpi: Kpi; onClick?: () => void }) {
  const toneMap: Record<Kpi['tone'], string> = {
    good: 'border-t-emerald-500',
    blue: 'border-t-blue-600',
    violet: 'border-t-violet-600',
    amber: 'border-t-amber-500',
    sky: 'border-t-sky-600',
    bad: 'border-t-rose-500',
  };
  const sparkColor: Record<Kpi['tone'], string> = {
    good: '#059669', blue: '#2563eb', violet: '#7c3aed', amber: '#d97706', sky: '#0284c7', bad: '#dc2626',
  };
  const positive = kpi.delta >= 0;
  const showDelta = Math.abs(kpi.delta) > 0.5;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative w-full overflow-hidden rounded-r5 border-2 ${toneMap[kpi.tone]} border-x border-b bg-[var(--surface)] p-3.5 text-left shadow-sm-soft transition hover:-translate-y-0.5 hover:shadow-[0_16px_36px_-22px_rgba(15,23,42,0.35)]`}
    >
      <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--ink-4)]">{kpi.label}</p>
      <p className="mt-1.5 text-2xl font-bold tracking-tight text-[var(--ink)] leading-none">{fmtKpi(kpi.value, kpi.format)}</p>
      {showDelta ? (
        <p className={`mt-1.5 inline-flex items-center gap-1 text-[11px] font-bold ${positive ? 'text-emerald-700' : 'text-rose-700'}`}>
          {positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {Math.abs(kpi.delta).toFixed(1)}%
          <span className="font-medium text-[var(--ink-5)]">vs prior</span>
        </p>
      ) : <p className="mt-1.5 text-[11px] text-[var(--ink-4)]">no comparison</p>}
      {kpi.spark && kpi.spark.length > 0 ? (
        <div className="mt-2 h-8">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={kpi.spark.map((v, i) => ({ i, v }))}>
              <defs>
                <linearGradient id={`spark-${kpi.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={sparkColor[kpi.tone]} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={sparkColor[kpi.tone]} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="v" stroke={sparkColor[kpi.tone]} strokeWidth={1.5} fill={`url(#spark-${kpi.id})`} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </button>
  );
}

// ===========================================================================
// OVERVIEW TAB
// ===========================================================================
function OverviewTab({ board, compare, onJump }: { board: any; compare: boolean; onJump: (t: TabId) => void }) {
  return (
    <div className="space-y-4">
      {/* Anomaly callouts */}
      {board.anomalies?.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {board.anomalies.slice(0, 4).map((a: any, i: number) => (
            <div
              key={i}
              className={`flex items-start gap-3 rounded-r4 border p-3 ${
                a.kind === 'positive' ? 'border-emerald-200 bg-gradient-to-br from-emerald-50 to-white' : 'border-amber-200 bg-gradient-to-br from-amber-50 to-white'
              }`}
            >
              <div className={`grid h-8 w-8 shrink-0 place-items-center rounded ${a.kind === 'positive' ? 'bg-emerald-500 text-white' : 'bg-amber-500 text-white'}`}>
                {a.kind === 'positive' ? <Trophy className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className={`text-xs font-bold ${a.kind === 'positive' ? 'text-emerald-900' : 'text-amber-900'}`}>{a.title}</p>
                <p className={`mt-0.5 text-[11px] ${a.kind === 'positive' ? 'text-emerald-800' : 'text-amber-800'}`}>{a.body}</p>
              </div>
              {a.link ? (
                <button type="button" onClick={() => onJump(a.link.tab)} className={`shrink-0 rounded-md border px-2 py-1 text-[10px] font-bold ${a.kind === 'positive' ? 'border-emerald-200 bg-white text-emerald-900' : 'border-amber-200 bg-white text-amber-900'} hover:bg-[var(--bg-soft)]`}>
                  {a.link.label} →
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {(board.kpis || []).map((kpi: Kpi) => (
          <KpiTile key={kpi.id} kpi={kpi} onClick={() => {
            if (kpi.id === 'revenue' || kpi.id === 'aov') onJump('sales');
            else if (kpi.id === 'openPipeline' || kpi.id === 'winRate' || kpi.id === 'staleLeads') onJump('pipeline');
            else if (kpi.id === 'netCash') onJump('money');
          }} />
        ))}
      </div>

      {/* Revenue trend + funnel */}
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Panel title="Revenue trend" sub={compare ? 'this period vs prior' : 'this period'}>
          <div className="h-64 -mx-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={board.revenueTrend || []} margin={{ top: 10, right: 12, bottom: 4, left: -10 }}>
                <defs>
                  <linearGradient id="gradCur" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563eb" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#2563eb" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="var(--ink-4)" tickFormatter={(d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} />
                <YAxis tick={{ fontSize: 10 }} stroke="var(--ink-4)" tickFormatter={(v) => moneyShort(v)} width={50} />
                <Tooltip
                  contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }}
                  formatter={(v: any) => moneyFull(Number(v))}
                  labelFormatter={(d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
                />
                {compare ? (
                  <Line type="monotone" dataKey="prior" stroke="var(--ink-5)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
                ) : null}
                <Area type="monotone" dataKey="current" stroke="#2563eb" strokeWidth={2.5} fill="url(#gradCur)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Conversion funnel" sub="all-time leads">
          <div className="space-y-2">
            {(board.funnel || []).map((f: any, i: number) => {
              const colors = ['from-blue-500 to-blue-700', 'from-sky-500 to-sky-700', 'from-amber-500 to-amber-700', 'from-violet-500 to-violet-700', 'from-emerald-500 to-emerald-700'];
              return (
                <div key={f.stage} className="grid grid-cols-[1fr_auto] items-center gap-2">
                  <div className={`flex h-8 items-center rounded-md bg-gradient-to-r ${colors[i] || colors[0]} px-3 text-xs font-bold text-white`} style={{ width: `${Math.max(20, f.percent)}%` }}>
                    {f.stage}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-[var(--ink)] mp-mono">{f.count}</p>
                    <p className="text-[9px] font-bold text-[var(--ink-4)]">{f.percent.toFixed(0)}%</p>
                  </div>
                </div>
              );
            })}
          </div>
          <button type="button" onClick={() => onJump('pipeline')} className="mt-3 text-[11px] font-bold text-[var(--brand-700)] hover:underline">
            Open Pipeline →
          </button>
        </Panel>
      </div>

      {/* Mix donuts + rep leaderboard */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Revenue by category" sub="period">
          <CategoryDonut data={board.categoryMix || []} />
        </Panel>
        <Panel title="Payment mode mix" sub="receipts in period">
          <PaymentDonut data={board.paymentMix || []} />
        </Panel>
        <Panel title="Sales rep leaderboard" sub="MTD">
          <RepLeaderboard reps={board.repPerformance || []} />
        </Panel>
      </div>

      {/* Top customers + Top SKUs + Dispatch SLA */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Top customers" sub="period">
          <TopCustomers customers={board.topCustomers || []} />
        </Panel>
        <Panel title="Top SKUs" sub="units sold">
          <TopSkus skus={board.topSkus || []} />
        </Panel>
        <Panel title="Dispatch SLA" sub="on-time delivery">
          <DispatchSlaWidget sla={board.dispatchSla || { onTimePercent: 0, delivered: 0, onTime: 0, late: 0 }} />
        </Panel>
      </div>

      {/* Receivables + Inventory health */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Receivables ageing" sub="outstanding">
          <ReceivablesBars data={board.receivablesAgeing || []} />
          <button type="button" onClick={() => onJump('money')} className="mt-3 text-[11px] font-bold text-[var(--brand-700)] hover:underline">Open Money →</button>
        </Panel>
        <Panel title="Inventory health" sub="snapshot">
          <InventoryHealthCards data={board.inventoryHealth || {}} />
          <button type="button" onClick={() => onJump('inventory')} className="mt-3 text-[11px] font-bold text-[var(--brand-700)] hover:underline">Open Inventory →</button>
        </Panel>
      </div>
    </div>
  );
}

function CategoryDonut({ data }: { data: any[] }) {
  const COLORS = ['#f59e0b', '#2563eb', '#10b981', '#7c3aed', '#0284c7', '#64748b', '#ec4899', '#14b8a6'];
  if (!data.length) return <p className="rounded-r3 border border-dashed border-[var(--line)] p-4 text-center text-[11px] text-[var(--ink-4)]">No category sales in this range</p>;
  const total = data.reduce((s, d) => s + d.amount, 0);
  return (
    <div className="grid grid-cols-[120px_1fr] items-center gap-3">
      <div className="h-[120px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="amount" cx="50%" cy="50%" innerRadius={36} outerRadius={56} paddingAngle={2}>
              {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
            <Tooltip formatter={(v: any) => moneyFull(Number(v))} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 11 }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="space-y-1.5 text-[11px]">
        {data.slice(0, 5).map((d, i) => (
          <li key={d.category} className="grid grid-cols-[10px_1fr_auto] items-center gap-2">
            <span className="h-2 w-2 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />
            <span className="truncate font-semibold text-[var(--ink-2)]">{d.category}</span>
            <span className="text-right font-bold text-[var(--ink)] mp-mono">{((d.amount / Math.max(total, 1)) * 100).toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PaymentDonut({ data }: { data: any[] }) {
  const COLORS: Record<string, string> = { cash: '#f59e0b', upi: '#10b981', cheque: '#2563eb', transfer: '#7c3aed', card: '#0284c7', other: '#64748b' };
  if (!data.length) return <p className="rounded-r3 border border-dashed border-[var(--line)] p-4 text-center text-[11px] text-[var(--ink-4)]">No payments</p>;
  return (
    <div className="grid grid-cols-[120px_1fr] items-center gap-3">
      <div className="h-[120px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="amount" cx="50%" cy="50%" innerRadius={36} outerRadius={56} paddingAngle={2}>
              {data.map((d, i) => <Cell key={i} fill={COLORS[d.mode] || '#64748b'} />)}
            </Pie>
            <Tooltip formatter={(v: any) => moneyFull(Number(v))} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 11 }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="space-y-1.5 text-[11px]">
        {data.slice(0, 5).map((d) => (
          <li key={d.mode} className="grid grid-cols-[10px_1fr_auto] items-center gap-2">
            <span className="h-2 w-2 rounded-sm" style={{ background: COLORS[d.mode] || '#64748b' }} />
            <span className="truncate font-semibold text-[var(--ink-2)] capitalize">{d.mode}</span>
            <span className="text-right font-bold text-[var(--ink)] mp-mono">{d.percent.toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RepLeaderboard({ reps }: { reps: any[] }) {
  if (!reps.length) return <p className="rounded-r3 border border-dashed border-[var(--line)] p-4 text-center text-[11px] text-[var(--ink-4)]">No reps</p>;
  return (
    <div className="space-y-1.5">
      {reps.slice(0, 5).map((r) => {
        const positive = r.delta >= 0;
        return (
          <div key={r.userId} className="grid grid-cols-[20px_1fr_auto_60px] items-center gap-2 text-[11px]">
            <span className="grid h-5 w-5 place-items-center rounded bg-gradient-to-br from-violet-500 to-violet-700 text-[9px] font-bold text-white">
              {(r.name || '?').split(' ').map((p: string) => p[0]).slice(0, 2).join('')}
            </span>
            <span className="truncate font-semibold text-[var(--ink)]">{r.name}</span>
            <span className="font-bold text-[var(--ink)] mp-mono">{moneyShort(r.revenue)}</span>
            <div className="h-5">
              {r.spark?.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={r.spark.map((v: number, i: number) => ({ i, v }))}>
                    <Line type="monotone" dataKey="v" stroke={positive ? '#059669' : '#dc2626'} strokeWidth={1.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TopCustomers({ customers }: { customers: any[] }) {
  if (!customers.length) return <p className="rounded-r3 border border-dashed border-[var(--line)] p-4 text-center text-[11px] text-[var(--ink-4)]">No customers</p>;
  return (
    <ul className="space-y-1">
      {customers.map((c) => (
        <li key={c.id} className="grid grid-cols-[1fr_auto] items-center gap-2 rounded-r3 px-2 py-1.5 text-[11px] hover:bg-[var(--bg-soft)]">
          <span className="truncate"><span className="font-bold text-[var(--ink)]">{c.name}</span>{c.city ? <span className="ml-1 text-[var(--ink-4)]">· {c.city}</span> : null}</span>
          <span className="font-bold text-[var(--ink)] mp-mono">{moneyShort(c.total)}</span>
        </li>
      ))}
    </ul>
  );
}

function TopSkus({ skus }: { skus: any[] }) {
  if (!skus.length) return <p className="rounded-r3 border border-dashed border-[var(--line)] p-4 text-center text-[11px] text-[var(--ink-4)]">No SKU activity</p>;
  return (
    <ul className="space-y-1">
      {skus.map((s) => (
        <li key={s.sku} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-r3 px-2 py-1.5 text-[11px] hover:bg-[var(--bg-soft)]">
          <span className="truncate"><span className="font-bold text-[var(--ink)]">{s.name}</span><span className="ml-1 font-mono text-[10px] text-[var(--ink-4)]">{s.sku}</span></span>
          <span className="font-bold text-[var(--ink)] mp-mono">{s.units}u</span>
          <span className="font-bold text-[var(--ink-3)] mp-mono">{moneyShort(s.revenue)}</span>
        </li>
      ))}
    </ul>
  );
}

function DispatchSlaWidget({ sla }: { sla: any }) {
  const pct = Math.round(sla.onTimePercent || 0);
  const tone = pct >= 90 ? 'text-emerald-700' : pct >= 75 ? 'text-amber-700' : 'text-rose-700';
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className={`text-3xl font-bold tracking-tight ${tone}`}>{pct}%</p>
        <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--ink-4)]">on-time delivery</p>
        <p className="mt-1.5 text-[11px] text-[var(--ink-4)]">{sla.delivered} delivered · {sla.onTime} on time · {sla.late} late</p>
      </div>
      <div className="relative grid h-20 w-20 place-items-center">
        <svg viewBox="0 0 80 80" className="absolute inset-0">
          <circle cx="40" cy="40" r="34" fill="none" stroke="var(--line)" strokeWidth="7" />
          <circle cx="40" cy="40" r="34" fill="none" stroke={pct >= 90 ? '#10b981' : pct >= 75 ? '#f59e0b' : '#dc2626'} strokeWidth="7" strokeDasharray={`${(pct / 100) * 213.6} 213.6`} strokeLinecap="round" transform="rotate(-90 40 40)" />
        </svg>
        <span className={`text-xs font-bold ${tone}`}>{pct}%</span>
      </div>
    </div>
  );
}

function ReceivablesBars({ data }: { data: any[] }) {
  if (!data.length) return <p className="rounded-r3 border border-dashed border-[var(--line)] p-4 text-center text-[11px] text-[var(--ink-4)]">All cleared</p>;
  const max = Math.max(...data.map((d) => d.amount), 1);
  const colors: Record<string, string> = { '0-30': 'from-emerald-500 to-emerald-700', '31-60': 'from-amber-500 to-amber-700', '61-90': 'from-orange-500 to-orange-700', '90+': 'from-rose-600 to-rose-800' };
  return (
    <div>
      <div className="flex items-end gap-2 h-32 px-2">
        {data.map((d) => (
          <div key={d.range} className="flex-1 text-center">
            <div className="relative h-24">
              <div className={`absolute bottom-0 left-0 right-0 rounded-t-md bg-gradient-to-t ${colors[d.range] || colors['0-30']}`} style={{ height: `${(d.amount / max) * 100}%` }} />
            </div>
            <p className="mt-1.5 text-[10px] font-bold uppercase tracking-widest text-[var(--ink-4)]">{d.range}</p>
            <p className="text-[11px] font-bold text-[var(--ink)]">{moneyShort(d.amount)}</p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-[var(--ink-4)]">
        Total <b className="text-[var(--ink-2)]">{moneyShort(data.reduce((s, d) => s + d.amount, 0))}</b>
      </p>
    </div>
  );
}

function InventoryHealthCards({ data }: { data: any }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="rounded-r3 border border-[var(--line)] bg-[var(--bg-soft)] p-3 text-center">
        <p className="text-base font-bold text-[var(--ink)]">{moneyShort(data.totalStockValue || 0)}</p>
        <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-[var(--ink-4)]">Stock value</p>
      </div>
      <div className="rounded-r3 border border-[var(--line)] bg-[var(--bg-soft)] p-3 text-center">
        <p className="text-base font-bold text-[var(--ink)]">{data.activeSkuCount || 0}</p>
        <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-[var(--ink-4)]">Active SKUs</p>
      </div>
      <div className="rounded-r3 border border-rose-200 bg-rose-50 p-3 text-center">
        <p className="text-base font-bold text-rose-700">{data.deadStockCount || 0}</p>
        <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-rose-700">Dead SKUs 90d</p>
      </div>
      <div className="rounded-r3 border border-amber-200 bg-amber-50 p-3 text-center">
        <p className="text-base font-bold text-amber-700">{data.lowStockCount || 0}</p>
        <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-amber-700">Low stock</p>
      </div>
    </div>
  );
}

// ===========================================================================
// SALES TAB
// ===========================================================================
function SalesTab({ board, segment, onSegment }: { board: any; segment: string; onSegment: (s: string) => void }) {
  const segments = [
    { id: 'all', label: 'All sales' },
    { id: 'walkin', label: 'Walk-in' },
    { id: 'architect', label: 'Architect' },
    { id: 'b2b', label: 'B2B (GST)' },
    { id: 'b2c', label: 'B2C' },
    { id: 'cash', label: 'Cash' },
    { id: 'credit', label: 'Credit' },
  ];
  return (
    <div className="space-y-4">
      {/* segment chips */}
      <div className="flex flex-wrap items-center gap-2 rounded-r4 border border-[var(--line)] bg-[var(--surface)] px-3 py-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--ink-4)]">Slice by</span>
        {segments.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onSegment(s.id)}
            className={
              segment === s.id
                ? 'inline-flex items-center rounded-full bg-[var(--surface-3)] px-3 py-1 text-[11px] font-bold text-[var(--bg)]'
                : 'inline-flex items-center rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1 text-[11px] font-semibold text-[var(--ink-2)] hover:bg-[var(--bg-soft)]'
            }
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(board.kpis || []).map((kpi: Kpi) => <KpiTile key={kpi.id} kpi={kpi} />)}
      </div>

      {/* Revenue trend + walkin/architect */}
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Panel title="Revenue by day" sub="cash vs credit">
          <div className="h-64 -mx-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={board.dailyData || []} margin={{ top: 10, right: 12, bottom: 4, left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="var(--ink-4)" tickFormatter={(d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} />
                <YAxis tick={{ fontSize: 10 }} stroke="var(--ink-4)" tickFormatter={(v) => moneyShort(v)} width={50} />
                <Tooltip formatter={(v: any) => moneyFull(Number(v))} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" dataKey="cash" stackId="1" stroke="#10b981" fill="#10b981" fillOpacity={0.7} name="Cash" />
                <Area type="monotone" dataKey="credit" stackId="1" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.7} name="Credit" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Walk-in vs Architect">
          <SourceMixWidget mix={board.sourceMix || {}} />
        </Panel>
      </div>

      {/* Category stacked + heatmap */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Revenue by category" sub="last 6 months">
          <CategoryStackChart data={board.categoryStack || []} />
        </Panel>
        <Panel title="Sales heatmap" sub="orders by hour × day">
          <HeatmapWidget data={board.heatmap || []} />
        </Panel>
      </div>

      {/* Discount + top SKUs + reps */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Discount impact" sub="order size vs discount %">
          <DiscountScatterChart data={board.scatter || []} />
        </Panel>
        <Panel title="Top 10 SKUs" sub="period">
          <SkusTable skus={board.topSkus || []} />
        </Panel>
        <Panel title="Sales rep performance" sub="period">
          <RepPerfTable reps={board.repPerformance || []} />
        </Panel>
      </div>

      {/* Cohort retention */}
      <Panel title="Customer cohort retention" sub="% returning after first order">
        <CohortTable cohort={board.cohort || []} />
      </Panel>
    </div>
  );
}

function SourceMixWidget({ mix }: { mix: any }) {
  const arch = mix.architect || { revenue: 0, count: 0, aov: 0 };
  const walk = mix.walkin || { revenue: 0, count: 0, aov: 0 };
  const total = arch.revenue + walk.revenue;
  const archPct = total > 0 ? (arch.revenue / total) * 100 : 0;
  const walkPct = total > 0 ? (walk.revenue / total) * 100 : 0;
  return (
    <div>
      <div className="mb-3 flex h-8 overflow-hidden rounded-md">
        <div className="flex items-center justify-center bg-gradient-to-r from-violet-600 to-violet-800 text-[11px] font-bold text-white" style={{ width: `${archPct}%` }}>
          {archPct > 15 ? `Architect ${archPct.toFixed(0)}%` : ''}
        </div>
        <div className="flex items-center justify-center bg-gradient-to-r from-blue-600 to-blue-800 text-[11px] font-bold text-white" style={{ width: `${walkPct}%` }}>
          {walkPct > 15 ? `Walk-in ${walkPct.toFixed(0)}%` : ''}
        </div>
      </div>
      <table className="w-full text-[11px]">
        <thead><tr className="text-[9px] font-bold uppercase tracking-widest text-[var(--ink-4)]"><th className="text-left py-1">Segment</th><th className="text-right py-1">Revenue</th><th className="text-right py-1">Orders</th><th className="text-right py-1">AOV</th></tr></thead>
        <tbody>
          <tr><td className="py-1.5 font-bold text-violet-700">Architect</td><td className="text-right font-bold text-[var(--ink)] mp-mono">{moneyShort(arch.revenue)}</td><td className="text-right text-[var(--ink-2)] mp-mono">{arch.count}</td><td className="text-right text-[var(--ink-2)] mp-mono">{moneyShort(arch.aov)}</td></tr>
          <tr><td className="py-1.5 font-bold text-blue-700">Walk-in</td><td className="text-right font-bold text-[var(--ink)] mp-mono">{moneyShort(walk.revenue)}</td><td className="text-right text-[var(--ink-2)] mp-mono">{walk.count}</td><td className="text-right text-[var(--ink-2)] mp-mono">{moneyShort(walk.aov)}</td></tr>
        </tbody>
      </table>
      {arch.aov > 0 && walk.aov > 0 ? (
        <p className="mt-2 border-t border-dashed border-[var(--line)] pt-2 text-[11px] font-bold text-violet-700">
          Architect AOV is {(arch.aov / walk.aov).toFixed(1)}× walk-in
        </p>
      ) : null}
    </div>
  );
}

function CategoryStackChart({ data }: { data: any[] }) {
  if (!data.length) return <p className="rounded-r3 border border-dashed border-[var(--line)] p-4 text-center text-[11px] text-[var(--ink-4)]">No category sales in this range</p>;
  const categories = Array.from(new Set(data.flatMap((d) => Object.keys(d).filter((k) => k !== 'month'))));
  const COLORS: Record<string, string> = { Tiles: '#f59e0b', Faucets: '#2563eb', Sanitary: '#10b981', Sanitaryware: '#10b981', Showers: '#7c3aed', Mixers: '#0284c7', Other: '#64748b' };
  return (
    <div className="h-64 -mx-2">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 12, bottom: 4, left: -10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
          <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke="var(--ink-4)" />
          <YAxis tick={{ fontSize: 10 }} stroke="var(--ink-4)" tickFormatter={(v) => moneyShort(v)} width={50} />
          <Tooltip formatter={(v: any) => moneyFull(Number(v))} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {categories.map((cat, i) => (
            <Bar key={cat} dataKey={cat} stackId="a" fill={COLORS[cat] || ['#3b82f6', '#10b981', '#f59e0b', '#7c3aed', '#0284c7'][i % 5]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function HeatmapWidget({ data }: { data: any[] }) {
  if (!data.length) return <p className="rounded-r3 border border-dashed border-[var(--line)] p-4 text-center text-[11px] text-[var(--ink-4)]">No orders in this range</p>;
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  // Find max for shade scaling
  let max = 0;
  for (const row of data) {
    for (const d of days) max = Math.max(max, Number(row[d] || 0));
  }
  const shadeFor = (v: number) => {
    if (max === 0) return '#eff6ff';
    const ratio = v / max;
    if (ratio === 0) return '#eff6ff';
    if (ratio < 0.25) return '#bfdbfe';
    if (ratio < 0.5) return '#60a5fa';
    if (ratio < 0.75) return '#3b82f6';
    return '#1d4ed8';
  };
  return (
    <div className="grid grid-cols-[30px_repeat(7,1fr)] gap-1">
      <div></div>
      {days.map((d) => <div key={d} className="text-center text-[9px] font-bold text-[var(--ink-4)]">{d}</div>)}
      {data.map((row) => (
        <>
          <div key={`h${row.hour}`} className="pr-1 text-right text-[9px] font-bold text-[var(--ink-4)] leading-[16px]">{row.hour}</div>
          {days.map((d) => (
            <div key={`${row.hour}-${d}`} className="h-4 rounded-sm" style={{ background: shadeFor(Number(row[d] || 0)) }} title={`${row.hour}:00 ${d} — ${row[d] || 0} orders`} />
          ))}
        </>
      ))}
    </div>
  );
}

function DiscountScatterChart({ data }: { data: any[] }) {
  if (!data.length) return <p className="rounded-r3 border border-dashed border-[var(--line)] p-4 text-center text-[11px] text-[var(--ink-4)]">No order discount rows in this range</p>;
  return (
    <div className="h-56 -mx-2">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 10, right: 12, bottom: 4, left: -10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
          <XAxis dataKey="discount" type="number" tick={{ fontSize: 10 }} stroke="var(--ink-4)" tickFormatter={(v) => `${v}%`} />
          <YAxis dataKey="amount" type="number" tick={{ fontSize: 10 }} stroke="var(--ink-4)" tickFormatter={(v) => moneyShort(v)} width={50} />
          <ZAxis range={[40, 200]} />
          <Tooltip formatter={(v: any, name: string) => name === 'amount' ? moneyFull(Number(v)) : `${v}%`} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 11 }} cursor={{ strokeDasharray: '3 3' }} />
          <Scatter data={data} fill="#2563eb" fillOpacity={0.6} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

function SkusTable({ skus }: { skus: any[] }) {
  if (!skus.length) return <p className="rounded-r3 border border-dashed border-[var(--line)] p-4 text-center text-[11px] text-[var(--ink-4)]">No SKUs</p>;
  return (
    <table className="w-full text-[11px]">
      <thead><tr className="text-[9px] font-bold uppercase tracking-widest text-[var(--ink-4)]"><th className="text-left py-1">SKU</th><th className="text-right py-1">Units</th><th className="text-right py-1">Revenue</th></tr></thead>
      <tbody>
        {skus.slice(0, 10).map((s) => (
          <tr key={s.sku} className="border-t border-[var(--line)]">
            <td className="py-1.5"><span className="font-bold text-[var(--ink)]">{s.name}</span><span className="ml-1 font-mono text-[9px] text-[var(--ink-4)]">{s.sku}</span></td>
            <td className="text-right font-bold text-[var(--ink)] mp-mono">{s.units}</td>
            <td className="text-right font-bold text-[var(--ink-2)] mp-mono">{moneyShort(s.revenue)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RepPerfTable({ reps }: { reps: any[] }) {
  if (!reps.length) return <p className="rounded-r3 border border-dashed border-[var(--line)] p-4 text-center text-[11px] text-[var(--ink-4)]">No reps</p>;
  return (
    <table className="w-full text-[11px]">
      <thead><tr className="text-[9px] font-bold uppercase tracking-widest text-[var(--ink-4)]"><th className="text-left py-1">Rep</th><th className="text-right py-1">Revenue</th><th className="text-right py-1">AOV</th><th className="text-right py-1">Conv%</th></tr></thead>
      <tbody>
        {reps.map((r) => (
          <tr key={r.userId} className="border-t border-[var(--line)]">
            <td className="py-1.5 font-bold text-[var(--ink)]">{r.name}</td>
            <td className="text-right font-bold text-[var(--ink-2)] mp-mono">{moneyShort(r.revenue)}</td>
            <td className="text-right text-[var(--ink-3)] mp-mono">{moneyShort(r.aov)}</td>
            <td className="text-right font-bold text-[var(--ink)] mp-mono">{r.conversion.toFixed(0)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CohortTable({ cohort }: { cohort: any[] }) {
  if (!cohort.length) return <p className="rounded-r3 border border-dashed border-[var(--line)] p-4 text-center text-[11px] text-[var(--ink-4)]">No repeat-purchase cohorts in live orders</p>;
  const maxMonths = Math.max(1, ...cohort.map((c) => c.retention.length));
  const shadeFor = (pct: number) => {
    if (pct >= 80) return { bg: '#1d4ed8', fg: '#fff' };
    if (pct >= 50) return { bg: '#3b82f6', fg: '#fff' };
    if (pct >= 30) return { bg: '#60a5fa', fg: '#fff' };
    if (pct >= 15) return { bg: '#93c5fd', fg: '#1e3a8a' };
    if (pct > 0) return { bg: '#dbeafe', fg: '#1e3a8a' };
    return { bg: 'var(--bg-soft)', fg: 'var(--ink-5)' };
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr>
            <th className="py-1.5 px-2 text-left text-[9px] font-bold uppercase tracking-widest text-[var(--ink-4)]">First order month</th>
            <th className="py-1.5 px-2 text-right text-[9px] font-bold uppercase tracking-widest text-[var(--ink-4)]">Customers</th>
            {Array.from({ length: maxMonths }).map((_, i) => (
              <th key={i} className="py-1.5 px-2 text-right text-[9px] font-bold uppercase tracking-widest text-[var(--ink-4)]">M+{i}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cohort.map((c) => (
            <tr key={c.cohort}>
              <td className="py-1.5 px-2 font-bold text-[var(--ink)]">{c.cohort}</td>
              <td className="py-1.5 px-2 text-right font-bold text-[var(--ink-2)] mp-mono">{c.customers}</td>
              {Array.from({ length: maxMonths }).map((_, i) => {
                if (i >= c.retention.length) return <td key={i} className="px-2 py-1.5 text-right text-[var(--ink-5)]">—</td>;
                const pct = c.retention[i];
                const tone = shadeFor(pct);
                return <td key={i} className="p-1 text-right text-[11px] font-bold mp-mono" style={{ background: tone.bg, color: tone.fg }}>{pct.toFixed(0)}%</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ===========================================================================
// PIPELINE TAB
// ===========================================================================
function PipelineTab({ board }: { board: any }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {(board.kpis || []).map((kpi: Kpi) => <KpiTile key={kpi.id} kpi={kpi} />)}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Overall funnel" sub="all-time">
          <FunnelChart funnel={board.funnel || []} />
        </Panel>
        <Panel title="Stale lead ageing" sub="open leads by last contact">
          <StaleBuckets buckets={board.staleBuckets || []} />
        </Panel>
      </div>

      <Panel title="Funnel by source" sub="conversion per lead source">
        <SourceTable sources={board.funnelBySource || []} />
      </Panel>

      <Panel title="Won-deal cycle time" sub="days from lead creation to won">
        <CycleHistogram histogram={board.cycleHistogram || []} />
      </Panel>
    </div>
  );
}

function FunnelChart({ funnel }: { funnel: any[] }) {
  const colors = ['from-blue-500 to-blue-700', 'from-sky-500 to-sky-700', 'from-amber-500 to-amber-700', 'from-violet-500 to-violet-700', 'from-emerald-500 to-emerald-700'];
  return (
    <div className="space-y-2">
      {funnel.map((f, i) => (
        <div key={f.stage} className="grid grid-cols-[1fr_auto] items-center gap-2">
          <div className={`flex h-9 items-center rounded-md bg-gradient-to-r ${colors[i] || colors[0]} px-3 text-xs font-bold text-white`} style={{ width: `${Math.max(20, f.percent)}%` }}>
            {f.stage}
          </div>
          <div className="text-right">
            <p className="text-sm font-bold text-[var(--ink)] mp-mono">{f.count}</p>
            <p className="text-[9px] font-bold text-[var(--ink-4)]">{f.percent.toFixed(0)}%</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function StaleBuckets({ buckets }: { buckets: any[] }) {
  if (!buckets.length) return <p className="rounded-r3 border border-dashed border-[var(--line)] p-4 text-center text-[11px] text-[var(--ink-4)]">No open leads</p>;
  const max = Math.max(...buckets.map((b) => b.count), 1);
  const colorFor = (range: string) => {
    if (range === '0-3d') return 'from-emerald-500 to-emerald-700';
    if (range === '4-7d') return 'from-amber-500 to-amber-700';
    if (range === '8-14d') return 'from-orange-500 to-orange-700';
    return 'from-rose-600 to-rose-800';
  };
  return (
    <div className="flex h-44 items-end gap-3 px-3">
      {buckets.map((b) => (
        <div key={b.range} className="flex-1 text-center">
          <div className="relative h-32">
            <div className={`absolute bottom-0 left-0 right-0 rounded-t-md bg-gradient-to-t ${colorFor(b.range)}`} style={{ height: `${(b.count / max) * 100}%` }} />
          </div>
          <p className="mt-1.5 text-[10px] font-bold uppercase tracking-widest text-[var(--ink-4)]">{b.range}</p>
          <p className="text-sm font-bold text-[var(--ink)]">{b.count}</p>
        </div>
      ))}
    </div>
  );
}

function SourceTable({ sources }: { sources: any[] }) {
  if (!sources.length) return <p className="rounded-r3 border border-dashed border-[var(--line)] p-4 text-center text-[11px] text-[var(--ink-4)]">No source data</p>;
  return (
    <table className="w-full text-[11px]">
      <thead><tr className="text-[9px] font-bold uppercase tracking-widest text-[var(--ink-4)]"><th className="text-left py-1">Source</th><th className="text-right py-1">Leads</th><th className="text-right py-1">Contacted</th><th className="text-right py-1">Quoted</th><th className="text-right py-1">Won</th><th className="text-right py-1">Conv%</th><th className="text-right py-1">Revenue</th></tr></thead>
      <tbody>
        {sources.map((s) => (
          <tr key={s.source} className="border-t border-[var(--line)]">
            <td className="py-1.5 font-bold text-[var(--ink)]">{s.source}</td>
            <td className="text-right text-[var(--ink-2)] mp-mono">{s.leads}</td>
            <td className="text-right text-[var(--ink-2)] mp-mono">{s.contacted}</td>
            <td className="text-right text-[var(--ink-2)] mp-mono">{s.quoted}</td>
            <td className="text-right font-bold text-emerald-700 mp-mono">{s.won}</td>
            <td className="text-right font-bold text-[var(--ink)] mp-mono">{s.conversion.toFixed(0)}%</td>
            <td className="text-right font-bold text-[var(--ink)] mp-mono">{moneyShort(s.revenue)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CycleHistogram({ histogram }: { histogram: any[] }) {
  if (!histogram.length) return <p className="rounded-r3 border border-dashed border-[var(--line)] p-4 text-center text-[11px] text-[var(--ink-4)]">No won leads with cycle time</p>;
  return (
    <div className="h-48 -mx-2">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={histogram} margin={{ top: 10, right: 12, bottom: 4, left: -10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
          <XAxis dataKey="range" tick={{ fontSize: 10 }} stroke="var(--ink-4)" />
          <YAxis tick={{ fontSize: 10 }} stroke="var(--ink-4)" width={30} />
          <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 11 }} />
          <Bar dataKey="count" fill="#7c3aed" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ===========================================================================
// INVENTORY TAB
// ===========================================================================
function InventoryTab({ board }: { board: any }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {(board.kpis || []).map((kpi: Kpi) => <KpiTile key={kpi.id} kpi={kpi} />)}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Stock value by category">
          <StockByCategory data={board.stockByCategory || []} />
        </Panel>
        <Panel title="ABC analysis" sub={`${board.abcSummary?.A || 0}A · ${board.abcSummary?.B || 0}B · ${board.abcSummary?.C || 0}C · ${board.abcSummary?.totalSkus || 0} total`}>
          <ABCChart data={board.abc || []} />
        </Panel>
      </div>

      <Panel title="Reorder alerts" sub={`${(board.reorderAlerts || []).length} SKUs at or below threshold`}>
        <ReorderAlertsTable data={board.reorderAlerts || []} />
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Dead stock" sub="no movement in 90 days">
          <DeadStockTable data={board.deadStock || []} />
        </Panel>
        <Panel title="Fast vs slow movers" sub="last 90 days">
          <MoversTable fast={board.fastMovers || []} slow={board.slowMovers || []} />
        </Panel>
      </div>
    </div>
  );
}

function StockByCategory({ data }: { data: any[] }) {
  if (!data.length) return <p className="rounded-r3 border border-dashed border-[var(--line)] p-4 text-center text-[11px] text-[var(--ink-4)]">No stock</p>;
  return (
    <div className="space-y-2">
      {data.slice(0, 8).map((c) => (
        <div key={c.category} className="text-[11px]">
          <div className="flex items-center justify-between">
            <span className="font-bold text-[var(--ink)]">{c.category}</span>
            <span className="text-[var(--ink-3)]">{moneyShort(c.value)} · {c.units}u · {c.skus} SKUs</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded bg-[var(--bg-soft)]">
            <div className="h-full bg-gradient-to-r from-blue-500 to-blue-700" style={{ width: `${c.percent}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ABCChart({ data }: { data: any[] }) {
  if (!data.length) return <p className="rounded-r3 border border-dashed border-[var(--line)] p-4 text-center text-[11px] text-[var(--ink-4)]">No stocked SKUs to classify</p>;
  const sample = data.slice(0, 40);
  return (
    <div className="h-56 -mx-2">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={sample.map((s, i) => ({ idx: i + 1, value: s.value, cumulative: s.cumulativePercent, cls: s.abcClass }))} margin={{ top: 10, right: 12, bottom: 4, left: -10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
          <XAxis dataKey="idx" tick={{ fontSize: 9 }} stroke="var(--ink-4)" />
          <YAxis yAxisId="left" tick={{ fontSize: 9 }} stroke="var(--ink-4)" tickFormatter={(v) => moneyShort(v)} width={50} />
          <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 9 }} stroke="var(--ink-4)" tickFormatter={(v) => `${v}%`} width={40} />
          <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 11 }} />
          <Bar yAxisId="left" dataKey="value" radius={[3, 3, 0, 0]}>
            {sample.map((s, i) => <Cell key={i} fill={s.abcClass === 'A' ? '#dc2626' : s.abcClass === 'B' ? '#f59e0b' : '#10b981'} />)}
          </Bar>
          <Line yAxisId="right" type="monotone" dataKey="cumulative" stroke="#2563eb" strokeWidth={2} dot={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function ReorderAlertsTable({ data }: { data: any[] }) {
  if (!data.length) return <p className="rounded-r3 border border-dashed border-[var(--line)] p-4 text-center text-[11px] text-[var(--ink-4)]">All stock above reorder point</p>;
  return (
    <table className="w-full text-[11px]">
      <thead><tr className="text-[9px] font-bold uppercase tracking-widest text-[var(--ink-4)]"><th className="text-left py-1">SKU</th><th className="text-left py-1">Category</th><th className="text-right py-1">On hand</th><th className="text-right py-1">Available</th><th className="text-right py-1">Threshold</th><th></th></tr></thead>
      <tbody>
        {data.map((r) => (
          <tr key={r.sku} className="border-t border-[var(--line)]">
            <td className="py-1.5"><span className="font-bold text-[var(--ink)]">{r.name}</span><span className="ml-1 font-mono text-[9px] text-[var(--ink-4)]">{r.sku}</span></td>
            <td className="text-[var(--ink-3)]">{r.category || '—'}</td>
            <td className="text-right font-bold text-rose-700 mp-mono">{r.onHand}</td>
            <td className="text-right font-bold text-rose-700 mp-mono">{r.available}</td>
            <td className="text-right text-[var(--ink-3)] mp-mono">{r.threshold}</td>
            <td className="text-right">
              <Link href="/dashboard/procurement#view=demand" className="rounded bg-[var(--brand-600)] px-2 py-0.5 text-[10px] font-bold text-white hover:bg-[var(--brand-700)]">Create PO</Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DeadStockTable({ data }: { data: any[] }) {
  if (!data.length) return <p className="rounded-r3 border border-dashed border-[var(--line)] p-4 text-center text-[11px] text-[var(--ink-4)]">No dead stock</p>;
  return (
    <table className="w-full text-[11px]">
      <thead><tr className="text-[9px] font-bold uppercase tracking-widest text-[var(--ink-4)]"><th className="text-left py-1">SKU</th><th className="text-right py-1">On hand</th><th className="text-right py-1">Value</th></tr></thead>
      <tbody>
        {data.slice(0, 12).map((d, i) => (
          <tr key={i} className="border-t border-[var(--line)]">
            <td className="py-1.5"><span className="font-bold text-[var(--ink)]">{d.name}</span><span className="ml-1 font-mono text-[9px] text-[var(--ink-4)]">{d.sku}</span></td>
            <td className="text-right text-[var(--ink-2)] mp-mono">{d.onHand}</td>
            <td className="text-right font-bold text-[var(--ink)] mp-mono">{moneyShort(d.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MoversTable({ fast, slow }: { fast: any[]; slow: any[] }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-emerald-700">Fast movers</p>
        <ul className="space-y-0.5 text-[11px]">
          {fast.slice(0, 8).map((m, i) => <li key={i} className="flex items-center justify-between"><span className="truncate font-semibold text-[var(--ink)]">{m.name}</span><span className="font-bold text-emerald-700 mp-mono">{m.moveCount}</span></li>)}
          {!fast.length ? <li className="text-[var(--ink-5)]">no data</li> : null}
        </ul>
      </div>
      <div>
        <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-rose-700">Slow movers</p>
        <ul className="space-y-0.5 text-[11px]">
          {slow.slice(0, 8).map((m, i) => <li key={i} className="flex items-center justify-between"><span className="truncate font-semibold text-[var(--ink)]">{m.name}</span><span className="font-bold text-rose-700 mp-mono">{m.moveCount}</span></li>)}
          {!slow.length ? <li className="text-[var(--ink-5)]">no data</li> : null}
        </ul>
      </div>
    </div>
  );
}

// ===========================================================================
// PROCUREMENT TAB
// ===========================================================================
function ProcurementTab({ board }: { board: any }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {(board.kpis || []).map((kpi: Kpi) => <KpiTile key={kpi.id} kpi={kpi} />)}
      </div>

      <Panel title="Vendor scorecard" sub="on-time delivery · lead time · spend">
        <VendorScorecard vendors={board.vendorScorecards || []} />
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Spend by vendor" sub="top 10">
          <SpendByVendor data={board.spendByVendor || []} />
        </Panel>
        <Panel title="Open PO ageing" sub="by expected date">
          <POAgeing ageing={board.poAgeing || {}} ageingValue={board.poAgeingValue || {}} />
        </Panel>
      </div>

      <Panel title="Quality" sub="received vs damaged">
        <DamageStats damaged={board.damagedPercent || 0} received={board.totalReceived || 0} damagedUnits={board.totalDamaged || 0} />
      </Panel>
    </div>
  );
}

function VendorScorecard({ vendors }: { vendors: any[] }) {
  if (!vendors.length) return <p className="rounded-r3 border border-dashed border-[var(--line)] p-4 text-center text-[11px] text-[var(--ink-4)]">No vendor data</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead><tr className="text-[9px] font-bold uppercase tracking-widest text-[var(--ink-4)]"><th className="text-left py-1">Vendor</th><th className="text-left py-1">Category</th><th className="text-right py-1">On-time %</th><th className="text-right py-1">Avg lead time</th><th className="text-right py-1">Spend</th><th className="text-right py-1">Open POs</th></tr></thead>
        <tbody>
          {vendors.map((v) => {
            const otTone = v.onTimePercent >= 90 ? 'text-emerald-700' : v.onTimePercent >= 75 ? 'text-amber-700' : 'text-rose-700';
            return (
              <tr key={v.vendorId} className="border-t border-[var(--line)]">
                <td className="py-1.5 font-bold text-[var(--ink)]">{v.name}</td>
                <td className="text-[var(--ink-3)]">{v.category || '—'}</td>
                <td className={`text-right font-bold mp-mono ${otTone}`}>{v.onTimePercent.toFixed(0)}%</td>
                <td className="text-right text-[var(--ink-2)] mp-mono">{v.avgLeadTime.toFixed(0)} d</td>
                <td className="text-right font-bold text-[var(--ink)] mp-mono">{moneyShort(v.spend)}</td>
                <td className="text-right text-[var(--ink-2)] mp-mono">{v.openCount}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SpendByVendor({ data }: { data: any[] }) {
  if (!data.length) return <p className="rounded-r3 border border-dashed border-[var(--line)] p-4 text-center text-[11px] text-[var(--ink-4)]">No spend</p>;
  const max = Math.max(...data.map((d) => d.spend), 1);
  return (
    <div className="space-y-1.5">
      {data.map((v) => (
        <div key={v.vendorId} className="text-[11px]">
          <div className="flex items-center justify-between">
            <span className="font-bold text-[var(--ink)] truncate">{v.name}</span>
            <span className="font-bold text-[var(--ink)] mp-mono">{moneyShort(v.spend)}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded bg-[var(--bg-soft)]">
            <div className="h-full bg-gradient-to-r from-violet-500 to-violet-700" style={{ width: `${(v.spend / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function POAgeing({ ageing, ageingValue }: { ageing: any; ageingValue: any }) {
  const buckets = [
    { id: 'overdue', label: 'Overdue', color: 'from-rose-600 to-rose-800' },
    { id: 'due_week', label: 'Due ≤ 7d', color: 'from-amber-500 to-amber-700' },
    { id: 'future', label: 'Future', color: 'from-emerald-500 to-emerald-700' },
    { id: 'no_date', label: 'No date', color: 'from-slate-400 to-slate-600' },
  ];
  const max = Math.max(1, ...buckets.map((b) => Number(ageingValue[b.id] || 0)));
  return (
    <div className="space-y-2">
      {buckets.map((b) => (
        <div key={b.id} className="text-[11px]">
          <div className="flex items-center justify-between">
            <span className="font-bold text-[var(--ink)]">{b.label}</span>
            <span className="font-bold text-[var(--ink-2)] mp-mono">{ageing[b.id] || 0} POs · {moneyShort(ageingValue[b.id] || 0)}</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded bg-[var(--bg-soft)]">
            <div className={`h-full bg-gradient-to-r ${b.color}`} style={{ width: `${((ageingValue[b.id] || 0) / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function DamageStats({ damaged, received, damagedUnits }: { damaged: number; received: number; damagedUnits: number }) {
  return (
    <div className="grid grid-cols-3 gap-3 text-center">
      <div className="rounded-r3 border border-[var(--line)] bg-[var(--bg-soft)] p-3">
        <p className="text-lg font-bold text-[var(--ink)]">{received}</p>
        <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-[var(--ink-4)]">Units received</p>
      </div>
      <div className="rounded-r3 border border-rose-200 bg-rose-50 p-3">
        <p className="text-lg font-bold text-rose-700">{damagedUnits}</p>
        <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-rose-700">Damaged units</p>
      </div>
      <div className="rounded-r3 border border-[var(--line)] bg-[var(--bg-soft)] p-3">
        <p className="text-lg font-bold text-[var(--ink)]">{damaged.toFixed(1)}%</p>
        <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-[var(--ink-4)]">Damage rate</p>
      </div>
    </div>
  );
}

// ===========================================================================
// MONEY TAB
// ===========================================================================
function MoneyTab({ board }: { board: any }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {(board.kpis || []).map((kpi: Kpi) => <KpiTile key={kpi.id} kpi={kpi} />)}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Receivables ageing" sub="outstanding by age">
          <AgeingBars data={board.ageingBuckets || []} />
        </Panel>
        <Panel title="Payment mode mix" sub="period">
          <PaymentDonut data={board.paymentModeMix?.map((p: any) => ({ ...p, percent: (p.amount / Math.max(1, board.paymentModeMix.reduce((s: number, x: any) => s + x.amount, 0))) * 100 })) || []} />
        </Panel>
      </div>

      <Panel title="Weekly cash flow" sub="received vs refunded">
        <WeeklyCashFlow data={board.weeklyCashFlow || []} />
      </Panel>

      <Panel title="Top 20 outstanding" sub="customers with open balance">
        <OutstandingTable data={board.top20Outstanding || []} />
      </Panel>
    </div>
  );
}

function AgeingBars({ data }: { data: any[] }) {
  if (!data.length) return <p className="rounded-r3 border border-dashed border-[var(--line)] p-4 text-center text-[11px] text-[var(--ink-4)]">No outstanding</p>;
  const max = Math.max(...data.map((d) => d.amount), 1);
  const colors: Record<string, string> = { '0-30': 'from-emerald-500 to-emerald-700', '31-60': 'from-amber-500 to-amber-700', '61-90': 'from-orange-500 to-orange-700', '90+': 'from-rose-600 to-rose-800' };
  return (
    <div>
      <div className="flex items-end gap-3 h-44 px-2">
        {data.map((d) => (
          <div key={d.range} className="flex-1 text-center">
            <div className="relative h-32">
              <div className={`absolute bottom-0 left-0 right-0 rounded-t-md bg-gradient-to-t ${colors[d.range] || colors['0-30']}`} style={{ height: `${(d.amount / max) * 100}%` }} />
            </div>
            <p className="mt-1.5 text-[10px] font-bold uppercase tracking-widest text-[var(--ink-4)]">{d.range}d</p>
            <p className="text-sm font-bold text-[var(--ink)]">{moneyShort(d.amount)}</p>
            <p className="text-[10px] text-[var(--ink-4)]">{d.count} orders</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function WeeklyCashFlow({ data }: { data: any[] }) {
  if (!data.length) return <p className="rounded-r3 border border-dashed border-[var(--line)] p-4 text-center text-[11px] text-[var(--ink-4)]">No cash flow data</p>;
  return (
    <div className="h-56 -mx-2">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 12, bottom: 4, left: -10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
          <XAxis dataKey="week" tick={{ fontSize: 10 }} stroke="var(--ink-4)" tickFormatter={(d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} />
          <YAxis tick={{ fontSize: 10 }} stroke="var(--ink-4)" tickFormatter={(v) => moneyShort(v)} width={55} />
          <Tooltip formatter={(v: any) => moneyFull(Number(v))} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 11 }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="received" fill="#10b981" radius={[3, 3, 0, 0]} name="Received" />
          <Bar dataKey="refunded" fill="#dc2626" radius={[3, 3, 0, 0]} name="Refunded" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function OutstandingTable({ data }: { data: any[] }) {
  if (!data.length) return <p className="rounded-r3 border border-dashed border-[var(--line)] p-4 text-center text-[11px] text-[var(--ink-4)]">No outstanding balances</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead><tr className="text-[9px] font-bold uppercase tracking-widest text-[var(--ink-4)]"><th className="text-left py-1">Order</th><th className="text-left py-1">Customer</th><th className="text-right py-1">Total</th><th className="text-right py-1">Received</th><th className="text-right py-1">Balance</th><th className="text-right py-1">Age</th><th></th></tr></thead>
        <tbody>
          {data.map((o) => {
            const tone = o.ageDays > 90 ? 'text-rose-700' : o.ageDays > 60 ? 'text-orange-700' : o.ageDays > 30 ? 'text-amber-700' : 'text-emerald-700';
            return (
              <tr key={o.id} className="border-t border-[var(--line)]">
                <td className="py-1.5 font-mono text-[10px] text-[var(--ink-3)]">{o.orderNumber}</td>
                <td className="font-bold text-[var(--ink)]">{o.customerName}</td>
                <td className="text-right text-[var(--ink-2)] mp-mono">{moneyShort(o.total)}</td>
                <td className="text-right text-emerald-700 mp-mono">{moneyShort(o.received)}</td>
                <td className="text-right font-bold text-rose-700 mp-mono">{moneyShort(o.balance)}</td>
                <td className={`text-right font-bold mp-mono ${tone}`}>{o.ageDays}d</td>
                <td className="text-right">
                  <Link href={`/dashboard/sales/${o.id}`} className="rounded bg-[var(--brand-600)] px-2 py-0.5 text-[10px] font-bold text-white hover:bg-[var(--brand-700)]">Open</Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
