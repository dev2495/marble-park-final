'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import {
  AlertTriangle, Building2, CheckCircle2, FileText, Globe2,
  LifeBuoy, MapPin, Pencil, PlusCircle, RotateCcw, Save, ShieldCheck, SlidersHorizontal,
  Warehouse,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QueryErrorBanner } from '@/components/query-state';
import { ThemeToggle } from '@/components/theme-toggle';
import { cn } from '@/lib/utils';

const DATA = gql`
  query SettingsPageData {
    appSettings { data }
    stockLocations
  }
`;

const SAVE_SETTINGS = gql`
  mutation SaveSettings($input: UpdateSettingsInput!) {
    updateAppSettings(input: $input) { data }
  }
`;

const RESET_WORKSPACE = gql`
  mutation ResetClientWorkspace($confirm: String!) {
    resetClientWorkspace(confirm: $confirm) { data }
  }
`;

const CREATE_STOCK_LOCATION = gql`
  mutation CreateStockLocation($input: StockLocationInput!) {
    createStockLocation(input: $input)
  }
`;

const UPDATE_STOCK_LOCATION = gql`
  mutation UpdateStockLocation($id: ID!, $input: StockLocationInput!) {
    updateStockLocation(id: $id, input: $input)
  }
`;

const defaults = {
  companyName: 'Marble Park',
  canonicalAppUrl: '',
  quotePrefix: 'QT',
  challanPrefix: 'CH',
  supportPhone: '',
  supportEmail: '',
  approvalDiscountThreshold: 15,
};

const emptyPlant = {
  id: '',
  name: '',
  code: '',
  type: 'plant',
  status: 'active',
  address: '',
  sortOrder: 10,
  defaultStockScope: false,
};

function cleanSettings(settings: any, origin = '') {
  return {
    ...defaults,
    ...settings,
    canonicalAppUrl: settings?.canonicalAppUrl && !String(settings.canonicalAppUrl).includes('localhost') ? settings.canonicalAppUrl : origin,
  };
}

function Field({ label, helper, children, className = '' }: { label: string; helper?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn('block space-y-1.5', className)}>
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-4)]">{label}</span>
      {children}
      {helper ? <span className="block text-xs leading-5 text-[var(--ink-4)]">{helper}</span> : null}
    </label>
  );
}

function InfoCard({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone: string }) {
  return (
    <div className="rounded-r4 border border-[var(--line)] bg-[var(--surface)]/78 p-4 shadow-sm-soft">
      <div className={cn('grid h-10 w-10 place-items-center rounded-r3', tone)}><Icon className="h-5 w-5" /></div>
      <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--ink-5)]">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-[var(--ink)]">{value || 'Not set'}</p>
    </div>
  );
}

