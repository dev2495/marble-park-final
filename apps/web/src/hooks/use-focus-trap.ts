'use client';

import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function getFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
    if (el.getAttribute('aria-hidden') === 'true') return false;
    if (el.closest('[inert]')) return false;
    // Skip hidden elements (display:none / not rendered).
    return el.offsetParent !== null || el.getClientRects().length > 0;
  });
}

// Stack, so a dialog opened from a dialog only the top one handles keys.
const trapStack: symbol[] = [];

export type FocusTrapOptions = {
  /** Called on Escape. Leave out to ignore Escape. */
  onEscape?: () => void;
  /** Element to focus first. Defaults to [data-autofocus], then the first field, then the container. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** Put focus back where it was when the trap ends (default true). */
  returnFocus?: boolean;
  /** Lock page scroll while active (default true). */
  lockScroll?: boolean;
};

/**
 * Keeps keyboard focus inside a popup while it is open: Tab and Shift+Tab
 * wrap, Escape closes, first field gets focus on open, and focus returns to
 * the button that opened it on close.
 *
 *   const ref = useRef<HTMLDivElement>(null);
 *   useFocusTrap(ref, open, { onEscape: () => setOpen(false) });
 *   <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="...">...
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
  options: FocusTrapOptions = {},
): void {
  const optsRef = useRef(options);
  optsRef.current = options;

  useEffect(() => {
    if (!active || typeof document === 'undefined') return;
    const id = Symbol('focus-trap');
    trapStack.push(id);
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const { lockScroll = true } = optsRef.current;
    const prevOverflow = document.body.style.overflow;
    if (lockScroll) document.body.style.overflow = 'hidden';

    // Wait a frame so portal content is in the DOM and visible.
    const raf = window.requestAnimationFrame(() => {
      const root = containerRef.current;
      if (!root) return;
      if (root.contains(document.activeElement)) return;
      const explicit = optsRef.current.initialFocus?.current;
      const marked = root.querySelector<HTMLElement>('[data-autofocus], [autofocus]');
      const target = explicit ?? marked ?? getFocusable(root)[0] ?? root;
      if (target === root && !root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: false });
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (trapStack[trapStack.length - 1] !== id) return;
      const root = containerRef.current;
      if (!root) return;
      if (event.key === 'Escape') {
        if (optsRef.current.onEscape) {
          event.stopPropagation();
          optsRef.current.onEscape();
        }
        return;
      }
      if (event.key !== 'Tab') return;
      const items = getFocusable(root);
      if (items.length === 0) {
        event.preventDefault();
        root.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement as HTMLElement | null;
      if (event.shiftKey) {
        if (current === first || !root.contains(current)) {
          event.preventDefault();
          last.focus();
        }
      } else if (current === last || !root.contains(current)) {
        event.preventDefault();
        first.focus();
      }
    };

    // If focus escapes (for example a click on the page behind), pull it back.
    const onFocusIn = (event: FocusEvent) => {
      if (trapStack[trapStack.length - 1] !== id) return;
      const root = containerRef.current;
      if (!root || root.contains(event.target as Node)) return;
      // Allow focus in other portals that belong to this popup (menus, pickers).
      const t = event.target as HTMLElement | null;
      if (t?.closest?.('[data-radix-popper-content-wrapper], [data-focus-trap-allow]')) return;
      const items = getFocusable(root);
      (items[0] ?? root).focus();
    };

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      window.cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocusIn);
      const idx = trapStack.lastIndexOf(id);
      if (idx >= 0) trapStack.splice(idx, 1);
      if (lockScroll && trapStack.length === 0) document.body.style.overflow = prevOverflow;
      if (optsRef.current.returnFocus !== false && previouslyFocused && document.contains(previouslyFocused)) {
        // After the popup unmounts.
        window.setTimeout(() => previouslyFocused.focus?.({ preventScroll: true }), 0);
      }
    };
  }, [active, containerRef]);
}

export default useFocusTrap;
