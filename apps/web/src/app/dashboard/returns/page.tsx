'use client';

import { useMemo, useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import { RotateCcw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QueryErrorBanner, QueryLoading } from '@/components/query-state';

const DATA = gql`
  query ReturnsPage($search: String) {
    inventoryBalances(search: $search, take: 60) {
      id productId product { id sku name brand category }
    }
    returnOrders(take: 60)
  }
`;

const CREATE = gql`
  mutation CreateReturnOrder($input: ReturnOrderInput!) {
    createReturnOrder(input: $input)
  }
`;

export default function ReturnsPage() {
  const [search, setSearch] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [qty, setQty] = useState('1');
  const [reason, setReason] = useState('');
  const [disposition, setDisposition] = useState('inspect');
  const { data, loading, error, refetch } = useQuery(DATA, { variables: { search: search || undefined }, fetchPolicy: 'cache-and-network' });
  const [create, { loading: creating, error: createError }] = useMutation(CREATE, { onCompleted: () => { setQty('1'); setReason(''); setDisposition('inspect'); refetch(); } });

  const balances = useMemo<any[]>(() => data?.inventoryBalances || [], [data?.inventoryBalances]);
  const returns = useMemo<any[]>(() => data?.returnOrders || [], [data?.returnOrders]);
  const selected = useMemo(() => balances.find((row) => row.productId === selectedProductId) || balances[0], [balances, selectedProductId]);

  const submit = () => {
    if (!selected || !Number(qty || 0)) return;
    create({
      variables: {
        input: {
          reason: reason || 'Customer return',
          receive: true,
          lines: JSON.stringify([{ productId: selected.productId, sku: selected.product?.sku, name: selected.product?.name, quantity: Number(qty), disposition }]),
        },
      },
    });
  };

  return (
    <div className="space-y-6 pb-10">
      <section className="rounded-r6 border border-[var(--line)] bg-[var(--surface)] p-6 shadow-sm-soft">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-4)]">Returns and reverse logistics</p>
        <h1 className="mt-2 font-display text-3xl font-bold tracking-[-0.02em] text-[var(--ink)]">Customer returns now post through an accountable return order.</h1>
        <p className="mt-2 text-sm text-[var(--ink-3)]">Returned stock can go back to available stock or damaged stock based on inspection disposition.</p>
      </section>

      {error && !data ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
      {createError ? <QueryErrorBanner error={createError} /> : null}

      <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="mp-panel p-5">
          <div className="flex items-center gap-2"><RotateCcw className="h-5 w-5 text-[var(--brand-700)]" /><h2 className="text-xl font-bold text-[var(--ink)]">Create return</h2></div>
          <div className="mt-5 space-y-4">
            <div className="flex h-10 items-center rounded-md border border-[var(--line)] px-3">
              <Search className="mr-2 h-4 w-4 text-[var(--ink-4)]" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search returned SKU..." className="w-full bg-transparent text-sm outline-none" />
            </div>
            <select value={selected?.productId || ''} onChange={(event) => setSelectedProductId(event.target.value)} className="h-10 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--ink)]">
              {balances.map((row) => <option key={row.productId} value={row.productId}>{row.product?.sku} · {row.product?.name}</option>)}
            </select>
            <Input type="number" min={1} value={qty} onChange={(event) => setQty(event.target.value)} placeholder="Quantity" />
            <select value={disposition} onChange={(event) => setDisposition(event.target.value)} className="h-10 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--ink)]">
              <option value="inspect">Hold for inspection / damaged</option>
              <option value="resell">Return to available stock</option>
            </select>
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Return reason, customer note, challan reference" className="min-h-[86px] w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm outline-none" />
            <Button onClick={submit} disabled={!selected || !Number(qty || 0) || creating}>Post return order</Button>
          </div>
        </div>

        <div className="mp-panel overflow-hidden">
          <div className="border-b border-[var(--line)] p-5"><h2 className="text-xl font-bold text-[var(--ink)]">Recent return orders</h2></div>
          {loading && !returns.length ? <div className="p-5"><QueryLoading label="Loading returns..." /></div> : null}
          <div className="divide-y divide-[var(--line)]">
            {returns.map((row) => (
              <div key={row.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="font-bold text-[var(--ink)]">{row.returnNumber}</p><p className="mt-1 text-xs text-[var(--ink-4)]">{row.reason} · {new Date(row.createdAt).toLocaleDateString()}</p></div>
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold uppercase text-emerald-700">{row.status}</span>
                </div>
                <div className="mt-3 space-y-1">
                  {(row.lines || []).map((line: any) => <p key={line.id} className="text-xs text-[var(--ink-4)]">{line.sku} · {line.quantity} · {line.disposition}</p>)}
                </div>
              </div>
            ))}
            {!returns.length && !loading ? <p className="p-8 text-center text-sm text-[var(--ink-4)]">No returns recorded.</p> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
