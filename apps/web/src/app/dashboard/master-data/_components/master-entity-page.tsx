'use client';

import { gql, useMutation, useQuery } from '@apollo/client';
import { BadgeCheck, Building2, Edit3, Layers3, Loader2, Palette, Plus, RefreshCcw, Save, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QueryErrorBanner } from '@/components/query-state';
import { cn } from '@/lib/utils';

type FieldConfig = {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'textarea' | 'select';
  placeholder?: string;
  options?: string[];
  className?: string;
};

type IconKey = 'category' | 'brand' | 'finish' | 'vendor';
type Variant = 'standard' | 'brand' | 'vendor';

type MasterEntityPageProps = {
  title: string;
  eyebrow: string;
  description: string;
  icon: IconKey;
  tone: 'brand' | 'success' | 'warning' | 'violet' | 'sky';
  queryName: string;
  mutationName: string;
  mutationInputType: string;
  listTitle: string;
  emptyLabel: string;
  fields: FieldConfig[];
  empty: Record<string, any>;
  variant?: Variant;
};

const toneClasses = {
  brand: 'from-blue-50 via-white to-indigo-50 text-blue-700',
  success: 'from-emerald-50 via-white to-teal-50 text-emerald-700',
  warning: 'from-amber-50 via-white to-orange-50 text-amber-700',
  violet: 'from-violet-50 via-white to-fuchsia-50 text-violet-700',
  sky: 'from-sky-50 via-white to-cyan-50 text-sky-700',
};

const icons = {
  category: Layers3,
  brand: BadgeCheck,
  finish: Palette,
  vendor: Building2,
};

function normalizeRows(rows: any[] | undefined) {
  return (rows || []).map((row) => (typeof row === 'string' ? { id: row, name: row, status: 'active' } : row));
}

function makeQuery(queryName: string) {
  return gql`query MasterRows { ${queryName} }`;
}

function makeMutation(name: string, inputType: string) {
  return gql`mutation SaveMasterRow($input: ${inputType}!) { ${name}(input: $input) { data } }`;
}

function codeFrom(name: string) {
  return name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32);
}

function inputFor(form: Record<string, any>, variant: Variant) {
  if (variant !== 'brand') return form;
  return {
    id: form.id || undefined,
    name: form.name,
    code: form.code,
    description: form.description,
    status: form.status,
    sortOrder: Number(form.sortOrder || 0),
    metadata: { ...(form.metadata || {}), logoUrl: form.logoUrl || '' },
  };
}

function metaFor(row: Record<string, any>, variant: Variant) {
  if (variant === 'brand') return `${row.code || 'NO_CODE'} · quote logo ${row?.metadata?.logoUrl ? 'ready' : 'missing'}`;
  if (variant === 'vendor') return `${row.phone || 'no phone'} · ${row.city || 'no city'} · ${row.gstNo || 'no GST'}`;
  return `${row.code || 'NO_CODE'} · sort ${row.sortOrder ?? 0}`;
}

function Preview({ row, variant, Icon }: { row: Record<string, any>; variant: Variant; Icon: any }) {
  const logoUrl = row?.metadata?.logoUrl || row?.logoUrl;
  if (variant === 'brand' && logoUrl) return <img src={logoUrl} alt="" className="max-h-8 max-w-10 object-contain" />;
  return <Icon className="h-5 w-5" />;
}

