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

function names(rows: any[] | undefined, fallback: string[]) {
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

  const categories = names(masterData?.masterProductCategories, ['Catalogue Products']);
  const brands = names(masterData?.masterProductBrands, ['Marble Park Select']);
  const finishes = names(masterData?.masterProductFinishes, ['Standard']);
  const products = data?.products || [];
  const effectiveForm = {
    ...form,
    category: form.category || categories[0] || '',
    brand: form.brand || brands[0] || '',
    finish: form.finish || finishes[0] || '',
  };

  async function uploadImage(file?: File) {
    if (!file) return;
    setUploading(true);
    setMessage('Uploading product image...');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('scope', 'product-image');
      const upload = await fetch('/api/upload', { method: 'POST', body: fd }).then((res) => res.json());
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
    <section className="rounded-[2.25rem] bg-[#0e1a3d] p-7 text-white shadow-2xl shadow-[#0e1a3d]/15">
      <p className="text-[10px] font-black uppercase tracking-[0.26em] text-[#bfdbfe]">Product master</p>
      <h1 className="mt-3 text-5xl font-black tracking-[-0.05em]">Create SKUs with controlled brand, finish and category masters.</h1>
      <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-[#dbeafe]">Admin, owner and inventory users create SKUs here. Brand, finish and category are dropdown-backed master data so catalogue filters, quotes and imports stay clean.</p>
      <div className="mt-5 flex flex-wrap gap-2">
        <Link href="/dashboard/master-data/categories" className="rounded-full bg-white/10 px-4 py-2 text-xs font-black uppercase tracking-wider text-[#ffffff]">Category master</Link>
        <Link href="/dashboard/master-data/brands" className="rounded-full bg-white/10 px-4 py-2 text-xs font-black uppercase tracking-wider text-[#ffffff]">Brand master</Link>
        <Link href="/dashboard/master-data/finishes" className="rounded-full bg-white/10 px-4 py-2 text-xs font-black uppercase tracking-wider text-[#ffffff]">Finish master</Link>
      </div>
    </section>

    <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
      <div className="mp-card rounded-[2rem] p-5">
        <div className="flex items-center gap-3"><PackagePlus className="h-6 w-6 text-[#2563eb]" /><h2 className="text-xl font-black text-[#0e1a3d]">Add SKU</h2></div>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <label className="space-y-2"><span className="text-[10px] font-black uppercase tracking-widest text-[#475569]">SKU</span><Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></label>
          <label className="space-y-2"><span className="text-[10px] font-black uppercase tracking-widest text-[#475569]">Name</span><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="space-y-2"><span className="text-[10px] font-black uppercase tracking-widest text-[#475569]">Brand</span><select value={effectiveForm.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-bold">{brands.map((item: string) => <option key={item} value={item}>{item}</option>)}</select></label>
          <label className="space-y-2"><span className="text-[10px] font-black uppercase tracking-widest text-[#475569]">Finish</span><select value={effectiveForm.finish} onChange={(e) => setForm({ ...form, finish: e.target.value })} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-bold">{finishes.map((item: string) => <option key={item} value={item}>{item}</option>)}</select></label>
          <label className="space-y-2"><span className="text-[10px] font-black uppercase tracking-widest text-[#475569]">Category</span><select value={effectiveForm.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-bold">{categories.map((item: string) => <option key={item} value={item}>{item}</option>)}</select></label>
          <label className="space-y-2"><span className="text-[10px] font-black uppercase tracking-widest text-[#475569]">Unit</span><Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></label>
          <label className="space-y-2"><span className="text-[10px] font-black uppercase tracking-widest text-[#475569]">Dimensions</span><Input value={form.dimensions} onChange={(e) => setForm({ ...form, dimensions: e.target.value })} /></label>
          <label className="space-y-2"><span className="text-[10px] font-black uppercase tracking-widest text-[#475569]">Sell price</span><Input type="number" value={form.sellPrice} onChange={(e) => setForm({ ...form, sellPrice: e.target.value })} /></label>
          <label className="space-y-2"><span className="text-[10px] font-black uppercase tracking-widest text-[#475569]">Floor price</span><Input type="number" value={form.floorPrice} onChange={(e) => setForm({ ...form, floorPrice: e.target.value })} /></label>
          <label className="space-y-2 md:col-span-2"><span className="text-[10px] font-black uppercase tracking-widest text-[#475569]">Description</span><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
          <label className="md:col-span-2 rounded-[1.4rem] border border-dashed border-[#2563eb]/40 bg-white/65 p-4">
            <span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-[#475569]"><ImagePlus className="h-4 w-4" /> SKU image</span>
            <input type="file" accept="image/*" className="mt-3 block w-full text-sm font-bold" disabled={uploading} onChange={(e) => uploadImage(e.target.files?.[0])} />
            {form.media?.primary && <img src={form.media.primary} alt="SKU preview" className="mt-4 h-44 w-full rounded-2xl object-contain bg-[#f7faff]" />}
          </label>
        </div>
        {message && <p className="mt-4 rounded-2xl bg-[#dbeafe]/70 p-3 text-xs font-black uppercase tracking-wider text-[#1d4ed8]">{message}</p>}
        <Button className="mt-5" disabled={loading || uploading || !form.sku || !form.name || !form.sellPrice} onClick={() => createProduct({ variables: { input: { ...effectiveForm, sellPrice: Number(form.sellPrice), floorPrice: form.floorPrice ? Number(form.floorPrice) : undefined } } })}><Save className="mr-2 h-4 w-4" /> Save SKU</Button>
      </div>

      <div className="mp-card rounded-[2rem] p-5">
        <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-black text-[#0e1a3d]">SKU register</h2><Input placeholder="Search SKU/name" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" /></div>
        <div className="mt-5 max-h-[42rem] space-y-2 overflow-y-auto custom-scrollbar">{products.map((p: any) => <Link href={`/dashboard/products?sku=${p.sku}`} key={p.id} className="flex gap-4 rounded-2xl bg-white/75 p-4 transition hover:bg-white">
          {p.media?.primary && <img src={p.media.primary} alt="" className="h-16 w-16 shrink-0 rounded-xl object-contain bg-[#f7faff]" />}
          <div><p className="font-black text-[#0e1a3d]">{p.sku} · {p.name}</p><p className="text-xs font-bold text-[#475569]">{p.category} · {p.brand} · {p.finish || 'Standard'} · ₹{Number(p.sellPrice || 0).toLocaleString('en-IN')}</p></div>
        </Link>)}</div>
      </div>
    </section>
  </div>;
}
