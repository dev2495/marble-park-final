'use client';

import { useMemo, useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import { CheckCircle2, PackagePlus, Plus, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QueryErrorBanner } from '@/components/query-state';

const DATA = gql`query OpeningStockDesk($search: String) {
  products(search: $search, take: 80) { id sku internalCode name category brand salesUom piecesPerPack }
  stockLocations(status: "active")
  openingStockSessions(take: 30)
  me { id role }
}`;
const CREATE = gql`mutation CreateOpening($input: OpeningStockInput!) { createOpeningStockSession(input: $input) }`;
const POST = gql`mutation PostOpening($id: ID!, $ownerOverrideReason: String) { approveOpeningStockSession(id: $id, ownerOverrideReason: $ownerOverrideReason) }`;

export default function OpeningStockPage() {
  const [search, setSearch] = useState('');
  const [locationId, setLocationId] = useState('');
  const [effectiveAt, setEffectiveAt] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<any[]>([]);
  const [message, setMessage] = useState('');
  const [approvalReasons, setApprovalReasons] = useState<Record<string, string>>({});
  const { data, error, refetch } = useQuery(DATA, { variables: { search: search || undefined }, fetchPolicy: 'cache-and-network' });
  const [create, { loading: creating, error: createError }] = useMutation(CREATE, { onCompleted: () => { setLines([]); refetch(); } });
  const [post, { loading: posting, error: postError }] = useMutation(POST, { onCompleted: () => refetch() });
  const products = data?.products || [];
  const locations = data?.stockLocations || [];
  const sessions = data?.openingStockSessions || [];
  const canViewCost = ['owner', 'admin'].includes(data?.me?.role || '');
  const selectedLocation = locationId || locations.find((row: any) => row.defaultStockScope)?.id || locations[0]?.id || '';
  const totalUnits = useMemo(() => lines.reduce((sum, row) => sum + Number(row.quantity || 0), 0), [lines]);

  function addProduct(product: any) {
    if (lines.some((row) => row.productId === product.id)) return;
    setLines((current) => [...current, { productId: product.id, sku: product.sku, internalCode: product.internalCode, name: product.name, lotCode: '', quantity: '', unitCost: '', qualityStatus: 'available', packCount: '', labelTemplate: 'stock_pack' }]);
  }
  function update(index: number, key: string, value: any) {
    setLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row));
  }
  async function submit() {
    setMessage('');
    try {
      await create({ variables: { input: { locationId: selectedLocation, effectiveAt: new Date(`${effectiveAt}T12:00:00`).toISOString(), submit: true, lines: JSON.stringify(lines.map(({ sku, internalCode, name, unitCost, ...row }) => ({ ...row, quantity: Number(row.quantity), ...(canViewCost && unitCost !== '' ? { unitCost: Number(unitCost) } : {}), packCount: Number(row.packCount || 0) }))) } } });
      setMessage('Opening count submitted. Review and post it to create physical lots and labels.');
    } catch (caught: any) { setMessage(caught.message || 'Unable to create opening stock'); }
  }

  return <div className="space-y-5 pb-10">
    <header className="border-b border-[var(--line)] py-5"><p className="text-xs font-semibold uppercase text-[var(--ink-4)]">Inventory onboarding</p><div className="mt-1 flex flex-wrap items-end justify-between gap-4"><div><h1 className="font-display text-3xl font-bold text-[var(--ink)]">Opening stock by physical lot</h1><p className="mt-2 max-w-3xl text-sm text-[var(--ink-3)]">Catalogue SKUs can stay at zero. Add only physically counted stock, then print one internal QR label per carton or unit required.</p></div><div className="text-right"><p className="text-xs font-semibold text-[var(--ink-4)]">Current batch</p><p className="text-2xl font-bold tabular-nums text-[var(--ink)]">{totalUnits.toLocaleString('en-IN')} units</p></div></div></header>
    {[error, createError, postError].filter(Boolean).map((item: any, index) => <QueryErrorBanner key={index} error={item} />)}
    {message ? <p role="status" className="rounded-md border border-[#b9d2f5] bg-[#eef5ff] p-3 text-sm font-semibold text-[#174ea6]">{message}</p> : null}
    <section className="grid gap-5 xl:grid-cols-[18rem_1fr]">
      <aside className="mp-panel overflow-hidden"><div className="border-b border-[var(--line)] p-3"><div className="flex h-10 items-center rounded-md border border-[var(--line)] px-3"><Search className="mr-2 h-4 w-4 text-[var(--ink-4)]"/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Code, SKU or name" className="w-full bg-transparent text-sm outline-none"/></div></div><div className="max-h-[36rem] overflow-y-auto p-2">{products.map((product: any) => <button type="button" key={product.id} onClick={() => addProduct(product)} className="mb-1 w-full rounded-md p-3 text-left hover:bg-[var(--bg-soft)]"><p className="truncate text-sm font-semibold text-[var(--ink)]">{product.internalCode || product.sku}</p><p className="truncate text-xs text-[var(--ink-4)]">{product.name} · {product.brand}</p></button>)}</div></aside>
      <div className="mp-panel overflow-hidden"><div className="grid gap-3 border-b border-[var(--line)] p-4 sm:grid-cols-2"><label className="text-xs font-semibold text-[var(--ink-4)]">Stock location<select value={selectedLocation} onChange={(event) => setLocationId(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)]">{locations.map((row: any) => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}</select></label><label className="text-xs font-semibold text-[var(--ink-4)]">Effective date<Input className="mt-1" type="date" value={effectiveAt} onChange={(event) => setEffectiveAt(event.target.value)}/></label></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm"><thead className="bg-[var(--bg-soft)] text-left text-[11px] font-semibold uppercase text-[var(--ink-4)]"><tr><th className="p-3">Product</th><th>Lot / reference</th><th>Count</th>{canViewCost ? <th>Cost</th> : null}<th>Condition</th><th>Labels</th><th></th></tr></thead><tbody className="divide-y divide-[var(--line)]">{lines.map((row, index) => <tr key={row.productId}><td className="p-3"><p className="font-semibold text-[var(--ink)]">{row.internalCode || row.sku}</p><p className="text-xs text-[var(--ink-4)]">{row.name}</p></td><td><Input value={row.lotCode} onChange={(event) => update(index, 'lotCode', event.target.value)} placeholder="Opening lot code"/></td><td className="px-2"><Input className="w-24" type="number" min={1} value={row.quantity} onChange={(event) => update(index, 'quantity', event.target.value)}/></td>{canViewCost ? <td className="px-2"><Input className="w-28" type="number" min={0} value={row.unitCost} onChange={(event) => update(index, 'unitCost', event.target.value)}/></td> : null}<td className="px-2"><select value={row.qualityStatus} onChange={(event) => update(index, 'qualityStatus', event.target.value)} className="h-10 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2"><option value="available">Available</option><option value="inspection">Inspection</option><option value="damaged">Damaged</option></select></td><td className="px-2"><Input className="w-20" type="number" min={0} value={row.packCount} onChange={(event) => update(index, 'packCount', event.target.value)}/></td><td className="pr-3"><button title="Remove line" onClick={() => setLines((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="rounded-md p-2 text-red-700 hover:bg-red-50"><Trash2 className="h-4 w-4"/></button></td></tr>)}</tbody></table></div>
        {!lines.length ? <div className="grid min-h-48 place-items-center text-center"><div><Plus className="mx-auto h-7 w-7 text-[var(--ink-5)]"/><p className="mt-2 font-semibold text-[var(--ink)]">Select physical SKUs from the left</p></div></div> : null}
        <div className="flex justify-end border-t border-[var(--line)] p-4"><Button onClick={submit} disabled={creating || !lines.length || lines.some((row) => !row.quantity)}><PackagePlus className="mr-2 h-4 w-4"/>Submit opening count</Button></div>
      </div>
    </section>
    <section className="mp-panel overflow-hidden"><div className="border-b border-[var(--line)] p-4"><h2 className="font-semibold text-[var(--ink)]">Opening sessions</h2></div><div className="divide-y divide-[var(--line)]">{sessions.map((session: any) => { const missingCost = (session.lines || []).some((line: any) => Number(line.unitCost || 0) <= 0); return <div key={session.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="font-semibold text-[var(--ink)]">{session.sessionNumber} · {session.location?.name}</p><p className="text-xs text-[var(--ink-4)]">{session.lines?.length || 0} lots · {session.status}</p></div>{session.status !== 'posted' && canViewCost ? <div className="flex min-w-[20rem] flex-wrap items-center justify-end gap-2">{missingCost ? <Input aria-label={`Owner cost exception for ${session.sessionNumber}`} value={approvalReasons[session.id] || ''} onChange={(event) => setApprovalReasons((current) => ({ ...current, [session.id]: event.target.value }))} placeholder="Owner reason for missing cost (12+ chars)" className="min-w-72"/> : null}<Button size="sm" disabled={posting || (missingCost && (approvalReasons[session.id] || '').trim().length < 12)} onClick={() => post({ variables: { id: session.id, ownerOverrideReason: (approvalReasons[session.id] || '').trim() || undefined } })}><CheckCircle2 className="mr-2 h-4 w-4"/>Post stock & labels</Button></div> : session.status !== 'posted' ? <span className="text-xs font-semibold text-amber-800">Awaiting owner review</span> : <span className="text-xs font-semibold text-emerald-700">Posted</span>}</div>; })}</div></section>
  </div>;
}
