'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { gql, useMutation, useQuery } from '@apollo/client';
import { Filter, Hammer, Lock, RefreshCw, Search, Sparkles, Unlock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryErrorBanner } from '@/components/query-state';

const INTENTS = gql`
  query Intents($status: String, $pendingOnly: Boolean, $mineOnly: Boolean) {
    intents(status: $status, pendingOnly: $pendingOnly, mineOnly: $mineOnly)
  }
`;

const PICK_UP = gql`mutation Pick($id: ID!) { pickUpIntent(id: $id) }`;
const RELEASE = gql`mutation Rel($id: ID!, $force: Boolean) { releaseIntent(id: $id, force: $force) }`;
const GENERATE = gql`mutation Gen($intentId: String!, $note: String, $displayMode: String) { generateQuoteFromIntent(intentId: $intentId, note: $note, displayMode: $displayMode) }`;

function money(n: number) { return `₹${Math.round(Number(n || 0)).toLocaleString('en-IN')}`; }
function rowsTotal(rows: any) {
  return (Array.isArray(rows) ? rows : []).reduce((s: number, r: any) => s + Number(r.qty || r.quantity || 0) * Number(r.price || r.sellPrice || 0), 0);
}
function statusBadge(status: string) {
  switch (status) {
    case 'pending_quote': return { bg: 'bg-amber-100 text-amber-800', label: 'Waiting' };
    case 'in_quote': return { bg: 'bg-blue-100 text-blue-800', label: 'Building' };
    case 'draft': return { bg: 'bg-slate-100 text-slate-700', label: 'Draft' };
    case 'converted': return { bg: 'bg-emerald-100 text-emerald-800', label: 'Quote built' };
    case 'cancelled': return { bg: 'bg-rose-100 text-rose-700', label: 'Cancelled' };
    case 'quoted': return { bg: 'bg-emerald-100 text-emerald-800', label: 'Quote built' };
    default: return { bg: 'bg-slate-100 text-slate-700', label: status };
  }
}
function typeBadge(type: string) {
  switch (type) {
    case 'revision': return { bg: 'bg-violet-100 text-violet-800', label: 'Revision' };
    case 'followup': return { bg: 'bg-sky-100 text-sky-800', label: 'Follow-up' };
    case 'initial': return { bg: 'bg-blue-100 text-blue-800', label: 'Initial' };
    default: return { bg: 'bg-slate-100 text-slate-700', label: type };
  }
}

