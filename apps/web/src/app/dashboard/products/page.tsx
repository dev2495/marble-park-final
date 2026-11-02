'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useQuery, gql } from '@apollo/client';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { ChevronLeft, ChevronRight, FileText, Link2, PackageSearch, Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { QueryErrorBanner } from '@/components/query-state';
import { ProductImageFrame } from '@/components/product-image-frame';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { mediaUrls, thumbnailUrl } from '@/lib/media';
import { CreateShareModal, CustomerLinkPanel, CustomerLinksModal, MAX_SHARE_PRODUCTS, PickToggle, ShareBar } from './customer-sharing';

const PRODUCT_FIELDS = `
  id sku internalCode name category brand finish dimensions unit purchaseUom salesUom
  piecesPerPack coveragePerPack defaultMrpInclusive defaultNrpInclusive priceRateBasis priceUom
  taxClass status media description
`;

const GET_PRODUCTS = gql`
  query Products($search: String, $category: String, $take: Int, $skip: Int) {
    products(search: $search, category: $category, take: $take, skip: $skip) { ${PRODUCT_FIELDS} }
  }
`;
const GET_CATEGORIES = gql`query ProductCategories { productCategories }`;
const GET_PRODUCT_STATS = gql`query ProductStats { productStats }`;
const GET_PRODUCT = gql`query CatalogueProduct($id: ID!) { product(id: $id) { ${PRODUCT_FIELDS} } }`;
const GET_SIMILAR = gql`
  query CatalogueSimilar($search: String, $category: String) {
    products(search: $search, category: $category, take: 13, skip: 0) { ${PRODUCT_FIELDS} }
  }
`;

const PAGE_SIZE = 36;

function currency(value?: number) {
  return `₹${Number(value || 0).toLocaleString('en-IN')}`;
}

function sellingUnit(product: any) {
  const basis = String(product?.priceRateBasis || '').toUpperCase();
  const uom = String(product?.priceUom || product?.salesUom || product?.unit || 'PC').toUpperCase();
  return basis === 'PIECE' ? 'PC' : uom;
}

// NRP is the selling default; when it is missing the MRP is still worth showing.
function priceFor(product: any) {
  const nrp = Number(product?.defaultNrpInclusive || 0);
  const mrp = Number(product?.defaultMrpInclusive || 0);
  const unit = sellingUnit(product);
  if (nrp > 0) return { main: currency(nrp), caption: `NRP / ${unit}`, mrp: mrp > 0 && mrp !== nrp ? `MRP ${currency(mrp)}` : '' };
  if (mrp > 0) return { main: currency(mrp), caption: `MRP / ${unit}`, mrp: '' };
  return { main: 'Price on request', caption: 'MRP not set yet', mrp: '' };
}

function displayName(product: any) {
  const name = String(product?.name || '').trim();
  return name || `${product?.brand ? `${product.brand} ` : ''}${product?.internalCode || product?.sku || 'Product'}`;
}

function photosFor(product: any) {
  return mediaUrls(product?.media);
}

// Tiles share a design name before " · "; other products are matched by brand.
function similarSearchFor(product: any) {
  if (!product) return '';
  if (String(product.category || '').toLowerCase() === 'tiles') return String(product.name || '').split(' · ')[0].trim();
  return String(product.brand || '').trim();
}

function specRows(product: any) {
  const rows: Array<[string, string]> = [
    ['Code', product.internalCode && product.internalCode !== product.sku ? `${product.internalCode} (SKU ${product.sku})` : product.sku],
    ['Category', product.category],
    ['Brand', product.brand],
    ['Finish', product.finish],
    ['Size', product.dimensions],
    ['Sold per', sellingUnit(product)],
    ['Stock unit', product.purchaseUom && product.purchaseUom !== sellingUnit(product) ? product.purchaseUom : ''],
    ['Pieces per pack', Number(product.piecesPerPack || 0) > 1 ? String(product.piecesPerPack) : ''],
    ['Coverage per pack', Number(product.coveragePerPack || 0) > 0 ? `${Number(product.coveragePerPack).toFixed(2)} sq ft` : ''],
    ['GST', String(product.taxClass || '').replace('GST_', '') ? `${String(product.taxClass).replace('GST_', '')}%` : ''],
  ];
  return rows.filter(([, value]) => Boolean(value && String(value).trim()));
}

