'use client';
import { statusLabel } from '@/lib/utils';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { gql, useMutation, useQuery } from '@apollo/client';
import { ArrowUpRight, CalendarClock, CheckCircle, FileSpreadsheet, PhoneCall, Plus, ShoppingBag, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryErrorBanner } from '@/components/query-state';
import { useBusyAction } from '@/hooks/use-busy-action';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';

const SALES_DESK = gql`
  query SalesDesk($ownerId: String!) {
    salesDashboard(ownerId: $ownerId) { stats pendingFollowups recentQuotes }
    leads(ownerId: $ownerId) { id title source stage expectedValue notes nextActionAt customer owner }
    quotes(ownerId: $ownerId) { id quoteNumber title status lines customer createdAt }
  }
`;

const UPDATE_STAGE = gql`mutation UpdateLeadStage($id: ID!, $stage: String!) { updateLeadStage(id: $id, stage: $stage) { id stage } }`;

function money(value: number) {
  return `₹${Math.round(Number(value || 0)).toLocaleString('en-IN')}`;
}

function quoteTotal(lines: any) {
  // Value before GST, the same rule as the owner reports.
  return (Array.isArray(lines) ? lines : []).reduce((sum, line) => sum + Number(line?.taxableValue || 0), 0);
}

const stages = ['new', 'contacted', 'proposal', 'negotiation', 'won'];

