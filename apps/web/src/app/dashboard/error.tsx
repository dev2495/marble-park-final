'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, RotateCcw, Home } from 'lucide-react';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('Dashboard route error boundary', error);
  }, [error]);

  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="w-full max-w-md rounded-r5 border border-[var(--line)] bg-[var(--surface)] p-7 text-center shadow-sm-soft">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[var(--danger-bg)] text-[var(--danger)]">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <h2 className="mt-4 text-xl font-bold tracking-tight text-[var(--ink)]">Couldn't load this view</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--ink-3)]">
          One of the queries on this page failed. The rest of the workspace still works — try again or head back to the command center.
        </p>
        {error?.digest ? (
          <p className="mt-3 inline-block rounded-md border border-[var(--line)] bg-[var(--bg-soft)] px-2.5 py-1 text-[10px] font-mono text-[var(--ink-4)]">
            {error.digest}
          </p>
        ) : null}
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[var(--brand-600)] px-4 text-sm font-semibold text-white shadow-sm hover:bg-[var(--brand-700)]"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Retry
          </button>
          <Link
            href="/dashboard"
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[var(--line)] bg-[var(--surface)] px-4 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--bg-soft)]"
          >
            <Home className="h-3.5 w-3.5" /> Command center
          </Link>
        </div>
      </div>
    </div>
  );
}
