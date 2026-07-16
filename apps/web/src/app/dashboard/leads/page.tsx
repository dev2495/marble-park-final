'use client';

import { useMemo, useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import { CalendarClock, Mail, Phone, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { QueryErrorBanner } from '@/components/query-state';

const DATA = gql`query Leads($search: String) { leads(search: $search) { id title source stage expectedValue notes nextActionAt customer owner } }`;
const UPDATE_STAGE = gql`mutation UpdateLeadStage($id: ID!, $stage: String!) { updateLeadStage(id: $id, stage: $stage) { id stage } }`;
const stages = ['all', 'new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];

function money(value: number) { return `₹${Number(value || 0).toLocaleString('en-IN')}`; }

export default function LeadsPipelinePage() {
  const [stage, setStage] = useState('all');
  const [search, setSearch] = useState('');
  const { data, loading, error, refetch } = useQuery(DATA, { variables: { search: search || undefined }, fetchPolicy: 'cache-and-network' });
  const [updateStage, updateState] = useMutation(UPDATE_STAGE, { onCompleted: () => refetch() });
  const leads = useMemo<any[]>(() => data?.leads || [], [data?.leads]);
  const rows = stage === 'all' ? leads : leads.filter((lead: any) => lead.stage === stage || (stage === 'proposal' && lead.stage === 'quoted'));
  const pipelineValue = leads.filter((lead: any) => !['won', 'lost'].includes(lead.stage)).reduce((sum: number, lead: any) => sum + Number(lead.expectedValue || 0), 0);
  const overdue = leads.filter((lead: any) => lead.nextActionAt && new Date(lead.nextActionAt) < new Date() && !['won', 'lost'].includes(lead.stage)).length;

  return <div className="space-y-5 pb-10">
    {error ? <QueryErrorBanner error={error} onRetry={() => refetch()}/> : null}
    {updateState.error ? <QueryErrorBanner error={updateState.error}/> : null}
    <header className="flex flex-col justify-between gap-4 border-b border-[var(--line)] pb-5 pt-2 lg:flex-row lg:items-end"><div><p className="text-xs font-semibold uppercase text-[var(--ink-4)]">CRM pipeline</p><h1 className="mt-1 font-display text-3xl font-bold text-[var(--ink)]">Showroom leads and follow-ups</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-3)]">Open the customer, capture exact product intent, revise quotes and keep the next action visible on phone or tablet.</p></div><Button asChild><Link href="/dashboard/leads/new"><Plus className="mr-2 h-4 w-4"/>New lead</Link></Button></header>
    <section className="grid gap-4 border-b border-[var(--line)] pb-4 sm:grid-cols-[1fr_auto_auto] sm:items-end"><label className="flex h-10 max-w-lg items-center rounded-md border border-[var(--line)] bg-[var(--bg-soft)] px-3"><Search className="mr-2 h-4 w-4 text-[var(--ink-4)]"/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Customer, project or requirement" className="w-full bg-transparent text-sm outline-none"/></label><div><p className="text-xl font-semibold tabular-nums text-[var(--ink)]">{money(pipelineValue)}</p><p className="text-xs text-[var(--ink-4)]">Open pipeline</p></div><div><p className={`text-xl font-semibold tabular-nums ${overdue ? 'text-red-700' : 'text-emerald-700'}`}>{overdue}</p><p className="text-xs text-[var(--ink-4)]">Follow-ups overdue</p></div></section>
    <div className="flex gap-1 overflow-x-auto rounded-md border border-[var(--line)] bg-[var(--surface)] p-1">{stages.map((item) => <button key={item} onClick={() => setStage(item)} className={`h-9 min-w-fit rounded px-3 text-xs font-semibold capitalize ${stage === item ? 'bg-[var(--ink)] text-white' : 'text-[var(--ink-3)] hover:bg-[var(--bg-soft)]'}`}>{item === 'proposal' ? 'Quoted' : item}<span className="ml-2 tabular-nums opacity-70">{item === 'all' ? leads.length : leads.filter((lead: any) => lead.stage === item || (item === 'proposal' && lead.stage === 'quoted')).length}</span></button>)}</div>
    <section className="mp-panel overflow-hidden"><div className="divide-y divide-[var(--line)]">{rows.map((lead: any) => { const overdueAction = lead.nextActionAt && new Date(lead.nextActionAt) < new Date() && !['won', 'lost'].includes(lead.stage); return <article key={lead.id} className="grid gap-3 p-4 md:grid-cols-[1.5fr_1fr_auto] md:items-center"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded bg-[var(--bg-soft)] px-2 py-1 text-xs font-semibold capitalize">{lead.stage === 'proposal' ? 'quoted' : lead.stage}</span><span className="text-xs text-[var(--ink-4)]">{lead.source}</span></div><Link href={`/dashboard/leads/${lead.id}`} className="mt-2 block truncate font-semibold text-[var(--ink)] hover:text-[var(--brand-700)]">{lead.title}</Link><p className="mt-1 truncate text-xs text-[var(--ink-4)]">{lead.customer?.name || 'Customer pending'} · {lead.owner?.name || 'Unassigned'}</p></div><div><p className="font-semibold tabular-nums text-[var(--ink)]">{money(lead.expectedValue)}</p><p className={`mt-1 flex items-center gap-1 text-xs ${overdueAction ? 'font-semibold text-red-700' : 'text-[var(--ink-4)]'}`}><CalendarClock className="h-3.5 w-3.5"/>{lead.nextActionAt ? new Date(lead.nextActionAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Next action not set'}</p></div><div className="flex items-center gap-2"><a title="Call customer" href={lead.customer?.mobile ? `tel:${lead.customer.mobile}` : undefined} className="grid h-10 w-10 place-items-center rounded-md border border-[var(--line)] text-[var(--ink-3)] hover:bg-[var(--bg-soft)]"><Phone className="h-4 w-4"/></a><a title="Email customer" href={lead.customer?.email ? `mailto:${lead.customer.email}` : undefined} className="grid h-10 w-10 place-items-center rounded-md border border-[var(--line)] text-[var(--ink-3)] hover:bg-[var(--bg-soft)]"><Mail className="h-4 w-4"/></a><select aria-label={`Stage for ${lead.title}`} value={lead.stage === 'quoted' ? 'proposal' : lead.stage} disabled={updateState.loading} onChange={(event) => updateStage({ variables: { id: lead.id, stage: event.target.value } })} className="h-10 rounded-md border border-[var(--line)] bg-[var(--bg-soft)] px-2 text-xs font-semibold">{stages.filter((item) => item !== 'all').map((item) => <option key={item} value={item}>{item === 'proposal' ? 'Quoted' : item}</option>)}</select></div></article>; })}</div>{!loading && !rows.length ? <div className="grid min-h-52 place-items-center text-center"><div><Search className="mx-auto h-7 w-7 text-[var(--ink-5)]"/><p className="mt-3 font-semibold text-[var(--ink)]">No leads in this view</p></div></div> : null}</section>
  </div>;
}
