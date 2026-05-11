'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { gql, useMutation, useQuery } from '@apollo/client';
import { ArrowUpRight, CalendarClock, CheckCircle, FileSpreadsheet, PhoneCall, Plus, ShoppingBag, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryErrorBanner } from '@/components/query-state';

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
  return (Array.isArray(lines) ? lines : []).reduce((sum, line) => sum + Number(line.qty || line.quantity || 0) * Number(line.price || line.sellPrice || 0), 0);
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
  const leads = data?.leads || [];
  const quotes = data?.quotes || [];
  const stats = data?.salesDashboard?.stats || {};
  const dueToday = useMemo(() => leads.filter((lead: any) => lead.nextActionAt && new Date(lead.nextActionAt) <= new Date(Date.now() + 86400000)), [leads]);
  const pipeline = leads.reduce((sum: number, lead: any) => sum + Number(lead.expectedValue || 0), 0);
  const quoteValue = quotes.reduce((sum: number, quote: any) => sum + quoteTotal(quote.lines), 0);

  return (
    <div className="space-y-6 pb-10">
      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
      {stageError ? <QueryErrorBanner error={stageError} /> : null}
      <section className="relative overflow-hidden rounded-[2.25rem] bg-[#241b14] p-7 text-white shadow-2xl shadow-[#241b14]/15">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(59,130,246,0.40),transparent_30%),radial-gradient(circle_at_92%_28%,rgba(99,102,241,0.32),transparent_28%)]" />
        <div className="relative flex flex-col justify-between gap-7 xl:flex-row xl:items-end">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.28em] text-[#ead7bd]">Sales operating desk</p>
            <h1 className="mt-3 max-w-4xl text-5xl font-black leading-[0.95] tracking-[-0.055em]">Call, qualify, quote, follow up, close.</h1>
            <p className="mt-5 max-w-2xl text-sm font-semibold leading-6 text-[#f6eadb]">A sales user workspace that starts with leads, converts to image-backed quotes, and moves confirmed work to dispatch.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg" className="bg-[#ffffff] text-[#241b14] hover:bg-white"><Link href="/dashboard/leads/new"><Plus className="mr-2 h-5 w-5" /> New lead</Link></Button>
            <Button asChild variant="warning" size="lg"><Link href="/dashboard/quotes/new"><FileSpreadsheet className="mr-2 h-5 w-5" /> Build quote</Link></Button>
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
          <div key={label} className="mp-card rounded-[2rem] p-5">
            <Icon className="h-6 w-6 text-[#b17643]" />
            <div className="mt-5 text-3xl font-black tracking-[-0.04em] text-[#241b14]">{loading ? '...' : value}</div>
            <div className="mt-1 text-[10px] font-black uppercase tracking-widest text-[#6f6258]">{label}</div>
          </div>
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_0.72fr]">
        <div className="mp-card rounded-[2rem] p-5">
          <div className="flex items-center justify-between gap-4"><div><h2 className="text-2xl font-black tracking-tight">Lead pipeline</h2><p className="mt-1 text-sm font-semibold text-[#6f6258]">Move your own leads through sales stages.</p></div><Button asChild><Link href="/dashboard/leads/new">Add lead</Link></Button></div>
          <div className="mt-5 grid gap-4 lg:grid-cols-5">
            {stages.map((stage) => {
              const rows = leads.filter((lead: any) => lead.stage === stage || (stage === 'proposal' && lead.stage === 'quoted'));
              return (
                <div key={stage} className="rounded-[1.5rem] border border-[#d9cbbd]/10 bg-white/55 p-3">
                  <div className="flex items-center justify-between"><h3 className="text-xs font-black uppercase tracking-widest text-[#6f6258]">{stage}</h3><span className="rounded-full bg-[#f6eadb] px-2 py-1 text-xs font-black text-[#8a552e]">{rows.length}</span></div>
                  <div className="mt-3 space-y-3">
                    {rows.slice(0, 6).map((lead: any) => (
                      <article key={lead.id} className="rounded-2xl bg-[#ffffff] p-3 shadow-sm">
                        <p className="line-clamp-2 text-sm font-black text-[#241b14]">{lead.title}</p>
                        <p className="mt-1 truncate text-xs font-bold text-[#6f6258]">{lead.customer?.name || lead.source}</p>
                        <p className="mt-2 text-sm font-black text-[#047857]">{money(lead.expectedValue)}</p>
                        <div className="mt-3 flex flex-wrap gap-1">
                          {stage !== 'contacted' && <button onClick={() => updateStage({ variables: { id: lead.id, stage: 'contacted' } })} className="rounded-xl bg-[#f6eadb] px-2 py-1 text-[10px] font-black text-[#8a552e]">Contacted</button>}
                          {stage !== 'proposal' && <button onClick={() => updateStage({ variables: { id: lead.id, stage: 'proposal' } })} className="rounded-xl bg-[#ecfdf5] px-2 py-1 text-[10px] font-black text-[#047857]">Proposal</button>}
                          {stage !== 'won' && <button onClick={() => updateStage({ variables: { id: lead.id, stage: 'won' } })} className="rounded-xl bg-[#241b14] px-2 py-1 text-[10px] font-black text-white">Won</button>}
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
          <div className="mp-card rounded-[2rem] p-5">
            <div className="flex items-center justify-between"><h2 className="text-2xl font-black tracking-tight">Today follow-up</h2><PhoneCall className="h-6 w-6 text-[#b17643]" /></div>
            <div className="mt-5 space-y-3">
              {dueToday.slice(0, 6).map((lead: any) => <div key={lead.id} className="rounded-2xl bg-white/65 p-4"><p className="font-black text-[#241b14]">{lead.title}</p><p className="mt-1 text-xs font-bold text-[#6f6258]">{lead.customer?.mobile || lead.customer?.name || 'Call customer'}</p></div>)}
              {!dueToday.length && <p className="rounded-2xl border border-dashed border-[#d9cbbd]/20 p-6 text-center text-sm font-bold text-[#6f6258]">No due follow-ups.</p>}
            </div>
          </div>
          <div className="mp-card rounded-[2rem] p-5">
            <div className="flex items-center justify-between"><h2 className="text-2xl font-black tracking-tight">Recent quotes</h2><Button asChild variant="outline" size="sm"><Link href="/dashboard/quotes">All quotes</Link></Button></div>
            <div className="mt-5 space-y-3">
              {quotes.slice(0, 5).map((quote: any) => <Link key={quote.id} href={`/dashboard/quotes/${quote.id}`} className="block rounded-2xl bg-white/65 p-4 transition hover:bg-white"><div className="flex justify-between gap-3"><p className="font-black text-[#241b14]">{quote.quoteNumber}</p><span className="text-xs font-black uppercase text-[#b17643]">{quote.status}</span></div><p className="mt-1 truncate text-xs font-bold text-[#6f6258]">{quote.customer?.name || quote.title}</p></Link>)}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
