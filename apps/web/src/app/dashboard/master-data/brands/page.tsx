'use client';

import { useMemo, useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import { BadgeCheck, Check, ImagePlus, Loader2, Plus, Save, Search, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QueryErrorBanner } from '@/components/query-state';
import { cn } from '@/lib/utils';

const DATA = gql`query { masterProductBrands }`;
const SAVE = gql`mutation($input: ProductBrandInput!) { saveProductBrand(input: $input) { data } }`;
const UPLOAD = gql`mutation($filename: String!, $contentBase64: String!, $scope: String) { uploadStoredAsset(filename: $filename, contentBase64: $contentBase64, scope: $scope) { result } }`;

const empty = { id: '', name: '', code: '', description: '', status: 'active', sortOrder: 0, logoUrl: '', quoteEnabled: true, metadata: {} };

async function fileBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={cn('block space-y-1.5', className)}><span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-4)]">{label}</span>{children}</label>;
}

export default function BrandMasterPage() {
  const { data, loading, error, refetch } = useQuery(DATA, { fetchPolicy: 'cache-and-network' });
  const [form, setForm] = useState<any>(empty);
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadAsset] = useMutation(UPLOAD);
  const [save, saveState] = useMutation(SAVE, {
    onCompleted: () => { setMessage(`${form.name} saved to Brand Master.`); setForm(empty); refetch(); },
  });
  const rows = useMemo<any[]>(() => data?.masterProductBrands || [], [data?.masterProductBrands]);
  const filtered = useMemo(() => rows.filter((row) => `${row.name} ${row.code || ''}`.toLowerCase().includes(search.toLowerCase())), [rows, search]);
  const quoteReady = rows.filter((row) => row.status === 'active' && row.metadata?.logoUrl && row.metadata?.quoteEnabled !== false).length;

  const selectRow = (row: any) => {
    setMessage('');
    setForm({ ...row, logoUrl: row.metadata?.logoUrl || '', quoteEnabled: row.metadata?.quoteEnabled !== false });
  };

  async function uploadLogo(file?: File) {
    if (!file) return;
    setMessage('');
    setUploading(true);
    try {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size <= 0 || file.size > 5 * 1024 * 1024) throw new Error('Use a JPG, PNG or WebP logo smaller than 5 MB.');
      const result = await uploadAsset({ variables: { filename: file.name, contentBase64: await fileBase64(file), scope: 'brand-logo' } });
      const logoUrl = result.data?.uploadStoredAsset?.result?.publicUrl;
      if (!logoUrl) throw new Error('The upload did not return a logo URL.');
      setForm((current: any) => ({ ...current, logoUrl }));
      setMessage('Logo uploaded. Save the brand to publish it to quotations.');
    } catch (uploadError: any) {
      setMessage(uploadError.message || 'Logo upload failed.');
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    setMessage('');
    await save({ variables: { input: {
      id: form.id || undefined,
      expectedUpdatedAt: form.id ? form.updatedAt : undefined,
      name: form.name,
      code: form.code || undefined,
      description: form.description || '',
      status: form.status || 'active',
      sortOrder: Number(form.sortOrder || 0),
      metadata: { ...(form.metadata || {}), logoUrl: form.logoUrl || '', quoteEnabled: Boolean(form.quoteEnabled) },
    } } });
  }

  return <div className="space-y-6 pb-10">
    <header className="flex flex-col gap-4 border-b border-[var(--line)] pb-6 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand-700)]">Master data · presentation</p>
        <h1 className="mt-2 font-display text-3xl font-bold text-[var(--ink)] lg:text-4xl">Brand library</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-3)]">Maintain the exact name and customer-facing logo once. Quote editors can then choose which served brands appear in each PDF.</p>
      </div>
      <div className="flex gap-3">
        <div className="min-w-32 border-l border-[var(--line)] pl-4"><p className="text-2xl font-bold text-[var(--ink)]">{rows.length}</p><p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--ink-4)]">Total brands</p></div>
        <div className="min-w-32 border-l border-[var(--line)] pl-4"><p className="text-2xl font-bold text-[var(--brand-700)]">{quoteReady}</p><p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--ink-4)]">Quote ready</p></div>
      </div>
    </header>

    {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
    {saveState.error ? <QueryErrorBanner error={saveState.error} /> : null}
    {message ? <div className="flex items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm font-semibold text-[var(--ink-2)]"><Check className="h-4 w-4 text-[var(--success)]" />{message}</div> : null}

    <section className="grid gap-6 xl:grid-cols-[23rem_minmax(0,1fr)]">
      <form onSubmit={(event) => { event.preventDefault(); submit(); }} className="mp-panel self-start p-5">
        <div className="flex items-center justify-between gap-3">
          <div><p className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">{form.id ? 'Editing brand' : 'New brand'}</p><h2 className="mt-1 text-xl font-semibold text-[var(--ink)]">{form.id ? form.name : 'Create brand'}</h2></div>
          {form.id ? <button type="button" title="Create another brand" onClick={() => setForm(empty)} className="grid h-9 w-9 place-items-center rounded-md border border-[var(--line)] text-[var(--ink-3)]"><Plus className="h-4 w-4" /></button> : null}
        </div>

        <div className="mt-5 overflow-hidden rounded-md border border-dashed border-[var(--line-strong)] bg-[var(--bg-soft)]">
          <div className="grid h-32 place-items-center p-4">
            {form.logoUrl ? <img src={form.logoUrl} alt={`${form.name || 'Brand'} logo preview`} className="max-h-24 max-w-full object-contain" /> : <div className="text-center text-[var(--ink-4)]"><ImagePlus className="mx-auto h-6 w-6" /><p className="mt-2 text-xs font-semibold">No logo uploaded</p></div>}
          </div>
          <div className="flex items-center justify-between border-t border-[var(--line)] bg-[var(--surface)] px-3 py-2">
            <span className="truncate pr-3 text-[10px] font-medium text-[var(--ink-4)]">JPG, PNG or WebP · 5 MB max</span>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-[var(--ink)] px-3 py-2 text-xs font-semibold text-white">
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}{uploading ? 'Uploading' : form.logoUrl ? 'Replace' : 'Upload'}
              <input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} className="hidden" onChange={(event) => uploadLogo(event.target.files?.[0])} />
            </label>
          </div>
        </div>

        <div className="mt-5 grid gap-4">
          <Field label="Brand name"><Input required value={form.name || ''} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Grohe" /></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="Code"><Input value={form.code || ''} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} placeholder="GROHE" /></Field><Field label="Sort order"><Input type="number" value={form.sortOrder || 0} onChange={(event) => setForm({ ...form, sortOrder: event.target.value })} /></Field></div>
          <Field label="Description"><textarea value={form.description || ''} onChange={(event) => setForm({ ...form, description: event.target.value })} className="min-h-20 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--brand-400)]" placeholder="Customer-facing positioning or internal note" /></Field>
          <Field label="Status"><select value={form.status || 'active'} onChange={(event) => setForm({ ...form, status: event.target.value })} className="h-10 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--ink)]"><option value="active">Active</option><option value="inactive">Inactive</option></select></Field>
          <label className="flex items-start gap-3 rounded-md border border-[var(--line)] bg-[var(--bg-soft)] p-3"><input type="checkbox" checked={Boolean(form.quoteEnabled)} onChange={(event) => setForm({ ...form, quoteEnabled: event.target.checked })} className="mt-0.5 h-4 w-4 accent-[var(--brand-600)]" /><span><span className="block text-sm font-semibold text-[var(--ink)]">Available in quotation brand strip</span><span className="mt-1 block text-xs leading-5 text-[var(--ink-4)]">Sales can still decide whether it appears on each individual quote.</span></span></label>
        </div>
        <div className="mt-5 flex gap-2"><Button type="submit" className="flex-1" disabled={saveState.loading || uploading || !form.name.trim()}><Save className="mr-2 h-4 w-4" />{saveState.loading ? 'Saving' : 'Save brand'}</Button>{form.id ? <Button type="button" variant="outline" title="Cancel editing" onClick={() => setForm(empty)}><X className="h-4 w-4" /></Button> : null}</div>
      </form>

      <div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-xl font-semibold text-[var(--ink)]">Served brands</h2><p className="mt-1 text-sm text-[var(--ink-4)]">Select a row to edit its name, logo or quotation availability.</p></div><div className="flex h-10 min-w-64 items-center rounded-md border border-[var(--line)] bg-[var(--surface)] px-3"><Search className="mr-2 h-4 w-4 text-[var(--ink-4)]" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search brands" className="w-full bg-transparent text-sm text-[var(--ink)] outline-none" /></div></div>
        {loading && !rows.length ? <div className="mt-5 h-40 animate-pulse rounded-md bg-[var(--bg-soft)]" /> : null}
        <div className="mt-5 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {filtered.map((row) => <button key={row.id} onClick={() => selectRow(row)} className={cn('group flex min-h-28 items-center gap-4 rounded-md border bg-[var(--surface)] p-4 text-left transition hover:border-[var(--brand-400)] hover:shadow-md-soft', form.id === row.id ? 'border-[var(--brand-500)] ring-2 ring-[var(--ring)]' : 'border-[var(--line)]')}>
            <div className="grid h-16 w-24 shrink-0 place-items-center overflow-hidden rounded-md border border-[var(--line-soft)] bg-white p-2">{row.metadata?.logoUrl ? <img src={row.metadata.logoUrl} alt={row.name} className="max-h-12 max-w-full object-contain" /> : <span className="text-lg font-bold text-[var(--brand-700)]">{String(row.name || 'MP').slice(0, 2).toUpperCase()}</span>}</div>
            <div className="min-w-0"><p className="truncate font-semibold text-[var(--ink)]">{row.name}</p><p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--ink-5)]">{row.code || 'No code'} · {row.status}</p><span className={cn('mt-3 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold', row.metadata?.logoUrl && row.metadata?.quoteEnabled !== false ? 'bg-[var(--success-bg)] text-[var(--success)]' : 'bg-[var(--bg-soft)] text-[var(--ink-4)]')}>{row.metadata?.logoUrl && row.metadata?.quoteEnabled !== false ? <BadgeCheck className="h-3 w-3" /> : null}{row.metadata?.logoUrl ? row.metadata?.quoteEnabled === false ? 'Hidden from quotes' : 'Quote ready' : 'Logo required'}</span></div>
          </button>)}
        </div>
        {!loading && !filtered.length ? <div className="mt-5 rounded-md border border-dashed border-[var(--line-strong)] py-16 text-center"><ImagePlus className="mx-auto h-6 w-6 text-[var(--ink-5)]" /><p className="mt-3 text-sm font-semibold text-[var(--ink-3)]">No brands match this search.</p></div> : null}
      </div>
    </section>
  </div>;
}
