'use client';

import { useMemo } from 'react';
import { gql, useQuery } from '@apollo/client';
import Link from 'next/link';
import {
  BarChart, Bar, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, Cell,
} from 'recharts';
import {
  CheckCircle2, Clock, FileText, MapPin, Package, Truck, Calendar, AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryErrorBanner } from '@/components/query-state';
import { UserAvatar } from '@/components/user-avatar';
import {
  KpiTile, MotionGrid, MotionItem, Panel, EmptyState, GreetingStrip, type Tone,
} from './primitives';

const DISP_DASH = gql`
  query DispatchOpsDash {
    dispatchJobs {
      id quoteId siteAddress status dueDate customer quote
    }
    dispatchChallans {
      id challanNumber status dispatchJobId customer quote lines createdAt
    }
  }
`;

const STATUS_ORDER = ['pending', 'packed', 'dispatched', 'delivered'];
const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending', packed: 'Packed', dispatched: 'In transit', delivered: 'Delivered',
};
const STATUS_TONE: Record<string, Tone> = {
  pending: 'warning', packed: 'sky', dispatched: 'brand', delivered: 'success',
};

export function DispatchOpsDashboard({ effectiveRole, user }: { effectiveRole: string; user: any }) {
  const { data, loading, error, refetch } = useQuery(DISP_DASH);

  const jobs: any[] = data?.dispatchJobs || [];
  const challans: any[] = data?.dispatchChallans || [];

  // ── Job counts by status
  const jobsByStatus = useMemo(() => {
    return STATUS_ORDER.map((status) => ({
      status, label: STATUS_LABEL[status],
      count: jobs.filter((j) => j.status === status).length,
    }));
  }, [jobs]);

  // ── Today's loads
  const today = new Date();
  const todaysJobs = useMemo(() => {
    const start = new Date(today); start.setHours(0, 0, 0, 0);
    const end = new Date(today); end.setHours(23, 59, 59, 999);
    return jobs.filter((j) => {
      const due = j.dueDate ? new Date(j.dueDate) : null;
      return due && due >= start && due <= end;
    });
  }, [jobs]);

  // ── Overdue jobs (due < today AND not delivered)
  const overdue = useMemo(() => {
    const start = new Date(today); start.setHours(0, 0, 0, 0);
    return jobs.filter((j) => {
      if (j.status === 'delivered') return false;
      const due = j.dueDate ? new Date(j.dueDate) : null;
      return due && due < start;
    });
  }, [jobs]);

  // ── Challans by status (7-day trend)
  const challansTrend = useMemo(() => {
    const buckets = new Map<string, { day: string; packed: number; dispatched: number; delivered: number }>();
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      buckets.set(d.toISOString().slice(0, 10), { day: d.toISOString().slice(0, 10), packed: 0, dispatched: 0, delivered: 0 });
    }
    for (const c of challans) {
      const k = String(c.createdAt || '').slice(0, 10);
      const b = buckets.get(k); if (!b) continue;
      if (c.status === 'packed') b.packed += 1;
      else if (c.status === 'dispatched') b.dispatched += 1;
      else if (c.status === 'delivered') b.delivered += 1;
    }
    return Array.from(buckets.values()).map((b) => ({
      ...b,
      label: new Date(b.day).toLocaleDateString('en-IN', { weekday: 'short' }),
    }));
  }, [challans]);

  const tiles: Array<{ label: string; value: any; caption: string; icon: any; tone: Tone; href: string; numeric?: boolean }> = [
    { label: "Today's loads", value: todaysJobs.length, caption: todaysJobs.length ? 'Due today' : 'Nothing scheduled', icon: Calendar, tone: todaysJobs.length ? 'brand' : 'neutral', href: '/dashboard/dispatch', numeric: true },
    { label: 'Pending allocation', value: jobsByStatus[0]?.count || 0, caption: 'Quotes confirmed, await packing', icon: Clock, tone: 'warning', href: '/dashboard/dispatch', numeric: true },
    { label: 'In transit', value: jobsByStatus[2]?.count || 0, caption: 'Out for delivery now', icon: Truck, tone: 'brand', href: '/dashboard/dispatch', numeric: true },
    { label: 'Overdue', value: overdue.length, caption: overdue.length ? 'Past due — escalate' : 'No overdue jobs', icon: AlertCircle, tone: overdue.length ? 'danger' : 'success', href: '/dashboard/dispatch', numeric: true },
  ];

  return (
    <div className="space-y-6">
      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}

      <GreetingStrip
        role={effectiveRole}
        user={user}
        name={user?.name}
        subtitle="Today's loads, pending challans, and what needs to leave the warehouse."
        actions={
          <>
            <Button asChild size="sm"><Link href="/dashboard/dispatch"><Truck className="mr-1.5 h-4 w-4" /> Dispatch board</Link></Button>
            <Button asChild variant="outline" size="sm"><Link href="/dashboard/orders">Sales orders</Link></Button>
          </>
        }
      />

      <MotionGrid className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {tiles.map((tile) => <MotionItem key={tile.label}><KpiTile {...tile} loading={loading} /></MotionItem>)}
      </MotionGrid>

      <section className="grid gap-3 xl:grid-cols-[1.4fr_1fr]">
        <Panel title="Challan activity · last 7 days" subtitle="Packed / in-transit / delivered counts" tone="brand">
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={challansTrend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="rgba(113,113,122,0.10)" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
                <Tooltip cursor={{ fill: 'rgba(37,99,235,0.04)' }} />
                <Bar dataKey="packed" stackId="a" fill="#bae6fd" radius={[0, 0, 0, 0]} />
                <Bar dataKey="dispatched" stackId="a" fill="#2563eb" />
                <Bar dataKey="delivered" stackId="a" fill="#059669" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-2 flex items-center justify-center gap-3 text-[11px]">
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#bae6fd]"/> Packed</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#2563eb]"/> Dispatched</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#059669]"/> Delivered</span>
            </div>
          </div>
        </Panel>

        <Panel title="Jobs by status" subtitle="Open dispatch jobs" tone="warning">
          <ul className="space-y-2">
            {jobsByStatus.map((s) => {
              const total = jobs.length || 1;
              const pct = (s.count / total) * 100;
              return (
                <li key={s.status}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-[#27272a]">{s.label}</span>
                    <span className="tabular-nums text-[#52525b]">{s.count}</span>
                  </div>
                  <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-[#f4f4f5]">
                    <div
                      className="h-full rounded-full transition-[width] duration-500"
                      style={{
                        width: `${pct}%`,
                        background: s.status === 'pending' ? '#d97706' : s.status === 'packed' ? '#0284c7' : s.status === 'dispatched' ? '#2563eb' : '#059669',
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>
      </section>

      <Panel title="Today's load board" subtitle={`${todaysJobs.length} job${todaysJobs.length === 1 ? '' : 's'} scheduled for today`} tone="brand" rightAction={<Link href="/dashboard/dispatch" className="text-xs font-medium text-[#1d4ed8] hover:underline">Dispatch desk</Link>}>
        {todaysJobs.length ? (
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {todaysJobs.map((j: any) => (
              <li key={j.id} className="rounded-r4 border border-[#e4e4e7] bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[#18181b]">{j.customer?.name || 'Customer'}</p>
                    <p className="mt-0.5 truncate text-[11px] text-[#71717a]"><MapPin className="-mt-0.5 mr-1 inline h-3 w-3" />{j.siteAddress || 'No address'}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase mp-kpi-icon-${STATUS_TONE[j.status] || 'neutral'}`}>{STATUS_LABEL[j.status] || j.status}</span>
                </div>
                <div className="mt-3 flex items-center justify-between text-[11px] text-[#52525b]">
                  <span><Calendar className="-mt-0.5 mr-1 inline h-3 w-3" />{j.dueDate ? new Date(j.dueDate).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit' }) : 'no time'}</span>
                  {j.quote?.quoteNumber ? <span className="mp-mono text-[#1d4ed8]">{j.quote.quoteNumber}</span> : null}
                </div>
              </li>
            ))}
          </ul>
        ) : <EmptyState>No loads scheduled for today.</EmptyState>}
      </Panel>

      {overdue.length ? (
        <Panel title="Overdue deliveries" subtitle="Past due, not yet delivered — escalate" tone="danger" rightAction={<Link href="/dashboard/dispatch" className="text-xs font-medium text-[#1d4ed8] hover:underline">Dispatch desk</Link>}>
          <ul className="space-y-1.5">
            {overdue.slice(0, 6).map((j: any) => (
              <li key={j.id} className="flex items-center justify-between gap-3 rounded-r3 border border-[#fecaca] bg-[#fff5f5] px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[#18181b]">{j.customer?.name || 'Customer'}</p>
                  <p className="truncate text-[11px] text-[#71717a]">{j.siteAddress || '—'} · due {j.dueDate ? new Date(j.dueDate).toLocaleDateString('en-IN') : '—'}</p>
                </div>
                <span className="shrink-0 rounded-full bg-[#fecaca] px-2 py-0.5 text-[10px] font-semibold uppercase text-[#b91c1c]">Overdue</span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}
