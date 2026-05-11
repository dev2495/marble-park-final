'use client';

import { gql, useQuery } from '@apollo/client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight, CalendarClock, CheckCircle2, ClipboardCheck, FileSpreadsheet, IndianRupee,
  PackageSearch, Plus, ShieldCheck, ShoppingBag, TrendingUp, Truck, Users,
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, ResponsiveContainer, Tooltip, XAxis, YAxis,
  CartesianGrid, Cell,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { QueryErrorBanner } from '@/components/query-state';

/**
 * Owner Command Center.
 *
 * Designed around what an owner actually has to act on every morning:
 *   1. Money this period (revenue, quote value, pipeline).
 *   2. Work in flight (approvals queue, dispatch backlog, leads needing follow-up).
 *   3. Trends (revenue by day for the period, pipeline by stage, sales by user).
 *   4. Inventory tension (low-stock SKUs that block dispatch).
 *
 * No vanity (image-coverage %, total-SKUs-imported). Every tile answers
 * "should I do something about this, and where?".
 */

const DASHBOARD = gql`
  query OwnerCommandCenter($salesOwnerId: String!) {
    ownerDashboard {
      stats
      recentQuotes
      recentLeads
      userPerformance
    }
    salesDashboard(ownerId: $salesOwnerId) {
      stats
      pendingFollowups
    }
    inventoryDashboard {
      stats
      summary
    }
    quotes(status: "pending_approval") {
      id
      quoteNumber
      status
      approvalStatus
      lines
      customer
      owner
    }
    leads {
      id
      stage
      expectedValue
    }
    salesOrderStats(range: "month")
    lowStockBalances(take: 8) {
      id
      available
      lowStockThreshold
      reorderPoint
      isLowStock
      product { id sku name brand }
    }
  }
`;

