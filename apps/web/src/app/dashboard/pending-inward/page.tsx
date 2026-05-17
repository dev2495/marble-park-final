'use client';

import Link from 'next/link';
import { gql, useQuery } from '@apollo/client';
import { Boxes, CheckCircle2, Clock, PackageSearch, Truck } from 'lucide-react';
import { QueryErrorBanner } from '@/components/query-state';
import { Button } from '@/components/ui/button';

const PENDING_INWARD = gql`
  query PendingInward {
    pendingInwardItems(take: 250)
  }
`;

function money(value: number) {
  return `₹${Number(value || 0).toLocaleString('en-IN')}`;
}

export default function PendingInwardPage() {
  const { data, loading, error, refetch } = useQuery(PENDING_INWARD, { pollInterval: 30000 });
  const rows = data?.pendingInwardItems || [];
  const totalQty = rows.reduce((sum: number, row: any) => sum + Number(row.quantity || 0), 0);
  const readyQty = rows.reduce((sum: number, row: any) => sum + Number(row.available || 0), 0);

  return (
    <div className="space-y-6 pb-10">
      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}

      <section className="relative overflow-hidden rounded-r6 border border-[var(--line)] bg-gradient-to-br from-amber-50 via-white to-blue-50 p-6 shadow-sm-soft">
        <div className="absolute right-8 top-6 h-28 w-28 rounded-full bg-amber-300/30 blur-3xl" />
        <div className="relative flex flex-col justify-between gap-6 xl:flex-row xl:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-4)]">Sales confirmed, stock pending</p>
            <h1 className="mt-3 font-display text-3xl font-bold tracking-[-0.03em] text-[var(--ink)]">Pending inward orders.</h1>
            <p className="mt-3 max-w-3xl text-sm font-medium leading-6 text-[var(--ink-3)]">
              These rows are already confirmed in sales orders but are blocked until matching stock is received. When GRN inward is posted, the system auto-reserves the item and notifies sales plus dispatch.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-r4 border border-[var(--line)] bg-white/80 p-4 shadow-sm-soft">
              <p className="text-2xl font-black text-[var(--ink)]">{rows.length}</p>
              <p className="text-[10px] font-black uppercase tracking-widest text-[var(--ink-4)]">Open rows</p>
            </div>
            <div className="rounded-r4 border border-[var(--line)] bg-white/80 p-4 shadow-sm-soft">
              <p className="text-2xl font-black text-[var(--ink)]">{totalQty}</p>
              <p className="text-[10px] font-black uppercase tracking-widest text-[var(--ink-4)]">Qty ordered</p>
            </div>
            <div className="rounded-r4 border border-[var(--line)] bg-white/80 p-4 shadow-sm-soft">
              <p className="text-2xl font-black text-emerald-700">{readyQty}</p>
              <p className="text-[10px] font-black uppercase tracking-widest text-[var(--ink-4)]">Now available</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4">
        {loading ? (
          <div className="mp-card rounded-r5 p-8 text-sm font-bold text-[var(--ink-3)]">Loading pending inward rows...</div>
        ) : rows.length ? (
          rows.map((row: any) => (
            <article key={row.reservationId} className="mp-card rounded-r5 p-5">
              <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex min-w-0 gap-4">
                  <div className="grid h-12 w-12 shrink-0 place-items-center rounded-r4 bg-amber-50 text-amber-700">
                    <PackageSearch className="h-6 w-6" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-lg font-black text-[var(--ink)]">{row.sku} · {row.name}</p>
                    <p className="mt-1 text-sm font-semibold text-[var(--ink-3)]">
                      {row.brand || 'Brand'} · {row.category || 'Category'} · {row.finish || 'Standard'}
                    </p>
                    <p className="mt-2 text-xs font-bold uppercase tracking-wider text-[var(--ink-4)]">
                      {row.orderNumber || 'Order pending'} · {row.quoteNumber || 'Quote'} · {row.customer?.name || 'Customer'}
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-4 xl:min-w-[38rem]">
                  <div className="rounded-r4 border border-[var(--line)] bg-[var(--surface)] p-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-[var(--ink-4)]">Ordered</p>
                    <p className="mt-1 text-xl font-black text-[var(--ink)]">{row.quantity}</p>
                  </div>
                  <div className="rounded-r4 border border-[var(--line)] bg-[var(--surface)] p-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-[var(--ink-4)]">Available</p>
                    <p className="mt-1 text-xl font-black text-emerald-700">{row.available}</p>
                  </div>
                  <div className="rounded-r4 border border-[var(--line)] bg-[var(--surface)] p-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-[var(--ink-4)]">Shortage</p>
                    <p className="mt-1 text-xl font-black text-rose-700">{row.shortage}</p>
                  </div>
                  <div className="rounded-r4 border border-[var(--line)] bg-[var(--surface)] p-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-[var(--ink-4)]">Value</p>
                    <p className="mt-1 text-xl font-black text-[var(--ink)]">{money(Number(row.quantity || 0) * Number(row.sellPrice || 0))}</p>
                  </div>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <Link href="/dashboard/inventory/inwards"><Boxes className="mr-2 h-4 w-4" /> Post GRN inward</Link>
                </Button>
                <Button asChild size="sm" variant="secondary">
                  <Link href="/dashboard/dispatch"><Truck className="mr-2 h-4 w-4" /> Dispatch board</Link>
                </Button>
                {row.leadId ? (
                  <Button asChild size="sm" variant="secondary">
                    <Link href={`/dashboard/leads/${row.leadId}`}><Clock className="mr-2 h-4 w-4" /> Lead trail</Link>
                  </Button>
                ) : null}
              </div>
            </article>
          ))
        ) : (
          <div className="mp-card grid min-h-[22rem] place-items-center rounded-r5 p-8 text-center">
            <div>
              <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />
              <h2 className="mt-4 font-display text-2xl font-black text-[var(--ink)]">No pending inward rows.</h2>
              <p className="mt-2 text-sm font-medium text-[var(--ink-3)]">Confirmed orders are either fully reserved or already dispatched.</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
