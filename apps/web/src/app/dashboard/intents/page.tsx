'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { gql, useMutation, useQuery } from '@apollo/client';
import { Filter, Hammer, Lock, RefreshCw, Search, Sparkles, Unlock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBusyAction } from '@/hooks/use-busy-action';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import { QueryErrorBanner } from '@/components/query-state';

const INTENTS = gql`
  query Intents($status: String, $pendingOnly: Boolean, $mineOnly: Boolean) {
    intents(status: $status, pendingOnly: $pendingOnly, mineOnly: $mineOnly)
  }
`;

const PICK_UP = gql`mutation Pick($id: ID!) { pickUpIntent(id: $id) }`;
const FOCUSED_INTENT = gql`query FocusedInboxIntent($id: ID!) { intent(id: $id) }`;
const RELEASE = gql`mutation Rel($id: ID!, $force: Boolean) { releaseIntent(id: $id, force: $force) }`;
const GENERATE = gql`mutation Gen($intentId: String!, $note: String, $displayMode: String) { generateQuoteFromIntent(intentId: $intentId, note: $note, displayMode: $displayMode) }`;

function money(n: number) { return `₹${Math.round(Number(n || 0)).toLocaleString('en-IN')}`; }
function rowsTotal(rows: any) {
  return (Array.isArray(rows) ? rows : []).reduce((s: number, r: any) => s + Number(r.qty || r.quantity || 0) * Number(r.price || r.sellPrice || 0), 0);
}
function statusBadge(status: string): { tone: StatusTone; label: string } {
  switch (status) {
    case 'pending_quote': return { tone: 'warning', label: 'Waiting' };
    case 'in_quote': return { tone: 'info', label: 'Building' };
    case 'draft': return { tone: 'neutral', label: 'Draft' };
    case 'converted': return { tone: 'success', label: 'Quote built' };
    case 'cancelled': return { tone: 'danger', label: 'Cancelled' };
    case 'quoted': return { tone: 'success', label: 'Quote built' };
    default: return { tone: 'neutral', label: status };
  }
}
function typeBadge(type: string): { tone: StatusTone; label: string } {
  switch (type) {
    case 'revision': return { tone: 'info', label: 'Revision' };
    case 'followup': return { tone: 'neutral', label: 'Follow-up' };
    case 'initial': return { tone: 'info', label: 'Initial' };
    default: return { tone: 'neutral', label: type };
  }
}

