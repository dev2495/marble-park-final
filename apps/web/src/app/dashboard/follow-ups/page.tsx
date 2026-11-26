'use client';

// Follow-up desk: every record that was quick-added (customers, SKUs,
// architects, vendors, brands, categories, finishes, tile sizes) with the
// details it still misses. Fill them in place and mark the record complete.
import Link from 'next/link';
import { gql, useMutation, useQuery } from '@apollo/client';
import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ExternalLink, ImagePlus, Loader2, Search } from 'lucide-react';
import { QueryErrorBanner } from '@/components/query-state';
import { MasterQuickAdd, QuickSkuButton, inputClass, primaryButton, secondaryButton } from '@/components/quick-add/quick-add';
import { describeApolloError } from '@/lib/apollo-errors';
import { useUnsavedChanges } from '@/hooks/use-unsaved-changes';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const QUEUE = gql`query FollowUpQueue { followUpQueue me { id effectivePermissions } }`;
const COMPLETE = gql`mutation CompleteFollowUp($entityType: String!, $id: ID!, $values: JSON!, $markComplete: Boolean!) { completeFollowUp(entityType: $entityType, id: $id, values: $values, markComplete: $markComplete) }`;
const UPLOAD = gql`mutation FollowUpUpload($filename: String!, $contentBase64: String!, $scope: String) { uploadStoredAsset(filename: $filename, contentBase64: $contentBase64, scope: $scope) { result } }`;

type FieldDef = { key: string; label: string; type?: 'text' | 'number' | 'image' | 'select' | 'textarea'; options?: string[]; wide?: boolean; pricing?: boolean; placeholder?: string };
const FIELDS: Record<string, FieldDef[]> = {
  Customer: [
    { key: 'name', label: 'Name' }, { key: 'mobile', label: 'Mobile' }, { key: 'email', label: 'Email' }, { key: 'gstNo', label: 'GSTIN' },
    { key: 'city', label: 'City' }, { key: 'state', label: 'State' }, { key: 'siteAddress', label: 'Site address', type: 'textarea', wide: true },
  ],
  Product: [
    { key: 'photoUrl', label: 'Photo', type: 'image', wide: true }, { key: 'name', label: 'Item name', wide: true }, { key: 'brand', label: 'Brand' }, { key: 'finish', label: 'Finish' },
    { key: 'hsnCode', label: 'HSN code' }, { key: 'floorPriceInclusive', label: 'Floor price ₹ (before GST)', type: 'number', pricing: true }, { key: 'description', label: 'Description', type: 'textarea', wide: true },
  ],
  Architect: [
    { key: 'name', label: 'Name' }, { key: 'firmName', label: 'Firm' }, { key: 'phone', label: 'Mobile' }, { key: 'email', label: 'Email' },
    { key: 'city', label: 'City' }, { key: 'registrationNo', label: 'Registration no.' }, { key: 'address', label: 'Address', type: 'textarea', wide: true },
  ],
  Vendor: [
    { key: 'name', label: 'Name' }, { key: 'contactPerson', label: 'Contact person' }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' },
    { key: 'gstNo', label: 'GSTIN' }, { key: 'city', label: 'City' }, { key: 'state', label: 'State' }, { key: 'address', label: 'Address', type: 'textarea', wide: true },
  ],
  ProductBrand: [{ key: 'logoUrl', label: 'Logo', type: 'image', wide: true }, { key: 'name', label: 'Name' }, { key: 'code', label: 'Code' }, { key: 'description', label: 'Description', type: 'textarea', wide: true }],
  ProductCategory: [{ key: 'name', label: 'Name' }, { key: 'code', label: 'Code' }, { key: 'description', label: 'Description', type: 'textarea', wide: true }],
  ProductFinish: [{ key: 'name', label: 'Name' }, { key: 'code', label: 'Code' }, { key: 'description', label: 'Description', type: 'textarea', wide: true }],
  TileSize: [
    { key: 'name', label: 'Name' }, { key: 'code', label: 'Code' }, { key: 'widthMm', label: 'Width mm', type: 'number' }, { key: 'heightMm', label: 'Height mm', type: 'number' },
    { key: 'thicknessMm', label: 'Thickness mm', type: 'number' }, { key: 'pcsPerBox', label: 'Pieces per box', type: 'number' }, { key: 'uom', label: 'Stocked by', type: 'select', options: ['BOX', 'PC'] },
  ],
};
const TYPE_LABELS: Array<[string, string]> = [['all', 'All'], ['Customer', 'Customers'], ['Product', 'SKUs'], ['Architect', 'Architects'], ['Vendor', 'Vendors'], ['ProductBrand', 'Brands'], ['ProductCategory', 'Categories'], ['ProductFinish', 'Finishes'], ['TileSize', 'Tile sizes']];
const OPTIONAL = new Set(['description', 'thicknessMm', 'registrationNo', 'state', 'contactPerson', 'finish', 'code', 'email']);

