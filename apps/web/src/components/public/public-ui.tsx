import Link from 'next/link';
import { MapPin, Phone, ScanLine } from 'lucide-react';
import { FallbackImg } from './public-client';
import { firstPhone, publicImage, rupees, type PublicPrice, type PublicProductCard, type Showroom } from '@/lib/public-catalogue';

export function PublicHeader({ showroom, scanLink = true }: { showroom: Showroom; scanLink?: boolean }) {
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-[var(--surface)]/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
        <Link href="/scan" className="flex min-w-0 items-center gap-3" aria-label={`${showroom.companyName} showroom`}>
          <img src={publicImage(showroom.logoUrl) || '/brand/marble-park-logo.png'} alt="" className="h-10 w-10 shrink-0 rounded-md bg-[#ffffff] object-contain p-0.5" />
          <span className="min-w-0">
            <span className="block truncate font-display text-lg font-semibold leading-tight text-[var(--ink)]">{showroom.companyName}</span>
            <span className="block truncate text-xs text-[var(--ink-4)]">Showroom catalogue</span>
          </span>
        </Link>
        {scanLink ? (
          <Link href="/scan" className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full border border-[var(--line)] px-4 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--bg-soft)]">
            <ScanLine className="h-4 w-4" aria-hidden="true" />Scan a product
          </Link>
        ) : null}
      </div>
    </header>
  );
}

export function PublicFooter({ showroom }: { showroom: Showroom }) {
  const phone = firstPhone(showroom.phone);
  return (
    <footer className="mt-12 border-t border-[var(--line)] bg-[var(--surface)]">
      <div className="mx-auto grid max-w-6xl gap-4 px-4 py-8 text-sm text-[var(--ink-3)] sm:grid-cols-2">
        <div>
          <p className="font-display text-lg font-semibold text-[var(--ink)]">{showroom.companyName}</p>
          {showroom.tagline ? <p className="mt-1">{showroom.tagline}</p> : null}
        </div>
        <div className="space-y-2">
          {showroom.address ? <p className="flex gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{showroom.address}</p> : null}
          {phone ? <p className="flex gap-2"><Phone className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><a className="underline-offset-2 hover:underline" href={`tel:${phone.replace(/[^\d+]/g, '')}`}>{showroom.phone}</a></p> : null}
        </div>
        <p className="text-xs text-[var(--ink-4)] sm:col-span-2">Photos are for reference; shade and batch can vary. Prices, GST and availability are confirmed on your quotation.</p>
      </div>
    </footer>
  );
}

export function PriceLine({ price, size = 'sm' }: { price: PublicPrice; size?: 'sm' | 'lg' }) {
  if (!price) return <p className={size === 'lg' ? 'text-lg font-semibold text-[var(--ink)]' : 'text-sm font-medium text-[var(--ink-3)]'}>Price on request</p>;
  return (
    <p className={size === 'lg' ? 'flex flex-wrap items-baseline gap-x-2' : 'flex flex-wrap items-baseline gap-x-1.5'}>
      <span className={size === 'lg' ? 'text-3xl font-semibold tabular-nums text-[var(--ink)]' : 'text-base font-semibold tabular-nums text-[var(--ink)]'}>{rupees(price.amount)}</span>
      <span className={size === 'lg' ? 'text-sm text-[var(--ink-3)]' : 'text-xs text-[var(--ink-4)]'}>{price.label} / {price.unit}</span>
      {price.mrp ? <span className={`${size === 'lg' ? 'text-sm' : 'text-xs'} text-[var(--ink-4)]`}>MRP <s>{rupees(price.mrp)}</s></span> : null}
    </p>
  );
}

export function ProductTile({ product, href, index = 0 }: { product: PublicProductCard; href: string; index?: number }) {
  return (
    <li className="public-rise min-w-0" style={{ animationDelay: `${Math.min(index, 10) * 40}ms` }}>
      <Link href={href} className="group flex h-full flex-col overflow-hidden rounded-r5 border border-[var(--line)] bg-[var(--surface)] shadow-sm-soft transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-lg motion-reduce:transition-none motion-reduce:hover:translate-y-0">
        <span className="block aspect-[4/3] overflow-hidden bg-[var(--bg-soft)]">
          <FallbackImg src={product.thumbnail} className="h-full w-full object-contain p-2 transition-transform duration-500 group-hover:scale-[1.04] motion-reduce:group-hover:scale-100" />
        </span>
        <span className="flex flex-1 flex-col gap-1 p-3">
          <span className="truncate text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">{product.brand || product.category}</span>
          <span className="line-clamp-2 font-semibold leading-snug text-[var(--ink)]">{product.name}</span>
          <span className="truncate text-xs text-[var(--ink-4)]">{[product.size, product.finish].filter(Boolean).join(' · ') || product.code}</span>
          <span className="mt-auto pt-1"><PriceLine price={product.price} /></span>
        </span>
      </Link>
    </li>
  );
}

export function PublicNotice({ showroom, title, body }: { showroom: Showroom; title: string; body: string }) {
  return (
    <main className="min-h-screen bg-[var(--bg)]">
      <PublicHeader showroom={showroom} />
      <section className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="font-display text-3xl font-semibold text-[var(--ink)]">{title}</h1>
        <p className="mt-3 text-[var(--ink-3)]">{body}</p>
        <Link href="/scan" className="mt-6 inline-flex h-12 items-center gap-2 rounded-full bg-[var(--ink)] px-6 font-semibold text-[var(--surface)]">
          <ScanLine className="h-4 w-4" aria-hidden="true" />Scan a product in the showroom
        </Link>
      </section>
      <PublicFooter showroom={showroom} />
    </main>
  );
}

export const FALLBACK_SHOWROOM: Showroom = {
  companyName: 'Marble Park',
  logoUrl: '/brand/marble-park-logo.png',
  address: '',
  phone: '',
  whatsapp: '',
  email: '',
  website: '',
  tagline: '',
};
