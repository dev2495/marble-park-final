'use client';

import { useMemo, useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import { CalendarClock, Mail, Phone, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { QueryErrorBanner } from '@/components/query-state';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';

const DATA = gql`query Leads($search: String, $stage: String, $skip: Float, $take: Float) { leads(search: $search, stage: $stage, skip: $skip, take: $take) { id title source stage expectedValue notes nextActionAt customer owner } }`;
const UPDATE_STAGE = gql`mutation UpdateLeadStage($id: ID!, $stage: String!) { updateLeadStage(id: $id, stage: $stage) { id stage } }`;
const stages = ['all', 'new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];

const stageTone = (stage: string): StatusTone => (stage === 'won' ? 'success' : stage === 'lost' ? 'danger' : stage === 'new' ? 'neutral' : stage === 'negotiation' ? 'warning' : 'info');
function money(value: number) { return `₹${Number(value || 0).toLocaleString('en-IN')}`; }

export default function LeadsPipelinePage() {
  const [stage, setStage] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 30;
  const { data, loading, error, refetch } = useQuery(DATA, { variables: { search: search || undefined, stage: stage === 'all' ? undefined : stage, skip: page * pageSize, take: pageSize + 1 }, fetchPolicy: 'cache-and-network' });
  const [updateStage, updateState] = useMutation(UPDATE_STAGE, { onCompleted: () => refetch() });
  // Marking a lead lost closes the deal, so it is confirmed first.
  const [lostTarget, setLostTarget] = useState<any>(null);
  const changeStage = (lead: any, next: string) => {
    if (updateState.loading) return;
    if (next === 'lost') { setLostTarget(lead); return; }
    void updateStage({ variables: { id: lead.id, stage: next } }).catch(() => undefined);
  };
  const leadPage = useMemo<any[]>(() => data?.leads || [], [data?.leads]);
  const leads = leadPage.slice(0, pageSize);
  const hasNext = leadPage.length > pageSize;
  const rows = leads;
  const pipelineValue = leads.filter((lead: any) => !['won', 'lost'].includes(lead.stage)).reduce((sum: number, lead: any) => sum + Number(lead.expectedValue || 0), 0);
  const overdue = leads.filter((lead: any) => lead.nextActionAt && new Date(lead.nextActionAt) < new Date() && !['won', 'lost'].includes(lead.stage)).length;

  return <div className="space-y-5 pb-10">
    {error ? <QueryErrorBanner error={error} onRetry={() => refetch()}/> : null}
    {updateState.error ? <QueryErrorBanner error={updateState.error}/> : null}
    <header className="mp-page-header"><div className="min-w-0"><p className="mp-eyebrow">CRM pipeline</p><h1 className="mp-page-title">Showroom leads and follow-ups</h1><p className="mp-page-sub">Open the customer, capture exact product intent, revise quotes and keep the next action visible on phone or tablet.</p></div><Button asChild><Link href="/dashboard/leads/new"><Plus className="mr-2 h-4 w-4"/>New lead</Link></Button></header>
    <section className="grid gap-4 border-b border-[var(--line)] pb-4 sm:grid-cols-[1fr_auto_auto] sm:items-end"><label className="flex h-11 max-w-lg items-center rounded-md border border-[var(--line)] bg-[var(--bg-soft)] px-3"><Search className="mr-2 h-4 w-4 text-[var(--ink-4)]"/><input aria-label="Search leads by customer, project or requirement" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Customer, project or requirement" className="w-full bg-transparent text-sm outline-none"/></label><div><p className="text-xl font-semibold tabular-nums text-[var(--ink)]">{money(pipelineValue)}</p><p className="text-xs text-[var(--ink-4)]">Visible open pipeline</p></div><div><p className={`text-xl font-semibold tabular-nums ${overdue ? 'text-red-700' : 'text-emerald-700'}`}>{overdue}</p><p className="text-xs text-[var(--ink-4)]">Visible overdue</p></div></section>
    <div className="flex gap-1 overflow-x-auto rounded-md border border-[var(--line)] bg-[var(--surface)] p-1">{stages.map((item) => <button key={item} type="button" aria-pressed={stage === item} onClick={() => { setStage(item); setPage(0); }} className={`h-11 min-w-fit sm:h-9 rounded px-3 text-xs font-semibold capitalize ${stage === item ? 'bg-[var(--ink)] text-[var(--surface)]' : 'text-[var(--ink-3)] hover:bg-[var(--bg-soft)]'}`}>{item === 'proposal' ? 'Quoted' : item}</button>)}</div>
    <section className="mp-panel overflow-hidden"><div className="divide-y divide-[var(--line)]">{rows.map((lead: any) => { const overdueAction = lead.nextActionAt && new Date(lead.nextActionAt) < new Date() && !['won', 'lost'].includes(lead.stage); return <article key={lead.id} className="grid gap-3 p-4 md:grid-cols-[1.5fr_1fr_auto] md:items-center"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><StatusPill tone={stageTone(lead.stage)} className="capitalize">{lead.stage === 'proposal' ? 'quoted' : lead.stage}</StatusPill><span className="text-xs text-[var(--ink-4)]">{lead.source}</span></div><Link href={`/dashboard/leads/${lead.id}`} className="mt-2 block truncate font-semibold text-[var(--ink)] hover:text-[var(--brand-700)]">{lead.title}</Link><p className="mt-1 truncate text-xs text-[var(--ink-4)]">{lead.customer?.name || 'Customer pending'} · {lead.owner?.name || 'Unassigned'}</p></div><div><p className="font-semibold tabular-nums text-[var(--ink)]">{money(lead.expectedValue)}</p><p className={`mt-1 flex items-center gap-1 text-xs ${overdueAction ? 'font-semibold text-red-700' : 'text-[var(--ink-4)]'}`}><CalendarClock className="h-3.5 w-3.5"/>{lead.nextActionAt ? new Date(lead.nextActionAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Next action not set'}</p></div><div className="flex items-center gap-2">{lead.customer?.mobile ? <a title="Call customer" aria-label={`Call ${lead.customer?.name || 'customer'}`} href={`tel:${lead.customer.mobile}`} className="grid h-11 w-11 place-items-center rounded-md border border-[var(--line)] text-[var(--ink-3)] hover:bg-[var(--bg-soft)]"><Phone className="h-4 w-4"/></a> : <span title="No mobile number saved" aria-label="No mobile number saved" className="grid h-11 w-11 place-items-center rounded-md border border-dashed border-[var(--line)] text-[var(--ink-5)]"><Phone className="h-4 w-4"/></span>}{lead.customer?.email ? <a title="Email customer" aria-label={`Email ${lead.customer?.name || 'customer'}`} href={`mailto:${lead.customer.email}`} className="grid h-11 w-11 place-items-center rounded-md border border-[var(--line)] text-[var(--ink-3)] hover:bg-[var(--bg-soft)]"><Mail className="h-4 w-4"/></a> : <span title="No email saved" aria-label="No email saved" className="grid h-11 w-11 place-items-center rounded-md border border-dashed border-[var(--line)] text-[var(--ink-5)]"><Mail className="h-4 w-4"/></span>}<select aria-label={`Stage for ${lead.title}`} value={lead.stage === 'quoted' ? 'proposal' : lead.stage} disabled={updateState.loading} onChange={(event) => changeStage(lead, event.target.value)} className="h-11 rounded-md border border-[var(--line)] bg-[var(--bg-soft)] px-2 text-xs font-semibold">{stages.filter((item) => item !== 'all').map((item) => <option key={item} value={item}>{item === 'proposal' ? 'Quoted' : item}</option>)}</select></div></article>; })}</div>{loading && !rows.length ? <div role="status" aria-label="Loading leads" className="grid gap-3 p-4"><Skeleton className="h-16 w-full"/><Skeleton className="h-16 w-full"/><Skeleton className="h-16 w-full"/></div> : null}{!loading && !error && !rows.length ? <EmptyState icon={Search} title="No leads in this view" description="Try another stage or clear the search." action={<Button asChild variant="outline"><Link href="/dashboard/leads/new">New lead</Link></Button>}/> : null}</section>
    <div className="flex items-center justify-between"><Button variant="outline" disabled={page === 0 || loading} onClick={() => setPage((value) => Math.max(0, value - 1))}>Previous</Button><span className="text-xs font-semibold text-[var(--ink-4)]">Lead page {page + 1}</span><Button variant="outline" disabled={!hasNext || loading} onClick={() => setPage((value) => value + 1)}>Next</Button></div>
    <ConfirmDialog open={Boolean(lostTarget)} onOpenChange={(open) => { if (!open) setLostTarget(null); }} title="Mark this lead as lost?" description={`${lostTarget?.title || 'This lead'} moves out of the open pipeline. You can move it back to another stage later.`} confirmLabel="Mark as lost" cancelLabel="Keep open" tone="danger" busy={updateState.loading}
      onConfirm={async () => { try { await updateStage({ variables: { id: lostTarget.id, stage: 'lost' } }); setLostTarget(null); } catch { /* shown in the banner above */ } }} />
  </div>;
}
