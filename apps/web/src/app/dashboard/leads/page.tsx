'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { gql, useMutation, useQuery } from '@apollo/client';
import {
  AlertTriangle, ArrowRight, Calendar as CalendarIcon, Check, ChevronDown, ClipboardList,
  Download, Edit3, FileText, LayoutDashboard, List as ListIcon, MoreVertical, Plus,
  RefreshCw, Search, TrendingUp, Trophy, Truck, Users, Wallet, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryErrorBanner } from '@/components/query-state';
import { HelpButton } from '@/components/help/help-button';
import { UserAvatar } from '@/components/user-avatar';

// ===========================================================================
// GraphQL
// ===========================================================================
const LEADS_BOARD = gql`
  query LeadsBoard($filters: LeadBoardFiltersInput) {
    leadsBoard(filters: $filters)
    users { id name role active }
  }
`;
const BULK_UPDATE = gql`
  mutation BulkUpdate($input: BulkUpdateLeadsInput!) {
    bulkUpdateLeads(input: $input)
  }
`;
const UPDATE_LEAD_STAGE = gql`
  mutation UpdateLeadStageBoard($id: ID!, $stage: String!) {
    updateLeadStage(id: $id, stage: $stage) { id stage }
  }
`;

// ===========================================================================
// Types & constants
// ===========================================================================
type Lead = {
  id: string;
  title: string;
  stage: string;
  source?: string | null;
  expectedValue: number;
  notes?: string | null;
  createdAt: string;
  lastContactAt?: string | null;
  lastActivityAt?: string | null;
  nextActionAt?: string | null;
  reopenedAt?: string | null;
  ageDays: number;
  health: 'good' | 'warn' | 'bad' | 'violet';
  customer: { id: string; name: string; city?: string; mobile?: string; gstNo?: string | null } | null;
  owner: { id: string; name: string; email?: string; role?: string; avatarUrl?: string | null } | null;
  substate: {
    kind: 'intent' | 'draft' | 'quote' | 'revising' | 'dispatch' | 'paid' | 'overdue';
    label: string;
    sub?: string;
    meta?: any;
  };
  intentCount: number;
  activeIntentCount: number;
  hasRevision: boolean;
  quoteCount: number;
  headQuote: { id: string; quoteNumber: string; versionNumber: number; status: string } | null;
};

type ColumnMeta = { stage: string; count: number; totalValue: number; avgValue: number; oldestAgeDays: number };
type Kpis = { openValue: number; weightedForecast: number; wonThisMonth: number; staleCount: number; leadCount: number };

const STAGES = [
  { id: 'new', label: 'New', accent: 'from-slate-400 to-slate-500', barWidth: '12%' },
  { id: 'contacted', label: 'Contacted', accent: 'from-sky-400 to-sky-600', barWidth: '28%' },
  { id: 'quoted', label: 'Quoted', accent: 'from-amber-400 to-amber-600', barWidth: '55%' },
  { id: 'negotiation', label: 'Negotiation', accent: 'from-violet-400 to-violet-600', barWidth: '72%' },
  { id: 'won', label: 'Won', accent: 'from-emerald-400 to-emerald-700', barWidth: '100%' },
] as const;

const STAGE_WEIGHTS: Record<string, number> = {
  new: 0.1, contacted: 0.25, qualified: 0.4, proposal: 0.5, quoted: 0.55, negotiation: 0.75, won: 1, lost: 0,
};

const VIEWS = ['pipeline', 'list', 'forecast', 'calendar'] as const;
type View = (typeof VIEWS)[number];

// ===========================================================================
// Helpers
// ===========================================================================
function moneyShort(n: number) {
  const v = Number(n || 0);
  if (v >= 10000000) return `₹${(v / 10000000).toFixed(2)}Cr`;
  if (v >= 100000) return `₹${(v / 100000).toFixed(2)}L`;
  if (v >= 1000) return `₹${(v / 1000).toFixed(1)}k`;
  return `₹${v.toLocaleString('en-IN')}`;
}

function healthColor(h: Lead['health']) {
  switch (h) {
    case 'good': return 'bg-emerald-500 ring-emerald-100';
    case 'warn': return 'bg-amber-500 ring-amber-100';
    case 'bad': return 'bg-rose-500 ring-rose-100 animate-pulse';
    case 'violet': return 'bg-violet-500 ring-violet-100';
  }
}
function ageBadge(ageDays: number, reopened: boolean) {
  if (reopened) return { cls: 'bg-violet-50 text-violet-700 border-violet-200', label: 'reopened' };
  if (ageDays >= 8) return { cls: 'bg-rose-50 text-rose-700 border-rose-200', label: `${ageDays}d` };
  if (ageDays >= 4) return { cls: 'bg-amber-50 text-amber-800 border-amber-200', label: `${ageDays}d` };
  if (ageDays === 0) return { cls: 'bg-slate-50 text-slate-600 border-slate-200', label: 'today' };
  return { cls: 'bg-slate-50 text-slate-600 border-slate-200', label: `${ageDays}d` };
}

function substateIconTone(kind: Lead['substate']['kind']) {
  switch (kind) {
    case 'quote': return { bg: 'bg-emerald-100', fg: 'text-emerald-700', Icon: FileText };
    case 'intent': return { bg: 'bg-sky-100', fg: 'text-sky-700', Icon: ClipboardList };
    case 'draft': return { bg: 'bg-slate-100', fg: 'text-slate-600', Icon: Edit3 };
    case 'revising': return { bg: 'bg-violet-100', fg: 'text-violet-700', Icon: Edit3 };
    case 'dispatch': return { bg: 'bg-violet-100', fg: 'text-violet-700', Icon: Truck };
    case 'paid': return { bg: 'bg-emerald-100', fg: 'text-emerald-700', Icon: Check };
    case 'overdue': return { bg: 'bg-rose-100', fg: 'text-rose-700', Icon: AlertTriangle };
  }
}

