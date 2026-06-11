'use client';

import { useMemo, useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import { BadgeCheck, ImagePlus, RotateCcw, Save, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QueryErrorBanner } from '@/components/query-state';

const DATA = gql`query { masterProductBrands }`;
const SAVE = gql`mutation($input: ProductBrandInput!) { saveProductBrand(input: $input) { data } }`;
const empty = { id: '', name: '', code: '', description: '', status: 'active', sortOrder: 0, logoUrl: '' };

export default function BrandMasterPage() {
  const { data, loading, error, refetch } = useQuery(DATA, { fetchPolicy: 'cache-and-network' });
  const [form, setForm] = useState<any>(empty);
  const [search, setSearch] = useState('');
  const [save, { loading: saving, error: saveError }] = useMutation(SAVE, { onCompleted: () => { void refetch(); setForm(empty); } });
  const rows = useMemo<any[]>(() => data?.masterProductBrands || [], [data?.masterProductBrands]);
  const filtered = rows.filter((row) => `${row.name} ${row.code} ${row.description}`.toLowerCase().includes(search.toLowerCase()));
  const submit = () => save({ variables: { input: { id: form.id || undefined, name: form.name, code: form.code || undefined, description: form.description || '', status: form.status || 'active', sortOrder: Number(form.sortOrder || 0), metadata: { ...(form.metadata || {}), logoUrl: form.logoUrl || '' } } } });
  const selectRow = (row: any) => setForm({ ...row, logoUrl: row.metadata?.logoUrl || '' });

  return (
    <div className="space-y-7 pb-10">
      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
      {saveError ? <QueryErrorBanner error={saveError} /> : null}
      <section className="mp-card rounded-r6 border border-[var(--line)] p-6">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--ink-4)]">Brand master</p>
        <h1 className="mt-3 font-display text-4xl font-bold tracking-[-0.04em] text-[var(--ink)]">Control brands, logos and quote presentation.</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--ink-3)]">Brand names feed Product Master, catalogue filters and quotation PDFs. Add logo URLs here when a brand should appear in customer documents.</p>
      </section>
      <section className="grid gap-6 xl:grid-cols-[0.72fr_1.28fr]">
        <div className="mp-panel p-5">
          <div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-r3 bg-[var(--brand-50)] text-[var(--brand-700)]"><BadgeCheck className="h-5 w-5" /></div><div><h2 className="text-xl font-semibold text-[var(--ink)]">{form.id ? 'Edit brand' : 'Add brand'}</h2><p className="text-sm text-[var(--ink-4)]">Used by Excel imports, SKUs and quote logo strips.</p></div></div>
          <div className="mt-5 grid gap-3">
            <label className="space-y-2"><span className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">Name</span><Input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Grohe" /></label>
            <label className="space-y-2"><span className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">Code</span><Input value={form.code || ''} onChange={(e) => setForm({ ...form, code: e.target.value })} /></label>
            <label className="space-y-2"><span className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">Description</span><Input value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
            <label className="space-y-2"><span className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">Brand logo URL</span><div className="flex gap-2"><Input value={form.logoUrl || ''} onChange={(e) => setForm({ ...form, logoUrl: e.target.value })} placeholder="/brand-logos/grohe.png or https://..." /><div className="grid h-10 w-12 place-items-center rounded-md bg-[var(--brand-50)] text-[var(--brand-700)]"><ImagePlus className="h-4 w-4" /></div></div></label>
            {form.logoUrl ? <div className="grid h-24 place-items-center rounded-r4 border border-[var(--line)] bg-[var(--surface)] p-3"><img src={form.logoUrl} alt="brand logo preview" className="max-h-16 max-w-full object-contain" /></div> : null}
            <div className="grid gap-3 sm:grid-cols-2"><label className="space-y-2"><span className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">Status</span><select value={form.status || 'active'} onChange={(e) => setForm({ ...form, status: e.target.value })} className="h-10 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--ink)]"><option value="active">Active</option><option value="inactive">Inactive</option></select></label><label className="space-y-2"><span className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">Sort order</span><Input type="number" value={form.sortOrder || 0} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })} /></label></div>
          </div>
          <div className="mt-5 flex gap-3"><Button disabled={saving || !form.name} onClick={submit}><Save className="mr-2 h-4 w-4" />Save brand</Button><Button variant="outline" onClick={() => setForm(empty)}><RotateCcw className="mr-2 h-4 w-4" />Clear</Button></div>
        </div>
        <div className="mp-panel p-5">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><h2 className="text-2xl font-semibold text-[var(--ink)]">Brands</h2><p className="mt-1 text-sm text-[var(--ink-4)]">{rows.length} values in master data.</p></div><div className="flex h-10 min-w-72 items-center rounded-md border border-[var(--line)] bg-[var(--surface)] px-3"><Search className="mr-2 h-4 w-4 text-[var(--ink-4)]" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search brands" className="w-full bg-transparent text-sm outline-none" /></div></div>
          <div className="mt-5 grid gap-3 md:grid-cols-2">{filtered.map((row) => <button key={row.id} onClick={() => selectRow(row)} className="flex items-center gap-3 rounded-r4 border border-[var(--line)] bg-[var(--surface)] p-4 text-left transition hover:border-[var(--brand-300)] hover:shadow-sm-soft"><div className="grid h-14 w-20 shrink-0 place-items-center rounded-r3 bg-[var(--bg-soft)]">{row.metadata?.logoUrl ? <img src={row.metadata.logoUrl} alt={row.name} className="max-h-10 max-w-16 object-contain" /> : <span className="text-sm font-bold text-[var(--brand-700)]">{String(row.name || 'MP').slice(0, 2).toUpperCase()}</span>}</div><div><p className="font-semibold text-[var(--ink)]">{row.name}</p><p className="mt-1 text-xs font-semibold uppercase tracking-wider text-[var(--ink-5)]">{row.status} · {row.code || 'No code'}</p></div></button>)}</div>
          {!loading && !filtered.length ? <div className="mt-5 rounded-r4 border border-dashed border-[var(--line)] p-8 text-center text-sm font-semibold text-[var(--ink-4)]">No brands found.</div> : null}
        </div>
      </section>
    </div>
  );
}
