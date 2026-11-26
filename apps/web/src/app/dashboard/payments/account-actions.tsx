'use client';

// Money lane: void an invoice or a receipt (with a reason), and a customer
// statement that adds up (opening balance, date range, every entry paged).

import { gql, useMutation, useQuery } from '@apollo/client';
import { useRef, useState } from 'react';
import { AlertTriangle, FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Pager } from '@/components/ui/pager';
import { QueryErrorBanner, QueryLoading } from '@/components/query-state';
import { useFocusTrap } from '@/hooks/use-focus-trap';

const VOID_INVOICE = gql`
  mutation VoidSalesInvoice($id: ID!, $reason: String!) { voidSalesInvoice(id: $id, reason: $reason) }
`;

const VOID_RECEIPT = gql`
  mutation VoidCustomerPayment($id: ID!, $reason: String) { voidCustomerPayment(id: $id, reason: $reason) }
`;

const STATEMENT = gql`
  query CustomerStatementDesk($customerId: ID!, $from: String, $to: String, $skip: Int, $take: Int) {
    customerStatement(customerId: $customerId, from: $from, to: $to, skip: $skip, take: $take)
  }
`;

const money = (value: number | string | undefined | null) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value || 0));
const date = (value: string | undefined | null) => value ? new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '-';

export type VoidTarget = { kind: 'invoice'; row: any } | { kind: 'receipt'; row: any };

/** Only owner and admin may void a receipt or an invoice (same rule as the API). */
export function canVoidReceipts(): boolean {
  try {
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    return ['owner', 'admin'].includes(String(user?.role || ''));
  } catch {
    return false;
  }
}

export function VoidDialog({ target, onClose, onDone }: { target: VoidTarget; onClose: () => void; onDone: () => Promise<unknown> | void }) {
  const [reason, setReason] = useState('');
  const [voidInvoice, invoiceState] = useMutation(VOID_INVOICE);
  const [voidReceipt, receiptState] = useMutation(VOID_RECEIPT);
  const busy = invoiceState.loading || receiptState.loading;
  const error = invoiceState.error || receiptState.error;
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true, { onEscape: () => { if (!busy) onClose(); } });
  const isInvoice = target.kind === 'invoice';
  const number = isInvoice ? target.row.invoiceNumber : target.row.receiptNumber;
  const title = isInvoice ? `Void invoice ${number}?` : `Void receipt ${number}?`;
  const explain = isInvoice
    ? 'The invoice stays on record marked void. Any payment applied to it goes back to the customer as unused credit, and the dispatched goods can be invoiced again.'
    : 'The receipt stays on record marked void. The money is taken off the customer account and off any invoice it paid, so those invoices become due again.';
  const ready = reason.trim().length >= 3;

  async function confirm() {
    if (!ready || busy) return;
    try {
      if (isInvoice) await voidInvoice({ variables: { id: target.row.id, reason: reason.trim() } });
      else await voidReceipt({ variables: { id: target.row.id, reason: reason.trim() } });
      await onDone();
      onClose();
    } catch {
      // shown below
    }
  }

  return <div ref={ref} className="fixed inset-0 z-[80] flex items-end bg-black/45 sm:items-center sm:justify-center sm:p-5" role="alertdialog" aria-modal="true" aria-labelledby="void-title">
    <button type="button" tabIndex={-1} className="absolute inset-0 cursor-default" aria-label="Close" onClick={() => { if (!busy) onClose(); }} />
    <form className="relative w-full rounded-t-lg border border-[var(--line)] bg-[var(--surface)] p-5 shadow-2xl sm:max-w-md sm:rounded-lg" onSubmit={(event) => { event.preventDefault(); void confirm(); }}>
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-rose-50 text-rose-700"><AlertTriangle className="h-4 w-4" /></span>
        <div>
          <h2 id="void-title" className="font-display text-lg font-bold text-[var(--ink)]">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--ink-3)]">{explain} This cannot be undone.</p>
          <p className="mt-1 text-sm font-semibold text-[var(--ink)]">{money(isInvoice ? target.row.totalAmount : target.row.amount)}</p>
        </div>
      </div>
      <label className="mt-4 block text-sm font-semibold text-[var(--ink-2)]" htmlFor="void-reason">Reason <span className="text-rose-700">*</span>
        <textarea id="void-reason" data-autofocus value={reason} onChange={(event) => setReason(event.target.value)} required minLength={3} maxLength={500} className="mt-1 min-h-20 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] p-3 text-sm font-normal" placeholder={isInvoice ? 'For example: wrong rate, billed to the wrong customer' : 'For example: cheque bounced, entered twice'} />
      </label>
      {error ? <div className="mt-3"><QueryErrorBanner error={error} /></div> : null}
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Keep it</Button>
        <Button type="submit" variant="destructive" disabled={!ready || busy}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}{isInvoice ? 'Void invoice' : 'Void receipt'}</Button>
      </div>
    </form>
  </div>;
}

