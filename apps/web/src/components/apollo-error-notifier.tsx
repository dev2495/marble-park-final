'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Copy, X } from 'lucide-react';
import { APOLLO_ERROR_EVENT, ApolloDiagnostic } from '@/lib/apollo-errors';

function diagnosticText(error: ApolloDiagnostic) {
  return [
    error.operation ? `Operation: ${error.operation}` : '',
    error.code ? `Code: ${error.code}` : '',
    error.path ? `Field: ${error.path}` : '',
    error.requestId ? `Reference: ${error.requestId}` : '',
    `Message: ${error.message}`,
  ].filter(Boolean).join('\n');
}

export function ApolloErrorNotifier() {
  const [error, setError] = useState<ApolloDiagnostic | null>(null);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const handle = (event: Event) => {
      const detail = (event as CustomEvent<ApolloDiagnostic>).detail;
      setError(detail);
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => setError(null), 15000);
    };
    window.addEventListener(APOLLO_ERROR_EVENT, handle);
    return () => {
      window.removeEventListener(APOLLO_ERROR_EVENT, handle);
      if (timeout) clearTimeout(timeout);
    };
  }, []);

  if (!error) return null;
  return (
    <aside role="alert" aria-live="assertive" className="fixed right-4 top-4 z-[100] w-[min(28rem,calc(100vw-2rem))] border border-red-300 bg-white p-4 text-red-950 shadow-xl dark:bg-zinc-950">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-700" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">{error.title}</p>
          <p className="mt-1 text-xs leading-5 text-red-800 dark:text-red-200">{error.message}</p>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-semibold text-red-700 dark:text-red-300">
            {error.operation ? <span>Action: {error.operation}</span> : null}
            {error.code ? <span>Code: {error.code}</span> : null}
            {error.path ? <span>Field: {error.path}</span> : null}
            {error.requestId ? <span>Ref: {error.requestId}</span> : null}
          </div>
        </div>
        <button type="button" className="grid h-8 w-8 shrink-0 place-items-center border border-red-200" onClick={() => setError(null)} aria-label="Dismiss error"><X className="h-4 w-4" /></button>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-red-100 pt-3">
        <p className="text-[11px] text-red-700 dark:text-red-300">{error.hint}</p>
        <button type="button" className="inline-flex h-8 shrink-0 items-center gap-1.5 border border-red-200 px-2.5 text-xs font-semibold" onClick={() => void navigator.clipboard?.writeText(diagnosticText(error))}><Copy className="h-3.5 w-3.5" />Copy</button>
      </div>
    </aside>
  );
}
