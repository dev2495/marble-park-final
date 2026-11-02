'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { gql, useLazyQuery, useMutation, useQuery } from '@apollo/client';
import { Check, Copy, ExternalLink, Eye, Link2, Loader2, MessageCircle, Plus, QrCode, ScanLine, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const CUSTOMER_LINK = gql`query ProductCustomerLink($productId: ID!) { productCustomerLink(productId: $productId) }`;
const CREATE_SHARE = gql`mutation CreateCatalogueShare($input: CatalogueShareInput!) { createCatalogueShare(input: $input) }`;
const SHARES = gql`query CatalogueShares($scope: String) { catalogueShares(scope: $scope) }`;
const REVOKE_SHARE = gql`mutation RevokeCatalogueShare($id: ID!) { revokeCatalogueShare(id: $id) }`;

export const MAX_SHARE_PRODUCTS = 60;

function absolute(url: string) {
  if (!url) return '';
  return /^https?:\/\//i.test(url) ? url : `${window.location.origin}${url}`;
}

function whatsappShare(text: string) {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

function dateTime(value?: string | null) {
  return value ? new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';
}

function useCopy() {
  const [copied, setCopied] = useState('');
  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied((current) => (current === key ? '' : current)), 2000);
    } catch {
      window.prompt('Copy this link', text);
    }
  }
  return { copied, copy };
}

/** Small accessible modal that sits above the product dialog. */
function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    // Escape must work even when focus has fallen back to the page body.
    const onEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); closeRef.current(); } };
    document.addEventListener('keydown', onEscape, true);
    return () => document.removeEventListener('keydown', onEscape, true);
  }, []);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input,textarea,select') || ref.current?.querySelector<HTMLElement>('button');
    first?.focus();
    return () => opener?.focus?.();
  }, []);
  return createPortal(
    <div className="fixed inset-0 z-[10000] grid place-items-center bg-black/60 p-3 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(event) => {
          if (event.key !== 'Tab' || !ref.current) return;
          const focusables = Array.from(ref.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input,textarea,select')).filter((el) => el.offsetParent !== null);
          if (!focusables.length) return;
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }}
        className={`max-h-full w-full overflow-y-auto rounded-r5 border border-[var(--line)] bg-[var(--surface)] shadow-2xl ${wide ? 'max-w-3xl' : 'max-w-lg'}`}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[var(--line)] bg-[var(--surface)] px-5 py-3">
          <h2 className="font-display text-xl font-semibold text-[var(--ink)]">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-11 w-11 place-items-center rounded-full border border-[var(--line)] hover:bg-[var(--bg-soft)]"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/** The corner toggle on a catalogue card that adds it to the customer share list. */
export function PickToggle({ picked, disabled, onToggle, name }: { picked: boolean; disabled: boolean; onToggle: () => void; name: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled && !picked}
      aria-pressed={picked}
      aria-label={picked ? `Remove ${name} from customer link` : `Add ${name} to customer link`}
      title={picked ? 'Remove from customer link' : 'Add to customer link'}
      className={`absolute right-2 top-2 z-10 grid h-11 w-11 place-items-center rounded-full border shadow transition-colors disabled:opacity-40 ${picked ? 'border-[var(--ink)] bg-[var(--ink)] text-[var(--surface)]' : 'border-[var(--line)] bg-[var(--surface)]/95 text-[var(--ink-2)] hover:border-[var(--line-strong)]'}`}
    >
      {picked ? <Check className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
    </button>
  );
}

