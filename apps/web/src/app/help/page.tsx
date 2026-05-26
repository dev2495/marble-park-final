'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowLeft, BookOpen, Search } from 'lucide-react';
import { HELP_TOPICS } from '@/components/help/help-content';

// Full help index. Lives outside /dashboard so it's reachable even without
// a session (e.g. as a public docs surface later if needed).
export default function HelpIndexPage() {
  const [query, setQuery] = useState('');
  const filtered = HELP_TOPICS.filter((t) => {
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return (
      t.title.toLowerCase().includes(q) ||
      t.tagline.toLowerCase().includes(q) ||
      t.steps.some((s) => s.title.toLowerCase().includes(q) || s.body.toLowerCase().includes(q))
    );
  });

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink-2)]">
      <header className="border-b border-[var(--line)] bg-[var(--surface)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 lg:px-8">
          <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--ink)] hover:text-[var(--brand-700)]">
            <ArrowLeft className="h-4 w-4" /> Back to workspace
          </Link>
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-[var(--brand-600)]" />
            <span className="text-sm font-semibold text-[var(--ink)]">Help Center</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 lg:px-8">
        <section className="rounded-r5 border border-[var(--line)] bg-gradient-to-br from-[var(--brand-50)] via-white to-[var(--brand-50)]/40 p-7 shadow-sm-soft">
          <p className="text-xs font-bold uppercase tracking-widest text-[var(--brand-600)]">Help & how-to</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-[var(--ink)]">Run Marble Park end-to-end</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--ink-3)]">
            Short, illustrated guides for every part of the workspace. Click the help icon on any page to open the
            relevant topic, or browse the full index below.
          </p>

          <div className="mt-5 flex h-11 items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 shadow-sm-soft">
            <Search className="h-4 w-4 text-[var(--ink-4)]" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search help — e.g. dispatch, refunds, GST, portal…"
              className="w-full bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-5)]"
            />
          </div>
        </section>

        <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((t) => (
            <Link
              key={t.id}
              href={`/help/${t.id}`}
              className="group flex flex-col gap-3 rounded-r4 border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm-soft transition hover:-translate-y-0.5 hover:border-[var(--brand-300)] hover:shadow-[0_18px_40px_-22px_rgba(15,23,42,0.4)]"
            >
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-r3 bg-[var(--brand-50)] text-[var(--brand-700)]">
                  <t.icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--ink-5)]">{t.steps.length} step guide</p>
                  <h3 className="truncate text-base font-bold text-[var(--ink)]">{t.title}</h3>
                </div>
              </div>
              <p className="text-xs leading-5 text-[var(--ink-3)]">{t.tagline}</p>
              <span className="mt-auto text-xs font-semibold text-[var(--brand-700)] group-hover:underline">Open guide →</span>
            </Link>
          ))}
          {filtered.length === 0 ? (
            <p className="col-span-full rounded-r4 border border-dashed border-[var(--line)] bg-[var(--surface)] p-10 text-center text-sm text-[var(--ink-4)]">
              Nothing matches "{query}". Try a different keyword or browse the index.
            </p>
          ) : null}
        </section>
      </main>
    </div>
  );
}
