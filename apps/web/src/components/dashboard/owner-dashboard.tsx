'use client';

import { useMemo } from 'react';
import { gql, useQuery } from '@apollo/client';
import Link from 'next/link';
import {
  ArrowUpRight, CalendarClock, CheckCircle2, ClipboardCheck, FileSpreadsheet, IndianRupee,
  PackageSearch, Plus, ShoppingBag, TrendingUp, Truck, Users, AlertTriangle, Boxes,
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, ResponsiveContainer, Tooltip, XAxis, YAxis,
  CartesianGrid, Cell, PieChart, Pie,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { QueryErrorBanner } from '@/components/query-state';
import { UserAvatar } from '@/components/user-avatar';
import {
  Countup, KpiTile, MotionGrid, MotionItem, Panel, EmptyState, GreetingStrip,
  moneyShort, moneyExact, quoteTotal, type Tone,
} from './primitives';

const OWNER = gql`
  query OwnerCommandCenter($salesOwnerId: String!) {
    me { id name email avatarUrl role }
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
    inventoryDashboard { stats summary }
    quotes(status: "pending_approval") {
      id quoteNumber status approvalStatus lines customer owner
    }
    leads {
      id stage expectedValue
    }
    salesOrderStats(range: "month")
    lowStockBalances(take: 8) {
      id available lowStockThreshold reorderPoint isLowStock
      product { id sku name brand }
    }
  }
`;

const STAGE_ORDER = ['new', 'contacted', 'qualified', 'proposal', 'quoted', 'negotiation', 'won'];
const STAGE_LABELS: Record<string, string> = {
  new: 'New', contacted: 'Contacted', qualified: 'Qualified', proposal: 'Proposal',
  quoted: 'Quoted', negotiation: 'Negotiation', won: 'Won',
};

export function OwnerDashboard({ effectiveRole, user }: { effectiveRole: string; user: any }) {
  const { data, loading, error, refetch } = useQuery(OWNER, {
    variables: { salesOwnerId: user?.id || '' },
    skip: !user?.id,
  });

  const stats = data?.ownerDashboard?.stats || {};
  const userPerformance: any[] = data?.ownerDashboard?.userPerformance || [];
  const recentQuotes: any[] = data?.ownerDashboard?.recentQuotes || [];
  const recentLeads: any[] = data?.ownerDashboard?.recentLeads || [];
  const orderStats = data?.salesOrderStats || {};
  const approvalsQueue: any[] = data?.quotes || [];
  const leads: any[] = data?.leads || [];
  const followups: any[] = data?.salesDashboard?.pendingFollowups || [];
  const lowStock: any[] = data?.lowStockBalances || [];

  // ── Derived: pipeline by stage ────────────────────────────────────
  const pipelineByStage = useMemo(() => {
    return STAGE_ORDER.map((stage) => {
      const rows = leads.filter((l) => l.stage === stage);
      return {
        stage,
        label: STAGE_LABELS[stage] || stage,
        count: rows.length,
        value: rows.reduce((sum, l) => sum + Number(l.expectedValue || 0), 0),
      };
    });
  }, [leads]);

  // ── Derived: revenue trend (last 30 days) ─────────────────────────
  const revenueTrend = useMemo(() => {
    const buckets = new Map<string, number>();
    const today = new Date();
    for (let i = 29; i >= 0; i -= 1) {
      const day = new Date(today);
      day.setDate(today.getDate() - i);
      buckets.set(day.toISOString().slice(0, 10), 0);
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

  // ── Derived: top performers ──────────────────────────────────────
  const topPerformers = useMemo(() => {
    return [...userPerformance]
      .filter((u) => u.role !== 'admin')
      .sort((a, b) => Number(b.quoteValue || 0) - Number(a.quoteValue || 0))
      .slice(0, 5);
  }, [userPerformance]);

  // ── Derived: payment mix donut ───────────────────────────────────
  const paymentMix = useMemo(() => {
    const cash = Number(orderStats.cashValue || 0);
    const credit = Number(orderStats.creditValue || 0);
    if (cash === 0 && credit === 0) return [];
    return [
      { name: 'Cash', value: cash, fill: '#059669' },
      { name: 'Credit', value: credit, fill: '#2563eb' },
    ];
  }, [orderStats]);

  const totalLeadsValue = leads.reduce((s, l) => s + Number(l.expectedValue || 0), 0);
  const tiles: Array<{ label: string; value: any; caption: string; icon: any; tone: Tone; href: string; numeric?: boolean; format?: (v: number) => string }> = [
    { label: 'Revenue · this month', value: Number(orderStats.totalValue || 0), caption: `${orderStats.totalOrders || 0} orders · avg ${moneyShort((orderStats.totalValue || 0) / Math.max(orderStats.totalOrders || 1, 1))}`, icon: IndianRupee, tone: 'success', href: '/dashboard/orders', numeric: true, format: moneyShort },
    { label: 'Pipeline value', value: Number(stats.totalQuoteValue || totalLeadsValue || 0), caption: `${stats.totalQuotes || 0} quotes · ${stats.quoteConversionRate || 0}% conversion`, icon: TrendingUp, tone: 'brand', href: '/dashboard/quotes', numeric: true, format: moneyShort },
    { label: 'Approvals waiting', value: approvalsQueue.length, caption: approvalsQueue.length ? 'Quotes need your sign-off' : 'Inbox zero', icon: ClipboardCheck, tone: approvalsQueue.length ? 'warning' : 'neutral', href: '/dashboard/approvals', numeric: true },
    { label: 'Dispatch backlog', value: stats.pendingDispatchJobs || 0, caption: `${stats.activeDispatchJobs || 0} active jobs · ${followups.length} follow-ups today`, icon: Truck, tone: (stats.pendingDispatchJobs || 0) > 5 ? 'warning' : 'neutral', href: '/dashboard/dispatch', numeric: true },
  ];

  const secondary: Array<{ label: string; value: any; caption: string; icon: any; tone: Tone; href: string; numeric?: boolean }> = [
    { label: 'Active leads', value: leads.length, caption: `${pipelineByStage.find((s) => s.stage === 'new')?.count || 0} new this period`, icon: PackageSearch, tone: 'brand', href: '/dashboard/leads', numeric: true },
    { label: 'Won this month', value: orderStats.totalOrders || 0, caption: `${moneyShort(orderStats.cashValue || 0)} cash · ${moneyShort(orderStats.creditValue || 0)} credit`, icon: CheckCircle2, tone: 'success', href: '/dashboard/orders', numeric: true },
    { label: 'Customers', value: stats.totalCustomers || 0, caption: `${stats.totalUsers || 0} team members`, icon: Users, tone: 'violet', href: '/dashboard/customers', numeric: true },
    { label: 'Low-stock SKUs', value: lowStock.length, caption: lowStock.length ? 'Need re-ordering' : 'Inventory healthy', icon: AlertTriangle, tone: lowStock.length ? 'danger' : 'neutral', href: '/dashboard/inventory', numeric: true },
  ];

  return (
    <div className="space-y-6">
      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}

      <GreetingStrip
        role={effectiveRole}
        user={user}
        name={user?.name}
        subtitle="Here's where the store stands today. Click any tile to drill in."
        actions={
          <>
            <Button asChild size="sm"><Link href="/dashboard/quotes/new"><Plus className="mr-1.5 h-4 w-4" /> New quote</Link></Button>
            <Button asChild variant="outline" size="sm"><Link href="/dashboard/leads/new">New lead</Link></Button>
            <Button asChild variant="outline" size="sm"><Link href="/dashboard/approvals">Approvals · {approvalsQueue.length}</Link></Button>
          </>
        }
      />

      <MotionGrid className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {tiles.map((tile) => (
          <MotionItem key={tile.label}>
            <KpiTile {...tile} loading={loading} />
          </MotionItem>
        ))}
      </MotionGrid>

      <section className="grid gap-3 xl:grid-cols-[1.5fr_1fr]">
        <Panel title="Quote value · last 30 days" subtitle="Daily sum of new quote line totals" tone="brand">
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenueTrend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="mp-rev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563eb" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="#2563eb" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(113,113,122,0.10)" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} axisLine={false} interval={4} />
                <YAxis tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => moneyShort(Number(v))} />
                <Tooltip formatter={(v: any) => moneyExact(Number(v))} labelStyle={{ color: '#52525b' }} />
                <Area type="monotone" dataKey="value" stroke="#2563eb" strokeWidth={2} fill="url(#mp-rev)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Pipeline by stage" subtitle="Open leads grouped by sales stage" tone="violet">
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={pipelineByStage} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="rgba(113,113,122,0.10)" horizontal={false} />
                <XAxis type="number" tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="label" tick={{ fill: '#52525b', fontSize: 11 }} tickLine={false} axisLine={false} width={84} />
                <Tooltip formatter={(v: any, _name: any, p: any) => [`${v} leads · ${moneyExact(p?.payload?.value || 0)}`, '']} cursor={{ fill: 'rgba(37,99,235,0.04)' }} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]} animationDuration={900}>
                  {pipelineByStage.map((entry, index) => (
                    <Cell key={index} fill={entry.stage === 'won' ? '#059669' : entry.count > 0 ? '#2563eb' : '#e4e4e7'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </section>

      <MotionGrid className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {secondary.map((tile) => (
          <MotionItem key={tile.label}>
            <KpiTile {...tile} loading={loading} />
          </MotionItem>
        ))}
      </MotionGrid>

      <section className="grid gap-3 xl:grid-cols-[1.4fr_0.9fr_0.9fr]">
        <Panel title="Top performers" subtitle="By confirmed quote value · all time" tone="success" rightAction={<Link href="/dashboard/users" className="text-xs font-medium text-[#1d4ed8] hover:underline">View team</Link>}>
          <div className="overflow-hidden rounded-r3 border border-[#f4f4f5]">
            <table className="w-full text-sm">
              <thead className="bg-[#fafafa] text-left text-[11px] font-semibold uppercase tracking-wider text-[#71717a]">
                <tr>
                  <th className="px-3 py-2.5">Salesperson</th>
                  <th className="px-3 py-2.5 text-right">Leads</th>
                  <th className="px-3 py-2.5 text-right">Quotes</th>
                  <th className="px-3 py-2.5 text-right">Won</th>
                  <th className="px-3 py-2.5 text-right">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f4f4f5]">
                {(loading && !topPerformers.length ? Array.from({ length: 4 }) : topPerformers).map((u: any, idx: number) => u ? (
                  <tr key={u.id} className="text-[#27272a]">
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <UserAvatar user={u} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-[#18181b]">{u.name}</p>
                          <p className="text-[11px] capitalize text-[#71717a]">{String(u.role).replace('_', ' ')}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{u.leads}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{u.quotes}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[#047857]">{u.confirmedQuotes}</td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{moneyShort(u.quoteValue)}</td>
                  </tr>
                ) : (
                  <tr key={idx}><td colSpan={5} className="px-3 py-3"><div className="h-4 w-full animate-pulse rounded bg-[#f4f4f5]" /></td></tr>
                ))}
                {!loading && !topPerformers.length ? (
                  <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-[#71717a]">No sales activity yet.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Payment mix" subtitle="This month's order value by mode" tone="brand">
          {paymentMix.length ? (
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={paymentMix} dataKey="value" innerRadius={50} outerRadius={80} paddingAngle={3} stroke="white" strokeWidth={3} animationDuration={900}>
                    {paymentMix.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                  </Pie>
                  <Tooltip formatter={(v: any) => moneyExact(Number(v))} />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-2 flex items-center justify-center gap-3 text-xs">
                {paymentMix.map((p) => (
                  <span key={p.name} className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ background: p.fill }} />
                    {p.name} · <span className="font-semibold text-[#18181b]">{moneyShort(p.value)}</span>
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <EmptyState>No orders booked yet this month.</EmptyState>
          )}
        </Panel>

        <Panel title="Low-stock alerts" subtitle={`${lowStock.length} SKU${lowStock.length === 1 ? '' : 's'} below threshold`} tone="danger" rightAction={<Link href="/dashboard/inventory" className="text-xs font-medium text-[#1d4ed8] hover:underline">Inventory</Link>}>
          {lowStock.length ? (
            <ul className="space-y-1.5">
              {lowStock.slice(0, 6).map((row: any) => (
                <li key={row.id} className="flex items-center justify-between rounded-r3 border border-[#f4f4f5] bg-white px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[#18181b]">{row.product?.name}</p>
                    <p className="truncate text-[11px] text-[#71717a]"><span className="mp-mono">{row.product?.sku}</span></p>
                  </div>
                  <span className="ml-3 inline-flex shrink-0 items-center gap-1 rounded-full bg-[#fecaca] px-2 py-0.5 text-[11px] font-semibold text-[#b91c1c]">
                    <Boxes className="h-3 w-3" />{row.available}
                  </span>
                </li>
              ))}
            </ul>
          ) : <EmptyState>All inventory above threshold.</EmptyState>}
        </Panel>
      </section>

      <section className="grid gap-3 xl:grid-cols-[1.2fr_0.8fr]">
        <Panel title="Approval queue" subtitle="Quotes awaiting owner sign-off" tone="warning" rightAction={<Link href="/dashboard/approvals" className="text-xs font-medium text-[#1d4ed8] hover:underline">Open desk</Link>}>
          {approvalsQueue.length ? (
            <ul className="divide-y divide-[#f4f4f5]">
              {approvalsQueue.slice(0, 6).map((quote: any) => {
                const total = quoteTotal(quote.lines);
                return (
                  <li key={quote.id} className="flex items-center justify-between py-2.5">
                    <div className="flex min-w-0 items-center gap-3">
                      <UserAvatar user={quote.owner} size="sm" />
                      <div className="min-w-0">
                        <Link href={`/dashboard/quotes/${quote.id}`} className="text-sm font-semibold text-[#18181b] hover:underline">{quote.quoteNumber}</Link>
                        <p className="truncate text-[11px] text-[#71717a]">{quote.customer?.name || 'Customer'} · {quote.owner?.name || 'Sales'}</p>
                      </div>
                    </div>
                    <div className="ml-3 flex shrink-0 items-center gap-2">
                      <span className="text-sm font-semibold tabular-nums text-[#18181b]">{moneyShort(total)}</span>
                      <span className="rounded-full bg-[#fde68a] px-2 py-0.5 text-[10px] font-semibold uppercase text-[#b45309]">Pending</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : <EmptyState>No approvals pending. Inbox zero.</EmptyState>}
        </Panel>

        <Panel title="Recent activity" subtitle="Latest quotes & leads" tone="sky">
          <ul className="space-y-1">
            {recentQuotes.slice(0, 5).map((q: any) => (
              <li key={`q-${q.id}`} className="flex items-center justify-between gap-3 rounded-r3 px-2 py-1.5 hover:bg-[#fafafa]">
                <Link href={`/dashboard/quotes/${q.id}`} className="flex min-w-0 items-center gap-2">
                  <FileSpreadsheet className="h-3.5 w-3.5 shrink-0 text-[#2563eb]" />
                  <span className="truncate text-sm font-medium text-[#18181b]">{q.quoteNumber}</span>
                  <span className="truncate text-[11px] text-[#71717a]">· {q.customer?.name || '—'}</span>
                </Link>
                <span className="shrink-0 text-xs tabular-nums text-[#52525b]">{moneyShort(quoteTotal(q.lines))}</span>
              </li>
            ))}
            {recentLeads.slice(0, 5).map((l: any) => (
              <li key={`l-${l.id}`} className="flex items-center justify-between gap-3 rounded-r3 px-2 py-1.5 hover:bg-[#fafafa]">
                <Link href={`/dashboard/leads/${l.id}`} className="flex min-w-0 items-center gap-2">
                  <PackageSearch className="h-3.5 w-3.5 shrink-0 text-[#71717a]" />
                  <span className="truncate text-sm font-medium text-[#18181b]">{l.title}</span>
                  <span className="truncate text-[11px] capitalize text-[#71717a]">· {l.stage}</span>
                </Link>
                <span className="shrink-0 text-xs tabular-nums text-[#52525b]">{moneyShort(l.expectedValue)}</span>
              </li>
            ))}
            {!recentQuotes.length && !recentLeads.length ? <EmptyState>No recent activity.</EmptyState> : null}
          </ul>
        </Panel>
      </section>
    </div>
  );
}
