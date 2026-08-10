'use client';

import { gql, useQuery } from '@apollo/client';
import { useState } from 'react';
import { MapPinned, Warehouse } from 'lucide-react';
import { QueryErrorBanner, QueryLoading } from '@/components/query-state';

const DATA = gql`
  query StockLedgerPage($skip: Int, $take: Int) {
    stockLocations
    stockLedgerEntries(skip: $skip, take: $take)
  }
`;

export default function StockLedgerPage() {
  const [page, setPage] = useState(0);
  const pageSize = 100;
  const { data, loading, error, refetch } = useQuery(DATA, { variables: { skip: page * pageSize, take: pageSize + 1 }, fetchPolicy: 'cache-and-network' });
  const locations: any[] = data?.stockLocations || [];
  const ledgerPage: any[] = data?.stockLedgerEntries || [];
  const ledger = ledgerPage.slice(0, pageSize);
  const hasNext = ledgerPage.length > pageSize;

  return (
    <div className="space-y-6 pb-10">
      <section className="rounded-r6 border border-[var(--line)] bg-[var(--surface)] p-6 shadow-sm-soft">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-4)]">Stock ledger</p>
        <h1 className="mt-2 font-display text-3xl font-bold tracking-[-0.02em] text-[var(--ink)]">Every GRN, dispatch, return and count variance lands in one movement trail.</h1>
      </section>
      <div className="flex items-center justify-between"><button type="button" disabled={page === 0 || loading} onClick={() => setPage((value) => Math.max(0, value - 1))} className="rounded-md border border-[var(--line)] bg-[var(--surface)] px-4 py-2 text-sm font-bold disabled:opacity-40">Previous</button><span className="text-xs font-bold uppercase tracking-wider text-[var(--ink-4)]">Ledger page {page + 1}</span><button type="button" disabled={!hasNext || loading} onClick={() => setPage((value) => value + 1)} className="rounded-md border border-[var(--line)] bg-[var(--surface)] px-4 py-2 text-sm font-bold disabled:opacity-40">Next</button></div>

      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
      {loading && !ledger.length ? <QueryLoading label="Loading stock ledger..." /> : null}

      <section className="grid gap-3 md:grid-cols-3">
        {locations.map((location) => (
          <div key={location.id} className="rounded-r5 border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm-soft">
            <Warehouse className="h-5 w-5 text-[var(--brand-700)]" />
            <p className="mt-3 text-lg font-bold text-[var(--ink)]">{location.name}</p>
            <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">{location.code} · {location.type}</p>
          </div>
        ))}
      </section>

      <section className="mp-panel overflow-hidden">
        <div className="border-b border-[var(--line)] p-5">
          <div className="flex items-center gap-2"><MapPinned className="h-5 w-5 text-[var(--brand-700)]" /><h2 className="text-xl font-bold text-[var(--ink)]">Movement history</h2></div>
        </div>
        <div className="divide-y divide-[var(--line)]">
          {ledger.map((entry) => (
            <div key={entry.id} className="grid gap-2 p-4 md:grid-cols-[1fr_auto] md:items-center">
              <div>
                <p className="text-sm font-bold text-[var(--ink)]">{entry.product?.sku || 'No SKU'} · {entry.product?.name || entry.type}</p>
                <p className="mt-1 text-xs font-medium text-[var(--ink-4)]">{entry.reason} · {entry.sourceDocumentNo || entry.referenceId || 'manual'} · {new Date(entry.createdAt).toLocaleString()}</p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${entry.direction === 'in' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{entry.direction === 'in' ? '+' : '-'}{entry.quantity}</span>
            </div>
          ))}
          {!ledger.length && !loading ? <div className="p-10 text-center text-sm font-semibold text-[var(--ink-4)]">No ledger entries yet.</div> : null}
        </div>
      </section>
    </div>
  );
}
