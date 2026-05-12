'use client';

import { useMemo } from 'react';
import { gql, useQuery } from '@apollo/client';
import Link from 'next/link';
import {
  AreaChart, Area, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid,
  RadialBarChart, RadialBar, PolarAngleAxis,
} from 'recharts';
import {
  ArrowRight, CalendarClock, CheckCircle2, FileSpreadsheet, IndianRupee, Phone, Plus,
  Target, TrendingUp, Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryErrorBanner } from '@/components/query-state';
import { UserAvatar } from '@/components/user-avatar';
import {
  KpiTile, MotionGrid, MotionItem, Panel, EmptyState, GreetingStrip,
  moneyShort, moneyExact, quoteTotal, type Tone,
} from './primitives';

const SALES_DASH = gql`
  query SalesRepDash($ownerId: String!) {
    salesDashboard(ownerId: $ownerId) { stats pendingFollowups recentQuotes }
    leads(ownerId: $ownerId) { id title stage expectedValue nextActionAt customer }
    quotes(ownerId: $ownerId) { id quoteNumber status approvalStatus lines customer createdAt }
  }
`;

const STAGE_LABEL: Record<string, string> = {
  new: 'New', contacted: 'Contacted', qualified: 'Qualified', proposal: 'Proposal',
  quoted: 'Quoted', negotiation: 'Negotiation', won: 'Won', lost: 'Lost',
};

