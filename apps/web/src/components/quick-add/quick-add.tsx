'use client';

// Quick add: save only what a record needs to be used right now, flag it for
// follow-up, and keep working. Everything else is completed later from the
// Follow-up queue.
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { gql, useLazyQuery, useMutation, useQuery } from '@apollo/client';
import { Loader2, Plus, Search, X } from 'lucide-react';
import { describeApolloError } from '@/lib/apollo-errors';
import { cn } from '@/lib/utils';
import { maskedMobile, mobileKey } from '@/lib/customer-display';

const SEARCH_CUSTOMERS = gql`query QuickCustomerSearch($search: String, $take: Float) { customers(search: $search, take: $take) { id name mobile city siteAddress email tags } }`;
const CUSTOMER_CHECK = gql`query QuickCustomerCheck($phone: String, $name: String, $city: String) { customerDuplicateCandidates(phone: $phone, name: $name, city: $city) }`;
const QUICK_ADD_CUSTOMER = gql`mutation QuickAddCustomer($input: QuickAddCustomerInput!) { quickAddCustomer(input: $input) }`;
const QUICK_ADD_PRODUCT = gql`mutation QuickAddProduct($input: QuickAddProductInput!) { quickAddProduct(input: $input) }`;
const QUICK_ADD_MASTER = gql`mutation QuickAddMaster($kind: String!, $input: QuickAddMasterInput!) { quickAddMaster(kind: $kind, input: $input) }`;
const SKU_SETUP = gql`query QuickSkuSetup { masterProductCategories(status: "active") masterProductBrands(status: "active") }`;
const UPLOAD = gql`mutation QuickSkuPhoto($filename: String!, $contentBase64: String!, $scope: String) { uploadStoredAsset(filename: $filename, contentBase64: $contentBase64, scope: $scope) { result } }`;

export const FOLLOW_UP_TAG = 'follow-up';
export function isFollowUp(record: any) {
  const tags = Array.isArray(record?.tags) ? record.tags : [];
  return tags.includes(FOLLOW_UP_TAG) || Boolean(record?.metadata?.followUp) || Boolean(record?.sourceRefs?.followUp);
}

function errorText(error: unknown, operation: string) {
  const diagnostic = describeApolloError(error, operation);
  return diagnostic.remediation || diagnostic.message;
}

export function Modal({ open, title, subtitle, onClose, children, footer, width = 'max-w-lg' }: { open: boolean; title: string; subtitle?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: string }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const timer = window.setTimeout(() => panel.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus(), 30);
    return () => { window.removeEventListener('keydown', onKey); window.clearTimeout(timer); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/45 sm:items-start sm:pt-[10vh]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={title} className={cn('flex max-h-[88vh] w-full flex-col overflow-hidden rounded-t-2xl border border-[var(--line)] bg-[var(--surface)] shadow-lg-soft sm:rounded-2xl', width)}>
        <div className="flex items-start gap-3 border-b border-[var(--line)] px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-lg font-bold text-[var(--ink)]">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-xs text-[var(--ink-4)]">{subtitle}</p> : null}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-[var(--ink-4)] hover:bg-[var(--bg-soft)]"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="flex items-center justify-end gap-2 border-t border-[var(--line)] px-5 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--ink-3)]">
      {label}
      {children}
      {hint ? <span className="font-normal text-[var(--ink-4)]">{hint}</span> : null}
    </label>
  );
}
export const inputClass = 'h-10 w-full rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-3 text-sm font-normal text-[var(--ink)] outline-none focus:border-[var(--brand-500)] focus:ring-2 focus:ring-[var(--ring)]';
export const primaryButton = 'inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[var(--brand-600)] px-4 text-sm font-semibold text-white hover:bg-[var(--brand-700)] disabled:cursor-not-allowed disabled:opacity-50';
export const secondaryButton = 'inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-4 text-sm font-semibold text-[var(--ink-2)] hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-50';

function LaterNote({ children }: { children: ReactNode }) {
  return <p className="rounded-lg bg-[var(--warning-bg)] px-3 py-2 text-xs font-medium text-[var(--warning)]">{children}</p>;
}

