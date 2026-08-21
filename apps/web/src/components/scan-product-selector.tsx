'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Layers3, PackageCheck, Search, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ProductImageFrame } from '@/components/product-image-frame';

function imageOf(product: any) {
  const media = product?.media || {};
  const gallery = Array.isArray(media?.gallery) ? media.gallery : [];
  return media.primaryUrl || media.imageUrl || media.primary || media.primaryImage
    || media.images?.[0]?.url || media.images?.[0]
    || (typeof gallery[0] === 'string' ? gallery[0] : gallery[0]?.url)
    || '/catalogue-art/faucet.svg';
}

function productSize(product: any) {
  return product?.tileSizeMaster?.name || product?.dimensions || 'Size not recorded';
}

export function scanRelatedProducts(result: any) {
  if (Array.isArray(result?.relatedProducts) && result.relatedProducts.length) return result.relatedProducts;
  return result?.label?.product ? [{ ...result.label.product, isScannedProduct: true }] : [];
}

type Props = {
  result: any;
  primaryLabel: string;
  onPrimary: (products: any[]) => Promise<void> | void;
  secondaryLabel?: string;
  onSecondary?: (products: any[]) => Promise<void> | void;
  onDismiss?: () => void;
  existingProductIds?: string[];
  busy?: boolean;
};

