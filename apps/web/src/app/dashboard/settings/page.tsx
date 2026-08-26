'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import {
  Bath, Building2, Check, CheckCircle2, FileText, Globe2,
  ImagePlus, Landmark, LifeBuoy, Loader2, MapPin, Pencil, PlusCircle, Save, ShieldCheck, SlidersHorizontal,
  Upload, Warehouse, BellRing, Layers3, LockKeyhole,
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
    masterProductBrands(status: "active")
  }
`;

const SAVE_SETTINGS = gql`
  mutation SaveSettings($input: UpdateSettingsInput!) {
    updateAppSettings(input: $input) { data }
  }
`;

const UPLOAD_COMPANY_LOGO = gql`
  mutation UploadCompanyLogo($filename: String!, $contentBase64: String!, $scope: String) {
    uploadStoredAsset(filename: $filename, contentBase64: $contentBase64, scope: $scope) { result }
  }
`;

const SAVE_PRODUCT_BRAND = gql`
  mutation SaveProductBrandFromSettings($input: ProductBrandInput!) {
    saveProductBrand(input: $input) { data }
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
  logoUrl: '/brand/marble-park-logo.png',
  companyAddress: 'Near DCB Bank, Char Rasta, Vapi (Guj)-396191, India',
  gstNumber: '24AHPPS9407D1Z3',
  website: '',
  quotationTitle: 'PROFORMA / QUOTATION',
  documentTagline: 'Premium bath, tile and surface selections for considered spaces.',
  defaultTerms: '1. Freight and labour are extra and subject to applicable GST.\n2. Payment is 100% advance unless otherwise agreed in writing.\n3. Goods once sold cannot be returned except through an approved return.\n4. Confirmed orders cannot be cancelled without written approval.\n5. Tile spacers must be used as recommended by the manufacturer.\n6. Product images are references and may vary from the supplied product.',
  bankDetails: 'Account name: Marble Park\nBank: IDFC Bank\nAccount no.: 10033526350\nIFSC: IDFB0042441\nBranch: Vapi - 396195, Gujarat',
  documentFooter: 'Thank you for choosing Marble Park. Product availability, shade and batch are confirmed at order stage.',
  canonicalAppUrl: '',
  quotePrefix: 'QT',
  challanPrefix: 'CH',
  supportPhone: '0260-2424498 · 9427119271 · 7506133166 · 9712508070',
  supportEmail: '',
  approvalDiscountThreshold: 15,
  quoteBrandSelectionMode: 'all',
  quoteBrandIds: [],
  tileQuoteBrandSelectionMode: 'all',
  tileQuoteBrandIds: [],
  cpSanitaryQuoteBrandSelectionMode: 'all',
  cpSanitaryQuoteBrandIds: [],
};

async function fileBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

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
    tileQuoteBrandSelectionMode: settings?.tileQuoteBrandSelectionMode ?? settings?.quoteBrandSelectionMode ?? 'all',
    tileQuoteBrandIds: Array.isArray(settings?.tileQuoteBrandIds) ? settings.tileQuoteBrandIds : (Array.isArray(settings?.quoteBrandIds) ? settings.quoteBrandIds : []),
    cpSanitaryQuoteBrandSelectionMode: settings?.cpSanitaryQuoteBrandSelectionMode ?? settings?.quoteBrandSelectionMode ?? 'all',
    cpSanitaryQuoteBrandIds: Array.isArray(settings?.cpSanitaryQuoteBrandIds) ? settings.cpSanitaryQuoteBrandIds : (Array.isArray(settings?.quoteBrandIds) ? settings.quoteBrandIds : []),
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