export default function SalesDeskPage() {
  const [user, setUser] = useState<any>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try { setUser(JSON.parse(localStorage.getItem('user') || 'null')); } finally { setReady(true); }
  }, []);

  const { data, loading, error, refetch } = useQuery(SALES_DESK, { variables: { ownerId: user?.id || '' }, skip: !ready || !user?.id });
  const [updateStage, { error: stageError }] = useMutation(UPDATE_STAGE, { onCompleted: () => refetch() });
  // One stage change at a time: a second tap while one is saving does nothing.
  const busyAction = useBusyAction();
  const moveLead = (lead: any, stage: string) => { void busyAction.run(`stage-${lead.id}`, async () => { await updateStage({ variables: { id: lead.id, stage } }); }).catch(() => undefined); };
  const leads = useMemo<any[]>(() => data?.leads || [], [data?.leads]);
  const quotes = useMemo<any[]>(() => data?.quotes || [], [data?.quotes]);
  const stats = data?.salesDashboard?.stats || {};
  const dueToday = useMemo(() => leads.filter((lead: any) => lead.nextActionAt && new Date(lead.nextActionAt) <= new Date(Date.now() + 86400000)), [leads]);
  const pipeline = leads.reduce((sum: number, lead: any) => sum + Number(lead.expectedValue || 0), 0);
  const quoteValue = quotes.reduce((sum: number, quote: any) => sum + quoteTotal(quote.lines), 0);

  return (
    <div className="space-y-6 pb-10">
      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
      {stageError ? <QueryErrorBanner error={stageError} /> : null}
      <section className="mp-page-header">
        <div className="contents">
          <div className="min-w-0">
            <p className="mp-eyebrow">Sales operating desk</p>
            <h1 className="mp-page-title">Call, qualify, quote, follow up, close.</h1>
            <p className="mp-page-sub">A sales user workspace that starts with leads, converts to image-backed quotes, and moves confirmed work to dispatch.</p>
          </div>
          <div className="mp-page-actions">
            <Button asChild><Link href="/dashboard/leads/new"><Plus className="mr-2 h-4 w-4" /> New lead</Link></Button>
            <Button asChild variant="outline"><Link href="/dashboard/quotes/new"><FileSpreadsheet className="mr-2 h-4 w-4" /> Build quote</Link></Button>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          ['My leads', stats.myLeads || leads.length, Users],
          ['Follow-ups due', dueToday.length, CalendarClock],
          ['Quote value', money(stats.quoteValue || quoteValue), ShoppingBag],
          ['Pipeline', money(pipeline), ArrowUpRight],
        ].map(([label, value, Icon]: any) => (
          <div key={label} className="mp-card rounded-r5 p-5">
            <Icon className="h-6 w-6 text-[#2563eb]" />
            <div className="mt-5 text-2xl font-semibold tracking-[-0.01em] text-[#18181b]">{loading ? '...' : value}</div>
            <div className="mt-1 text-xs font-medium uppercase tracking-widest text-[#52525b]">{label}</div>
          </div>
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_0.72fr]">
        <div className="mp-card rounded-r5 p-5">
          <div className="flex items-center justify-between gap-4"><div><h2 className="text-2xl font-black tracking-tight">Lead pipeline</h2><p className="mt-1 text-sm font-semibold text-[#52525b]">Move your own leads through sales stages.</p></div><Button asChild><Link href="/dashboard/leads/new">Add lead</Link></Button></div>
          <div className="mt-5 grid gap-4 lg:grid-cols-5">
            {stages.map((stage) => {
              const rows = leads.filter((lead: any) => lead.stage === stage || (stage === 'proposal' && lead.stage === 'quoted'));
              return (
                <div key={stage} className="rounded-r4 border border-[#e4e4e7]/10 bg-white/55 p-3">
                  <div className="flex items-center justify-between"><h3 className="text-xs font-black uppercase tracking-widest text-[#52525b]">{stage}</h3><span className="rounded-full bg-[#eff6ff] px-2 py-1 text-xs font-black text-[#1d4ed8]">{rows.length}</span></div>
                  <div className="mt-3 space-y-3">
                    {rows.slice(0, 6).map((lead: any) => (
                      <article key={lead.id} className="rounded-2xl bg-white p-3 shadow-sm">
                        <p className="line-clamp-2 text-sm font-semibold text-[#18181b]">{lead.title}</p>
                        <p className="mt-1 truncate text-xs font-bold text-[#52525b]">{lead.customer?.name || lead.source}</p>
                        <p className="mt-2 text-sm font-black text-[#059669]">{money(lead.expectedValue)}</p>
                        <div className="mt-3 flex flex-wrap gap-1">
                          {stage !== 'contacted' && <button type="button" disabled={busyAction.isBusy()} aria-label={`Mark ${lead.title} as contacted`} onClick={() => moveLead(lead, 'contacted')} className="min-h-11 rounded-xl bg-[#eff6ff] px-3 py-1 text-xs font-black text-[#1d4ed8] disabled:opacity-50 xl:min-h-0 xl:px-2">Contacted</button>}
                          {stage !== 'proposal' && <button type="button" disabled={busyAction.isBusy()} aria-label={`Move ${lead.title} to proposal`} onClick={() => moveLead(lead, 'proposal')} className="min-h-11 rounded-xl bg-[#ecfdf5] px-3 py-1 text-xs font-black text-[#059669] disabled:opacity-50 xl:min-h-0 xl:px-2">Proposal</button>}
                          {stage !== 'won' && <button type="button" disabled={busyAction.isBusy()} aria-label={`Mark ${lead.title} as won`} onClick={() => moveLead(lead, 'won')} className="min-h-11 rounded-xl bg-[#18181b] px-3 py-1 text-xs font-black text-white disabled:opacity-50 xl:min-h-0 xl:px-2">{busyAction.isBusy(`stage-${lead.id}`) ? 'Saving…' : 'Won'}</button>}
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-5">
          <div className="mp-card rounded-r5 p-5">
            <div className="flex items-center justify-between"><h2 className="text-2xl font-black tracking-tight">Today follow-up</h2><PhoneCall className="h-6 w-6 text-[#2563eb]" /></div>
            <div className="mt-5 space-y-3">
              {dueToday.slice(0, 6).map((lead: any) => <div key={lead.id} className="rounded-2xl bg-white/65 p-4"><p className="font-semibold text-[#18181b]">{lead.title}</p><p className="mt-1 text-xs font-bold text-[#52525b]">{lead.customer?.mobile || lead.customer?.name || 'Call customer'}</p></div>)}
              {loading && !data ? <Skeleton className="h-16 w-full" /> : null}
              {!loading && !error && !dueToday.length && <EmptyState compact title="No due follow-ups" description="Leads with a next action due today or earlier show here." />}
            </div>
          </div>
          <div className="mp-card rounded-r5 p-5">
            <div className="flex items-center justify-between"><h2 className="text-2xl font-black tracking-tight">Recent quotes</h2><Button asChild variant="outline" size="sm"><Link href="/dashboard/quotes">All quotes</Link></Button></div>
            <div className="mt-5 space-y-3">
              {loading && !data ? <Skeleton className="h-16 w-full" /> : null}
              {!loading && !error && !quotes.length ? <EmptyState compact title="No quotes yet" description="Quotes you make show up here." /> : null}
              {quotes.slice(0, 5).map((quote: any) => <Link key={quote.id} href={`/dashboard/quotes/${quote.id}`} className="block rounded-2xl bg-white/65 p-4 transition hover:bg-white"><div className="flex justify-between gap-3"><p className="font-semibold text-[#18181b]">{quote.quoteNumber}</p><span className="text-xs font-black uppercase text-[#2563eb]">{statusLabel(quote.status)}</span></div><p className="mt-1 truncate text-xs font-bold text-[#52525b]">{quote.customer?.name || quote.title}</p></Link>)}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
