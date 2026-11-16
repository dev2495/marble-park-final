'use client';

import { Suspense } from 'react';
import { useParams } from 'next/navigation';
import { QuoteWorkspace } from '../_workspace/quote-workspace';

export default function QuoteDetailPage() {
  const params = useParams();
  const id = String(params.id);
  return <Suspense fallback={<div role="status" className="mp-card rounded-r5 p-10 text-center font-semibold text-[var(--ink-4)]">Loading quote…</div>}><QuoteWorkspace key={id} quoteId={id} /></Suspense>;
}