export function CustomerPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (customer: any, note?: string) => void }) {
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [city, setCity] = useState('');
  const [error, setError] = useState('');
  const [runSearch, { data, loading }] = useLazyQuery(SEARCH_CUSTOMERS, { fetchPolicy: 'network-only' });
  const [quickAdd, quickState] = useMutation(QUICK_ADD_CUSTOMER);
  const [runCheck, checkState] = useLazyQuery(CUSTOMER_CHECK, { fetchPolicy: 'network-only' });
  const phoneKey = mobileKey(mobile);
  const trimmedName = name.trim();
  // Phone is the customer's identity: check it (and same names) while typing.
  useEffect(() => {
    if (!open || (!phoneKey && trimmedName.length < 2)) return;
    const timer = window.setTimeout(() => runCheck({ variables: { phone: phoneKey || undefined, name: trimmedName.length >= 2 ? trimmedName : undefined, city: city.trim() || undefined } }), 250);
    return () => window.clearTimeout(timer);
  }, [open, phoneKey, trimmedName, city, runCheck]);
  const candidates: any[] = (phoneKey || trimmedName.length >= 2) ? (checkState.data?.customerDuplicateCandidates || []) : [];
  const phoneMatch = phoneKey ? candidates.find((row) => row.matchedOn?.includes('mobile')) : null;
  const sameNames = candidates.filter((row) => !row.matchedOn?.includes('mobile') && (row.matchedOn?.includes('name') || row.matchedOn?.includes('name+city')));
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => runSearch({ variables: { search: search.trim() || undefined, take: 12 } }), search ? 220 : 0);
    return () => window.clearTimeout(timer);
  }, [open, search, runSearch]);
  useEffect(() => { if (open) { setError(''); } }, [open]);
  useEffect(() => {
    // Typing a mobile number in search pre-fills the quick-add form.
    const digits = search.replace(/\D/g, '');
    if (digits.length >= 10) setMobile(digits.slice(-10));
    else if (search && !/\d/.test(search)) setName(search);
  }, [search]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (phoneMatch) { setError(`This mobile already belongs to ${phoneMatch.name}. Use that customer.`); return; }
    try {
      const result = (await quickAdd({ variables: { input: { name: name.trim(), mobile: mobile.trim(), city: city.trim() || undefined } } })).data?.quickAddCustomer;
      if (!result?.customer) throw new Error('The customer could not be saved.');
      onPick(result.customer, result.existing ? `${result.customer.name} already exists with this mobile, so the existing customer was used.` : `${result.customer.name} added and flagged for follow-up.`);
      setName(''); setMobile(''); setCity(''); setSearch('');
    } catch (err) { setError(errorText(err, 'QuickAddCustomer')); }
  };
  const rows = data?.customers || [];
  return (
    <Modal open={open} onClose={onClose} title="Customer" subtitle="Find an existing customer, or add a walk-in with just a name and mobile.">
      <div className="space-y-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[var(--ink-4)]" />
          <input aria-label="Search customers" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, mobile or city" className={cn(inputClass, 'pl-9')} />
        </div>
        <div className="max-h-56 space-y-1 overflow-y-auto">
          {loading ? <p className="flex items-center gap-2 text-xs text-[var(--ink-4)]"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching…</p> : null}
          {!loading && !rows.length ? <p className="text-xs text-[var(--ink-4)]">No customer found. Add them below.</p> : null}
          {rows.map((customer: any) => (
            <button key={customer.id} type="button" onClick={() => onPick(customer)} className="flex w-full items-center justify-between gap-3 rounded-lg border border-[var(--line)] px-3 py-2 text-left hover:border-[var(--brand-400)] hover:bg-[var(--surface-2)]">
              <span className="min-w-0"><b className="block truncate text-sm text-[var(--ink)]">{customer.name}</b><span className="text-xs text-[var(--ink-4)]">{customer.mobile || 'No mobile'}{customer.city ? ` · ${customer.city}` : ''}</span></span>
              {isFollowUp(customer) ? <span className="shrink-0 rounded bg-[var(--warning-bg)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--warning)]">follow up</span> : null}
            </button>
          ))}
        </div>
        <form onSubmit={submit} className="space-y-3 rounded-xl border border-dashed border-[var(--line-strong)] p-3">
          <p className="text-xs font-bold uppercase tracking-wider text-[var(--ink-4)]">Quick add walk-in</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name"><input required minLength={2} value={name} onChange={(event) => setName(event.target.value)} className={inputClass} placeholder="Customer name" /></Field>
            <Field label="Mobile"><input required inputMode="numeric" value={mobile} onChange={(event) => setMobile(event.target.value)} className={inputClass} placeholder="10-digit mobile" /></Field>
          </div>
          <Field label="City (optional)"><input value={city} onChange={(event) => setCity(event.target.value)} className={inputClass} /></Field>
          <LaterNote>Address, GSTIN and email can wait. The customer is saved now and listed in the Follow-up queue.</LaterNote>
          {phoneMatch ? (
            <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--info)]/40 bg-[var(--info-bg)] px-3 py-2 text-xs text-[var(--info)]">
              <span className="min-w-0 flex-1"><b>Already a customer:</b> {phoneMatch.name}{phoneMatch.city ? ` · ${phoneMatch.city}` : ''} · {phoneMatch.maskedMobile || maskedMobile(phoneMatch.mobile)}</span>
              <button type="button" onClick={() => { onPick({ ...phoneMatch, phone: phoneMatch.mobile }, `${phoneMatch.name} already had this mobile, so the existing customer is used.`); setName(''); setMobile(''); setCity(''); setSearch(''); }} className="rounded-md bg-[var(--info)] px-2.5 py-1 font-semibold text-white">Use this customer</button>
            </div>
          ) : null}
          {!phoneMatch && sameNames.length ? (
            <p className="rounded-lg bg-[var(--bg-soft)] px-3 py-2 text-xs text-[var(--ink-3)]">
              {sameNames.length === 1 ? 'Another customer' : `${sameNames.length} other customers`} named {trimmedName} ({sameNames.map((row) => [row.city, row.maskedMobile].filter(Boolean).join(' ')).join(', ')}). A different mobile means a different customer; check the number.
            </p>
          ) : null}
          {error ? <p role="alert" className="text-xs font-semibold text-[var(--danger)]">{error}</p> : null}
          <button className={cn(primaryButton, 'w-full')} disabled={quickState.loading || Boolean(phoneMatch)}>{quickState.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}{phoneMatch ? 'Number already saved' : 'Add and use'}</button>
        </form>
      </div>
    </Modal>
  );
}