export function SalesRepDashboard({ effectiveRole, user }: { effectiveRole: string; user: any }) {
  const { data, loading, error, refetch } = useQuery(SALES_DASH, {
    variables: { ownerId: user?.id || '' },
    skip: !user?.id,
  });

  const stats = data?.salesDashboard?.stats || {};
  const followups: any[] = data?.salesDashboard?.pendingFollowups || [];
  const leads: any[] = data?.leads || [];
  const myQuotes: any[] = data?.quotes || [];

  const pipelineValue = useMemo(() => leads.reduce((s, l) => s + Number(l.expectedValue || 0), 0), [leads]);
  const wonQuotes = useMemo(() => myQuotes.filter((q) => q.status === 'confirmed'), [myQuotes]);
  const wonRevenue = useMemo(() => wonQuotes.reduce((s, q) => s + quoteTotal(q.lines), 0), [wonQuotes]);
  const quotesSent = useMemo(() => myQuotes.filter((q) => q.status === 'sent' || q.status === 'confirmed').length, [myQuotes]);
  const conversion = quotesSent ? (wonQuotes.length / quotesSent) * 100 : 0;

  // ── My pipeline trend (last 14 days)
  const trend = useMemo(() => {
    const buckets = new Map<string, number>();
    const today = new Date();
    for (let i = 13; i >= 0; i -= 1) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      buckets.set(d.toISOString().slice(0, 10), 0);
    }
    for (const q of myQuotes) {
      const k = String(q.createdAt || '').slice(0, 10);
      if (!buckets.has(k)) continue;
      buckets.set(k, (buckets.get(k) || 0) + quoteTotal(q.lines));
    }
    return Array.from(buckets.entries()).map(([day, value]) => ({
      day,
      label: new Date(day).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }),
      value,
    }));
  }, [myQuotes]);

  // ── Today / overdue follow-ups
  const todayFollowups = useMemo(() => {
    const now = Date.now();
    const eod = new Date(); eod.setHours(23, 59, 59, 999);
    return followups
      .filter((f: any) => !f.dueAt || new Date(f.dueAt).getTime() <= eod.getTime())
      .sort((a: any, b: any) => new Date(a.dueAt || 0).getTime() - new Date(b.dueAt || 0).getTime());
  }, [followups]);

  // ── My pipeline by stage
  const stageCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const l of leads) c[l.stage] = (c[l.stage] || 0) + 1;
    return Object.entries(c).map(([stage, count]) => ({ stage: STAGE_LABEL[stage] || stage, count }));
  }, [leads]);

  // ── Monthly target gauge (assume 1 Lakh target if not set elsewhere)
  const TARGET = 100000;
  const targetPct = Math.min(100, (wonRevenue / TARGET) * 100);

  const tiles: Array<{ label: string; value: any; caption: string; icon: any; tone: Tone; href: string; numeric?: boolean; format?: (v: number) => string }> = [
    { label: 'My pipeline value', value: pipelineValue, caption: `${leads.length} open leads`, icon: TrendingUp, tone: 'brand', href: '/dashboard/leads', numeric: true, format: moneyShort },
    { label: 'Quotes pending response', value: myQuotes.filter((q) => q.status === 'sent').length, caption: `${quotesSent} sent total`, icon: FileSpreadsheet, tone: 'sky', href: '/dashboard/quotes', numeric: true },
    { label: 'Follow-ups today', value: todayFollowups.length, caption: todayFollowups.length ? 'Action required' : 'All caught up', icon: CalendarClock, tone: todayFollowups.length ? 'warning' : 'success', href: '/dashboard/sales', numeric: true },
    { label: 'Won this month', value: wonRevenue, caption: `${wonQuotes.length} confirmed quotes`, icon: IndianRupee, tone: 'success', href: '/dashboard/orders', numeric: true, format: moneyShort },
  ];

  return (
    <div className="space-y-6">
      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}

      <GreetingStrip
        role={effectiveRole}
        user={user}
        name={user?.name}
        subtitle="Your leads, your follow-ups, your wins."
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
        <Panel title="My quote value · last 14 days" subtitle="Sum of new quote line totals you authored" tone="brand">
          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="rep-rev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563eb" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="#2563eb" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(113,113,122,0.10)" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => moneyShort(Number(v))} />
                <Tooltip formatter={(v: any) => moneyExact(Number(v))} />
                <Area type="monotone" dataKey="value" stroke="#2563eb" strokeWidth={2} fill="url(#rep-rev)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Monthly target" subtitle={`${moneyShort(wonRevenue)} of ${moneyShort(TARGET)}`} tone="success">
          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <RadialBarChart innerRadius="70%" outerRadius="100%" startAngle={210} endAngle={-30} data={[{ name: 'won', value: targetPct, fill: '#059669' }]}>
                <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                <RadialBar dataKey="value" cornerRadius={20} background={{ fill: '#f4f4f5' } as any} angleAxisId={0} animationDuration={900} />
              </RadialBarChart>
            </ResponsiveContainer>
            <div className="-mt-32 flex flex-col items-center text-center">
              <div className="font-display text-3xl font-bold tabular-nums text-[#18181b]">{Math.round(targetPct)}%</div>
              <p className="mt-1 text-xs text-[#71717a]">to target</p>
              <p className="mt-1 text-[11px] text-[#52525b]">{conversion.toFixed(1)}% conversion</p>
            </div>
          </div>
        </Panel>
      </section>

      <section className="grid gap-3 xl:grid-cols-[1.2fr_0.9fr]">
        <Panel title="Follow-ups for today" subtitle="Sorted by due time" tone="warning" rightAction={<Link href="/dashboard/sales" className="text-xs font-medium text-[#1d4ed8] hover:underline">Sales desk</Link>}>
          {todayFollowups.length ? (
            <ul className="space-y-1.5">
              {todayFollowups.slice(0, 7).map((f: any) => (
                <li key={f.id} className="flex items-center justify-between gap-3 rounded-r3 border border-[#f4f4f5] bg-white px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[#18181b]">{f.notes || 'Follow-up'}</p>
                    <p className="truncate text-[11px] text-[#71717a]">{f.dueAt ? new Date(f.dueAt).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }) : 'no due time'}</p>
                  </div>
                  <Link href={f.leadId ? `/dashboard/leads/${f.leadId}` : '/dashboard/sales'} className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[#eff6ff] px-2 py-1 text-[11px] font-medium text-[#1d4ed8]">
                    Open <ArrowRight className="h-3 w-3" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : <EmptyState>No follow-ups due today. Nice.</EmptyState>}
        </Panel>

        <Panel title="My pipeline stages" subtitle={`${leads.length} open leads`} tone="violet" rightAction={<Link href="/dashboard/leads" className="text-xs font-medium text-[#1d4ed8] hover:underline">Pipeline</Link>}>
          {stageCounts.length ? (
            <ul className="space-y-1.5">
              {stageCounts.map((s) => (
                <li key={s.stage} className="flex items-center justify-between rounded-r3 px-3 py-1.5 hover:bg-[#fafafa]">
                  <span className="text-sm text-[#27272a]">{s.stage}</span>
                  <span className="rounded-full bg-[#e9d5ff] px-2 py-0.5 text-[11px] font-semibold text-[#6d28d9]">{s.count}</span>
                </li>
              ))}
            </ul>
          ) : <EmptyState>No leads yet — create one.</EmptyState>}
        </Panel>
      </section>

      <Panel title="My recent quotes" subtitle="Last 6 quotes you authored" tone="sky" rightAction={<Link href="/dashboard/quotes" className="text-xs font-medium text-[#1d4ed8] hover:underline">All quotes</Link>}>
        {myQuotes.length ? (
          <div className="overflow-hidden rounded-r3 border border-[#f4f4f5]">
            <table className="w-full text-sm">
              <thead className="bg-[#fafafa] text-left text-[11px] font-semibold uppercase tracking-wider text-[#71717a]">
                <tr>
                  <th className="px-3 py-2.5">Quote</th>
                  <th className="px-3 py-2.5">Customer</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5 text-right">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f4f4f5]">
                {myQuotes.slice(0, 6).map((q: any) => (
                  <tr key={q.id} className="text-[#27272a]">
                    <td className="px-3 py-2.5"><Link href={`/dashboard/quotes/${q.id}`} className="font-semibold text-[#18181b] hover:underline">{q.quoteNumber}</Link></td>
                    <td className="px-3 py-2.5 text-[#52525b]">{q.customer?.name || '—'}</td>
                    <td className="px-3 py-2.5"><span className="rounded-full bg-[#eff6ff] px-2 py-0.5 text-[10px] font-semibold uppercase text-[#1d4ed8]">{q.status}</span></td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-[#18181b]">{moneyShort(quoteTotal(q.lines))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState>No quotes yet — start one.</EmptyState>}
      </Panel>
    </div>
  );
}
