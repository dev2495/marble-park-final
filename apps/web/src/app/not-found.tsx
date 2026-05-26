import Link from 'next/link';
import { Home, Compass } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center bg-[var(--bg)] px-4 text-[var(--ink-2)]">
      <div className="w-full max-w-lg rounded-r5 border border-[var(--line)] bg-[var(--surface)] p-8 text-center shadow-sm-soft">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[var(--brand-50)] text-[var(--brand-700)]">
          <Compass className="h-6 w-6" />
        </div>
        <h1 className="mt-5 text-3xl font-bold tracking-tight text-[var(--ink)]">404 — not found</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--ink-3)]">
          We couldn't find that page. It may have been moved or never existed. Use the workspace nav to find what you need.
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link
            href="/dashboard"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--brand-600)] px-4 text-sm font-semibold text-white shadow-sm hover:bg-[var(--brand-700)]"
          >
            <Home className="h-4 w-4" /> Back to workspace
          </Link>
          <Link
            href="/help"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--line)] bg-[var(--surface)] px-4 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--bg-soft)]"
          >
            Open help
          </Link>
        </div>
      </div>
    </div>
  );
}