export function ArchitectPicker({ open, onClose, architects, currentId, onPick, onAdded }: { open: boolean; onClose: () => void; architects: any[]; currentId?: string; onPick: (architect: any | null) => void; onAdded?: () => void }) {
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [quickAdd, state] = useMutation(QUICK_ADD_MASTER);
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (architects || []).filter((row: any) => !term || `${row.name} ${row.firmName || ''} ${row.phone || ''}`.toLowerCase().includes(term)).slice(0, 30);
  }, [architects, search]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      const saved = (await quickAdd({ variables: { kind: 'architect', input: { name: name.trim(), phone: phone.trim() || undefined } } })).data?.quickAddMaster;
      onAdded?.();
      onPick({ id: saved.id, name: saved.name });
      setName(''); setPhone('');
    } catch (err) { setError(errorText(err, 'QuickAddArchitect')); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Consulting architect" subtitle="Linking an architect prints their name on the quote and enables the architect picture bundle.">
      <div className="space-y-4">
        <input aria-label="Search architects" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search architect or firm" className={inputClass} />
        <div className="max-h-56 space-y-1 overflow-y-auto">
          {rows.map((architect: any) => (
            <button key={architect.id} type="button" onClick={() => onPick(architect)} className={cn('flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left hover:border-[var(--brand-400)]', architect.id === currentId ? 'border-[var(--brand-500)] bg-[var(--brand-50)]' : 'border-[var(--line)]')}>
              <span className="min-w-0"><b className="block truncate text-sm text-[var(--ink)]">{architect.name}</b><span className="text-xs text-[var(--ink-4)]">{architect.firmName || 'Firm not set'}{architect.phone ? ` · ${architect.phone}` : ''}</span></span>
              {isFollowUp(architect) ? <span className="rounded bg-[var(--warning-bg)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--warning)]">follow up</span> : null}
            </button>
          ))}
          {!rows.length ? <p className="text-xs text-[var(--ink-4)]">No architect matches. Add them below.</p> : null}
        </div>
        <form onSubmit={submit} className="space-y-3 rounded-xl border border-dashed border-[var(--line-strong)] p-3">
          <p className="text-xs font-bold uppercase tracking-wider text-[var(--ink-4)]">Quick add architect</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name"><input required value={name} onChange={(event) => setName(event.target.value)} className={inputClass} placeholder="Ar. name" /></Field>
            <Field label="Mobile (optional)"><input value={phone} onChange={(event) => setPhone(event.target.value)} className={inputClass} /></Field>
          </div>
          <LaterNote>Firm and city can be added later from the Follow-up queue.</LaterNote>
          {error ? <p role="alert" className="text-xs font-semibold text-[var(--danger)]">{error}</p> : null}
          <button className={cn(primaryButton, 'w-full')} disabled={state.loading}><Plus className="h-4 w-4" />Add and link</button>
        </form>
        {currentId ? <button type="button" onClick={() => onPick(null)} className="text-xs font-semibold text-[var(--danger)] hover:underline">Remove architect from this quote</button> : null}
      </div>
    </Modal>
  );
}

