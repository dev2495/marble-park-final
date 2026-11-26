'use client';

import Link from 'next/link';
import { gql, useMutation, useQuery } from '@apollo/client';
import { CheckCircle2, ClipboardCheck, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { QueryErrorBanner } from '@/components/query-state';
import { useBusyAction } from '@/hooks/use-busy-action';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';

const APPROVALS = gql`
  query OwnerApprovals {
    quotes(status: "pending_approval") { id quoteNumber title projectName discountPercent commercialTotal lines customer owner approvalStatus approval createdAt }
  }
`;
const APPROVE_QUOTE = gql`mutation ApproveQuote($id: ID!, $note: String) { approveQuote(id: $id, note: $note) { id status approvalStatus } }`;
const APPROVER = gql`query ApprovalsViewer { me { id role permissionOverrides } }`;
const REJECT_QUOTE = gql`mutation RejectQuote($id: ID!, $note: String!) { rejectQuote(id: $id, note: $note) { id status approvalStatus } }`;

function total(lines: any[]) {
  return (Array.isArray(lines) ? lines : []).reduce((sum, line) => sum + Number(line.qty || line.quantity || 0) * Number(line.price || line.sellPrice || 0), 0);
}
function money(value: number) { return `₹${Math.round(value || 0).toLocaleString('en-IN')}`; }

export default function ApprovalsPage() {
  const { data, loading, error, refetch } = useQuery(APPROVALS, { fetchPolicy: 'cache-and-network' });
  const [approveQuote, { error: approveQuoteError }] = useMutation(APPROVE_QUOTE, { onCompleted: () => refetch() });
  // Approving is final for the owner desk, so it is confirmed, with an optional note, and runs once.
  const busyAction = useBusyAction();
  const [target, setTarget] = useState<any>(null);
  const [note, setNote] = useState('');
  const quotes = data?.quotes || [];
  // Same rule as the API: owner and admin decide, or someone given "Price approvals" by hand.
  // Others (for example a sales manager) see the pending list only.
  const viewer = useQuery(APPROVER, { fetchPolicy: 'cache-first' });
  const me = viewer.data?.me;
  const approvalOverride = (me?.permissionOverrides || {})['approvals.manage'];
  const canDecide = approvalOverride === true || (approvalOverride !== false && ['admin', 'owner'].includes(String(me?.role || '')));
  // Turning a price down sends the quote back to its sales person with the owner's note.
  const [rejectQuote, { error: rejectQuoteError }] = useMutation(REJECT_QUOTE, { onCompleted: () => refetch() });
  const [rejectTarget, setRejectTarget] = useState<any>(null);
  const [rejectNote, setRejectNote] = useState('');

  return (
    <div className="space-y-6 pb-10">
      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
      {approveQuoteError ? <QueryErrorBanner error={approveQuoteError} /> : null}
      {rejectQuoteError ? <QueryErrorBanner error={rejectQuoteError} /> : null}

      <section className="mp-page-header">
        <div className="contents">
          <div className="min-w-0">
            <p className="mp-eyebrow">Owner / admin approval desk</p>
            <h1 className="mp-page-title">Only real exception approvals live here.</h1>
            <p className="mp-page-sub">
              Normal quote-to-sales-order confirmation does not need owner approval. This desk is reserved for quotes that the pricing rules explicitly flag. Excel imports and image uploads now apply through Product Master with audit history instead of owner approval queues.
            </p>
          </div>
          <Button asChild variant="outline"><Link href="/dashboard/audit">Open audit log</Link></Button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="mp-card rounded-r5 p-5"><p className="text-xs font-medium uppercase tracking-widest text-[var(--ink-4)]">Pending quote approvals</p><p className="mt-2 font-display text-4xl font-bold text-[var(--ink)]">{loading ? '...' : quotes.length}</p></div>
        <div className="mp-card rounded-r5 p-5"><p className="text-xs font-medium uppercase tracking-widest text-[var(--ink-4)]">Excel import approvals</p><p className="mt-2 font-display text-4xl font-bold text-[var(--ink)]">Removed</p></div>
        <div className="mp-card rounded-r5 p-5"><p className="text-xs font-medium uppercase tracking-widest text-[var(--ink-4)]">Image review approvals</p><p className="mt-2 font-display text-4xl font-bold text-[var(--ink)]">Removed</p></div>
      </section>

      {loading && !data ? <div role="status" aria-label="Loading approvals" className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div> : null}
      {!loading && !error && !quotes.length ? (
        <EmptyState icon={ShieldAlert} className="mp-card rounded-r5" title="No approvals pending" description="When pricing policy flags a quote, it will appear here for owner/admin decision." />
      ) : null}

      <section className="space-y-3">
        {quotes.map((quote: any) => (
          <article key={quote.id} className="mp-card grid gap-4 rounded-r5 p-5 lg:grid-cols-[1fr_0.7fr_0.55fr_auto] lg:items-center">
            <div>
              <Link href={`/dashboard/quotes/${quote.id}`} className="text-xl font-semibold text-[var(--ink)] hover:underline">{quote.quoteNumber}</Link>
              <p className="mt-1 text-sm font-medium text-[var(--ink-4)]">{quote.title || quote.projectName || 'Retail quotation'}</p>
              {quote.approval?.availabilityIssues?.length > 0 ? <p className="mt-2 rounded-2xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">Availability warning: {quote.approval.availabilityIssues.length} short item(s)</p> : null}
            </div>
            <div><p className="font-semibold text-[var(--ink)]">{quote.customer?.name || 'Customer'}</p><p className="text-xs text-[var(--ink-4)]">Owner: {quote.owner?.name || 'Unassigned'}</p></div>
            <div className="text-right"><p className="text-2xl font-semibold text-[var(--ink)]">{money(Number(quote.commercialTotal ?? total(quote.lines)))}</p><p className="text-xs font-semibold uppercase tracking-wider text-[var(--brand-700)]">Discount {quote.discountPercent || 0}%</p></div>
            {!canDecide ? <p className="text-xs font-medium text-[var(--ink-4)]">Waiting for the owner to decide.</p> : <div className="flex flex-wrap gap-2">
              <Button className="min-h-11" disabled={busyAction.isBusy()} loading={busyAction.isBusy(`approve-${quote.id}`)} onClick={() => { setNote(''); setTarget(quote); }}><CheckCircle2 className="mr-2 h-4 w-4" /> Approve quote</Button>
              <Button variant="outline" className="min-h-11" disabled={busyAction.isBusy()} loading={busyAction.isBusy(`reject-${quote.id}`)} onClick={() => { setRejectNote(''); setRejectTarget(quote); }}>Turn down price</Button>
            </div>}
          </article>
        ))}
      </section>

      <ConfirmDialog
        open={Boolean(target)}
        onOpenChange={(open) => { if (!open) setTarget(null); }}
        title={`Approve ${target?.quoteNumber || 'this quote'}?`}
        description={`${target?.customer?.name || 'The customer'}'s quote goes ahead with the discount it was priced at (${target?.discountPercent || 0}%).`}
        confirmLabel="Approve quote"
        cancelLabel="Not yet"
        busy={target ? busyAction.isBusy(`approve-${target.id}`) : false}
        onConfirm={() => target ? void busyAction.run(`approve-${target.id}`, async () => { await approveQuote({ variables: { id: target.id, note: note.trim() || 'Approved from owner approval desk' } }); setTarget(null); }).catch(() => setTarget(null)) : undefined}
      >
        <Field label="Note (optional)" htmlFor="approval-note" hint="Kept with the approval.">
          <Textarea id="approval-note" rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Why this price is fine" />
        </Field>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(rejectTarget)}
        onOpenChange={(open) => { if (!open) setRejectTarget(null); }}
        title={`Turn down the price on ${rejectTarget?.quoteNumber || 'this quote'}?`}
        description="The quote goes back to its sales person as a draft with your note. When they save a new price it comes back here if it is still below the floor rate."
        confirmLabel="Turn down price"
        cancelLabel="Not yet"
        tone="danger"
        busy={rejectTarget ? busyAction.isBusy(`reject-${rejectTarget.id}`) : false}
        confirmDisabled={!rejectNote.trim()}
        onConfirm={() => rejectTarget ? void busyAction.run(`reject-${rejectTarget.id}`, async () => { await rejectQuote({ variables: { id: rejectTarget.id, note: rejectNote.trim() } }); setRejectTarget(null); }).catch(() => setRejectTarget(null)) : undefined}
      >
        <Field label="Note for the sales person" htmlFor="reject-note" hint="Required. Say what price you would accept." required>
          <Textarea id="reject-note" rows={2} value={rejectNote} onChange={(event) => setRejectNote(event.target.value)} placeholder="For example: keep the special rate at or above the floor" />
        </Field>
      </ConfirmDialog>
    </div>
  );
}
