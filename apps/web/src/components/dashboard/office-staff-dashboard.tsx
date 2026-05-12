'use client';

import { useMemo } from 'react';
import { gql, useQuery } from '@apollo/client';
import Link from 'next/link';
import {
  AreaChart, Area, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import {
  ClipboardCheck, FileSpreadsheet, IndianRupee, ListChecks, Plus, Receipt,
  ShoppingBag, ArrowRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryErrorBanner } from '@/components/query-state';
import { UserAvatar } from '@/components/user-avatar';
import {
  KpiTile, MotionGrid, MotionItem, Panel, EmptyState, GreetingStrip,
  moneyShort, moneyExact, quoteTotal, type Tone,
} from './primitives';

const OFFICE_DASH = gql`
  query OfficeStaffDash {
    leadIntents(status: "pending_quote")
    pendingApprovalQuotes: quotes(status: "pending_approval") {
      id quoteNumber lines customer owner createdAt
    }
    approvedQuotes: quotes(status: "approved") {
      id quoteNumber lines customer owner createdAt
    }
    salesOrderStats(range: "month")
    ownerDashboard { recentQuotes }
  }
`;

export function OfficeStaffDashboard({ effectiveRole, user }: { effectiveRole: string; user: any }) {
  const { data, loading, error, refetch } = useQuery(OFFICE_DASH);

  const intentsPending: any[] = data?.leadIntents || [];
  const approvedQuotes: any[] = data?.approvedQuotes || [];
  const orderStats = data?.salesOrderStats || {};
  const recentQuotes: any[] = data?.ownerDashboard?.recentQuotes || [];

  const quotesTrend = useMemo(() => {
    const buckets = new Map<string, number>();
    const today = new Date();
    for (let i = 13; i >= 0; i -= 1) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      buckets.set(d.toISOString().slice(0, 10), 0);
    }
    for (const q of recentQuotes) {
      const k = String(q.createdAt || '').slice(0, 10);
      if (!buckets.has(k)) continue;
      buckets.set(k, (buckets.get(k) || 0) + 1);
    }
    return Array.from(buckets.entries()).map(([day, count]) => ({
      day, count,
      label: new Date(day).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }),
    }));
  }, [recentQuotes]);

  const tiles: Array<{ label: string; value: any; caption: string; icon: any; tone: Tone; href: string; numeric?: boolean; format?: (v: number) => string }> = [
    { label: 'Intents to quote', value: intentsPending.length, caption: intentsPending.length ? 'Sales captured, awaiting your quote' : 'Inbox zero', icon: ListChecks, tone: intentsPending.length ? 'brand' : 'success', href: '/dashboard/intents', numeric: true },
    { label: 'Quotes ready', value: approvedQuotes.length, caption: 'Confirmed quotes ready to convert to orders', icon: ClipboardCheck, tone: approvedQuotes.length ? 'success' : 'neutral', href: '/dashboard/quotes', numeric: true },
    { label: 'Orders booked · MTD', value: orderStats.totalOrders || 0, caption: `${moneyShort(orderStats.totalValue || 0)} this month`, icon: ShoppingBag, tone: 'success', href: '/dashboard/orders', numeric: true },
    { label: 'Cash advance · MTD', value: Number(orderStats.cashAdvance || 0), caption: 'Collected on cash orders', icon: IndianRupee, tone: 'violet', href: '/dashboard/orders', numeric: true, format: moneyShort },
  ];

  return (
    <div className="space-y-6">
      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}

      <GreetingStrip
        role={effectiveRole}
        user={user}
        name={user?.name}
        subtitle="Intents to convert, quotes to push through, orders to confirm."
        actions={
          <>
            <Button asChild size="sm"><Link href="/dashboard/intents"><ListChecks className="mr-1.5 h-4 w-4" /> Intent desk</Link></Button>
            <Button asChild variant="outline" size="sm"><Link href="/dashboard/quotes/new"><Plus className="mr-1.5 h-4 w-4" /> New quote</Link></Button>
            <Button asChild variant="outline" size="sm"><Link href="/dashboard/orders">Sales orders</Link></Button>
          </>
        }
      />

      <MotionGrid className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {tiles.map((tile) => <MotionItem key={tile.label}><KpiTile {...tile} loading={loading} /></MotionItem>)}
      </MotionGrid>

      <Panel title="Quotes generated · last 14 days" subtitle="Pace of quote generation" tone="brand">
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={quotesTrend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="office-q" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2563eb" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="#2563eb" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(113,113,122,0.10)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} axisLine={false} width={28} allowDecimals={false} />
              <Tooltip />
              <Area type="monotone" dataKey="count" stroke="#2563eb" strokeWidth={2} fill="url(#office-q)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <section className="grid gap-3 xl:grid-cols-2">
        <Panel title="Quotes ready to convert" subtitle="Approved quotes — turn into sales orders" tone="success" rightAction={<Link href="/dashboard/quotes" className="text-xs font-medium text-[#1d4ed8] hover:underline">Quote register</Link>}>
          {approvedQuotes.length ? (
            <ul className="divide-y divide-[#f4f4f5]">
              {approvedQuotes.slice(0, 6).map((q: any) => (
                <li key={q.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <UserAvatar user={q.owner} size="sm" />
                    <div className="min-w-0">
                      <Link href={`/dashboard/quotes/${q.id}`} className="block truncate text-sm font-semibold text-[#18181b] hover:underline">{q.quoteNumber}</Link>
                      <p className="truncate text-[11px] text-[#71717a]">{q.customer?.name || 'Customer'} · {q.owner?.name || 'Sales'}</p>
                    </div>
                  </div>
                  <div className="ml-2 flex shrink-0 items-center gap-2">
                    <span className="text-sm font-semibold tabular-nums text-[#18181b]">{moneyShort(quoteTotal(q.lines))}</span>
                    <Link href={`/dashboard/quotes/${q.id}`} className="inline-flex items-center gap-1 rounded-md bg-[#eff6ff] px-2 py-1 text-[11px] font-medium text-[#1d4ed8]">
                      Convert <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          ) : <EmptyState>Approved quote inbox is empty.</EmptyState>}
        </Panel>

        <Panel title="Approval log" subtitle="Recent owner approvals & rejections" tone="violet" rightAction={<Link href="/dashboard/approvals" className="text-xs font-medium text-[#1d4ed8] hover:underline">Approval desk</Link>}>
          {recentQuotes.length ? (
            <ul className="space-y-1">
              {recentQuotes.slice(0, 6).map((q: any) => (
                <li key={q.id} className="flex items-center justify-between gap-3 rounded-r3 px-2 py-1.5 hover:bg-[#fafafa]">
                  <Link href={`/dashboard/quotes/${q.id}`} className="flex min-w-0 items-center gap-2">
                    <FileSpreadsheet className="h-3.5 w-3.5 shrink-0 text-[#2563eb]" />
                    <span className="truncate text-sm font-medium text-[#18181b]">{q.quoteNumber}</span>
                    <span className="truncate text-[11px] text-[#71717a]">· {q.customer?.name || '—'}</span>
                  </Link>
                  <span className="shrink-0 text-xs tabular-nums text-[#52525b]">{moneyShort(quoteTotal(q.lines))}</span>
                </li>
              ))}
            </ul>
          ) : <EmptyState>No recent quote activity.</EmptyState>}
        </Panel>
      </section>
    </div>
  );
}
