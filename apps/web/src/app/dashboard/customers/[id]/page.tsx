'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { gql, useMutation, useQuery } from '@apollo/client';
import {
  ArrowLeft, Briefcase, Building2, Copy, ExternalLink, Globe, Mail, MapPin, MessageCircle, MessageSquare,
  Phone, Plus, RefreshCw, Send, ShieldCheck, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QueryErrorBanner } from '@/components/query-state';
import { HelpButton } from '@/components/help/help-button';

const CUSTOMER_DETAIL = gql`
  query CustomerDetail($id: ID!, $customerId: String!) {
    customer(id: $id) { id name email mobile phone gstNo city state siteAddress architect designer notes }
    communicationsForCustomer(customerId: $customerId) {
      id type direction summary body recordedBy occurredAt
    }
    paymentsForCustomer(customerId: $customerId) {
      id amount mode reference paidAt direction salesOrderId notes
    }
    portalTokens(customerId: $customerId) {
      id expiresAt revokedAt createdAt
    }
  }
`;

const CUSTOMER_LEADS = gql`
  query CustomerLeads {
    leads { id title stage ownerId customerId customer reopenedAt }
  }
`;

const CREATE_LEAD = gql`
  mutation NewLead($input: CreateLeadInput!) {
    createLead(input: $input) { id }
  }
`;

const CREATE_INTENT_FROM_CUSTOMER = gql`
  mutation NewIntentFromCustomer($input: CreateIntentInputDto!) {
    createIntent(input: $input)
  }
`;

const LOG_COMMUNICATION = gql`
  mutation LogComm($input: CreateCommunicationInputDto!) {
    logCommunication(input: $input) { id }
  }
`;

const ISSUE_PORTAL_LINK = gql`
  mutation IssuePortal($customerId: String!, $ttlDays: Int) {
    issuePortalLink(customerId: $customerId, ttlDays: $ttlDays) { token expiresAt }
  }
`;

const REVOKE_PORTAL_TOKEN = gql`
  mutation RevokePortal($id: ID!) {
    revokePortalToken(id: $id)
  }
`;