function ago(value: unknown) {
  const time = new Date(String(value || '')).getTime();
  if (!Number.isFinite(time)) return '';
  const days = Math.floor((Date.now() - time) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}
async function fileBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

export default function FollowUpsPage() {
  const { data, loading, error, refetch } = useQuery(QUEUE, { fetchPolicy: 'cache-and-network' });
  const [complete, completeState] = useMutation(COMPLETE);
  const [upload] = useMutation(UPLOAD);
  const [type, setType] = useState('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'newest' | 'oldest' | 'most'>('oldest');
  const [selectedKey, setSelectedKey] = useState('');
  const [values, setValues] = useState<Record<string, any>>({});
  const [message, setMessage] = useState('');
  const [formError, setFormError] = useState('');
  const [uploading, setUploading] = useState('');
  const permissions: string[] = data?.me?.effectivePermissions || [];
  const canPrice = permissions.includes('pricing.manage');
  const canComplete = permissions.includes('follow_ups.manage');

  const items: any[] = useMemo(() => data?.followUpQueue || [], [data?.followUpQueue]);
  const counts = useMemo<Record<string, number>>(() => items.reduce((acc: Record<string, number>, item) => ({ ...acc, [item.entityType]: (acc[item.entityType] || 0) + 1 }), {} as Record<string, number>), [items]);
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const rows = items.filter((item) => (type === 'all' || item.entityType === type) && (!term || `${item.name} ${item.detail} ${item.label}`.toLowerCase().includes(term)));
    return rows.sort((a, b) => sort === 'most' ? b.missing.length - a.missing.length : (new Date(a.flaggedAt).getTime() - new Date(b.flaggedAt).getTime()) * (sort === 'oldest' ? 1 : -1));
  }, [items, search, sort, type]);
  const keyOf = (item: any) => `${item.entityType}:${item.id}`;
  const selected = visible.find((item) => keyOf(item) === selectedKey) || visible[0];
  useEffect(() => { if (selected) { setValues({ ...(selected.values || {}) }); setFormError(''); } }, [selected?.entityType, selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const fields = selected ? (FIELDS[selected.entityType] || []) : [];
  const changed = selected ? Object.fromEntries(Object.entries(values).filter(([key, value]) => String(value ?? '') !== String(selected.values?.[key] ?? ''))) : {};
  // Typed details are not lost by a link, a closed tab, or picking another record without asking first.
  useUnsavedChanges(Object.keys(changed).length > 0, 'You typed details that are not saved yet. Leave and lose them?');
  const [pendingKey, setPendingKey] = useState('');
  const chooseRecord = (key: string) => { if (selected && key !== keyOf(selected) && Object.keys(changed).length) setPendingKey(key); else setSelectedKey(key); };
  const emptyRequired = fields.filter((field) => !OPTIONAL.has(field.key) && !(field.pricing && !canPrice) && String(values[field.key] ?? '').trim() === '');

  const save = async (markComplete: boolean) => {
    if (!selected) return;
    setFormError('');
    try {
      await complete({ variables: { entityType: selected.entityType, id: selected.id, values: changed, markComplete } });
      const index = visible.findIndex((item) => keyOf(item) === keyOf(selected));
      const next = markComplete ? visible[index + 1] || visible[index - 1] : selected;
      setMessage(markComplete ? `${selected.name} completed and removed from the queue.` : `${selected.name} saved.`);
      await refetch();
      if (next) setSelectedKey(keyOf(next));
      window.setTimeout(() => setMessage(''), 4500);
    } catch (err) {
      const diagnostic = describeApolloError(err, 'CompleteFollowUp');
      setFormError(diagnostic.remediation || diagnostic.message);
    }
  };
  const onImage = async (key: string, file: File | null) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) { setFormError('Use a JPG, PNG or WebP image under 5 MB.'); return; }
    setUploading(key);
    try {
      const url = (await upload({ variables: { filename: file.name, contentBase64: await fileBase64(file), scope: 'product-image' } })).data?.uploadStoredAsset?.result?.publicUrl;
      if (url) setValues((current) => ({ ...current, [key]: url }));
    } catch (err) { setFormError(describeApolloError(err, 'Upload').message); } finally { setUploading(''); }
  };

  return (
    <div className="space-y-4 pb-10">
      <header className="mp-page-header">
        <div className="min-w-0">
          <p className="mp-eyebrow">People & data</p>
          <h1 className="mp-page-title">Follow-ups</h1>
          <p className="mp-page-sub">Everything added in a hurry at the counter, with what it still misses. Pick a record, fill the highlighted fields, and mark it complete.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <QuickSkuButton onDone={() => refetch()} />
          <MasterQuickAdd kind="architect" label="Quick add architect" onDone={() => refetch()} />
        </div>
      </header>

      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
      {message ? <p role="status" className="flex items-center gap-2 rounded-r4 bg-[var(--success-bg)] px-4 py-2 text-sm font-semibold text-[var(--success)]"><CheckCircle2 className="h-4 w-4" />{message}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-lg bg-[var(--bg-soft)] p-1">
          {TYPE_LABELS.map(([value, label]) => {
            const count = value === 'all' ? items.length : counts[value] || 0;
            if (value !== 'all' && !count) return null;
            return <button key={value} type="button" onClick={() => setType(value)} aria-pressed={type === value} className={cn('rounded-md px-3 py-1.5 text-xs font-semibold', type === value ? 'bg-[var(--surface)] text-[var(--ink)] shadow-sm' : 'text-[var(--ink-3)]')}>{label} <span className="font-mono text-[var(--ink-4)]">{count}</span></button>;
          })}
        </div>
        <div className="relative ml-auto w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--ink-4)]" />
          <input aria-label="Search follow-ups" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, code or mobile" className={cn(inputClass, 'h-9 pl-9')} />
        </div>
        <select aria-label="Sort" value={sort} onChange={(event) => setSort(event.target.value as any)} className={cn(inputClass, 'h-9 w-auto')}><option value="oldest">Oldest first</option><option value="newest">Newest first</option><option value="most">Most missing</option></select>
      </div>

      {loading && !items.length ? <div role="status" aria-label="Loading follow-ups" className="grid gap-4 lg:grid-cols-[minmax(18rem,26rem)_minmax(0,1fr)]"><div className="space-y-2"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div><Skeleton className="h-72 w-full" /></div> : null}
      {!loading && !error && !items.length ? (
        <EmptyState icon={CheckCircle2} className="rounded-r5 border border-dashed border-[var(--line-strong)] bg-[var(--surface)]" title="Nothing waiting" description="Customers, SKUs and masters added with Quick add will appear here until their details are complete." />
      ) : null}

      {items.length ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(18rem,26rem)_minmax(0,1fr)]">
          <ul className="max-h-[calc(100vh-17rem)] space-y-1.5 overflow-y-auto pr-1" aria-label="Records to follow up">
            {visible.map((item) => {
              const active = selected && keyOf(item) === keyOf(selected);
              return (
                <li key={keyOf(item)}>
                  <button type="button" onClick={() => chooseRecord(keyOf(item))} aria-current={active} className={cn('w-full rounded-r4 border px-3 py-2.5 text-left transition', active ? 'border-[var(--brand-500)] bg-[var(--surface)] shadow-sm-soft' : 'border-[var(--line)] bg-[var(--surface)] hover:border-[var(--line-strong)]')}>
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-[var(--bg-soft)] px-1.5 py-0.5 text-[10.5px] font-semibold text-[var(--ink-3)]">{item.label}</span>
                      <b className="min-w-0 flex-1 truncate text-sm text-[var(--ink)]">{item.name}</b>
                      <span className="shrink-0 text-[11px] text-[var(--ink-4)]">{ago(item.flaggedAt)}</span>
                    </div>
                    {item.detail ? <p className="mt-0.5 truncate font-mono text-[11px] text-[var(--ink-4)]">{item.detail}</p> : null}
                    <div className="mt-1.5 flex flex-wrap gap-1">{item.missing.map((miss: string) => <span key={miss} className="rounded bg-[var(--warning-bg)] px-1.5 py-0.5 text-[10.5px] font-semibold text-[var(--warning)]">{miss}</span>)}</div>
                  </button>
                </li>
              );
            })}
            {!visible.length ? <li className="px-2 text-sm text-[var(--ink-4)]">No records match.</li> : null}
          </ul>

          {selected ? (
            <section className="rounded-r5 border border-[var(--line)] bg-[var(--surface)]" aria-label={`Complete ${selected.name}`}>
              <div className="flex flex-wrap items-start gap-3 border-b border-[var(--line)] px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ink-4)]">{selected.label}{selected.flaggedByName ? ` · added by ${selected.flaggedByName}` : ''} · {ago(selected.flaggedAt)}</p>
                  <h2 className="mt-1 font-display text-2xl font-bold text-[var(--ink)]">{selected.name}</h2>
                  {selected.entityType === 'Product' ? <p className="mt-1 text-sm text-[var(--ink-3)]"><span className="font-mono">{selected.detail}</span> · {selected.values?.category} · MRP ₹{Number(selected.values?.defaultMrpInclusive || 0).toLocaleString('en-IN')} per {String(selected.values?.unit || 'pc').toLowerCase()}</p> : null}
                </div>
                {selected.href ? <Link href={selected.href} className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand-700)] hover:underline">Open full record<ExternalLink className="h-3.5 w-3.5" /></Link> : null}
              </div>
              <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
                {fields.map((field) => {
                  const value = values[field.key] ?? '';
                  const empty = String(value).trim() === '';
                  const lockedPricing = field.pricing && !canPrice;
                  const highlight = empty && !OPTIONAL.has(field.key) && !lockedPricing;
                  return (
                    <label key={field.key} className={cn('flex flex-col gap-1 text-xs font-semibold text-[var(--ink-3)]', field.wide && 'sm:col-span-2')}>
                      <span className="flex items-center gap-2">{field.label}{highlight ? <span className="rounded bg-[var(--warning-bg)] px-1.5 text-[10px] text-[var(--warning)]">missing</span> : null}{OPTIONAL.has(field.key) ? <span className="font-normal text-[var(--ink-4)]">optional</span> : null}</span>
                      {field.type === 'image' ? (
                        <div className="flex items-center gap-3">
                          <div className="grid h-20 w-20 place-items-center overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--bg-soft)]">{value ? <img src={value} alt="" className="h-full w-full object-contain" /> : <ImagePlus className="h-5 w-5 text-[var(--ink-4)]" />}</div>
                          <span className={cn(secondaryButton, 'h-9 cursor-pointer')}>{uploading === field.key ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}{value ? 'Replace' : 'Upload'}<input type="file" aria-label={`${field.label} file`} accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => onImage(field.key, event.target.files?.[0] || null)} /></span>
                        </div>
                      ) : field.type === 'textarea' ? (
                        <textarea value={value} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} className={cn(inputClass, 'h-20 py-2', highlight && 'border-[var(--warning)] bg-[var(--warning-bg)]')} />
                      ) : field.type === 'select' ? (
                        <select value={value} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} className={inputClass}>{(field.options || []).map((option) => <option key={option}>{option}</option>)}</select>
                      ) : (
                        <input type={field.type === 'number' ? 'number' : 'text'} disabled={lockedPricing} value={value} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                          className={cn(inputClass, highlight && 'border-[var(--warning)] bg-[var(--warning-bg)]', lockedPricing && 'cursor-not-allowed opacity-60')} title={lockedPricing ? 'Needs MRP Control Desk rights' : undefined} />
                      )}
                      {lockedPricing ? <span className="font-normal text-[var(--ink-4)]">Set by someone with MRP Control Desk rights.</span> : null}
                    </label>
                  );
                })}
              </div>
              {formError ? <p role="alert" className="mx-5 mb-3 rounded-lg bg-[var(--warning-bg)] px-3 py-2 text-sm font-medium text-[var(--warning)]">{formError}</p> : null}
              <div className="flex flex-wrap items-center gap-2 border-t border-[var(--line)] px-5 py-3">
                <span className="mr-auto text-xs text-[var(--ink-4)]">{emptyRequired.length ? `${emptyRequired.length} field${emptyRequired.length === 1 ? '' : 's'} still empty` : 'All key details filled'}</span>
                {!canComplete ? <span className="text-xs font-semibold text-[var(--warning)]">You need the Complete follow-ups right to save here.</span> : null}
                <button type="button" disabled={!canComplete || completeState.loading || !Object.keys(changed).length} onClick={() => save(false)} className={secondaryButton}>Save</button>
                <button type="button" disabled={!canComplete || completeState.loading} onClick={() => save(true)} className={primaryButton}>{completeState.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}{Object.keys(changed).length ? 'Save and mark complete' : 'Mark complete'}</button>
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
      <ConfirmDialog
        open={Boolean(pendingKey)}
        onOpenChange={(open) => { if (!open) setPendingKey(''); }}
        title="Leave this record without saving?"
        description={`The details you typed for ${selected?.name || 'this record'} are not saved yet. If you open another record they are lost.`}
        confirmLabel="Open the other record"
        cancelLabel="Keep editing"
        tone="danger"
        onConfirm={() => { setSelectedKey(pendingKey); setPendingKey(''); }}
      />
    </div>
  );
}