async function fileBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

export function QuickSkuDialog({ open, onClose, initialName, family, onCreated }: { open: boolean; onClose: () => void; initialName?: string; family?: 'tile' | 'cp_sanitary'; onCreated: (product: any) => void }) {
  const { data } = useQuery(SKU_SETUP, { skip: !open });
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [brand, setBrand] = useState('');
  const [mrp, setMrp] = useState('');
  const [unit, setUnit] = useState('PC');
  // Chemicals are sold loose per KG or in sealed bags per BAG.
  const [chemicalUnit, setChemicalUnit] = useState('KG');
  const [photo, setPhoto] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [quickAdd] = useMutation(QUICK_ADD_PRODUCT);
  const [upload] = useMutation(UPLOAD);
  useEffect(() => { if (open) { setName(initialName || ''); setError(''); setPhoto(null); } }, [open, initialName]);
  const categories = useMemo(() => (data?.masterProductCategories || [])
    .map((row: any) => String(row.name))
    .filter((value: string) => value.toLowerCase() !== 'tiles')
    .filter((value: string) => !family || (family === 'tile' ? value.toLowerCase() === 'chemicals' : value.toLowerCase() !== 'chemicals')), [data, family]);
  useEffect(() => { if (open && !category && categories.length) setCategory(categories[0]); }, [open, category, categories]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      let mediaUrl: string | undefined;
      if (photo) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(photo.type) || photo.size > 5 * 1024 * 1024) throw new Error('Use a JPG, PNG or WebP photo under 5 MB.');
        mediaUrl = (await upload({ variables: { filename: photo.name, contentBase64: await fileBase64(photo), scope: 'product-image' } })).data?.uploadStoredAsset?.result?.publicUrl;
      }
      const product = (await quickAdd({ variables: { input: { name: name.trim(), category, brand: brand.trim() || undefined, mrp: Number(mrp), unit: category.toLowerCase() === 'chemicals' ? chemicalUnit : unit, mediaUrl } } })).data?.quickAddProduct;
      if (!product?.id) throw new Error('The item could not be saved.');
      onCreated(product);
    } catch (err) {
      setError(errorText(err, 'QuickAddProduct'));
    } finally {
      setBusy(false);
    }
  };
  const chemical = category.toLowerCase() === 'chemicals';
  return (
    <Modal open={open} onClose={onClose} title="Quick add SKU" subtitle="For a new arrival that is not in Product Master yet.">
      <form id="quick-sku" onSubmit={submit} className="space-y-3">
        <Field label="Item name"><input required minLength={2} value={name} onChange={(event) => setName(event.target.value)} className={inputClass} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Category">
            <select required value={category} onChange={(event) => setCategory(event.target.value)} className={inputClass}>
              {categories.map((value: string) => <option key={value}>{value}</option>)}
            </select>
          </Field>
          <Field label="Brand (optional)">
            <input list="quick-sku-brands" value={brand} onChange={(event) => setBrand(event.target.value)} className={inputClass} />
            <datalist id="quick-sku-brands">{(data?.masterProductBrands || []).map((row: any) => <option key={row.id} value={row.name} />)}</datalist>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={`MRP ₹ per ${chemical ? chemicalUnit.toLowerCase() : unit.toLowerCase()}`} hint="Before GST, as on Product Master"><input required type="number" min="1" step="0.01" value={mrp} onChange={(event) => setMrp(event.target.value)} className={inputClass} /></Field>
          <Field label="Sold per">
            <select value={chemical ? chemicalUnit : unit} onChange={(event) => (chemical ? setChemicalUnit(event.target.value) : setUnit(event.target.value))} className={inputClass}>
              {chemical ? [['KG', 'KG · loose by weight'], ['BAG', 'BAG · sealed bag']].map(([value, label]) => <option key={value} value={value}>{label}</option>) : ['PC', 'SET', 'BOX'].map((value) => <option key={value}>{value}</option>)}
            </select>
          </Field>
          <Field label="Photo (optional)"><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setPhoto(event.target.files?.[0] || null)} className="pt-2 text-xs" /></Field>
        </div>
        <LaterNote>Saved to Product Master with a QA- code and this MRP. HSN, floor price and the rest are listed in the Follow-up queue. Tiles need size and box coverage, so add them from Tile Master.</LaterNote>
        {error ? <p role="alert" className="text-xs font-semibold text-[var(--danger)]">{error}</p> : null}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={secondaryButton}>Cancel</button>
          <button className={primaryButton} disabled={busy || !category}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Add item</button>
        </div>
      </form>
    </Modal>
  );
}