const REFUND_ADVANCE = gql`
  mutation RefundOrderAdvance($paymentId: ID!, $reason: String!, $refundMode: String) { refundOrderAdvance(paymentId: $paymentId, reason: $reason, refundMode: $refundMode) }
`;

const MOVE_ADVANCE = gql`
  mutation MoveAdvanceToAccount($paymentId: ID!, $reason: String!) { moveAdvanceToAccount(paymentId: $paymentId, reason: $reason) }
`;

/**
 * Advances still sitting on a cancelled order (gaps lane): pay the money back,
 * or move it onto the customer's account so it pays their oldest open bill.
 * Refund is for owner and admin only (same as voiding a receipt).
 */
export function CancelledOrderAdvances({ account, canRefund, onDone }: { account: any; canRefund: boolean; onDone: () => Promise<unknown> | void }) {
  const rows: any[] = account?.cancelledOrderAdvances || [];
  const [target, setTarget] = useState<{ kind: 'refund' | 'move'; row: any } | null>(null);
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState('cash');
  const [refund, refundState] = useMutation(REFUND_ADVANCE);
  const [move, moveState] = useMutation(MOVE_ADVANCE);
  const busy = refundState.loading || moveState.loading;
  const error = refundState.error || moveState.error;
  if (!rows.length) return null;
  const open = (kind: 'refund' | 'move', row: any) => { refundState.reset(); moveState.reset(); setReason(''); setMode('cash'); setTarget({ kind, row }); };
  async function confirm() {
    if (!target || reason.trim().length < 3 || busy) return;
    try {
      if (target.kind === 'refund') await refund({ variables: { paymentId: target.row.paymentId, reason: reason.trim(), refundMode: mode } });
      else await move({ variables: { paymentId: target.row.paymentId, reason: reason.trim() } });
      await onDone();
      setTarget(null);
    } catch {
      // shown in the dialog
    }
  }
  return <section className="mt-5 overflow-hidden rounded-lg border border-amber-200">
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-3"><h3 className="font-bold text-[var(--ink)]">Advance on cancelled order</h3><p className="mt-1 text-xs text-[var(--ink-3)]">This money was paid for an order that was later cancelled. Pay it back, or keep it on the customer&apos;s account to pay their oldest open bill.</p></div>
    <div className="divide-y divide-[var(--line)]">{rows.map((row) => <div key={row.paymentId} className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div><p className="font-bold text-[var(--ink)]">{row.receiptNumber} · order {row.orderNumber}</p><p className="mt-1 text-xs text-[var(--ink-4)]">{String(row.paymentMode || '').toUpperCase()} · received {date(row.receivedAt)}{row.cancelReason ? ` · cancelled: ${row.cancelReason}` : ''}</p></div>
      <div className="flex items-center gap-2"><p className="font-bold tabular-nums text-[var(--ink)]">{money(row.unappliedAmount)}</p>
        <Button type="button" size="sm" variant="outline" onClick={() => open('move', row)}>Move to account</Button>
        {canRefund ? <Button type="button" size="sm" variant="outline" onClick={() => open('refund', row)}>Refund</Button> : null}
      </div>
    </div>)}</div>
    <ConfirmDialog
      open={!!target}
      onOpenChange={(next) => { if (!next) setTarget(null); }}
      title={target?.kind === 'refund' ? `Refund ${money(target?.row.unappliedAmount)} to the customer?` : `Move ${money(target?.row.unappliedAmount)} to the customer's account?`}
      description={target?.kind === 'refund'
        ? `Records that this money from ${target?.row.receiptNumber} was paid back to the customer. It shows as money going out this month.`
        : `The money from ${target?.row.receiptNumber} is no longer tied to order ${target?.row.orderNumber}. It pays the oldest open bill now, and any rest is used on the next bill.`}
      confirmLabel={target?.kind === 'refund' ? 'Record refund' : 'Move to account'}
      tone={target?.kind === 'refund' ? 'danger' : 'default'}
      busy={busy}
      confirmDisabled={reason.trim().length < 3}
      onConfirm={confirm}
    >
      {target?.kind === 'refund' ? <label className="block text-sm font-semibold text-[var(--ink-2)]" htmlFor="advance-refund-mode">Paid back by
        <select id="advance-refund-mode" value={mode} onChange={(event) => setMode(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-normal"><option value="cash">Cash</option><option value="upi">UPI</option><option value="neft">NEFT</option><option value="rtgs">RTGS</option><option value="cheque">Cheque</option><option value="bank_transfer">Bank transfer</option></select>
      </label> : null}
      <label className="mt-3 block text-sm font-semibold text-[var(--ink-2)]" htmlFor="advance-reason">Reason <span className="text-rose-700">*</span>
        <textarea id="advance-reason" value={reason} onChange={(event) => setReason(event.target.value)} required minLength={3} maxLength={500} className="mt-1 min-h-20 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] p-3 text-sm font-normal" placeholder={target?.kind === 'refund' ? 'For example: customer asked for the money back' : 'For example: customer will buy other items'} />
      </label>
      {error ? <div className="mt-3"><QueryErrorBanner error={error} /></div> : null}
    </ConfirmDialog>
  </section>;
}

/** Statement with a date range: opening balance, every entry with a running balance, closing balance. */
export function StatementSection({ customerId }: { customerId: string }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const { data, loading, error, refetch } = useQuery(STATEMENT, {
    variables: { customerId, from: from || null, to: to || null, skip: (page - 1) * pageSize, take: pageSize },
    fetchPolicy: 'cache-and-network',
  });
  const statement = data?.customerStatement;
  const query = new URLSearchParams();
  if (from) query.set('from', from);
  if (to) query.set('to', to);
  const pdfHref = `/api/pdf/customer-statement/${customerId}${query.toString() ? `?${query}` : ''}`;
  return <section className="overflow-hidden rounded-lg border border-[var(--line)]">
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--line)] bg-[var(--bg-soft)] px-4 py-3">
      <div><h3 className="font-bold text-[var(--ink)]">Statement</h3><p className="mt-1 text-xs text-[var(--ink-4)]">Leave the dates empty for the whole account.</p></div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs font-semibold text-[var(--ink-3)]">From<Input className="mt-1 h-9" type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} /></label>
        <label className="text-xs font-semibold text-[var(--ink-3)]">To<Input className="mt-1 h-9" type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} /></label>
        <a href={pdfHref} target="_blank" rel="noreferrer"><Button type="button" variant="outline"><FileText className="mr-2 h-4 w-4" />Statement PDF</Button></a>
      </div>
    </div>
    {error ? <div className="p-3"><QueryErrorBanner error={error} onRetry={() => refetch()} /></div> : null}
    {loading && !statement ? <div className="p-4"><QueryLoading label="Loading statement..." /></div> : null}
    {statement ? <>
      <div className="grid gap-px bg-[var(--line)] sm:grid-cols-4">{[
        ['Opening balance', statement.openingBalance], ['Debits', statement.totalDebit], ['Credits', statement.totalCredit], ['Closing balance', statement.closingBalance],
      ].map(([label, value]) => <div key={String(label)} className="bg-[var(--surface)] px-4 py-3"><p className="text-xs font-bold uppercase tracking-[0.1em] text-[var(--ink-4)]">{label}</p><p className="mt-1 font-bold tabular-nums text-[var(--ink)]">{money(Number(value || 0))}</p></div>)}</div>
      <div className="max-h-80 overflow-auto"><table className="mp-table-skin w-full min-w-[680px] text-sm"><thead className="sticky top-0 bg-[var(--surface)] text-left text-xs font-bold uppercase tracking-[0.1em] text-[var(--ink-4)]"><tr><th scope="col" className="px-4 py-3">Date</th><th scope="col" className="px-4 py-3">Document</th><th scope="col" className="px-4 py-3">Narration</th><th scope="col" className="px-4 py-3 text-right">Debit</th><th scope="col" className="px-4 py-3 text-right">Credit</th><th scope="col" className="px-4 py-3 text-right">Balance</th></tr></thead>
        <tbody className="divide-y divide-[var(--line)]">
          <tr className="bg-[var(--bg-soft)]"><td className="px-4 py-2 text-[var(--ink-4)]" colSpan={5}>{page === 1 ? 'Opening balance' : 'Brought forward'}</td><td className="px-4 py-2 text-right font-semibold tabular-nums">{money(statement.pageOpeningBalance)}</td></tr>
          {(statement.entries || []).map((entry: any) => <tr key={entry.id}><td className="px-4 py-3 text-[var(--ink-4)]">{date(entry.effectiveAt)}</td><td className="px-4 py-3 text-xs font-bold uppercase text-[var(--ink-3)]">{entry.sourceLabel}</td><td className="px-4 py-3 text-[var(--ink-2)]">{entry.narration}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{Number(entry.debit) ? money(entry.debit) : '-'}</td><td className="px-4 py-3 text-right font-semibold tabular-nums text-emerald-700">{Number(entry.credit) ? money(entry.credit) : '-'}</td><td className="px-4 py-3 text-right tabular-nums">{money(entry.runningBalance)}</td></tr>)}
          {!(statement.entries || []).length ? <tr><td colSpan={6} className="px-4 py-6 text-center text-[var(--ink-4)]">No entries in these dates.</td></tr> : null}
        </tbody></table></div>
      <div className="border-t border-[var(--line)] px-4"><Pager page={page} pageSize={pageSize} total={Number(statement.total || 0)} onPageChange={setPage} itemLabel="entries" /></div>
    </> : null}
  </section>;
}
