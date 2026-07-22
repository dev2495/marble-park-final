'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

const FALLBACK_LOGO = '/brand/marble-park-logo-square.png?v=20260722-2';

function versionedLogo(src?: string) {
  const value = src || '/brand/marble-park-logo-square.png';
  if (/^\/brand\/marble-park-logo(?:-square)?\.png$/.test(value)) {
    return `${value}?v=20260722-2`;
  }
  return value;
}

export function CompanyLogo({
  src = '/brand/marble-park-logo-square.png',
  name = 'Marble Park',
  className = '',
  imageClassName = '',
}: {
  src?: string;
  name?: string;
  className?: string;
  imageClassName?: string;
}) {
  const requestedSrc = versionedLogo(src);
  const [resolvedSrc, setResolvedSrc] = useState(requestedSrc);

  useEffect(() => setResolvedSrc(requestedSrc), [requestedSrc]);

  return <span className={cn('grid shrink-0 place-items-center overflow-hidden rounded-md border border-black/10 bg-white', className)}>
    <img
      src={resolvedSrc}
      alt={`${name} logo`}
      className={cn('h-full w-full object-contain', imageClassName)}
      decoding="async"
      onError={() => {
        if (resolvedSrc !== FALLBACK_LOGO) setResolvedSrc(FALLBACK_LOGO);
      }}
    />
  </span>;
}
