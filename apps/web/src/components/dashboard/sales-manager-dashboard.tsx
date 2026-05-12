'use client';

import { useMemo } from 'react';
import { gql, useQuery } from '@apollo/client';
import Link from 'next/link';
import {
  AreaChart, Area, BarChart, Bar, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, Cell,
} from 'recharts';
import {
  Briefcase, CalendarClock, CheckCircle2, FileSpreadsheet, IndianRupee, Plus, Target, TrendingUp,
  Trophy, Users, Hourglass, AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryErrorBanner } from '@/components/query-state';
import { UserAvatar } from '@/components/user-avatar';
import {
  KpiTile, MotionGrid, MotionItem, Panel, EmptyState, GreetingStrip,
  moneyShort, moneyExact, quoteTotal, type Tone,
} from './primitives';

const SM_DASH = gql`
  query SalesManagerDash {
    ownerDashboard { stats userPerformance recentQuotes }
    quotes { id quoteNumber status approvalStatus lines customer owner createdAt }
    leads { id title stage expectedValue nextActionAt owner customer }
    salesOrderStats(range: "month")
  }
`;

const STAGE_WEIGHTS: Record<string, number> = {
  new: 0.05, contacted: 0.10, qualified: 0.25, proposal: 0.40, quoted: 0.55, negotiation: 0.75, won: 1,
};

