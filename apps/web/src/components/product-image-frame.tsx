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
};

export function ProductImageFrame({
  src,
  alt = '',
  className,
  imageClassName,
  label,
  fit = 'contain',
  eager = false,
}: ProductImageFrameProps) {
  return (
    <div className={cn('relative isolate overflow-hidden bg-[#eaf0fa]', className)}>
      {src ? (
        <>
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.72),rgba(226,232,240,0.46))]" />
          <img
            src={src}
            alt={alt}
            loading={eager ? 'eager' : 'lazy'}
            decoding="async"
            fetchPriority={eager ? 'high' : 'auto'}
            className={cn(
              'relative z-10 h-full w-full drop-shadow-2xl transition-transform duration-500',
              fit === 'cover' ? 'object-cover' : 'object-contain p-2',
              imageClassName,
            )}
          />
        </>
      ) : (
        <div className="grid h-full w-full place-items-center bg-gradient-to-br from-[#2563eb] via-[#60a5fa] to-[#f4f7fc] text-white">
          <ImageIcon className="h-10 w-10 opacity-80" strokeWidth={1.4} />
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
