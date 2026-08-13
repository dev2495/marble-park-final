'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { Image as ImageIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

type ProductImageFrameProps = {
  src?: string;
  alt?: string;
  className?: string;
  imageClassName?: string;
  label?: string;
  fit?: 'contain' | 'cover';
  eager?: boolean;
  sizes?: string;
};

export function ProductImageFrame({
  src,
  alt = '',
  className,
  imageClassName,
  label,
  fit = 'contain',
  eager = false,
  sizes = '(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw',
}: ProductImageFrameProps) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(src ? 'loading' : 'error');
  useEffect(() => setStatus(src ? 'loading' : 'error'), [src]);
  const managed = Boolean(src?.includes('/catalogue-images/manual/'));
  const managedSrc = managed && src?.startsWith('/')
    ? `${process.env.NEXT_PUBLIC_CATALOGUE_IMAGE_ORIGIN || ''}${src}`
    : src;

  return (
    <div className={cn('relative isolate overflow-hidden bg-[#eaf0fa]', className)}>
      {src && status !== 'error' ? (
        <>
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.72),rgba(226,232,240,0.46))]" />
          {status === 'loading' ? <div className="absolute inset-0 animate-pulse bg-[linear-gradient(110deg,#e8edf5_8%,#f8fafc_18%,#e8edf5_33%)] bg-[length:200%_100%] motion-reduce:animate-none" aria-hidden="true" /> : null}
          {managed ? <Image
            src={managedSrc || src}
            alt={alt}
            fill
            priority={eager}
            sizes={sizes}
            onLoad={() => setStatus('ready')}
            onError={() => setStatus('error')}
            className={cn('relative z-10 transition-[opacity,transform] duration-200 motion-reduce:transition-none', status === 'ready' ? 'opacity-100' : 'opacity-0', fit === 'cover' ? 'object-cover' : 'object-contain p-2', imageClassName)}
          /> : <img
            src={src}
            alt={alt}
            loading={eager ? 'eager' : 'lazy'}
            decoding="async"
            fetchPriority={eager ? 'high' : 'auto'}
            onLoad={() => setStatus('ready')}
            onError={() => setStatus('error')}
            className={cn('relative z-10 h-full w-full transition-[opacity,transform] duration-200 motion-reduce:transition-none', status === 'ready' ? 'opacity-100' : 'opacity-0', fit === 'cover' ? 'object-cover' : 'object-contain p-2', imageClassName)}
          />}
        </>
      ) : (
        <div className="grid h-full w-full place-items-center bg-gradient-to-br from-[#eef2f7] to-[#dde5ef] px-5 text-center text-[#596779]">
          <div>
            <ImageIcon className="mx-auto h-9 w-9 opacity-70" strokeWidth={1.4} />
            <span className="mt-2 block text-[10px] font-bold uppercase tracking-[0.12em]">Image unavailable</span>
          </div>
        </div>
      )}
      {label && (
        <div className="absolute left-4 top-4 z-20 rounded-full bg-white/88 px-3 py-1 text-xs font-medium uppercase tracking-widest text-[#435062] shadow-sm backdrop-blur">
          {label}
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 z-20 ring-1 ring-inset ring-white/35" />
    </div>
  );
}