function money(value: number) {
  const n = Math.round(Number(value || 0));
  if (Math.abs(n) >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`;
  if (Math.abs(n) >= 100000) return `₹${(n / 100000).toFixed(2)}L`;
  if (Math.abs(n) >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${n.toLocaleString('en-IN')}`;
}
function moneyExact(value: number) {
  return `₹${Math.round(Number(value || 0)).toLocaleString('en-IN')}`;
}
function quoteTotal(lines: any) {
  return (Array.isArray(lines) ? lines : []).reduce(
    (sum, line) => sum + Number(line.qty || line.quantity || 0) * Number(line.price || line.sellPrice || 0),
    0,
  );
}

const STAGE_ORDER = ['new', 'contacted', 'qualified', 'proposal', 'quoted', 'negotiation', 'won'];
const STAGE_LABELS: Record<string, string> = {
  new: 'New', contacted: 'Contacted', qualified: 'Qualified', proposal: 'Proposal',
  quoted: 'Quoted', negotiation: 'Negotiation', won: 'Won',
};

export default function OwnerDashboardPage() {
  const [user, setUser] = useState<any>(null);
  const [effectiveRole, setEffectiveRole] = useState('owner');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('user') || 'null');
      const override = localStorage.getItem('role_override');
      setUser(stored);
      setEffectiveRole(stored?.role === 'admin' && override ? override : stored?.role || 'owner');
    } catch {
      setEffectiveRole('owner');
    } finally {
      setReady(true);
    }
  }, []);

  const { data, loading, error, refetch } = useQuery(DASHBOARD, {
    variables: { salesOwnerId: user?.id || '' },
    skip: !ready || !user?.id,
  });

  const stats = data?.ownerDashboard?.stats || {};
  const userPerformance: any[] = data?.ownerDashboard?.userPerformance || [];
  const recentQuotes: any[] = data?.ownerDashboard?.recentQuotes || [];
  const recentLeads: any[] = data?.ownerDashboard?.recentLeads || [];
  const inventoryStats = data?.inventoryDashboard?.stats || {};
  const orderStats = data?.salesOrderStats || {};
  const approvalsQueue: any[] = data?.quotes || [];
  const leads: any[] = data?.leads || [];
  const followups: any[] = data?.salesDashboard?.pendingFollowups || [];
  const lowStock: any[] = data?.lowStockBalances || [];

  // Pipeline by stage (count + ₹ value).
  const pipelineByStage = useMemo(() => {
    const result: Array<{ stage: string; label: string; count: number; value: number }> = [];
    for (const stage of STAGE_ORDER) {
      const rows = leads.filter((l) => l.stage === stage);
      result.push({
        stage,
        label: STAGE_LABELS[stage] || stage,
        count: rows.length,
        value: rows.reduce((sum, l) => sum + Number(l.expectedValue || 0), 0),
      });
    }
    return result;
  }, [leads]);

  // Recent quote-value trend (last 30 days, derived from recentQuotes server-side
  // — we group by day from createdAt).
  const revenueTrend = useMemo(() => {
    const buckets = new Map<string, number>();
    const today = new Date();
    for (let i = 29; i >= 0; i -= 1) {
      const day = new Date(today);
      day.setDate(today.getDate() - i);
      const key = day.toISOString().slice(0, 10);
      buckets.set(key, 0);
    }
    for (const quote of recentQuotes) {
      if (!quote?.createdAt) continue;
      const key = String(quote.createdAt).slice(0, 10);
      if (!buckets.has(key)) continue;
      buckets.set(key, (buckets.get(key) || 0) + quoteTotal(quote.lines));
    }
    return Array.from(buckets.entries()).map(([day, value]) => ({
      day,
      label: new Date(day).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }),
      value,
    }));
  }, [recentQuotes]);

  const topSalespeople = useMemo(() => {
    return [...userPerformance]
      .filter((u) => u.role !== 'admin')
      .sort((a, b) => Number(b.quoteValue || 0) - Number(a.quoteValue || 0))
      .slice(0, 5);
  }, [userPerformance]);

  // ── Headline tiles ──
  type Tone = 'success' | 'warning' | 'brand' | 'neutral' | 'danger';
  const tiles: Array<{ label: string; value: string | number; caption: string; icon: any; tone: Tone; href: string }> = [
    {
      label: 'Revenue this month',
      value: money(orderStats.totalValue || 0),
      caption: `${orderStats.totalOrders || 0} orders · ${moneyExact((orderStats.totalValue || 0) / Math.max(orderStats.totalOrders || 1, 1))} avg`,
      icon: IndianRupee,
      tone: 'success',
      href: '/dashboard/orders',
    },
    {
      label: 'Pipeline value',
      value: money(stats.totalQuoteValue || 0),
      caption: `${stats.totalQuotes || 0} quotes · ${stats.quoteConversionRate || 0}% conversion`,
      icon: TrendingUp,
      tone: 'brand',
      href: '/dashboard/quotes',
    },
    {
      label: 'Approvals queue',
      value: approvalsQueue.length,
      caption: approvalsQueue.length ? 'Waiting for owner sign-off' : 'Nothing pending',
      icon: ClipboardCheck,
      tone: approvalsQueue.length ? 'warning' : 'neutral',
      href: '/dashboard/approvals',
    },
    {
      label: 'Dispatch backlog',
      value: stats.pendingDispatchJobs || 0,
      caption: `${stats.activeDispatchJobs || 0} active jobs in flight`,
      icon: Truck,
      tone: (stats.pendingDispatchJobs || 0) > 5 ? 'warning' : 'neutral',
      href: '/dashboard/dispatch',
    },
  ];

  // ── Secondary tiles (CRM signals) ──
  const secondary = [
    { label: 'Active leads', value: stats.totalLeads || leads.length, caption: `${pipelineByStage.find((s) => s.stage === 'new')?.count || 0} new`, icon: PackageSearch, href: '/dashboard/leads' },
    { label: 'Follow-ups due', value: followups.length, caption: followups.length ? 'Today / overdue' : 'All caught up', icon: CalendarClock, href: '/dashboard/sales' },
    { label: 'Won this month', value: orderStats.totalOrders || 0, caption: `${money(orderStats.cashValue || 0)} cash · ${money(orderStats.creditValue || 0)} credit`, icon: CheckCircle2, href: '/dashboard/orders' },
    { label: 'Customers', value: stats.totalCustomers || 0, caption: `${stats.totalUsers || 0} team members`, icon: Users, href: '/dashboard/customers' },
  ];

  return (
    <div className="space-y-6">
      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}

      {/* Greeting strip */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-[#71717a]">{effectiveRole.replace('_', ' ')} workspace</p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-[-0.02em] text-[#18181b] sm:text-4xl">
            {greetingFor(user?.name)}
          </h1>
          <p className="mt-1 text-sm text-[#52525b]">Here's where the store stands today. Click any tile to drill in.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm"><Link href="/dashboard/quotes/new"><Plus className="mr-1.5 h-4 w-4" /> New quote</Link></Button>
          <Button asChild variant="outline" size="sm"><Link href="/dashboard/leads/new">New lead</Link></Button>
          <Button asChild variant="outline" size="sm"><Link href="/dashboard/approvals">Approvals · {approvalsQueue.length}</Link></Button>
        </div>
      </div>

      {/* Headline tiles */}
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {tiles.map((tile) => <KpiTile key={tile.label} {...tile} loading={loading} />)}
      </section>

      {/* Revenue trend + Pipeline funnel */}
      <section className="grid gap-3 xl:grid-cols-[1.5fr_1fr]">
        <Card title="Quote value · last 30 days" subtitle="Pipeline activity by day, sum of line totals">
          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenueTrend} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="mp-area" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563eb" stopOpacity={0.18} />
                    <stop offset="100%" stopColor="#2563eb" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(113,113,122,0.10)" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: 'var(--ink-4)', fontSize: 11 }} tickLine={false} axisLine={false} interval={4} />
                <YAxis tick={{ fill: 'var(--ink-4)', fontSize: 11 }} tickLine={false} axisLine={false} width={50} tickFormatter={(v) => money(Number(v))} />
                <Tooltip formatter={(v: any) => moneyExact(Number(v))} labelStyle={{ color: 'var(--ink-3)' }} />
                <Area type="monotone" dataKey="value" stroke="#2563eb" strokeWidth={2} fill="url(#mp-area)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Pipeline by stage" subtitle="Open leads grouped by sales stage">
          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={pipelineByStage} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="rgba(113,113,122,0.10)" horizontal={false} />
                <XAxis type="number" tick={{ fill: 'var(--ink-4)', fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="label" tick={{ fill: 'var(--ink-3)', fontSize: 11 }} tickLine={false} axisLine={false} width={80} />
                <Tooltip formatter={(v: any, name: any, p: any) => [`${v} leads · ${moneyExact(p?.payload?.value || 0)}`, '']} cursor={{ fill: 'rgba(37,99,235,0.04)' }} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {pipelineByStage.map((entry, index) => (
                    <Cell key={index} fill={entry.stage === 'won' ? '#059669' : entry.count > 0 ? '#2563eb' : '#e4e4e7'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </section>

      {/* Secondary CRM signals */}
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {secondary.map((tile) => (
          <Link
            key={tile.label}
            href={tile.href}
            className="group flex items-center justify-between rounded-r4 border border-[#e4e4e7] bg-white p-4 transition-colors hover:border-[#d4d4d8] hover:bg-[#f4f4f5]"
          >
            <div className="min-w-0">
              <p className="text-xs font-medium text-[#71717a]">{tile.label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-[#18181b]">{loading ? '—' : tile.value}</p>
              <p className="mt-0.5 truncate text-[11px] text-[#71717a]">{tile.caption}</p>
            </div>
            <tile.icon className="h-5 w-5 shrink-0 text-[#a1a1aa] transition-colors group-hover:text-[#2563eb]" />
          </Link>
        ))}
      </section>

      {/* Sales team + Low-stock side by side */}
      <section className="grid gap-3 xl:grid-cols-[1.2fr_0.8fr]">
        <Card title="Top performers" subtitle="By confirmed quote value · this month" rightAction={<Link href="/dashboard/users" className="text-xs font-medium text-[#1d4ed8] hover:underline">View all</Link>}>
          <div className="overflow-hidden rounded-r3 border border-[#f4f4f5]">
            <table className="w-full text-sm">
              <thead className="bg-[#f4f4f5] text-left text-[11px] font-medium uppercase tracking-wider text-[#71717a]">
                <tr>
                  <th className="px-3 py-2.5">Salesperson</th>
                  <th className="px-3 py-2.5 text-right">Leads</th>
                  <th className="px-3 py-2.5 text-right">Quotes</th>
                  <th className="px-3 py-2.5 text-right">Won</th>
                  <th className="px-3 py-2.5 text-right">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f4f4f5]">
                {(loading && !topSalespeople.length ? Array.from({ length: 4 }) : topSalespeople).map((u: any, idx: number) => u ? (
                  <tr key={u.id} className="text-[#27272a]">
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <div className="grid h-7 w-7 place-items-center rounded-full bg-[#f4f4f5] text-xs font-semibold text-[#27272a]">{u.name?.[0] || '?'}</div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-[#18181b]">{u.name}</p>
                          <p className="text-[11px] capitalize text-[#71717a]">{String(u.role).replace('_', ' ')}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{u.leads}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{u.quotes}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[#059669]">{u.confirmedQuotes}</td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-[#18181b]">{money(u.quoteValue)}</td>
                  </tr>
                ) : (
                  <tr key={idx}><td colSpan={5} className="px-3 py-3"><div className="h-4 w-full animate-pulse rounded bg-[#f4f4f5]" /></td></tr>
                ))}
                {!loading && !topSalespeople.length ? (
                  <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-[#71717a]">No sales activity yet.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Low-stock alerts" subtitle={`${lowStock.length} SKU${lowStock.length === 1 ? '' : 's'} at or below threshold`} rightAction={<Link href="/dashboard/inventory" className="text-xs font-medium text-[#1d4ed8] hover:underline">Inventory</Link>}>
          {lowStock.length ? (
            <ul className="space-y-1.5">
              {lowStock.map((row: any) => (
                <li key={row.id} className="flex items-center justify-between rounded-r3 border border-[#f4f4f5] bg-white px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[#18181b]">{row.product?.name}</p>
                    <p className="truncate text-[11px] text-[#71717a]"><span className="mp-mono">{row.product?.sku}</span> · {row.product?.brand}</p>
                  </div>
                  <div className="ml-3 flex shrink-0 items-center gap-2 text-xs">
                    <span className="mp-pill mp-pill-danger">{row.available} left</span>
                    <span className="text-[#71717a]">≤ {row.reorderPoint ?? row.lowStockThreshold}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-r3 border border-dashed border-[#e4e4e7] p-6 text-center text-sm text-[#71717a]">All inventory above threshold.</p>
          )}
        </Card>
      </section>

      {/* Approval queue + Recent activity */}
      <section className="grid gap-3 xl:grid-cols-[1.2fr_0.8fr]">
        <Card title="Approval queue" subtitle="Quotes awaiting owner sign-off" rightAction={<Link href="/dashboard/approvals" className="text-xs font-medium text-[#1d4ed8] hover:underline">Open desk</Link>}>
          {approvalsQueue.length ? (
            <ul className="divide-y divide-[#f4f4f5]">
              {approvalsQueue.slice(0, 6).map((quote: any) => {
                const total = quoteTotal(quote.lines);
                return (
                  <li key={quote.id} className="flex items-center justify-between py-2.5">
                    <div className="min-w-0">
                      <Link href={`/dashboard/quotes/${quote.id}`} className="text-sm font-semibold text-[#18181b] hover:underline">{quote.quoteNumber}</Link>
                      <p className="truncate text-[11px] text-[#71717a]">{quote.customer?.name || 'Customer'} · {quote.owner?.name || 'Sales'}</p>
                    </div>
                    <div className="ml-3 flex shrink-0 items-center gap-2">
                      <span className="text-sm font-semibold tabular-nums text-[#18181b]">{money(total)}</span>
                      <span className="mp-pill mp-pill-warning">Pending</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="rounded-r3 border border-dashed border-[#e4e4e7] p-6 text-center text-sm text-[#71717a]">No approvals pending. Inbox zero.</p>
          )}
        </Card>

        <Card title="Recent activity" subtitle="Latest quotes and leads">
          <ul className="space-y-2">
            {recentQuotes.slice(0, 4).map((q: any) => (
              <li key={q.id} className="flex items-center justify-between gap-3 rounded-r3 px-2 py-1.5 hover:bg-[#f4f4f5]">
                <Link href={`/dashboard/quotes/${q.id}`} className="flex min-w-0 items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4 shrink-0 text-[#2563eb]" />
                  <span className="truncate text-sm font-medium text-[#18181b]">{q.quoteNumber}</span>
                  <span className="truncate text-[11px] text-[#71717a]">· {q.customer?.name || '—'}</span>
                </Link>
                <span className="shrink-0 text-xs tabular-nums text-[#52525b]">{money(quoteTotal(q.lines))}</span>
              </li>
            ))}
            {recentLeads.slice(0, 4).map((l: any) => (
              <li key={l.id} className="flex items-center justify-between gap-3 rounded-r3 px-2 py-1.5 hover:bg-[#f4f4f5]">
                <Link href={`/dashboard/leads/${l.id}`} className="flex min-w-0 items-center gap-2">
                  <PackageSearch className="h-4 w-4 shrink-0 text-[#52525b]" />
                  <span className="truncate text-sm font-medium text-[#18181b]">{l.title}</span>
                  <span className="truncate text-[11px] capitalize text-[#71717a]">· {l.stage}</span>
                </Link>
                <span className="shrink-0 text-xs tabular-nums text-[#52525b]">{money(l.expectedValue)}</span>
              </li>
            ))}
            {!recentQuotes.length && !recentLeads.length ? (
              <li className="rounded-r3 border border-dashed border-[#e4e4e7] p-6 text-center text-sm text-[#71717a]">No recent activity.</li>
            ) : null}
          </ul>
        </Card>
      </section>
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────

function greetingFor(name?: string) {
  const hour = new Date().getHours();
  const head = hour < 5 ? 'Working late' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return name ? `${head}, ${String(name).split(/\s+/)[0]}.` : `${head}.`;
}

function KpiTile({
  label, value, caption, icon: Icon, tone = 'neutral', href, loading,
}: {
  label: string;
  value: string | number;
  caption: string;
  icon: any;
  tone?: 'neutral' | 'brand' | 'success' | 'warning' | 'danger';
  href: string;
  loading?: boolean;
}) {
  const toneRing: Record<string, string> = {
    neutral: 'text-[#a1a1aa]',
    brand: 'text-[#2563eb]',
    success: 'text-[#059669]',
    warning: 'text-[#d97706]',
    danger: 'text-[#dc2626]',
  };
  return (
    <Link
      href={href}
      className="group flex flex-col gap-4 rounded-r5 border border-[#e4e4e7] bg-white p-5 transition-colors hover:border-[#d4d4d8] hover:shadow-sm-soft"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-[#71717a]">{label}</p>
        <Icon className={`h-4 w-4 shrink-0 ${toneRing[tone]}`} strokeWidth={1.6} />
      </div>
      <div>
        <p className="font-display text-3xl font-bold tabular-nums tracking-[-0.02em] text-[#18181b]">{loading ? '—' : value}</p>
        <p className="mt-1 truncate text-xs text-[#52525b]">{caption}</p>
      </div>
      <div className="flex items-center gap-1 text-xs font-medium text-[#71717a] group-hover:text-[#1d4ed8]">
        Open <ArrowUpRight className="h-3.5 w-3.5" />
      </div>
    </Link>
  );
}

function Card({
  title, subtitle, children, rightAction,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  rightAction?: React.ReactNode;
}) {
  return (
    <div className="rounded-r5 border border-[#e4e4e7] bg-white p-5">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[#18181b]">{title}</h3>
          {subtitle ? <p className="mt-0.5 text-xs text-[#71717a]">{subtitle}</p> : null}
        </div>
        {rightAction}
      </header>
      {children}
    </div>
  );
}