function QuoteBrandPolicyCard({
  title, description, icon: Icon, tone, modeKey, idsKey, form, setForm, brands,
}: {
  title: string; description: string; icon: any; tone: string; modeKey: string; idsKey: string;
  form: any; setForm: React.Dispatch<React.SetStateAction<any>>; brands: any[];
}) {
  const available = brands.filter((brand: any) => brand.metadata?.quoteEnabled !== false);
  const mode = String(form[modeKey] || 'all');
  const selectedIds = Array.isArray(form[idsKey]) ? form[idsKey].map(String) : [];
  const selected = new Set(selectedIds);
  const effectiveCount = mode === 'none' ? 0 : mode === 'all' ? available.length : available.filter((brand: any) => selected.has(String(brand.id))).length;
  const missingArtwork = available.filter((brand: any) => !brand.metadata?.logoUrl).length;
  const toggleBrand = (brandId: string) => setForm((current: any) => {
    const currentIds = Array.isArray(current[idsKey]) ? current[idsKey].map(String) : [];
    return { ...current, [idsKey]: currentIds.includes(brandId) ? currentIds.filter((id: string) => id !== brandId) : [...currentIds, brandId] };
  });

  return <article className="overflow-hidden rounded-r4 border border-[var(--line)] bg-[var(--surface)] shadow-sm-soft">
    <div className="flex items-start justify-between gap-4 border-b border-[var(--line-soft)] px-5 py-5">
      <div className="flex min-w-0 items-start gap-3">
        <div className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-r3', tone)}><Icon className="h-5 w-5" /></div>
        <div><h3 className="text-lg font-semibold tracking-tight text-[var(--ink)]">{title}</h3><p className="mt-1 text-xs leading-5 text-[var(--ink-4)]">{description}</p></div>
      </div>
      <span className="shrink-0 rounded-full bg-[var(--bg-soft)] px-2.5 py-1 text-xs font-semibold tabular-nums text-[var(--ink-3)]">{effectiveCount} logo{effectiveCount === 1 ? '' : 's'}</span>
    </div>
    <div className="p-5">
      <div className="grid grid-cols-3 rounded-md border border-[var(--line)] bg-[var(--bg-soft)] p-1" role="group" aria-label={`${title} footer brand policy`}>
        {([['all', 'All active'], ['selected', 'Selected'], ['none', 'None']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => setForm((current: any) => ({ ...current, [modeKey]: value }))} className={cn('min-h-10 rounded px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]', mode === value ? 'bg-[var(--brand-700)] text-white shadow-sm-soft' : 'text-[var(--ink-3)] hover:bg-[var(--surface)]')}>{label}</button>)}
      </div>

      {mode === 'selected' ? <>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold text-[var(--ink-3)]">Choose the exact footer portfolio</p>
          <div className="flex gap-2"><button type="button" onClick={() => setForm((current: any) => ({ ...current, [idsKey]: available.map((brand: any) => String(brand.id)) }))} className="min-h-9 rounded-md border border-[var(--line)] px-3 text-xs font-semibold text-[var(--ink-2)] hover:bg-[var(--bg-soft)]">Select all</button><button type="button" onClick={() => setForm((current: any) => ({ ...current, [idsKey]: [] }))} className="min-h-9 rounded-md border border-[var(--line)] px-3 text-xs font-semibold text-[var(--ink-2)] hover:bg-[var(--bg-soft)]">Clear</button></div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-2 2xl:grid-cols-3">
          {available.map((brand: any) => {
            const active = selected.has(String(brand.id));
            return <button key={brand.id} type="button" aria-pressed={active} onClick={() => toggleBrand(String(brand.id))} className={cn('relative flex min-h-16 items-center gap-2 rounded-md border bg-white p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]', active ? 'border-[var(--brand-500)] bg-[var(--brand-50)]' : 'border-[var(--line)] hover:border-[var(--line-strong)]')}>
              <span className="grid h-10 w-12 shrink-0 place-items-center rounded border border-[var(--line-soft)] bg-white p-1">{brand.metadata?.logoUrl ? <img src={brand.metadata.logoUrl} alt="" className="max-h-full max-w-full object-contain" /> : <ImagePlus className="h-4 w-4 text-[var(--ink-5)]" />}</span>
              <span className="min-w-0"><span className="block truncate text-xs font-semibold text-[var(--ink)]">{brand.name}</span><span className="mt-0.5 block text-[10px] text-[var(--ink-4)]">{brand.metadata?.logoUrl ? 'Artwork ready' : 'Logo required'}</span></span>
              {active ? <span className="absolute right-1.5 top-1.5 grid h-4 w-4 place-items-center rounded-full bg-[var(--brand-700)] text-white"><Check className="h-2.5 w-2.5" /></span> : null}
            </button>;
          })}
        </div>
      </> : <div className="mt-4 flex items-center gap-3 rounded-md bg-[var(--bg-soft)] px-4 py-3 text-xs text-[var(--ink-3)]"><LockKeyhole className="h-4 w-4 shrink-0 text-[var(--brand-700)]" /><span>{mode === 'all' ? 'Every active quote-enabled brand is included, including brands added later.' : 'No served-brand strip is printed for this quote family.'}</span></div>}
      {missingArtwork ? <p className="mt-3 text-[11px] font-semibold text-amber-700">{missingArtwork} enabled brand{missingArtwork === 1 ? '' : 's'} still need logo artwork before they can print.</p> : null}
    </div>
  </article>;
}

