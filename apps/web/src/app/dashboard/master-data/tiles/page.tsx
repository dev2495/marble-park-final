'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import { Boxes, Camera, ChevronLeft, ChevronRight, ImageOff, MapPin, PackagePlus, Printer, Search, Store, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QueryErrorBanner } from '@/components/query-state';
import { useDebouncedValue } from '@/hooks/use-debounced-value';

const DATA = gql`query TileDesignWorkspace($search: String, $skip: Int, $take: Int) {
  products(search: $search, category: "Tiles", skip: $skip, take: $take) { id sku internalCode name category brand finish dimensions salesUom piecesPerPack coveragePerPack media status }
  displaySamples(status: "all", take: 300)
  stockLocations(status: "active")
  tileDesignStats
  tileSizes
}`;
const CREATE_SAMPLE = gql`mutation CreateDisplaySample($input: DisplaySampleInput!) { createDisplaySample(input: $input) }`;
const UPDATE_SAMPLE = gql`mutation UpdateDisplaySample($id: ID!, $input: UpdateDisplaySampleInput!) { updateDisplaySample(id: $id, input: $input) }`;
const CREATE_LABEL = gql`mutation CreateDisplayLabel($input: InternalLabelJobInput!) { createInternalLabelJob(input: $input) }`;
const ALIASES = gql`query TileAliases($productId: ID!) { productAliases(productId: $productId) }`;
const SAVE_ALIAS = gql`mutation SaveTileAlias($input: ProductAliasInput!) { saveProductAlias(input: $input) }`;
const ARCHIVE_ALIAS = gql`mutation ArchiveTileAlias($id: ID!, $reason: String!) { archiveProductAlias(id: $id, reason: $reason) }`;

const emptySample = { id: '', productId: '', internalCode: '', locationId: '', displayZone: '', displayPosition: '', imageUrl: '', status: 'active' };

function productImage(product: any) {
  return product?.media?.primaryUrl || product?.media?.imageUrl || product?.media?.url || product?.media?.images?.[0]?.url || product?.media?.images?.[0] || '';
}

function Metric({ label, value, tone = 'text-[var(--ink)]' }: { label: string; value: number; tone?: string }) {
  return <div className="border-l border-[var(--line)] pl-4 first:border-l-0 first:pl-0"><p className={`text-2xl font-semibold tabular-nums ${tone}`}>{value.toLocaleString('en-IN')}</p><p className="mt-0.5 text-[11px] font-medium text-[var(--ink-4)]">{label}</p></div>;
}

