'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { RotateCcw, Home, AlertTriangle } from 'lucide-react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('Top-level error boundary tripped', error);
  }, [error]);

  return (
    <div className="grid min-h-screen place-items-center bg-[var(--bg)] px-4 text-[var(--ink-2)]">
      <div className="w-full max-w-lg rounded-r5 border border-[var(--line)] bg-[var(--surface)] p-8 text-center shadow-sm-soft">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[var(--danger-bg)] text-[var(--danger)]">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <h1 className="mt-5 text-2xl font-bold tracking-tight text-[var(--ink)]">Something broke on this page</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--ink-3)]">
          We've logged the error so the team can take a look. Try reloading the page — your data is safe.
        </p>
        {error?.digest ? (
          <p className="mt-4 inline-block rounded-md border border-[var(--line)] bg-[var(--bg-soft)] px-3 py-1.5 text-[10px] font-mono text-[var(--ink-4)]">
            Reference: {error.digest}
          </p>
        ) : null}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--brand-600)] px-4 text-sm font-semibold text-white shadow-sm hover:bg-[var(--brand-700)]"
          >
            <RotateCcw className="h-4 w-4" /> Try again
          </button>
          <Link
            href="/dashboard"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--line)] bg-[var(--surface)] px-4 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--bg-soft)]"
          >
            <Home className="h-4 w-4" /> Back to workspace
          </Link>
        </div>
      </div>
    </div>
  );
}