export default function SettingsPage() {
  const { data, error, refetch } = useQuery(DATA, { fetchPolicy: 'cache-and-network' });
  const [save, { loading, error: saveError }] = useMutation(SAVE_SETTINGS, { onCompleted: () => { setSaved(true); refetch(); } });
  const [uploadCompanyLogo] = useMutation(UPLOAD_COMPANY_LOGO);
  const [saveProductBrand, { error: brandSaveError }] = useMutation(SAVE_PRODUCT_BRAND);
  const [createLocation, { loading: creatingLocation, error: createLocationError }] = useMutation(CREATE_STOCK_LOCATION, { onCompleted: () => { setPlantForm(emptyPlant); setPlantMessage('Plant created and stock scope updated.'); refetch(); } });
  const [updateLocation, { loading: updatingLocation, error: updateLocationError }] = useMutation(UPDATE_STOCK_LOCATION, { onCompleted: () => { setPlantForm(emptyPlant); setPlantMessage('Plant saved.'); refetch(); } });
  const [form, setForm] = useState<any>(defaults);
  const [plantForm, setPlantForm] = useState<any>(emptyPlant);
  const [saved, setSaved] = useState(false);
  const [plantMessage, setPlantMessage] = useState('');
  const [browserOrigin, setBrowserOrigin] = useState('');
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoMessage, setLogoMessage] = useState('');
  const [brandMessage, setBrandMessage] = useState('');
  const [uploadingBrandId, setUploadingBrandId] = useState('');

  useEffect(() => {
    setBrowserOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (!data?.appSettings?.data) return;
    setForm(cleanSettings(data.appSettings.data, browserOrigin));
  }, [browserOrigin, data?.appSettings?.data]);

  const summary = useMemo(() => cleanSettings({ ...data?.appSettings?.data, ...form }, browserOrigin), [browserOrigin, data?.appSettings?.data, form]);
  const locations = useMemo<any[]>(() => data?.stockLocations || [], [data?.stockLocations]);
  const brands = useMemo<any[]>(() => data?.masterProductBrands || [], [data?.masterProductBrands]);
  const activePlants = useMemo(() => locations.filter((location) => location.status === 'active'), [locations]);
  const defaultPlant = useMemo(() => locations.find((location) => location.defaultStockScope) || activePlants[0], [activePlants, locations]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    await save({
      variables: {
        input: {
          companyName: form.companyName || defaults.companyName,
          logoUrl: form.logoUrl || defaults.logoUrl,
          companyAddress: form.companyAddress || '',
          gstNumber: form.gstNumber || '',
          website: form.website || '',
          quotationTitle: form.quotationTitle || defaults.quotationTitle,
          documentTagline: form.documentTagline || '',
          defaultTerms: form.defaultTerms || '',
          bankDetails: form.bankDetails || '',
          documentFooter: form.documentFooter || '',
          canonicalAppUrl: form.canonicalAppUrl || browserOrigin,
          quotePrefix: form.quotePrefix || defaults.quotePrefix,
          challanPrefix: form.challanPrefix || defaults.challanPrefix,
          supportPhone: form.supportPhone || '',
          supportEmail: form.supportEmail || '',
          approvalDiscountThreshold: Number(form.approvalDiscountThreshold || defaults.approvalDiscountThreshold),
          quoteBrandSelectionMode: form.quoteBrandSelectionMode || 'all',
          quoteBrandIds: Array.isArray(form.quoteBrandIds) ? form.quoteBrandIds : [],
          tileQuoteBrandSelectionMode: form.tileQuoteBrandSelectionMode || 'all',
          tileQuoteBrandIds: Array.isArray(form.tileQuoteBrandIds) ? form.tileQuoteBrandIds : [],
          cpSanitaryQuoteBrandSelectionMode: form.cpSanitaryQuoteBrandSelectionMode || 'all',
          cpSanitaryQuoteBrandIds: Array.isArray(form.cpSanitaryQuoteBrandIds) ? form.cpSanitaryQuoteBrandIds : [],
        },
      },
    });
  }

  async function handleLogoUpload(file?: File) {
    if (!file) return;
    setLogoMessage('');
    setUploadingLogo(true);
    try {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size <= 0 || file.size > 5 * 1024 * 1024) throw new Error('Use a JPG, PNG or WebP logo smaller than 5 MB.');
      const result = await uploadCompanyLogo({ variables: { filename: file.name, contentBase64: await fileBase64(file), scope: 'company-logo' } });
      const logoUrl = result.data?.uploadStoredAsset?.result?.publicUrl;
      if (!logoUrl) throw new Error('The upload did not return a logo URL.');
      setForm((current: any) => ({ ...current, logoUrl }));
      setLogoMessage('Logo uploaded. Save settings to publish it everywhere.');
    } catch (uploadError: any) {
      setLogoMessage(uploadError.message || 'Logo upload failed.');
    } finally {
      setUploadingLogo(false);
    }
  }

  async function saveBrandPresentation(brand: any, patch: any) {
    setBrandMessage('');
    const metadata = { ...(brand.metadata || {}), ...patch };
    await saveProductBrand({ variables: { input: {
      id: brand.id,
      name: brand.name,
      code: brand.code || undefined,
      description: brand.description || '',
      status: brand.status || 'active',
      sortOrder: Number(brand.sortOrder || 0),
      metadata,
    } } });
    setBrandMessage(`${brand.name} quotation presentation saved.`);
    await refetch();
  }

  async function saveQuoteBrandDefaults() {
    setBrandMessage('');
    await save({ variables: { input: {
      tileQuoteBrandSelectionMode: form.tileQuoteBrandSelectionMode || 'all',
      tileQuoteBrandIds: Array.isArray(form.tileQuoteBrandIds) ? form.tileQuoteBrandIds : [],
      cpSanitaryQuoteBrandSelectionMode: form.cpSanitaryQuoteBrandSelectionMode || 'all',
      cpSanitaryQuoteBrandIds: Array.isArray(form.cpSanitaryQuoteBrandIds) ? form.cpSanitaryQuoteBrandIds : [],
    } } });
    setBrandMessage('Tile and CP/Sanitary footer policies saved. Every new quote now snapshots its matching global policy.');
  }

  async function handleBrandLogoUpload(brand: any, file?: File) {
    if (!file) return;
    setBrandMessage('');
    setUploadingBrandId(String(brand.id));
    try {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size <= 0 || file.size > 5 * 1024 * 1024) throw new Error('Use a JPG, PNG or WebP logo smaller than 5 MB.');
      const result = await uploadCompanyLogo({ variables: { filename: file.name, contentBase64: await fileBase64(file), scope: 'brand-logo' } });
      const logoUrl = result.data?.uploadStoredAsset?.result?.publicUrl;
      if (!logoUrl) throw new Error('The upload did not return a logo URL.');
      await saveBrandPresentation(brand, { logoUrl, quoteEnabled: brand.metadata?.quoteEnabled !== false });
    } catch (uploadError: any) {
      setBrandMessage(uploadError.message || 'Brand logo upload failed.');
    } finally {
      setUploadingBrandId('');
    }
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
      <section className="border-b border-[var(--line)] pb-6 pt-2">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink-4)]">System settings</p>
            <h1 className="mt-2 max-w-4xl font-display text-3xl font-bold text-[var(--ink)] lg:text-4xl">Company identity and customer documents</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--ink-3)]">
              Keep quote PDFs, sales order links, approval thresholds and customer-facing contact information correct before client testing starts.
            </p>
          </div>
          <div className="rounded-r4 border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm-soft">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--ink-5)]">Workspace theme</p>
            <div className="mt-3"><ThemeToggle /></div>
          </div>
        </div>
      </section>

      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
      {saveError ? <QueryErrorBanner error={saveError} /> : null}
      {brandSaveError ? <QueryErrorBanner error={brandSaveError} /> : null}
      {createLocationError ? <QueryErrorBanner error={createLocationError} /> : null}
      {updateLocationError ? <QueryErrorBanner error={updateLocationError} /> : null}
      {saved ? <div className="rounded-r4 border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800"><CheckCircle2 className="mr-2 inline h-4 w-4" /> Settings saved.</div> : null}
      {plantMessage ? <div className="rounded-r4 border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">{plantMessage}</div> : null}
      {logoMessage ? <div className="rounded-r4 border border-[var(--line)] bg-[var(--surface)] p-4 text-sm font-semibold text-[var(--ink-2)]">{logoMessage}</div> : null}
      {brandMessage ? <div className="rounded-r4 border border-[var(--line)] bg-[var(--surface)] p-4 text-sm font-semibold text-[var(--ink-2)]">{brandMessage}</div> : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <InfoCard icon={Building2} label="Company" value={summary.companyName} tone="bg-[var(--brand-50)] text-[var(--brand-700)]" />
        <InfoCard icon={Globe2} label="Public URL" value={summary.canonicalAppUrl} tone="bg-sky-50 text-sky-700" />
        <InfoCard icon={FileText} label="Quote prefix" value={summary.quotePrefix} tone="bg-violet-50 text-violet-700" />
        <InfoCard icon={Warehouse} label="Default plant" value={defaultPlant ? `${defaultPlant.code} · ${defaultPlant.name}` : 'Not set'} tone="bg-emerald-50 text-emerald-700" />
      </section>

      <section className="mp-panel overflow-hidden p-0">
        <div className="flex flex-col gap-4 border-b border-[var(--line)] bg-[var(--brand-50)]/60 px-5 py-5 lg:flex-row lg:items-center lg:justify-between lg:px-6">
          <div className="flex items-start gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-r3 bg-white text-[var(--brand-700)] shadow-sm-soft"><BellRing className="h-5 w-5" /></div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-4)]">Stock · Owner / admin</p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight text-[var(--ink)]">Stock Alert Policy</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--ink-3)]">
                Set warning and critical available-stock levels per SKU. Inventory managers still receive bell alerts when levels are breached.
              </p>
            </div>
          </div>
          <a
            href="/dashboard/inventory/stock-alerts"
            className="inline-flex h-11 items-center justify-center rounded-xl bg-[var(--brand-700)] px-5 text-sm font-bold text-white hover:bg-[var(--brand-700)]/90"
          >
            Open Stock Alert Policy
          </a>
        </div>
      </section>

      <form onSubmit={submit} className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="mp-panel p-5 lg:p-6 xl:col-span-2">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-r3 bg-[var(--brand-50)] text-[var(--brand-700)]"><Building2 className="h-5 w-5" /></div>
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-[var(--ink)]">Company and document identity</h2>
              <p className="text-sm text-[var(--ink-4)]">Used by quote PDFs, sales order PDFs, links and customer-facing pages.</p>
            </div>
          </div>
          <div className="mt-5 grid gap-5 md:grid-cols-[11rem_minmax(0,1fr)]">
            <div className="overflow-hidden rounded-md border border-[var(--line)] bg-black">
              <div className="grid h-44 place-items-center p-3">{form.logoUrl ? <img src={form.logoUrl} alt="Company logo preview" className="max-h-full max-w-full object-contain" /> : <ImagePlus className="h-7 w-7 text-white/55" />}</div>
              <label className="flex cursor-pointer items-center justify-center gap-2 border-t border-white/15 px-3 py-2.5 text-xs font-semibold text-white">
                {uploadingLogo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}{uploadingLogo ? 'Uploading' : 'Replace logo'}
                <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={uploadingLogo} onChange={(event) => handleLogoUpload(event.target.files?.[0])} />
              </label>
            </div>
            <div className="grid content-start gap-4">
              <Field label="Company name"><Input value={form.companyName || ''} onChange={(e) => setForm({ ...form, companyName: e.target.value })} /></Field>
              <Field label="GST number"><Input value={form.gstNumber || ''} onChange={(e) => setForm({ ...form, gstNumber: e.target.value.toUpperCase() })} placeholder="24AHPPS9407D1Z3" /></Field>
              <Field label="Website"><Input value={form.website || ''} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="www.marblepark.in" /></Field>
            </div>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <Field label="Company address" className="md:col-span-2"><textarea value={form.companyAddress || ''} onChange={(e) => setForm({ ...form, companyAddress: e.target.value })} className="min-h-20 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--brand-400)]" placeholder="Near DCB Bank, Char Rasta, Vapi (Guj)-396191, India" /></Field>
            <Field label="Canonical app URL" helper="Used for links in generated documents."><Input value={form.canonicalAppUrl || ''} onChange={(e) => setForm({ ...form, canonicalAppUrl: e.target.value })} /></Field>
            <Field label="Quote prefix"><Input value={form.quotePrefix || ''} onChange={(e) => setForm({ ...form, quotePrefix: e.target.value.toUpperCase() })} /></Field>
            <Field label="Challan prefix"><Input value={form.challanPrefix || ''} onChange={(e) => setForm({ ...form, challanPrefix: e.target.value.toUpperCase() })} /></Field>
          </div>
        </div>

        <div className="mp-panel p-5 lg:p-6 xl:col-span-2">
          <div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-r3 bg-[var(--brand-50)] text-[var(--brand-700)]"><Landmark className="h-5 w-5" /></div><div><h2 className="text-2xl font-semibold tracking-tight text-[var(--ink)]">Quotation defaults</h2><p className="text-sm text-[var(--ink-4)]">Terms and presentation copy prefill new quotations. Served-brand policies are governed separately below.</p></div></div>
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <Field label="Document title"><Input value={form.quotationTitle || ''} onChange={(e) => setForm({ ...form, quotationTitle: e.target.value })} /></Field>
            <Field label="Document tagline"><Input value={form.documentTagline || ''} onChange={(e) => setForm({ ...form, documentTagline: e.target.value })} /></Field>
            <Field label="Default terms"><textarea value={form.defaultTerms || ''} onChange={(e) => setForm({ ...form, defaultTerms: e.target.value })} className="min-h-32 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm leading-6 text-[var(--ink)] outline-none focus:border-[var(--brand-400)]" placeholder="Freight, payment, return, cancellation and image-reference terms" /></Field>
            <Field label="Bank details"><textarea value={form.bankDetails || ''} onChange={(e) => setForm({ ...form, bankDetails: e.target.value })} className="min-h-32 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm leading-6 text-[var(--ink)] outline-none focus:border-[var(--brand-400)]" placeholder="Bank, account number, IFSC and branch" /></Field>
            <Field label="Document footer" className="lg:col-span-2"><Input value={form.documentFooter || ''} onChange={(e) => setForm({ ...form, documentFooter: e.target.value })} placeholder="Thank you for choosing Marble Park." /></Field>
          </div>
        </div>

        <div className="mp-panel p-5 lg:p-6 xl:col-span-2">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-r3 bg-emerald-50 text-emerald-700"><LifeBuoy className="h-5 w-5" /></div>
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-[var(--ink)]">Support and approvals</h2>
              <p className="text-sm text-[var(--ink-4)]">Controls owner approval routing and contact details shown on generated documents.</p>
            </div>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
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

      <section className="mp-panel p-5 lg:p-6">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
          <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--brand-700)]">Quotation presentation governance</p><h2 className="mt-2 text-2xl font-semibold text-[var(--ink)]">Served-brand policies by quote family</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--ink-4)]">This is the only place footer brands are chosen. A new quote snapshots the matching policy, so sales cannot change customer-facing brand identity inside Quote Studio.</p></div>
          <a href="/dashboard/master-data/brands" className="text-sm font-semibold text-[var(--brand-700)]">Open full Brand Master</a>
        </div>
        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          <QuoteBrandPolicyCard title="Tile & Chemical quotations" description="Footer identity for tiles, installation chemicals and area-priced customer selections." icon={Layers3} tone="bg-amber-50 text-amber-800" modeKey="tileQuoteBrandSelectionMode" idsKey="tileQuoteBrandIds" form={form} setForm={setForm} brands={brands} />
          <QuoteBrandPolicyCard title="CP & Sanitary quotations" description="Footer identity for faucets, sanitaryware and every non-tile product family." icon={Bath} tone="bg-sky-50 text-sky-800" modeKey="cpSanitaryQuoteBrandSelectionMode" idsKey="cpSanitaryQuoteBrandIds" form={form} setForm={setForm} brands={brands} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-[var(--line)] bg-[var(--bg-soft)] p-4"><Button type="button" onClick={saveQuoteBrandDefaults} disabled={loading}><Save className="mr-2 h-4 w-4" />Save both quote-family policies</Button><span className="text-xs leading-5 text-[var(--ink-4)]">Changes apply to future quotes. Existing quotes retain their audited brand selection snapshot.</span></div>
        <div className="mt-7 flex items-end justify-between gap-3 border-t border-[var(--line-soft)] pt-6"><div><h3 className="text-lg font-semibold text-[var(--ink)]">Brand artwork library</h3><p className="mt-1 text-xs text-[var(--ink-4)]">Upload logos and control whether each Brand Master record is eligible for quotation policies.</p></div></div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {brands.map((brand: any) => <article key={brand.id} className="rounded-md border border-[var(--line)] bg-[var(--surface)] p-4">
            <div className="grid h-20 place-items-center rounded border border-[var(--line-soft)] bg-white p-3">{brand.metadata?.logoUrl ? <img src={brand.metadata.logoUrl} alt={`${brand.name} logo`} className="max-h-14 max-w-full object-contain" /> : <ImagePlus className="h-5 w-5 text-[var(--ink-5)]" />}</div>
            <p className="mt-3 truncate text-sm font-semibold text-[var(--ink)]">{brand.name}</p>
            <div className="mt-3 flex items-center justify-between gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-[var(--line)] px-3 py-2 text-xs font-semibold text-[var(--ink-2)]">{uploadingBrandId === String(brand.id) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}{brand.metadata?.logoUrl ? 'Replace' : 'Upload'}<input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={Boolean(uploadingBrandId)} onChange={(event) => handleBrandLogoUpload(brand, event.target.files?.[0])} /></label>
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--ink-3)]"><input type="checkbox" checked={brand.metadata?.quoteEnabled !== false} onChange={(event) => saveBrandPresentation(brand, { quoteEnabled: event.target.checked })} className="h-4 w-4" />Quotes</label>
            </div>
          </article>)}
        </div>
        {!brands.length ? <p className="mt-5 rounded-md border border-dashed border-[var(--line)] p-6 text-center text-sm font-semibold text-[var(--ink-4)]">Create brands in Brand Master before assigning quotation logos.</p> : null}
      </section>

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

      <section>
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
            <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Destructive workspace reset is disabled in production.</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
