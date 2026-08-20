'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import { ArrowLeft, Grid3X3, RotateCcw, Save, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QueryErrorBanner } from '@/components/query-state';

const TILE_SIZES = gql`query TileSizeMaster { tileSizes }`;
const SAVE_TILE_SIZE = gql`mutation SaveTileSize($input: TileSizeInput!) { saveTileSize(input: $input) { data } }`;
const empty = { id: '', name: '', code: '', uom: 'BOX', pcsPerBox: '', widthMm: '', heightMm: '', thicknessMm: '', areaPerPieceSqM: '', areaPerPieceSqFt: '', status: 'active', description: '' };

function optionalNumber(value: string) { return value === '' ? undefined : Number(value); }

export default function TileSizeMasterPage() {
  const [form, setForm] = useState<any>(empty);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('size');
  const [notice, setNotice] = useState('');
  const { data, loading, error, refetch } = useQuery(TILE_SIZES, { fetchPolicy: 'cache-and-network' });
  const [save, saveState] = useMutation(SAVE_TILE_SIZE, { onCompleted: async () => { setForm(empty); setNotice('Tile size saved. The form is ready for the next size.'); await refetch(); } });
  const sizes = useMemo<any[]>(() => {
    const needle = search.trim().toLowerCase();
    const rows = (data?.tileSizes || []).filter((row: any) => !needle || [row.name, row.code, row.description].join(' ').toLowerCase().includes(needle));
    return [...rows].sort((a, b) => sort === 'code' ? String(a.code).localeCompare(String(b.code)) : sort === 'area' ? Number(a.areaPerPieceSqFt || 0) - Number(b.areaPerPieceSqFt || 0) : Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || String(a.name).localeCompare(String(b.name)));
  }, [data?.tileSizes, search, sort]);
  const width = Number(form.widthMm || 0); const height = Number(form.heightMm || 0); const pieces = Number(form.pcsPerBox || 0);
  const derivedSqM = width > 0 && height > 0 ? width * height / 1_000_000 : Number(form.areaPerPieceSqM || 0);
  const derivedSqFt = Number(form.areaPerPieceSqFt || 0) || derivedSqM * 10.7639104167;

  function choose(row: any) {
    setNotice('');
    setForm({ ...empty, ...row, pcsPerBox: String(row.pcsPerBox ?? ''), widthMm: String(row.widthMm ?? ''), heightMm: String(row.heightMm ?? ''), thicknessMm: String(row.thicknessMm ?? ''), areaPerPieceSqM: String(row.areaPerPieceSqM ?? ''), areaPerPieceSqFt: String(row.areaPerPieceSqFt ?? '') });
  }

  return <div className="space-y-5 pb-10">
    {[error, saveState.error].filter(Boolean).map((item: any, index) => <QueryErrorBanner key={index} error={item}/>)}
    <header className="flex flex-col justify-between gap-4 border-b border-[var(--line)] pb-5 pt-2 lg:flex-row lg:items-end">
      <div><p className="text-xs font-semibold uppercase tracking-[.14em] text-[var(--ink-4)]">Tiles only · governed geometry</p><h1 className="mt-1 font-display text-3xl font-bold text-[var(--ink)]">Tile Size Master</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-3)]">One controlled source for dimensions, pieces per box and area conversion. Sizes are reused by variants; they never become stock records themselves.</p></div>
      <Button asChild variant="outline"><Link href="/dashboard/master-data/tiles"><ArrowLeft className="mr-2 h-4 w-4"/>Tile workspace</Link></Button>
    </header>
    {notice ? <div role="status" className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{notice}</div> : null}
    <section className="grid gap-5 xl:grid-cols-[24rem_1fr]">
      <form className="mp-panel self-start p-5 xl:sticky xl:top-4" onSubmit={(event) => { event.preventDefault(); setNotice(''); save({ variables: { input: { id: form.id || undefined, name: form.name.trim(), code: form.code.trim().toUpperCase(), uom: form.uom, pcsPerBox: Number(form.pcsPerBox || 0), widthMm: optionalNumber(form.widthMm), heightMm: optionalNumber(form.heightMm), thicknessMm: optionalNumber(form.thicknessMm), areaPerPieceSqM: optionalNumber(form.areaPerPieceSqM), areaPerPieceSqFt: optionalNumber(form.areaPerPieceSqFt), description: form.description || undefined, status: form.status } } }); }}>
        <div className="flex items-center justify-between"><div className="flex items-center gap-2"><Grid3X3 className="h-5 w-5 text-[var(--brand-700)]"/><h2 className="font-semibold text-[var(--ink)]">{form.id ? 'Edit governed size' : 'Add governed size'}</h2></div><Button type="button" variant="ghost" size="icon" aria-label="Clear size form" onClick={() => setForm(empty)}><RotateCcw className="h-4 w-4"/></Button></div>
        <div className="mt-4 space-y-3">
          <label className="block text-xs font-semibold text-[var(--ink-4)]">Size name<Input className="mt-1" value={form.name} onChange={(e)=>setForm({...form,name:e.target.value})} placeholder="600 × 1200 mm"/></label>
          <label className="block text-xs font-semibold text-[var(--ink-4)]">Unique size code<Input className="mt-1" value={form.code} onChange={(e)=>setForm({...form,code:e.target.value.toUpperCase()})} placeholder="600X1200"/></label>
          <div className="grid grid-cols-2 gap-3"><label className="block text-xs font-semibold text-[var(--ink-4)]">Width (mm)<Input className="mt-1" type="number" min="0.01" step="0.01" value={form.widthMm} onChange={(e)=>setForm({...form,widthMm:e.target.value})}/></label><label className="block text-xs font-semibold text-[var(--ink-4)]">Height (mm)<Input className="mt-1" type="number" min="0.01" step="0.01" value={form.heightMm} onChange={(e)=>setForm({...form,heightMm:e.target.value})}/></label></div>
          <div className="grid grid-cols-2 gap-3"><label className="block text-xs font-semibold text-[var(--ink-4)]">Thickness (mm)<Input className="mt-1" type="number" min="0.01" step="0.01" value={form.thicknessMm} onChange={(e)=>setForm({...form,thicknessMm:e.target.value})}/></label><label className="block text-xs font-semibold text-[var(--ink-4)]">Pieces / box<Input className="mt-1" type="number" min="0" step="1" value={form.pcsPerBox} onChange={(e)=>setForm({...form,pcsPerBox:e.target.value})}/></label></div>
          <div className="grid grid-cols-2 gap-3"><label className="block text-xs font-semibold text-[var(--ink-4)]">Area / pc (m²)<Input className="mt-1" type="number" min="0.0001" step="0.0001" value={form.areaPerPieceSqM} onChange={(e)=>setForm({...form,areaPerPieceSqM:e.target.value})} placeholder={derivedSqM ? derivedSqM.toFixed(4) : 'Derived'}/></label><label className="block text-xs font-semibold text-[var(--ink-4)]">Area / pc (ft²)<Input className="mt-1" type="number" min="0.0001" step="0.0001" value={form.areaPerPieceSqFt} onChange={(e)=>setForm({...form,areaPerPieceSqFt:e.target.value})} placeholder={derivedSqFt ? derivedSqFt.toFixed(4) : 'Derived'}/></label></div>
          {derivedSqFt > 0 ? <div className="rounded-md bg-[var(--bg-soft)] p-3 text-xs text-[var(--ink-3)]"><b>{derivedSqFt.toFixed(3)} ft² / piece</b>{pieces > 0 ? ` · ${(derivedSqFt * pieces).toFixed(3)} ft² / box` : ' · enter pieces / box for box coverage'}</div> : null}
          <div className="grid grid-cols-2 gap-3"><label className="block text-xs font-semibold text-[var(--ink-4)]">Default inward UOM<select className="mt-1 h-10 w-full rounded-md border border-[var(--line)] bg-[var(--bg-soft)] px-3" value={form.uom} onChange={(e)=>setForm({...form,uom:e.target.value})}><option>BOX</option><option>PC</option></select></label><label className="block text-xs font-semibold text-[var(--ink-4)]">Status<select className="mt-1 h-10 w-full rounded-md border border-[var(--line)] bg-[var(--bg-soft)] px-3" value={form.status} onChange={(e)=>setForm({...form,status:e.target.value})}><option value="active">Active</option><option value="inactive">Inactive</option></select></label></div>
          <label className="block text-xs font-semibold text-[var(--ink-4)]">Notes<Input className="mt-1" value={form.description || ''} onChange={(e)=>setForm({...form,description:e.target.value})}/></label>
          <Button type="submit" className="w-full" disabled={saveState.loading || !form.name.trim() || !form.code.trim()}><Save className="mr-2 h-4 w-4"/>{saveState.loading ? 'Saving…' : 'Save and clear form'}</Button>
        </div>
      </form>
      <div className="mp-panel overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-[var(--line)] p-4 md:flex-row md:items-center md:justify-between"><div><h2 className="font-semibold text-[var(--ink)]">Controlled size register</h2><p className="mt-1 text-xs text-[var(--ink-4)]">{sizes.length} matching of {(data?.tileSizes || []).length} sizes · select a row to edit</p></div><div className="flex gap-2"><label className="relative min-w-0 flex-1 md:w-64"><Search className="absolute left-3 top-3 h-4 w-4 text-[var(--ink-4)]"/><Input className="pl-9" value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search size or code"/></label><select aria-label="Sort sizes" value={sort} onChange={(e)=>setSort(e.target.value)} className="h-10 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm"><option value="size">Master order</option><option value="code">Code A–Z</option><option value="area">Area low–high</option></select></div></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-[var(--bg-soft)] text-[10px] uppercase tracking-wider text-[var(--ink-4)]"><tr><th className="px-4 py-3">Size / code</th><th className="px-4 py-3">Geometry</th><th className="px-4 py-3">Packing</th><th className="px-4 py-3">Coverage</th><th className="px-4 py-3">Status</th></tr></thead><tbody className="divide-y divide-[var(--line)]">{sizes.map((row:any)=><tr key={row.id} onClick={()=>choose(row)} className="cursor-pointer hover:bg-[var(--bg-soft)]"><td className="px-4 py-3"><p className="font-semibold text-[var(--ink)]">{row.name}</p><p className="text-xs text-[var(--ink-4)]">{row.code}</p></td><td className="px-4 py-3 text-[var(--ink-3)]">{row.widthMm && row.heightMm ? `${row.widthMm} × ${row.heightMm} mm` : 'Not captured'}{row.thicknessMm ? ` · ${row.thicknessMm} mm` : ''}</td><td className="px-4 py-3">{row.pcsPerBox || 0} pc / {row.uom || 'BOX'}</td><td className="px-4 py-3">{Number(row.areaPerPieceSqFt || 0) ? `${Number(row.areaPerPieceSqFt).toFixed(3)} ft²/pc` : 'Not captured'}{Number(row.areaPerBoxSqFt || 0) ? <span className="block text-xs text-[var(--ink-4)]">{Number(row.areaPerBoxSqFt).toFixed(3)} ft²/box</span> : null}</td><td className="px-4 py-3"><span className={`rounded px-2 py-1 text-xs font-semibold ${row.status==='active'?'bg-emerald-50 text-emerald-700':'bg-slate-100 text-slate-600'}`}>{row.status}</span></td></tr>)}{!loading&&!sizes.length?<tr><td colSpan={5} className="p-10 text-center text-sm text-[var(--ink-4)]">No matching tile sizes.</td></tr>:null}</tbody></table></div>
      </div>
    </section>
  </div>;
}
