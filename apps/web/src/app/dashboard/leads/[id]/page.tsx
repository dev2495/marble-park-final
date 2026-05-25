'use client';

import { gql, useMutation, useQuery } from '@apollo/client';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Check, ChevronDown, ChevronRight, ClipboardList, Clock, FileText, Hammer,
  History, Inbox, Lock, MessageCircle, Package, PenLine, Phone, Plus, RefreshCw, Send,
  ShoppingBag, Sparkles, Truck, Unlock, UserRound, Wallet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryErrorBanner } from '@/components/query-state';
import { UserAvatar } from '@/components/user-avatar';

const LEAD_TIMELINE = gql`
  query LeadTimeline($id: ID!) {
    leadTimeline(id: $id)
  }
`;

const START_REVISION = gql`
  mutation StartRevision($quoteId: String!) {
    startQuoteRevision(quoteId: $quoteId)
  }
`;

const CREATE_INTENT = gql`
  mutation NewIntent($input: CreateIntentInputDto!) {
    createIntent(input: $input)
  }
`;

const SUBMIT_INTENT = gql`
  mutation SubmitIntent($id: ID!) {
    submitIntent(id: $id)
  }
`;

const CANCEL_INTENT = gql`
  mutation CancelIntent($id: ID!, $reason: String) {
    cancelIntent(id: $id, reason: $reason)
  }
`;

const REQUEST_CHANGES = gql`
  mutation RequestChanges($id: ID!, $message: String) {
    requestIntentChanges(id: $id, message: $message)
  }
`;

const PICK_UP_INTENT = gql`
  mutation PickUp($id: ID!) {
    pickUpIntent(id: $id)
  }
`;

const RELEASE_INTENT = gql`
  mutation Release($id: ID!, $force: Boolean) {
    releaseIntent(id: $id, force: $force)
  }
`;

const GENERATE_QUOTE = gql`
  mutation Generate($intentId: String!, $note: String, $displayMode: String) {
    generateQuoteFromIntent(intentId: $intentId, note: $note, displayMode: $displayMode)
  }
`;

function money(n: number | string) {
  return `₹${Math.round(Number(n || 0)).toLocaleString('en-IN')}`;
}

function quoteTotal(lines: any) {
  return (Array.isArray(lines) ? lines : []).reduce(
    (s: number, l: any) => s + Number(l.qty || l.quantity || 0) * Number(l.price || l.sellPrice || 0),
    0,
  );
}

function intentStatusBadge(status: string) {
  switch (status) {
    case 'draft':
      return { bg: 'bg-slate-100 text-slate-700', label: 'Draft' };
    case 'pending_quote':
      return { bg: 'bg-amber-100 text-amber-800', label: 'Pending quote' };
    case 'in_quote':
      return { bg: 'bg-blue-100 text-blue-800', label: 'Office building quote' };
    case 'converted':
      return { bg: 'bg-emerald-100 text-emerald-800', label: 'Quote built' };
    case 'cancelled':
      return { bg: 'bg-rose-100 text-rose-700', label: 'Cancelled' };
    // Legacy values from older code paths.
    case 'quoted':
      return { bg: 'bg-emerald-100 text-emerald-800', label: 'Quote built' };
    default:
      return { bg: 'bg-slate-100 text-slate-700', label: status };
  }
}

function intentTypeLabel(type: string) {
  switch (type) {
    case 'initial':
      return 'Initial selection';
    case 'revision':
      return 'Revision of quote';
    case 'followup':
      return 'Follow-up purchase';
    case 'replacement':
      return 'Replacement';
    default:
      return type;
  }
}

function quoteStatusBadge(status: string) {
  switch (status) {
    case 'draft':
      return { bg: 'bg-slate-100 text-slate-700', label: 'Draft' };
    case 'sent':
      return { bg: 'bg-blue-100 text-blue-800', label: 'Sent' };
    case 'approved':
      return { bg: 'bg-emerald-100 text-emerald-800', label: 'Approved' };
    case 'confirmed':
      return { bg: 'bg-emerald-100 text-emerald-800', label: 'Confirmed' };
    case 'won':
      return { bg: 'bg-emerald-200 text-emerald-900', label: 'Won' };
    case 'lost':
      return { bg: 'bg-rose-100 text-rose-700', label: 'Lost' };
    case 'superseded':
      return { bg: 'bg-slate-100 text-slate-500 line-through', label: 'Superseded' };
    case 'expired':
      return { bg: 'bg-slate-100 text-slate-500', label: 'Expired' };
    default:
      return { bg: 'bg-slate-100 text-slate-700', label: status };
  }
}