/** Inside the product dialog: a QR the customer can scan from this screen, and a link to send. */
export function CustomerLinkPanel({ productId, productName, picked, canPick, onTogglePick }: { productId: string; productName: string; picked: boolean; canPick: boolean; onTogglePick: () => void }) {
  const [load, { data, loading, error }] = useLazyQuery(CUSTOMER_LINK, { fetchPolicy: 'network-only' });
  const { copied, copy } = useCopy();
  const link = data?.productCustomerLink;
  const url = link ? absolute(link.url) : '';
  return (
    <section aria-label="Show to customer" className="rounded-r4 border border-[var(--line)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold text-[var(--ink)]">Show to customer</h3>
          <p className="text-sm text-[var(--ink-3)]">A no-login page with photos, specs and similar products.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={onTogglePick} disabled={!picked && !canPick} aria-pressed={picked}>
            {picked ? <Check className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}{picked ? 'In share list' : 'Add to share list'}
          </Button>
          {!link ? <Button type="button" onClick={() => load({ variables: { productId } })} disabled={loading}>{loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <QrCode className="mr-2 h-4 w-4" />}Customer QR and link</Button> : null}
        </div>
      </div>
      {error ? <p role="alert" className="mt-3 text-sm text-[var(--danger)]">{error.message}</p> : null}
      {link ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
          {link.qrDataUrl ? <img src={link.qrDataUrl} alt={`QR code that opens ${productName} for the customer`} className="h-40 w-40 rounded-r3 border border-[var(--line)] bg-white p-1" /> : <p className="text-sm text-[var(--ink-3)]">Set the canonical app URL in Settings to show a QR.</p>}
          <div className="min-w-0 space-y-3">
            {!link.enabled ? <p className="rounded-r3 bg-amber-50 p-2 text-sm text-amber-900">Customer pages are switched off in Settings, so this link shows a “paused” message.</p> : null}
            <p className="break-all rounded-r3 bg-[var(--bg-soft)] px-3 py-2 font-mono text-xs text-[var(--ink-2)]">{url}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => copy('link', url)}>{copied === 'link' ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}{copied === 'link' ? 'Copied' : 'Copy link'}</Button>
              <Button asChild variant="outline" size="sm"><a href={whatsappShare(`${productName}\n${url}`)} target="_blank" rel="noreferrer"><MessageCircle className="mr-1.5 h-4 w-4" />WhatsApp</a></Button>
              <Button asChild variant="outline" size="sm"><a href={url} target="_blank" rel="noreferrer"><ExternalLink className="mr-1.5 h-4 w-4" />Open</a></Button>
            </div>
            <p className="flex items-center gap-1.5 text-xs text-[var(--ink-4)]"><Eye className="h-3.5 w-3.5" aria-hidden="true" />Opened {link.views} time{link.views === 1 ? '' : 's'} by customers · {link.qrScans} sticker scan{link.qrScans === 1 ? '' : 's'}{link.lastViewedAt ? ` · last ${dateTime(link.lastViewedAt)}` : ''}</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function ShareBar({ products, onRemove, onClear, onCreate }: { products: any[]; onRemove: (id: string) => void; onClear: () => void; onCreate: () => void }) {
  if (!products.length) return null;
  return (
    <div className="sticky bottom-4 z-30 flex flex-col gap-3 rounded-r5 border border-[var(--line-strong)] bg-[var(--surface)]/95 p-3 shadow-2xl backdrop-blur sm:flex-row sm:items-center" role="region" aria-label="Customer share list">
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-[var(--ink)]">{products.length} product{products.length === 1 ? '' : 's'} picked for a customer link</p>
        <ul className="mt-1 flex gap-1.5 overflow-x-auto pb-0.5">
          {products.map((product) => (
            <li key={product.id} className="flex shrink-0 items-center gap-1 rounded-full bg-[var(--bg-soft)] py-1 pl-3 pr-1 text-xs text-[var(--ink-2)]">
              <span className="max-w-[10rem] truncate">{product.name || product.sku}</span>
              <button type="button" onClick={() => onRemove(product.id)} aria-label={`Remove ${product.name || product.sku}`} className="grid h-6 w-6 place-items-center rounded-full hover:bg-[var(--surface)]"><X className="h-3.5 w-3.5" /></button>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button type="button" variant="ghost" onClick={onClear}>Clear</Button>
        <Button type="button" onClick={onCreate}><Link2 className="mr-2 h-4 w-4" />Create customer link</Button>
      </div>
    </div>
  );
}

export function CreateShareModal({ products, onClose, onCreated }: { products: any[]; onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [days, setDays] = useState(30);
  const [create, { data, loading, error }] = useMutation(CREATE_SHARE);
  const { copied, copy } = useCopy();
  const share = data?.createCatalogueShare;
  const url = share ? absolute(share.url) : '';

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const result = await create({ variables: { input: { productIds: products.map((product) => product.id), title: title.trim() || undefined, note: note.trim() || undefined, expiresInDays: days } } }).catch(() => null);
    if (result?.data?.createCatalogueShare) onCreated();
  }

  return (
    <Modal title={share ? 'Customer link ready' : 'Create a customer link'} onClose={onClose}>
      {share ? (
        <div className="space-y-4">
          <p className="text-sm text-[var(--ink-3)]">Anyone with this link can see these {share.productCount} products until {new Date(share.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}. No login needed.</p>
          <p className="break-all rounded-r3 bg-[var(--bg-soft)] px-3 py-2 font-mono text-xs text-[var(--ink-2)]">{url}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" autoFocus onClick={() => copy('share', url)}>{copied === 'share' ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}{copied === 'share' ? 'Copied' : 'Copy link'}</Button>
            <Button asChild variant="outline"><a href={whatsappShare(`${share.title}\n${url}`)} target="_blank" rel="noreferrer"><Send className="mr-2 h-4 w-4" />Send on WhatsApp</a></Button>
            <Button asChild variant="outline"><a href={url} target="_blank" rel="noreferrer"><ExternalLink className="mr-2 h-4 w-4" />Preview</a></Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm text-[var(--ink-3)]">{products.length} product{products.length === 1 ? '' : 's'} will be on the page. Customers see photos, specs and the price your owner set in Settings, never cost or stock.</p>
          <div>
            <label htmlFor="share-title" className="text-sm font-semibold text-[var(--ink)]">Title</label>
            <Input id="share-title" value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder="Products picked for you" className="mt-1 h-11" />
          </div>
          <div>
            <label htmlFor="share-note" className="text-sm font-semibold text-[var(--ink)]">Note for the customer <span className="font-normal text-[var(--ink-4)]">(optional)</span></label>
            <textarea id="share-note" value={note} maxLength={600} onChange={(event) => setNote(event.target.value)} placeholder="Options for the master bathroom we discussed" className="mt-1 min-h-20 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--brand-400)]" />
          </div>
          <fieldset>
            <legend className="text-sm font-semibold text-[var(--ink)]">Link works for</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {[7, 30, 90].map((value) => (
                <button key={value} type="button" aria-pressed={days === value} onClick={() => setDays(value)} className={`h-10 rounded-full border px-4 text-sm font-semibold ${days === value ? 'border-[var(--ink)] bg-[var(--ink)] text-[var(--surface)]' : 'border-[var(--line)] text-[var(--ink-3)]'}`}>{value} days</button>
              ))}
            </div>
          </fieldset>
          {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error.message}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={loading}>{loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />}Create link</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export function CustomerLinksModal({ onClose }: { onClose: () => void }) {
  const { data, loading, error, refetch } = useQuery(SHARES, { variables: { scope: 'all' }, fetchPolicy: 'network-only' });
  const [revoke, { loading: revoking }] = useMutation(REVOKE_SHARE);
  const { copied, copy } = useCopy();
  const shares: any[] = data?.catalogueShares || [];
  const tone: Record<string, string> = { active: 'bg-emerald-50 text-emerald-800', expired: 'bg-[var(--bg-soft)] text-[var(--ink-3)]', revoked: 'bg-rose-50 text-rose-800' };
  return (
    <Modal title="Customer links" onClose={onClose} wide>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--ink-3)]">Links you sent, how often customers opened them, and when they stop working.</p>
        <Button asChild variant="outline" size="sm"><Link href="/print/showroom-poster" target="_blank"><ScanLine className="mr-1.5 h-4 w-4" />Showroom scan poster</Link></Button>
      </div>
      {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error.message}</p> : null}
      {loading && !shares.length ? <p className="text-sm text-[var(--ink-4)]">Loading links…</p> : null}
      {!loading && !shares.length ? <p className="rounded-r4 border border-dashed border-[var(--line)] p-6 text-center text-sm text-[var(--ink-3)]">No customer links yet. Tap + on products in the catalogue, then “Create customer link”.</p> : null}
      <ul className="space-y-2">
        {shares.map((share) => {
          const url = absolute(share.url);
          return (
            <li key={share.id} className="rounded-r4 border border-[var(--line)] p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-[var(--ink)]">{share.title}</p>
                  <p className="text-xs text-[var(--ink-4)]">{share.productCount} products{share.createdByName ? ` · by ${share.createdByName}` : ''} · created {dateTime(share.createdAt)}</p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${tone[share.status] || ''}`}>{share.status === 'revoked' ? 'stopped' : share.status}</span>
              </div>
              <p className="mt-2 flex flex-wrap gap-x-3 text-xs text-[var(--ink-3)]">
                <span className="inline-flex items-center gap-1"><Eye className="h-3.5 w-3.5" aria-hidden="true" />{share.viewCount} open{share.viewCount === 1 ? '' : 's'}</span>
                {share.lastViewedAt ? <span>last opened {dateTime(share.lastViewedAt)}</span> : <span>not opened yet</span>}
                <span>{share.status === 'active' ? 'works until' : 'ended'} {dateTime(share.revokedAt || share.expiresAt)}</span>
              </p>
              {share.status === 'active' ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => copy(share.id, url)}>{copied === share.id ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}{copied === share.id ? 'Copied' : 'Copy'}</Button>
                  <Button asChild variant="outline" size="sm"><a href={whatsappShare(`${share.title}\n${url}`)} target="_blank" rel="noreferrer"><MessageCircle className="mr-1.5 h-4 w-4" />WhatsApp</a></Button>
                  <Button type="button" variant="ghost" size="sm" disabled={revoking} onClick={async () => { if (window.confirm(`Stop “${share.title}”? Customers opening it will see that it has expired.`)) { await revoke({ variables: { id: share.id } }).catch(() => null); refetch(); } }}>Stop link</Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