function ProductCard({ product, onOpen, index, reduceMotion, picked, canPick, onTogglePick }: { product: any; onOpen: (p: any, el: HTMLElement) => void; index: number; reduceMotion: boolean | null; picked: boolean; canPick: boolean; onTogglePick: (p: any) => void }) {
  const price = priceFor(product);
  const name = displayName(product);
  const nameMissing = !String(product.name || '').trim();
  return (
    <motion.li
      initial={reduceMotion ? false : { opacity: 0.35, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: reduceMotion ? 0 : Math.min(index, 12) * 0.03, ease: [0.2, 0.7, 0.2, 1] }}
      className="relative min-w-0"
    >
      <PickToggle picked={picked} disabled={!canPick} onToggle={() => onTogglePick(product)} name={name} />
      <button
        type="button"
        onClick={(event) => onOpen(product, event.currentTarget)}
        aria-label={`${name}, ${product.brand || 'no brand'}, ${price.main}${price.main.startsWith('₹') ? ` ${price.caption}` : ''}`}
        className={`group flex h-full w-full flex-col overflow-hidden rounded-r4 border bg-[var(--surface)] text-left shadow-sm-soft transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-1 hover:shadow-lg motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${picked ? 'border-[var(--ink)] ring-2 ring-[var(--ink)]' : 'border-[var(--line)] hover:border-[var(--line-strong)]'}`}
      >
        <div className="relative">
          <ProductImageFrame
            src={thumbnailUrl(product.media) || undefined}
            alt=""
            className="aspect-[4/3] w-full"
            imageClassName="p-2 transition-transform duration-500 group-hover:scale-[1.04] motion-reduce:group-hover:scale-100"
            sizes="(max-width: 640px) 50vw, (max-width: 1280px) 33vw, 25vw"
          />
        </div>
        <div className="flex flex-1 flex-col gap-1.5 p-4">
          <p className="truncate text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">{product.brand || 'No brand'}{product.finish ? ` · ${product.finish}` : ''}</p>
          <h3 className="line-clamp-2 font-display text-lg font-semibold leading-snug text-[var(--ink)]">{name}</h3>
          {nameMissing ? <span className="w-fit rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900">Name missing in Product Master</span> : null}
          <p className="truncate font-mono text-xs text-[var(--ink-4)]">{product.internalCode || product.sku}{product.dimensions ? ` · ${product.dimensions}` : ''}</p>
          <div className="mt-auto flex items-end justify-between gap-2 pt-2">
            <div className="min-w-0">
              <p className={`font-semibold tabular-nums ${price.main.startsWith('₹') ? 'text-lg text-[var(--ink)]' : 'text-sm text-[var(--ink-3)]'}`}>{price.main}</p>
              <p className="text-xs text-[var(--ink-4)]">{price.caption}{price.mrp ? ` · ${price.mrp}` : ''}</p>
            </div>
          </div>
        </div>
      </button>
    </motion.li>
  );
}

function SkeletonCard() {
  return (
    <li className="overflow-hidden rounded-r4 border border-[var(--line)] bg-[var(--surface)]" aria-hidden="true">
      <div className="aspect-[4/3] animate-pulse bg-[var(--bg-soft)] motion-reduce:animate-none" />
      <div className="space-y-2 p-4">
        <div className="h-3 w-1/3 animate-pulse rounded bg-[var(--bg-soft)] motion-reduce:animate-none" />
        <div className="h-5 w-4/5 animate-pulse rounded bg-[var(--bg-soft)] motion-reduce:animate-none" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-[var(--bg-soft)] motion-reduce:animate-none" />
      </div>
    </li>
  );
}

