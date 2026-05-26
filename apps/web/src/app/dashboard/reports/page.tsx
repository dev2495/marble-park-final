'use client';

import { useState } from 'react';
import { gql, useApolloClient, useQuery } from '@apollo/client';
import { BarChart3, Boxes, Clock, Download, FileSpreadsheet, TrendingUp, Users, Wallet } from 'lucide-react';
import { QueryErrorBanner } from '@/components/query-state';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { HelpButton } from '@/components/help/help-button';

const REPORT_QUERIES = gql`
  query Reports($from: DateTime, $to: DateTime, $days: Int) {
    reportMonthlySalesByCategory(from: $from, to: $to)
    reportTopCustomers(from: $from, to: $to, limit: 25)
    reportDeadStock(days: $days)
    reportConversionFunnel(from: $from, to: $to)
    reportPendingDispatchAgeing
    reportReceivablesAgeing
  }
`;

const REPORT_CSV = gql`
  query ReportCsv($kind: String!, $from: DateTime, $to: DateTime, $limit: Int, $days: Int) {
    reportCsv(kind: $kind, from: $from, to: $to, limit: $limit, days: $days)
  }
`;

const TABS: Array<{ id: string; label: string; icon: any; field: string; kind: string }> = [
  { id: 'sales', label: 'Monthly sales', icon: TrendingUp, field: 'reportMonthlySalesByCategory', kind: 'monthly_sales_by_category' },
  { id: 'top', label: 'Top customers', icon: Users, field: 'reportTopCustomers', kind: 'top_customers' },
  { id: 'dead', label: 'Dead stock', icon: Boxes, field: 'reportDeadStock', kind: 'dead_stock' },
  { id: 'funnel', label: 'Conversion funnel', icon: BarChart3, field: 'reportConversionFunnel', kind: 'conversion_funnel' },
  { id: 'dispatch', label: 'Dispatch ageing', icon: Clock, field: 'reportPendingDispatchAgeing', kind: 'pending_dispatch_ageing' },
  { id: 'recv', label: 'Receivables', icon: Wallet, field: 'reportReceivablesAgeing', kind: 'receivables_ageing' },
];

export default function ReportsPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [days, setDays] = useState('90');
  const [tab, setTab] = useState(TABS[0].id);
  const client = useApolloClient();

  const { data, loading, error, refetch } = useQuery(REPORT_QUERIES, {
    variables: {
      from: from ? new Date(from).toISOString() : null,
      to: to ? new Date(to).toISOString() : null,
      days: Number(days || 90),
    },
  });

  const active = TABS.find((t) => t.id === tab)!;
  const rows: any[] = data?.[active.field] || [];

  const handleDownload = async () => {
    const result = await client.query({
      query: REPORT_CSV,
      variables: {
        kind: active.kind,
        from: from ? new Date(from).toISOString() : null,
        to: to ? new Date(to).toISOString() : null,
        days: Number(days || 90),
        limit: 500,
      },
      fetchPolicy: 'network-only',
    });
    const csv: string = result?.data?.reportCsv || '';
    const blob = new Blob([csv || ''], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${active.kind}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const headers = rows[0] ? Object.keys(rows[0]) : [];

  return (
    <div className="space-y-6 pb-10">
      <section className="rounded-r5 border border-[var(--line)] bg-gradient-to-br from-indigo-50 via-white to-indigo-50/40 p-6 shadow-sm-soft">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-indigo-700">Operational analytics</p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-[var(--ink)]">Reports</h1>
            <p className="mt-2 max-w-2xl text-sm text-[var(--ink-3)]">
              Monthly sales, top customers, dead stock, conversion funnel, dispatch ageing, receivables ageing — all live, all exportable.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <HelpButton topicId="reports" variant="inline" label="Help" />
            <FileSpreadsheet className="h-10 w-10 text-indigo-500/60" />
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-4">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--ink-5)]">From</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--ink-5)]">To</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--ink-5)]">Dead-stock window (days)</label>
            <Input type="number" value={days} onChange={(e) => setDays(e.target.value)} />
          </div>
          <div className="self-end">
            <Button onClick={handleDownload} className="w-full">
              <Download className="mr-2 h-4 w-4" /> Download CSV
            </Button>
          </div>
        </div>
      </section>

      <section className="rounded-r5 border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm-soft">
        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={
                tab === t.id
                  ? 'inline-flex items-center gap-2 rounded-full bg-[var(--brand-600)] px-3 py-1.5 text-xs font-semibold text-white'
                  : 'inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-2)] hover:bg-[var(--bg-soft)]'
              }
            >
              <t.icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          ))}
        </div>

        {error && !data ? <div className="mt-4"><QueryErrorBanner error={error} onRetry={() => refetch()} /></div> : null}

        <div className="mt-5 overflow-x-auto">
          {loading && !rows.length ? (
            <p className="rounded-r4 border border-dashed border-[var(--line)] p-8 text-center text-sm text-[var(--ink-4)]">Loading report…</p>
          ) : rows.length === 0 ? (
            <p className="rounded-r4 border border-dashed border-[var(--line)] p-8 text-center text-sm text-[var(--ink-4)]">No data in this range.</p>
          ) : (
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-[var(--line)] text-left text-[10px] font-bold uppercase tracking-widest text-[var(--ink-5)]">
                <tr>
                  {headers.map((h) => (
                    <th key={h} className="py-2 pr-3">{h.replace(/([A-Z])/g, ' $1').trim()}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any, i: number) => (
                  <tr key={i} className="border-b border-[var(--line)] last:border-0 hover:bg-[var(--bg-soft)]/30">
                    {headers.map((h) => (
                      <td key={h} className="py-2 pr-3 text-xs text-[var(--ink-2)]">
                        {typeof r[h] === 'number' && /amount|total|revenue|received|balance/i.test(h)
                          ? `₹${Number(r[h]).toLocaleString('en-IN')}`
                          : typeof r[h] === 'object'
                            ? JSON.stringify(r[h])
                            : String(r[h] ?? '')}
                      </td>
                    ))}
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
