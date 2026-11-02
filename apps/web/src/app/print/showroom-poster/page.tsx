'use client';

import Link from 'next/link';
import { gql, useQuery } from '@apollo/client';
import { ArrowLeft, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryErrorBanner } from '@/components/query-state';

const POSTER = gql`query ShowroomPoster { showroomPoster }`;

// One A4 poster per showroom wall: customers scan it once, then scan any existing shelf sticker.
export default function ShowroomPosterPage() {
  const { data, loading, error, refetch } = useQuery(POSTER, { fetchPolicy: 'network-only' });
  const poster = data?.showroomPoster;
  const company = poster?.showroom?.companyName || 'Marble Park';
  return (
    <main className="min-h-screen bg-[#f4f4f5] p-4 text-[#18181b] print:bg-white print:p-0">
      <style>{'@page { size: A4 portrait; margin: 0; } @media print { .no-print { display: none !important; } }'}</style>
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center justify-between gap-3">
        <Button asChild variant="outline"><Link href="/dashboard/products"><ArrowLeft className="mr-2 h-4 w-4" />Back to catalogue</Link></Button>
        <Button type="button" onClick={() => window.print()} disabled={!poster?.qrDataUrl}><Printer className="mr-2 h-4 w-4" />Print poster</Button>
      </div>
      {error ? <div className="no-print mx-auto max-w-[210mm]"><QueryErrorBanner error={error} onRetry={() => refetch()} /></div> : null}
      {loading && !poster ? <p className="no-print text-center text-sm">Preparing poster…</p> : null}
      {poster ? (
        <article className="mx-auto flex h-[297mm] w-[210mm] flex-col items-center justify-between bg-white px-[18mm] py-[20mm] text-center shadow-lg print:shadow-none">
          <header className="flex flex-col items-center gap-3">
            <img src={poster.showroom?.logoUrl || '/brand/marble-park-logo.png'} alt="" className="h-20 w-20 object-contain" />
            <p className="text-2xl font-semibold tracking-tight">{company}</p>
          </header>
          <div className="flex flex-col items-center gap-6">
            <h1 className="font-display text-[44px] font-semibold leading-tight">Scan to explore<br />any product here</h1>
            {poster.qrDataUrl ? <img src={poster.qrDataUrl} alt={`QR code that opens the ${company} showroom scanner`} className="h-[95mm] w-[95mm]" /> : <p className="max-w-sm text-base text-[#b91c1c]">Set the canonical app URL in Settings before printing this poster.</p>}
            <p className="font-mono text-sm text-[#52525b]">{poster.url}</p>
          </div>
          <ol className="grid w-full grid-cols-3 gap-4 text-left text-[15px] leading-snug">
            {['Scan this code with your phone camera.', 'Tap “Start scanning” and allow the camera.', 'Point at the QR on any product sticker to see photos, sizes and similar designs.'].map((step, index) => (
              <li key={step} className="rounded-xl border border-[#e4e4e7] p-4"><span className="mb-2 grid h-8 w-8 place-items-center rounded-full bg-[#9d2a24] font-semibold text-white">{index + 1}</span>{step}</li>
            ))}
          </ol>
          {!poster.enabled ? <p className="no-print text-sm text-[#b45309]">Customer pages are switched off in Settings; the poster will show a paused message until they are switched on.</p> : null}
        </article>
      ) : null}
    </main>
  );
}