export default function SettingsPage() {
  const { data, error, refetch } = useQuery(DATA, { fetchPolicy: 'cache-and-network' });
  const [save, { loading, error: saveError }] = useMutation(SAVE_SETTINGS, { onCompleted: () => { setSaved(true); refetch(); } });
  const [resetWorkspace, { loading: resetting, error: resetError }] = useMutation(RESET_WORKSPACE, { onCompleted: (result) => setResetMessage(`Workspace reset complete. Products: ${result?.resetClientWorkspace?.data?.counts?.products ?? 0}, users: ${result?.resetClientWorkspace?.data?.counts?.users ?? 0}.`) });
  const [createLocation, { loading: creatingLocation, error: createLocationError }] = useMutation(CREATE_STOCK_LOCATION, { onCompleted: () => { setPlantForm(emptyPlant); setPlantMessage('Plant created and stock scope updated.'); refetch(); } });
  const [updateLocation, { loading: updatingLocation, error: updateLocationError }] = useMutation(UPDATE_STOCK_LOCATION, { onCompleted: () => { setPlantForm(emptyPlant); setPlantMessage('Plant saved.'); refetch(); } });
  const [form, setForm] = useState<any>(defaults);
  const [plantForm, setPlantForm] = useState<any>(emptyPlant);
  const [saved, setSaved] = useState(false);
  const [confirmReset, setConfirmReset] = useState('');
  const [resetMessage, setResetMessage] = useState('');
  const [plantMessage, setPlantMessage] = useState('');
  const [browserOrigin, setBrowserOrigin] = useState('');

  useEffect(() => {
    setBrowserOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (!data?.appSettings?.data) return;
    setForm(cleanSettings(data.appSettings.data, browserOrigin));
  }, [browserOrigin, data?.appSettings?.data]);

  const summary = useMemo(() => cleanSettings({ ...data?.appSettings?.data, ...form }, browserOrigin), [browserOrigin, data?.appSettings?.data, form]);
  const locations = useMemo<any[]>(() => data?.stockLocations || [], [data?.stockLocations]);
  const activePlants = useMemo(() => locations.filter((location) => location.status === 'active'), [locations]);
  const defaultPlant = useMemo(() => locations.find((location) => location.defaultStockScope) || activePlants[0], [activePlants, locations]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    await save({
      variables: {
        input: {
          companyName: form.companyName || defaults.companyName,
          canonicalAppUrl: form.canonicalAppUrl || browserOrigin,
          quotePrefix: form.quotePrefix || defaults.quotePrefix,
          challanPrefix: form.challanPrefix || defaults.challanPrefix,
          supportPhone: form.supportPhone || '',
          supportEmail: form.supportEmail || '',
          approvalDiscountThreshold: Number(form.approvalDiscountThreshold || defaults.approvalDiscountThreshold),
        },
      },
    });
  }

  async function submitReset() {
    if (confirmReset !== 'RESET_CLIENT_WORKSPACE') return;
    if (!window.confirm('This clears client test products, customers, leads, quotes, orders, imports, images and inventory. Admin user remains. Continue?')) return;
    setResetMessage('');
    await resetWorkspace({ variables: { confirm: confirmReset } });
    setConfirmReset('');
  }

  async function submitPlant(event: FormEvent) {
    event.preventDefault();
    setPlantMessage('');
    const input = {
      name: plantForm.name,
      code: plantForm.code || undefined,
      type: plantForm.type || 'plant',
      status: plantForm.status || 'active',
      address: plantForm.address || undefined,
      sortOrder: Number(plantForm.sortOrder || 0),
      defaultStockScope: Boolean(plantForm.defaultStockScope),
    };
    if (plantForm.id) await updateLocation({ variables: { id: plantForm.id, input } });
    else await createLocation({ variables: { input } });
  }

  function editPlant(location: any) {
    setPlantMessage('');
    setPlantForm({
      id: location.id,
      name: location.name || '',
      code: location.code || '',
      type: location.type || 'plant',
      status: location.status || 'active',
      address: location.address || '',
      sortOrder: location.sortOrder ?? 0,
      defaultStockScope: Boolean(location.defaultStockScope),
    });
  }

  return (
    <div className="space-y-7 pb-10">
      <section className="mp-hero relative overflow-hidden p-7 lg:p-9">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(37,99,235,0.14),transparent_30%),radial-gradient(circle_at_90%_88%,rgba(124,58,237,0.13),transparent_28%)]" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink-4)]">System settings</p>
            <h1 className="mt-3 max-w-5xl font-display text-4xl font-bold leading-[0.98] tracking-[-0.04em] text-[var(--ink)] lg:text-7xl">Company identity, document rules and live workspace controls.</h1>
            <p className="mt-5 max-w-3xl text-base font-semibold leading-7 text-[var(--ink-3)]">
              Keep quote PDFs, sales order links, approval thresholds and customer-facing contact information correct before client testing starts.
            </p>
          </div>
          <div className="rounded-r4 border border-[var(--line)] bg-[var(--surface)]/78 p-4 shadow-sm-soft">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--ink-5)]">Workspace theme</p>
            <div className="mt-3"><ThemeToggle /></div>
          </div>
        </div>
      </section>

      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
      {saveError ? <QueryErrorBanner error={saveError} /> : null}
      {resetError ? <QueryErrorBanner error={resetError} /> : null}
      {createLocationError ? <QueryErrorBanner error={createLocationError} /> : null}
      {updateLocationError ? <QueryErrorBanner error={updateLocationError} /> : null}
      {saved ? <div className="rounded-r4 border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800"><CheckCircle2 className="mr-2 inline h-4 w-4" /> Settings saved.</div> : null}
      {resetMessage ? <div className="rounded-r4 border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">{resetMessage}</div> : null}
      {plantMessage ? <div className="rounded-r4 border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">{plantMessage}</div> : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <InfoCard icon={Building2} label="Company" value={summary.companyName} tone="bg-[var(--brand-50)] text-[var(--brand-700)]" />
        <InfoCard icon={Globe2} label="Public URL" value={summary.canonicalAppUrl} tone="bg-sky-50 text-sky-700" />
        <InfoCard icon={FileText} label="Quote prefix" value={summary.quotePrefix} tone="bg-violet-50 text-violet-700" />
        <InfoCard icon={Warehouse} label="Default plant" value={defaultPlant ? `${defaultPlant.code} · ${defaultPlant.name}` : 'Not set'} tone="bg-emerald-50 text-emerald-700" />
      </section>

      <form onSubmit={submit} className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="mp-panel p-5 lg:p-6">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-r3 bg-[var(--brand-50)] text-[var(--brand-700)]"><Building2 className="h-5 w-5" /></div>
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-[var(--ink)]">Company and document identity</h2>
              <p className="text-sm text-[var(--ink-4)]">Used by quote PDFs, sales order PDFs, links and customer-facing pages.</p>
            </div>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <Field label="Company name"><Input value={form.companyName || ''} onChange={(e) => setForm({ ...form, companyName: e.target.value })} /></Field>
            <Field label="Canonical app URL" helper="Live Railway URL should be used here; localhost is auto-replaced on this page."><Input value={form.canonicalAppUrl || ''} onChange={(e) => setForm({ ...form, canonicalAppUrl: e.target.value })} /></Field>
            <Field label="Quote prefix"><Input value={form.quotePrefix || ''} onChange={(e) => setForm({ ...form, quotePrefix: e.target.value.toUpperCase() })} /></Field>
            <Field label="Challan prefix"><Input value={form.challanPrefix || ''} onChange={(e) => setForm({ ...form, challanPrefix: e.target.value.toUpperCase() })} /></Field>
          </div>
        </div>

        <div className="mp-panel p-5 lg:p-6">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-r3 bg-emerald-50 text-emerald-700"><LifeBuoy className="h-5 w-5" /></div>
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-[var(--ink)]">Support and approvals</h2>
              <p className="text-sm text-[var(--ink-4)]">Controls owner approval routing and contact details shown on generated documents.</p>
            </div>
          </div>
          <div className="mt-5 grid gap-4">
            <Field label="Support phone"><Input value={form.supportPhone || ''} onChange={(e) => setForm({ ...form, supportPhone: e.target.value })} placeholder="Customer support number" /></Field>
            <Field label="Support email"><Input type="email" value={form.supportEmail || ''} onChange={(e) => setForm({ ...form, supportEmail: e.target.value })} placeholder="support@marblepark.in" /></Field>
            <Field label="Approval discount threshold" helper="Discount above this percentage asks owner/admin review before customer confirmation."><Input type="number" min={0} max={100} value={form.approvalDiscountThreshold ?? ''} onChange={(e) => setForm({ ...form, approvalDiscountThreshold: e.target.value })} /></Field>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 xl:col-span-2">
          <Button type="submit" disabled={loading}><Save className="mr-2 h-4 w-4" /> {loading ? 'Saving…' : 'Save settings'}</Button>
          <Button type="button" variant="outline" onClick={() => setForm(cleanSettings(data?.appSettings?.data || {}, browserOrigin))}><SlidersHorizontal className="mr-2 h-4 w-4" /> Restore saved values</Button>
        </div>
      </form>

      <section className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <form onSubmit={submitPlant} className="mp-panel p-5 lg:p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-r3 bg-sky-50 text-sky-700"><Warehouse className="h-5 w-5" /></div>
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-[var(--ink)]">{plantForm.id ? 'Edit plant / stock location' : 'New plant / stock location'}</h2>
                <p className="text-sm text-[var(--ink-4)]">GRN, stock count, ledger and dispatch use this stock scope.</p>
              </div>
            </div>
            {plantForm.id ? <Button type="button" variant="outline" onClick={() => setPlantForm(emptyPlant)}>New</Button> : null}
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <Field label="Plant name"><Input required value={plantForm.name || ''} onChange={(event) => setPlantForm({ ...plantForm, name: event.target.value })} placeholder="Main Plant / Godown" /></Field>
            <Field label="Code"><Input value={plantForm.code || ''} onChange={(event) => setPlantForm({ ...plantForm, code: event.target.value.toUpperCase() })} placeholder="MAIN" /></Field>
            <label className="block space-y-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-4)]">Type</span>
              <select value={plantForm.type || 'plant'} onChange={(event) => setPlantForm({ ...plantForm, type: event.target.value })} className="h-10 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--ink)] shadow-sm-soft outline-none focus:border-[var(--brand-400)]">
                <option value="plant">Plant</option>
                <option value="showroom">Showroom</option>
                <option value="godown">Godown</option>
                <option value="warehouse">Warehouse</option>
                <option value="yard">Yard</option>
              </select>
            </label>
            <label className="block space-y-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-4)]">Status</span>
              <select value={plantForm.status || 'active'} onChange={(event) => setPlantForm({ ...plantForm, status: event.target.value })} className="h-10 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--ink)] shadow-sm-soft outline-none focus:border-[var(--brand-400)]">
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
            <Field label="Sort order"><Input type="number" min={0} value={plantForm.sortOrder ?? 0} onChange={(event) => setPlantForm({ ...plantForm, sortOrder: event.target.value })} /></Field>
            <label className="flex min-h-10 items-center gap-3 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--ink)] shadow-sm-soft">
              <input type="checkbox" checked={Boolean(plantForm.defaultStockScope)} onChange={(event) => setPlantForm({ ...plantForm, defaultStockScope: event.target.checked })} className="h-4 w-4 rounded border-[var(--line)]" />
              Default for GRN, stock count and dispatch
            </label>
            <Field label="Address / note" className="md:col-span-2"><Input value={plantForm.address || ''} onChange={(event) => setPlantForm({ ...plantForm, address: event.target.value })} placeholder="Storage address or operating note" /></Field>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={creatingLocation || updatingLocation || !plantForm.name}>
              {plantForm.id ? <Save className="mr-2 h-4 w-4" /> : <PlusCircle className="mr-2 h-4 w-4" />}
              {plantForm.id ? 'Save plant' : 'Create plant'}
            </Button>
            <Button type="button" variant="outline" onClick={() => setPlantForm(emptyPlant)}>Clear</Button>
          </div>
        </form>

        <div className="mp-panel overflow-hidden">
          <div className="border-b border-[var(--line)] p-5 lg:p-6">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-r3 bg-emerald-50 text-emerald-700"><MapPin className="h-5 w-5" /></div>
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-[var(--ink)]">Plant and location master</h2>
                <p className="text-sm text-[var(--ink-4)]">{activePlants.length} active of {locations.length} configured. Default decides where automatic stock flows post.</p>
              </div>
            </div>
          </div>
          <div className="grid gap-3 p-4 lg:grid-cols-2">
            {locations.map((location) => (
              <button
                key={location.id}
                type="button"
                onClick={() => editPlant(location)}
                className={cn('rounded-r4 border p-4 text-left shadow-sm-soft transition hover:border-[var(--brand-400)]', location.defaultStockScope ? 'border-emerald-300 bg-emerald-50/80' : 'border-[var(--line)] bg-[var(--surface)]')}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-base font-bold text-[var(--ink)]">{location.code} · {location.name}</p>
                    <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">{location.type} · {location.status}</p>
                  </div>
                  <Pencil className="h-4 w-4 shrink-0 text-[var(--ink-4)]" />
                </div>
                {location.address ? <p className="mt-3 line-clamp-2 text-xs leading-5 text-[var(--ink-4)]">{location.address}</p> : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  {location.defaultStockScope ? <span className="rounded-full bg-emerald-600 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white">Default stock scope</span> : null}
                  <span className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ink-4)]">Sort {location.sortOrder || 0}</span>
                </div>
              </button>
            ))}
            {!locations.length ? <p className="rounded-r4 border border-dashed border-[var(--line)] p-8 text-center text-sm font-semibold text-[var(--ink-4)] lg:col-span-2">No plant locations yet. Create one to make GRN and stock count plant-scoped.</p> : null}
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="mp-panel p-5 lg:p-6">
          <div className="flex items-start gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-r3 bg-emerald-50 text-emerald-700"><ShieldCheck className="h-5 w-5" /></div>
            <div>
              <h2 className="text-xl font-semibold text-[var(--ink)]">Production readiness checks</h2>
              <p className="mt-1 text-sm text-[var(--ink-4)]">Before handing over to the client, these values should stay correct.</p>
            </div>
          </div>
          <ul className="mt-5 space-y-2 text-sm font-semibold text-[var(--ink-3)]">
            <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Login screen does not expose default credentials.</li>
            <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Users are managed by authorised access managers with audit trail.</li>
            <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Document prefixes are configurable before client testing.</li>
            <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Theme preference is saved per browser.</li>
          </ul>
        </div>

        <div className="mp-panel border-red-200/70 p-5 lg:p-6">
          <div className="flex items-start gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-r3 bg-red-50 text-red-700"><AlertTriangle className="h-5 w-5" /></div>
            <div>
              <h2 className="text-xl font-semibold text-[var(--ink)]">Client test reset</h2>
              <p className="mt-1 text-sm text-[var(--ink-4)]">Admin-only reset for a clean Railway demo. Keeps the admin account and clears client test business data and catalogue images.</p>
            </div>
          </div>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <Input value={confirmReset} onChange={(e) => setConfirmReset(e.target.value)} placeholder="Type RESET_CLIENT_WORKSPACE" />
            <Button type="button" variant="destructive" disabled={resetting || confirmReset !== 'RESET_CLIENT_WORKSPACE'} onClick={submitReset}><RotateCcw className="mr-2 h-4 w-4" /> {resetting ? 'Resetting…' : 'Reset'}</Button>
          </div>
        </div>
      </section>
    </div>
  );
}
