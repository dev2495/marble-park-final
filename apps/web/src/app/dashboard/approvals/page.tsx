'use client';

import Link from 'next/link';
import { gql, useMutation, useQuery } from '@apollo/client';
import { CheckCircle2, ClipboardCheck, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryErrorBanner } from '@/components/query-state';

const APPROVALS = gql`
  query OwnerApprovals {
    quotes(status: "pending_approval") { id quoteNumber title projectName discountPercent lines customer owner approvalStatus approval createdAt }
  }
`;
const APPROVE_QUOTE = gql`mutation ApproveQuote($id: ID!, $note: String) { approveQuote(id: $id, note: $note) { id status approvalStatus } }`;

function total(lines: any[]) {
  return (Array.isArray(lines) ? lines : []).reduce((sum, line) => sum + Number(line.qty || line.quantity || 0) * Number(line.price || line.sellPrice || 0), 0);
}
function money(value: number) { return `₹${Math.round(value || 0).toLocaleString('en-IN')}`; }

export default function ApprovalsPage() {
  const { data, loading, error, refetch } = useQuery(APPROVALS, { fetchPolicy: 'cache-and-network' });
  const [approveQuote, { loading: approvingQuote, error: approveQuoteError }] = useMutation(APPROVE_QUOTE, { onCompleted: () => refetch() });
  const quotes = data?.quotes || [];

  return (
    <div className="space-y-6 pb-10">
      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
      {approveQuoteError ? <QueryErrorBanner error={approveQuoteError} /> : null}

      <section className="mp-card rounded-r6 border border-[var(--line)] p-6">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--ink-4)]">Owner / admin approval desk</p>
            <h1 className="mt-3 font-display text-4xl font-bold tracking-[-0.04em] text-[var(--ink)]">Only real exception approvals live here.</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--ink-3)]">
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

      {!loading && !quotes.length ? (
        <div className="mp-card grid min-h-64 place-items-center rounded-r5 p-8 text-center">
          <div>
            <ShieldAlert className="mx-auto h-10 w-10 text-[var(--brand-700)]" />
            <h2 className="mt-4 text-2xl font-semibold text-[var(--ink)]">No approvals pending</h2>
            <p className="mt-2 text-sm font-medium text-[var(--ink-4)]">When pricing policy flags a quote, it will appear here for owner/admin decision.</p>
          </div>
        </div>
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
            <div className="text-right"><p className="text-2xl font-semibold text-[var(--ink)]">{money(total(quote.lines))}</p><p className="text-xs font-semibold uppercase tracking-wider text-[var(--brand-700)]">Discount {quote.discountPercent || 0}%</p></div>
            <Button disabled={approvingQuote} onClick={() => approveQuote({ variables: { id: quote.id, note: 'Approved from owner approval desk' } })}><CheckCircle2 className="mr-2 h-4 w-4" /> Approve quote</Button>
          </article>
        ))}
      </section>
    </div>
  );
}