const COMM_TYPES: Array<{ value: string; label: string; icon: any }> = [
  { value: 'call', label: 'Call', icon: Phone },
  { value: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { value: 'email', label: 'Email', icon: Mail },
  { value: 'visit', label: 'Site visit', icon: MapPin },
  { value: 'meeting', label: 'Meeting', icon: MessageSquare },
  { value: 'note', label: 'Note', icon: MessageSquare },
];

export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id || '';
  const { data, loading, error, refetch } = useQuery(CUSTOMER_DETAIL, { variables: { id, customerId: id }, skip: !id });
  const { data: leadsData, refetch: refetchLeads } = useQuery(CUSTOMER_LEADS, { skip: !id });

  const [form, setForm] = useState({ type: 'call', direction: 'outbound', summary: '', body: '' });
  const [logCommunication, { loading: logging, error: logError }] = useMutation(LOG_COMMUNICATION, { onCompleted: () => refetch() });
  const [issueLink, { loading: issuing }] = useMutation(ISSUE_PORTAL_LINK, { onCompleted: () => refetch() });
  const [revokeToken, { loading: revoking }] = useMutation(REVOKE_PORTAL_TOKEN, { onCompleted: () => refetch() });
  const [createLead, { loading: creatingLead, error: createLeadError }] = useMutation(CREATE_LEAD);
  const [createIntent, { loading: creatingIntent, error: createIntentError }] = useMutation(CREATE_INTENT_FROM_CUSTOMER);
  const [issuedLink, setIssuedLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [newRoundOpen, setNewRoundOpen] = useState(false);
  const [newLeadTitle, setNewLeadTitle] = useState('');

  const customer = data?.customer;
  const comms = useMemo<any[]>(() => data?.communicationsForCustomer || [], [data?.communicationsForCustomer]);
  const payments = useMemo<any[]>(() => data?.paymentsForCustomer || [], [data?.paymentsForCustomer]);
  const tokens = useMemo<any[]>(() => data?.portalTokens || [], [data?.portalTokens]);
  const allLeads = useMemo<any[]>(() => leadsData?.leads || [], [leadsData?.leads]);
  const customerLeads = useMemo(
    () => allLeads.filter((l: any) => l.customerId === id || l.customer?.id === id),
    [allLeads, id],
  );
  const activeLeads = useMemo(
    () => customerLeads.filter((l: any) => !['won', 'lost'].includes(l.stage) || l.reopenedAt),
    [customerLeads],
  );

  // Resume an existing lead by spawning a fresh follow-up intent and routing
  // the user straight into the editor. Keeps the buying journey continuous.
  const continueOnLead = async (lead: any) => {
    const r = await createIntent({
      variables: {
        input: {
          leadId: lead.id,
          rows: [],
          notes: '',
          intentType: 'followup',
          followUpReason: 'New round on existing project',
          submit: false,
        },
      },
    });
    const intent = r.data?.createIntent;
    if (intent?.id) router.push(`/dashboard/intents/${intent.id}`);
  };

  // Start a totally separate project under the same customer — useful for
  // phase-2 work or unrelated work years later.
  const startNewProject = async () => {
    const title = newLeadTitle.trim() || `${customer?.name || 'Customer'} — new project`;
    const r = await createLead({
      variables: {
        input: {
          customerId: id,
          title,
          source: 'Customer detail',
        },
      },
    });
    setNewRoundOpen(false);
    setNewLeadTitle('');
    refetchLeads();
    if (r.data?.createLead?.id) {
      // Drop the user into the new lead so they can capture an intent immediately.
      router.push(`/dashboard/leads/${r.data.createLead.id}`);
    }
  };

  const balance = useMemo(() => {
    let received = 0;
    let refunded = 0;
    for (const p of payments) {
      if (p.direction === 'refund') refunded += Number(p.amount || 0);
      else received += Number(p.amount || 0);
    }
    return { received, refunded, net: received - refunded };
  }, [payments]);

  const submitComm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.summary.trim()) return;
    await logCommunication({
      variables: { input: { customerId: id, type: form.type, direction: form.direction, summary: form.summary, body: form.body || null } },
    });
    setForm({ ...form, summary: '', body: '' });
  };

  const handleIssueLink = async () => {
    const { data: r } = await issueLink({ variables: { customerId: id, ttlDays: 30 } });
    if (r?.issuePortalLink) {
      const base = window.location.origin;
      setIssuedLink({ url: `${base}/portal/${r.issuePortalLink.token}`, expiresAt: r.issuePortalLink.expiresAt });
    }
  };

  if (loading && !customer) return <div className="p-8 text-sm text-[var(--ink-4)]">Loading customer…</div>;
  if (error) return <QueryErrorBanner error={error} onRetry={() => refetch()} />;
  if (!customer) return <p className="p-8 text-sm text-[var(--ink-4)]">Customer not found.</p>;

  return (
    <div className="space-y-6 pb-10">
      <div className="flex items-center justify-between">
        <Link href="/dashboard/customers" className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--ink-3)] hover:text-[var(--ink)]">
          <ArrowLeft className="h-4 w-4" /> Back to customers
        </Link>
        <HelpButton topicId="customers" variant="inline" label="Help" />
      </div>

      {/* Hero */}
      <section className="rounded-r5 border border-[var(--line)] bg-[var(--surface)] p-6 shadow-sm-soft">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="grid h-14 w-14 place-items-center rounded-r4 bg-[var(--brand-50)] text-[var(--brand-700)]">
              <Building2 className="h-7 w-7" />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight text-[var(--ink)]">{customer.name}</h1>
              <p className="text-sm text-[var(--ink-3)]">{[customer.city, customer.state].filter(Boolean).join(' · ') || 'No location on file'}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {customer.mobile ? (
              <a href={`tel:${customer.mobile}`} className="inline-flex items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold text-[var(--ink-2)] hover:bg-[var(--bg-soft)]">
                <Phone className="h-3.5 w-3.5" /> {customer.mobile}
              </a>
            ) : null}
            {customer.email ? (
              <a href={`mailto:${customer.email}`} className="inline-flex items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold text-[var(--ink-2)] hover:bg-[var(--bg-soft)]">
                <Mail className="h-3.5 w-3.5" /> {customer.email}
              </a>
            ) : null}
            <Button onClick={() => setNewRoundOpen(true)} size="sm" variant="outline">
              <Plus className="mr-2 h-4 w-4" /> New project / round
            </Button>
            <Button onClick={handleIssueLink} disabled={issuing} size="sm">
              <Globe className="mr-2 h-4 w-4" /> Issue portal link
            </Button>
          </div>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <div className="rounded-r3 border border-[var(--line)] bg-[var(--bg-soft)] p-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--ink-5)]">Site address</p>
            <p className="mt-1 text-sm font-semibold text-[var(--ink)]">{customer.siteAddress || '—'}</p>
          </div>
          <div className="rounded-r3 border border-[var(--line)] bg-[var(--bg-soft)] p-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--ink-5)]">GST number</p>
            <p className="mt-1 text-sm font-semibold text-[var(--ink)]">{customer.gstNo || '—'}</p>
          </div>
          <div className="rounded-r3 border border-[var(--line)] bg-[var(--bg-soft)] p-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--ink-5)]">Architect / Designer</p>
            <p className="mt-1 text-sm font-semibold text-[var(--ink)]">{[customer.architect, customer.designer].filter(Boolean).join(' · ') || '—'}</p>
          </div>
        </div>
      </section>

      {/* Portal link banner */}
      {issuedLink ? (
        <section className="rounded-r4 border border-emerald-200 bg-emerald-50/70 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-5 w-5 text-emerald-700" />
              <div>
                <p className="text-sm font-bold text-emerald-900">Portal link ready — share with the customer</p>
                <p className="mt-0.5 text-xs text-emerald-800">Expires {new Date(issuedLink.expiresAt).toLocaleDateString()} · read-only access</p>
              </div>
            </div>
            <div className="flex gap-2">
              <input readOnly value={issuedLink.url} className="h-9 w-72 rounded-md border border-emerald-300 bg-white px-3 text-xs font-mono text-emerald-900" />
              <Button size="sm" onClick={() => { navigator.clipboard?.writeText(issuedLink.url); }}>
                <Copy className="mr-2 h-3.5 w-3.5" /> Copy
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      {/* Projects (leads) for this customer */}
      <section className="rounded-r5 border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm-soft">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-[var(--ink)]">
            <Briefcase className="h-4 w-4" /> Projects
          </h2>
          <span className="rounded-full bg-[var(--bg-soft)] px-2.5 py-1 text-xs font-bold text-[var(--ink-3)]">{customerLeads.length}</span>
        </div>
        {customerLeads.length === 0 ? (
          <p className="mt-4 rounded-r4 border border-dashed border-[var(--line)] p-6 text-center text-sm text-[var(--ink-4)]">
            No projects yet. Click "New project / round" to start one.
          </p>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {customerLeads.map((lead: any) => {
              const isActive = !['won', 'lost'].includes(lead.stage);
              const isReopened = lead.reopenedAt && !isActive;
              return (
                <div key={lead.id} className="rounded-r4 border border-[var(--line)] bg-[var(--bg-soft)]/40 p-4">
                  <Link href={`/dashboard/leads/${lead.id}`} className="block">
                    <p className="truncate text-sm font-bold text-[var(--ink)] hover:text-[var(--brand-700)]">{lead.title}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest capitalize ${
                        lead.stage === 'won' ? 'bg-emerald-100 text-emerald-800' : lead.stage === 'lost' ? 'bg-rose-100 text-rose-700' : 'bg-blue-100 text-blue-800'
                      }`}>
                        {lead.stage}
                      </span>
                      {isReopened ? (
                        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-violet-800">Reopened</span>
                      ) : null}
                    </div>
                  </Link>
                  <button
                    type="button"
                    onClick={() => continueOnLead(lead)}
                    disabled={creatingIntent}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[var(--brand-600)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-white hover:bg-[var(--brand-700)] disabled:opacity-50"
                  >
                    <Plus className="h-3 w-3" /> New round on this project
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {(createLeadError || createIntentError) ? (
          <div className="mt-3">
            <QueryErrorBanner error={(createLeadError || createIntentError) as any} />
          </div>
        ) : null}
      </section>

      {/* New project / round modal */}
      {newRoundOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center px-4">
          <button type="button" aria-label="Close" className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm" onClick={() => setNewRoundOpen(false)} />
          <div className="relative w-full max-w-md rounded-r5 border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[0_30px_80px_-30px_rgba(15,23,42,0.5)]">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-base font-bold text-[var(--ink)]">Continue or start a new project?</h3>
              <button type="button" onClick={() => setNewRoundOpen(false)} className="grid h-8 w-8 place-items-center rounded-md border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-3)] hover:bg-[var(--bg-soft)]">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-2 text-xs leading-5 text-[var(--ink-3)]">
              Continue an existing project to add a follow-up selection round. Start a separate project for a new phase or unrelated work.
            </p>
            <div className="mt-4 space-y-2">
              {customerLeads.length === 0 ? (
                <p className="rounded-r3 border border-dashed border-[var(--line)] p-3 text-xs text-[var(--ink-4)]">No prior projects.</p>
              ) : null}
              {customerLeads.map((lead: any) => (
                <button
                  key={lead.id}
                  type="button"
                  onClick={() => { setNewRoundOpen(false); continueOnLead(lead); }}
                  disabled={creatingIntent}
                  className="flex w-full items-center justify-between gap-2 rounded-r3 border border-[var(--line)] bg-[var(--bg-soft)]/40 p-3 text-left hover:bg-[var(--bg-soft)] disabled:opacity-50"
                >
                  <div>
                    <p className="text-sm font-bold text-[var(--ink)]">{lead.title}</p>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--ink-5)] capitalize">{lead.stage}</p>
                  </div>
                  <Plus className="h-4 w-4 text-[var(--brand-700)]" />
                </button>
              ))}
            </div>
            <div className="mt-5 border-t border-[var(--line)] pt-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--ink-5)]">Start a separate project</p>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <Input
                  value={newLeadTitle}
                  onChange={(e) => setNewLeadTitle(e.target.value)}
                  placeholder={`${customer.name || 'Customer'} — new project`}
                />
                <Button onClick={startNewProject} disabled={creatingLead}>
                  {creatingLead ? 'Creating…' : 'Create project'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Communications */}
        <section className="lg:col-span-2 rounded-r5 border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm-soft">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--ink)]">Communication log</h2>
            <span className="rounded-full bg-[var(--bg-soft)] px-2.5 py-1 text-xs font-bold text-[var(--ink-3)]">{comms.length}</span>
          </div>

          <form onSubmit={submitComm} className="mt-4 rounded-r4 border border-dashed border-[var(--line)] bg-[var(--bg-soft)]/60 p-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              {COMM_TYPES.map((t) => (
                <button
                  type="button"
                  key={t.value}
                  onClick={() => setForm({ ...form, type: t.value })}
                  className={
                    form.type === t.value
                      ? 'inline-flex items-center gap-1.5 rounded-full bg-[var(--brand-600)] px-3 py-1.5 text-xs font-semibold text-white'
                      : 'inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-2)] hover:bg-[var(--bg-soft)]'
                  }
                >
                  <t.icon className="h-3.5 w-3.5" /> {t.label}
                </button>
              ))}
              <div className="ml-auto flex gap-2">
                {(['inbound', 'outbound'] as const).map((d) => (
                  <button
                    type="button"
                    key={d}
                    onClick={() => setForm({ ...form, direction: d })}
                    className={
                      form.direction === d
                        ? 'inline-flex items-center rounded-full bg-[var(--ink)] px-3 py-1.5 text-xs font-semibold text-white capitalize'
                        : 'inline-flex items-center rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-3)] hover:bg-[var(--bg-soft)] capitalize'
                    }
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
            <Input
              required
              placeholder="One-line summary (e.g. Followed up on bathroom selection)"
              value={form.summary}
              onChange={(e) => setForm({ ...form, summary: e.target.value })}
            />
            <textarea
              rows={2}
              placeholder="Optional details…"
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              className="w-full rounded-md border border-[var(--line)] bg-[var(--surface)] p-2 text-sm text-[var(--ink)] placeholder:text-[var(--ink-5)]"
            />
            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={logging || !form.summary.trim()}>
                <Send className="mr-2 h-3.5 w-3.5" /> {logging ? 'Saving…' : 'Log communication'}
              </Button>
            </div>
            {logError ? <QueryErrorBanner error={logError} /> : null}
          </form>

          <div className="mt-5 space-y-2">
            {comms.length === 0 ? (
              <div className="rounded-r4 border border-dashed border-[var(--line)] p-8 text-center text-sm text-[var(--ink-4)]">
                No communications yet. Log a call or visit above.
              </div>
            ) : null}
            {comms.map((c: any) => (
              <div key={c.id} className="rounded-r4 border border-[var(--line)] bg-[var(--bg-soft)]/40 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--brand-50)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-[var(--brand-800)]">
                      {c.type}
                    </span>
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--ink-5)]">
                      {c.direction} · {new Date(c.occurredAt).toLocaleString()}
                    </span>
                  </div>
                </div>
                <p className="mt-2 text-sm font-semibold text-[var(--ink)]">{c.summary}</p>
                {c.body ? <p className="mt-1 text-xs leading-5 text-[var(--ink-3)]">{c.body}</p> : null}
              </div>
            ))}
          </div>
        </section>

        {/* Payments + portal */}
        <div className="space-y-5">
          <section className="rounded-r5 border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm-soft">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--ink)]">Payment history</h2>
              <span className="rounded-full bg-[var(--bg-soft)] px-2.5 py-1 text-xs font-bold text-[var(--ink-3)]">{payments.length}</span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <div className="rounded-r3 border border-[var(--line)] bg-[var(--bg-soft)] p-3">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--ink-5)]">Received</p>
                <p className="text-base font-bold text-emerald-700">₹{balance.received.toLocaleString('en-IN')}</p>
              </div>
              <div className="rounded-r3 border border-[var(--line)] bg-[var(--bg-soft)] p-3">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--ink-5)]">Refunded</p>
                <p className="text-base font-bold text-red-700">₹{balance.refunded.toLocaleString('en-IN')}</p>
              </div>
              <div className="rounded-r3 border border-[var(--line)] bg-[var(--bg-soft)] p-3">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--ink-5)]">Net</p>
                <p className="text-base font-bold text-[var(--ink)]">₹{balance.net.toLocaleString('en-IN')}</p>
              </div>
            </div>
            <div className="mt-4 max-h-72 space-y-2 overflow-y-auto custom-scrollbar pr-1">
              {payments.length === 0 ? (
                <p className="rounded-r4 border border-dashed border-[var(--line)] p-4 text-center text-xs text-[var(--ink-4)]">
                  No payments recorded yet.
                </p>
              ) : null}
              {payments.map((p: any) => (
                <Link key={p.id} href={`/dashboard/sales/${p.salesOrderId}`} className="block rounded-r3 border border-[var(--line)] bg-[var(--bg-soft)]/40 p-3 hover:bg-[var(--bg-soft)]">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-bold text-[var(--ink)]">
                        {p.direction === 'refund' ? '−' : '+'}₹{Number(p.amount).toLocaleString('en-IN')}
                      </p>
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--ink-5)]">
                        {p.mode} · {new Date(p.paidAt).toLocaleDateString()}
                      </p>
                    </div>
                    <ExternalLink className="h-3.5 w-3.5 text-[var(--ink-4)]" />
                  </div>
                  {p.reference ? <p className="mt-1 text-[11px] font-mono text-[var(--ink-3)]">{p.reference}</p> : null}
                </Link>
              ))}
            </div>
          </section>

          <section className="rounded-r5 border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm-soft">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--ink)]">Portal links</h2>
              <span className="rounded-full bg-[var(--bg-soft)] px-2.5 py-1 text-xs font-bold text-[var(--ink-3)]">{tokens.length}</span>
            </div>
            <div className="mt-4 space-y-2">
              {tokens.length === 0 ? (
                <p className="rounded-r4 border border-dashed border-[var(--line)] p-4 text-center text-xs text-[var(--ink-4)]">
                  No portal links issued yet.
                </p>
              ) : null}
              {tokens.map((t: any) => {
                const expired = new Date(t.expiresAt) < new Date();
                return (
                  <div key={t.id} className="rounded-r3 border border-[var(--line)] bg-[var(--bg-soft)]/40 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-bold text-[var(--ink)]">
                          {t.revokedAt ? 'Revoked' : expired ? 'Expired' : 'Active'}
                        </p>
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--ink-5)]">
                          Expires {new Date(t.expiresAt).toLocaleDateString()}
                        </p>
                      </div>
                      {!t.revokedAt && !expired ? (
                        <button
                          type="button"
                          onClick={() => revokeToken({ variables: { id: t.id } })}
                          disabled={revoking}
                          className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-red-700 hover:bg-red-100"
                        >
                          <RefreshCw className="h-3 w-3" /> Revoke
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
