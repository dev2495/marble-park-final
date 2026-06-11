'use client';

import { useMemo, useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import { Layers3, RotateCcw, Save, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QueryErrorBanner } from '@/components/query-state';

const DATA = gql`query { masterProductCategories }`;
const SAVE_CATEGORY = gql`mutation($input: ProductCategoryInput!) { saveProductCategory(input: $input) { data } }`;
const empty = { id: '', name: '', code: '', description: '', status: 'active', sortOrder: 0 };

export default function CategoryMasterPage() {
  const { data, loading, error, refetch } = useQuery(DATA, { fetchPolicy: 'cache-and-network' });
  const [form, setForm] = useState<any>(empty);
  const [search, setSearch] = useState('');
  const [save, { loading: saving, error: saveError }] = useMutation(SAVE_CATEGORY, { onCompleted: () => { void refetch(); setForm(empty); } });
  const rows = useMemo<any[]>(() => data?.masterProductCategories || [], [data?.masterProductCategories]);
  const filtered = useMemo(() => rows.filter((row) => `${row.name} ${row.code} ${row.description}`.toLowerCase().includes(search.toLowerCase())), [rows, search]);
  const active = rows.filter((row) => row.status === 'active').length;
  const submit = () => save({ variables: { input: { ...form, id: form.id || undefined, sortOrder: Number(form.sortOrder || 0) } } });

  return (
    <div className="space-y-7 pb-10">
      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
      {saveError ? <QueryErrorBanner error={saveError} /> : null}

      <section className="mp-card rounded-r6 border border-[var(--line)] p-6">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--ink-4)]">Category master</p>
            <h1 className="mt-3 font-display text-4xl font-bold tracking-[-0.04em] text-[var(--ink)]">Control catalogue, quote and inventory categories.</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--ink-3)]">Categories drive Product Master dropdowns, catalogue filters, lead intent rows and inventory reporting. Excel imports auto-create missing values, and admins can clean them here.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-r4 border border-[var(--line)] bg-[var(--surface)] p-4"><p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--ink-5)]">Active</p><p className="mt-2 font-display text-3xl font-bold text-[var(--ink)]">{active}</p></div>
            <div className="rounded-r4 border border-[var(--line)] bg-[var(--surface)] p-4"><p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--ink-5)]">Total</p><p className="mt-2 font-display text-3xl font-bold text-[var(--ink)]">{rows.length}</p></div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.7fr_1.3fr]">
        <div className="mp-panel p-5">
          <div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-r3 bg-[var(--brand-50)] text-[var(--brand-700)]"><Layers3 className="h-5 w-5" /></div><div><h2 className="text-xl font-semibold text-[var(--ink)]">{form.id ? 'Edit category' : 'Add category'}</h2><p className="text-sm text-[var(--ink-4)]">Changes apply everywhere this value is used.</p></div></div>
          <div className="mt-5 grid gap-3">
            <label className="space-y-2"><span className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">Name</span><Input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Faucets & Showers" /></label>
            <label className="space-y-2"><span className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">Code</span><Input value={form.code || ''} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="FAUCETS" /></label>
            <label className="space-y-2"><span className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">Description</span><Input value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
            <div className="grid gap-3 sm:grid-cols-2"><label className="space-y-2"><span className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">Status</span><select value={form.status || 'active'} onChange={(e) => setForm({ ...form, status: e.target.value })} className="h-10 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--ink)]"><option value="active">Active</option><option value="inactive">Inactive</option></select></label><label className="space-y-2"><span className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">Sort order</span><Input type="number" value={form.sortOrder || 0} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })} /></label></div>
          </div>
          <div className="mt-5 flex gap-3"><Button disabled={saving || !form.name} onClick={submit}><Save className="mr-2 h-4 w-4" />Save category</Button><Button variant="outline" onClick={() => setForm(empty)}><RotateCcw className="mr-2 h-4 w-4" />Clear</Button></div>
        </div>

        <div className="mp-panel p-5">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><h2 className="text-2xl font-semibold text-[var(--ink)]">Categories</h2><p className="mt-1 text-sm text-[var(--ink-4)]">Click any row to edit.</p></div><div className="flex h-10 min-w-72 items-center rounded-md border border-[var(--line)] bg-[var(--surface)] px-3"><Search className="mr-2 h-4 w-4 text-[var(--ink-4)]" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search categories" className="w-full bg-transparent text-sm outline-none" /></div></div>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {filtered.map((row) => <button key={row.id} onClick={() => setForm(row)} className="rounded-r4 border border-[var(--line)] bg-[var(--surface)] p-4 text-left transition hover:border-[var(--brand-300)] hover:shadow-sm-soft"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-[var(--ink)]">{row.name}</p><p className="mt-1 text-xs font-semibold uppercase tracking-wider text-[var(--ink-5)]">{row.code || 'No code'}</p></div><span className="rounded-full bg-[var(--brand-50)] px-2 py-1 text-xs font-semibold text-[var(--brand-700)]">{row.status}</span></div>{row.description ? <p className="mt-3 text-sm text-[var(--ink-4)]">{row.description}</p> : null}</button>)}
          </div>
          {!loading && !filtered.length ? <div className="mt-5 rounded-r4 border border-dashed border-[var(--line)] p-8 text-center text-sm font-semibold text-[var(--ink-4)]">No categories found.</div> : null}
        </div>
      </section>
    </div>
  );
}