export function SalesManagerDashboard({ effectiveRole, user }: { effectiveRole: string; user: any }) {
  const { data, loading, error, refetch } = useQuery(SM_DASH);

  const stats = data?.ownerDashboard?.stats || {};
  const team: any[] = data?.ownerDashboard?.userPerformance || [];
  const quotes: any[] = data?.quotes || [];
  const leads: any[] = data?.leads || [];
  const orderStats = data?.salesOrderStats || {};

  // ── Weighted forecast: each open lead's expected value × stage weight.
  const weightedForecast = useMemo(() => {
    let total = 0;
    for (const l of leads) {
      const w = STAGE_WEIGHTS[l.stage] ?? 0.1;
      total += Number(l.expectedValue || 0) * w;
    }
    return total;
  }, [leads]);

  // ── Quotes sent vs confirmed last 30 days
  const conversionTrend = useMemo(() => {
    const buckets = new Map<string, { day: string; sent: number; confirmed: number }>();
    const today = new Date();
    for (let i = 29; i >= 0; i -= 1) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      buckets.set(key, { day: key, sent: 0, confirmed: 0 });
    }
    for (const q of quotes) {
      const k = String(q.createdAt || '').slice(0, 10);
      const b = buckets.get(k);
      if (!b) continue;
      if (q.status === 'sent' || q.status === 'confirmed') b.sent += 1;
      if (q.status === 'confirmed') b.confirmed += 1;
    }
    return Array.from(buckets.values()).map((b) => ({
      ...b,
      label: new Date(b.day).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }),
    }));
  }, [quotes]);

  // ── Stale leads (no activity > 7 days, still open)
  const staleLeads = useMemo(() => {
    const cutoff = Date.now() - 7 * 86400000;
    return leads
      .filter((l) => !['won', 'lost'].includes(String(l.stage)))
      .filter((l) => !l.nextActionAt || new Date(l.nextActionAt).getTime() < cutoff)
      .slice(0, 6);
  }, [leads]);

  // ── Pipeline by salesperson (top 6)
  const pipelineByRep = useMemo(() => {
    return [...team]
      .filter((u) => ['sales', 'sales_manager', 'owner', 'office_staff'].includes(u.role))
      .sort((a, b) => Number(b.pipelineValue || 0) - Number(a.pipelineValue || 0))
      .slice(0, 6);
  }, [team]);

  const tiles: Array<{ label: string; value: any; caption: string; icon: any; tone: Tone; href: string; numeric?: boolean; format?: (v: number) => string }> = [
    { label: 'Team revenue · MTD', value: Number(orderStats.totalValue || 0), caption: `${orderStats.totalOrders || 0} orders this month`, icon: IndianRupee, tone: 'success', href: '/dashboard/orders', numeric: true, format: moneyShort },
    { label: 'Weighted forecast', value: weightedForecast, caption: `Based on ${leads.length} open leads × stage weight`, icon: Target, tone: 'brand', href: '/dashboard/leads', numeric: true, format: moneyShort },
    { label: 'Conversion rate', value: Number(stats.quoteConversionRate || 0), caption: `${stats.confirmedQuotes || 0} confirmed of ${stats.totalQuotes || 0} quotes`, icon: TrendingUp, tone: 'violet', href: '/dashboard/quotes', numeric: true, format: (v) => `${Math.round(v)}%` },
    { label: 'Stale leads', value: staleLeads.length, caption: staleLeads.length ? '> 7 days without action' : 'Pipeline is fresh', icon: AlertCircle, tone: staleLeads.length ? 'warning' : 'neutral', href: '/dashboard/leads', numeric: true },
  ];

  const teamLeaderboard = useMemo(() => {
    return [...team]
      .filter((u) => u.role === 'sales' || u.role === 'sales_manager')
      .sort((a, b) => Number(b.quoteValue || 0) - Number(a.quoteValue || 0))
      .slice(0, 5);
  }, [team]);

  return (
    <div className="space-y-6">
      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}

      <GreetingStrip
        role={effectiveRole}
        user={user}
        name={user?.name}
        subtitle="Sales team performance, pipeline health and what needs attention this week."
        actions={
          <>
            <Button asChild size="sm"><Link href="/dashboard/leads/new"><Plus className="mr-1.5 h-4 w-4" /> New lead</Link></Button>
            <Button asChild variant="outline" size="sm"><Link href="/dashboard/quotes/new">New quote</Link></Button>
            <Button asChild variant="outline" size="sm"><Link href="/dashboard/sales">Sales desk</Link></Button>
          </>
        }
      />

      <MotionGrid className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {tiles.map((tile) => <MotionItem key={tile.label}><KpiTile {...tile} loading={loading} /></MotionItem>)}
      </MotionGrid>

      <section className="grid gap-3 xl:grid-cols-[1.5fr_1fr]">
        <Panel title="Quotes sent vs confirmed · last 30 days" subtitle="Sent quotes (light) and the ones that became orders (solid)" tone="brand">
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={conversionTrend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="rgba(113,113,122,0.10)" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} axisLine={false} interval={4} />
                <YAxis tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
                <Tooltip cursor={{ fill: 'rgba(37,99,235,0.04)' }} />
                <Bar dataKey="sent" stackId="a" fill="#bfdbfe" radius={[4, 4, 0, 0]} />
                <Bar dataKey="confirmed" stackId="a" fill="#2563eb" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Pipeline by salesperson" subtitle="Open lead value owned" tone="success">
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={pipelineByRep} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="rgba(113,113,122,0.10)" horizontal={false} />
                <XAxis type="number" tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => moneyShort(Number(v))} />
                <YAxis type="category" dataKey="name" tick={{ fill: '#52525b', fontSize: 11 }} tickLine={false} axisLine={false} width={96} />
                <Tooltip formatter={(v: any) => moneyExact(Number(v))} cursor={{ fill: 'rgba(5,150,105,0.04)' }} />
                <Bar dataKey="pipelineValue" radius={[0, 4, 4, 0]} fill="#059669" animationDuration={900} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </section>

      <section className="grid gap-3 xl:grid-cols-[1.3fr_0.9fr]">
        <Panel title="Team leaderboard" subtitle="Confirmed quote value" tone="success" rightAction={<Link href="/dashboard/users" className="text-xs font-medium text-[#1d4ed8] hover:underline">View team</Link>}>
          <div className="overflow-hidden rounded-r3 border border-[#f4f4f5]">
            <table className="w-full text-sm">
              <thead className="bg-[#fafafa] text-left text-[11px] font-semibold uppercase tracking-wider text-[#71717a]">
                <tr>
                  <th className="px-3 py-2.5">Rep</th>
                  <th className="px-3 py-2.5 text-right">Leads</th>
                  <th className="px-3 py-2.5 text-right">Quotes</th>
                  <th className="px-3 py-2.5 text-right">Won</th>
                  <th className="px-3 py-2.5 text-right">Pipeline</th>
                  <th className="px-3 py-2.5 text-right">Won ₹</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f4f4f5]">
                {teamLeaderboard.map((u: any, idx: number) => (
                  <tr key={u.id} className="text-[#27272a]">
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <span className="relative">
                          <UserAvatar user={u} size="sm" />
                          {idx === 0 ? (
                            <Trophy className="absolute -bottom-1 -right-1 h-3 w-3 rounded-full bg-white p-px text-[#b45309]" />
                          ) : null}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-[#18181b]">{u.name}</p>
                          <p className="text-[11px] capitalize text-[#71717a]">{String(u.role).replace('_', ' ')}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{u.leads}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{u.quotes}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[#047857]">{u.confirmedQuotes}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{moneyShort(u.pipelineValue)}</td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-[#18181b]">{moneyShort(u.quoteValue)}</td>
                  </tr>
                ))}
                {!loading && !teamLeaderboard.length ? <tr><td colSpan={6} className="px-3 py-6 text-center text-sm text-[#71717a]">No team activity yet.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="At-risk leads" subtitle="No activity in > 7 days, still open" tone="warning" rightAction={<Link href="/dashboard/leads" className="text-xs font-medium text-[#1d4ed8] hover:underline">Pipeline</Link>}>
          {staleLeads.length ? (
            <ul className="space-y-1.5">
              {staleLeads.map((l: any) => (
                <li key={l.id} className="flex items-center justify-between rounded-r3 border border-[#fde68a] bg-[#fffbf2] px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <UserAvatar user={l.owner} size="xs" />
                    <div className="min-w-0">
                      <Link href={`/dashboard/leads/${l.id}`} className="block truncate text-sm font-semibold text-[#18181b] hover:underline">{l.title}</Link>
                      <p className="truncate text-[11px] text-[#71717a]">{l.customer?.name || 'Customer'} · {l.owner?.name || 'Unassigned'}</p>
                    </div>
                  </div>
                  <span className="ml-2 inline-flex shrink-0 items-center gap-1 rounded-full bg-[#fde68a] px-2 py-0.5 text-[10px] font-semibold uppercase text-[#b45309]">
                    <Hourglass className="h-2.5 w-2.5" /> stale
                  </span>
                </li>
              ))}
            </ul>
          ) : <EmptyState>Every lead has a next action set.</EmptyState>}
        </Panel>
      </section>
    </div>
  );
}
