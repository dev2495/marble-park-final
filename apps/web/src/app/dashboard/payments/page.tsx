'use client';

import { gql, useQuery } from '@apollo/client';
import { CreditCard, IndianRupee } from 'lucide-react';
import { QueryErrorBanner, QueryLoading } from '@/components/query-state';

const DATA = gql`
  query PaymentsPage {
    paymentReceipts(take: 160)
    salesOrderStats(range: "month")
  }
`;

function money(value: number) {
  return `₹${Math.round(Number(value || 0)).toLocaleString('en-IN')}`;
}

function statusTone(status?: string) {
  if (status === 'posted') return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  if (status === 'credit_due') return 'bg-amber-50 text-amber-800 ring-amber-200';
  return 'bg-zinc-50 text-zinc-700 ring-zinc-200';
}

export default function PaymentsPage() {
  const { data, loading, error, refetch } = useQuery(DATA, { fetchPolicy: 'cache-and-network' });
  const receipts: any[] = data?.paymentReceipts || [];
  const stats = data?.salesOrderStats || {};
  const totalCollected = receipts.filter((row) => row.status === 'posted').reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const creditDue = receipts.filter((row) => row.status === 'credit_due').length;

  return (
    <div className="space-y-6 pb-10">
      <section className="rounded-r6 border border-[var(--line)] bg-[var(--surface)] p-6 shadow-sm-soft">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-4)]">Payment ledger</p>
        <h1 className="mt-2 font-display text-3xl font-bold tracking-[-0.02em] text-[var(--ink)]">Cash, advance and credit orders are tracked separately.</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-3)]">This closes the audit gap where confirmed demand existed without a ledger-level payment trail.</p>
      </section>

      {error && !data ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
      {loading && !receipts.length ? <QueryLoading label="Loading payment ledger..." /> : null}

      <section className="grid gap-3 md:grid-cols-4">
        {[
          ['Month order value', money(stats.totalValue || 0), IndianRupee],
          ['Cash value', money(stats.cashValue || 0), CreditCard],
          ['Credit value', money(stats.creditValue || 0), CreditCard],
          ['Credit due rows', creditDue, CreditCard],
        ].map(([label, value, Icon]: any) => (
          <div key={label} className="rounded-r5 border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm-soft">
            <Icon className="h-5 w-5 text-[var(--brand-700)]" />
            <p className="mt-3 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-4)]">{label}</p>
            <p className="mt-2 font-display text-3xl font-bold text-[var(--ink)]">{value}</p>
          </div>
        ))}
      </section>

      <section className="mp-panel overflow-hidden">
        <div className="border-b border-[var(--line)] p-5">
          <h2 className="text-xl font-bold text-[var(--ink)]">Receipts and credit ledger</h2>
          <p className="mt-1 text-sm text-[var(--ink-4)]">Collected total: {money(totalCollected)}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-[var(--bg-soft)] text-left text-[11px] font-bold uppercase tracking-wider text-[var(--ink-4)]">
              <tr><th className="px-4 py-3">Receipt</th><th className="px-4 py-3">Order</th><th className="px-4 py-3">Mode</th><th className="px-4 py-3 text-right">Amount</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Date</th></tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {receipts.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3 font-bold text-[var(--ink)]">{row.receiptNumber}</td>
                  <td className="px-4 py-3 text-[var(--ink-3)]">{row.metadata?.orderNumber || row.salesOrderId}</td>
                  <td className="px-4 py-3 capitalize">{row.paymentMode}</td>
                  <td className="px-4 py-3 text-right font-bold tabular-nums">{money(row.amount)}</td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ring-1 ${statusTone(row.status)}`}>{row.status}</span></td>
                  <td className="px-4 py-3 text-[var(--ink-4)]">{new Date(row.receivedAt).toLocaleDateString()}</td>
                </tr>
              ))}
              {!receipts.length && !loading ? <tr><td colSpan={6} className="px-4 py-10 text-center text-[var(--ink-4)]">No payment records yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
