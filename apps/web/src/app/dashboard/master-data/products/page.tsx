'use client';

import { useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import Link from 'next/link';
import { ImagePlus, PackagePlus, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const MASTER_DATA = gql`
  query ProductMasterData {
    masterProductCategories(status: "active")
    masterProductBrands(status: "active")
    masterProductFinishes(status: "active")
  }
`;
const GET_PRODUCTS = gql`query($search: String, $take: Int) { products(search: $search, take: $take) { id sku name category brand finish sellPrice status media } }`;
const CREATE_PRODUCT = gql`mutation($input: CreateProductInput!) { createProduct(input: $input) { id sku name } }`;

const emptyProduct = {
  sku: '',
  name: '',
  category: '',
  brand: '',
  finish: '',
  dimensions: '',
  unit: 'PC',
  sellPrice: '',
  floorPrice: '',
  description: '',
  media: null,
};

function names(rows: any[] | undefined, fallback: string[] = []) {
  const values = (rows || []).map((row: any) => typeof row === 'string' ? row : row?.name).filter(Boolean);
  return Array.from(new Set(values.length ? values : fallback));
}

export default function ProductMasterPage() {
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<any>(emptyProduct);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const { data: masterData } = useQuery(MASTER_DATA);
  const { data, refetch } = useQuery(GET_PRODUCTS, { variables: { search, take: 80 } });
  const [createProduct, { loading }] = useMutation(CREATE_PRODUCT, {
    onCompleted: () => {
      refetch();
      setForm(emptyProduct);
      setMessage('SKU saved. It is now available in catalogue and quotes.');
    },
    onError: (error) => setMessage(error.message),
  });

  const categories = names(masterData?.masterProductCategories);
  const brands = names(masterData?.masterProductBrands);
  const finishes = names(masterData?.masterProductFinishes);
  const products = data?.products || [];
  const canSave = Boolean(form.sku.trim() && form.name.trim() && form.category.trim());

  function submitProduct() {
    const input: any = {
      sku: form.sku,
      name: form.name,
      category: form.category,
      brand: form.brand || undefined,
      finish: form.finish || undefined,
      dimensions: form.dimensions || undefined,
      unit: form.unit || undefined,
      description: form.description || undefined,
      media: form.media || undefined,
    };
    if (form.sellPrice !== '') input.sellPrice = Number(form.sellPrice);
    if (form.floorPrice !== '') input.floorPrice = Number(form.floorPrice);
    createProduct({ variables: { input } });
  }

  async function uploadImage(file?: File) {
    if (!file) return;
    setUploading(true);
    setMessage('Uploading product image...');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('scope', 'product-image');
      const upload = await fetch('/api/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}` },
        body: fd,
      }).then((res) => res.json());
      if (!upload.publicUrl) throw new Error(upload.error || 'Image upload failed');
      setForm((current: any) => ({
        ...current,
        media: {
          primary: upload.publicUrl,
          gallery: [upload.publicUrl],
          source: 'manual-product-master',
          exactSkuMatch: true,
        },
      }));
      setMessage('Image attached to this SKU. Save the SKU to publish it.');
    } catch (error: any) {
      setMessage(error.message || 'Image upload failed');
    } finally {
      setUploading(false);
    }
  }

  return <div className="space-y-7 pb-10">
    <section className="rounded-r6 mp-card bg-white border border-[#e4e4e7] p-6 text-[#18181b]">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-[#71717a]">Product master</p>
      <h1 className="mt-3 font-display text-3xl font-bold tracking-[-0.02em] text-[#18181b]">Create SKUs with required code, name and category.</h1>
      <p className="mt-3 max-w-3xl text-sm text-[#52525b]">Brand, finish, dimensions, image, unit and pricing are optional. Add them when known; the SKU still remains quoteable and stockable from Product Master.</p>
      <div className="mt-5 flex flex-wrap gap-2">
        <Link href="/dashboard/master-data/categories" className="rounded-full border border-[#bfdbfe] bg-[#eff6ff] px-4 py-2 text-xs font-black uppercase tracking-wider text-[#1d4ed8]">Category master</Link>
        <Link href="/dashboard/master-data/brands" className="rounded-full border border-[#e4e4e7] bg-white px-4 py-2 text-xs font-black uppercase tracking-wider text-[#52525b]">Brand master</Link>
        <Link href="/dashboard/master-data/finishes" className="rounded-full border border-[#e4e4e7] bg-white px-4 py-2 text-xs font-black uppercase tracking-wider text-[#52525b]">Finish master</Link>
      </div>
    </section>

    <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
      <div className="mp-card rounded-r5 p-5">
        <div className="flex items-center gap-3"><PackagePlus className="h-6 w-6 text-[#2563eb]" /><h2 className="text-xl font-semibold text-[#18181b]">Add SKU</h2></div>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <label className="space-y-2"><span className="text-xs font-medium uppercase tracking-widest text-[#52525b]">SKU / code required</span><Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="Example: GRO-12345" /></label>
          <label className="space-y-2"><span className="text-xs font-medium uppercase tracking-widest text-[#52525b]">Name required</span><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Product display name" /></label>
          <label className="space-y-2"><span className="text-xs font-medium uppercase tracking-widest text-[#52525b]">Category required</span><Input list="product-category-options" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Select or type category" /><datalist id="product-category-options">{categories.map((item: string) => <option key={item} value={item} />)}</datalist></label>
          <label className="space-y-2"><span className="text-xs font-medium uppercase tracking-widest text-[#52525b]">Brand optional</span><Input list="product-brand-options" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} placeholder="Select or type brand" /><datalist id="product-brand-options">{brands.map((item: string) => <option key={item} value={item} />)}</datalist></label>
          <label className="space-y-2"><span className="text-xs font-medium uppercase tracking-widest text-[#52525b]">Finish optional</span><Input list="product-finish-options" value={form.finish} onChange={(e) => setForm({ ...form, finish: e.target.value })} placeholder="Select or type finish" /><datalist id="product-finish-options">{finishes.map((item: string) => <option key={item} value={item} />)}</datalist></label>
          <label className="space-y-2"><span className="text-xs font-medium uppercase tracking-widest text-[#52525b]">Unit optional</span><Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></label>
          <label className="space-y-2"><span className="text-xs font-medium uppercase tracking-widest text-[#52525b]">Dimensions optional</span><Input value={form.dimensions} onChange={(e) => setForm({ ...form, dimensions: e.target.value })} /></label>
          <label className="space-y-2"><span className="text-xs font-medium uppercase tracking-widest text-[#52525b]">Sell price optional</span><Input type="number" min={0} value={form.sellPrice} onChange={(e) => setForm({ ...form, sellPrice: e.target.value })} placeholder="Leave blank if not known" /></label>
          <label className="space-y-2"><span className="text-xs font-medium uppercase tracking-widest text-[#52525b]">Floor price optional</span><Input type="number" min={0} value={form.floorPrice} onChange={(e) => setForm({ ...form, floorPrice: e.target.value })} placeholder="Leave blank if not known" /></label>
          <label className="space-y-2 md:col-span-2"><span className="text-xs font-medium uppercase tracking-widest text-[#52525b]">Description</span><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
          <label className="md:col-span-2 rounded-[1.4rem] border border-dashed border-[#2563eb]/40 bg-white/65 p-4">
            <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-[#52525b]"><ImagePlus className="h-4 w-4" /> SKU image</span>
            <input type="file" accept="image/*" className="mt-3 block w-full text-sm font-bold" disabled={uploading} onChange={(e) => uploadImage(e.target.files?.[0])} />
            {form.media?.primary && <img src={form.media.primary} alt="SKU preview" className="mt-4 h-44 w-full rounded-2xl object-contain bg-[#f7faff]" />}
          </label>
        </div>
        {message && <p className="mt-4 rounded-2xl bg-[#eff6ff]/70 p-3 text-xs font-black uppercase tracking-wider text-[#1d4ed8]">{message}</p>}
        <Button className="mt-5" disabled={loading || uploading || !canSave} onClick={submitProduct}><Save className="mr-2 h-4 w-4" /> Save SKU</Button>
      </div>

      <div className="mp-card rounded-r5 p-5">
        <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-semibold text-[#18181b]">SKU register</h2><Input placeholder="Search SKU/name" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" /></div>
        <div className="mt-5 max-h-[42rem] space-y-2 overflow-y-auto custom-scrollbar">{products.map((p: any) => <Link href={`/dashboard/products?sku=${p.sku}`} key={p.id} className="flex gap-4 rounded-2xl bg-white/75 p-4 transition hover:bg-white">
          {p.media?.primary && <img src={p.media.primary} alt="" className="h-16 w-16 shrink-0 rounded-xl object-contain bg-[#f7faff]" />}
          <div><p className="font-semibold text-[#18181b]">{p.sku} · {p.name}</p><p className="text-xs font-bold text-[#52525b]">{[p.category, p.brand, p.finish].filter(Boolean).join(' · ') || 'Unclassified'} · ₹{Number(p.sellPrice || 0).toLocaleString('en-IN')}</p></div>
        </Link>)}</div>
      </div>
    </section>
  </div>;
}