export default function IntentDeskPage() {
  const [tab, setTab] = useState<'pending' | 'in_quote' | 'mine' | 'all'>('pending');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [focusedId, setFocusedId] = useState('');
  useEffect(() => { const id = new URLSearchParams(window.location.search).get('intentId') || ''; setFocusedId(id); if (id) setTab('all'); }, []);
  const focused = useQuery(FOCUSED_INTENT, { variables: { id: focusedId }, skip: !focusedId, fetchPolicy: 'network-only' });

  const [me, setMe] = useState<any>(null);
  useEffect(() => { try { setMe(JSON.parse(localStorage.getItem('user') || 'null')); } catch { setMe(null); } }, []);

  const variables = useMemo(() => {
    if (tab === 'pending') return { status: 'pending_quote' };
    if (tab === 'in_quote') return { status: 'in_quote' };
    if (tab === 'mine') return { mineOnly: true, pendingOnly: true };
    return { pendingOnly: true };
  }, [tab]);

  const { data, loading, error, refetch } = useQuery(INTENTS, {
    variables,
    pollInterval: 120000,
    skipPollAttempt: () => typeof document !== 'undefined' && document.hidden,
    fetchPolicy: 'cache-and-network',
  });
  const [pickUp, { error: pickUpError }] = useMutation(PICK_UP, { onCompleted: () => refetch() });
  const [release, { error: releaseError }] = useMutation(RELEASE, { onCompleted: () => refetch() });
  const [generate, { error: generateError }] = useMutation(GENERATE, { onCompleted: () => refetch() });
  // One action at a time, keyed by the intent, so a double tap cannot repeat it.
  const busyAction = useBusyAction();
  const [releaseTarget, setReleaseTarget] = useState<any>(null);
  const guarded = (key: string, task: () => Promise<unknown>) => { void busyAction.run(key, task).catch(() => undefined); };

  const role = me?.role || '';
  const isOfficeOrManager =
    ['admin', 'owner', 'sales_manager', 'office_staff'].includes(role) ||
    Boolean(me?.effectivePermissions?.includes('quotes.manage'));

  const intents = (focusedId ? (focused.data?.intent ? [focused.data.intent] : []) : data?.intents || []).filter((intent: any) => {
    if (typeFilter && intent.intentType !== typeFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const haystack = `${intent.lead?.title || ''} ${intent.customer?.name || ''} ${intent.notes || ''}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const stats = useMemo(() => {
    const all = data?.intents || [];
    return {
      pending: all.filter((i: any) => i.status === 'pending_quote').length,
      inQuote: all.filter((i: any) => i.status === 'in_quote').length,
      revisions: all.filter((i: any) => i.intentType === 'revision').length,
      followups: all.filter((i: any) => i.intentType === 'followup').length,
    };
  }, [data]);

  return (
    <div className="space-y-6 pb-10">
      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
      {focused.error ? <QueryErrorBanner error={focused.error} onRetry={() => focused.refetch()} /> : null}
      {focusedId ? <div className="flex items-center justify-between rounded-lg border border-[var(--line)] p-3 text-sm"><span>Showing the selection opened from your inbox.</span><Button variant="outline" onClick={() => setFocusedId('')}>Show all selections</Button></div> : null}
      {generateError || pickUpError || releaseError ? <QueryErrorBanner error={(generateError || pickUpError || releaseError)!} /> : null}

      <section className="mp-page-header">
        <div className="contents">
          <div className="min-w-0">
            <p className="mp-eyebrow">Office intent desk</p>
            <h1 className="mp-page-title">Intents → quotes</h1>
            <p className="mp-page-sub">
              Pick a pending intent, build the quote with prices, hand it back to sales. Lock auto-releases after 30 min of inactivity so the queue never gets stuck.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" loading={busyAction.isBusy('refresh')} onClick={() => guarded('refresh', async () => { await refetch(); })}><RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh</Button>
          </div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-4">
          <KpiCard label="Waiting" value={stats.pending} tone="amber" />
          <KpiCard label="Building" value={stats.inQuote} tone="blue" />
          <KpiCard label="Revisions" value={stats.revisions} tone="violet" />
          <KpiCard label="Follow-ups" value={stats.followups} tone="sky" />
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-2 rounded-r5 border border-[var(--line)] bg-[var(--surface)] p-3 shadow-sm-soft">
        {[
          { id: 'pending', label: 'Waiting for me' },
          { id: 'in_quote', label: 'Being built' },
          { id: 'mine', label: 'My submitted' },
          { id: 'all', label: 'All active' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id as any)}
            className={
              tab === t.id
                ? 'inline-flex items-center gap-2 rounded-full bg-[var(--brand-600)] px-3 py-1.5 text-xs font-semibold text-white'
                : 'inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-2)] hover:bg-[var(--bg-soft)]'
            }
          >
            {t.label}
          </button>
        ))}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex h-9 items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2.5">
            <Filter className="h-3.5 w-3.5 text-[var(--ink-4)]" />
            <select aria-label="Filter by intent type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="bg-transparent text-xs font-semibold text-[var(--ink)] outline-none">
              <option value="">All types</option>
              <option value="initial">Initial</option>
              <option value="revision">Revision</option>
              <option value="followup">Follow-up</option>
            </select>
          </div>
          <div className="flex h-9 items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2.5">
            <Search className="h-3.5 w-3.5 text-[var(--ink-4)]" />
            <input
              type="search"
              aria-label="Search intents by lead, customer or notes"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-32 bg-transparent text-xs text-[var(--ink)] outline-none placeholder:text-[var(--ink-5)] sm:w-44"
            />
          </div>
        </div>
      </section>

      <section className="grid gap-3">
        {loading && !intents.length ? (
          <div role="status" aria-label="Loading intents" className="grid gap-3"><Skeleton className="h-32 w-full" /><Skeleton className="h-32 w-full" /><Skeleton className="h-32 w-full" /></div>
        ) : null}
        {!loading && !error && intents.length === 0 ? (
          <EmptyState icon={Sparkles} className="rounded-r4 border border-dashed border-[var(--line)] bg-[var(--surface)]" title="No intents in this view" description="When a sales rep submits a selection, it shows up here." />
        ) : null}
        {intents.map((intent: any) => {
          const sBadge = statusBadge(intent.status);
          const tBadge = typeBadge(intent.intentType);
          const myLock = intent.lockedBy === me?.id;
          const showPickUp = intent.status === 'pending_quote';
          const showRelease = intent.status === 'in_quote' && (myLock || ['admin', 'owner', 'sales_manager'].includes(role));
          const showBuild = intent.status === 'in_quote' && myLock;
          const rows = Array.isArray(intent.rows) ? intent.rows : [];
          return (
            <article key={intent.id} className="rounded-r5 border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm-soft">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={sBadge.tone}>{sBadge.label}</StatusPill>
                    <StatusPill tone={tBadge.tone} dot={false}>{tBadge.label}</StatusPill>
                    {intent.referencesQuoteId ? <StatusPill tone="info" dot={false}>Revises prior quote</StatusPill> : null}
                    {intent.lockedBy && intent.status === 'in_quote' ? (
                      <StatusPill tone="info" dot={false}><Lock className="h-3 w-3" /> {intent.locker?.name || 'Locked'}</StatusPill>
                    ) : null}
                  </div>
                  {intent.leadId ? (
                    <Link href={`/dashboard/leads/${intent.leadId}`} className="mt-2 block text-lg font-bold text-[var(--ink)] hover:text-[var(--brand-700)]">
                      {intent.lead?.title || 'Lead'}
                    </Link>
                  ) : <p className="mt-2 text-lg font-bold text-[var(--ink)]">{intent.lead?.title || 'Lead'}</p>}
                  <p className="text-xs text-[var(--ink-3)]">
                    {intent.customer?.name || '—'} · Sales: {intent.owner?.name || '—'} · {new Date(intent.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xl font-bold text-[var(--ink)]">{money(rowsTotal(rows))}</p>
                  <p className="text-xs font-bold uppercase tracking-widest text-[var(--ink-5)]">{rows.length} rows</p>
                </div>
              </div>

              {intent.notes ? (
                <p className="mt-3 rounded-r3 bg-[var(--bg-soft)] p-3 text-xs leading-5 text-[var(--ink-3)] line-clamp-3">{intent.notes}</p>
              ) : null}

              <details className="mt-3 group">
                <summary className="cursor-pointer text-xs font-bold uppercase tracking-widest text-[var(--ink-3)] hover:text-[var(--ink)]">
                  Show {rows.length} row{rows.length === 1 ? '' : 's'}
                </summary>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {rows.map((row: any, idx: number) => (
                    <div key={idx} className="rounded-r3 border border-[var(--line)] bg-[var(--bg-soft)]/40 p-3">
                      <p className="text-xs font-bold uppercase tracking-widest text-[var(--brand-700)]">{row.area || 'General Selection'}</p>
                      <p className="mt-1 truncate text-sm font-bold text-[var(--ink)]">{row.name || row.sku || 'Item'}</p>
                      <p className="text-xs font-mono text-[var(--ink-4)]">{row.sku || ''} {row.brand ? `· ${row.brand}` : ''}</p>
                      <p className="mt-1 text-xs font-semibold text-[var(--ink-2)]">{row.qty || row.quantity || 0} {row.unit || row.uom || 'PC'} × {money(row.price || row.sellPrice || 0)}</p>
                    </div>
                  ))}
                </div>
              </details>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Link href={`/dashboard/intents/${intent.id}`} className="inline-flex min-h-11 items-center text-xs font-bold text-[var(--brand-700)] hover:underline sm:min-h-0">
                  Open intent →
                </Link>
                {showPickUp && isOfficeOrManager ? (
                  <Button size="sm" onClick={() => guarded(`pick-${intent.id}`, async () => { await pickUp({ variables: { id: intent.id } }); })} disabled={busyAction.isBusy() && !busyAction.isBusy(`pick-${intent.id}`)} loading={busyAction.isBusy(`pick-${intent.id}`)}>
                    <Hammer className="mr-1.5 h-3.5 w-3.5" /> Pick up
                  </Button>
                ) : null}
                {showBuild ? (
                  <Button size="sm" onClick={() => guarded(`build-${intent.id}`, async () => { await generate({ variables: { intentId: intent.id, note: 'Built from intent desk' } }); })} disabled={busyAction.isBusy() && !busyAction.isBusy(`build-${intent.id}`)} loading={busyAction.isBusy(`build-${intent.id}`)}>
                    {busyAction.isBusy(`build-${intent.id}`) ? 'Generating…' : 'Build quote'}
                  </Button>
                ) : null}
                {showRelease ? (
                  <button type="button" disabled={busyAction.isBusy()} onClick={() => setReleaseTarget({ intent, force: !myLock })} className="inline-flex h-11 items-center sm:h-8 disabled:opacity-60 gap-1 rounded-md border border-blue-200 bg-blue-50 px-2.5 text-xs font-bold uppercase tracking-widest text-blue-800 hover:bg-blue-100">
                    <Unlock className="h-3 w-3" /> Release
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </section>
      <ConfirmDialog
        open={Boolean(releaseTarget)}
        onOpenChange={(open) => { if (!open) setReleaseTarget(null); }}
        title="Release the lock?"
        description={releaseTarget?.force ? 'You take the lock away from the office staff who is building this quote. The intent goes back to the waiting list.' : 'You stop building this quote and the intent goes back to the waiting list.'}
        confirmLabel="Release lock"
        cancelLabel="Keep lock"
        tone="danger"
        busy={busyAction.isBusy('release')}
        onConfirm={() => guarded('release', async () => { await release({ variables: { id: releaseTarget.intent.id, force: releaseTarget.force } }); setReleaseTarget(null); })}
      />
    </div>
  );
}

function KpiCard({ label, value, tone }: { label: string; value: number; tone: 'amber' | 'blue' | 'violet' | 'sky' }) {
  const toneClass = {
    amber: 'text-amber-700',
    blue: 'text-blue-700',
    violet: 'text-violet-700',
    sky: 'text-sky-700',
  }[tone];
  return (
    <div className="rounded-r3 border border-[var(--line)] bg-white/85 p-4">
      <p className="text-xs font-bold uppercase tracking-widest text-[var(--ink-5)]">{label}</p>
      <p className={`text-2xl font-bold ${toneClass}`}>{value}</p>
    </div>
  );
}
