'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Stops double clicks from posting twice.
 *
 *   const busy = useBusyAction();
 *   <Button loading={busy.isBusy('save')} onClick={() => busy.run('save', save)}>Save</Button>
 *
 * - run(key, fn): if any action is already running it returns undefined and
 *   does not call fn. Otherwise it runs fn and returns its result. Errors are
 *   re-thrown so the caller can show them.
 * - isBusy(): is anything running. isBusy('save'): is that action running.
 */
export function useBusyAction(): {
  busyKey: string | null;
  isBusy(key?: string): boolean;
  run<T>(key: string, fn: () => Promise<T>): Promise<T | undefined>;
} {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  // A ref, so two clicks inside the same frame are still caught.
  const lockRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const run = useCallback(async <T,>(key: string, fn: () => Promise<T>): Promise<T | undefined> => {
    if (lockRef.current !== null) return undefined;
    lockRef.current = key;
    setBusyKey(key);
    try {
      return await fn();
    } finally {
      lockRef.current = null;
      if (mountedRef.current) setBusyKey(null);
    }
  }, []);

  const isBusy = useCallback(
    (key?: string) => (key === undefined ? busyKey !== null : busyKey === key),
    [busyKey],
  );

  return { busyKey, isBusy, run };
}

export default useBusyAction;
