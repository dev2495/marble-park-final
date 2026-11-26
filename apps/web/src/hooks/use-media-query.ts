'use client';

import { useEffect, useState } from 'react';

/**
 * true while the media query matches. Starts false on the server and first
 * client render, then updates.
 *   const isPhone = useMediaQuery('(max-width: 1023px)');
 *   const coarse = useMediaQuery('(pointer: coarse)');
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/** true when the person asked the system to reduce motion. */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

export default useMediaQuery;
