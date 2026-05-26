'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, BookOpen } from 'lucide-react';
import { HELP_TOPICS, findHelpTopic } from '@/components/help/help-content';

export default function HelpTopicPage() {
  const params = useParams<{ topic: string }>();
  const topic = findHelpTopic(params?.topic || '') || HELP_TOPICS[0];

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink-2)]">
      <header className="border-b border-[var(--line)] bg-[var(--surface)]">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-4 lg:px-8">
          <Link href="/help" className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--ink)] hover:text-[var(--brand-700)]">
            <ArrowLeft className="h-4 w-4" /> All topics
          </Link>
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-[var(--brand-600)]" />
            <span className="text-sm font-semibold text-[var(--ink)]">Help Center</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8 lg:px-8">
        <section className="rounded-r5 border border-[var(--line)] bg-[var(--surface)] p-7 shadow-sm-soft">
          <div className="flex items-start gap-4">
            <div className="grid h-12 w-12 place-items-center rounded-r3 bg-[var(--brand-50)] text-[var(--brand-700)]">
              <topic.icon className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-[var(--brand-600)]">{topic.tagline}</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-[var(--ink)]">{topic.title}</h1>
            </div>
          </div>

          <div className="mt-6">
            <topic.Illustration />
          </div>

          <section className="mt-8">
            <h2 className="text-base font-bold text-[var(--ink)]">How it works</h2>
            <ol className="mt-4 space-y-3">
              {topic.steps.map((step, index) => (
                <li key={step.title} className="flex gap-3 rounded-r4 border border-[var(--line)] bg-[var(--bg-soft)]/40 p-4">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--brand-50)] text-sm font-bold text-[var(--brand-700)]">
                    {index + 1}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-[var(--ink)]">{step.title}</p>
                    <p className="mt-1 text-sm leading-6 text-[var(--ink-3)]">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {topic.faq?.length ? (
            <section className="mt-8">
              <h2 className="text-base font-bold text-[var(--ink)]">FAQ</h2>
              <div className="mt-4 space-y-3">
                {topic.faq.map((f) => (
                  <details key={f.q} className="rounded-r4 border border-[var(--line)] bg-[var(--surface)] p-4 text-sm">
                    <summary className="cursor-pointer text-sm font-bold text-[var(--ink)]">{f.q}</summary>
                    <p className="mt-2 text-sm leading-6 text-[var(--ink-3)]">{f.a}</p>
                  </details>
                ))}
              </div>
            </section>
          ) : null}

          {topic.glossary?.length ? (
            <section className="mt-8">
              <h2 className="text-base font-bold text-[var(--ink)]">Glossary</h2>
              <dl className="mt-4 space-y-2">
                {topic.glossary.map((g) => (
                  <div key={g.term} className="rounded-r4 border border-[var(--line)] bg-[var(--bg-soft)]/40 p-4">
                    <dt className="text-sm font-bold uppercase tracking-widest text-[var(--ink)]">{g.term}</dt>
                    <dd className="mt-1 text-sm leading-6 text-[var(--ink-3)]">{g.meaning}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}

          {topic.relatedTopicIds?.length ? (
            <section className="mt-8">
              <h2 className="text-base font-bold text-[var(--ink)]">Related</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {topic.relatedTopicIds.map((id) => {
                  const r = findHelpTopic(id);
                  if (!r) return null;
                  return (
                    <Link
                      key={id}
                      href={`/help/${id}`}
                      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--ink-2)] transition-colors hover:bg-[var(--bg-soft)]"
                    >
                      <r.icon className="h-3.5 w-3.5" strokeWidth={1.6} />
                      {r.title}
                    </Link>
                  );
                })}
              </div>
            </section>
          ) : null}
        </section>
      </main>
    </div>
  );
}
