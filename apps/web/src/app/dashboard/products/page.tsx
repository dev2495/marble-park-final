'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useQuery, gql } from '@apollo/client';
import { motion, AnimatePresence } from 'framer-motion';
import { Bath, Boxes, Grid3X3, Image as ImageIcon, PackageSearch, Search, ShieldCheck, Sparkles, Tag, Wrench, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ProductImageFrame } from '@/components/product-image-frame';

const GET_PRODUCTS = gql`
  query Products($search: String, $category: String, $take: Int) {
    products(search: $search, category: $category, take: $take) {
      id
      sku
      name
      category
      brand
      finish
      dimensions
      unit
      sellPrice
      floorPrice
      taxClass
      status
      media
      description
    }
  }
`;

const GET_CATEGORIES = gql`
  query ProductCategories {
    productCategories
  }
`;

const GET_PRODUCT_STATS = gql`
  query ProductStats {
    productStats
  }
`;


const fallbackProducts = [
  {
    id: 'demo-1',
    sku: 'GRO-23571003',
    name: 'Grohe Eurostyle Basin Mixer',
    category: 'Faucets',
    brand: 'Grohe',
    finish: 'Chrome',
    dimensions: 'Single lever, 1/2 inch',
    unit: 'PC',
    sellPrice: 8950,
    floorPrice: 8050,
    taxClass: 'GST_18',
    status: 'active',
    description: 'Retail-ready CP faucet with quote image placement and catalogue trace support.',
  },
  {
    id: 'demo-2',
    sku: 'AQ-SS-2418-HM',
    name: 'Aquant Handmade SS Sink 24x18',
    category: 'Kitchen Sinks',
    brand: 'Aquant',
    finish: 'Satin Steel',
    dimensions: '24 x 18 x 10 inch',
    unit: 'PC',
    sellPrice: 12800,
    floorPrice: 11200,
    taxClass: 'GST_18',
    status: 'active',
    description: 'Stainless steel sink line item with image, MRP, dimensions, and stock visibility.',
  },
  {
    id: 'demo-3',
    sku: 'HIN-WC-ARIA-RIM',
    name: 'Hindware Aria Rimless Wall Hung WC',
    category: 'Sanitaryware',
    brand: 'Hindware',
    finish: 'Gloss White',
    dimensions: '520 x 365 x 355 mm',
    unit: 'PC',
    sellPrice: 18600,
    floorPrice: 16200,
    taxClass: 'GST_18',
    status: 'active',
    description: 'Sanitaryware SKU prepared for owner pricing guardrails and dispatch reservation.',
  },
  {
    id: 'demo-4',
    sku: 'TIL-STAT-6001200',
    name: 'Statuario Porcelain Tile 600x1200',
    category: 'Tiles',
    brand: 'Marble Park Select',
    finish: 'Polished',
    dimensions: '600 x 1200 mm',
    unit: 'BOX',
    sellPrice: 1450,
    floorPrice: 1250,
    taxClass: 'GST_18',
    status: 'active',
    description: 'Large-format tile catalogue item with box unit, shade story, and quote-ready details.',
  },
];

const categoryLooks: Record<string, { accent: string; wash: string; icon: any }> = {
  Faucets: { accent: 'from-[#b57942] via-[#d4a56f] to-[#f3eadf]', wash: 'bg-[#ead7c0] text-[#7a4f2e]', icon: Bath },
  'Faucets & Showers': { accent: 'from-[#b57942] via-[#d4a56f] to-[#f3eadf]', wash: 'bg-[#ead7c0] text-[#7a4f2e]', icon: Bath },
  'Kitchen Sinks': { accent: 'from-zinc-500 to-slate-300', wash: 'bg-slate-100 text-slate-700', icon: Boxes },
  Sanitaryware: { accent: 'from-stone-200 to-white', wash: 'bg-stone-100 text-stone-700', icon: ShieldCheck },
  Tiles: { accent: 'from-amber-600 to-stone-200', wash: 'bg-amber-50 text-amber-800', icon: Grid3X3 },
  Accessories: { accent: 'from-[#24544d] to-[#98b7ad]', wash: 'bg-[#dbe8e3] text-[#24544d]', icon: Wrench },
  'Catalogue Products': { accent: 'from-[#211b16] to-[#b57942]', wash: 'bg-[#ead7c0] text-[#211b16]', icon: PackageSearch },
};