export function MasterEntityPage({
  title,
  eyebrow,
  description,
  icon,
  tone,
  queryName,
  mutationName,
  mutationInputType,
  listTitle,
  emptyLabel,
  fields,
  empty,
  variant = 'standard',
}: MasterEntityPageProps) {
  const [form, setForm] = useState<Record<string, any>>(empty);
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const query = useMemo(() => makeQuery(queryName), [queryName]);
  const mutation = useMemo(() => makeMutation(mutationName, mutationInputType), [mutationName, mutationInputType]);
  const { data, loading, error, refetch } = useQuery(query, { fetchPolicy: 'cache-and-network' });
  const [save, { loading: saving, error: saveError }] = useMutation(mutation, {
    onCompleted: async () => {
      setMessage(`${title} saved.`);
      setForm(empty);
      await refetch();
    },
    onError: () => setMessage(''),
  });

  const rows = normalizeRows(data?.[queryName]);
  const filteredRows = rows.filter((row: any) => {
    const value = `${row.name || ''} ${row.code || ''} ${row.description || ''}`.toLowerCase();
    return value.includes(search.trim().toLowerCase());
  });
  const activeCount = rows.filter((row: any) => row.status !== 'inactive').length;
  const inactiveCount = rows.length - activeCount;
  const Icon = icons[icon];

  function updateField(key: string, value: any) {
    setForm((current) => {
      const next = { ...current, [key]: value };
      if (key === 'name' && !current.code) next.code = codeFrom(String(value || ''));
      return next;
    });
  }

  function selectRow(row: any) {
    setMessage('');
    setForm({ ...empty, ...row, logoUrl: row?.metadata?.logoUrl || row?.logoUrl || '' });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage('');
    await save({ variables: { input: inputFor(form, variant) } });
  }

  return (
    <div className="space-y-6 pb-10">
      <section className={cn('relative overflow-hidden rounded-r6 border border-[var(--line)] bg-gradient-to-br p-6 shadow-sm-soft lg:p-7', toneClasses[tone])}>
        <div className="absolute right-8 top-8 hidden h-28 w-28 rounded-full bg-white/50 blur-2xl lg:block" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-4xl">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--ink-4)]">{eyebrow}</p>
            <h1 className="mt-3 font-display text-4xl font-bold leading-[0.98] tracking-[-0.04em] text-[var(--ink)] lg:text-6xl">{title}</h1>
            <p className="mt-4 max-w-3xl text-sm font-semibold leading-6 text-[var(--ink-3)] lg:text-base">{description}</p>
          </div>
          <div className="grid min-w-[17rem] grid-cols-3 gap-3">
            <div className="rounded-r4 border border-[var(--line)] bg-[var(--surface)]/78 p-4 shadow-sm-soft">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--ink-5)]">Rows</p>
              <p className="mt-2 font-display text-3xl font-bold text-[var(--ink)]">{rows.length}</p>
            </div>
            <div className="rounded-r4 border border-[var(--line)] bg-[var(--surface)]/78 p-4 shadow-sm-soft">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--ink-5)]">Active</p>
              <p className="mt-2 font-display text-3xl font-bold text-[var(--ink)]">{activeCount}</p>
            </div>
            <div className="grid place-items-center rounded-r4 border border-[var(--line)] bg-[var(--surface)]/78 p-4 shadow-sm-soft">
              <Icon className="h-8 w-8" />
            </div>
          </div>
        </div>
      </section>

      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
      {saveError ? <QueryErrorBanner error={saveError} /> : null}
      {message ? <div className="rounded-r4 border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">{message}</div> : null}

      <section className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,0.74fr)_minmax(0,1.26fr)]">
        <form onSubmit={submit} className="mp-panel min-w-0 p-5 lg:p-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-r3 bg-[var(--brand-50)] text-[var(--brand-700)]"><Plus className="h-5 w-5" /></div>
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-[var(--ink)]">{form.id ? 'Edit row' : 'Create row'}</h2>
                <p className="text-sm text-[var(--ink-4)]">Changes update dropdowns immediately after save.</p>
              </div>
            </div>
            {form.id ? <Button type="button" variant="outline" onClick={() => setForm(empty)}>New</Button> : null}
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {fields.map((field) => (
              <label key={field.key} className={cn('space-y-1.5', field.className)}>
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-4)]">{field.label}</span>
                {field.type === 'textarea' ? (
                  <textarea value={form[field.key] || ''} onChange={(event) => updateField(field.key, event.target.value)} rows={3} placeholder={field.placeholder} className="w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--brand-400)] focus:ring-2 focus:ring-[var(--ring)]" />
                ) : field.type === 'select' ? (
                  <select value={form[field.key] || ''} onChange={(event) => updateField(field.key, event.target.value)} className="h-10 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--ink)] outline-none focus:border-[var(--brand-400)] focus:ring-2 focus:ring-[var(--ring)]">
                    {(field.options || []).map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                ) : (
                  <Input type={field.type === 'number' ? 'number' : 'text'} value={form[field.key] ?? ''} onChange={(event) => updateField(field.key, field.type === 'number' ? Number(event.target.value || 0) : event.target.value)} placeholder={field.placeholder} />
                )}
              </label>
            ))}
          </div>

          {variant === 'brand' && form.logoUrl ? (
            <div className="mt-4 grid h-24 place-items-center rounded-r4 border border-[var(--line)] bg-[var(--bg-soft)] p-4">
              <img src={form.logoUrl} alt="Brand logo preview" className="max-h-16 max-w-full object-contain" />
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap gap-2">
            <Button type="submit" disabled={saving || !String(form.name || '').trim()}><Save className="mr-2 h-4 w-4" />{saving ? 'Saving...' : `Save ${eyebrow.toLowerCase().replace(' master', '')}`}</Button>
            <Button type="button" variant="outline" onClick={() => void refetch()}><RefreshCcw className="mr-2 h-4 w-4" />Refresh</Button>
          </div>
        </form>

        <div className="mp-panel min-w-0 overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-[var(--line)] p-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-[var(--ink)]">{listTitle}</h2>
              <p className="mt-1 text-sm text-[var(--ink-4)]">{activeCount} active · {inactiveCount} inactive</p>
            </div>
            <div className="relative w-full lg:w-80">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-4)]" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, code..." className="pl-9" />
            </div>
          </div>

          <div className="max-h-[44rem] overflow-y-auto p-4 custom-scrollbar">
            {loading && !rows.length ? <div className="flex items-center gap-3 rounded-r4 border border-[var(--line)] bg-[var(--surface)] p-5 text-sm font-semibold text-[var(--ink-4)]"><Loader2 className="h-4 w-4 animate-spin" />Loading live master data...</div> : null}
            {!loading && !filteredRows.length ? (
              <div className="grid min-h-[18rem] place-items-center rounded-r5 border border-dashed border-[var(--line)] bg-[var(--bg-soft)] p-8 text-center">
                <div>
                  <Icon className="mx-auto h-10 w-10 text-[var(--ink-5)]" />
                  <h3 className="mt-4 text-lg font-semibold text-[var(--ink)]">{emptyLabel}</h3>
                  <p className="mt-1 text-sm text-[var(--ink-4)]">Create the first row from the form. It will show here immediately.</p>
                </div>
              </div>
            ) : null}
            <div className="grid gap-3 md:grid-cols-2">
              {filteredRows.map((row: any) => (
                <button key={row.id || row.name} type="button" onClick={() => selectRow(row)} className="group min-w-0 rounded-r4 border border-[var(--line)] bg-[var(--surface)] p-4 text-left shadow-sm-soft transition hover:-translate-y-0.5 hover:border-[var(--brand-200)] hover:shadow-md">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-r3 bg-[var(--brand-50)] text-[var(--brand-700)]"><Preview row={row} variant={variant} Icon={Icon} /></div>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <p className="truncate text-base font-semibold text-[var(--ink)]">{row.name || 'Unnamed'}</p>
                        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase', row.status === 'inactive' ? 'bg-zinc-100 text-zinc-600' : 'bg-emerald-100 text-emerald-700')}>{row.status || 'active'}</span>
                      </div>
                      <p className="mt-1 truncate text-xs font-semibold uppercase tracking-wider text-[var(--ink-5)]">{metaFor(row, variant)}</p>
                      {row.description ? <p className="mt-2 line-clamp-2 text-sm leading-5 text-[var(--ink-3)]">{row.description}</p> : null}
                    </div>
                    <Edit3 className="h-4 w-4 shrink-0 text-[var(--ink-5)] opacity-0 transition group-hover:opacity-100" />
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export const statusOptions = ['active', 'inactive'];
