'use client';

import { useEffect } from 'react';

export const TITLE_SUFFIX = 'Marble Park';
const DEFAULT_TITLE = `${TITLE_SUFFIX} | Premium Bath Solutions`;

// A page-level title wins over the layout's menu name. React runs child
// effects before parent effects, so the page registers first and the layout
// sees it.
let pageTitle: string | null = null;

function apply(title: string | null | undefined) {
  const clean = (title || '').trim();
  document.title = clean ? `${clean} | ${TITLE_SUFFIX}` : DEFAULT_TITLE;
}

/**
 * For pages that know a better title than the menu name:
 *   useDocumentTitle(quote ? `Quote ${quote.quoteNumber}` : null)
 * Pass null/undefined to fall back to the menu name.
 * Tabs read "<title> | Marble Park".
 */
export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const clean = (title || '').trim();
    if (!clean) return;
    pageTitle = clean;
    apply(clean);
    return () => {
      if (pageTitle === clean) pageTitle = null;
    };
  }, [title]);
}

/** Used once, by the dashboard layout, with the menu name of the current page. */
export function useShellDocumentTitle(title: string | null | undefined, routeKey: string): void {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!pageTitle) apply(title);
    // Next streams the root metadata <title> after hydration and on route
    // changes, which resets the tab to the default. Put ours back when it does.
    const wanted = () => (pageTitle ? `${pageTitle} | ${TITLE_SUFFIX}` : (title || '').trim() ? `${(title || '').trim()} | ${TITLE_SUFFIX}` : DEFAULT_TITLE);
    const observer = new MutationObserver(() => {
      const next = wanted();
      if (document.title !== next) document.title = next;
    });
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, [title, routeKey]);
}

export default useDocumentTitle;
