'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { gql, useQuery } from '@apollo/client';
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryErrorBanner, QueryLoading } from '@/components/query-state';
import { StockControlWorkspace } from '@/components/inventory/stock-control-workspace';
import { cn } from '@/lib/utils';

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
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [expandedId, setExpandedId] = useState('');
  const { data, loading, error, refetch } = useQuery(RECONCILIATION, { variables: { take: 5000 }, fetchPolicy: 'cache-and-network' });
  const report = data?.stockReconciliation || {};
  const summary = report.summary || {};
  const rows = useMemo<any[]>(() => report.rows || [], [report.rows]);
  const filteredRows = useMemo(() => rows.filter((row) => {
    if (status !== 'all' && row.status !== status) return false;
    const haystack = [row.sku, row.name, row.brand, row.category, ...(row.issues || []).flatMap((issue: any) => [issue.code, issue.message])].filter(Boolean).join(' ').toLowerCase();
    return !search.trim() || haystack.includes(search.trim().toLowerCase());
  }), [rows, search, status]);
  const issueGroups = useMemo(() => {
    const grouped = new Map<string, { code: string; severity: string; count: number }>();
    rows.forEach((row) => (row.issues || []).forEach((issue: any) => {
      const current = grouped.get(issue.code) || { code: issue.code, severity: issue.severity, count: 0 };
      current.count += 1;
      grouped.set(issue.code, current);
    }));
    return Array.from(grouped.values()).sort((a, b) => b.count - a.count).slice(0, 6);
  }, [rows]);

  useEffect(() => {
    const productId = new URLSearchParams(window.location.search).get('productId');
    if (productId) setExpandedId(productId);
  }, []);

  return (
    <StockControlWorkspace
      title="Stock reconciliation"
      description="An exception-first proof desk that compares aggregate, location, lot, reservation, order and ledger truth—then gives the operator a direct investigation trail for every mismatch."
      action={<Button onClick={() => refetch()} variant="outline"><RefreshCw className="mr-2 h-4 w-4"/>Refresh check</Button>}
      metrics={[
        { label: 'Checked', value: number(summary.productsChecked), note: report.generatedAt ? new Date(report.generatedAt).toLocaleString('en-IN') : 'Checking now' },
        { label: 'Clean', value: number(summary.ok), note: 'All sources aligned', tone: 'success' },
        { label: 'Warnings', value: number(summary.warnings), note: 'Review before next close', tone: Number(summary.warnings || 0) ? 'warning' : 'success' },
        { label: 'Critical', value: number(summary.critical), note: Number(summary.critical || 0) ? 'Stop and resolve' : 'No blocking mismatch', tone: Number(summary.critical || 0) ? 'danger' : 'success' },
        { label: 'Rows shown', value: number(filteredRows.length), note: search || status !== 'all' ? 'Matching current filters' : summary.mismatched ? 'Exceptions first' : 'Clean verification sample', tone: 'info' },
      ]}
    >

      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
      {loading && !rows.length ? <QueryLoading label="Reconciling stock buckets..." /> : null}

      <section className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {issueGroups.map((issue) => <button key={issue.code} type="button" onClick={() => { setSearch(issue.code); setStatus(issue.severity); }} className="rounded-r4 border border-[var(--line)] bg-[var(--surface)] p-4 text-left shadow-sm-soft transition-all hover:-translate-y-0.5 hover:border-[var(--brand-200)]"><div className="flex items-center justify-between"><span className={issue.severity === 'critical' ? 'text-red-700' : 'text-amber-700'}>{issue.severity === 'critical' ? <AlertTriangle className="h-4 w-4"/> : <Search className="h-4 w-4"/>}</span><span className="text-xl font-black tabular-nums text-[var(--ink)]">{issue.count}</span></div><p className="mt-3 break-words text-[10px] font-black uppercase leading-4 tracking-wider text-[var(--ink-4)]">{issue.code.replaceAll('_', ' ')}</p></button>)}
        {!issueGroups.length ? <div className="col-span-full flex items-center gap-3 rounded-r4 border border-emerald-200 bg-emerald-50 p-4 text-emerald-900"><CheckCircle2 className="h-5 w-5"/><div><p className="font-black">All governed stock sources align</p><p className="text-xs">No mismatch family is present in this reconciliation run.</p></div></div> : null}
      </section>

      <section className="mp-card overflow-hidden rounded-r5 border border-[var(--line)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] p-5">
          <div>
            <h2 className="text-2xl font-black text-[var(--ink-1)]">{summary.mismatched ? 'Exception investigation register' : 'Verified stock sample'}</h2>
            <p className="mt-1 text-sm font-bold text-[var(--ink-4)]">Checked {number(summary.productsChecked)} products · showing {number(summary.returnedRows)} · generated {report.generatedAt ? new Date(report.generatedAt).toLocaleString() : 'now'} · click any row to inspect source math</p>
          </div>
          <span className={`rounded-full border px-3 py-1 text-xs font-black uppercase tracking-widest ${summary.critical ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
            {summary.critical ? 'Action needed' : 'Stock clean'}
          </span>
        </div>
        <div className="grid gap-2 border-b border-[var(--line)] bg-[var(--bg-soft)] p-3 sm:grid-cols-[minmax(16rem,1fr)_11rem_auto]">
          <label className="flex h-10 items-center rounded-md border border-[var(--line)] bg-[var(--surface)] px-3"><Search className="mr-2 h-4 w-4 text-[var(--ink-4)]"/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search SKU, product or issue" className="w-full bg-transparent text-sm outline-none"/></label>
          <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-10 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-semibold"><option value="all">All statuses</option><option value="critical">Critical</option><option value="warning">Warning</option><option value="ok">OK</option></select>
          {(search || status !== 'all') ? <Button type="button" variant="outline" onClick={() => { setSearch(''); setStatus('all'); }}>Clear filters</Button> : <span className="hidden sm:block"/>}
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
              {filteredRows.map((row) => (
                <Fragment key={row.productId}><tr className={cn('align-top hover:bg-[var(--bg-soft)]/70', expandedId === row.productId && 'bg-[var(--brand-50)]')}>
                  <td className="px-5 py-4">
                    <button type="button" aria-expanded={expandedId === row.productId} onClick={() => setExpandedId(expandedId === row.productId ? '' : row.productId)} className="rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-500)] focus-visible:ring-offset-2">
                      <p className="font-black text-[var(--ink-1)]">{row.sku || 'No SKU'}</p>
                      <p className="mt-1 max-w-xs text-sm font-semibold text-[var(--ink-3)]">{row.name}</p>
                      <p className="mt-1 text-xs font-black uppercase tracking-wider text-[var(--ink-4)]">{row.brand} · {row.category}</p>
                    </button>
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
                    <div className="flex items-center justify-between gap-2"><span className={`inline-flex rounded-full border px-3 py-1 text-xs font-black uppercase tracking-widest ${statusTone(row.status)}`}>{row.status}</span><button type="button" aria-label={`${expandedId === row.productId ? 'Collapse' : 'Inspect'} ${row.sku || row.name}`} aria-expanded={expandedId === row.productId} onClick={() => setExpandedId(expandedId === row.productId ? '' : row.productId)} className="rounded-md p-1 outline-none hover:bg-[var(--surface)] focus-visible:ring-2 focus-visible:ring-[var(--brand-500)]"><ChevronDown className={cn('h-4 w-4 text-[var(--ink-4)] transition-transform', expandedId === row.productId && 'rotate-180')}/></button></div>
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
                </tr>{expandedId === row.productId ? <tr className="bg-[var(--bg-soft)]/80"><td colSpan={6} className="p-5"><div className="grid gap-3 lg:grid-cols-4"><div className="rounded-r3 border border-[var(--line)] bg-[var(--surface)] p-4"><p className="text-[10px] font-black uppercase tracking-wider text-[var(--ink-4)]">Aggregate product</p><p className="mt-2 text-2xl font-black text-[var(--ink)]">{number(row.aggregate?.onHand)}</p><p className="text-xs text-[var(--ink-4)]">available {number(row.aggregate?.available)} · reserved {number(row.aggregate?.reserved)}</p></div><div className="rounded-r3 border border-[var(--line)] bg-[var(--surface)] p-4"><p className="text-[10px] font-black uppercase tracking-wider text-[var(--ink-4)]">Location total</p><p className="mt-2 text-2xl font-black text-[var(--ink)]">{number(row.location?.onHand)}</p><p className="text-xs text-[var(--ink-4)]">{number(row.location?.rowCount)} location row(s)</p></div><div className="rounded-r3 border border-[var(--line)] bg-[var(--surface)] p-4"><p className="text-[10px] font-black uppercase tracking-wider text-[var(--ink-4)]">Lot total</p><p className="mt-2 text-2xl font-black text-[var(--ink)]">{number(row.lots?.onHand)}</p><p className="text-xs text-[var(--ink-4)]">{number(row.lots?.rowCount)} physical lot balance(s)</p></div><div className="rounded-r3 border border-[var(--line)] bg-[var(--surface)] p-4"><p className="text-[10px] font-black uppercase tracking-wider text-[var(--ink-4)]">Reservation truth</p><p className="mt-2 text-2xl font-black text-[var(--ink)]">{number(row.reservations?.reserved)}</p><p className="text-xs text-[var(--ink-4)]">SO rows {number(row.salesOrderLines?.reserved)} reserved</p></div></div><div className="mt-4 flex flex-col justify-between gap-3 rounded-r3 border border-[var(--line)] bg-[var(--surface)] p-4 sm:flex-row sm:items-center"><div><p className="font-black text-[var(--ink)]">Recommended investigation</p><p className="mt-1 text-sm text-[var(--ink-4)]">Trace source documents for this product, verify the exact lot/location, then use a governed adjustment only when physical evidence confirms the correction.</p></div><Button asChild size="sm"><Link href={`/dashboard/inventory/ledger?productId=${row.productId}`}>Open product ledger<ArrowRight className="ml-2 h-4 w-4"/></Link></Button></div></td></tr> : null}</Fragment>
              ))}
              {!loading && filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-14 text-center text-sm font-bold text-[var(--ink-4)]">
                    {rows.length ? 'No reconciliation rows match these filters.' : 'No inventory balances yet. Stock will appear here when Product Master SKUs are received.'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </StockControlWorkspace>
  );
}
