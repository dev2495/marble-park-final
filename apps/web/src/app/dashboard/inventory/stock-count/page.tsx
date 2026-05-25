'use client';

import { useEffect, useMemo, useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import { ClipboardCheck, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QueryErrorBanner, QueryLoading } from '@/components/query-state';

const DATA = gql`
  query StockCountPage($search: String, $locationId: String) {
    inventoryBalances(search: $search, take: 80) {
      id productId onHand available product { id sku name brand category }
    }
    stockLocations(status: "active")
    stockLocationBalances(locationId: $locationId, take: 250)
    stockCountSessions(take: 40)
  }
`;

const CREATE = gql`
  mutation CreateStockCountSession($input: StockCountInput!) {
    createStockCountSession(input: $input)
  }
`;

const APPROVE = gql`
  mutation ApproveStockCountSession($id: ID!) {
    approveStockCountSession(id: $id)
  }
`;

export default function StockCountPage() {
  const [search, setSearch] = useState('');
  const [locationId, setLocationId] = useState('');
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const { data, loading, error, refetch } = useQuery(DATA, { variables: { search: search || undefined, locationId: locationId || undefined }, fetchPolicy: 'cache-and-network' });
  const [create, { loading: creating, error: createError }] = useMutation(CREATE, { onCompleted: () => { setCounts({}); setNotes(''); refetch(); } });
  const [approve, { loading: approving, error: approveError }] = useMutation(APPROVE, { onCompleted: () => refetch() });

  const balances = useMemo<any[]>(() => data?.inventoryBalances || [], [data?.inventoryBalances]);
  const locations = useMemo<any[]>(() => data?.stockLocations || [], [data?.stockLocations]);
  const defaultLocation = useMemo(() => locations.find((location) => location.defaultStockScope) || locations[0], [locations]);
  const selectedLocation = useMemo(() => locations.find((location) => location.id === locationId) || defaultLocation, [defaultLocation, locationId, locations]);
  const locationBalances = useMemo<Map<string, any>>(() => new Map((data?.stockLocationBalances || []).map((row: any) => [row.productId, row])), [data?.stockLocationBalances]);
  const sessions = useMemo<any[]>(() => data?.stockCountSessions || [], [data?.stockCountSessions]);
  const selectedLines = useMemo(() => balances
    .filter((row) => counts[row.productId] !== undefined && counts[row.productId] !== '')
    .map((row) => ({ productId: row.productId, countedQuantity: Number(counts[row.productId] || 0), reason: notes || 'Physical count' })), [balances, counts, notes]);

  const submit = () => {
    if (!selectedLines.length) return;
    create({ variables: { input: { scope: selectedLocation ? 'plant_location' : 'selected_skus', locationId: selectedLocation?.id || undefined, notes, submit: true, lines: JSON.stringify(selectedLines) } } });
  };

  useEffect(() => {
    if (!locationId && defaultLocation?.id) setLocationId(defaultLocation.id);
  }, [defaultLocation?.id, locationId]);

  return (
    <div className="space-y-6 pb-10">
      <section className="rounded-r6 border border-[var(--line)] bg-[var(--surface)] p-6 shadow-sm-soft">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-4)]">Stock count</p>
        <h1 className="mt-2 font-display text-3xl font-bold tracking-[-0.02em] text-[var(--ink)]">Count sessions separate physical variance from casual manual adjustment.</h1>
      </section>

      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
      {createError ? <QueryErrorBanner error={createError} /> : null}
      {approveError ? <QueryErrorBanner error={approveError} /> : null}

      <section className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="mp-panel overflow-hidden">
          <div className="border-b border-[var(--line)] p-5">
            <div className="grid gap-3 lg:grid-cols-[1fr_18rem]">
              <div className="flex h-10 items-center rounded-md border border-[var(--line)] bg-[var(--surface)] px-3">
                <Search className="mr-2 h-4 w-4 text-[var(--ink-4)]" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search SKU for counting..." className="w-full bg-transparent text-sm outline-none" />
              </div>
              <select value={selectedLocation?.id || ''} onChange={(event) => setLocationId(event.target.value)} className="h-10 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-bold text-[var(--ink)]">
                {locations.map((location) => <option key={location.id} value={location.id}>{location.defaultStockScope ? 'Default · ' : ''}{location.code} · {location.name}</option>)}
              </select>
            </div>
          </div>
          {loading && !balances.length ? <div className="p-5"><QueryLoading label="Loading SKUs..." /></div> : null}
          <div className="max-h-[34rem] overflow-y-auto divide-y divide-[var(--line)]">
            {balances.map((row) => (
              <div key={row.id} className="grid gap-3 p-4 md:grid-cols-[1fr_8rem] md:items-center">
                <div>
                  <p className="text-sm font-bold text-[var(--ink)]">{row.product?.sku} · {row.product?.name}</p>
                  <p className="mt-1 text-xs font-medium text-[var(--ink-4)]">
                    {selectedLocation ? `${selectedLocation.code} book ${locationBalances.get(row.productId)?.onHand ?? 0}` : `Book on hand ${row.onHand}`} · Total available {row.available}
                  </p>
                </div>
                <Input type="number" min={0} value={counts[row.productId] || ''} onChange={(event) => setCounts((current) => ({ ...current, [row.productId]: event.target.value }))} placeholder="Counted" />
              </div>
            ))}
          </div>
          <div className="border-t border-[var(--line)] bg-[var(--bg-soft)] p-5">
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Reason / count note" className="min-h-[70px] w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm outline-none" />
            <Button className="mt-3" onClick={submit} disabled={!selectedLines.length || creating}><ClipboardCheck className="mr-2 h-4 w-4" /> Submit count session</Button>
          </div>
        </div>

        <div className="mp-panel overflow-hidden">
          <div className="border-b border-[var(--line)] p-5"><h2 className="text-xl font-bold text-[var(--ink)]">Recent sessions</h2></div>
          <div className="divide-y divide-[var(--line)]">
            {sessions.map((session) => (
              <div key={session.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="font-bold text-[var(--ink)]">{session.countNumber}</p><p className="text-xs text-[var(--ink-4)]">{session.lines?.length || 0} rows · {session.status}</p></div>
                  {session.status !== 'approved' ? <Button size="sm" disabled={approving} onClick={() => approve({ variables: { id: session.id } })}>Approve</Button> : <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold uppercase text-emerald-700">Approved</span>}
                </div>
                <div className="mt-3 space-y-1">
                  {(session.lines || []).slice(0, 4).map((line: any) => <p key={line.id} className="text-xs text-[var(--ink-4)]">Expected {line.expectedQuantity}, counted {line.countedQuantity}, variance {line.variance}</p>)}
                </div>
              </div>
            ))}
            {!sessions.length && !loading ? <p className="p-8 text-center text-sm text-[var(--ink-4)]">No count sessions yet.</p> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