export function ScanProductSelector({
  result,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  onDismiss,
  existingProductIds = [],
  busy = false,
}: Props) {
  const products = useMemo(() => scanRelatedProducts(result), [result]);
  const scanned = products.find((product: any) => product.isScannedProduct) || result?.label?.product || products[0];
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [working, setWorking] = useState<'primary' | 'secondary' | ''>('');
  const existing = useMemo(() => new Set(existingProductIds), [existingProductIds]);

  useEffect(() => {
    const scannedId = scanned?.id;
    setSelectedIds(scannedId ? [scannedId] : []);
    setFilter('');
  }, [result?.event?.id, scanned?.id]);

  const visible = products.filter((product: any) => {
    const query = filter.trim().toLowerCase();
    if (!query) return true;
    return [product.internalCode, product.sku, product.name, productSize(product), product.finish, product.brand]
      .some((value) => String(value || '').toLowerCase().includes(query));
  });
  const selected = products.filter((product: any) => selectedIds.includes(product.id));
  const allSelected = products.length > 0 && products.every((product: any) => selectedIds.includes(product.id));
  const related = result?.relatedSummary?.type === 'tile_design' && products.length > 1;

  function toggle(productId: string) {
    setSelectedIds((current) => current.includes(productId)
      ? current.filter((id) => id !== productId)
      : [...current, productId]);
  }

  async function run(which: 'primary' | 'secondary') {
    if (!selected.length || busy || working) return;
    setWorking(which);
    try {
      if (which === 'primary') await onPrimary(selected);
      else if (onSecondary) await onSecondary(selected);
    } finally {
      setWorking('');
    }
  }

  return <section className="overflow-hidden rounded-2xl border border-emerald-200 bg-[var(--surface)] shadow-[0_24px_70px_-48px_rgba(15,92,72,.65)]" aria-label="Choose scanned and similar items">
    <div className="border-b border-emerald-200 bg-[linear-gradient(115deg,#12352e,#1f6a5a)] p-4 text-white sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/12"><Sparkles className="h-5 w-5 text-emerald-200"/></span>
          <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[.16em] text-emerald-200">Exact scan resolved</p><h3 className="mt-1 truncate text-lg font-bold">{scanned?.internalCode || scanned?.sku} · {scanned?.name}</h3><p className="mt-1 text-xs leading-5 text-white/70">{related ? `${products.length} active size / finish variants share ${result?.relatedSummary?.designCode || 'this design'}. Choose only what the customer wants.` : 'This physical label maps to one active Product Master item.'}</p></div>
        </div>
        {onDismiss ? <button type="button" onClick={onDismiss} aria-label="Close scanned selection" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white/75 hover:bg-white/10 hover:text-white"><X className="h-4 w-4"/></button> : null}
      </div>
    </div>

    <div className="p-4 sm:p-5">
      <div className="grid gap-3 lg:grid-cols-[15rem_1fr]">
        <article className="rounded-xl border-2 border-emerald-500 bg-emerald-50 p-3">
          <ProductImageFrame src={imageOf(scanned)} alt={scanned?.name || 'Scanned item'} className="aspect-[4/3] w-full rounded-lg"/>
          <div className="mt-3 flex items-center gap-2"><span className="rounded bg-emerald-700 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-white">Physically scanned</span>{existing.has(scanned?.id) ? <span className="text-[10px] font-bold text-emerald-800">Already added</span> : null}</div>
          <p className="mt-2 font-bold text-emerald-950">{productSize(scanned)}</p>
          <p className="mt-1 text-xs text-emerald-800">{scanned?.finish || 'Finish not recorded'} · {scanned?.purchaseUom || scanned?.unit || 'PC'}</p>
        </article>

        <div className="min-w-0">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex min-h-11 min-w-0 flex-1 items-center rounded-lg border border-[var(--line)] bg-[var(--bg-soft)] px-3"><Search className="mr-2 h-4 w-4 shrink-0 text-[var(--ink-4)]"/><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter size, finish or code" className="min-w-0 flex-1 bg-transparent text-sm outline-none"/></label>
            {related ? <Button type="button" variant="outline" onClick={() => setSelectedIds(allSelected ? [] : products.map((product: any) => product.id))}>{allSelected ? 'Clear all' : 'Select all variants'}</Button> : null}
          </div>
          <div className="mt-3 grid max-h-[25rem] gap-2 overflow-y-auto pr-1 sm:grid-cols-2 2xl:grid-cols-3">
            {visible.map((product: any) => {
              const checked = selectedIds.includes(product.id);
              const available = Number(product.available ?? product.balances?.available ?? 0);
              return <button key={product.id} type="button" aria-pressed={checked} onClick={() => toggle(product.id)} className={`group flex min-w-0 items-center gap-3 rounded-xl border p-3 text-left transition ${checked ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-500/10' : 'border-[var(--line)] hover:border-emerald-300 hover:bg-emerald-50/40'}`}>
                <ProductImageFrame src={imageOf(product)} alt={product.name} className="h-14 w-14 shrink-0 rounded-lg"/>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold text-[var(--ink)]">{productSize(product)}</span><span className="mt-0.5 block truncate text-[11px] text-[var(--ink-4)]">{product.finish || 'Finish pending'} · {product.internalCode || product.sku}</span><span className={`mt-1 inline-flex items-center gap-1 text-[10px] font-bold ${available > 0 ? 'text-emerald-700' : 'text-amber-700'}`}><PackageCheck className="h-3 w-3"/>{available > 0 ? `${available} available` : 'Quoteable · no stock'}</span>{existing.has(product.id) ? <span className="ml-2 text-[10px] font-bold text-blue-700">Already added</span> : null}</span>
                <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border ${checked ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-[var(--line)] text-transparent'}`}><Check className="h-3.5 w-3.5"/></span>
              </button>;
            })}
          </div>
          {!visible.length ? <div className="mt-3 rounded-xl border border-dashed border-[var(--line)] p-6 text-center text-sm text-[var(--ink-4)]">No active variant matches this filter.</div> : null}
        </div>
      </div>
    </div>

    <div className="flex flex-col gap-3 border-t border-[var(--line)] bg-[var(--bg-soft)] p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2 text-sm font-semibold text-[var(--ink-3)]"><Layers3 className="h-4 w-4 text-emerald-700"/><b className="text-[var(--ink)]">{selected.length}</b> item{selected.length === 1 ? '' : 's'} selected</div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        {secondaryLabel && onSecondary ? <Button type="button" variant="outline" disabled={!selected.length || busy || Boolean(working)} onClick={() => run('secondary')}>{working === 'secondary' ? 'Opening…' : secondaryLabel}</Button> : null}
        <Button type="button" disabled={!selected.length || busy || Boolean(working)} onClick={() => run('primary')} className="bg-emerald-700 hover:bg-emerald-800">{working === 'primary' ? 'Adding…' : primaryLabel}</Button>
      </div>
    </div>
  </section>;
}
