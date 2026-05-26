'use client';

import Link from 'next/link';
import { gql, useQuery } from '@apollo/client';
import { FileText, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryErrorBanner, QueryLoading } from '@/components/query-state';

const DATA = gql`
  query DocumentCenter {
    documentJobs(take: 160)
    productionReadinessSummary
  }
`;

function tone(status?: string) {
  if (String(status).includes('generated')) return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  if (status === 'failed') return 'bg-red-50 text-red-700 ring-red-200';
  return 'bg-amber-50 text-amber-700 ring-amber-200';
}

export default function DocumentCenterPage() {
  const { data, loading, error, refetch } = useQuery(DATA, { fetchPolicy: 'cache-and-network' });
  const jobs: any[] = data?.documentJobs || [];
  const summary = data?.productionReadinessSummary || {};

  return (
    <div className="space-y-6 pb-10">
      <section className="rounded-r6 border border-[var(--line)] bg-[var(--surface)] p-6 shadow-sm-soft">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-4)]">Document center</p>
            <h1 className="mt-2 font-display text-3xl font-bold tracking-[-0.02em] text-[var(--ink)]">Quote, sales order, challan and proof documents now have tracked generation records.</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-3)]">Use this page to spot missing PDFs before the customer or dispatch team is blocked.</p>
          </div>
          <Button onClick={() => refetch()} variant="outline"><RefreshCw className="mr-2 h-4 w-4" /> Refresh</Button>
        </div>
      </section>

      {error && !data ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
      {loading && !jobs.length ? <QueryLoading label="Loading documents..." /> : null}

      <section className="grid gap-3 md:grid-cols-4">
        {[
          ['Readiness score', `${summary.score || 0}%`],
          ['Document jobs', summary.documents?.documentJobs || jobs.length],
          ['Payment receipts', summary.payments?.paymentReceipts || 0],
          ['Dispatch records', (summary.dispatch?.dispatchLines || 0) + (summary.dispatch?.shipments || 0)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-r5 border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm-soft">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-4)]">{label}</p>
            <p className="mt-2 font-display text-3xl font-bold text-[var(--ink)]">{value}</p>
          </div>
        ))}
      </section>

      <section className="mp-panel overflow-hidden">
        <div className="border-b border-[var(--line)] p-5">
          <div className="flex items-center gap-2"><FileText className="h-5 w-5 text-[var(--brand-700)]" /><h2 className="text-xl font-bold text-[var(--ink)]">Tracked documents</h2></div>
        </div>
        <div className="divide-y divide-[var(--line)]">
          {jobs.map((job) => (
            <div key={job.id} className="grid gap-3 p-4 md:grid-cols-[1fr_auto] md:items-center">
              <div>
                <p className="text-sm font-bold text-[var(--ink)]">{job.documentType} · {job.entityType}</p>
                <p className="mt-1 text-xs font-medium text-[var(--ink-4)]">{job.entityId} · {new Date(job.updatedAt || job.createdAt).toLocaleString()}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ring-1 ${tone(job.status)}`}>{job.status}</span>
                {job.url ? <Button asChild size="sm" variant="outline"><Link href={job.url} target="_blank">Open PDF</Link></Button> : null}
              </div>
            </div>
          ))}
          {!jobs.length && !loading ? (
            <div className="p-10 text-center">
              <ShieldCheck className="mx-auto h-10 w-10 text-emerald-600" />
              <p className="mt-3 text-sm font-semibold text-[var(--ink-3)]">No document jobs yet. New quotes and sales orders will create records here.</p>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