function currency(value?: number) {
  return `₹${Number(value || 0).toLocaleString('en-IN')}`;
}

function getLook(category?: string) {
  return categoryLooks[category || ''] || { accent: 'from-emerald-500 to-teal-200', wash: 'bg-emerald-50 text-emerald-700', icon: PackageSearch };
}

function galleryFor(product: any) {
  const media = product?.media || {};
  return Array.from(new Set([media.primary, ...((media.gallery || []) as string[])].filter(Boolean)));
}

export default function ProductsPage() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [galleryProduct, setGalleryProduct] = useState<any>(null);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [portalReady, setPortalReady] = useState(false);
  const { data, loading } = useQuery(GET_PRODUCTS, { variables: { search, category: category || undefined, take: 180 } });
  const { data: categoriesData } = useQuery(GET_CATEGORIES);
  const { data: statsData } = useQuery(GET_PRODUCT_STATS);

  const products = data?.products?.length ? data.products : fallbackProducts;
  const stats = statsData?.productStats;
  const categories = categoriesData?.productCategories?.length
    ? categoriesData.productCategories
    : Array.from(new Set(fallbackProducts.map((p) => p.category)));
  const selected = useMemo(() => products.find((p: any) => p.id === selectedId) || products[0], [products, selectedId]);
  useEffect(() => setPortalReady(true), []);
  const look = getLook(selected?.category);
  const SelectedIcon = look.icon;

  return (
    <div className="space-y-8 pb-10">
      {portalReady && galleryProduct ? createPortal(
        <AnimatePresence>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[9999] grid place-items-center bg-[#120f0c]/88 p-4 backdrop-blur-xl" onClick={() => setGalleryProduct(null)}>
            <motion.div initial={{ y: 24, scale: 0.96 }} animate={{ y: 0, scale: 1 }} exit={{ y: 24, scale: 0.96 }} className="relative max-h-[92vh] w-full max-w-6xl overflow-hidden rounded-[2rem] bg-[#fffaf3] p-4 shadow-2xl" onClick={(event) => event.stopPropagation()}>
              <button onClick={() => setGalleryProduct(null)} className="absolute right-5 top-5 z-10 grid h-11 w-11 place-items-center rounded-full bg-[#211b16] text-white shadow-xl"><X className="h-5 w-5" /></button>
              <div className="grid gap-4 lg:grid-cols-[1fr_13rem]">
                <div className="overflow-hidden rounded-[1.5rem] bg-white">
                  <ProductImageFrame src={galleryFor(galleryProduct)[galleryIndex] || galleryProduct.media?.primary || '/catalogue-art/faucet.svg'} alt={galleryProduct.name} className="h-[74vh] rounded-[1.5rem]" imageClassName="p-4" />
                </div>
                <div className="space-y-3">
                  <div className="rounded-[1.5rem] bg-[#211b16] p-4 text-white">
                    <p className="font-mono text-xs font-black uppercase tracking-wider text-[#d5b58f]">{galleryProduct.sku}</p>
                    <h3 className="mt-2 text-xl font-black leading-tight">{galleryProduct.name}</h3>
                    <p className="mt-2 text-xs font-bold text-[#d9c4a9]">{Math.max(galleryFor(galleryProduct).length, 1)} image(s)</p>
                  </div>
                  <div className="grid max-h-[55vh] gap-2 overflow-y-auto custom-scrollbar">
                    {(galleryFor(galleryProduct).length ? galleryFor(galleryProduct) : ['/catalogue-art/faucet.svg']).map((src: string, index: number) => (
                      <button key={src} onClick={() => setGalleryIndex(index)} className={`overflow-hidden rounded-2xl border-2 bg-white ${index === galleryIndex ? 'border-[#b57942]' : 'border-transparent'}`}>
                        <ProductImageFrame src={src} alt={`${galleryProduct.name} ${index + 1}`} className="h-28 rounded-2xl" imageClassName="p-2" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        </AnimatePresence>,
        document.body
      ) : null}
      <section className="relative overflow-hidden rounded-[2.5rem] bg-[#12100d] text-white shadow-2xl shadow-stone-900/10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.18),transparent_28%),linear-gradient(120deg,rgba(217,119,6,0.22),transparent_40%)]" />
        <div className="relative grid gap-8 p-7 lg:grid-cols-[1.05fr_0.95fr] lg:p-10">
          <div className="flex min-h-[390px] flex-col justify-between">
            <div className="space-y-5">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-black uppercase tracking-[0.22em] text-stone-200 backdrop-blur">
                <Sparkles size={14} /> Catalogue Studio
              </div>
              <div>
                <h1 className="max-w-3xl text-5xl font-black leading-[0.95] tracking-tight lg:text-7xl">
                  Retail products that look ready to sell.
                </h1>
                <p className="mt-5 max-w-xl text-base font-medium leading-7 text-stone-300">
                  Sanitaryware, faucets, sinks, tiles, catalog imports, stock status, and quote-ready visuals in one controlled master.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 text-sm">
              {[
                ['Products', stats?.totalProducts || products.length],
                ['Categories', stats?.totalCategories || categories.length],
                ['Quote Image Ready', stats?.activeProducts || products.filter((p: any) => p.status === 'active').length],
              ].map(([label, value]) => (
                <div key={label} className="rounded-3xl border border-white/10 bg-white/[0.08] p-4 backdrop-blur">
                  <div className="text-3xl font-black">{value}</div>
                  <div className="mt-1 text-[10px] font-black uppercase tracking-widest text-stone-400">{label}</div>
                </div>
              ))}
            </div>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={selected?.id}
              initial={{ opacity: 0, y: 24, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -18, scale: 0.98 }}
              transition={{ duration: 0.32 }}
              className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-white p-5 text-[#211b16] shadow-2xl"
            >
              {selected?.media?.primary ? (
                <button
                  type="button"
                  className="mb-5 block w-full cursor-zoom-in text-left"
                  onClick={() => { setGalleryProduct(selected); setGalleryIndex(0); }}
                >
                  <ProductImageFrame
                    src={selected.media.primary}
                    alt={selected.name}
                    label={selected.category}
                    className="aspect-[4/3] rounded-[1.5rem]"
                    imageClassName="p-3 group-hover:scale-[1.02]"
                  />
                </button>
              ) : (
                <div className={`relative mb-5 flex aspect-[4/3] items-center justify-center overflow-hidden rounded-[1.5rem] bg-gradient-to-br ${look.accent}`}>
                  <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.45)_0_1px,transparent_1px_18px)] opacity-30" />
                  <div className="absolute bottom-5 left-5 rounded-2xl bg-black/20 px-3 py-2 text-xs font-black uppercase tracking-widest text-white backdrop-blur">
                    {selected?.category}
                  </div>
                  <SelectedIcon className="h-28 w-28 text-white/85 drop-shadow-2xl" strokeWidth={1.3} />
                </div>
              )}
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="font-mono text-xs font-black uppercase tracking-wider text-slate-400">{selected?.sku}</div>
                  <h2 className="mt-1 text-3xl font-black tracking-tight text-[#211b16]">{selected?.name}</h2>
                  <p className="mt-3 max-w-xl text-sm font-medium leading-6 text-slate-500">{selected?.description || `${selected?.brand} ${selected?.finish} catalogue product.`}</p>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-black text-[#211b16]">{currency(selected?.sellPrice)}</div>
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">MRP / {selected?.unit}</div>
                </div>
              </div>
              <div className="mt-5 grid grid-cols-3 gap-3">
                {[
                  ['Brand', selected?.brand],
                  ['Finish', selected?.finish || 'Standard'],
                  ['Size', selected?.dimensions || 'Variant'],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-2xl bg-slate-50 p-4">
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</div>
                    <div className="mt-1 truncate text-sm font-black text-slate-800">{value}</div>
                  </div>
                ))}
              </div>
              {galleryFor(selected).length > 0 && (
                <Button type="button" className="mt-5 w-full rounded-2xl" onClick={() => { setGalleryProduct(selected); setGalleryIndex(0); }}>
                  Open full-size gallery
                </Button>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </section>

      <section className="flex flex-col gap-4 rounded-[2rem] border border-white/70 bg-white/70 p-4 shadow-xl shadow-slate-200/50 backdrop-blur-xl lg:flex-row lg:items-center lg:justify-between">
        <div className="relative min-w-0 flex-1 lg:max-w-xl">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Search SKU, brand, faucet, sink, WC, tile..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-[3.25rem] rounded-2xl border-slate-200 bg-white pl-11 text-sm font-bold shadow-sm"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 lg:pb-0">
          <Button onClick={() => setCategory('')} variant={!category ? 'default' : 'outline'} className="rounded-2xl font-black">
            All
          </Button>
          {categories.map((item: string) => (
            <Button key={item} onClick={() => setCategory(item)} variant={category === item ? 'default' : 'outline'} className="whitespace-nowrap rounded-2xl font-black">
              {item}
            </Button>
          ))}
        </div>
      </section>

      <section className="rounded-[2rem] border border-[#7a5b3c]/10 bg-[#fffaf3]/80 p-5 shadow-xl shadow-[#6b4f38]/8">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#8b6b4c]">Product master is separate</p>
            <h2 className="mt-1 text-2xl font-black text-[#211b16]">Catalogue is for browsing and selling. SKU creation lives in Product Master.</h2>
            <p className="mt-2 text-sm font-bold text-[#7d6b5c]">This keeps sales browsing clean and master-data permissions controlled for admin/owner/inventory roles.</p>
          </div>
          <Button asChild className="rounded-2xl"><Link href="/dashboard/master-data/products">Open Product Master</Link></Button>
        </div>
      </section>

      {loading ? (
        <div className="flex h-72 items-center justify-center rounded-[2rem] bg-white/70">
          <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-stone-900" />
        </div>
      ) : products.length === 0 ? (
        <div className="rounded-[2rem] border border-dashed border-slate-300 bg-white/70 p-16 text-center text-slate-500">No products found.</div>
      ) : (
        <section className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {products.map((product: any, index: number) => {
            const productLook = getLook(product.category);
            const ProductIcon = productLook.icon;
            const margin = product.floorPrice ? Math.max(0, product.sellPrice - product.floorPrice) : 0;
            return (
              <motion.article
                key={product.id}
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.025 }}
                onClick={() => { setSelectedId(product.id); if (galleryFor(product).length > 0) { setGalleryProduct(product); setGalleryIndex(0); } }}
                className="group overflow-hidden rounded-[2rem] border border-white/80 bg-white text-left shadow-lg shadow-slate-200/40 transition-all hover:-translate-y-1 hover:shadow-2xl hover:shadow-slate-300/50"
              >
                {product.media?.primary ? (
                  <ProductImageFrame
                    src={product.media.primary}
                    alt={product.name}
                    label={product.category}
                    className="h-60 rounded-none cursor-zoom-in"
                    imageClassName="p-3 group-hover:scale-[1.05]"
                  />
                ) : (
                  <div className={`relative flex h-60 items-center justify-center bg-gradient-to-br ${productLook.accent}`}>
                    <div className="absolute left-4 top-4 rounded-full bg-white/80 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-slate-700 backdrop-blur">
                      {product.category}
                    </div>
                    <ProductIcon className="h-24 w-24 text-white/85 drop-shadow-xl transition-transform group-hover:scale-110" strokeWidth={1.3} />
                    <ImageIcon className="absolute bottom-4 right-4 h-5 w-5 text-white/70" />
                  </div>
                )}
                <div className="space-y-4 p-5">
                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-[11px] font-black uppercase tracking-wider text-slate-400">{product.sku}</span>
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${productLook.wash}`}>{product.brand}</span>
                    </div>
                    <h3 className="mt-2 line-clamp-2 text-xl font-black leading-tight text-[#211b16]">{product.name}</h3>
                    <p className="mt-1 text-sm font-semibold text-slate-500">{product.finish || 'Standard'} · {product.dimensions || product.unit}</p>
                  </div>
                  <div className="flex items-end justify-between border-t border-slate-100 pt-4">
                    <div>
                      <div className="text-2xl font-black text-[#211b16]">{currency(product.sellPrice)}</div>
                      <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Floor margin {currency(margin)}</div>
                    </div>
                    <div className="rounded-2xl bg-[#211b16] p-3 text-white transition-transform group-hover:rotate-3">
                      <Tag size={18} />
                    </div>
                  </div>
                  {galleryFor(product).length > 0 && <Button type="button" size="sm" variant="outline" className="w-full rounded-2xl" onClick={(event) => { event.stopPropagation(); setSelectedId(product.id); setGalleryProduct(product); setGalleryIndex(0); }}>Open full-size gallery</Button>}
                </div>
              </motion.article>
            );
          })}
        </section>
      )}
    </div>
  );
}
