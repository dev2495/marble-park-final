import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, MessageCircle, Phone } from 'lucide-react';
import { PublicGallery, RememberViewed, ShareLinkButton } from '@/components/public/public-client';
import { FALLBACK_SHOWROOM, PriceLine, ProductTile, PublicFooter, PublicHeader, PublicNotice } from '@/components/public/public-ui';
import { firstPhone, getPublicProduct, publicImage, SHARE_TOKEN, whatsappLink, type PublicProductCard } from '@/lib/public-catalogue';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const data = await getPublicProduct(token);
  const product = data?.product;
  const company = data?.showroom?.companyName || 'Marble Park';
  if (!product) return { title: company, robots: { index: false, follow: false } };
  const origin = data?.url ? new URL(data.url).origin : '';
  const image = product.photos[0] ? publicImage(product.photos[0]) : '';
  const description = [product.brand, product.size, product.finish].filter(Boolean).join(' · ') || `${product.category} at ${company}`;
  return {
    title: `${product.name} | ${company}`,
    description,
    robots: { index: false, follow: false },
    openGraph: {
      title: product.name,
      description,
      siteName: company,
      ...(image ? { images: [image.startsWith('http') || !origin ? image : `${origin}${image}`] } : {}),
    },
  };
}

function SimilarSection({ id, title, items, shareToken }: { id: string; title: string; items: PublicProductCard[]; shareToken: string }) {
  if (!items.length) return null;
  return (
    <section aria-labelledby={id} className="mt-12">
      <h2 id={id} className="font-display text-2xl font-semibold text-[var(--ink)]">{title}</h2>
      <ul className="mt-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {items.map((item, index) => <ProductTile key={item.token} product={item} index={index} href={`/p/${item.token}${shareToken ? `?s=${shareToken}` : ''}`} />)}
      </ul>
    </section>
  );
}

