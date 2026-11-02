'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, ChevronLeft, ChevronRight, Share2 } from 'lucide-react';
import { publicImage } from '@/lib/public-catalogue';

/** Swipe on phones, arrows and thumbnails on larger screens. */
export function PublicGallery({ photos, name }: { photos: string[]; name: string }) {
  const [active, setActive] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);

  const goTo = (index: number) => {
    const track = trackRef.current;
    if (!track) return;
    const next = (index + photos.length) % photos.length;
    track.scrollTo({ left: next * track.clientWidth, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    setActive(next);
  };

  if (!photos.length) {
    return <div className="grid aspect-square place-items-center rounded-r6 bg-[var(--bg-soft)] text-sm text-[var(--ink-4)]">Photo coming soon</div>;
  }

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-r6 bg-[var(--bg-soft)]">
        <div
          ref={trackRef}
          className="flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          onScroll={(event) => {
            const track = event.currentTarget;
            setActive(Math.round(track.scrollLeft / Math.max(1, track.clientWidth)));
          }}
          aria-label={`${name} photos`}
          role="region"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight') { event.preventDefault(); goTo(active + 1); }
            if (event.key === 'ArrowLeft') { event.preventDefault(); goTo(active - 1); }
          }}
        >
          {photos.map((src, index) => (
            <span key={src} className="block aspect-square w-full shrink-0 snap-center">
              <FallbackImg src={src} alt={`${name}, photo ${index + 1} of ${photos.length}`} eager={index === 0} className="h-full w-full object-contain p-4" />
            </span>
          ))}
        </div>
        {photos.length > 1 ? (
          <>
            <button type="button" onClick={() => goTo(active - 1)} aria-label="Previous photo" className="absolute left-3 top-1/2 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-[var(--surface)]/90 shadow sm:grid"><ChevronLeft className="h-5 w-5" /></button>
            <button type="button" onClick={() => goTo(active + 1)} aria-label="Next photo" className="absolute right-3 top-1/2 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-[var(--surface)]/90 shadow sm:grid"><ChevronRight className="h-5 w-5" /></button>
            <p className="absolute bottom-3 right-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold text-white tabular-nums" aria-live="polite">{active + 1} / {photos.length}</p>
          </>
        ) : null}
      </div>
      {photos.length > 1 ? (
        <div className="grid grid-cols-5 gap-2 sm:grid-cols-6" role="group" aria-label="Choose photo">
          {photos.map((src, index) => (
            <button key={src} type="button" onClick={() => goTo(index)} aria-label={`Photo ${index + 1}`} aria-current={index === active} className={`overflow-hidden rounded-r4 border-2 bg-[var(--bg-soft)] ${index === active ? 'border-[var(--ink)]' : 'border-transparent'}`}>
              <span className="block aspect-square w-full"><FallbackImg compact src={src} className="h-full w-full object-contain p-1" /></span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ShareLinkButton({ title, url }: { title: string; url: string }) {
  const [copied, setCopied] = useState(false);
  async function share() {
    const link = url || window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title, url: link });
        return;
      }
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // The customer closed the share sheet; nothing to do.
    }
  }
  return (
    <button type="button" onClick={share} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-[var(--line-strong)] px-5 font-semibold text-[var(--ink)] hover:bg-[var(--bg-soft)]">
      {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Share2 className="h-4 w-4" aria-hidden="true" />}
      <span aria-live="polite">{copied ? 'Link copied' : 'Share'}</span>
    </button>
  );
}

type Viewed = { token: string; name: string; thumbnail: string; size: string };
const VIEWED_KEY = 'mp_recently_viewed';

function readViewed(): Viewed[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(VIEWED_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((row) => row && typeof row.token === 'string').slice(0, 12) : [];
  } catch {
    return [];
  }
}

/** Remembers products a customer opened on this phone so they can compare later. */
export function RememberViewed({ item }: { item: Viewed }) {
  useEffect(() => {
    try {
      const rest = readViewed().filter((row) => row.token !== item.token);
      localStorage.setItem(VIEWED_KEY, JSON.stringify([item, ...rest].slice(0, 12)));
    } catch {
      // Private browsing can block storage; the page works without it.
    }
  }, [item]);
  return null;
}

export function RecentlyViewed() {
  const [items, setItems] = useState<Viewed[]>([]);
  useEffect(() => setItems(readViewed()), []);
  if (!items.length) return null;
  return (
    <section aria-labelledby="recent-title" className="mt-10">
      <div className="flex items-end justify-between gap-3">
        <h2 id="recent-title" className="font-display text-2xl font-semibold text-[var(--ink)]">Viewed on this phone</h2>
        <button type="button" className="h-11 px-2 text-sm font-semibold text-[var(--ink-3)] underline-offset-2 hover:underline" onClick={() => { try { localStorage.removeItem(VIEWED_KEY); } catch { /* ignore */ } setItems([]); }}>Clear</button>
      </div>
      <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((item) => (
          <li key={item.token}>
            <Link href={`/p/${item.token}`} className="flex items-center gap-3 rounded-r5 border border-[var(--line)] bg-[var(--surface)] p-2 hover:border-[var(--line-strong)]">
              <span className="h-14 w-14 shrink-0 overflow-hidden rounded-r4 bg-[var(--bg-soft)]"><FallbackImg compact src={item.thumbnail} className="h-full w-full object-contain p-1" /></span>
              <span className="min-w-0">
                <span className="line-clamp-2 text-sm font-semibold text-[var(--ink)]">{item.name}</span>
                {item.size ? <span className="block truncate text-xs text-[var(--ink-4)]">{item.size}</span> : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** An image that quietly turns into a placeholder if the file is missing. */
export function FallbackImg({ src, className, alt = '', eager = false, compact = false }: { src: string; className?: string; alt?: string; eager?: boolean; compact?: boolean }) {
  const [failed, setFailed] = useState(!src);
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    // An image that failed before hydration never fires onError again, so check it here.
    const image = ref.current;
    setFailed(!src || Boolean(image && image.complete && image.naturalWidth === 0));
  }, [src]);
  if (failed) return <span className="grid h-full w-full place-items-center text-xs text-[var(--ink-4)]" aria-hidden={alt ? undefined : true} role={alt ? 'img' : undefined} aria-label={alt || undefined}>{compact ? '' : 'Photo coming soon'}</span>;
  return <img ref={ref} src={publicImage(src)} alt={alt} loading={eager ? 'eager' : 'lazy'} decoding="async" onError={() => setFailed(true)} className={className} />;
}
