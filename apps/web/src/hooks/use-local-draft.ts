'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_VERSION = 'v1';
const PREFIX = 'mp:draft';

function storageKey(key: string) {
  return `${PREFIX}:${STORAGE_VERSION}:${key}`;
}

type Stored<T> = { savedAt: number; value: T };

function readStored<T>(key: string): Stored<T> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stored<T>;
    if (!parsed || typeof parsed.savedAt !== 'number' || !('value' in parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Keeps a copy of a form in this browser so a reload, a crash or a dropped
 * session does not lose it.
 *
 *   const draft = useLocalDraft(`quote-new:${userId}`, form, { enabled: dirty });
 *   {draft.restored && (
 *     <Banner>
 *       A draft from {time(draft.savedAt)} was found.
 *       <Button onClick={() => { setForm(draft.restored!); draft.dismissRestored(); }}>Restore</Button>
 *       <Button variant="ghost" onClick={draft.clear}>Discard</Button>
 *     </Banner>
 *   )}
 *   // after a successful save: draft.clear()
 *
 * - restored: the draft found when the page opened (null when none). The hook
 *   never applies it by itself; the page decides.
 * - The key is versioned in storage, so a change in form shape can bump
 *   STORAGE_VERSION and old drafts are ignored.
 * - Writes are debounced (default 600ms) and only happen while enabled.
 *   Until the user restores or dismisses, the old draft is not overwritten.
 */
export function useLocalDraft<T>(
  key: string,
  value: T,
  opts?: { enabled?: boolean; debounceMs?: number },
): { restored: T | null; savedAt: number | null; clear(): void; dismissRestored(): void } {
  const enabled = opts?.enabled ?? true;
  const debounceMs = opts?.debounceMs ?? 600;

  const [restored, setRestored] = useState<T | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const pendingChoiceRef = useRef(false);
  const loadedKeyRef = useRef<string | null>(null);

  // Load once per key on the client.
  useEffect(() => {
    if (loadedKeyRef.current === key) return;
    loadedKeyRef.current = key;
    const found = readStored<T>(key);
    if (found) {
      pendingChoiceRef.current = true;
      setRestored(found.value);
      setSavedAt(found.savedAt);
    } else {
      pendingChoiceRef.current = false;
      setRestored(null);
      setSavedAt(null);
    }
  }, [key]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    if (pendingChoiceRef.current) return;
    const handle = window.setTimeout(() => {
      try {
        const now = Date.now();
        const payload: Stored<T> = { savedAt: now, value };
        window.localStorage.setItem(storageKey(key), JSON.stringify(payload));
        setSavedAt(now);
      } catch {
        // Storage full or blocked (private mode): drafts are best effort.
      }
    }, debounceMs);
    return () => window.clearTimeout(handle);
  }, [key, value, enabled, debounceMs]);

  const clear = useCallback(() => {
    pendingChoiceRef.current = false;
    try {
      window.localStorage.removeItem(storageKey(key));
    } catch {
      /* ignore */
    }
    setRestored(null);
    setSavedAt(null);
  }, [key]);

  const dismissRestored = useCallback(() => {
    // The page has taken (or chosen to ignore) the old draft: from now on the
    // current form is what gets saved.
    pendingChoiceRef.current = false;
    setRestored(null);
  }, []);

  return { restored, savedAt, clear, dismissRestored };
}

export default useLocalDraft;