export default async function PublicProductPage({ params, searchParams }: Props) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const data = await getPublicProduct(token);
  const showroom = data?.showroom || FALLBACK_SHOWROOM;
  if (!data) return <PublicNotice showroom={showroom} title="We could not load this product" body="Please check your connection and try again, or ask our showroom team." />;
  if (!data.enabled) return <PublicNotice showroom={showroom} title="Product pages are paused" body="Our online product pages are switched off right now. Our showroom team will be happy to help." />;
  const product = data.product;
  if (!product) return <PublicNotice showroom={showroom} title="This product is not available" body="The link may be old, or the product is no longer in our range. Scan another sticker or ask our team for similar designs." />;

  const shareToken = typeof query.s === 'string' && SHARE_TOKEN.test(query.s) ? query.s : '';
  const phone = firstPhone(showroom.phone);
  const link = data.url || '';
  const ask = whatsappLink(showroom.whatsapp, `Hello ${showroom.companyName}, I'd like to know more about ${product.name}${product.code ? ` (code ${product.code})` : ''}.${link ? `\n${link}` : ''}`);
  const sameDesign = data.similar.filter((item) => item.relation === 'design');
  const others = data.similar.filter((item) => item.relation !== 'design');
  const design = product.design;
  const designFacts = design ? [
    ['Collection', design.collection], ['Material', design.material], ['Surface', design.surface],
    ['Colour', design.colour], ['Pattern', design.pattern], ['Origin', design.origin],
  ].filter(([, value]) => Boolean(String(value || '').trim())) : [];

  return (
    <main className="min-h-screen bg-[var(--bg)]">
      <RememberViewed item={{ token: product.token, name: product.name, thumbnail: product.thumbnail, size: product.size }} />
      <PublicHeader showroom={showroom} />
      <div className="mx-auto max-w-6xl px-4 pt-4">
        {shareToken ? (
          <Link href={`/s/${shareToken}`} className="inline-flex h-11 items-center gap-2 text-sm font-semibold text-[var(--ink-3)] hover:text-[var(--ink)]"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to your selection</Link>
        ) : null}
        <article className="grid gap-6 pt-2 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-10">
          <div className="public-rise min-w-0 lg:sticky lg:top-20 lg:self-start">
            <PublicGallery photos={product.photos} name={product.name} />
          </div>
          <div className="public-rise min-w-0 space-y-6" style={{ animationDelay: '80ms' }}>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--brand-700)]">{product.brand || product.category}</p>
              <h1 className="mt-2 font-display text-3xl font-semibold leading-tight text-[var(--ink)] sm:text-4xl">{product.name}</h1>
              <div className="mt-3 flex flex-wrap gap-2 text-sm">
                {product.size ? <span className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1 text-[var(--ink-2)]">{product.size}</span> : null}
                {product.finish ? <span className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1 text-[var(--ink-2)]">{product.finish}</span> : null}
                {product.code ? <span className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1 font-mono text-xs leading-6 text-[var(--ink-3)]">Code {product.code}</span> : null}
              </div>
            </div>

            <div className="rounded-r6 border border-[var(--line)] bg-[var(--surface)] p-5">
              <PriceLine price={product.price} size="lg" />
              <p className="mt-2 text-sm text-[var(--ink-3)]">{product.price ? 'GST and your final price are confirmed on the quotation.' : 'Ask our team for today’s price and offers.'}</p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {ask ? <a href={ask} target="_blank" rel="noreferrer" className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#1f7a4d] px-5 font-semibold text-white hover:bg-[#19643f]"><MessageCircle className="h-4 w-4" aria-hidden="true" />Ask on WhatsApp</a> : null}
                {phone ? <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[var(--ink)] px-5 font-semibold text-[var(--surface)]"><Phone className="h-4 w-4" aria-hidden="true" />Call the showroom</a> : null}
                <div className={ask && phone ? 'sm:col-span-2' : ''}><ShareLinkButton title={product.name} url={link} /></div>
              </div>
            </div>

            {product.description ? <p className="leading-7 text-[var(--ink-2)]">{product.description}</p> : null}

            {design && (designFacts.length || design.usage.length) ? (
              <section aria-labelledby="design-title" className="rounded-r6 bg-[var(--surface-2)] p-5">
                <h2 id="design-title" className="font-display text-xl font-semibold text-[var(--ink)]">{design.name ? `About the ${design.name} design` : 'About this design'}</h2>
                {designFacts.length ? (
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    {designFacts.map(([label, value]) => <div key={label}><dt className="text-[var(--ink-4)]">{label}</dt><dd className="font-medium text-[var(--ink)]">{value}</dd></div>)}
                  </dl>
                ) : null}
                {design.usage.length ? (
                  <div className="mt-4"><p className="text-sm text-[var(--ink-4)]">Suitable for</p><ul className="mt-2 flex flex-wrap gap-2">{design.usage.map((use) => <li key={use} className="rounded-full bg-[var(--surface)] px-3 py-1 text-sm text-[var(--ink-2)]">{use}</li>)}</ul></div>
                ) : null}
              </section>
            ) : null}

            {product.specs.length ? (
              <section aria-labelledby="spec-title">
                <h2 id="spec-title" className="font-display text-xl font-semibold text-[var(--ink)]">Specifications</h2>
                <dl className="mt-3 divide-y divide-[var(--line)] rounded-r6 border border-[var(--line)] bg-[var(--surface)] text-sm">
                  {product.specs.map(([label, value]) => <div key={label} className="flex justify-between gap-4 px-4 py-3"><dt className="text-[var(--ink-4)]">{label}</dt><dd className="text-right font-medium text-[var(--ink)]">{value}</dd></div>)}
                </dl>
              </section>
            ) : null}
          </div>
        </article>

        <SimilarSection id="same-design" title="Other sizes and finishes in this design" items={sameDesign} shareToken={shareToken} />
        <SimilarSection id="similar" title={sameDesign.length ? 'You may also like' : 'Similar products'} items={others} shareToken={shareToken} />
      </div>
      <PublicFooter showroom={showroom} />
    </main>
  );
}
