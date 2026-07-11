'use client';

import { useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import Link from 'next/link';
import { Archive, ArrowLeft, ArrowRight, ImagePlus, PackagePlus, Plus, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const MASTER_DATA = gql`
  query ProductMasterData {
    masterProductCategories(status: "active")
    masterProductBrands(status: "active")
    masterProductFinishes(status: "active")
  }
`;
const GET_PRODUCTS = gql`
  query ProductRegister($search: String, $take: Int, $includeInactive: Boolean) {
    products(search: $search, take: $take, includeInactive: $includeInactive) {
      id sku name category brand finish dimensions unit sellPrice floorPrice taxClass status description media updatedAt
    }
  }
`;
const CREATE_PRODUCT = gql`mutation CreateProduct($input: CreateProductInput!) { createProduct(input: $input) { id sku updatedAt } }`;
const UPDATE_PRODUCT = gql`mutation UpdateProduct($id: ID!, $input: UpdateProductInput!) { updateProduct(id: $id, input: $input) { id sku updatedAt status } }`;
const ARCHIVE_PRODUCT = gql`mutation ArchiveProduct($id: ID!) { deleteProduct(id: $id) { id sku status updatedAt } }`;
const UPLOAD_ASSET = gql`
  mutation UploadProductImage($filename: String!, $contentBase64: String!, $scope: String) {
    uploadStoredAsset(filename: $filename, contentBase64: $contentBase64, scope: $scope) { result }
  }
`;

const emptyProduct = {
  sku: '', name: '', category: '', brand: '', finish: '', dimensions: '', unit: 'PC',
  sellPrice: '', floorPrice: '', taxClass: 'GST_18', description: '', status: 'active',
  updatedAt: '', images: [] as string[],
};

function names(rows: any[] | undefined) {
  return Array.from(new Set((rows || []).map((row: any) => typeof row === 'string' ? row : row?.name).filter(Boolean)));
}

function mediaUrls(media: any): string[] {
  if (!media) return [];
  let source = media;
  if (typeof source === 'string') {
    try { source = JSON.parse(source); } catch { return source ? [source] : []; }
  }
  const gallery = Array.isArray(source.gallery) ? source.gallery : Array.isArray(source.images) ? source.images : [];
  const urls = gallery.map((entry: any) => typeof entry === 'string' ? entry : entry?.url).filter(Boolean);
  const primary = source.primaryUrl || source.primaryImage || source.primary;
  return Array.from(new Set(primary ? [primary, ...urls] : urls));
}

function mediaPayload(images: string[]) {
  return { primaryUrl: images[0] || null, gallery: images.map((url) => ({ url })) };
}

async function fileBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

export default function ProductMasterPage() {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [form, setForm] = useState<any>(emptyProduct);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const { data: masterData } = useQuery(MASTER_DATA);
  const { data, refetch } = useQuery(GET_PRODUCTS, { variables: { search, take: 120, includeInactive: true } });
  const [createProduct, { loading: creating }] = useMutation(CREATE_PRODUCT);
  const [updateProduct, { loading: updating }] = useMutation(UPDATE_PRODUCT);
  const [archiveProduct, { loading: archiving }] = useMutation(ARCHIVE_PRODUCT);
  const [uploadAsset] = useMutation(UPLOAD_ASSET);

  const categories = names(masterData?.masterProductCategories);
  const brands = names(masterData?.masterProductBrands);
  const finishes = names(masterData?.masterProductFinishes);
  const products = data?.products || [];
  const isEditing = Boolean(selectedId);
  const saving = creating || updating;
  const canSave = Boolean(form.name.trim() && form.category.trim() && (isEditing || form.sku.trim()));

  function chooseProduct(product: any) {
    setSelectedId(product.id);
    setForm({
      sku: product.sku || '', name: product.name || '', category: product.category || '', brand: product.brand || '', finish: product.finish || '',
      dimensions: product.dimensions || '', unit: product.unit || 'PC', sellPrice: String(product.sellPrice ?? ''), floorPrice: String(product.floorPrice ?? ''),
      taxClass: product.taxClass || 'GST_18', description: product.description || '', status: product.status || 'active', updatedAt: product.updatedAt || '',
      images: mediaUrls(product.media),
    });
    setMessage(`Editing ${product.sku}. The SKU code is locked to preserve quote, order, and stock history.`);
  }

  function startNew() {
    setSelectedId('');
    setForm(emptyProduct);
    setMessage('');
  }

  async function saveProduct() {
    setMessage('');
    const shared: any = {
      name: form.name, category: form.category, brand: form.brand || undefined, finish: form.finish || undefined,
      dimensions: form.dimensions || undefined, unit: form.unit || undefined, taxClass: form.taxClass || undefined,
      description: form.description || undefined, status: form.status, media: mediaPayload(form.images),
    };
    if (form.sellPrice !== '') shared.sellPrice = Number(form.sellPrice);
    if (form.floorPrice !== '') shared.floorPrice = Number(form.floorPrice);
    try {
      if (isEditing) {
        const result = await updateProduct({ variables: { id: selectedId, input: { ...shared, expectedUpdatedAt: form.updatedAt } } });
        setForm((current: any) => ({ ...current, updatedAt: result.data?.updateProduct?.updatedAt || current.updatedAt }));
        setMessage('Product changes saved with an audit entry.');
      } else {
        const result = await createProduct({ variables: { input: { ...shared, sku: form.sku } } });
        await refetch();
        const created = products.find((product: any) => product.id === result.data?.createProduct?.id);
        if (created) chooseProduct(created);
        else startNew();
        setMessage('SKU created and ready for catalogue, quoting, inventory, and sales orders.');
      }
      await refetch();
    } catch (error: any) {
      setMessage(error.message || 'Unable to save product');
    }
  }

  async function uploadImages(files: FileList | null) {
    if (!files?.length) return;
    const pending = Array.from(files);
    if (form.images.length + pending.length > 8) {
      setMessage('A product can have at most 8 images.');
      return;
    }
    setUploading(true);
    try {
      const urls: string[] = [];
      for (const file of pending) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size <= 0 || file.size > 5 * 1024 * 1024) {
          throw new Error(`${file.name}: use a JPG, PNG, or WebP image smaller than 5 MB.`);
        }
        const result = await uploadAsset({ variables: { filename: file.name, contentBase64: await fileBase64(file), scope: 'product-image' } });
        const publicUrl = result.data?.uploadStoredAsset?.result?.publicUrl;
        if (!publicUrl) throw new Error(`${file.name}: upload did not return an image URL.`);
        urls.push(publicUrl);
      }
      setForm((current: any) => ({ ...current, images: [...current.images, ...urls] }));
      setMessage(`${urls.length} image${urls.length === 1 ? '' : 's'} attached. Save to publish the gallery.`);
    } catch (error: any) {
      setMessage(error.message || 'Image upload failed');
    } finally {
      setUploading(false);
    }
  }

  function moveImage(index: number, direction: -1 | 1) {
    setForm((current: any) => {
      const target = index + direction;
      if (target < 0 || target >= current.images.length) return current;
      const images = [...current.images];
      [images[index], images[target]] = [images[target], images[index]];
      return { ...current, images };
    });
  }

  async function archiveCurrent() {
    if (!selectedId || !window.confirm(`Archive ${form.sku}? It will remain in history but cannot be newly quoted.`)) return;
    try {
      await archiveProduct({ variables: { id: selectedId } });
      await refetch();
      setForm((current: any) => ({ ...current, status: 'archived' }));
      setMessage(`${form.sku} archived. Its SKU and history remain unchanged.`);
    } catch (error: any) { setMessage(error.message || 'Unable to archive product'); }
  }

  return <div className="space-y-6 pb-10">
    <section className="mp-card rounded-r5 border border-[#e4e4e7] bg-white p-6 text-[#18181b]">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div><p className="text-xs font-medium uppercase tracking-[0.14em] text-[#71717a]">Product master</p><h1 className="mt-2 font-display text-3xl font-bold">SKU details, prices and gallery</h1><p className="mt-2 max-w-3xl text-sm text-[#52525b]">SKU codes are permanent. All other catalogue details can be updated with a traceable audit history.</p></div>
        <Button variant="outline" onClick={startNew}><Plus className="mr-2 h-4 w-4" /> New SKU</Button>
      </div>
      <div className="mt-5 flex flex-wrap gap-2 text-xs font-bold"><Link href="/dashboard/master-data/categories" className="rounded-lg border border-[#bfdbfe] bg-[#eff6ff] px-3 py-2 text-[#1d4ed8]">Category master</Link><Link href="/dashboard/master-data/brands" className="rounded-lg border border-[#e4e4e7] px-3 py-2 text-[#52525b]">Brand master</Link><Link href="/dashboard/master-data/finishes" className="rounded-lg border border-[#e4e4e7] px-3 py-2 text-[#52525b]">Finish master</Link></div>
    </section>

    <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
      <div className="mp-card rounded-r5 p-5">
        <div className="flex items-center justify-between"><div className="flex items-center gap-3"><PackagePlus className="h-6 w-6 text-[#2563eb]" /><h2 className="text-xl font-semibold text-[#18181b]">{isEditing ? 'Edit SKU' : 'Add SKU'}</h2></div>{isEditing ? <span className="rounded-full bg-[#eff6ff] px-3 py-1 text-xs font-bold text-[#1d4ed8]">{form.status}</span> : null}</div>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <label className="space-y-2"><span className="text-xs font-medium uppercase tracking-widest text-[#52525b]">SKU code</span><Input value={form.sku} disabled={isEditing} onChange={(event) => setForm({ ...form, sku: event.target.value })} placeholder="Example: GRO-12345" /></label>
          <label className="space-y-2"><span className="text-xs font-medium uppercase tracking-widest text-[#52525b]">Name</span><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label className="space-y-2"><span className="text-xs font-medium uppercase tracking-widest text-[#52525b]">Category</span><Input list="product-category-options" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} /><datalist id="product-category-options">{categories.map((item: string) => <option key={item} value={item} />)}</datalist></label>
          <label className="space-y-2"><span className="text-xs font-medium uppercase tracking-widest text-[#52525b]">Brand</span><Input list="product-brand-options" value={form.brand} onChange={(event) => setForm({ ...form, brand: event.target.value })} /><datalist id="product-brand-options">{brands.map((item: string) => <option key={item} value={item} />)}</datalist></label>
          <label className="space-y-2"><span className="text-xs font-medium uppercase tracking-widest text-[#52525b]">Finish</span><Input list="product-finish-options" value={form.finish} onChange={(event) => setForm({ ...form, finish: event.target.value })} /><datalist id="product-finish-options">{finishes.map((item: string) => <option key={item} value={item} />)}</datalist></label>
          <label className="space-y-2"><span className="text-xs font-medium uppercase tracking-widest text-[#52525b]">Unit</span><Input value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })} /></label>
          <label className="space-y-2"><span className="text-xs font-medium uppercase tracking-widest text-[#52525b]">Dimensions</span><Input value={form.dimensions} onChange={(event) => setForm({ ...form, dimensions: event.target.value })} /></label>
          <label className="space-y-2"><span className="text-xs font-medium uppercase tracking-widest text-[#52525b]">Tax class</span><select value={form.taxClass} onChange={(event) => setForm({ ...form, taxClass: event.target.value })} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"><option value="GST_18">GST 18%</option><option value="GST_12">GST 12%</option><option value="GST_5">GST 5%</option><option value="EXEMPT">Exempt</option></select></label>
          <label className="space-y-2"><span className="text-xs font-medium uppercase tracking-widest text-[#52525b]">Sell price</span><Input type="number" min={0} value={form.sellPrice} onChange={(event) => setForm({ ...form, sellPrice: event.target.value })} /></label>
          <label className="space-y-2"><span className="text-xs font-medium uppercase tracking-widest text-[#52525b]">Floor price</span><Input type="number" min={0} value={form.floorPrice} onChange={(event) => setForm({ ...form, floorPrice: event.target.value })} /></label>
          <label className="space-y-2"><span className="text-xs font-medium uppercase tracking-widest text-[#52525b]">Status</span><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"><option value="active">Active</option><option value="inactive">Inactive</option><option value="archived">Archived</option></select></label>
          <label className="space-y-2 md:col-span-2"><span className="text-xs font-medium uppercase tracking-widest text-[#52525b]">Description</span><textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className="min-h-20 w-full rounded-lg border border-input bg-background p-3 text-sm" /></label>
        </div>
        <div className="mt-5 rounded-lg border border-dashed border-[#2563eb]/40 bg-[#f7faff] p-4"><div className="flex flex-wrap items-center justify-between gap-3"><span className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-[#52525b]"><ImagePlus className="h-4 w-4" /> Product gallery</span><label className="cursor-pointer rounded-lg bg-[#18181b] px-3 py-2 text-xs font-bold text-white"><input type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" disabled={uploading} onChange={(event) => uploadImages(event.target.files)} />{uploading ? 'Uploading...' : 'Add images'}</label></div><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">{form.images.map((url: string, index: number) => <div key={url} className="relative overflow-hidden rounded-lg border bg-white"><img src={url} alt={`Product image ${index + 1}`} className="h-28 w-full object-contain p-1" /><div className="flex justify-between border-t p-1"><button type="button" title="Move image earlier" onClick={() => moveImage(index, -1)} disabled={index === 0} className="rounded p-1 disabled:opacity-30"><ArrowLeft className="h-3.5 w-3.5" /></button><button type="button" title="Remove image" onClick={() => setForm((current: any) => ({ ...current, images: current.images.filter((_: string, i: number) => i !== index) }))} className="rounded p-1 text-red-700"><Trash2 className="h-3.5 w-3.5" /></button><button type="button" title="Move image later" onClick={() => moveImage(index, 1)} disabled={index === form.images.length - 1} className="rounded p-1 disabled:opacity-30"><ArrowRight className="h-3.5 w-3.5" /></button></div>{index === 0 ? <span className="absolute left-1 top-1 rounded bg-[#2563eb] px-1.5 py-0.5 text-[10px] font-bold text-white">Primary</span> : null}</div>)}</div></div>
        {message ? <p role="status" className="mt-4 rounded-lg bg-[#eff6ff] p-3 text-sm font-semibold text-[#1d4ed8]">{message}</p> : null}
        <div className="mt-5 flex flex-wrap gap-3"><Button disabled={saving || uploading || !canSave} onClick={saveProduct}><Save className="mr-2 h-4 w-4" /> {saving ? 'Saving...' : isEditing ? 'Save changes' : 'Create SKU'}</Button>{isEditing && form.status !== 'archived' ? <Button variant="outline" disabled={archiving} onClick={archiveCurrent}><Archive className="mr-2 h-4 w-4" /> Archive SKU</Button> : null}</div>
      </div>

      <div className="mp-card rounded-r5 p-5"><div className="flex items-center justify-between gap-3"><h2 className="text-xl font-semibold text-[#18181b]">SKU register</h2><Input placeholder="Search SKU/name" value={search} onChange={(event) => setSearch(event.target.value)} className="max-w-xs" /></div><div className="mt-5 max-h-[54rem] space-y-2 overflow-y-auto custom-scrollbar">{products.map((product: any) => { const image = mediaUrls(product.media)[0]; return <button type="button" onClick={() => chooseProduct(product)} key={product.id} className={`flex w-full gap-4 rounded-lg p-3 text-left transition ${selectedId === product.id ? 'bg-[#dbeafe]' : 'bg-white hover:bg-[#f7faff]'}`}>{image ? <img src={image} alt="" className="h-14 w-14 shrink-0 rounded-lg bg-[#f7faff] object-contain p-1" /> : <div className="h-14 w-14 shrink-0 rounded-lg bg-[#f4f4f5]" />}<div className="min-w-0"><p className="truncate font-semibold text-[#18181b]">{product.sku} · {product.name}</p><p className="mt-1 text-xs font-bold text-[#52525b]">{[product.category, product.brand, product.finish].filter(Boolean).join(' · ')} · ₹{Number(product.sellPrice || 0).toLocaleString('en-IN')}</p><span className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${product.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{product.status}</span></div></button>; })}{!products.length ? <p className="p-5 text-sm font-semibold text-[#52525b]">No products found.</p> : null}</div></div>
    </section>
  </div>;
}
