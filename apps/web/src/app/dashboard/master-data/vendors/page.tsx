'use client';

import { useMemo, useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import { Building2, RotateCcw, Save, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QueryErrorBanner } from '@/components/query-state';

const DATA = gql`query { vendors(take: 200) }`;
const SAVE = gql`mutation($input: VendorInput!) { saveVendor(input:$input){ data } }`;
const empty = { id: '', name: '', phone: '', email: '', gstNo: '', address: '', city: '', state: '', contactPerson: '', category: '', status: 'active', notes: '' };

export default function VendorMasterPage() {
  const { data, loading, error, refetch } = useQuery(DATA, { fetchPolicy: 'cache-and-network' });
  const [form, setForm] = useState<any>(empty);
  const [search, setSearch] = useState('');
  const [save, { loading: saving, error: saveError }] = useMutation(SAVE, { onCompleted: () => { void refetch(); setForm(empty); } });
  const vendors = useMemo<any[]>(() => data?.vendors || [], [data?.vendors]);
  const filtered = vendors.filter((vendor) => `${vendor.name} ${vendor.phone} ${vendor.email} ${vendor.gstNo} ${vendor.city}`.toLowerCase().includes(search.toLowerCase()));
  const active = vendors.filter((vendor) => vendor.status !== 'inactive').length;
  const submit = () => save({ variables: { input: { ...form, id: form.id || undefined } } });

  return (
    <div className="space-y-7 pb-10">
      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
      {saveError ? <QueryErrorBanner error={saveError} /> : null}
      <section className="mp-card rounded-r6 border border-[var(--line)] p-6">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--ink-4)]">Vendor master</p>
            <h1 className="mt-3 font-display text-4xl font-bold tracking-[-0.04em] text-[var(--ink)]">Supplier records for procurement and GRN.</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--ink-3)]">Vendors connect Product Master preferences, purchase orders, manual GRNs and supplier challan traceability.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-r4 border border-[var(--line)] bg-[var(--surface)] p-4"><p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--ink-5)]">Active</p><p className="mt-2 font-display text-3xl font-bold text-[var(--ink)]">{active}</p></div>
            <div className="rounded-r4 border border-[var(--line)] bg-[var(--surface)] p-4"><p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--ink-5)]">Total</p><p className="mt-2 font-display text-3xl font-bold text-[var(--ink)]">{vendors.length}</p></div>
          </div>
        </div>
      </section>
      <section className="grid gap-6 xl:grid-cols-[0.78fr_1.22fr]">
        <div className="mp-panel p-5">
          <div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-r3 bg-[var(--brand-50)] text-[var(--brand-700)]"><Building2 className="h-5 w-5" /></div><div><h2 className="text-xl font-semibold text-[var(--ink)]">{form.id ? 'Edit vendor' : 'Add vendor'}</h2><p className="text-sm text-[var(--ink-4)]">Used in PO and GRN screens.</p></div></div>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {[
              ['name', 'Vendor name'], ['contactPerson', 'Contact person'], ['phone', 'Phone'], ['email', 'Email'], ['gstNo', 'GST No'], ['category', 'Category'], ['city', 'City'], ['state', 'State'], ['status', 'Status'], ['address', 'Address'], ['notes', 'Notes'],
            ].map(([key, label]) => (
              <label key={key} className={key === 'address' || key === 'notes' ? 'space-y-2 md:col-span-2' : 'space-y-2'}>
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">{label}</span>
                <Input value={form[key] || ''} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
              </label>
            ))}
          </div>
          <div className="mt-5 flex gap-3"><Button disabled={saving || !form.name} onClick={submit}><Save className="mr-2 h-4 w-4" />Save vendor</Button><Button variant="outline" onClick={() => setForm(empty)}><RotateCcw className="mr-2 h-4 w-4" />Clear</Button></div>
        </div>
        <div className="mp-panel p-5">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><h2 className="text-2xl font-semibold text-[var(--ink)]">Vendors</h2><p className="mt-1 text-sm text-[var(--ink-4)]">Click a supplier to edit.</p></div><div className="flex h-10 min-w-72 items-center rounded-md border border-[var(--line)] bg-[var(--surface)] px-3"><Search className="mr-2 h-4 w-4 text-[var(--ink-4)]" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search vendors" className="w-full bg-transparent text-sm outline-none" /></div></div>
          <div className="mt-5 space-y-3">{filtered.map((vendor) => <button key={vendor.id} onClick={() => setForm({ ...empty, ...vendor })} className="w-full rounded-r4 border border-[var(--line)] bg-[var(--surface)] p-4 text-left transition hover:border-[var(--brand-300)] hover:shadow-sm-soft"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-[var(--ink)]">{vendor.name}</p><p className="mt-1 text-sm text-[var(--ink-4)]">{vendor.contactPerson || 'No contact'} · {vendor.phone || 'No phone'} · {vendor.city || 'No city'}</p></div><span className="rounded-full bg-[var(--brand-50)] px-2 py-1 text-xs font-semibold text-[var(--brand-700)]">{vendor.status || 'active'}</span></div>{vendor.gstNo ? <p className="mt-2 text-xs font-semibold uppercase tracking-wider text-[var(--ink-5)]">GST {vendor.gstNo}</p> : null}</button>)}</div>
          {!loading && !filtered.length ? <div className="mt-5 rounded-r4 border border-dashed border-[var(--line)] p-8 text-center text-sm font-semibold text-[var(--ink-4)]">No vendors found.</div> : null}
        </div>
      </section>
    </div>
  );
}
