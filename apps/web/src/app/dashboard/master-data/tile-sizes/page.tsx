'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import { ArrowLeft, Grid3X3, RotateCcw, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QueryErrorBanner } from '@/components/query-state';

const TILE_SIZES = gql`query TileSizeMaster { tileSizes }`;
const SAVE_TILE_SIZE = gql`mutation SaveTileSize($input: TileSizeInput!) { saveTileSize(input: $input) { data } }`;
const empty = { id: '', name: '', code: '', uom: 'BOX', pcsPerBox: '', status: 'active', description: '' };

export default function TileSizeMasterPage() {
  const [form, setForm] = useState<any>(empty);
  const { data, loading, error, refetch } = useQuery(TILE_SIZES, { fetchPolicy: 'cache-and-network' });
  const [save, saveState] = useMutation(SAVE_TILE_SIZE, { onCompleted: () => { setForm(empty); refetch(); } });
  const sizes = useMemo<any[]>(() => data?.tileSizes || [], [data?.tileSizes]);

  return <div className="space-y-5 pb-10">
    {[error, saveState.error].filter(Boolean).map((item: any, index) => <QueryErrorBanner key={index} error={item}/>)}
    <header className="flex flex-col justify-between gap-4 border-b border-[var(--line)] pb-5 pt-2 lg:flex-row lg:items-end">
      <div><p className="text-xs font-semibold uppercase text-[var(--ink-4)]">Tiles only · controlled reference</p><h1 className="mt-1 font-display text-3xl font-bold text-[var(--ink)]">Tile Size Master</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-3)]">Maintain the stable size dropdown used only by Tile SKUs. A size is an attribute of a sellable design SKU—not a stock item and not a design family.</p></div>
      <Button asChild variant="outline"><Link href="/dashboard/master-data/tiles"><ArrowLeft className="mr-2 h-4 w-4"/>Tiles Master</Link></Button>
    </header>
    <section className="grid gap-5 xl:grid-cols-[22rem_1fr]">
      <div className="mp-panel self-start p-4 xl:sticky xl:top-4"><div className="flex items-center gap-2"><Grid3X3 className="h-5 w-5 text-[var(--brand-700)]"/><h2 className="font-semibold text-[var(--ink)]">{form.id ? 'Edit controlled size' : 'Add controlled size'}</h2></div><div className="mt-4 space-y-3">
        <label className="block text-xs font-semibold text-[var(--ink-4)]">Size name<Input className="mt-1" value={form.name} onChange={(event)=>setForm({...form,name:event.target.value})} placeholder="600 x 1200 mm"/></label>
        <label className="block text-xs font-semibold text-[var(--ink-4)]">Unique size code<Input className="mt-1" value={form.code} onChange={(event)=>setForm({...form,code:event.target.value.toUpperCase()})} placeholder="600X1200"/></label>
        <div className="grid grid-cols-2 gap-3"><label className="block text-xs font-semibold text-[var(--ink-4)]">Default UOM<select className="mt-1 h-10 w-full rounded-md border border-[var(--line)] bg-[var(--bg-soft)] px-3" value={form.uom} onChange={(event)=>setForm({...form,uom:event.target.value})}><option value="BOX">BOX</option><option value="PC">PC</option></select></label><label className="block text-xs font-semibold text-[var(--ink-4)]">Pieces / box<Input className="mt-1" type="number" min={0} value={form.pcsPerBox} onChange={(event)=>setForm({...form,pcsPerBox:event.target.value})}/></label></div>
        <label className="block text-xs font-semibold text-[var(--ink-4)]">Description<Input className="mt-1" value={form.description || ''} onChange={(event)=>setForm({...form,description:event.target.value})}/></label>
        <div className="flex gap-2"><Button className="flex-1" disabled={saveState.loading || !form.name.trim() || !form.code.trim()} onClick={()=>save({variables:{input:{id:form.id||undefined,name:form.name,code:form.code,uom:form.uom,pcsPerBox:form.pcsPerBox===''?undefined:Number(form.pcsPerBox),description:form.description||undefined,status:form.status||'active'}}})}><Save className="mr-2 h-4 w-4"/>Save</Button><Button variant="outline" size="icon" title="Clear" onClick={()=>setForm(empty)}><RotateCcw className="h-4 w-4"/></Button></div>
      </div></div>
      <div className="mp-panel overflow-hidden"><div className="border-b border-[var(--line)] p-4"><h2 className="font-semibold text-[var(--ink)]">Controlled size dropdown</h2><p className="mt-1 text-xs text-[var(--ink-4)]">{sizes.length} records · click a row to edit; existing referenced records are preserved.</p></div><div className="divide-y divide-[var(--line)]">{sizes.map((row:any)=><button key={row.id} onClick={()=>setForm({...row,pcsPerBox:String(row.pcsPerBox??'')})} className="grid w-full grid-cols-[1fr_auto_auto] items-center gap-4 p-4 text-left hover:bg-[var(--bg-soft)]"><div><p className="font-semibold text-[var(--ink)]">{row.name}</p><p className="mt-1 text-xs text-[var(--ink-4)]">{row.code} · {row.description || 'No description'}</p></div><span className="text-sm font-medium text-[var(--ink-3)]">{row.pcsPerBox || 0} pc / box</span><span className={`rounded px-2 py-1 text-xs font-semibold ${row.status==='active'?'bg-emerald-50 text-emerald-700':'bg-slate-100 text-slate-600'}`}>{row.status}</span></button>)}{!loading&&!sizes.length?<p className="p-10 text-center text-sm text-[var(--ink-4)]">No tile sizes yet.</p>:null}</div></div>
    </section>
  </div>;
}
