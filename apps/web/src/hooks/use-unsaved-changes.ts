'use client';

import { useEffect, useRef } from 'react';

const DEFAULT_MESSAGE = 'You have changes that are not saved. Leave this page and lose them?';

/**
 * Warns before the user loses unsaved work.
 *
 * - Browser close / reload / typed URL: native beforeunload prompt.
 * - In-app link clicks (any <a href> to another page of this site, including
 *   Next <Link>): a confirm() before the navigation goes ahead.
 * - Browser back / forward: a confirm(); if the user stays, the history entry
 *   is put back so the page does not change.
 *
 * Pass dirty=false (for example right after a successful save) to switch the
 * guard off before you navigate away in code with router.push.
 */
export function useUnsavedChanges(dirty: boolean, message: string = DEFAULT_MESSAGE): void {
  const dirtyRef = useRef(dirty);
  const messageRef = useRef(message);
  dirtyRef.current = dirty;
  messageRef.current = message;

  useEffect(() => {
    if (!dirty || typeof window === 'undefined') return;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      // Older browsers need returnValue set to show the prompt.
      event.returnValue = messageRef.current;
      return messageRef.current;
    };

    const onClick = (event: MouseEvent) => {
      if (!dirtyRef.current) return;
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target as Element | null;
      const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.target && anchor.target !== '_self') return;
      if (anchor.hasAttribute('download')) return;
      if (anchor.dataset.skipUnsavedGuard !== undefined) return;
      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      // Same page, only the hash changes: no data loss.
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (!window.confirm(messageRef.current)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
    };

    // Back / forward. Push a sentinel entry so the first back press lands on
    // it and we can ask before really leaving.
    // Copy the router's own state into the sentinel so Next.js treats the
    // entry as one of its own (otherwise it reloads the page on popstate).
    const baseState = (window.history.state ?? {}) as Record<string, unknown>;
    const sentinel = { ...baseState, __mpUnsavedGuard: true };
    window.history.pushState(sentinel, '', window.location.href);
    let leaving = false;
    const onPopState = () => {
      if (leaving) return;
      if (!dirtyRef.current) {
        leaving = true;
        window.history.back();
        return;
      }
      if (window.confirm(messageRef.current)) {
        leaving = true;
        window.history.back();
      } else {
        window.history.pushState(sentinel, '', window.location.href);
      }
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('popstate', onPopState);
      // The sentinel entry is left in place on purpose: calling history.back()
      // here would race with a router.push made right after saving. It points
      // at the same address, so the only cost is one extra back press.
    };
  }, [dirty]);
}

export default useUnsavedChanges;