const MASTER_LABELS: Record<string, { title: string; phone?: boolean; code?: boolean; placeholder: string }> = {
  architect: { title: 'architect', phone: true, placeholder: 'Ar. name' },
  vendor: { title: 'vendor', phone: true, placeholder: 'Vendor name' },
  brand: { title: 'brand', placeholder: 'Brand name' },
  category: { title: 'category', placeholder: 'Category name' },
  finish: { title: 'finish', placeholder: 'e.g. Brushed gold' },
  tileSize: { title: 'tile size', code: true, placeholder: 'e.g. 1200 x 1800 mm' },
};

// "Quick add" button for a master page: name only (plus phone or code where
// useful), flagged for follow-up so the full record is completed later.
export function MasterQuickAdd({ kind, onDone, className, label }: { kind: keyof typeof MASTER_LABELS; onDone?: () => void; className?: string; label?: string }) {
  const config = MASTER_LABELS[kind];
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [extra, setExtra] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [save, state] = useMutation(QUICK_ADD_MASTER);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      const saved = (await save({ variables: { kind, input: { name: name.trim(), ...(config.phone && extra ? { phone: extra.trim() } : {}), ...(config.code && extra ? { code: extra.trim() } : {}) } } })).data?.quickAddMaster;
      setMessage(`${saved?.name || name} added and flagged for follow-up.`);
      setName(''); setExtra('');
      setOpen(false);
      onDone?.();
      window.setTimeout(() => setMessage(''), 5000);
    } catch (err) { setError(errorText(err, 'QuickAddMaster')); }
  };
  return (
    <>
      <button type="button" onClick={() => { setError(''); setOpen(true); }} className={cn('inline-flex h-9 items-center gap-1.5 rounded-lg border border-dashed border-[var(--brand-400)] px-3 text-sm font-semibold text-[var(--brand-700)] hover:bg-[var(--brand-50)]', className)}><Plus className="h-4 w-4" />{label || 'Quick add'}</button>
      {message ? <span role="status" className="text-xs font-semibold text-[var(--success)]">{message}</span> : null}
      <Modal open={open} onClose={() => setOpen(false)} title={`Quick add ${config.title}`} subtitle="Saved now with the name only. The rest goes to the Follow-up queue.">
        <form onSubmit={submit} className="space-y-3">
          <Field label="Name"><input required value={name} onChange={(event) => setName(event.target.value)} placeholder={config.placeholder} className={inputClass} /></Field>
          {config.phone ? <Field label="Phone (optional)"><input value={extra} onChange={(event) => setExtra(event.target.value)} className={inputClass} /></Field> : null}
          {config.code ? <Field label="Code (optional)" hint="Made from the name when left blank."><input value={extra} onChange={(event) => setExtra(event.target.value)} className={inputClass} /></Field> : null}
          {error ? <p role="alert" className="text-xs font-semibold text-[var(--danger)]">{error}</p> : null}
          <div className="flex justify-end gap-2"><button type="button" onClick={() => setOpen(false)} className={secondaryButton}>Cancel</button><button className={primaryButton} disabled={state.loading}>Add</button></div>
        </form>
      </Modal>
    </>
  );
}

export function QuickSkuButton({ onDone, className }: { onDone?: (product: any) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn('inline-flex h-9 items-center gap-1.5 rounded-lg border border-dashed border-[var(--brand-400)] px-3 text-sm font-semibold text-[var(--brand-700)] hover:bg-[var(--brand-50)]', className)}><Plus className="h-4 w-4" />Quick add SKU</button>
      {message ? <span role="status" className="text-xs font-semibold text-[var(--success)]">{message}</span> : null}
      <QuickSkuDialog open={open} onClose={() => setOpen(false)} onCreated={(product) => { setOpen(false); setMessage(`${product.sku} ${product.name} added and flagged for follow-up.`); onDone?.(product); window.setTimeout(() => setMessage(''), 6000); }} />
    </>
  );
}
