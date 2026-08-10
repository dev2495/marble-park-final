'use client';

import { gql, useQuery } from '@apollo/client';
import { AlertTriangle, CheckCircle2, RefreshCw, Scale, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryErrorBanner, QueryLoading } from '@/components/query-state';

const RECONCILIATION = gql`
  query StockReconciliation($take: Int) {
    stockReconciliation(take: $take)
  }
`;

function number(value: unknown) {
  return Number(value || 0).toLocaleString('en-IN');
}

function statusTone(status: string) {
  if (status === 'critical') return 'border-red-200 bg-red-50 text-red-800';
  if (status === 'warning') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-emerald-200 bg-emerald-50 text-emerald-800';
}

export default function StockReconciliationPage() {
  const { data, loading, error, refetch } = useQuery(RECONCILIATION, { variables: { take: 5000 }, fetchPolicy: 'cache-and-network' });
  const report = data?.stockReconciliation || {};
  const summary = report.summary || {};
  const rows: any[] = report.rows || [];

  return (
    <div className="space-y-7 pb-10">
      <section className="mp-card relative overflow-hidden rounded-r6 border border-[var(--line)] p-7">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_14%_18%,rgba(59,130,246,0.16),transparent_30%),radial-gradient(circle_at_86%_12%,rgba(16,185,129,0.16),transparent_28%)]" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--ink-4)]">Inventory reconciliation</p>
            <h1 className="mt-3 max-w-4xl font-display text-4xl font-bold tracking-[-0.045em] text-[var(--ink-1)]">
              Prove aggregate, plant, reservation and ledger stock are aligned.
            </h1>
            <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-[var(--ink-3)]">
              Use this before client reviews, after imports, and after bulk GRN/dispatch activity. Critical rows mean stock math needs correction before dispatch promises are made.
            </p>
          </div>
          <Button onClick={() => refetch()} variant="outline">
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh check
          </Button>
        </div>
      </section>

      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
      {loading && !rows.length ? <QueryLoading label="Reconciling stock buckets..." /> : null}

      <section className="grid gap-4 md:grid-cols-4">
        {[
          { label: 'Checked', value: summary.productsChecked || 0, icon: Scale, tone: 'text-[#2563eb]' },
          { label: 'OK', value: summary.ok || 0, icon: CheckCircle2, tone: 'text-emerald-700' },
          { label: 'Warnings', value: summary.warnings || 0, icon: AlertTriangle, tone: 'text-amber-700' },
          { label: 'Critical', value: summary.critical || 0, icon: ShieldAlert, tone: 'text-red-700' },
        ].map((stat) => (
          <div key={stat.label} className="mp-card rounded-r5 border border-[var(--line)] p-5">
            <stat.icon className={`h-5 w-5 ${stat.tone}`} />
            <p className="mt-5 text-3xl font-black text-[var(--ink-1)]">{number(stat.value)}</p>
            <p className="mt-1 text-xs font-black uppercase tracking-widest text-[var(--ink-4)]">{stat.label}</p>
          </div>
        ))}
      </section>

      <section className="mp-card overflow-hidden rounded-r5 border border-[var(--line)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] p-5">
          <div>
            <h2 className="text-2xl font-semibold text-[var(--ink-1)]">{summary.mismatched ? 'Exception rows' : 'Clean sample'}</h2>
            <p className="mt-1 text-sm font-bold text-[var(--ink-4)]">Checked {number(summary.productsChecked)} products · showing {number(summary.returnedRows)} · generated {report.generatedAt ? new Date(report.generatedAt).toLocaleString() : 'now'}</p>
          </div>
          <span className={`rounded-full border px-3 py-1 text-xs font-black uppercase tracking-widest ${summary.critical ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
            {summary.critical ? 'Action needed' : 'Stock clean'}
          </span>
        </div>
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full min-w-[1020px] text-left">
            <thead className="text-xs font-black uppercase tracking-widest text-[var(--ink-4)]">
              <tr>
                <th className="px-5 py-4">SKU</th>
                <th className="px-5 py-4">Aggregate</th>
                <th className="px-5 py-4">Locations</th>
                <th className="px-5 py-4">Reservations</th>
                <th className="px-5 py-4">Ledger</th>
                <th className="px-5 py-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {rows.map((row) => (
                <tr key={row.productId} className="align-top hover:bg-[var(--bg-soft)]/70">
                  <td className="px-5 py-4">
                    <p className="font-black text-[var(--ink-1)]">{row.sku || 'No SKU'}</p>
                    <p className="mt-1 max-w-xs text-sm font-semibold text-[var(--ink-3)]">{row.name}</p>
                    <p className="mt-1 text-xs font-black uppercase tracking-wider text-[var(--ink-4)]">{row.brand} · {row.category}</p>
                  </td>
                  <td className="px-5 py-4 text-sm font-bold text-[var(--ink-3)]">
                    <p>On hand: <span className="text-[var(--ink-1)]">{number(row.aggregate?.onHand)}</span></p>
                    <p>Available: <span className="text-emerald-700">{number(row.aggregate?.available)}</span></p>
                    <p>Reserved: <span className="text-[#2563eb]">{number(row.aggregate?.reserved)}</span></p>
                    <p>Damaged: <span className="text-red-700">{number(row.aggregate?.damaged)}</span></p>
                  </td>
                  <td className="px-5 py-4 text-sm font-bold text-[var(--ink-3)]">
                    <p>Rows: <span className="text-[var(--ink-1)]">{number(row.location?.rowCount)}</span></p>
                    <p>On hand: <span className="text-[var(--ink-1)]">{number(row.location?.onHand)}</span></p>
                    <p>Reserved: <span className="text-[#2563eb]">{number(row.location?.reserved)}</span></p>
                    <p>Damaged: <span className="text-red-700">{number(row.location?.damaged)}</span></p>
                  </td>
                  <td className="px-5 py-4 text-sm font-bold text-[var(--ink-3)]">
                    <p>Reserved rows: <span className="text-[#2563eb]">{number(row.reservations?.reserved)}</span></p>
                    <p>Backordered: <span className="text-amber-700">{number(row.reservations?.backordered)}</span></p>
                    <p>SO reserved: <span className="text-[var(--ink-1)]">{number(row.salesOrderLines?.reserved)}</span></p>
                    <p>SO backorder: <span className="text-[var(--ink-1)]">{number(row.salesOrderLines?.backordered)}</span></p>
                  </td>
                  <td className="px-5 py-4 font-black text-[var(--ink-1)]">{number(row.ledgerEntries)}</td>
                  <td className="px-5 py-4">
                    <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-black uppercase tracking-widest ${statusTone(row.status)}`}>{row.status}</span>
                    {row.issues?.length ? (
                      <div className="mt-3 space-y-2">
                        {row.issues.map((issue: any) => (
                          <p key={issue.code} className="max-w-sm text-xs font-bold leading-5 text-[var(--ink-3)]">
                            <span className={issue.severity === 'critical' ? 'text-red-700' : 'text-amber-700'}>{issue.code}</span>: {issue.message}
                          </p>
                        ))}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-14 text-center text-sm font-bold text-[var(--ink-4)]">
                    No inventory balances yet. After the reset, client stock will appear here when Product Master SKUs are received.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