function nextActionState(nextActionAt?: string | null) {
  if (!nextActionAt) return null;
  const due = new Date(nextActionAt);
  const ms = due.getTime() - Date.now();
  if (ms < -86400000) return { variant: 'overdue' as const, label: `Overdue by ${Math.floor(-ms / 86400000)} days` };
  if (ms < 0) return { variant: 'overdue' as const, label: 'Overdue today' };
  if (ms < 86400000) return { variant: 'today' as const, label: due.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) };
  if (ms < 86400000 * 2) return { variant: 'normal' as const, label: 'Follow up tomorrow' };
  return { variant: 'normal' as const, label: `Follow up ${due.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` };
}

// URL-hash backed filter state so refresh preserves the manager's view.
function useHashState() {
  const [hash, setHash] = useState<string>(() => (typeof window !== 'undefined' ? window.location.hash.slice(1) : ''));
  useEffect(() => {
    const handler = () => setHash(window.location.hash.slice(1));
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);
  const update = useCallback((next: Record<string, string | null>) => {
    const current = new URLSearchParams(hash);
    for (const [k, v] of Object.entries(next)) {
      if (v == null || v === '') current.delete(k);
      else current.set(k, v);
    }
    const newHash = current.toString();
    if (typeof window !== 'undefined') window.history.replaceState(null, '', `#${newHash}`);
    setHash(newHash);
  }, [hash]);
  const params = useMemo(() => new URLSearchParams(hash), [hash]);
  return { params, update };
}

// ===========================================================================
// Page
// ===========================================================================
export default function LeadPipelinePage() {
  const { params, update } = useHashState();
  const view = (params.get('view') as View) || 'pipeline';

  // Filter state — initialised from URL hash so refresh keeps the view.
  const [ownerId, setOwnerId] = useState(params.get('owner') || '');
  const [source, setSource] = useState(params.get('source') || '');
  const [city, setCity] = useState(params.get('city') || '');
  const [valueBand, setValueBand] = useState(params.get('value') || '');
  const [search, setSearch] = useState(params.get('q') || '');
  const [pillFilters, setPillFilters] = useState({
    mine: params.get('mine') === '1',
    stale: params.get('stale') === '1',
    reopened: params.get('reopened') === '1',
    hasRevision: params.get('rev') === '1',
  });

  // Persist any filter change back into the URL hash.
  useEffect(() => {
    update({
      view,
      owner: ownerId || null,
      source: source || null,
      city: city || null,
      value: valueBand || null,
      q: search.trim() || null,
      mine: pillFilters.mine ? '1' : null,
      stale: pillFilters.stale ? '1' : null,
      reopened: pillFilters.reopened ? '1' : null,
      rev: pillFilters.hasRevision ? '1' : null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId, source, city, valueBand, search, pillFilters, view]);

  const [me, setMe] = useState<any>(null);
  useEffect(() => {
    try { setMe(JSON.parse(localStorage.getItem('user') || 'null')); } catch { setMe(null); }
  }, []);
  const isManager = ['admin', 'owner', 'sales_manager'].includes(me?.role || '');

  const valueRange = useMemo(() => {
    switch (valueBand) {
      case 'sub_1l': return { valueMin: 0, valueMax: 100000 };
      case '1l_5l': return { valueMin: 100000, valueMax: 500000 };
      case '5l_10l': return { valueMin: 500000, valueMax: 1000000 };
      case '10l_plus': return { valueMin: 1000000, valueMax: null };
      default: return { valueMin: null, valueMax: null };
    }
  }, [valueBand]);

  const filters = useMemo(() => ({
    ownerId: pillFilters.mine ? me?.id : (ownerId || null),
    source: source || null,
    city: city || null,
    valueMin: valueRange.valueMin,
    valueMax: valueRange.valueMax,
    search: search.trim() || null,
    ageBucket: pillFilters.stale ? 'stale' : null,
    reopenedOnly: pillFilters.reopened || null,
    hasRevision: pillFilters.hasRevision || null,
  }), [pillFilters, ownerId, source, city, valueRange, search, me?.id]);

  const { data, loading, error, refetch } = useQuery(LEADS_BOARD, {
    variables: { filters },
    pollInterval: 60000,
    fetchPolicy: 'cache-and-network',
  });
  const board = data?.leadsBoard;
  const users = useMemo(() => data?.users || [], [data?.users]);
  const kpis: Kpis = board?.kpis || { openValue: 0, weightedForecast: 0, wonThisMonth: 0, staleCount: 0, leadCount: 0 };
  const columns: ColumnMeta[] = useMemo(() => board?.columns || [], [board?.columns]);
  const leads: Lead[] = useMemo(() => board?.leads || [], [board?.leads]);

  const [bulkUpdate, { loading: bulking }] = useMutation(BULK_UPDATE, { onCompleted: () => { setSelected(new Set()); refetch(); } });
  const [updateLeadStage] = useMutation(UPDATE_LEAD_STAGE);

  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggleSelect = (id: string, event?: React.MouseEvent) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    event?.stopPropagation();
  };

  // Distinct source + city for dropdowns
  const distinctSources = useMemo(() => {
    const set = new Set<string>();
    for (const l of leads) if (l.source) set.add(l.source);
    return Array.from(set).sort();
  }, [leads]);
  const distinctCities = useMemo(() => {
    const set = new Set<string>();
    for (const l of leads) if (l.customer?.city) set.add(l.customer.city);
    return Array.from(set).sort();
  }, [leads]);

  // ----- Drag-and-drop -----
  // We hold three pieces of state for buttery-smooth UX:
  //  - dragLeadRef: the live cursor target id (synchronous, survives re-renders)
  //  - draggingId: drives source-card "lifted" styling
  //  - stageOverride: optimistic stage update so the card jumps columns
  //    immediately on drop; cleared when the network refetch returns the
  //    server-truth payload.
  const dragLeadRef = useRef<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const [stageOverride, setStageOverride] = useState<Record<string, string>>({});

  const handleDragStart = (id: string, e: React.DragEvent) => {
    dragLeadRef.current = id;
    setDraggingId(id);
    // The native drag image is a snapshot of the element. Force-trigger that
    // snapshot from the current card visuals (gives a clean translucent ghost
    // that follows the cursor) and tell the browser this is a move.
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
    }
  };
  const handleDragEnd = () => {
    dragLeadRef.current = null;
    setDraggingId(null);
    setDragOverStage(null);
  };
  const handleDrop = async (stage: string) => {
    const id = dragLeadRef.current;
    dragLeadRef.current = null;
    setDraggingId(null);
    setDragOverStage(null);
    if (!id) return;
    const lead = leads.find((l) => l.id === id);
    if (!lead || lead.stage === stage) return;
    // Optimistic stage update — card visually lands in the new column instantly.
    setStageOverride((prev) => ({ ...prev, [id]: stage }));
    try {
      await updateLeadStage({ variables: { id, stage } });
      const result = await refetch();
      const freshLeads: Lead[] = result.data?.leadsBoard?.leads || [];
      setStageOverride((prev) => {
        const next = { ...prev };
        for (const [lid, st] of Object.entries(prev)) {
          const fresh = freshLeads.find((l) => l.id === lid);
          if (fresh && fresh.stage === st) delete next[lid];
        }
        return next;
      });
    } catch {
      // Roll back the optimistic update on failure.
      setStageOverride((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  // Leads after applying any optimistic stage override.
  const renderedLeads = useMemo(() => {
    if (!Object.keys(stageOverride).length) return leads;
    return leads.map((lead) => stageOverride[lead.id] ? { ...lead, stage: stageOverride[lead.id] } : lead);
  }, [leads, stageOverride]);

  const onKpiClick = (key: 'stale' | 'open' | 'forecast' | 'won') => {
    if (key === 'stale') setPillFilters((f) => ({ ...f, stale: !f.stale }));
    if (key === 'won') update({ view: 'list' });
  };

  const resetFilters = () => {
    setOwnerId(''); setSource(''); setCity(''); setValueBand(''); setSearch('');
    setPillFilters({ mine: false, stale: false, reopened: false, hasRevision: false });
  };

  const onExportSelection = () => {
    const rows = leads.filter((l) => selected.has(l.id));
    const csv = ['Lead,Customer,City,Owner,Stage,Value,Age,Substate'].concat(rows.map((l) => [
      JSON.stringify(l.title || ''),
      JSON.stringify(l.customer?.name || ''),
      JSON.stringify(l.customer?.city || ''),
      JSON.stringify(l.owner?.name || ''),
      l.stage,
      l.expectedValue,
      l.ageDays,
      JSON.stringify(l.substate?.label || ''),
    ].join(','))).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <div className="space-y-4 pb-28">
      {/* Action row */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-xl border border-[var(--line)] bg-[var(--surface)] p-1 shadow-sm-soft">
          <ViewTab active={view === 'pipeline'} onClick={() => update({ view: 'pipeline' })} icon={LayoutDashboard} label="Pipeline" />
          <ViewTab active={view === 'list'} onClick={() => update({ view: 'list' })} icon={ListIcon} label="List" />
          <ViewTab active={view === 'forecast'} onClick={() => update({ view: 'forecast' })} icon={TrendingUp} label="Forecast" />
          <ViewTab active={view === 'calendar'} onClick={() => update({ view: 'calendar' })} icon={CalendarIcon} label="Calendar" />
        </div>
        <div className="flex items-center gap-2">
          <HelpButton topicId="leads" variant="inline" label="Help" />
          <Button asChild>
            <Link href="/dashboard/leads/new"><Plus className="mr-1.5 h-4 w-4" /> New lead</Link>
          </Button>
        </div>
      </div>

      {/* KPI strip */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile tone="blue" icon={Wallet} label="Open pipeline" value={moneyShort(kpis.openValue)}
          hint={`${leads.filter((l) => !['won', 'lost'].includes(l.stage)).length} active leads`} onClick={() => onKpiClick('open')} />
        <KpiTile tone="violet" icon={TrendingUp} label="Weighted forecast" value={moneyShort(kpis.weightedForecast)}
          hint="next 30 days" onClick={() => onKpiClick('forecast')} />
        <KpiTile tone="good" icon={Trophy} label="Won 30d" value={moneyShort(kpis.wonThisMonth)}
          hint="month-to-date receipts" onClick={() => onKpiClick('won')} />
        <KpiTile tone="bad" alert icon={AlertTriangle} label="Stale (7d+)" value={`${kpis.staleCount} leads`}
          hint={pillFilters.stale ? 'filter active · click to clear' : 'click to filter'} onClick={() => onKpiClick('stale')} />
      </section>

      {/* Filter bar */}
      <section className="sticky top-[64px] z-20 -mx-4 lg:-mx-8 border-y border-[var(--line)] bg-[var(--bg)]/95 px-4 py-3 backdrop-blur lg:px-8">
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect label="Owner" value={ownerId} onChange={setOwnerId}
            options={[{ value: '', label: 'All' }, ...users.filter((u: any) => u.active).map((u: any) => ({ value: u.id, label: u.name }))]} />
          <FilterSelect label="Source" value={source} onChange={setSource}
            options={[{ value: '', label: 'All' }, ...distinctSources.map((s) => ({ value: s, label: s }))]} />
          <FilterSelect label="Value" value={valueBand} onChange={setValueBand}
            options={[
              { value: '', label: 'Any' },
              { value: 'sub_1l', label: '< ₹1L' },
              { value: '1l_5l', label: '₹1–5L' },
              { value: '5l_10l', label: '₹5–10L' },
              { value: '10l_plus', label: '₹10L+' },
            ]} />
          <FilterSelect label="City" value={city} onChange={setCity}
            options={[{ value: '', label: 'All' }, ...distinctCities.map((c) => ({ value: c, label: c }))]} />
          <span className="hidden h-5 w-px bg-[var(--line)] sm:block" />
          <Pill active={pillFilters.mine} onClick={() => setPillFilters((f) => ({ ...f, mine: !f.mine }))} label="Mine" />
          <Pill active={pillFilters.stale} danger onClick={() => setPillFilters((f) => ({ ...f, stale: !f.stale }))} label="Stale" icon={AlertTriangle} />
          <Pill active={pillFilters.reopened} onClick={() => setPillFilters((f) => ({ ...f, reopened: !f.reopened }))} label="Reopened" />
          <Pill active={pillFilters.hasRevision} onClick={() => setPillFilters((f) => ({ ...f, hasRevision: !f.hasRevision }))} label="Has revision" />

          <div className="ml-auto flex items-center gap-2">
            <div className="flex h-9 items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2.5">
              <Search className="h-3.5 w-3.5 text-[var(--ink-4)]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Customer, project, mobile…"
                className="w-36 bg-transparent text-xs text-[var(--ink)] outline-none placeholder:text-[var(--ink-5)] sm:w-48"
              />
            </div>
            {(ownerId || source || city || valueBand || search || pillFilters.mine || pillFilters.stale || pillFilters.reopened || pillFilters.hasRevision) ? (
              <button type="button" onClick={resetFilters} className="text-[10px] font-bold uppercase tracking-widest text-[var(--ink-3)] hover:text-[var(--ink)]">Clear</button>
            ) : null}
            <button type="button" onClick={() => refetch()} className="grid h-9 w-9 place-items-center rounded-md border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-3)] hover:bg-[var(--bg-soft)]">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </section>

      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}

      {/* View body */}
      {view === 'pipeline' ? (
        <PipelineView leads={renderedLeads} columns={columns} loading={loading} selected={selected} onToggleSelect={toggleSelect}
          draggingId={draggingId} dragOverStage={dragOverStage} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragOverStage={setDragOverStage} onDrop={handleDrop} />
      ) : null}
      {view === 'list' ? (
        <ListView leads={renderedLeads} loading={loading} selected={selected} onToggleSelect={toggleSelect} />
      ) : null}
      {view === 'forecast' ? (
        <ForecastView leads={renderedLeads} kpis={kpis} columns={columns} />
      ) : null}
      {view === 'calendar' ? (
        <CalendarView leads={renderedLeads} />
      ) : null}

      {selected.size > 0 ? (
        <BulkBar
          count={selected.size}
          isManager={isManager}
          users={users.filter((u: any) => u.active)}
          onClear={() => setSelected(new Set())}
          onReassign={(uid) => bulkUpdate({ variables: { input: { ids: Array.from(selected), ownerId: uid } } })}
          onStage={(stage) => bulkUpdate({ variables: { input: { ids: Array.from(selected), stage } } })}
          onExport={onExportSelection}
          busy={bulking}
        />
      ) : null}
    </div>
  );
}

// ===========================================================================
// View tab
// ===========================================================================
function ViewTab({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: any; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'inline-flex items-center gap-1.5 rounded-lg bg-[var(--ink)] px-3 py-1.5 text-xs font-bold text-white shadow-sm'
          : 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-[var(--ink-3)] hover:text-[var(--ink)]'
      }
    >
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  );
}

// ===========================================================================
// KPI tile
// ===========================================================================
function KpiTile({ tone, icon: Icon, label, value, hint, alert, onClick }: {
  tone: 'blue' | 'violet' | 'good' | 'bad';
  icon: any;
  label: string;
  value: string;
  hint: string;
  alert?: boolean;
  onClick?: () => void;
}) {
  const toneMap = {
    blue: 'bg-[var(--brand-50)] text-[var(--brand-700)]',
    violet: 'bg-violet-50 text-violet-700',
    good: 'bg-emerald-50 text-emerald-700',
    bad: 'bg-rose-50 text-rose-700',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        `text-left rounded-r5 border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm-soft transition hover:-translate-y-0.5 hover:shadow-[0_18px_36px_-22px_rgba(15,23,42,0.35)] hover:border-[var(--line-strong)] ${
          alert ? 'ring-1 ring-rose-200 shadow-[0_10px_25px_-20px_rgba(220,38,38,0.4)]' : ''
        }`
      }
    >
      <div className="flex items-center gap-3">
        <div className={`grid h-10 w-10 place-items-center rounded-r3 ${toneMap[tone]}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--ink-4)]">{label}</p>
          <p className="text-xl font-bold leading-tight text-[var(--ink)]">{value}</p>
          <p className="text-[11px] text-[var(--ink-4)]">{hint}</p>
        </div>
      </div>
    </button>
  );
}

// ===========================================================================
// Filter components
// ===========================================================================
function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  const current = options.find((o) => o.value === value);
  return (
    <label className="relative inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1.5 text-xs font-semibold text-[var(--ink-2)] hover:border-[var(--line-strong)]">
      <span className="text-[var(--ink-4)]">{label}:</span>
      <span>{current?.label || 'All'}</span>
      <ChevronDown className="h-3 w-3 text-[var(--ink-4)]" />
      <select value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label={label}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

function Pill({ active, onClick, label, icon: Icon, danger }: { active: boolean; onClick: () => void; label: string; icon?: any; danger?: boolean }) {
  let cls = 'inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1.5 text-xs font-semibold text-[var(--ink-3)] hover:bg-[var(--bg-soft)]';
  if (active) {
    cls = danger
      ? 'inline-flex items-center gap-1.5 rounded-full border border-rose-600 bg-rose-600 px-2.5 py-1.5 text-xs font-semibold text-white'
      : 'inline-flex items-center gap-1.5 rounded-full border border-[var(--ink)] bg-[var(--ink)] px-2.5 py-1.5 text-xs font-semibold text-white';
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      {Icon ? <Icon className="h-3 w-3" /> : null}
      {label}
    </button>
  );
}

// ===========================================================================
// Pipeline view (kanban)
// ===========================================================================
function PipelineView({
  leads, columns, loading, selected, onToggleSelect,
  draggingId, dragOverStage, onDragStart, onDragEnd, onDragOverStage, onDrop,
}: {
  leads: Lead[];
  columns: ColumnMeta[];
  loading: boolean;
  selected: Set<string>;
  onToggleSelect: (id: string, e?: React.MouseEvent) => void;
  draggingId: string | null;
  dragOverStage: string | null;
  onDragStart: (id: string, e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOverStage: (stage: string | null) => void;
  onDrop: (stage: string) => void;
}) {
  const leadsByStage = useMemo(() => {
    const map = new Map<string, Lead[]>();
    for (const stage of STAGES) map.set(stage.id, []);
    for (const lead of leads) {
      const list = map.get(lead.stage) || [];
      list.push(lead);
      map.set(lead.stage, list);
    }
    return map;
  }, [leads]);

  const colMeta = (stage: string) => columns.find((c) => c.stage === stage) || { stage, count: 0, totalValue: 0, avgValue: 0, oldestAgeDays: 0 };

  return (
    <section className="overflow-x-auto pb-2">
      {/* Board fills the viewport below the header chrome; each column scrolls
          internally so the page itself doesn't grow with the dataset. */}
      <div className="grid min-w-max gap-3 sm:min-w-0 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
           style={{ height: 'calc(100vh - 320px)', minHeight: '460px' }}>
        {STAGES.map((stage) => {
          const stageLeads = leadsByStage.get(stage.id) || [];
          const meta = colMeta(stage.id);
          const isDragTarget = dragOverStage === stage.id;
          return (
            <div
              key={stage.id}
              className={`flex min-w-[280px] flex-col rounded-r5 border bg-[var(--surface)]/60 p-3 transition-all duration-200 ease-out sm:min-w-0 ${
                isDragTarget
                  ? 'border-[var(--brand-500)] bg-[var(--brand-50)]/60 shadow-[0_0_0_3px_var(--brand-100)]'
                  : 'border-[var(--line)]'
              }`}
              onDragOver={(e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; onDragOverStage(stage.id); }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) onDragOverStage(null);
              }}
              onDrop={() => onDrop(stage.id)}
            >
              {/* Fixed header — count + total/avg/oldest + stage bar */}
              <div className="px-1">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--ink-2)]">{stage.label}</h3>
                  <span className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-2 py-0.5 text-[10px] font-bold text-[var(--ink-3)]">{meta.count}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-[var(--ink-4)]">
                  <span><span className="font-bold text-[var(--ink-2)]">{moneyShort(meta.totalValue)}</span> total</span>
                  {meta.count > 0 ? <span>avg <span className="font-bold text-[var(--ink-2)]">{moneyShort(meta.avgValue)}</span></span> : null}
                  {meta.count > 0 ? <span>oldest <span className="font-bold text-[var(--ink-2)]">{meta.oldestAgeDays}d</span></span> : null}
                </div>
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--line)]">
                <span className={`block h-full bg-gradient-to-r ${stage.accent}`} style={{ width: stage.barWidth }} />
              </div>

              {/* Scrollable card list */}
              <div className="mt-3 flex-1 min-h-0 space-y-2 overflow-y-auto custom-scrollbar pr-1">
                {loading && stageLeads.length === 0 ? (
                  <>
                    <div className="h-32 animate-pulse rounded-r4 bg-[var(--bg-soft)]" />
                    <div className="h-32 animate-pulse rounded-r4 bg-[var(--bg-soft)]" />
                  </>
                ) : null}
                {!loading && stageLeads.length === 0 ? (
                  <div className="rounded-r4 border border-dashed border-[var(--line)] p-6 text-center text-xs font-semibold text-[var(--ink-5)]">No leads here</div>
                ) : null}
                {stageLeads.map((lead) => (
                  <LeadCard
                    key={lead.id}
                    lead={lead}
                    selected={selected.has(lead.id)}
                    dragging={draggingId === lead.id}
                    onToggleSelect={onToggleSelect}
                    onDragStart={onDragStart}
                    onDragEnd={onDragEnd}
                  />
                ))}
                {isDragTarget && draggingId ? (
                  <div
                    aria-hidden
                    className="rounded-r4 border-2 border-dashed border-[var(--brand-500)] bg-[var(--brand-50)]/70 p-3 text-center text-xs font-bold uppercase tracking-widest text-[var(--brand-700)] transition-all duration-200"
                  >
                    Drop to move here
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ===========================================================================
// Lead card
// ===========================================================================
function LeadCard({ lead, selected, dragging, onToggleSelect, onDragStart, onDragEnd }: {
  lead: Lead;
  selected: boolean;
  dragging: boolean;
  onToggleSelect: (id: string, e?: React.MouseEvent) => void;
  onDragStart: (id: string, e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const router = useRouter();
  const sub = lead.substate;
  const subTone = substateIconTone(sub.kind);
  const SubIcon = subTone.Icon;
  const age = ageBadge(lead.ageDays, !!lead.reopenedAt);
  const next = nextActionState(lead.nextActionAt);

  // Track that a drag actually happened so we can suppress the click navigation.
  const draggedRef = useRef(false);
  const handleClick = (e: React.MouseEvent) => {
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    // Cmd/Shift-click toggles selection instead of navigating.
    if (e.metaKey || e.shiftKey || e.ctrlKey) {
      onToggleSelect(lead.id, e);
      return;
    }
    router.push(`/dashboard/leads/${lead.id}`);
  };

  return (
    <article
      draggable
      role="button"
      tabIndex={0}
      aria-label={`Lead: ${lead.title}`}
      onClick={handleClick}
      onKeyDown={(e) => { if (e.key === 'Enter') router.push(`/dashboard/leads/${lead.id}`); }}
      onDragStart={(e) => { draggedRef.current = true; onDragStart(lead.id, e); }}
      onDragEnd={onDragEnd}
      data-dragging={dragging || undefined}
      className={`mp-lead-card group relative rounded-r4 border bg-[var(--surface)] p-3 shadow-[0_1px_0_rgba(15,23,42,0.02)] transition-[transform,box-shadow,opacity,border-color] duration-200 ease-out will-change-transform ${
        dragging
          ? 'cursor-grabbing scale-[0.97] -rotate-1 opacity-50 shadow-[0_25px_60px_-25px_rgba(15,23,42,0.55)] ring-2 ring-[var(--brand-200)]'
          : 'cursor-grab hover:-translate-y-0.5 hover:border-[var(--line-strong)] hover:shadow-[0_18px_36px_-22px_rgba(15,23,42,0.35)] active:cursor-grabbing active:scale-[0.99]'
      } ${
        selected && !dragging ? 'border-[var(--brand-600)] ring-2 ring-[var(--brand-100)]' : 'border-[var(--line)]'
      }`}
    >
      {/* Top row — checkbox at far left, customer name fills, ⋮ at far right.
          Checkbox slot is reserved even when invisible so the layout never shifts. */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={selected ? 'Deselect lead' : 'Select lead'}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleSelect(lead.id, e); }}
          onMouseDown={(e) => e.stopPropagation()}
          className={`grid h-4 w-4 shrink-0 place-items-center rounded border transition-opacity ${
            selected
              ? 'border-[var(--brand-600)] bg-[var(--brand-600)] text-white opacity-100'
              : 'border-[var(--line-strong)] bg-white opacity-0 group-hover:opacity-100 focus:opacity-100'
          }`}
        >
          {selected ? <Check className="h-2.5 w-2.5" /> : null}
        </button>
        <span className={`block h-2 w-2 shrink-0 rounded-full ring-2 ${healthColor(lead.health)}`} />
        <p className="min-w-0 flex-1 truncate text-[10px] font-bold uppercase tracking-wider text-[var(--ink)]">
          {lead.customer?.name || 'Customer'}
          {lead.customer?.city ? <span className="font-semibold normal-case tracking-normal text-[var(--ink-4)]"> · {lead.customer.city}</span> : null}
        </p>
        <button
          type="button"
          aria-label="More"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onMouseDown={(e) => e.stopPropagation()}
          className="grid h-5 w-5 shrink-0 place-items-center rounded text-[var(--ink-4)] hover:bg-[var(--bg-soft)] hover:text-[var(--ink-2)]"
        >
          <MoreVertical className="h-3.5 w-3.5" />
        </button>
      </div>

      <h4 className="mt-1.5 line-clamp-1 text-sm font-semibold text-[var(--ink)]">{lead.title}</h4>

      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-sm font-bold tracking-tight text-[var(--ink)]">{moneyShort(lead.expectedValue)}</p>
        <div className="flex items-center gap-1.5">
          {lead.owner ? <UserAvatar user={lead.owner as any} size="xs" /> : null}
          <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-bold ${age.cls}`}>{age.label}</span>
        </div>
      </div>

      <div className="my-2.5 border-b border-dashed border-[var(--line)]" />

      <div className="flex items-start gap-2">
        <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded ${subTone.bg} ${subTone.fg}`}>
          <SubIcon className="h-3 w-3" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-[var(--ink-2)]">{sub.label}</p>
          {sub.sub ? <p className="truncate text-[10px] text-[var(--ink-4)]">{sub.sub}</p> : null}
        </div>
      </div>

      {next ? (
        <div className={`mt-2 flex items-center gap-2 text-xs ${next.variant === 'overdue' ? 'text-rose-700' : 'text-[var(--ink-2)]'}`}>
          <span className={`grid h-5 w-5 shrink-0 place-items-center rounded ${
            next.variant === 'overdue' ? 'bg-rose-100 text-rose-700' : next.variant === 'today' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'
          }`}>
            {next.variant === 'overdue' ? <AlertTriangle className="h-3 w-3" /> : <CalendarIcon className="h-3 w-3" />}
          </span>
          <span className="font-semibold">{next.label}</span>
        </div>
      ) : null}
    </article>
  );
}

// ===========================================================================
// List view
// ===========================================================================
function ListView({ leads, loading, selected, onToggleSelect }: { leads: Lead[]; loading: boolean; selected: Set<string>; onToggleSelect: (id: string, e?: React.MouseEvent) => void }) {
  const [sortKey, setSortKey] = useState<'value' | 'age' | 'stage' | 'customer'>('age');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const sorted = useMemo(() => {
    const arr = [...leads];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'value': cmp = a.expectedValue - b.expectedValue; break;
        case 'age': cmp = a.ageDays - b.ageDays; break;
        case 'stage': cmp = a.stage.localeCompare(b.stage); break;
        case 'customer': cmp = (a.customer?.name || '').localeCompare(b.customer?.name || ''); break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [leads, sortKey, sortDir]);

  const setSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('desc'); }
  };

  const SortIndicator = ({ k }: { k: typeof sortKey }) => sortKey === k ? <span className="text-[var(--brand-600)]">{sortDir === 'asc' ? '↑' : '↓'}</span> : null;

  return (
    <section className="overflow-x-auto rounded-r5 border border-[var(--line)] bg-[var(--surface)] shadow-sm-soft">
      <table className="w-full min-w-[820px] text-sm">
        <thead className="border-b border-[var(--line)] text-left text-[10px] font-bold uppercase tracking-widest text-[var(--ink-4)]">
          <tr className="bg-[var(--bg-soft)]/40">
            <th className="w-8 px-3 py-2"></th>
            <th className="w-6"></th>
            <th className="cursor-pointer px-3" onClick={() => setSort('customer')}>Lead <SortIndicator k="customer" /></th>
            <th>City</th>
            <th>Owner</th>
            <th className="cursor-pointer" onClick={() => setSort('stage')}>Stage <SortIndicator k="stage" /></th>
            <th className="cursor-pointer text-right" onClick={() => setSort('value')}>Value <SortIndicator k="value" /></th>
            <th>Substate</th>
            <th className="cursor-pointer" onClick={() => setSort('age')}>Age <SortIndicator k="age" /></th>
            <th>Next action</th>
          </tr>
        </thead>
        <tbody>
          {loading && sorted.length === 0 ? (
            <tr><td colSpan={10} className="py-10 text-center text-sm text-[var(--ink-4)]">Loading…</td></tr>
          ) : null}
          {!loading && sorted.length === 0 ? (
            <tr><td colSpan={10} className="py-10 text-center text-sm text-[var(--ink-4)]">No leads match these filters.</td></tr>
          ) : null}
          {sorted.map((lead) => {
            const age = ageBadge(lead.ageDays, !!lead.reopenedAt);
            const next = nextActionState(lead.nextActionAt);
            return (
              <tr key={lead.id} className="border-b border-[var(--line)] last:border-0 hover:bg-[var(--bg-soft)]/30">
                <td className="px-3 py-2.5">
                  <button
                    type="button"
                    onClick={(e) => onToggleSelect(lead.id, e)}
                    className={`grid h-4 w-4 place-items-center rounded border ${selected.has(lead.id) ? 'border-[var(--brand-600)] bg-[var(--brand-600)] text-white' : 'border-[var(--line-strong)] bg-white'}`}
                  >
                    {selected.has(lead.id) ? <Check className="h-2.5 w-2.5" /> : null}
                  </button>
                </td>
                <td><span className={`block h-2 w-2 rounded-full ring-2 ${healthColor(lead.health)}`} /></td>
                <td className="px-3">
                  <Link href={`/dashboard/leads/${lead.id}`} className="font-semibold text-[var(--ink)] hover:text-[var(--brand-700)]">{lead.title}</Link>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--ink-5)]">{lead.customer?.name || '—'}</div>
                </td>
                <td className="text-xs text-[var(--ink-3)]">{lead.customer?.city || '—'}</td>
                <td className="text-xs text-[var(--ink-2)]">{lead.owner?.name || '—'}</td>
                <td><span className="text-xs font-bold capitalize text-[var(--ink)]">{lead.stage}</span></td>
                <td className="text-right text-sm font-bold text-[var(--ink)]">{moneyShort(lead.expectedValue)}</td>
                <td className="text-xs text-[var(--ink-3)]"><span className="font-semibold text-[var(--ink-2)]">{lead.substate?.label}</span></td>
                <td><span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-bold ${age.cls}`}>{age.label}</span></td>
                <td className="text-xs">
                  {next ? <span className={next.variant === 'overdue' ? 'font-bold text-rose-700' : 'text-[var(--ink-2)]'}>{next.label}</span> : <span className="text-[var(--ink-5)]">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

// ===========================================================================
// Forecast view
// ===========================================================================
function ForecastView({ leads, kpis, columns }: { leads: Lead[]; kpis: Kpis; columns: ColumnMeta[] }) {
  const openLeads = leads.filter((l) => !['won', 'lost'].includes(l.stage));
  const byStage = STAGES.map((stage) => {
    const inStage = openLeads.filter((l) => l.stage === stage.id);
    const total = inStage.reduce((s, l) => s + Number(l.expectedValue || 0), 0);
    const weight = STAGE_WEIGHTS[stage.id] || 0;
    return { ...stage, total, weighted: total * weight, weight };
  }).filter((s) => s.id !== 'won');
  const maxTotal = Math.max(1, ...byStage.map((s) => s.total));
  const top5 = [...openLeads].sort((a, b) => b.expectedValue - a.expectedValue).slice(0, 5);

  return (
    <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <div className="rounded-r5 border border-[var(--line)] bg-[var(--surface)] p-6 shadow-sm-soft">
        <p className="text-[10px] font-bold uppercase tracking-widest text-violet-700">Stage-weighted</p>
        <p className="mt-1 text-4xl font-bold tracking-tight text-[var(--ink)]">{moneyShort(kpis.weightedForecast)}</p>
        <p className="text-xs text-[var(--ink-3)]">expected next 30 days · {openLeads.length} active leads</p>

        <div className="mt-6 space-y-3">
          {byStage.map((s) => (
            <div key={s.id}>
              <div className="flex items-center justify-between text-xs">
                <p className="font-bold capitalize text-[var(--ink-2)]">{s.label} <span className="font-normal text-[var(--ink-5)]">· {Math.round(s.weight * 100)}%</span></p>
                <p className="font-bold text-[var(--ink)]">{moneyShort(s.weighted)} <span className="font-normal text-[var(--ink-5)]">/ {moneyShort(s.total)}</span></p>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-[var(--bg-soft)]">
                <span className={`block h-full bg-gradient-to-r ${s.accent}`} style={{ width: `${Math.min(100, (s.total / maxTotal) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-r5 border border-[var(--line)] bg-[var(--surface)] p-6 shadow-sm-soft">
        <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--ink-3)]">Top 5 open deals</h3>
        <ul className="mt-3 space-y-2">
          {top5.length === 0 ? <li className="rounded-r3 border border-dashed border-[var(--line)] p-4 text-center text-xs text-[var(--ink-5)]">No open deals.</li> : null}
          {top5.map((lead) => (
            <li key={lead.id}>
              <Link href={`/dashboard/leads/${lead.id}`} className="flex items-center justify-between gap-3 rounded-r3 border border-[var(--line)] bg-[var(--bg-soft)]/40 p-3 hover:bg-[var(--bg-soft)]">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-[var(--ink)]">{lead.title}</p>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--ink-5)]">{lead.customer?.name} · {lead.stage}</p>
                </div>
                <p className="shrink-0 text-sm font-bold text-[var(--ink)]">{moneyShort(lead.expectedValue)}</p>
              </Link>
            </li>
          ))}
        </ul>

        <h3 className="mt-6 text-xs font-bold uppercase tracking-widest text-[var(--ink-3)]">Stage breakdown</h3>
        <ul className="mt-3 space-y-1.5">
          {columns.map((col) => (
            <li key={col.stage} className="flex items-center justify-between text-xs">
              <p className="font-semibold capitalize text-[var(--ink-2)]">{col.stage}</p>
              <p className="text-[var(--ink-3)]">{col.count} · {moneyShort(col.totalValue)}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ===========================================================================
// Calendar view
// ===========================================================================
function CalendarView({ leads }: { leads: Lead[] }) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const today = new Date();

  const monthLeads = useMemo(() => {
    const map = new Map<string, Lead[]>();
    for (const lead of leads) {
      if (!lead.nextActionAt) continue;
      const d = new Date(lead.nextActionAt);
      if (d.getFullYear() !== cursor.getFullYear() || d.getMonth() !== cursor.getMonth()) continue;
      const key = d.toISOString().slice(0, 10);
      const list = map.get(key) || [];
      list.push(lead);
      map.set(key, list);
    }
    return map;
  }, [leads, cursor]);

  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const firstWeekday = new Date(cursor.getFullYear(), cursor.getMonth(), 1).getDay();
  const cells: Array<{ day: number | null }> = [];
  for (let i = 0; i < firstWeekday; i++) cells.push({ day: null });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d });
  while (cells.length % 7 !== 0) cells.push({ day: null });

  const monthLabel = cursor.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const stageAccent = (stage: string) => STAGES.find((s) => s.id === stage)?.accent || 'from-slate-400 to-slate-500';

  return (
    <section className="rounded-r5 border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm-soft">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-base font-bold text-[var(--ink)]">{monthLabel}</h3>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs font-bold text-[var(--ink-2)] hover:bg-[var(--bg-soft)]">←</button>
          <button type="button" onClick={() => { const t = new Date(); setCursor(new Date(t.getFullYear(), t.getMonth(), 1)); }} className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs font-bold text-[var(--ink-2)] hover:bg-[var(--bg-soft)]">Today</button>
          <button type="button" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs font-bold text-[var(--ink-2)] hover:bg-[var(--bg-soft)]">→</button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-[10px] font-bold uppercase tracking-widest text-[var(--ink-4)]">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="px-1.5 py-1">{d}</div>)}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((cell, idx) => {
          if (cell.day == null) return <div key={idx} className="min-h-[88px] rounded-r3 bg-[var(--bg-soft)]/30" />;
          const date = new Date(cursor.getFullYear(), cursor.getMonth(), cell.day);
          const key = date.toISOString().slice(0, 10);
          const list = monthLeads.get(key) || [];
          const isToday = date.toDateString() === today.toDateString();
          return (
            <div key={idx} className={`min-h-[88px] rounded-r3 border p-1.5 ${isToday ? 'border-[var(--brand-600)] bg-[var(--brand-50)]/30' : 'border-[var(--line)] bg-[var(--surface)]'}`}>
              <p className={`text-[10px] font-bold ${isToday ? 'text-[var(--brand-700)]' : 'text-[var(--ink-3)]'}`}>{cell.day}</p>
              <div className="mt-1 space-y-1">
                {list.slice(0, 3).map((lead) => (
                  <Link key={lead.id} href={`/dashboard/leads/${lead.id}`} className="block">
                    <span className={`block truncate rounded-sm px-1 text-[10px] font-semibold text-white bg-gradient-to-r ${stageAccent(lead.stage)}`} title={lead.title}>
                      {lead.title}
                    </span>
                  </Link>
                ))}
                {list.length > 3 ? <p className="px-1 text-[10px] font-bold text-[var(--ink-4)]">+{list.length - 3} more</p> : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ===========================================================================
// Bulk bar
// ===========================================================================
function BulkBar({ count, isManager, users, onClear, onReassign, onStage, onExport, busy }: {
  count: number;
  isManager: boolean;
  users: any[];
  onClear: () => void;
  onReassign: (uid: string) => void;
  onStage: (stage: string) => void;
  onExport: () => void;
  busy: boolean;
}) {
  const [reassignOpen, setReassignOpen] = useState(false);
  const [stageOpen, setStageOpen] = useState(false);

  return (
    <div role="region" aria-label="Bulk actions" className="fixed bottom-5 left-1/2 z-40 -translate-x-1/2 rounded-r5 bg-[#0f172a] px-3 py-2.5 text-white shadow-[0_24px_60px_-20px_rgba(15,23,42,0.55)]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-[var(--brand-600)] px-2.5 py-1 text-xs font-bold">{count} selected</span>

        {isManager ? (
          <div className="relative">
            <button type="button" onClick={() => setReassignOpen((v) => !v)} className="inline-flex items-center gap-1.5 rounded-md bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20">
              <Users className="h-3 w-3" /> Reassign owner
            </button>
            {reassignOpen ? (
              <div className="absolute bottom-full left-0 mb-2 max-h-72 w-56 overflow-y-auto rounded-r3 border border-white/10 bg-[#1e293b] p-1 shadow-2xl">
                {users.map((u: any) => (
                  <button key={u.id} type="button" onClick={() => { onReassign(u.id); setReassignOpen(false); }} className="block w-full rounded-md px-3 py-1.5 text-left text-xs font-semibold text-white hover:bg-white/10">
                    {u.name} <span className="font-normal text-white/50">· {u.role?.replace('_', ' ')}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {isManager ? (
          <div className="relative">
            <button type="button" onClick={() => setStageOpen((v) => !v)} className="inline-flex items-center gap-1.5 rounded-md bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20">
              <ArrowRight className="h-3 w-3" /> Move stage
            </button>
            {stageOpen ? (
              <div className="absolute bottom-full left-0 mb-2 w-44 rounded-r3 border border-white/10 bg-[#1e293b] p-1 shadow-2xl">
                {STAGES.map((s) => (
                  <button key={s.id} type="button" onClick={() => { onStage(s.id); setStageOpen(false); }} className="block w-full rounded-md px-3 py-1.5 text-left text-xs font-semibold capitalize text-white hover:bg-white/10">
                    {s.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <button type="button" onClick={onExport} className="inline-flex items-center gap-1.5 rounded-md bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20">
          <Download className="h-3 w-3" /> Export CSV
        </button>

        <button type="button" onClick={onClear} aria-label="Clear" className="rounded-md p-1.5 text-white/60 hover:text-white">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {busy ? <p className="mt-1 text-[10px] text-white/70">Saving…</p> : null}
    </div>
  );
}