export default function LeadDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id || '';
  const { data, loading, error, refetch } = useQuery(LEAD_TIMELINE, { variables: { id }, fetchPolicy: 'cache-and-network', skip: !id });

  const [startRevision, { loading: revising, error: reviseError }] = useMutation(START_REVISION, {
    onCompleted: (data) => {
      const intent = data?.startQuoteRevision;
      if (intent?.id) router.push(`/dashboard/intents/${intent.id}`);
    },
  });
  const [createIntent, { loading: creating, error: createError }] = useMutation(CREATE_INTENT, {
    onCompleted: (data) => {
      const intent = data?.createIntent;
      if (intent?.id) router.push(`/dashboard/intents/${intent.id}`);
    },
  });
  const [submitIntent] = useMutation(SUBMIT_INTENT, { onCompleted: () => refetch() });
  const [cancelIntent] = useMutation(CANCEL_INTENT, { onCompleted: () => refetch() });
  const [requestChanges] = useMutation(REQUEST_CHANGES);
  const [pickUpIntent] = useMutation(PICK_UP_INTENT, { onCompleted: () => refetch() });
  const [releaseIntent] = useMutation(RELEASE_INTENT, { onCompleted: () => refetch() });
  const [generateQuote, { loading: generating, error: generateError }] = useMutation(GENERATE_QUOTE, { onCompleted: () => refetch() });

  const [me, setMe] = useState<any>(null);
  useEffect(() => {
    try {
      setMe(JSON.parse(localStorage.getItem('user') || 'null'));
    } catch {
      setMe(null);
    }
  }, []);

  const timeline = data?.leadTimeline;
  const lead = timeline?.lead;
  const entries: any[] = timeline?.entries || [];
  const chains: any[] = timeline?.chains || [];
  const inFlight = timeline?.inFlight || { activeIntents: [], activeQuotes: [] };

  const mutationError = createError || reviseError || generateError;

  if (loading && !lead) return <div className="p-10 text-sm font-bold text-[var(--ink-3)]">Loading lead…</div>;
  if (error && !lead) return <div className="p-6"><QueryErrorBanner error={error} onRetry={() => refetch()} /></div>;
  if (!lead) return <div className="p-10 text-sm font-bold text-[var(--ink-3)]">Lead not found.</div>;

  const role = me?.role || '';
  const isOfficeOrManager = ['admin', 'owner', 'sales_manager', 'office_staff'].includes(role);
  const isManager = ['admin', 'owner', 'sales_manager'].includes(role);

  const handleNewRound = async (intentType: 'followup' | 'initial' = 'followup') => {
    const r = await createIntent({
      variables: {
        input: {
          leadId: id,
          rows: [],
          notes: '',
          intentType,
          followUpReason: intentType === 'followup' ? 'New round on this project' : null,
          submit: false,
        },
      },
    });
    if (!r.data?.createIntent?.id) refetch();
  };

  return (
    <div className="space-y-5 pb-12">
      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
      {mutationError ? <QueryErrorBanner error={mutationError} /> : null}

      {/* Sticky hero — customer + project + state + actions */}
      <section className="sticky top-[64px] z-10 -mx-4 lg:-mx-8 border-b border-[var(--line)] bg-[var(--surface)]/95 px-4 py-4 backdrop-blur lg:px-8">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <Link href="/dashboard/leads" className="mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-3)] hover:bg-[var(--bg-soft)]">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--ink-5)]">Project</p>
                <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest capitalize ${lead.stage === 'won' ? 'bg-emerald-100 text-emerald-800' : lead.stage === 'lost' ? 'bg-rose-100 text-rose-700' : 'bg-blue-100 text-blue-800'}`}>
                  {lead.stage}
                </span>
                {lead.reopenedAt ? (
                  <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-violet-800">Reopened</span>
                ) : null}
              </div>
              <h1 className="mt-1 truncate text-xl font-bold tracking-tight text-[var(--ink)] sm:text-2xl">{lead.title}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--ink-3)]">
                <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--ink-2)]">
                  <UserRound className="h-3.5 w-3.5" /> {lead.customer?.name || '—'}
                </span>
                {lead.customer?.mobile ? (
                  <span className="inline-flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" /> {lead.customer.mobile}</span>
                ) : null}
                <span>Sales: <span className="font-semibold text-[var(--ink-2)]">{lead.owner?.name}</span></span>
              </div>
            </div>
          </div>
          <div className="hidden lg:flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => handleNewRound('followup')} disabled={creating}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> New round
            </Button>
          </div>
        </div>

        {/* Mobile bar */}
        <div className="mt-3 flex gap-2 lg:hidden">
          <Button size="sm" variant="outline" className="flex-1" onClick={() => handleNewRound('followup')} disabled={creating}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> New round
          </Button>
        </div>
      </section>

      {/* In flight section */}
      {(inFlight.activeIntents.length > 0 || inFlight.activeQuotes.length > 0) ? (
        <section className="rounded-r5 border border-amber-200 bg-amber-50/60 p-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-700" />
            <h2 className="text-xs font-bold uppercase tracking-widest text-amber-900">Currently in flight</h2>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {inFlight.activeIntents.map((intent: any) => {
              const badge = intentStatusBadge(intent.status);
              return (
                <Link
                  key={intent.id}
                  href={`/dashboard/intents/${intent.id}`}
                  className="rounded-r4 border border-[var(--line)] bg-white/85 p-3 hover:bg-[var(--bg-soft)]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-bold uppercase tracking-widest text-[var(--ink-5)]">{intentTypeLabel(intent.intentType)}</p>
                      <p className="mt-0.5 text-sm font-bold text-[var(--ink)]">{Array.isArray(intent.rows) ? intent.rows.length : 0} rows · {money(quoteTotal(intent.rows))}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${badge.bg}`}>{badge.label}</span>
                  </div>
                  {intent.lockedBy ? (
                    <p className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-blue-800"><Lock className="h-3 w-3" /> Locked by staff</p>
                  ) : null}
                </Link>
              );
            })}
            {inFlight.activeQuotes.map((quote: any) => {
              const badge = quoteStatusBadge(quote.status);
              return (
                <Link
                  key={quote.id}
                  href={`/dashboard/quotes/${quote.id}`}
                  className="rounded-r4 border border-[var(--line)] bg-white/85 p-3 hover:bg-[var(--bg-soft)]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-bold uppercase tracking-widest text-[var(--ink-5)]">{quote.quoteNumber} <span className="text-[var(--brand-700)]">v{quote.versionNumber || 1}</span></p>
                      <p className="mt-0.5 text-sm font-bold text-[var(--ink)]">{money(quoteTotal(quote.lines))}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${badge.bg}`}>{badge.label}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Quote chains */}
      {chains.length ? (
        <section className="rounded-r5 border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm-soft">
          <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--ink-3)]">Quote versions</h2>
          <div className="mt-3 space-y-3">
            {chains.map((chain: any) => (
              <QuoteChainCard key={chain.headQuoteId} chain={chain} onRevise={(qid) => startRevision({ variables: { quoteId: qid } })} revising={revising} />
            ))}
          </div>
        </section>
      ) : null}

      {/* Unified timeline */}
      <section className="rounded-r5 border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm-soft">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--ink-3)]">Timeline</h2>
          <p className="text-[10px] font-semibold text-[var(--ink-5)]">{entries.length} entries</p>
        </div>

        <div className="mt-4 relative">
          <div aria-hidden className="pointer-events-none absolute left-[12px] top-0 bottom-0 hidden w-px bg-[var(--line)] sm:block" />
          <ul className="space-y-3">
            {entries.length === 0 ? (
              <li className="rounded-r4 border border-dashed border-[var(--line)] p-6 text-center text-sm text-[var(--ink-4)]">No activity yet on this lead.</li>
            ) : null}
            {entries.map((entry: any) => (
              <li key={entry.id} className="relative sm:pl-9">
                <span aria-hidden className="absolute left-0 top-2 hidden h-6 w-6 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--surface)] sm:flex">
                  <TimelineDot kind={entry.kind} />
                </span>
                <TimelineCard
                  entry={entry}
                  lead={lead}
                  me={me}
                  isOfficeOrManager={isOfficeOrManager}
                  isManager={isManager}
                  onSubmit={(id) => submitIntent({ variables: { id } })}
                  onCancel={(id) => cancelIntent({ variables: { id, reason: 'Cancelled from timeline' } })}
                  onPickUp={(id) => pickUpIntent({ variables: { id } })}
                  onRelease={(id, force) => releaseIntent({ variables: { id, force: !!force } })}
                  onRequestChanges={(id, msg) => requestChanges({ variables: { id, message: msg } })}
                  onGenerate={(id) => generateQuote({ variables: { intentId: id, note: 'Generated from timeline' } })}
                  generating={generating}
                  onRevise={(qid) => startRevision({ variables: { quoteId: qid } })}
                  revising={revising}
                />
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}

function TimelineDot({ kind }: { kind: string }) {
  switch (kind) {
    case 'intent':
      return <ClipboardList className="h-3 w-3 text-blue-700" />;
    case 'quote':
      return <FileText className="h-3 w-3 text-emerald-700" />;
    case 'communication':
      return <MessageCircle className="h-3 w-3 text-violet-700" />;
    case 'followup':
      return <Clock className="h-3 w-3 text-amber-700" />;
    case 'dispatch_job':
    case 'challan':
      return <Truck className="h-3 w-3 text-sky-700" />;
    case 'order':
      return <ShoppingBag className="h-3 w-3 text-emerald-700" />;
    case 'payment_receipt':
      return <Wallet className="h-3 w-3 text-emerald-700" />;
    case 'return_order':
      return <Package className="h-3 w-3 text-rose-700" />;
    default:
      return <History className="h-3 w-3 text-[var(--ink-4)]" />;
  }
}

function QuoteChainCard({ chain, onRevise, revising }: { chain: any; onRevise: (id: string) => void; revising: boolean }) {
  const head = chain.versions[chain.versions.length - 1];
  const [expanded, setExpanded] = useState(false);
  const olderVersions = chain.versions.slice(0, -1);
  return (
    <div className="rounded-r4 border border-[var(--line)] bg-[var(--bg-soft)]/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-emerald-700" />
          <Link href={`/dashboard/quotes/${head.id}`} className="font-bold text-[var(--ink)] hover:text-[var(--brand-700)]">
            {head.quoteNumber} <span className="text-[var(--brand-700)]">v{head.versionNumber || 1}</span>
          </Link>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${quoteStatusBadge(head.status).bg}`}>
            {quoteStatusBadge(head.status).label}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-[var(--ink)]">{money(quoteTotal(head.lines))}</span>
          {!['superseded', 'lost', 'expired', 'won'].includes(head.status) ? (
            <Button size="sm" variant="outline" disabled={revising} onClick={() => onRevise(head.id)}>
              <PenLine className="mr-1.5 h-3 w-3" /> Revise
            </Button>
          ) : null}
        </div>
      </div>
      {olderVersions.length ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-[var(--ink-3)] hover:text-[var(--ink)]"
        >
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          Show {olderVersions.length} earlier version{olderVersions.length === 1 ? '' : 's'}
        </button>
      ) : null}
      {expanded ? (
        <ul className="mt-2 space-y-1.5">
          {olderVersions.map((v: any) => (
            <li key={v.id} className="flex items-center justify-between gap-2 rounded-r3 border border-dashed border-[var(--line)] bg-[var(--surface)] px-3 py-1.5">
              <Link href={`/dashboard/quotes/${v.id}`} className="text-xs font-semibold text-[var(--ink-3)] line-through hover:no-underline hover:text-[var(--brand-700)]">
                {v.quoteNumber} v{v.versionNumber || 1}
              </Link>
              <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--ink-5)]">
                superseded · {new Date(v.updatedAt).toLocaleDateString()}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function TimelineCard(props: {
  entry: any;
  lead: any;
  me: any;
  isOfficeOrManager: boolean;
  isManager: boolean;
  onSubmit: (id: string) => void;
  onCancel: (id: string) => void;
  onPickUp: (id: string) => void;
  onRelease: (id: string, force?: boolean) => void;
  onRequestChanges: (id: string, msg?: string) => void;
  onGenerate: (id: string) => void;
  onRevise: (id: string) => void;
  generating: boolean;
  revising: boolean;
}) {
  const { entry } = props;
  const at = new Date(entry.at).toLocaleString();
  switch (entry.kind) {
    case 'intent':
      return <IntentTimelineCard {...props} at={at} />;
    case 'quote':
      return <QuoteTimelineCard {...props} at={at} />;
    case 'communication':
      return <BasicCard at={at} title={`${entry.payload.type} · ${entry.payload.direction}`} body={entry.payload.summary} />;
    case 'followup':
      return <BasicCard at={at} title={`Follow-up: ${entry.payload.status}`} body={entry.payload.notes} />;
    case 'dispatch_job':
      return <BasicCard at={at} title={`Dispatch job: ${entry.payload.status}`} body={`Due ${new Date(entry.payload.dueDate).toLocaleDateString()}`} />;
    case 'challan':
      return <BasicCard at={at} title={`Challan ${entry.payload.challanNumber}`} body={`Status: ${entry.payload.status}`} />;
    case 'order':
      return <BasicCard at={at} title={`Sales order ${entry.payload.orderNumber}`} body={`${money(entry.payload.totalAmount)} · ${entry.payload.paymentStatus}`} link={`/dashboard/sales/${entry.payload.id}`} />;
    case 'payment_receipt':
      return <BasicCard at={at} title={`Payment receipt ${money(entry.payload.amount)}`} body={`${entry.payload.paymentMode}${entry.payload.reference ? ` · ${entry.payload.reference}` : ''}`} />;
    case 'return_order':
      return <BasicCard at={at} title={`Return ${entry.payload.returnNumber || entry.payload.status}`} body={`${entry.payload.reason || 'Return'} · Refund ${money(entry.payload.refundAmount || 0)}`} />;
    case 'activity':
    default:
      return <BasicCard at={at} title={entry.payload.type} body={entry.payload.message} muted />;
  }
}

function BasicCard({ at, title, body, link, muted }: { at: string; title: string; body?: string; link?: string; muted?: boolean }) {
  const inner = (
    <div className={`rounded-r4 border border-[var(--line)] bg-[var(--bg-soft)]/40 p-3 ${muted ? 'opacity-90' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-[var(--ink)] capitalize">{title.replace(/[_.]/g, ' ')}</p>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--ink-5)]">{at}</p>
      </div>
      {body ? <p className="mt-1 text-xs leading-5 text-[var(--ink-3)]">{body}</p> : null}
    </div>
  );
  return link ? <Link href={link}>{inner}</Link> : inner;
}

function IntentTimelineCard({
  entry,
  me,
  isOfficeOrManager,
  isManager,
  onSubmit,
  onCancel,
  onPickUp,
  onRelease,
  onRequestChanges,
  onGenerate,
  generating,
  at,
}: any) {
  const intent = entry.payload;
  const badge = intentStatusBadge(intent.status);
  const isOwner = me?.id && (intent.ownerId === me.id || intent.createdBy === me.id);
  const myLock = intent.lockedBy === me?.id;
  const isLocked = intent.status === 'in_quote';
  const isPending = intent.status === 'pending_quote';
  const isDraft = intent.status === 'draft';
  const editable = (isDraft || isPending) && (isOwner || isOfficeOrManager);
  const revRef = intent.referencesQuoteId ? ` · revising prior quote` : '';
  return (
    <div className="rounded-r4 border border-[var(--line)] bg-white/85 p-4 dark:bg-[var(--surface)]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${badge.bg}`}>{badge.label}</span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--ink-5)]">
              {intentTypeLabel(intent.intentType)}{revRef}
            </span>
          </div>
          <p className="mt-1 text-sm font-bold text-[var(--ink)]">{Array.isArray(intent.rows) ? intent.rows.length : 0} item rows · {money(quoteTotal(intent.rows))}</p>
          {intent.notes ? <p className="mt-1 text-xs leading-5 text-[var(--ink-3)] line-clamp-2">{intent.notes}</p> : null}
        </div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--ink-5)]">{at}</p>
      </div>

      {isLocked ? (
        <div className="mt-3 flex items-center gap-2 rounded-r3 border border-blue-200 bg-blue-50 p-2 text-xs font-semibold text-blue-900">
          <Lock className="h-3.5 w-3.5" /> Office staff is building the quote{intent.locker ? `: ${intent.locker.name}` : ''}.
          {(isOwner || isManager) && !myLock ? (
            <button type="button" onClick={() => onRequestChanges(intent.id, 'Need to adjust selection')} className="ml-auto inline-flex items-center gap-1 rounded-full bg-blue-700 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-white hover:bg-blue-800">
              Request edit
            </button>
          ) : null}
          {(myLock || isManager) ? (
            <button type="button" onClick={() => onRelease(intent.id, !myLock)} className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-blue-800 ring-1 ring-blue-200 hover:bg-blue-50">
              <Unlock className="h-3 w-3" /> Release
            </button>
          ) : null}
        </div>
      ) : null}

      {isPending && (isOwner || isManager) ? (
        <p className="mt-2 text-[10px] font-semibold uppercase tracking-widest text-amber-800">
          Submitted to office. Still editable until staff picks it up.
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link href={`/dashboard/intents/${intent.id}`} className="text-xs font-bold text-[var(--brand-700)] hover:underline">
          Open intent →
        </Link>
        {editable ? (
          <>
            {isDraft ? (
              <button type="button" onClick={() => onSubmit(intent.id)} className="inline-flex items-center gap-1 rounded-full bg-[var(--brand-600)] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-white hover:bg-[var(--brand-700)]">
                <Send className="h-3 w-3" /> Submit to office
              </button>
            ) : null}
            <button type="button" onClick={() => onCancel(intent.id)} className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-rose-700 hover:bg-rose-100">
              Cancel
            </button>
          </>
        ) : null}
        {isOfficeOrManager && isPending ? (
          <button type="button" onClick={() => onPickUp(intent.id)} className="inline-flex items-center gap-1 rounded-full bg-[var(--ink)] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-white hover:opacity-90">
            <Hammer className="h-3 w-3" /> Pick up
          </button>
        ) : null}
        {isOfficeOrManager && (isLocked && (myLock || isManager)) ? (
          <button type="button" onClick={() => onGenerate(intent.id)} disabled={generating} className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-white hover:bg-emerald-700 disabled:opacity-50">
            <Check className="h-3 w-3" /> {generating ? 'Generating…' : 'Build quote'}
          </button>
        ) : null}
        {intent.quoteId ? (
          <Link href={`/dashboard/quotes/${intent.quoteId}`} className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-emerald-800 hover:bg-emerald-100">
            <FileText className="h-3 w-3" /> View quote
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function QuoteTimelineCard({ entry, onRevise, revising, at }: any) {
  const quote = entry.payload;
  const badge = quoteStatusBadge(quote.status);
  const isLive = !['superseded', 'lost', 'expired'].includes(quote.status);
  return (
    <div className="rounded-r4 border border-emerald-200/70 bg-emerald-50/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <FileText className="h-4 w-4 text-emerald-700" />
            <Link href={`/dashboard/quotes/${quote.id}`} className="font-bold text-[var(--ink)] hover:text-[var(--brand-700)]">
              {quote.quoteNumber} <span className="text-emerald-700">v{quote.versionNumber || 1}</span>
            </Link>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${badge.bg}`}>{badge.label}</span>
            {quote.supersedesQuoteId ? <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-blue-800">Replaces prior</span> : null}
          </div>
          <p className="mt-1 text-sm font-bold text-[var(--ink)]">{money(quoteTotal(quote.lines))}</p>
          {quote.notes ? <p className="mt-1 text-xs leading-5 text-[var(--ink-3)] line-clamp-2">{quote.notes}</p> : null}
        </div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--ink-5)]">{at}</p>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link href={`/dashboard/quotes/${quote.id}`} className="text-xs font-bold text-[var(--brand-700)] hover:underline">Open quote →</Link>
        <Link href={`/api/pdf/quote/${quote.id}`} target="_blank" rel="noreferrer" className="text-xs font-bold text-[var(--ink-3)] hover:text-[var(--brand-700)]">PDF</Link>
        {isLive ? (
          <button type="button" onClick={() => onRevise(quote.id)} disabled={revising} className="inline-flex items-center gap-1 rounded-full bg-violet-600 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-white hover:bg-violet-700 disabled:opacity-50">
            <PenLine className="h-3 w-3" /> Revise
          </button>
        ) : null}
      </div>
    </div>
  );
}
