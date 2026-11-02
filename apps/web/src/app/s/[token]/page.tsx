import type { Metadata } from 'next';
import { MessageCircle } from 'lucide-react';
import { FALLBACK_SHOWROOM, ProductTile, PublicFooter, PublicHeader, PublicNotice } from '@/components/public/public-ui';
import { getPublicShare, whatsappLink } from '@/lib/public-catalogue';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const data = await getPublicShare(token);
  const company = data?.showroom?.companyName || 'Marble Park';
  return {
    title: data?.share ? `${data.share.title} | ${company}` : company,
    description: data?.share ? `${data.products.length} products picked for you by ${company}` : undefined,
    robots: { index: false, follow: false },
  };
}

function dateLabel(value: string) {
  return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default async function PublicSharePage({ params }: Props) {
  const { token } = await params;
  const data = await getPublicShare(token);
  const showroom = data?.showroom || FALLBACK_SHOWROOM;
  if (!data) return <PublicNotice showroom={showroom} title="We could not load this selection" body="Please check your connection and try again, or ask our showroom team." />;
  if (!data.enabled) return <PublicNotice showroom={showroom} title="Product pages are paused" body="Our online product pages are switched off right now. Our showroom team will be happy to help." />;
  if (!data.share) {
    return data.status === 'expired'
      ? <PublicNotice showroom={showroom} title="This link has expired" body="Ask the person who sent it for a fresh link. Our team can also share the latest designs with you." />
      : <PublicNotice showroom={showroom} title="This link is not available" body="Please check the link you received, or ask our showroom team to send it again." />;
  }
  const { share, products } = data;
  const ask = whatsappLink(showroom.whatsapp, `Hello ${showroom.companyName}, I'm looking at "${share.title}"${share.sharedBy ? ` shared by ${share.sharedBy}` : ''} and have a question.`);

  return (
    <main className="min-h-screen bg-[var(--bg)]">
      <PublicHeader showroom={showroom} />
      <div className="mx-auto max-w-6xl px-4">
        <section className="public-rise py-8">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--brand-700)]">{share.sharedBy ? `Picked for you by ${share.sharedBy}` : `Picked for you by ${showroom.companyName}`}</p>
          <h1 className="mt-2 font-display text-3xl font-semibold leading-tight text-[var(--ink)] sm:text-4xl">{share.title}</h1>
          {share.note ? <p className="mt-3 max-w-2xl whitespace-pre-line leading-7 text-[var(--ink-2)]">{share.note}</p> : null}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {ask ? <a href={ask} target="_blank" rel="noreferrer" className="inline-flex h-12 items-center gap-2 rounded-full bg-[#1f7a4d] px-5 font-semibold text-white hover:bg-[#19643f]"><MessageCircle className="h-4 w-4" aria-hidden="true" />Ask on WhatsApp</a> : null}
            <p className="text-sm text-[var(--ink-4)]">{products.length} product{products.length === 1 ? '' : 's'} · link valid until {dateLabel(share.expiresAt)}</p>
          </div>
        </section>
        {products.length ? (
          <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
            {products.map((product, index) => <ProductTile key={product.token} product={product} index={index} href={`/p/${product.token}?s=${token.toUpperCase()}`} />)}
          </ul>
        ) : (
          <p className="rounded-r6 border border-dashed border-[var(--line)] bg-[var(--surface)] p-8 text-center text-[var(--ink-3)]">The products in this selection are no longer in our range. Ask our team for similar designs.</p>
        )}
      </div>
      <PublicFooter showroom={showroom} />
    </main>
  );
}
