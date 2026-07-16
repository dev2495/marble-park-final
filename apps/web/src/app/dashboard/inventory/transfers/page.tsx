'use client';

import { useMemo, useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import { ArrowRight, Check, PackageCheck, Plus, Send, Trash2, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QueryErrorBanner } from '@/components/query-state';

const DATA = gql`query TransferDesk { stockLocations(status: "active") inventoryLots(status: "active", take: 200) stockTransfers(take: 80) }`;
const CREATE = gql`mutation CreateTransfer($input: StockTransferInput!) { createStockTransfer(input: $input) }`;
const TRANSITION = gql`mutation TransitionTransfer($id: ID!, $action: String!, $input: StockTransferTransitionInput) { transitionStockTransfer(id: $id, action: $action, input: $input) }`;

export default function TransferDeskPage() {
  const [sourceId, setSourceId] = useState('');
  const [destinationId, setDestinationId] = useState('');
  const [lines, setLines] = useState<any[]>([]);
  const [receive, setReceive] = useState<Record<string, { receivedQuantity: number; damagedQuantity: number }>>({});
  const { data, error, refetch } = useQuery(DATA, { fetchPolicy: 'cache-and-network' });
  const [create, createState] = useMutation(CREATE, { onCompleted: () => { setLines([]); refetch(); } });
  const [transition, transitionState] = useMutation(TRANSITION, { onCompleted: () => refetch() });
  const locations = data?.stockLocations || [];
  const lots = useMemo<any[]>(() => data?.inventoryLots || [], [data?.inventoryLots]);
  const transfers = data?.stockTransfers || [];
  const sourceLots = useMemo(() => lots.filter((lot: any) => lot.balances?.some((balance: any) => balance.locationId === sourceId && Number(balance.available) > 0)), [lots, sourceId]);

  function addLot(lotId: string) {
    const lot = sourceLots.find((row: any) => row.id === lotId);
    if (!lot || lines.some((row) => row.lotId === lot.id)) return;
    const balance = lot.balances.find((row: any) => row.locationId === sourceId);
    setLines((current) => [...current, { lotId: lot.id, productId: lot.productId, quantity: 1, available: balance?.available || 0, lotNumber: lot.lotNumber, product: lot.product }]);
  }

  async function createTransfer() {
    await create({ variables: { input: { sourceLocationId: sourceId, destinationLocationId: destinationId, submit: true, lines: JSON.stringify(lines.map((line) => ({ lotId: line.lotId, productId: line.productId, quantity: Number(line.quantity) }))) } } });
  }

  async function act(transfer: any, action: string) {
    const input = action === 'receive' ? { lines: JSON.stringify(transfer.lines.map((line: any) => ({ lineId: line.id, receivedQuantity: Number(receive[line.id]?.receivedQuantity ?? line.dispatchedQuantity), damagedQuantity: Number(receive[line.id]?.damagedQuantity || 0) }))) } : undefined;
    await transition({ variables: { id: transfer.id, action, input } });
  }

  return <div className="space-y-5 pb-10">
    {[error, createState.error, transitionState.error].filter(Boolean).map((item: any, index) => <QueryErrorBanner key={index} error={item}/>) }
    <header className="border-b border-[var(--line)] pb-5 pt-2"><p className="text-xs font-semibold uppercase text-[var(--ink-4)]">Stock movement</p><h1 className="mt-1 font-display text-3xl font-bold text-[var(--ink)]">Location transfers</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-3)]">Move exact inward lots through the in-transit location. Destination receipt separates accepted and damaged quantities without changing total company stock.</p></header>
    <section className="mp-panel overflow-hidden"><div className="grid gap-3 border-b border-[var(--line)] p-4 md:grid-cols-[1fr_auto_1fr]"><label className="text-xs font-semibold text-[var(--ink-4)]">From<select value={sourceId} onChange={(event) => { setSourceId(event.target.value); setLines([]); }} className="mt-1 h-10 w-full rounded-md border border-[var(--line)] bg-[var(--bg-soft)] px-3 text-sm"><option value="">Select source</option>{locations.filter((row: any) => row.code !== 'IN-TRANSIT').map((row: any) => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}</select></label><ArrowRight className="mt-7 hidden h-5 w-5 text-[var(--ink-4)] md:block"/><label className="text-xs font-semibold text-[var(--ink-4)]">To<select value={destinationId} onChange={(event) => setDestinationId(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-[var(--line)] bg-[var(--bg-soft)] px-3 text-sm"><option value="">Select destination</option>{locations.filter((row: any) => row.id !== sourceId && row.code !== 'IN-TRANSIT').map((row: any) => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}</select></label></div>
      <div className="p-4"><label className="text-xs font-semibold text-[var(--ink-4)]">Add reserved-free lot<select disabled={!sourceId} defaultValue="" onChange={(event) => { addLot(event.target.value); event.target.value = ''; }} className="mt-1 h-10 w-full rounded-md border border-[var(--line)] bg-[var(--bg-soft)] px-3 text-sm"><option value="">Select Product SKU and inward lot</option>{sourceLots.map((lot: any) => { const balance = lot.balances.find((row: any) => row.locationId === sourceId); return <option key={lot.id} value={lot.id}>{lot.product?.internalCode || lot.product?.sku} · {lot.lotNumber} · {balance?.available} available</option>; })}</select></label></div>
      {lines.length ? <div className="overflow-x-auto border-t border-[var(--line)]"><table className="w-full min-w-[700px] text-sm"><thead className="bg-[var(--bg-soft)] text-left text-[11px] font-semibold text-[var(--ink-4)]"><tr><th className="p-3">Product</th><th>Lot</th><th>Available</th><th>Transfer</th><th></th></tr></thead><tbody className="divide-y divide-[var(--line)]">{lines.map((line, index) => <tr key={line.lotId}><td className="p-3"><p className="font-semibold text-[var(--ink)]">{line.product?.internalCode || line.product?.sku}</p><p className="text-xs text-[var(--ink-4)]">{line.product?.name}</p></td><td>{line.lotNumber}</td><td>{line.available}</td><td><Input className="w-24" type="number" min={1} max={line.available} value={line.quantity} onChange={(event) => setLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, quantity: Number(event.target.value) } : row))}/></td><td><button title="Remove" onClick={() => setLines((current) => current.filter((_, rowIndex) => rowIndex !== index))} className="grid h-9 w-9 place-items-center rounded-md text-red-700 hover:bg-red-50"><Trash2 className="h-4 w-4"/></button></td></tr>)}</tbody></table></div> : <div className="grid min-h-28 place-items-center border-t border-[var(--line)] text-sm text-[var(--ink-4)]"><span><Plus className="mr-2 inline h-4 w-4"/>Select source, then add lots</span></div>}
      <div className="flex justify-end border-t border-[var(--line)] p-4"><Button disabled={createState.loading || !sourceId || !destinationId || !lines.length || lines.some((line) => line.quantity < 1 || line.quantity > line.available)} onClick={createTransfer}><Send className="mr-2 h-4 w-4"/>Create transfer</Button></div>
    </section>

    <section className="mp-panel overflow-hidden"><div className="border-b border-[var(--line)] p-4"><h2 className="font-semibold text-[var(--ink)]">Transfer register</h2></div><div className="divide-y divide-[var(--line)]">{transfers.map((transfer: any) => <article key={transfer.id} className="p-4"><div className="flex flex-col justify-between gap-3 md:flex-row md:items-start"><div><div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-[var(--ink)]">{transfer.transferNumber}</p><span className="rounded bg-[var(--bg-soft)] px-2 py-1 text-xs font-semibold">{transfer.status.replace('_', ' ')}</span></div><p className="mt-1 text-xs text-[var(--ink-4)]">{transfer.sourceLocation?.code} → {transfer.destinationLocation?.code} · {transfer.lines?.length || 0} lots</p></div><div className="flex flex-wrap gap-2">{['draft', 'submitted'].includes(transfer.status) ? <Button size="sm" variant="outline" disabled={transitionState.loading} onClick={() => act(transfer, 'approve')}><Check className="mr-2 h-4 w-4"/>Approve</Button> : null}{transfer.status === 'approved' ? <Button size="sm" disabled={transitionState.loading} onClick={() => act(transfer, 'dispatch')}><Truck className="mr-2 h-4 w-4"/>Dispatch</Button> : null}{transfer.status === 'in_transit' ? <Button size="sm" disabled={transitionState.loading} onClick={() => act(transfer, 'receive')}><PackageCheck className="mr-2 h-4 w-4"/>Receive</Button> : null}</div></div>
          <div className="mt-3 grid gap-2">{transfer.lines?.map((line: any) => <div key={line.id} className="grid gap-2 rounded-md bg-[var(--bg-soft)] p-3 text-xs md:grid-cols-[1fr_auto_auto_auto]"><span className="font-semibold text-[var(--ink)]">{line.product?.internalCode || line.product?.sku} · {line.lot?.lotNumber}</span><span>Requested {line.requestedQuantity}</span>{transfer.status === 'in_transit' ? <><label className="flex items-center gap-1">Accepted<Input className="h-8 w-20" type="number" min={0} max={line.dispatchedQuantity} value={receive[line.id]?.receivedQuantity ?? line.dispatchedQuantity} onChange={(event) => { const accepted = Number(event.target.value); setReceive({ ...receive, [line.id]: { receivedQuantity: accepted, damagedQuantity: Math.max(0, line.dispatchedQuantity - accepted) } }); }}/></label><label className="flex items-center gap-1">Damaged<Input className="h-8 w-20" type="number" min={0} max={line.dispatchedQuantity} value={receive[line.id]?.damagedQuantity || 0} onChange={(event) => { const damaged = Number(event.target.value); setReceive({ ...receive, [line.id]: { receivedQuantity: Math.max(0, line.dispatchedQuantity - damaged), damagedQuantity: damaged } }); }}/></label></> : <><span>Sent {line.dispatchedQuantity}</span><span>Received {line.receivedQuantity} · damaged {line.damagedQuantity}</span></>}</div>)}</div>
        </article>)}</div></section>
  </div>;
}
