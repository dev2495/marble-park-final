'use client';

import { Suspense } from 'react';
import { QuoteWorkspace } from '../_workspace/quote-workspace';

export default function NewQuotePage() {
  return <Suspense fallback={<div role="status" className="mp-card rounded-r5 p-10 text-center font-semibold text-[var(--ink-4)]">Loading…</div>}><QuoteWorkspace /></Suspense>;
}