export default function IntentDeskPage() {
  const [tab, setTab] = useState<'pending' | 'in_quote' | 'mine' | 'all'>('pending');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [search, setSearch] = useState('');

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
  const [pickUp, { loading: pickingUp }] = useMutation(PICK_UP, { onCompleted: () => refetch() });
  const [release] = useMutation(RELEASE, { onCompleted: () => refetch() });
  const [generate, { loading: generating, error: generateError }] = useMutation(GENERATE, { onCompleted: () => refetch() });

  const role = me?.role || '';
  const isOfficeOrManager =
    ['admin', 'owner', 'sales_manager', 'office_staff'].includes(role) ||
    Boolean(me?.effectivePermissions?.includes('quotes.manage'));

  const intents = (data?.intents || []).filter((intent: any) => {
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
      {generateError ? <QueryErrorBanner error={generateError} /> : null}

      <section className="relative overflow-hidden rounded-r5 border border-[var(--line)] bg-gradient-to-br from-blue-50 via-white to-emerald-50/40 p-6 shadow-sm-soft">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-[var(--brand-700)]">Office intent desk</p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-[var(--ink)]">Intents → quotes</h1>
            <p className="mt-2 max-w-2xl text-sm text-[var(--ink-3)]">
              Pick a pending intent, build the quote with prices, hand it back to sales. Lock auto-releases after 30 min of inactivity so the queue never gets stuck.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh</Button>
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
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="bg-transparent text-xs font-semibold text-[var(--ink)] outline-none">
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
          <p className="rounded-r4 border border-dashed border-[var(--line)] p-8 text-center text-sm text-[var(--ink-4)]">Loading…</p>
        ) : null}
        {!loading && intents.length === 0 ? (
          <div className="rounded-r4 border border-dashed border-[var(--line)] bg-[var(--surface)] p-10 text-center">
            <Sparkles className="mx-auto h-8 w-8 text-[var(--ink-4)]" />
            <p className="mt-3 text-sm font-bold text-[var(--ink)]">No intents in this view.</p>
            <p className="mt-1 text-xs text-[var(--ink-4)]">When a sales rep submits a selection, it shows up here.</p>
          </div>
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
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${sBadge.bg}`}>{sBadge.label}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${tBadge.bg}`}>{tBadge.label}</span>
                    {intent.referencesQuoteId ? <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-violet-800">Revises prior quote</span> : null}
                    {intent.lockedBy && intent.status === 'in_quote' ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-blue-800">
                        <Lock className="h-3 w-3" /> {intent.locker?.name || 'Locked'}
                      </span>
                    ) : null}
                  </div>
                  <Link href={`/dashboard/leads/${intent.leadId}`} className="mt-2 block text-lg font-bold text-[var(--ink)] hover:text-[var(--brand-700)]">
                    {intent.lead?.title || 'Lead'}
                  </Link>
                  <p className="text-xs text-[var(--ink-3)]">
                    {intent.customer?.name || '—'} · Sales: {intent.owner?.name || '—'} · {new Date(intent.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xl font-bold text-[var(--ink)]">{money(rowsTotal(rows))}</p>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--ink-5)]">{rows.length} rows</p>
                </div>
              </div>

              {intent.notes ? (
                <p className="mt-3 rounded-r3 bg-[var(--bg-soft)] p-3 text-xs leading-5 text-[var(--ink-3)] line-clamp-3">{intent.notes}</p>
              ) : null}

              <details className="mt-3 group">
                <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-widest text-[var(--ink-3)] hover:text-[var(--ink)]">
                  Show {rows.length} row{rows.length === 1 ? '' : 's'}
                </summary>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {rows.map((row: any, idx: number) => (
                    <div key={idx} className="rounded-r3 border border-[var(--line)] bg-[var(--bg-soft)]/40 p-3">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--brand-700)]">{row.area || 'General Selection'}</p>
                      <p className="mt-1 truncate text-sm font-bold text-[var(--ink)]">{row.name || row.sku || 'Item'}</p>
                      <p className="text-[10px] font-mono text-[var(--ink-4)]">{row.sku || ''} {row.brand ? `· ${row.brand}` : ''}</p>
                      <p className="mt-1 text-xs font-semibold text-[var(--ink-2)]">{row.qty || row.quantity || 0} {row.unit || row.uom || 'PC'} × {money(row.price || row.sellPrice || 0)}</p>
                    </div>
                  ))}
                </div>
              </details>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Link href={`/dashboard/intents/${intent.id}`} className="text-xs font-bold text-[var(--brand-700)] hover:underline">
                  Open intent →
                </Link>
                {showPickUp && isOfficeOrManager ? (
                  <Button size="sm" onClick={() => pickUp({ variables: { id: intent.id } })} disabled={pickingUp}>
                    <Hammer className="mr-1.5 h-3.5 w-3.5" /> Pick up
                  </Button>
                ) : null}
                {showBuild ? (
                  <Button size="sm" onClick={() => generate({ variables: { intentId: intent.id, note: 'Built from intent desk' } })} disabled={generating}>
                    {generating ? 'Generating…' : 'Build quote'}
                  </Button>
                ) : null}
                {showRelease ? (
                  <button type="button" onClick={() => release({ variables: { id: intent.id, force: !myLock } })} className="inline-flex h-8 items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2.5 text-[10px] font-bold uppercase tracking-widest text-blue-800 hover:bg-blue-100">
                    <Unlock className="h-3 w-3" /> Release
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </section>
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
      <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--ink-5)]">{label}</p>
      <p className={`text-2xl font-bold ${toneClass}`}>{value}</p>
    </div>
  );
}
