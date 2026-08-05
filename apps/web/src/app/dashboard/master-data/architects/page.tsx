'use client';

import { useMemo, useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import { Compass, RotateCcw, Save, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QueryErrorBanner } from '@/components/query-state';

const DATA = gql`query { architects(take: 200) }`;
const SAVE = gql`mutation($input: ArchitectInput!) { saveArchitect(input:$input){ data } }`;
const empty = { id: '', name: '', phone: '', email: '', firmName: '', city: '', address: '', registrationNo: '', status: 'active', notes: '' };

export default function ArchitectMasterPage() {
  const { data, loading, error, refetch } = useQuery(DATA, { fetchPolicy: 'cache-and-network' });
  const [form, setForm] = useState<any>(empty);
  const [search, setSearch] = useState('');
  const [save, { loading: saving, error: saveError }] = useMutation(SAVE, { onCompleted: () => { void refetch(); setForm(empty); } });
  const architects = useMemo<any[]>(() => data?.architects || [], [data?.architects]);
  const filtered = architects.filter((row) => `${row.name} ${row.firmName} ${row.phone} ${row.email} ${row.city} ${row.registrationNo}`.toLowerCase().includes(search.toLowerCase()));
  const active = architects.filter((row) => row.status !== 'inactive').length;
  const submit = () => save({ variables: { input: { ...form, id: form.id || undefined } } });

  return (
    <div className="space-y-7 pb-10">
      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
      {saveError ? <QueryErrorBanner error={saveError} /> : null}
      <section className="mp-card rounded-r6 border border-[var(--line)] p-6">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--ink-4)]">Architect master</p>
            <h1 className="mt-3 font-display text-4xl font-bold tracking-[-0.04em] text-[var(--ink)]">Consulting architects for quotes and reports.</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--ink-3)]">Maintain architect and firm records once, then select who is consulting on each quote for PDFs, filters and later performance reports.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-r4 border border-[var(--line)] bg-[var(--surface)] p-4"><p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--ink-5)]">Active</p><p className="mt-2 font-display text-3xl font-bold text-[var(--ink)]">{active}</p></div>
            <div className="rounded-r4 border border-[var(--line)] bg-[var(--surface)] p-4"><p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--ink-5)]">Total</p><p className="mt-2 font-display text-3xl font-bold text-[var(--ink)]">{architects.length}</p></div>
          </div>
        </div>
      </section>
      <section className="grid gap-6 xl:grid-cols-[0.78fr_1.22fr]">
        <div className="mp-panel p-5">
          <div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-r3 bg-[var(--brand-50)] text-[var(--brand-700)]"><Compass className="h-5 w-5" /></div><div><h2 className="text-xl font-semibold text-[var(--ink)]">{form.id ? 'Edit architect' : 'Add architect'}</h2><p className="text-sm text-[var(--ink-4)]">Selected while creating quotes.</p></div></div>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {[
              ['name', 'Architect name'], ['firmName', 'Firm name'], ['phone', 'Phone'], ['email', 'Email'], ['registrationNo', 'Registration No'], ['city', 'City'], ['status', 'Status'], ['address', 'Address'], ['notes', 'Notes'],
            ].map(([key, label]) => (
              <label key={key} className={key === 'address' || key === 'notes' ? 'space-y-2 md:col-span-2' : 'space-y-2'}>
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">{label}</span>
                <Input value={form[key] || ''} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
              </label>
            ))}
          </div>
          <div className="mt-5 flex gap-3"><Button disabled={saving || !form.name} onClick={submit}><Save className="mr-2 h-4 w-4" />Save architect</Button><Button variant="outline" onClick={() => setForm(empty)}><RotateCcw className="mr-2 h-4 w-4" />Clear</Button></div>
        </div>
        <div className="mp-panel p-5">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><h2 className="text-2xl font-semibold text-[var(--ink)]">Architects</h2><p className="mt-1 text-sm text-[var(--ink-4)]">Click a row to edit.</p></div><div className="flex h-10 min-w-72 items-center rounded-md border border-[var(--line)] bg-[var(--surface)] px-3"><Search className="mr-2 h-4 w-4 text-[var(--ink-4)]" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search architects" className="w-full bg-transparent text-sm outline-none" /></div></div>
          <div className="mt-5 space-y-3">{filtered.map((row) => <button key={row.id} onClick={() => setForm({ ...empty, ...row })} className="w-full rounded-r4 border border-[var(--line)] bg-[var(--surface)] p-4 text-left transition hover:border-[var(--brand-300)] hover:shadow-sm-soft"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-[var(--ink)]">{row.name}</p><p className="mt-1 text-sm text-[var(--ink-4)]">{row.firmName || 'Independent'} · {row.phone || 'No phone'} · {row.city || 'No city'}</p></div><span className="rounded-full bg-[var(--brand-50)] px-2 py-1 text-xs font-semibold text-[var(--brand-700)]">{row.status || 'active'}</span></div>{row.registrationNo ? <p className="mt-2 text-xs font-semibold uppercase tracking-wider text-[var(--ink-5)]">Reg {row.registrationNo}</p> : null}</button>)}</div>
          {!loading && !filtered.length ? <div className="mt-5 rounded-r4 border border-dashed border-[var(--line)] p-8 text-center text-sm font-semibold text-[var(--ink-4)]">No architects found.</div> : null}
        </div>
      </section>
    </div>
  );
}