function ProductDialog({ product, onClose, onOpen, picked, canPick, onTogglePick }: { product: any; onClose: () => void; onOpen: (p: any) => void; picked: boolean; canPick: boolean; onTogglePick: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [photo, setPhoto] = useState(0);
  const photos = photosFor(product);
  const price = priceFor(product);
  const name = displayName(product);
  const reduceMotion = useReducedMotion();
  const similarSearch = similarSearchFor(product);
  const { data: similarData, loading: similarLoading } = useQuery(GET_SIMILAR, {
    variables: { search: similarSearch || undefined, category: product.category || undefined },
    skip: !product?.id,
  });
  const similar = (similarData?.products || []).filter((item: any) => item.id !== product.id).slice(0, 12);
  const isTile = String(product.category || '').toLowerCase() === 'tiles';

  useEffect(() => { setPhoto(0); }, [product.id]);
  useEffect(() => {
    closeRef.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); return; }
    const typing = (event.target as HTMLElement)?.tagName === 'INPUT';
    if (!typing && photos.length > 1 && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
      event.preventDefault();
      setPhoto((index) => (index + (event.key === 'ArrowRight' ? 1 : photos.length - 1)) % photos.length);
    }
    if (event.key === 'Tab' && dialogRef.current) {
      const focusables = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])')).filter((el) => el.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  };

  return createPortal(
    <motion.div
      className="fixed inset-0 z-[9999] grid place-items-center bg-black/60 p-3 backdrop-blur-sm sm:p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="catalogue-product-title"
        onKeyDown={onKeyDown}
        initial={reduceMotion ? false : { opacity: 0.4, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={reduceMotion ? undefined : { opacity: 0, y: 12, scale: 0.98 }}
        transition={{ duration: 0.3, ease: [0.2, 0.7, 0.2, 1] }}
        className="relative max-h-full w-full max-w-6xl overflow-y-auto rounded-r5 border border-[var(--line)] bg-[var(--surface)] shadow-2xl"
      >
        <div className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-[var(--line)] bg-[var(--surface)]/95 px-4 py-3 backdrop-blur">
          <p className="min-w-0 truncate text-sm text-[var(--ink-3)]">{product.category}{product.brand ? ` › ${product.brand}` : ''}</p>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close product" className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-[var(--line)] hover:bg-[var(--bg-soft)]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid gap-6 p-4 sm:p-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-3">
            <div className="relative overflow-hidden rounded-r4 bg-[var(--bg-soft)]">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={photos[photo] || 'none'} initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                  <ProductImageFrame src={photos[photo]} alt={photos.length ? `${name}, photo ${photo + 1} of ${photos.length}` : ''} eager className="aspect-square w-full" imageClassName="p-4" sizes="(max-width: 1024px) 100vw, 55vw" />
                </motion.div>
              </AnimatePresence>
              {photos.length > 1 ? (
                <>
                  <button type="button" onClick={() => setPhoto((i) => (i + photos.length - 1) % photos.length)} aria-label="Previous photo" className="absolute left-3 top-1/2 z-30 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-[var(--surface)]/90 shadow"><ChevronLeft className="h-5 w-5" /></button>
                  <button type="button" onClick={() => setPhoto((i) => (i + 1) % photos.length)} aria-label="Next photo" className="absolute right-3 top-1/2 z-30 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-[var(--surface)]/90 shadow"><ChevronRight className="h-5 w-5" /></button>
                </>
              ) : null}
            </div>
            {photos.length > 1 ? (
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6" role="group" aria-label="Choose photo">
                {photos.map((src, index) => (
                  <button key={src} type="button" onClick={() => setPhoto(index)} aria-label={`Photo ${index + 1}`} aria-current={index === photo} className={`overflow-hidden rounded-xl border-2 ${index === photo ? 'border-[var(--ink)]' : 'border-transparent'}`}>
                    <ProductImageFrame src={src} alt="" className="aspect-square w-full" imageClassName="p-1" sizes="96px" />
                  </button>
                ))}
              </div>
            ) : null}
            {!photos.length ? <p className="text-sm text-[var(--ink-4)]">No photo yet.{isTile ? ' Add one to the design in Tile Master → Images.' : ' Add one in Product Master.'}</p> : null}
          </div>

          <div className="min-w-0 space-y-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--brand-700)]">{product.brand || 'No brand'}</p>
              <h2 id="catalogue-product-title" className="mt-1 font-display text-3xl font-semibold leading-tight text-[var(--ink)] sm:text-4xl">{name}</h2>
              <p className="mt-2 font-mono text-sm text-[var(--ink-4)]">{product.internalCode || product.sku}</p>
            </div>
            <div className="rounded-r4 bg-[var(--bg-soft)] p-4">
              <p className="text-3xl font-semibold tabular-nums text-[var(--ink)]">{price.main}</p>
              <p className="mt-1 text-sm text-[var(--ink-3)]">{price.caption}{price.mrp ? ` · ${price.mrp}` : ''}{price.main.startsWith('₹') ? ' · GST added on the quotation' : ''}</p>
            </div>
            {product.description ? <p className="text-sm leading-6 text-[var(--ink-2)]">{product.description}</p> : null}
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
              {specRows(product).map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-[var(--ink-4)]">{label}</dt>
                  <dd className="break-words font-medium text-[var(--ink)]">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="lg"><Link href={`/dashboard/quotes/new?product=${encodeURIComponent(product.id)}`}><FileText className="mr-2 h-4 w-4" />Start a quote with this</Link></Button>
              <Button asChild size="lg" variant="outline"><Link href={`/dashboard/master-data/${isTile ? 'tiles' : 'products'}`}>Open in {isTile ? 'Tile Master' : 'Product Master'}</Link></Button>
            </div>
            {product.status === 'active' ? <CustomerLinkPanel key={product.id} productId={product.id} productName={name} picked={picked} canPick={canPick} onTogglePick={onTogglePick} /> : null}
          </div>
        </div>

        <section className="border-t border-[var(--line)] p-4 sm:p-6" aria-labelledby="catalogue-similar-title">
          <h3 id="catalogue-similar-title" className="font-display text-2xl font-semibold text-[var(--ink)]">{isTile ? 'Other sizes and finishes' : `More from ${product.brand || product.category}`}</h3>
          {similarLoading ? <p className="mt-3 text-sm text-[var(--ink-4)]">Finding similar products…</p> : null}
          {!similarLoading && !similar.length ? <p className="mt-3 text-sm text-[var(--ink-4)]">No similar products found.</p> : null}
          {similar.length ? (
            <ul className="mt-4 grid snap-x snap-mandatory auto-cols-[minmax(11rem,13rem)] grid-flow-col gap-3 overflow-x-auto pb-2">
              {similar.map((item: any) => {
                const itemPrice = priceFor(item);
                return (
                  <li key={item.id} className="snap-start">
                    <button type="button" onClick={() => onOpen(item)} aria-label={`${displayName(item)}, ${itemPrice.main}`} className="group block w-full overflow-hidden rounded-r3 border border-[var(--line)] bg-[var(--surface)] text-left hover:border-[var(--line-strong)]">
                      <ProductImageFrame src={thumbnailUrl(item.media) || undefined} alt="" className="aspect-[4/3] w-full" imageClassName="p-1.5" sizes="208px" />
                      <span className="block p-3">
                        <span className="line-clamp-2 text-sm font-semibold text-[var(--ink)]">{displayName(item)}</span>
                        <span className="mt-1 block truncate text-xs text-[var(--ink-4)]">{[item.finish, item.dimensions].filter(Boolean).join(' · ') || item.sku}</span>
                        <span className="mt-1 block text-sm font-semibold tabular-nums text-[var(--ink)]">{itemPrice.main}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

export default function ProductsPage() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(0);
  const [openProduct, setOpenProduct] = useState<any>(null);
  const [requestedProductId, setRequestedProductId] = useState('');
  const [mounted, setMounted] = useState(false);
  const [picked, setPicked] = useState<any[]>([]);
  const [shareOpen, setShareOpen] = useState(false);
  const [linksOpen, setLinksOpen] = useState(false);
  const openerRef = useRef<HTMLElement | null>(null);
  const resultsRef = useRef<HTMLElement | null>(null);
  const reduceMotion = useReducedMotion();
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const { data, previousData, loading, error, refetch } = useQuery(GET_PRODUCTS, {
    variables: { search: debouncedSearch || undefined, category: category || undefined, take: PAGE_SIZE + 1, skip: page * PAGE_SIZE },
    notifyOnNetworkStatusChange: true,
  });
  const { data: categoriesData, error: categoriesError } = useQuery(GET_CATEGORIES);
  const { data: statsData, error: statsError } = useQuery(GET_PRODUCT_STATS);
  const { data: requestedData, error: requestedError } = useQuery(GET_PRODUCT, { variables: { id: requestedProductId }, skip: !requestedProductId });

  const visibleData = data || previousData;
  const productPage = useMemo<any[]>(() => visibleData?.products || [], [visibleData?.products]);
  const products = useMemo<any[]>(() => productPage.slice(0, PAGE_SIZE), [productPage]);
  const hasNextPage = productPage.length > PAGE_SIZE;
  const stats = statsData?.productStats;
  const categories = useMemo<string[]>(() => categoriesData?.productCategories || [], [categoriesData?.productCategories]);
  const initialLoading = loading && !visibleData;
  const compositeError = error || categoriesError || statsError || requestedError;

  useEffect(() => {
    setMounted(true);
    setRequestedProductId(new URLSearchParams(window.location.search).get('product') || '');
  }, []);
  useEffect(() => { if (requestedData?.product) setOpenProduct(requestedData.product); }, [requestedData?.product]);

  const open = useCallback((product: any, from?: HTMLElement) => {
    if (from) openerRef.current = from;
    setOpenProduct(product);
  }, []);
  const close = useCallback(() => {
    setOpenProduct(null);
    if (requestedProductId) {
      setRequestedProductId('');
      window.history.replaceState(null, '', window.location.pathname);
    }
    requestAnimationFrame(() => openerRef.current?.focus());
  }, [requestedProductId]);

  const changePage = (next: number) => {
    setPage(Math.max(0, next));
    requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' }));
  };
  const selectCategory = (value: string) => { setCategory(value); setPage(0); };
  const pickedIds = useMemo(() => new Set(picked.map((item) => item.id)), [picked]);
  const canPick = picked.length < MAX_SHARE_PRODUCTS;
  const togglePick = useCallback((product: any) => {
    setPicked((current) => current.some((item) => item.id === product.id)
      ? current.filter((item) => item.id !== product.id)
      : current.length < MAX_SHARE_PRODUCTS ? [...current, product] : current);
  }, []);

  return (
    <div className="space-y-5 pb-10">
      {compositeError ? <QueryErrorBanner error={compositeError} onRetry={() => refetch()} /> : null}

      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-[var(--ink)]">Catalogue</h1>
          <p className="mt-1 text-sm text-[var(--ink-3)]">
            {stats?.totalProducts != null ? `${Number(stats.totalProducts).toLocaleString('en-IN')} products` : 'Products'}
            {categories.length ? ` in ${categories.length} categories` : ''}. Open any product for photos, specs and similar items, or tap + to send a set to a customer.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => setLinksOpen(true)}><Link2 className="mr-2 h-4 w-4" />Customer links</Button>
          <Button asChild variant="outline"><Link href="/dashboard/master-data/products">Manage in Product Master</Link></Button>
        </div>
      </header>

      <section aria-label="Search and filters" className="sticky top-2 z-20 space-y-3 rounded-r4 border border-[var(--line)] bg-[var(--surface)]/95 p-3 shadow-sm-soft backdrop-blur">
        <div className="relative">
          <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--ink-4)]" aria-hidden="true" />
          <label htmlFor="catalogue-search" className="sr-only">Search the catalogue</label>
          <Input
            id="catalogue-search"
            type="search"
            placeholder="Search name, code, brand, finish, size…"
            value={search}
            onChange={(event) => { setSearch(event.target.value); setPage(0); }}
            className="h-11 pl-10 text-sm"
          />
        </div>
        <div className="flex items-center gap-3">
          <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-0.5" role="toolbar" aria-label="Category">
            {['', ...categories].map((item) => (
              <button
                key={item || 'all'}
                type="button"
                aria-pressed={category === item}
                onClick={() => selectCategory(item)}
                className={`h-9 shrink-0 rounded-full border px-4 text-sm font-semibold transition-colors ${category === item ? 'border-[var(--ink)] bg-[var(--ink)] text-[var(--surface)]' : 'border-[var(--line)] bg-[var(--surface)] text-[var(--ink-3)] hover:border-[var(--line-strong)] hover:text-[var(--ink)]'}`}
              >
                {item || 'All'}
              </button>
            ))}
          </div>
          <p className="hidden shrink-0 text-xs tabular-nums text-[var(--ink-4)] sm:block" aria-live="polite">
            {initialLoading ? 'Loading…' : `${products.length}${hasNextPage ? '+' : ''} on this page`}
          </p>
        </div>
      </section>

      <section ref={resultsRef} className="scroll-mt-24" aria-busy={loading} aria-label="Products">
        {initialLoading ? (
          <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <SkeletonCard key={i} />)}</ul>
        ) : products.length === 0 ? (
          <div className="grid place-items-center rounded-r4 border border-dashed border-[var(--line)] bg-[var(--surface)] p-12 text-center">
            <PackageSearch className="h-8 w-8 text-[var(--ink-4)]" aria-hidden="true" />
            <p className="mt-3 font-semibold text-[var(--ink)]">No products match{debouncedSearch ? ` “${debouncedSearch}”` : ''}.</p>
            <p className="mt-1 text-sm text-[var(--ink-3)]">Try a code, brand or finish, or clear the filters.</p>
            {(search || category) ? <Button type="button" variant="outline" className="mt-4" onClick={() => { setSearch(''); setCategory(''); setPage(0); }}>Clear search and filters</Button> : null}
          </div>
        ) : (
          <ul className={`grid grid-cols-2 gap-3 transition-opacity duration-150 motion-reduce:transition-none sm:gap-4 lg:grid-cols-3 xl:grid-cols-4 ${loading ? 'opacity-60' : 'opacity-100'}`}>
            {products.map((product: any, index: number) => (
              <ProductCard key={product.id} product={product} index={index} onOpen={open} reduceMotion={reduceMotion} picked={pickedIds.has(product.id)} canPick={canPick} onTogglePick={togglePick} />
            ))}
          </ul>
        )}
        {!initialLoading && (page > 0 || hasNextPage) ? (
          <nav aria-label="Catalogue pages" className="mt-5 flex items-center justify-between rounded-r4 border border-[var(--line)] bg-[var(--surface)] p-3">
            <Button variant="outline" disabled={page === 0 || loading} onClick={() => changePage(page - 1)}><ChevronLeft className="mr-1 h-4 w-4" />Previous</Button>
            <span className="text-sm text-[var(--ink-3)]">Page {page + 1}</span>
            <Button variant="outline" disabled={!hasNextPage || loading} onClick={() => changePage(page + 1)}>Next<ChevronRight className="ml-1 h-4 w-4" /></Button>
          </nav>
        ) : null}
      </section>

      <ShareBar products={picked} onRemove={(id) => setPicked((current) => current.filter((item) => item.id !== id))} onClear={() => setPicked([])} onCreate={() => setShareOpen(true)} />

      {mounted ? (
        <AnimatePresence>
          {openProduct ? <ProductDialog key="catalogue-product" product={openProduct} onClose={close} onOpen={(p) => open(p)} picked={pickedIds.has(openProduct.id)} canPick={canPick} onTogglePick={() => togglePick(openProduct)} /> : null}
        </AnimatePresence>
      ) : null}
      {shareOpen ? <CreateShareModal products={picked} onClose={() => setShareOpen(false)} onCreated={() => setPicked([])} /> : null}
      {linksOpen ? <CustomerLinksModal onClose={() => setLinksOpen(false)} /> : null}
    </div>
  );
}
