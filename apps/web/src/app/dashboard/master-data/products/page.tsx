'use client';

import { useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import Link from 'next/link';
import { Archive, ArrowLeft, ArrowRight, Boxes, ChevronLeft, ChevronRight, ImagePlus, PackagePlus, Plus, Save, ScanLine, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDebouncedValue } from '@/hooks/use-debounced-value';

const MASTER_DATA = gql`
  query ProductMasterData {
    productMasters
  }
`;
const GET_PRODUCTS = gql`
  query ProductRegister($search: String, $take: Int, $skip: Int, $includeInactive: Boolean) {
    products(search: $search, take: $take, skip: $skip, includeInactive: $includeInactive) {
      id sku internalCode name category brand finish dimensions unit sellPrice floorPrice taxClass status description media updatedAt
      categoryId brandId finishId materialId tileSizeId baseUom purchaseUom salesUom piecesPerPack coveragePerPack hsnCode allowLoose
    }
  }
`;
const CREATE_PRODUCT = gql`mutation CreateProduct($input: CreateProductInput!) { createProduct(input: $input) {
  id sku internalCode name category brand finish dimensions unit sellPrice floorPrice taxClass status description media updatedAt
  categoryId brandId finishId materialId tileSizeId baseUom purchaseUom salesUom piecesPerPack coveragePerPack hsnCode allowLoose
} }`;
const UPDATE_PRODUCT = gql`mutation UpdateProduct($id: ID!, $input: UpdateProductInput!) { updateProduct(id: $id, input: $input) { id sku updatedAt status } }`;
const ARCHIVE_PRODUCT = gql`mutation ArchiveProduct($id: ID!) { deleteProduct(id: $id) { id sku status updatedAt } }`;
const UPLOAD_ASSET = gql`
  mutation UploadProductImage($filename: String!, $contentBase64: String!, $scope: String) {
    uploadStoredAsset(filename: $filename, contentBase64: $contentBase64, scope: $scope) { result }
  }
`;

const emptyProduct = {
  sku: '', internalCode: '', name: '', category: '', brand: '', finish: '', dimensions: '', unit: 'PC',
  materialId: '', tileSizeId: '', baseUom: 'PC', purchaseUom: 'PC', salesUom: 'PC', piecesPerPack: '1', coveragePerPack: '', hsnCode: '', allowLoose: false,
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

function mutationErrorMessage(error: any, fallback: string) {
  const errors = [
    ...(Array.isArray(error?.graphQLErrors) ? error.graphQLErrors : []),
    ...(Array.isArray(error?.networkError?.result?.errors) ? error.networkError.result.errors : []),
  ];
  const details = Array.from(new Set(errors.map((item: any) => item?.message).filter(Boolean)));
  return details.length ? details.join(' | ') : error?.message || fallback;
}

async function fileBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

export default function ProductMasterPage() {
  const pageSize = 50;
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState('');
  const [form, setForm] = useState<any>(emptyProduct);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'info' | 'success' | 'error'>('info');
  const { data: masterData } = useQuery(MASTER_DATA);
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const { data, loading: loadingProducts, refetch } = useQuery(GET_PRODUCTS, { variables: { search: debouncedSearch || undefined, take: pageSize + 1, skip: page * pageSize, includeInactive: true } });
  const [createProduct, { loading: creating }] = useMutation(CREATE_PRODUCT);
  const [updateProduct, { loading: updating }] = useMutation(UPDATE_PRODUCT);
  const [archiveProduct, { loading: archiving }] = useMutation(ARCHIVE_PRODUCT);
  const [uploadAsset] = useMutation(UPLOAD_ASSET);

  const masters = masterData?.productMasters || {};
  const categories = masters.categories || [];
  const brands = masters.brands || [];
  const finishes = masters.finishes || [];
  const materials = masters.materials || [];
  const tileSizes = masters.tileSizes || [];
  const uoms = masters.uoms || [];
  const taxCodes = masters.taxCodes || [];
  const productPage = data?.products || [];
  const products = productPage.slice(0, pageSize);
  const hasNextPage = productPage.length > pageSize;
  const isEditing = Boolean(selectedId);
  const saving = creating || updating;
  const isTile = String(form.category || '').trim().toLowerCase() === 'tiles';
  const areaPriced = isTile && ['SQFT', 'SQM', 'M2'].includes(String(form.salesUom || '').toUpperCase());
  const canSave = Boolean(form.name.trim() && form.category.trim() && form.internalCode.trim() && (isEditing || form.sku.trim()));

  function chooseProduct(product: any) {
    setSelectedId(product.id);
    setForm({
      sku: product.sku || '', internalCode: product.internalCode || product.sku || '', name: product.name || '', category: product.category || '', brand: product.brand || '', finish: product.finish || '',
      dimensions: product.dimensions || '', unit: product.unit || 'PC', sellPrice: String(product.sellPrice ?? ''), floorPrice: String(product.floorPrice ?? ''),
      taxClass: product.taxClass || 'GST_18', description: product.description || '', status: product.status || 'active', updatedAt: product.updatedAt || '',
      materialId: product.materialId || '', tileSizeId: product.tileSizeId || '', baseUom: product.baseUom || 'PC', purchaseUom: product.purchaseUom || 'PC',
      salesUom: product.salesUom || 'PC', piecesPerPack: String(product.piecesPerPack || 1), coveragePerPack: String(product.coveragePerPack || ''),
      hsnCode: product.hsnCode || '', allowLoose: Boolean(product.allowLoose),
      images: mediaUrls(product.media),
    });
    setMessageTone('info');
    setMessage(`Editing ${product.sku}. The SKU code is locked to preserve quote, order, and stock history.`);
  }

  function startNew() {
    setSelectedId('');
    setForm(emptyProduct);
    setMessage('');
    setMessageTone('info');
  }

  function changeCategory(category: string) {
    const nextIsTile = category.trim().toLowerCase() === 'tiles';
    setForm((current: any) => {
      const wasTile = String(current.category || '').trim().toLowerCase() === 'tiles';
      if (nextIsTile) return {
        ...current,
        category,
        unit: wasTile ? current.unit : 'BOX',
        baseUom: wasTile ? current.baseUom : 'PC',
        purchaseUom: wasTile ? current.purchaseUom : 'BOX',
        salesUom: wasTile ? current.salesUom : 'BOX',
      };
      const unit = wasTile ? 'PC' : current.unit || 'PC';
      return {
        ...current,
        category,
        tileSizeId: '',
        unit,
        baseUom: unit,
        purchaseUom: unit,
        salesUom: unit,
        piecesPerPack: '1',
        coveragePerPack: '',
        allowLoose: false,
      };
    });
  }

  async function saveProduct() {
    setMessage('');
    const shared: any = {
      name: form.name, internalCode: form.internalCode, category: form.category, brand: form.brand || undefined, finish: form.finish || undefined,
      dimensions: form.dimensions || undefined, unit: form.unit || undefined, taxClass: form.taxClass || undefined,
      description: form.description || undefined, status: form.status,
      materialId: form.materialId || undefined,
      hsnCode: form.hsnCode || (isEditing ? '' : undefined),
    };
    if (isEditing || form.images.length) shared.media = mediaPayload(form.images);
    if (form.sellPrice !== '' || isEditing) shared.sellPrice = Number(form.sellPrice || 0);
    if (form.floorPrice !== '' || isEditing) shared.floorPrice = Number(form.floorPrice || 0);
    if (isTile) {
      Object.assign(shared, {
        tileSizeId: form.tileSizeId || (isEditing ? null : undefined),
        unit: form.purchaseUom || 'BOX',
        baseUom: form.baseUom || 'PC',
        purchaseUom: form.purchaseUom || 'BOX',
        salesUom: form.salesUom || 'BOX',
        piecesPerPack: Number(form.piecesPerPack || 1),
        coveragePerPack: Number(form.coveragePerPack || 0),
        allowLoose: Boolean(form.allowLoose),
      });
    } else {
      const unit = form.unit || 'PC';
      Object.assign(shared, {
        unit,
        baseUom: unit,
        purchaseUom: unit,
        salesUom: unit,
        piecesPerPack: 1,
        coveragePerPack: 0,
        allowLoose: false,
        ...(isEditing ? { tileSizeId: null } : {}),
      });
    }
    try {
      if (isEditing) {
        const result = await updateProduct({ variables: { id: selectedId, input: { ...shared, expectedUpdatedAt: form.updatedAt } } });
        if ((result as any).errors?.length) throw new Error((result as any).errors.map((item: any) => item.message).join(' | '));
        setForm((current: any) => ({ ...current, updatedAt: result.data?.updateProduct?.updatedAt || current.updatedAt }));
        setMessageTone('success');
        setMessage('Product changes saved with an audit entry.');
      } else {
        const result = await createProduct({ variables: { input: { ...shared, sku: form.sku } } });
        if ((result as any).errors?.length) throw new Error((result as any).errors.map((item: any) => item.message).join(' | '));
        const created = result.data?.createProduct;
        if (created) chooseProduct(created);
        else startNew();
        setMessageTone('success');
        setMessage('SKU created and ready for catalogue, quoting, inventory, and sales orders.');
      }
      await refetch();
    } catch (error: any) {
      setMessageTone('error');
      setMessage(mutationErrorMessage(error, 'Unable to save product'));
    }
  }

  async function uploadImages(files: FileList | null) {
    if (!files?.length) return;
    const pending = Array.from(files);
    if (form.images.length + pending.length > 8) {
      setMessageTone('error');
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
      setMessageTone('success');
      setMessage(`${urls.length} image${urls.length === 1 ? '' : 's'} attached. Save to publish the gallery.`);
    } catch (error: any) {
      setMessageTone('error');
      setMessage(mutationErrorMessage(error, 'Image upload failed'));
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
      setMessageTone('success');
      setMessage(`${form.sku} archived. Its SKU and history remain unchanged.`);
    } catch (error: any) {
      setMessageTone('error');
      setMessage(mutationErrorMessage(error, 'Unable to archive product'));
    }
  }

  return <div className="space-y-6 pb-10">
    <section className="border-b border-[var(--line)] bg-[var(--surface)] px-1 py-5 text-[var(--ink-1)]">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div><p className="text-xs font-semibold uppercase text-[var(--ink-4)]">Product master</p><h1 className="mt-1 font-display text-3xl font-bold">Display code to saleable SKU</h1><p className="mt-2 max-w-3xl text-sm text-[var(--ink-3)]">Register each quoteable design once. Display samples stay non-saleable; opening stock and GRNs create physical lots.</p></div>
        <Button variant="outline" onClick={startNew}><Plus className="mr-2 h-4 w-4" /> New SKU</Button>
      </div>
      <div className="mt-4 grid max-w-3xl grid-cols-3 overflow-hidden rounded-lg border border-[var(--line)] text-xs font-semibold"><span className="flex items-center gap-2 bg-[#eef5ff] px-3 py-2 text-[#174ea6]"><ScanLine className="h-4 w-4" />1. Display code</span><span className="flex items-center gap-2 border-l border-[var(--line)] px-3 py-2"><Boxes className="h-4 w-4" />2. Product SKU</span><span className="flex items-center gap-2 border-l border-[var(--line)] px-3 py-2"><PackagePlus className="h-4 w-4" />3. Opening / GRN stock</span></div>
    </section>

    <section className="grid min-w-0 gap-6 xl:grid-cols-[1.1fr_0.9fr]">
      <div className="mp-card min-w-0 rounded-r5 p-5">
        <div className="flex items-center justify-between"><div className="flex items-center gap-3"><PackagePlus className="h-6 w-6 text-[#2563eb]" /><h2 className="text-xl font-semibold text-[#18181b]">{isEditing ? 'Edit SKU' : 'Add SKU'}</h2></div>{isEditing ? <span className="rounded-full bg-[#eff6ff] px-3 py-1 text-xs font-bold text-[#1d4ed8]">{form.status}</span> : null}</div>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <label className="space-y-2"><span className="text-xs font-medium uppercase tracking-widest text-[#52525b]">SKU code *</span><Input value={form.sku} disabled={isEditing} onChange={(event) => setForm({ ...form, sku: event.target.value })} placeholder="Example: GRO-12345" /></label>
          <label className="space-y-2"><span className="text-xs font-medium uppercase tracking-widest text-[#52525b]">Internal / display code *</span><Input value={form.internalCode} onChange={(event) => setForm({ ...form, internalCode: event.target.value })} placeholder="Existing showroom code" /></label>
          <label className="space-y-2"><span className="text-xs font-medium uppercase tracking-widest text-[#52525b]">Name *</span><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label className="space-y-2"><span className="text-xs font-medium uppercase tracking-widest text-[#52525b]">Category *</span><select value={form.category} onChange={(event) => changeCategory(event.target.value)} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"><option value="">Select category</option>{categories.map((item: any) => <option key={item.id} value={item.name}>{item.name}</option>)}</select></label>
          <label className="space-y-2"><span className="text-xs font-medium uppercase tracking-widest text-[#52525b]">Brand <span className="normal-case tracking-normal text-[#71717a]">(optional)</span></span><select value={form.brand} onChange={(event) => setForm({ ...form, brand: event.target.value })} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"><option value="">No brand</option>{brands.map((item: any) => <option key={item.id} value={item.name}>{item.name}</option>)}</select></label>
          <label className="space-y-2"><span className="text-xs font-medium uppercase tracking-widest text-[#52525b]">Finish <span className="normal-case tracking-normal text-[#71717a]">(optional)</span></span><select value={form.finish} onChange={(event) => setForm({ ...form, finish: event.target.value })} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"><option value="">No finish</option>{finishes.map((item: any) => <option key={item.id} value={item.name}>{item.name}</option>)}</select></label>
          <label className="space-y-2"><span className="text-xs font-medium uppercase tracking-widest text-[#52525b]">Material <span className="normal-case tracking-normal text-[#71717a]">(optional)</span></span><select value={form.materialId} onChange={(event) => setForm({ ...form, materialId: event.target.value })} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"><option value="">No material</option>{materials.map((item: any) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          {!isTile ? <label className="space-y-2"><span className="text-xs font-medium uppercase tracking-widest text-[#52525b]">Unit <span className="normal-case tracking-normal text-[#71717a]">(optional)</span></span><select value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">{uoms.map((item: any) => <option key={item.code} value={item.code}>{item.code} · {item.name}</option>)}</select></label> : null}
          {isTile ? <div className="space-y-4 border-y border-[#dbeafe] bg-[#f7faff] px-1 py-4 md:col-span-2"><div><h3 className="text-sm font-semibold text-[#18181b]">Optional tile and box details</h3><p className="mt-1 text-xs text-[#52525b]">Add these when known. The SKU can be saved first and completed before area-priced quoting or inward.</p></div><div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-2"><span className="text-xs font-medium uppercase tracking-widest text-[#52525b]">Tile size</span><select value={form.tileSizeId} onChange={(event) => setForm({ ...form, tileSizeId: event.target.value })} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"><option value="">Not specified</option>{tileSizes.map((item: any) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label className="space-y-2"><span className="text-xs font-medium uppercase tracking-widest text-[#52525b]">Stock / purchase UOM</span><select value={form.purchaseUom} onChange={(event) => setForm({ ...form, purchaseUom: event.target.value, unit: event.target.value })} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">{uoms.map((item: any) => <option key={item.code} value={item.code}>{item.code} · {item.name}</option>)}</select></label>
            <label className="space-y-2"><span className="text-xs font-medium uppercase tracking-widest text-[#52525b]">Sales / rate UOM</span><select value={form.salesUom} onChange={(event) => setForm({ ...form, salesUom: event.target.value })} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">{uoms.map((item: any) => <option key={item.code} value={item.code}>{item.code} · {item.name}</option>)}</select></label>
            <label className="space-y-2"><span className="text-xs font-medium uppercase tracking-widest text-[#52525b]">Base UOM</span><select value={form.baseUom} onChange={(event) => setForm({ ...form, baseUom: event.target.value })} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">{uoms.map((item: any) => <option key={item.code} value={item.code}>{item.code} · {item.name}</option>)}</select></label>
            <label className="space-y-2"><span className="text-xs font-medium uppercase tracking-widest text-[#52525b]">Pieces / box</span><Input type="number" min={1} value={form.piecesPerPack} onChange={(event) => setForm({ ...form, piecesPerPack: event.target.value })} /></label>
            <label className="space-y-2"><span className="text-xs font-medium uppercase tracking-widest text-[#52525b]">Coverage / {form.purchaseUom || 'box'} {areaPriced ? `(${form.salesUom})` : ''}</span><Input type="number" min={0} step="0.01" value={form.coveragePerPack} onChange={(event) => setForm({ ...form, coveragePerPack: event.target.value })} />{areaPriced && Number(form.coveragePerPack || 0) <= 0 ? <span className="text-xs font-semibold text-amber-700">Save is allowed; add coverage before quoting by area.</span> : null}</label>
            <label className="flex items-start gap-3 rounded-lg border border-[#dbeafe] bg-white p-3 md:col-span-2"><input type="checkbox" checked={form.allowLoose} onChange={(event) => setForm({ ...form, allowLoose: event.target.checked })} className="mt-0.5 h-4 w-4 accent-[#2563eb]" /><span><b className="block text-sm text-[#18181b]">Allow loose-piece sale</b><span className="mt-1 block text-xs text-[#52525b]">Enable only when pieces may be sold outside a complete box.</span></span></label>
          </div></div> : null}
          <label className="space-y-2"><span className="text-xs font-medium uppercase tracking-widest text-[#52525b]">Dimensions <span className="normal-case tracking-normal text-[#71717a]">(optional)</span></span><Input value={form.dimensions} onChange={(event) => setForm({ ...form, dimensions: event.target.value })} /></label>
          <label className="space-y-2"><span className="text-xs font-medium uppercase tracking-widest text-[#52525b]">Tax class</span><select value={form.taxClass} onChange={(event) => setForm({ ...form, taxClass: event.target.value, hsnCode: taxCodes.find((item: any) => item.code === event.target.value)?.hsnCode || form.hsnCode })} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">{taxCodes.map((item: any) => <option key={item.code} value={item.code}>{item.name} · {item.rate}%</option>)}</select></label>
          <label className="space-y-2"><span className="text-xs font-medium uppercase tracking-widest text-[#52525b]">HSN code <span className="normal-case tracking-normal text-[#71717a]">(optional)</span></span><Input value={form.hsnCode} onChange={(event) => setForm({ ...form, hsnCode: event.target.value })} /></label>
          <label className="space-y-2"><span className="text-xs font-medium uppercase tracking-widest text-[#52525b]">Sell price <span className="normal-case tracking-normal text-[#71717a]">(optional)</span></span><Input type="number" min={0} value={form.sellPrice} onChange={(event) => setForm({ ...form, sellPrice: event.target.value })} /></label>
          <label className="space-y-2"><span className="text-xs font-medium uppercase tracking-widest text-[#52525b]">Floor price <span className="normal-case tracking-normal text-[#71717a]">(optional)</span></span><Input type="number" min={0} value={form.floorPrice} onChange={(event) => setForm({ ...form, floorPrice: event.target.value })} /></label>
          <label className="space-y-2"><span className="text-xs font-medium uppercase tracking-widest text-[#52525b]">Status</span><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"><option value="active">Active</option><option value="inactive">Inactive</option><option value="archived">Archived</option></select></label>
          <label className="space-y-2 md:col-span-2"><span className="text-xs font-medium uppercase tracking-widest text-[#52525b]">Description</span><textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className="min-h-20 w-full rounded-lg border border-input bg-background p-3 text-sm" /></label>
        </div>
        <div className="mt-5 rounded-lg border border-dashed border-[#2563eb]/40 bg-[#f7faff] p-4"><div className="flex flex-wrap items-center justify-between gap-3"><span className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-[#52525b]"><ImagePlus className="h-4 w-4" /> Product gallery <span className="normal-case tracking-normal text-[#71717a]">(optional)</span></span><label className="cursor-pointer rounded-lg bg-[#18181b] px-3 py-2 text-xs font-bold text-white"><input type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" disabled={uploading} onChange={(event) => uploadImages(event.target.files)} />{uploading ? 'Uploading...' : 'Add images'}</label></div><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">{form.images.map((url: string, index: number) => <div key={url} className="relative overflow-hidden rounded-lg border bg-white"><img src={url} alt={`Product image ${index + 1}`} className="h-28 w-full object-contain p-1" /><div className="flex justify-between border-t p-1"><button type="button" title="Move image earlier" onClick={() => moveImage(index, -1)} disabled={index === 0} className="rounded p-1 disabled:opacity-30"><ArrowLeft className="h-3.5 w-3.5" /></button><button type="button" title="Remove image" onClick={() => setForm((current: any) => ({ ...current, images: current.images.filter((_: string, i: number) => i !== index) }))} className="rounded p-1 text-red-700"><Trash2 className="h-3.5 w-3.5" /></button><button type="button" title="Move image later" onClick={() => moveImage(index, 1)} disabled={index === form.images.length - 1} className="rounded p-1 disabled:opacity-30"><ArrowRight className="h-3.5 w-3.5" /></button></div>{index === 0 ? <span className="absolute left-1 top-1 rounded bg-[#2563eb] px-1.5 py-0.5 text-[10px] font-bold text-white">Primary</span> : null}</div>)}</div></div>
        {message ? <p role={messageTone === 'error' ? 'alert' : 'status'} className={`mt-4 rounded-lg border p-3 text-sm font-semibold ${messageTone === 'error' ? 'border-red-200 bg-red-50 text-red-800' : messageTone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-blue-200 bg-[#eff6ff] text-[#1d4ed8]'}`}>{message}</p> : null}
        <p className="mt-4 text-xs font-medium text-[#71717a]">* Required: SKU code, internal code, name, and category. All other fields may be completed later.</p>
        <div className="mt-3 flex flex-wrap gap-3"><Button disabled={saving || uploading || !canSave} onClick={saveProduct}><Save className="mr-2 h-4 w-4" /> {saving ? 'Saving...' : isEditing ? 'Save changes' : 'Create SKU'}</Button>{isEditing && form.status !== 'archived' ? <Button variant="outline" disabled={archiving} onClick={archiveCurrent}><Archive className="mr-2 h-4 w-4" /> Archive SKU</Button> : null}</div>
      </div>

      <div className="mp-card min-w-0 rounded-r5 p-5"><div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><h2 className="text-xl font-semibold text-[#18181b]">SKU register</h2><Input placeholder="Search SKU/name" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} className="w-full sm:max-w-xs" /></div><div className="mt-5 max-h-[54rem] min-w-0 space-y-2 overflow-y-auto custom-scrollbar">{loadingProducts && !products.length ? <p className="p-5 text-sm font-semibold text-[#52525b]">Loading products...</p> : null}{products.map((product: any) => { const image = mediaUrls(product.media)[0]; return <button type="button" onClick={() => chooseProduct(product)} key={product.id} className={`flex min-w-0 w-full gap-4 rounded-lg p-3 text-left transition ${selectedId === product.id ? 'bg-[#dbeafe]' : 'bg-white hover:bg-[#f7faff]'}`}>{image ? <img src={image} alt="" loading="lazy" decoding="async" className="h-14 w-14 shrink-0 rounded-lg bg-[#f7faff] object-contain p-1" /> : <div className="h-14 w-14 shrink-0 rounded-lg bg-[#f4f4f5]" />}<div className="min-w-0"><p className="truncate font-semibold text-[#18181b]">{product.sku} · {product.name}</p><p className="mt-1 truncate text-xs font-bold text-[#52525b]">{[product.category, product.brand, product.finish].filter(Boolean).join(' · ')} · ₹{Number(product.sellPrice || 0).toLocaleString('en-IN')}</p><span className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${product.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{product.status}</span></div></button>; })}{!loadingProducts && !products.length ? <p className="p-5 text-sm font-semibold text-[#52525b]">No products found.</p> : null}</div>{page > 0 || hasNextPage ? <nav aria-label="Product register pages" className="mt-4 flex items-center justify-between border-t border-[#e4e4e7] pt-4"><Button variant="outline" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}><ChevronLeft className="mr-2 h-4 w-4" />Previous</Button><span className="text-xs font-semibold text-[#71717a]">Page {page + 1}</span><Button variant="outline" disabled={!hasNextPage} onClick={() => setPage((current) => current + 1)}>Next<ChevronRight className="ml-2 h-4 w-4" /></Button></nav> : null}</div>
    </section>
  </div>;
}
