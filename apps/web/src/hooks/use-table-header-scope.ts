'use client';

import { useEffect, type RefObject } from 'react';

/**
 * Gives every table header cell inside `root` a scope, so screen readers
 * announce the column (and row) name with each cell:
 *   thead th            -> scope="col"
 *   tbody / tfoot th    -> scope="row"
 * Only fills in cells that have no scope yet, and keeps watching for tables
 * that render later. React never sets these attributes on cells written
 * without them, so there is nothing to fight with.
 */
export function useTableHeaderScope(root: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const node = root.current;
    if (!node || typeof MutationObserver === 'undefined') return;
    let frame = 0;
    const apply = () => {
      frame = 0;
      node.querySelectorAll<HTMLTableCellElement>('th:not([scope])').forEach((th) => {
        const section = th.parentElement?.parentElement?.tagName;
        th.setAttribute('scope', section === 'THEAD' ? 'col' : 'row');
      });
    };
    apply();
    const observer = new MutationObserver(() => {
      if (!frame) frame = window.requestAnimationFrame(apply);
    });
    observer.observe(node, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [root]);
}

export default useTableHeaderScope;
