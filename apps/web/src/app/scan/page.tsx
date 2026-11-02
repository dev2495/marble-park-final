import type { Metadata } from 'next';
import { RecentlyViewed } from '@/components/public/public-client';
import { FALLBACK_SHOWROOM, PublicFooter, PublicHeader, PublicNotice } from '@/components/public/public-ui';
import { ShowroomScanner } from '@/components/public/showroom-scanner';
import { getPublicShowroom } from '@/lib/public-catalogue';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const data = await getPublicShowroom();
  const company = data?.showroom?.companyName || 'Marble Park';
  return { title: `Scan a product | ${company}`, description: `Scan any product sticker at ${company} to see photos, sizes and similar designs.`, robots: { index: false, follow: false } };
}

export default async function ShowroomScanPage() {
  const data = await getPublicShowroom();
  const showroom = data?.showroom || FALLBACK_SHOWROOM;
  if (data && !data.enabled) return <PublicNotice showroom={showroom} title="Product pages are paused" body="Our online product pages are switched off right now. Our showroom team will be happy to help." />;
  return (
    <main className="min-h-screen bg-[var(--bg)]">
      <PublicHeader showroom={showroom} scanLink={false} />
      <div className="mx-auto max-w-3xl px-4">
        <section className="public-rise pb-2 pt-8 text-center">
          <h1 className="font-display text-3xl font-semibold leading-tight text-[var(--ink)] sm:text-4xl">Scan any product sticker</h1>
          <p className="mx-auto mt-3 max-w-md text-[var(--ink-3)]">Point your camera at the QR code on a shelf or display sticker to see photos, sizes and similar designs.</p>
        </section>
        <ShowroomScanner />
        <RecentlyViewed />
      </div>
      <PublicFooter showroom={showroom} />
    </main>
  );
}
