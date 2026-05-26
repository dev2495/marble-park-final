'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { HelpCircle, Search, X } from 'lucide-react';
import { HELP_TOPICS, type HelpTopic, findHelpTopic } from './help-content';
import { cn } from '@/lib/utils';

type HelpButtonProps = {
  topicId?: string;
  label?: string;
  className?: string;
  variant?: 'topbar' | 'inline' | 'fab';
};

// Surfaced on every page. Tapping it opens a slide-over with the topic for the
// current page (plus a searchable index for the rest of the help library).
export function HelpButton({ topicId, label, className, variant = 'topbar' }: HelpButtonProps) {
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string>(topicId || 'overview');
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (open) setActiveId(topicId || 'overview');
  }, [open, topicId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const topic = findHelpTopic(activeId) || HELP_TOPICS[0];
  const filteredTopics = useMemo(() => {
    if (!query.trim()) return HELP_TOPICS;
    const q = query.trim().toLowerCase();
    return HELP_TOPICS.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.tagline.toLowerCase().includes(q) ||
        t.steps.some((s) => s.title.toLowerCase().includes(q) || s.body.toLowerCase().includes(q)),
    );
  }, [query]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open help"
        title="Open help"
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-3)] shadow-sm-soft transition-colors hover:bg-[var(--bg-soft)] hover:text-[var(--ink)]',
          variant === 'topbar' && 'h-9 w-9 justify-center',
          variant === 'inline' && 'h-8 px-3 text-xs font-semibold',
          variant === 'fab' && 'fixed bottom-6 right-6 z-30 h-12 w-12 justify-center shadow-[0_18px_40px_-12px_rgba(15,23,42,0.45)]',
          className,
        )}
      >
        <HelpCircle className={cn(variant === 'fab' ? 'h-5 w-5' : 'h-4 w-4')} />
        {label && variant !== 'topbar' && variant !== 'fab' ? <span>{label}</span> : null}
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label="Help">
          <button
            type="button"
            aria-label="Close help"
            className="flex-1 bg-slate-950/45 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <aside className="relative flex h-full w-full max-w-[36rem] flex-col overflow-hidden border-l border-[var(--line)] bg-[var(--surface)] shadow-[0_30px_80px_-30px_rgba(15,23,42,0.65)]">
            <header className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[var(--brand-50)] text-[var(--brand-700)]">
                  <HelpCircle className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--ink-5)]">Help</p>
                  <h2 className="truncate text-base font-bold text-[var(--ink)]">{topic.title}</h2>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="grid h-8 w-8 place-items-center rounded-md border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-3)] hover:bg-[var(--bg-soft)]"
                aria-label="Close help"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="flex h-full min-h-0">
              {/* Sidebar — searchable topic list */}
              <nav className="hidden w-56 shrink-0 flex-col border-r border-[var(--line)] bg-[var(--bg-soft)]/40 sm:flex">
                <div className="border-b border-[var(--line)] px-3 py-3">
                  <div className="flex h-9 items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2.5">
                    <Search className="h-3.5 w-3.5 text-[var(--ink-4)]" />
                    <input
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search help…"
                      className="w-full bg-transparent text-xs text-[var(--ink)] outline-none placeholder:text-[var(--ink-5)]"
                    />
                  </div>
                </div>
                <ul className="flex-1 overflow-y-auto px-2 py-2 custom-scrollbar">
                  {filteredTopics.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => setActiveId(t.id)}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-medium transition-colors',
                          activeId === t.id
                            ? 'bg-[var(--brand-50)] text-[var(--brand-800)]'
                            : 'text-[var(--ink-3)] hover:bg-[var(--bg-soft)] hover:text-[var(--ink)]',
                        )}
                      >
                        <t.icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.6} />
                        <span className="truncate">{t.title}</span>
                      </button>
                    </li>
                  ))}
                  {filteredTopics.length === 0 ? (
                    <li className="px-2 py-3 text-xs text-[var(--ink-5)]">No topics match.</li>
                  ) : null}
                </ul>
              </nav>

              {/* Content */}
              <div className="flex-1 overflow-y-auto px-5 py-5 custom-scrollbar">
                <p className="text-xs font-semibold uppercase tracking-widest text-[var(--brand-600)]">{topic.tagline}</p>
                <h3 className="mt-1 text-2xl font-bold tracking-tight text-[var(--ink)]">{topic.title}</h3>

                <div className="mt-4">
                  <topic.Illustration />
                </div>

                <section className="mt-6">
                  <h4 className="text-sm font-bold text-[var(--ink)]">How it works</h4>
                  <ol className="mt-3 space-y-2">
                    {topic.steps.map((step, index) => (
                      <li key={step.title} className="flex gap-3 rounded-r4 border border-[var(--line)] bg-[var(--bg-soft)]/40 p-3">
                        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--brand-50)] text-xs font-bold text-[var(--brand-700)]">
                          {index + 1}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-[var(--ink)]">{step.title}</p>
                          <p className="mt-1 text-xs leading-5 text-[var(--ink-3)]">{step.body}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>

                {topic.faq?.length ? (
                  <section className="mt-6">
                    <h4 className="text-sm font-bold text-[var(--ink)]">Common questions</h4>
                    <div className="mt-3 space-y-2">
                      {topic.faq.map((f) => (
                        <details key={f.q} className="group rounded-r4 border border-[var(--line)] bg-[var(--surface)] p-3 text-sm">
                          <summary className="cursor-pointer text-sm font-semibold text-[var(--ink)]">{f.q}</summary>
                          <p className="mt-2 text-xs leading-5 text-[var(--ink-3)]">{f.a}</p>
                        </details>
                      ))}
                    </div>
                  </section>
                ) : null}

                {topic.glossary?.length ? (
                  <section className="mt-6">
                    <h4 className="text-sm font-bold text-[var(--ink)]">Glossary</h4>
                    <dl className="mt-3 space-y-2">
                      {topic.glossary.map((g) => (
                        <div key={g.term} className="rounded-r4 border border-[var(--line)] bg-[var(--bg-soft)]/40 p-3">
                          <dt className="text-xs font-bold uppercase tracking-widest text-[var(--ink)]">{g.term}</dt>
                          <dd className="mt-1 text-xs leading-5 text-[var(--ink-3)]">{g.meaning}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                ) : null}

                {topic.relatedTopicIds?.length ? (
                  <section className="mt-6">
                    <h4 className="text-sm font-bold text-[var(--ink)]">Related</h4>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {topic.relatedTopicIds.map((id) => {
                        const r = findHelpTopic(id);
                        if (!r) return null;
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => setActiveId(id)}
                            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1 text-xs font-medium text-[var(--ink-2)] transition-colors hover:bg-[var(--bg-soft)]"
                          >
                            <r.icon className="h-3 w-3" strokeWidth={1.6} />
                            {r.title}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                ) : null}

                <div className="mt-7 flex items-center justify-between gap-2 border-t border-[var(--line)] pt-4">
                  <Link
                    href={`/help/${topic.id}`}
                    onClick={() => setOpen(false)}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--brand-700)] hover:underline"
                  >
                    Open the full help page →
                  </Link>
                  <Link
                    href="/help"
                    onClick={() => setOpen(false)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--ink-3)] hover:text-[var(--ink)]"
                  >
                    All topics
                  </Link>
                </div>
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
