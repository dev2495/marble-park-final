'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { gql, useMutation, useQuery } from '@apollo/client';
import { ArrowLeft, Plus, Receipt, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QueryErrorBanner } from '@/components/query-state';
import { HelpButton } from '@/components/help/help-button';

const ORDER_DETAIL = gql`
  query OrderDetail($id: ID!, $salesOrderId: String!) {
    salesOrder(id: $id)
    orderPaymentSummary(salesOrderId: $salesOrderId)
    paymentsForOrder(salesOrderId: $salesOrderId) {
      id amount mode reference notes paidAt direction recordedBy
    }
  }
`;

const RECORD_PAYMENT = gql`
  mutation RecordPayment($input: RecordPaymentInput!) {
    recordPayment(input: $input) { id }
  }
`;

const DELETE_PAYMENT = gql`
  mutation DeletePayment($id: ID!) {
    deletePayment(id: $id)
  }
`;

const MODES = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'transfer', label: 'Bank transfer' },
  { value: 'card', label: 'Card' },
  { value: 'finance', label: 'Finance / EMI' },
  { value: 'other', label: 'Other' },
];

function money(n: number) {
  return `₹${Math.round(Number(n || 0)).toLocaleString('en-IN')}`;
}

export default function SalesOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id || '';
  const { data, loading, error, refetch } = useQuery(ORDER_DETAIL, { variables: { id, salesOrderId: id }, skip: !id });
  const [recordPayment, { loading: recording, error: recordError }] = useMutation(RECORD_PAYMENT, { onCompleted: () => refetch() });
  const [deletePayment] = useMutation(DELETE_PAYMENT, { onCompleted: () => refetch() });
  const [form, setForm] = useState({ amount: '', mode: 'cash', reference: '', notes: '', direction: 'incoming' });

  const order: any = data?.salesOrder;
  const summary: any = data?.orderPaymentSummary;
  const payments = data?.paymentsForOrder || [];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.amount || Number(form.amount) <= 0) return;
    await recordPayment({
      variables: {
        input: {
          salesOrderId: id,
          amount: Number(form.amount),
          mode: form.mode,
          reference: form.reference || null,
          notes: form.notes || null,
          direction: form.direction,
        },
      },
    });
    setForm({ amount: '', mode: 'cash', reference: '', notes: '', direction: 'incoming' });
  };

  if (loading && !order) return <p className="p-8 text-sm text-[var(--ink-4)]">Loading order…</p>;
  if (error && !order) return <QueryErrorBanner error={error} onRetry={() => refetch()} />;
  if (!order) return <p className="p-8 text-sm text-[var(--ink-4)]">Order not found.</p>;

  return (
    <div className="space-y-6 pb-10">
      <div className="flex items-center justify-between">
        <Link href="/dashboard/orders" className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--ink-3)] hover:text-[var(--ink)]">
          <ArrowLeft className="h-4 w-4" /> Back to orders
        </Link>
        <HelpButton topicId="orders" variant="inline" label="Help" />
      </div>

      <section className="rounded-r5 border border-[var(--line)] bg-[var(--surface)] p-6 shadow-sm-soft">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-[var(--brand-700)]">Sales order</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-[var(--ink)]">{order.orderNumber}</h1>
            <p className="text-sm text-[var(--ink-3)]">{new Date(order.createdAt).toLocaleString()}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--ink-5)]">Total</p>
            <p className="text-3xl font-bold text-[var(--ink)]">{money(order.totalAmount)}</p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-4">
          <div className="rounded-r3 border border-[var(--line)] bg-[var(--bg-soft)] p-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--ink-5)]">Received</p>
            <p className="text-lg font-bold text-emerald-700">{money(summary?.received || 0)}</p>
          </div>
          <div className="rounded-r3 border border-[var(--line)] bg-[var(--bg-soft)] p-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--ink-5)]">Refunded</p>
            <p className="text-lg font-bold text-red-700">{money(summary?.refunded || 0)}</p>
          </div>
          <div className="rounded-r3 border border-[var(--line)] bg-[var(--bg-soft)] p-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--ink-5)]">Balance</p>
            <p className="text-lg font-bold text-[var(--ink)]">{money(summary?.balance || 0)}</p>
          </div>
          <div className="rounded-r3 border border-[var(--line)] bg-[var(--bg-soft)] p-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--ink-5)]">Status</p>
            <p className="text-lg font-bold capitalize text-[var(--ink)]">{order.paymentStatus}</p>
          </div>
        </div>
      </section>

      <section className="rounded-r5 border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm-soft">
        <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--ink)]">Record payment</h2>
        <form onSubmit={submit} className="mt-4 grid gap-3 md:grid-cols-5">
          <Input type="number" min="0" step="0.01" required placeholder="Amount (₹)" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          <select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })} className="h-9 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2 text-sm text-[var(--ink)]">
            {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <Input placeholder="Reference (txn id, cheque #)" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
          <select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })} className="h-9 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2 text-sm text-[var(--ink)]">
            <option value="incoming">Incoming</option>
            <option value="refund">Refund</option>
          </select>
          <Button type="submit" disabled={recording || !form.amount}><Plus className="mr-2 h-4 w-4" /> {recording ? 'Saving…' : 'Record'}</Button>
          <Input placeholder="Notes (optional)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="md:col-span-5" />
        </form>
        {recordError ? <div className="mt-3"><QueryErrorBanner error={recordError} /></div> : null}
      </section>

      <section className="rounded-r5 border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm-soft">
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-[var(--ink)]">
          <Receipt className="h-4 w-4" /> Payment history
        </h2>
        <div className="mt-4 overflow-x-auto">
          {payments.length === 0 ? (
            <div className="rounded-r4 border border-dashed border-[var(--line)] p-8 text-center text-sm text-[var(--ink-4)]">
              <Wallet className="mx-auto mb-2 h-6 w-6 text-[var(--ink-4)]" />
              No payments yet. Record the first above.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-[var(--line)] text-left text-[10px] font-bold uppercase tracking-widest text-[var(--ink-5)]">
                <tr>
                  <th className="py-2">When</th>
                  <th>Direction</th>
                  <th>Mode</th>
                  <th>Reference</th>
                  <th className="text-right">Amount</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p: any) => (
                  <tr key={p.id} className="border-b border-[var(--line)] last:border-0">
                    <td className="py-2 text-xs text-[var(--ink-3)]">{new Date(p.paidAt).toLocaleString()}</td>
                    <td>
                      <span className={p.direction === 'refund' ? 'rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-red-700' : 'rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-emerald-700'}>{p.direction}</span>
                    </td>
                    <td className="text-xs capitalize text-[var(--ink-2)]">{p.mode}</td>
                    <td className="text-xs font-mono text-[var(--ink-3)]">{p.reference || '—'}</td>
                    <td className="text-right text-sm font-bold text-[var(--ink)]">{p.direction === 'refund' ? '−' : '+'}{money(p.amount)}</td>
                    <td className="text-right">
                      <button
                        type="button"
                        onClick={() => deletePayment({ variables: { id: p.id } })}
                        className="text-[10px] font-bold uppercase tracking-widest text-red-700 hover:underline"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