export default function TileMasterPage() {
  const [tab, setTab] = useState<'designs' | 'display'>('designs');
  const [search, setSearch] = useState('');
  const [designPage, setDesignPage] = useState(0);
  const [sample, setSample] = useState<any>(emptySample);
  const [notice, setNotice] = useState('');
  const [aliasProduct, setAliasProduct] = useState<any>(null);
  const [aliasValue, setAliasValue] = useState('');
  const [aliasType, setAliasType] = useState('legacy_code');
  const [archiveReason, setArchiveReason] = useState('Superseded showroom or supplier code');
  const debouncedSearch = useDebouncedValue(search, 300);
  const designPageSize = 50;
  const { data, loading, error, refetch } = useQuery(DATA, { variables: { search: debouncedSearch || undefined, skip: designPage * designPageSize, take: designPageSize + 1 }, fetchPolicy: 'cache-and-network' });
  const { data: aliasData, refetch: refetchAliases } = useQuery(ALIASES, { variables: { productId: aliasProduct?.id || '' }, skip: !aliasProduct?.id, fetchPolicy: 'cache-and-network' });
  const [createSample, createState] = useMutation(CREATE_SAMPLE);
  const [updateSample, updateState] = useMutation(UPDATE_SAMPLE);
  const [createLabel, labelState] = useMutation(CREATE_LABEL);
  const [saveAlias, aliasSaveState] = useMutation(SAVE_ALIAS, { onCompleted: () => { setAliasValue(''); refetchAliases(); refetch(); } });
  const [archiveAlias, aliasArchiveState] = useMutation(ARCHIVE_ALIAS, { onCompleted: () => { refetchAliases(); refetch(); } });
  const productResults = data?.products || [];
  const products = productResults.slice(0, designPageSize);
  const hasNextDesignPage = productResults.length > designPageSize;
  const samples = useMemo<any[]>(() => data?.displaySamples || [], [data?.displaySamples]);
  const locations = data?.stockLocations || [];
  const stats = data?.tileDesignStats || {};
  const selectedProduct = products.find((row: any) => row.id === sample.productId) || samples.find((row: any) => row.productId === sample.productId)?.product;
  const sampleByProduct = useMemo(() => new Map(samples.filter((row: any) => row.status === 'active').map((row: any) => [row.productId, row])), [samples]);
  const busy = createState.loading || updateState.loading || labelState.loading;

  function beginDisplay(product: any) {
    const existing: any = sampleByProduct.get(product.id);
    if (existing) {
      setSample({ id: existing.id, productId: existing.productId, internalCode: existing.internalCode, locationId: existing.locationId || '', displayZone: existing.displayZone || '', displayPosition: existing.displayPosition || '', imageUrl: existing.imageUrl || productImage(product), status: existing.status });
    } else {
      setSample({ ...emptySample, productId: product.id, internalCode: product.internalCode || product.sku, imageUrl: productImage(product), locationId: locations[0]?.id || '' });
    }
    setTab('display');
  }

  async function saveDisplay() {
    setNotice('');
    const input = { internalCode: sample.internalCode, locationId: sample.locationId || undefined, displayZone: sample.displayZone || undefined, displayPosition: sample.displayPosition || undefined, imageUrl: sample.imageUrl || undefined, status: sample.status || 'active' };
    const response = sample.id
      ? await updateSample({ variables: { id: sample.id, input } })
      : await createSample({ variables: { input: { ...input, productId: sample.productId } } });
    const saved = response.data?.updateDisplaySample || response.data?.createDisplaySample;
    if (!sample.id && saved?.id) await createLabel({ variables: { input: { displaySampleId: saved.id, quantity: 1, template: 'display_sample' } } });
    setNotice(sample.id ? 'Display details updated.' : 'Display registered and its internal QR label is ready to print.');
    setSample(emptySample);
    await refetch();
  }

  return <div className="space-y-5 pb-10">
    {[error, createState.error, updateState.error, labelState.error, aliasSaveState.error, aliasArchiveState.error].filter(Boolean).map((item: any, index) => <QueryErrorBanner key={index} error={item} />)}
    <header className="border-b border-[var(--line)] pb-5 pt-2">
      <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-end">
        <div>
          <p className="text-xs font-semibold uppercase text-[var(--ink-4)]">Tile display and design control</p>
          <h1 className="mt-1 font-display text-3xl font-bold text-[var(--ink)]">Display code → Product SKU → physical stock</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-3)]">Import the design catalogue in bulk, register only showroom displays here, and let sales search the same internal code in intents and quotes. Opening stock and each GRN create the physical inventory lots.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline"><Link href="/dashboard/master-data/imports"><Upload className="mr-2 h-4 w-4"/>Bulk import designs</Link></Button>
          <Button asChild variant="outline"><Link href="/dashboard/master-data/tile-sizes">Tile Size Master</Link></Button>
          <Button asChild variant="outline"><Link href="/dashboard/inventory/opening-stock"><PackagePlus className="mr-2 h-4 w-4"/>Opening stock</Link></Button>
          <Button asChild><Link href="/dashboard/inventory/labels"><Printer className="mr-2 h-4 w-4"/>Labels</Link></Button>
        </div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-4 border-t border-[var(--line)] pt-4 sm:grid-cols-4">
        <Metric label="Active designs" value={Number(stats.designs || 0)} />
        <Metric label="On display" value={Number(stats.displaySamples || 0)} tone="text-[#176b4d]" />
        <Metric label="Photos missing" value={Number(stats.missingImages || 0)} tone="text-[#a15c12]" />
        <Metric label="Codes missing" value={Number(stats.missingInternalCodes || 0)} tone="text-[#a13232]" />
      </div>
    </header>

    <nav className="inline-flex rounded-md border border-[var(--line)] bg-[var(--surface)] p-1" aria-label="Tile workspace views">
      {[['designs', 'Design registry'], ['display', 'Showroom display']].map(([id, label]) => <button key={id} onClick={() => setTab(id as any)} className={`h-9 rounded px-4 text-sm font-semibold ${tab === id ? 'bg-[var(--ink)] text-white' : 'text-[var(--ink-3)] hover:bg-[var(--bg-soft)]'}`}>{label}</button>)}
    </nav>

    {notice ? <div role="status" className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{notice}</div> : null}

    {tab === 'designs' ? <section className="mp-panel overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-[var(--line)] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="font-semibold text-[var(--ink)]">Product Master tile designs</h2><p className="text-xs text-[var(--ink-4)]">Search by showroom code, SKU, design name or brand. Results load 50 at a time.</p></div>
        <label className="flex h-10 w-full items-center rounded-md border border-[var(--line)] bg-[var(--bg-soft)] px-3 sm:w-80"><Search className="mr-2 h-4 w-4 text-[var(--ink-4)]"/><input value={search} onChange={(event) => { setSearch(event.target.value); setDesignPage(0); }} placeholder="Search internal code or design" className="w-full bg-transparent text-sm outline-none"/></label>
      </div>
      <div className="divide-y divide-[var(--line)]">
        {products.map((product: any) => {
          const display: any = sampleByProduct.get(product.id);
          const image = productImage(product);
          return <article key={product.id} className="grid gap-3 p-4 md:grid-cols-[4rem_minmax(0,1.6fr)_minmax(0,1fr)_auto] md:items-center">
            <div className="grid h-16 w-16 place-items-center overflow-hidden rounded-md bg-[var(--bg-soft)] shadow-[inset_0_0_0_1px_var(--line)]">{image ? <img src={image} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover"/> : <ImageOff className="h-5 w-5 text-[var(--ink-5)]"/>}</div>
            <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded bg-[#e8f0ff] px-2 py-1 text-xs font-semibold text-[#2456a6]">{product.internalCode || 'Code missing'}</span>{display ? <span className="rounded bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">On display</span> : null}</div><h3 className="mt-2 truncate font-semibold text-[var(--ink)]">{product.name}</h3><p className="mt-0.5 truncate text-xs text-[var(--ink-4)]">{product.sku} · {product.brand || 'No brand'}</p></div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs"><span className="text-[var(--ink-4)]">Size</span><span className="font-medium text-[var(--ink)]">{product.dimensions || 'Not set'}</span><span className="text-[var(--ink-4)]">Finish</span><span className="font-medium text-[var(--ink)]">{product.finish || 'Not set'}</span><span className="text-[var(--ink-4)]">Pack</span><span className="font-medium text-[var(--ink)]">{product.piecesPerPack || 0} pc / {product.salesUom || 'BOX'}</span></div>
            <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setAliasProduct(product)}>Codes</Button><Button variant={display ? 'outline' : 'default'} onClick={() => beginDisplay(product)}><Store className="mr-2 h-4 w-4"/>{display ? 'Edit display' : 'Place on display'}</Button></div>
          </article>;
        })}
        {!loading && !products.length ? <div className="grid min-h-56 place-items-center p-6 text-center"><div><Boxes className="mx-auto h-7 w-7 text-[var(--ink-5)]"/><p className="mt-3 font-semibold text-[var(--ink)]">No matching tile designs</p><p className="mt-1 text-sm text-[var(--ink-4)]">Import the supplier sheet or clear the search.</p></div></div> : null}
      </div>
      <div className="flex items-center justify-between border-t border-[var(--line)] p-4"><p className="text-xs font-semibold text-[var(--ink-4)]">Page {designPage + 1} · {products.length} design{products.length === 1 ? '' : 's'}</p><div className="flex gap-2"><Button type="button" size="icon" variant="outline" aria-label="Previous tile designs" disabled={designPage === 0 || loading} onClick={() => setDesignPage((page) => Math.max(0, page - 1))}><ChevronLeft className="h-4 w-4"/></Button><Button type="button" size="icon" variant="outline" aria-label="Next tile designs" disabled={!hasNextDesignPage || loading} onClick={() => setDesignPage((page) => page + 1)}><ChevronRight className="h-4 w-4"/></Button></div></div>
      {aliasProduct ? <div className="border-t border-[var(--line)] bg-[var(--bg-soft)] p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold text-[var(--ink)]">Codes and aliases · {aliasProduct.sku}</h3><p className="mt-1 text-xs text-[var(--ink-4)]">Warehouse SKU is immutable. Display, supplier and old codes remain searchable aliases.</p></div><button onClick={()=>setAliasProduct(null)} aria-label="Close code manager"><X className="h-4 w-4"/></button></div><div className="mt-4 grid gap-3 lg:grid-cols-[10rem_1fr_auto]"><select value={aliasType} onChange={(event)=>setAliasType(event.target.value)} className="h-10 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm"><option value="legacy_code">Old code</option><option value="supplier_sku">Supplier SKU</option><option value="showroom_code">Showroom code</option><option value="barcode">Barcode</option></select><Input value={aliasValue} onChange={(event)=>setAliasValue(event.target.value.toUpperCase())} placeholder="Enter an additional code"/><Button disabled={!aliasValue.trim()||aliasSaveState.loading} onClick={()=>saveAlias({variables:{input:{productId:aliasProduct.id,type:aliasType,value:aliasValue}}})}>Add searchable alias</Button></div><label className="mt-3 block text-xs font-semibold text-[var(--ink-4)]">Reason used if an alias is archived<Input className="mt-1" value={archiveReason} onChange={(event)=>setArchiveReason(event.target.value)}/></label><div className="mt-3 flex flex-wrap gap-2">{(aliasData?.productAliases||[]).map((alias:any)=><span key={alias.id} className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold ${alias.status==='active'?'border-[var(--line)] bg-[var(--surface)]':'border-slate-200 bg-slate-100 text-slate-500'}`}>{alias.type.replace('_',' ')} · {alias.value}{alias.status==='active'&&!(alias.type==='internal_code'&&alias.isPrimary)?<button className="text-red-700 underline" disabled={!archiveReason.trim()||aliasArchiveState.loading} onClick={()=>archiveAlias({variables:{id:alias.id,reason:archiveReason}})}>Archive</button>:null}</span>)}</div></div> : null}
    </section> : null}

    {tab === 'display' ? <section className="grid gap-5 xl:grid-cols-[22rem_1fr]">
      <div className="mp-panel self-start p-4 xl:sticky xl:top-4">
        <div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold text-[var(--ink)]">{sample.id ? 'Edit display' : 'Register display'}</h2><p className="mt-1 text-xs leading-5 text-[var(--ink-4)]">One physical display points to one quoteable Product Master design.</p></div>{sample.productId ? <button title="Clear" onClick={() => setSample(emptySample)} className="grid h-9 w-9 place-items-center rounded-md hover:bg-[var(--bg-soft)]"><X className="h-4 w-4"/></button> : null}</div>
        <div className="mt-4 space-y-3">
          <label className="block text-xs font-semibold text-[var(--ink-4)]">Tile design<select value={sample.productId} onChange={(event) => { const product = products.find((row: any) => row.id === event.target.value); if (product) beginDisplay(product); }} className="mt-1 h-10 w-full rounded-md border border-[var(--line)] bg-[var(--bg-soft)] px-3 text-sm text-[var(--ink)]"><option value="">Select design</option>{products.map((product: any) => <option key={product.id} value={product.id}>{product.internalCode || product.sku} · {product.name}</option>)}</select></label>
          {selectedProduct ? <div className="rounded-md bg-[var(--bg-soft)] p-3"><p className="text-sm font-semibold text-[var(--ink)]">{selectedProduct.name}</p><p className="mt-1 text-xs text-[var(--ink-4)]">{selectedProduct.sku} · {selectedProduct.dimensions}</p></div> : null}
          <label className="block text-xs font-semibold text-[var(--ink-4)]">Showroom code<Input className="mt-1" value={sample.internalCode} onChange={(event) => setSample({ ...sample, internalCode: event.target.value.toUpperCase() })} placeholder="A-1042"/></label>
          <label className="block text-xs font-semibold text-[var(--ink-4)]">Location<select value={sample.locationId} onChange={(event) => setSample({ ...sample, locationId: event.target.value })} className="mt-1 h-10 w-full rounded-md border border-[var(--line)] bg-[var(--bg-soft)] px-3 text-sm"><option value="">Select location</option>{locations.map((location: any) => <option key={location.id} value={location.id}>{location.code} · {location.name}</option>)}</select></label>
          <div className="grid grid-cols-2 gap-3"><label className="block text-xs font-semibold text-[var(--ink-4)]">Zone<Input className="mt-1" value={sample.displayZone} onChange={(event) => setSample({ ...sample, displayZone: event.target.value })} placeholder="Tile wall A"/></label><label className="block text-xs font-semibold text-[var(--ink-4)]">Position<Input className="mt-1" value={sample.displayPosition} onChange={(event) => setSample({ ...sample, displayPosition: event.target.value })} placeholder="Panel 12"/></label></div>
          <label className="block text-xs font-semibold text-[var(--ink-4)]">Display photo URL<Input className="mt-1" value={sample.imageUrl} onChange={(event) => setSample({ ...sample, imageUrl: event.target.value })} placeholder="https://..."/></label>
          {sample.id ? <label className="block text-xs font-semibold text-[var(--ink-4)]">Status<select value={sample.status} onChange={(event) => setSample({ ...sample, status: event.target.value })} className="mt-1 h-10 w-full rounded-md border border-[var(--line)] bg-[var(--bg-soft)] px-3"><option value="active">Active</option><option value="maintenance">Maintenance</option><option value="removed">Removed</option></select></label> : null}
          <Button className="w-full" disabled={busy || !sample.productId || !sample.internalCode} onClick={saveDisplay}><Camera className="mr-2 h-4 w-4"/>{sample.id ? 'Save display' : 'Register and create label'}</Button>
        </div>
      </div>
      <div className="mp-panel overflow-hidden"><div className="border-b border-[var(--line)] p-4"><h2 className="font-semibold text-[var(--ink)]">Physical showroom displays</h2><p className="mt-1 text-xs text-[var(--ink-4)]">These are samples, not saleable stock. Their codes resolve to Product Master in the quote editor.</p></div><div className="grid gap-px bg-[var(--line)] sm:grid-cols-2 2xl:grid-cols-3">{samples.map((row: any) => <button key={row.id} onClick={() => { setSample({ id: row.id, productId: row.productId, internalCode: row.internalCode, locationId: row.locationId || '', displayZone: row.displayZone || '', displayPosition: row.displayPosition || '', imageUrl: row.imageUrl || '', status: row.status }); }} className="bg-[var(--surface)] p-4 text-left hover:bg-[var(--bg-soft)]"><div className="flex gap-3"><div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-md bg-[var(--bg-soft)]">{row.imageUrl || productImage(row.product) ? <img src={row.imageUrl || productImage(row.product)} alt="" className="h-full w-full object-cover"/> : <ImageOff className="h-5 w-5 text-[var(--ink-5)]"/>}</div><div className="min-w-0"><p className="font-semibold text-[var(--ink)]">{row.internalCode}</p><p className="mt-1 truncate text-xs text-[var(--ink-4)]">{row.product?.name}</p><p className="mt-2 flex items-center gap-1 text-xs text-[var(--ink-3)]"><MapPin className="h-3.5 w-3.5"/>{row.displayZone || 'Zone pending'} · {row.displayPosition || 'Position pending'}</p></div></div></button>)}</div></div>
    </section> : null}

  </div>;
}
