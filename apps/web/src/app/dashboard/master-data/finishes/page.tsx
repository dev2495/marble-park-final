'use client';

import { useMemo, useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import { Palette, RotateCcw, Save, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QueryErrorBanner } from '@/components/query-state';

const DATA = gql`query { masterProductFinishes }`;
const SAVE = gql`mutation($input: ProductFinishInput!) { saveProductFinish(input: $input) { data } }`;
const empty = { id: '', name: '', code: '', description: '', status: 'active', sortOrder: 0 };

export default function FinishMasterPage() {
  const { data, loading, error, refetch } = useQuery(DATA, { fetchPolicy: 'cache-and-network' });
  const [form, setForm] = useState<any>(empty);
  const [search, setSearch] = useState('');
  const [save, { loading: saving, error: saveError }] = useMutation(SAVE, { onCompleted: () => { void refetch(); setForm(empty); } });
  const rows = useMemo<any[]>(() => data?.masterProductFinishes || [], [data?.masterProductFinishes]);
  const filtered = rows.filter((row) => `${row.name} ${row.code} ${row.description}`.toLowerCase().includes(search.toLowerCase()));
  const submit = () => save({ variables: { input: { ...form, id: form.id || undefined, expectedUpdatedAt: form.id ? form.updatedAt : undefined, sortOrder: Number(form.sortOrder || 0) } } });

  return (
    <div className="space-y-7 pb-10">
      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
      {saveError ? <QueryErrorBanner error={saveError} /> : null}
      <section className="mp-card rounded-r6 border border-[var(--line)] p-6">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--ink-4)]">Finish master</p>
        <h1 className="mt-3 font-display text-4xl font-bold tracking-[-0.04em] text-[var(--ink)]">Control colour, shade and finish values.</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--ink-3)]">These values feed Product Master, Excel imports, catalogue filters and quote item descriptions.</p>
      </section>
      <section className="grid gap-6 xl:grid-cols-[0.7fr_1.3fr]">
        <div className="mp-panel p-5">
          <div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-r3 bg-[var(--brand-50)] text-[var(--brand-700)]"><Palette className="h-5 w-5" /></div><div><h2 className="text-xl font-semibold text-[var(--ink)]">{form.id ? 'Edit finish' : 'Add finish'}</h2><p className="text-sm text-[var(--ink-4)]">Standardize spelling before it reaches quotes.</p></div></div>
          <div className="mt-5 grid gap-3">
            <label className="space-y-2"><span className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">Name</span><Input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Chrome" /></label>
            <label className="space-y-2"><span className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">Code</span><Input value={form.code || ''} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="CHR" /></label>
            <label className="space-y-2"><span className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">Description</span><Input value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
            <div className="grid gap-3 sm:grid-cols-2"><label className="space-y-2"><span className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">Status</span><select value={form.status || 'active'} onChange={(e) => setForm({ ...form, status: e.target.value })} className="h-10 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--ink)]"><option value="active">Active</option><option value="inactive">Inactive</option></select></label><label className="space-y-2"><span className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">Sort order</span><Input type="number" value={form.sortOrder || 0} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })} /></label></div>
          </div>
          <div className="mt-5 flex gap-3"><Button disabled={saving || !form.name} onClick={submit}><Save className="mr-2 h-4 w-4" />Save finish</Button><Button variant="outline" onClick={() => setForm(empty)}><RotateCcw className="mr-2 h-4 w-4" />Clear</Button></div>
        </div>
        <div className="mp-panel p-5">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><h2 className="text-2xl font-semibold text-[var(--ink)]">Finishes</h2><p className="mt-1 text-sm text-[var(--ink-4)]">{rows.length} values in master data.</p></div><div className="flex h-10 min-w-72 items-center rounded-md border border-[var(--line)] bg-[var(--surface)] px-3"><Search className="mr-2 h-4 w-4 text-[var(--ink-4)]" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search finishes" className="w-full bg-transparent text-sm outline-none" /></div></div>
          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{filtered.map((row) => <button key={row.id} onClick={() => setForm(row)} className="rounded-r4 border border-[var(--line)] bg-[var(--surface)] p-4 text-left transition hover:border-[var(--brand-300)] hover:shadow-sm-soft"><p className="font-semibold text-[var(--ink)]">{row.name}</p><p className="mt-1 text-xs font-semibold uppercase tracking-wider text-[var(--ink-5)]">{row.status} · {row.code || 'No code'}</p></button>)}</div>
          {!loading && !filtered.length ? <div className="mt-5 rounded-r4 border border-dashed border-[var(--line)] p-8 text-center text-sm font-semibold text-[var(--ink-4)]">No finishes found.</div> : null}
        </div>
      </section>
    </div>
  );
}
