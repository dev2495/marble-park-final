'use client';

import { useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle, Download, FileText, Image as ImageIcon, Plus, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ProductImageFrame } from '@/components/product-image-frame';
import { QueryErrorBanner } from '@/components/query-state';

const GET_CUSTOMERS = gql`
  query GetCustomers { customers { id name email mobile siteAddress city } }
`;

const SEARCH_PRODUCTS = gql`
  query SearchProducts($query: String!) { globalSearch(query: $query) { products } }
`;

const CREATE_QUOTE = gql`
  mutation CreateQuote($input: CreateQuoteInput!) { createQuote(input: $input) { id quoteNumber } }
`;

function money(value: number) {
  return `₹${Math.round(value || 0).toLocaleString('en-IN')}`;
}

function productImage(media: any) {
  if (!media) return '/catalogue-art/faucet.svg';
  if (typeof media === 'string') {
    try {
      return JSON.parse(media)?.primary || '/catalogue-art/faucet.svg';
    } catch {
      return media || '/catalogue-art/faucet.svg';
    }
  }
  return media.primary || media.gallery?.[0] || '/catalogue-art/faucet.svg';
}

// Common bathroom / kitchen / living areas — used as quick-pick chips and
// `<datalist>` autocomplete for the per-line "area" input. Tile selection
// quotes consistently use these labels (matches the user's sample PDF).
const AREA_SUGGESTIONS = [
  'Master Bedroom Bathroom',
  '1st Floor Guest Bathroom',
  '2nd Floor Powder Bathroom',
  'General Floor Guest Bathroom',
  'Steam Shower Bathroom',
  'Upper Terrace Powder Bathroom',
  'Terrace Powder',
  'Guest Room Deck',
  'Upper Terrace',
  'Balcony',
  'Living Room',
  'Kitchen',
  'Powder Room',
  'Drying Yard',
];

export default function QuoteBuilderPage() {
  const [lines, setLines] = useState<any[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [projectTitle, setProjectTitle] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [success, setSuccess] = useState('');
  const [savedQuote, setSavedQuote] = useState<any>(null);
  const [displayMode, setDisplayMode] = useState<'priced' | 'selection'>('priced');
  const [defaultArea, setDefaultArea] = useState('General Selection');
  const { data: customerData, error: customerError } = useQuery(GET_CUSTOMERS);
  const { data: searchData, loading: searching, error: searchError } = useQuery(SEARCH_PRODUCTS, { variables: { query: searchQuery }, skip: searchQuery.length < 2 });
  const [createQuote, { loading: saving, error: saveError }] = useMutation(CREATE_QUOTE);
  const [validationError, setValidationError] = useState<string>('');

  const addProduct = (product: any) => {
    setLines((current) => [...current, { id: `${product.id}-${Date.now()}`, area: defaultArea || 'General Selection', productId: product.id, name: product.name, sku: product.sku, qty: 1, price: product.sellPrice || 0, unit: product.unit || 'PC', category: product.category, brand: product.brand, media: product.media, quoteImage: '' }]);
    setSearchQuery('');
  };
  const updateQty = (id: string, qty: number) => setLines((current) => current.map((line) => line.id === id ? { ...line, qty } : line));
  const updateLine = (id: string, patch: any) => setLines((current) => current.map((line) => line.id === id ? { ...line, ...patch } : line));
  const removeLine = (id: string) => setLines((current) => current.filter((line) => line.id !== id));
  const subtotal = lines.reduce((sum, line) => sum + Number(line.qty || 0) * Number(line.price || 0), 0);
  const tax = subtotal * 0.18;
  const total = subtotal + tax;
  const selectedCustomer = customerData?.customers?.find((customer: any) => customer.id === selectedCustomerId);

  const handleSave = async () => {
    setValidationError('');
    if (!selectedCustomerId) {
      setValidationError('Pick a customer before saving the quote.');
      return;
    }
    if (lines.length === 0) {
      setValidationError('Add at least one product line before saving.');
      return;
    }
    const invalidLine = lines.find((line) => !Number(line.qty) || Number(line.qty) <= 0);
    if (invalidLine) {
      setValidationError(`Quantity must be greater than 0 (line: ${invalidLine.name || invalidLine.sku || 'unnamed'}).`);
      return;
    }
    let ownerId = '';
    try {
      ownerId = JSON.parse(localStorage.getItem('user') || 'null')?.id || '';
    } catch {
      ownerId = '';
    }
    try {
      const { data, errors } = await createQuote({
        variables: {
          input: {
            customerId: selectedCustomerId,
            ownerId,
            projectName: projectTitle,
            title: projectTitle || 'Retail product quotation',
            displayMode,
            quoteMeta: JSON.stringify({ remarks: 'Prepared from quote studio.', showBrandLogos: true }),
            lines: JSON.stringify(lines.map(({ id, ...line }) => ({ ...line, total: Number(line.qty || 0) * Number(line.price || 0) }))),
          },
        },
      });
      if (errors?.length) {
        setValidationError(errors.map((e) => e.message).join(' • '));
        return;
      }
      setSavedQuote(data?.createQuote || null);
      setSuccess(data?.createQuote?.quoteNumber || 'Quote saved');
    } catch (err) {
      // Apollo `mutate` throws on network failure; show banner via saveError.
      // eslint-disable-next-line no-console
      console.error('createQuote failed', err);
    }
  };

  const queryError = customerError || searchError;
  return (
    <div className="grid h-[calc(100vh-10rem)] gap-5 overflow-hidden pb-4 xl:grid-cols-[1fr_0.52fr]">
      {queryError ? <div className="xl:col-span-2"><QueryErrorBanner error={queryError} /></div> : null}
      {saveError ? <div className="xl:col-span-2"><QueryErrorBanner error={saveError} /></div> : null}
      {validationError ? (
        <div role="alert" aria-live="polite" className="xl:col-span-2 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm font-bold text-amber-900">{validationError}</div>
      ) : null}
      <AnimatePresence>{success && <motion.div initial={{ opacity: 0, y: -18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="fixed right-8 top-24 z-50 flex flex-wrap items-center gap-3 rounded-2xl bg-[#047857] px-5 py-4 text-sm font-black text-white shadow-2xl"><CheckCircle className="h-5 w-5" /> {success} created {savedQuote?.id && <><a className="rounded-xl bg-white/15 px-3 py-2" href={`/dashboard/quotes/${savedQuote.id}`}>Open</a><a className="rounded-xl bg-white/15 px-3 py-2" href={`/api/pdf/quote/${savedQuote.id}`} target="_blank" rel="noreferrer"><Download className="mr-1 inline h-4 w-4" /> PDF</a></>}</motion.div>}</AnimatePresence>

      <section className="flex min-w-0 flex-col overflow-hidden rounded-[2.25rem] bg-[#ffffff]/72 shadow-2xl shadow-[#6f6258]/10 backdrop-blur-xl">
        <div className="border-b border-[#d9cbbd]/10 p-5 lg:p-6">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.26em] text-[#6f6258]">Quote studio</p>
              <h1 className="mt-2 text-4xl font-black tracking-[-0.045em] text-[#241b14]">Build a beautiful retail proposal.</h1>
              <p className="mt-2 text-sm font-semibold text-[#6f6258]">Search catalogue SKUs, add product-image rows, and save a quote version.</p>
            </div>
            <div className="flex gap-3">
              <Button disabled={saving || !selectedCustomerId || lines.length === 0} onClick={handleSave} size="lg"><FileText className="mr-2 h-5 w-5" /> {saving ? 'Saving...' : 'Save quote'}</Button>
              {savedQuote?.id && <Button asChild variant="warning" size="lg"><a href={`/api/pdf/quote/${savedQuote.id}`} target="_blank" rel="noreferrer"><Download className="mr-2 h-5 w-5" /> PDF</a></Button>}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 custom-scrollbar lg:p-6">
          <div className="grid gap-4 lg:grid-cols-2">
            <label className="block space-y-2">
              <span className="text-xs font-black uppercase tracking-widest text-[#6f6258]">Customer</span>
              <select value={selectedCustomerId} onChange={(event) => setSelectedCustomerId(event.target.value)} className="h-[3.25rem] w-full rounded-2xl border border-[#d9cbbd]/18 bg-white px-4 text-sm font-bold text-[#241b14] outline-none focus:border-[#b17643]/45 focus:ring-4 focus:ring-[#b17643]/10">
                <option value="">Select customer...</option>
                {customerData?.customers?.map((customer: any) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
              </select>
            </label>
            <label className="block space-y-2">
              <span className="text-xs font-black uppercase tracking-widest text-[#6f6258]">Project / site</span>
              <Input value={projectTitle} onChange={(event) => setProjectTitle(event.target.value)} placeholder="e.g. Patel Residence bathroom package" className="h-[3.25rem]" />
            </label>
            <label className="block space-y-2">
              <span className="text-xs font-black uppercase tracking-widest text-[#6f6258]">PDF type</span>
              <select value={displayMode} onChange={(event) => setDisplayMode(event.target.value as any)} className="h-[3.25rem] w-full rounded-2xl border border-[#d9cbbd]/18 bg-white px-4 text-sm font-bold text-[#241b14] outline-none focus:border-[#b17643]/45 focus:ring-4 focus:ring-[#b17643]/10">
                <option value="priced">Show prices - quotation</option>
                <option value="selection">Hide prices - selection summary</option>
              </select>
            </label>
            <label className="block space-y-2 lg:col-span-2">
              <span className="text-xs font-black uppercase tracking-widest text-[#6f6258]">Default area for new lines</span>
              <input
                list="mp-area-list"
                value={defaultArea}
                onChange={(event) => setDefaultArea(event.target.value)}
                placeholder="e.g. Master Bedroom Bathroom"
                className="h-[3.25rem] w-full rounded-2xl border border-[#d9cbbd]/18 bg-white px-4 text-sm font-bold text-[#241b14] outline-none focus:border-[#b17643]/45 focus:ring-4 focus:ring-[#b17643]/10"
              />
              <div className="flex flex-wrap gap-2 pt-1">
                {AREA_SUGGESTIONS.slice(0, 8).map((area) => (
                  <button
                    key={area}
                    type="button"
                    onClick={() => setDefaultArea(area)}
                    className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-wider transition ${defaultArea === area ? 'bg-[#241b14] text-white' : 'bg-white/75 text-[#2d251f] hover:bg-[#f6eadb]'}`}
                  >{area}</button>
                ))}
              </div>
            </label>
          </div>
          <datalist id="mp-area-list">
            {AREA_SUGGESTIONS.map((area) => <option key={area} value={area} />)}
          </datalist>

          <div className="relative mt-6">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#6f6258]" />
            <Input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search 7,000+ products by SKU, brand or name..." className="h-14 pl-12 text-base" />
            <AnimatePresence>
              {searchQuery.length >= 2 && searchData?.globalSearch?.products?.length > 0 && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="absolute left-0 right-0 top-full z-40 mt-3 max-h-96 overflow-y-auto rounded-[1.75rem] border border-[#d9cbbd]/12 bg-[#ffffff] p-2 shadow-2xl custom-scrollbar">
                  {searchData.globalSearch.products.map((product: any) => (
                    <button key={product.id} onClick={() => addProduct(product)} className="flex w-full items-center justify-between gap-4 rounded-2xl p-3 text-left transition hover:bg-[#f6eadb]/65">
                      <div className="flex min-w-0 items-center gap-3">
                        <ProductImageFrame src={productImage(product.media)} alt={product.name} className="h-20 w-24 shrink-0 rounded-2xl" imageClassName="p-1.5" />
                        <div className="min-w-0"><p className="truncate text-sm font-black">{product.name}</p><p className="text-[10px] font-black uppercase tracking-wider text-[#6f6258]">{product.sku} · {product.brand}</p></div>
                      </div>
                      <span className="shrink-0 text-sm font-black text-[#047857]">{money(product.sellPrice)}</span>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="mt-6 overflow-hidden rounded-[1.75rem] border border-[#d9cbbd]/12 bg-white/70">
            <table className="w-full min-w-[760px] text-left">
              <thead className="bg-[#f6eadb]/70 text-[10px] font-black uppercase tracking-widest text-[#d9cbbd]"><tr><th className="px-4 py-4">Product</th><th className="px-4 py-4 text-center">Qty</th><th className="px-4 py-4 text-right">Rate</th><th className="px-4 py-4 text-right">Amount</th><th className="px-4 py-4" /></tr></thead>
              <tbody className="divide-y divide-[#d9cbbd]/10">
                {lines.map((line) => (
                  <tr key={line.id}>
                    <td className="px-4 py-4"><div className="flex items-center gap-4"><ProductImageFrame src={line.quoteImage || productImage(line.media)} alt={line.name} className="h-24 w-28 shrink-0 rounded-[1.35rem]" imageClassName="p-1.5" /><div className="min-w-0 space-y-2"><input list="mp-area-list" value={line.area || ''} onChange={(event)=>updateLine(line.id,{area:event.target.value})} placeholder="Area / room" className="h-8 w-full rounded-xl border border-[#d9cbbd]/15 bg-white px-3 text-[10px] font-black uppercase tracking-wider text-[#b17643]" /><p className="font-black">{line.name}</p><p className="text-[10px] font-black uppercase tracking-wider text-[#6f6258]">{line.sku} · {line.unit}</p><input value={line.quoteImage || ''} onChange={(event)=>updateLine(line.id,{quoteImage:event.target.value})} placeholder="Optional quote photo URL" className="h-8 w-full rounded-xl border border-[#d9cbbd]/15 bg-white px-3 text-[10px] font-bold" /></div></div></td>
                    <td className="px-4 py-4 text-center"><input type="number" value={line.qty} min={0} onChange={(event) => updateQty(line.id, Number(event.target.value) || 0)} className="h-10 w-20 rounded-xl border border-[#d9cbbd]/18 bg-white text-center text-sm font-black outline-none focus:ring-4 focus:ring-[#b17643]/10" /></td>
                    <td className="px-4 py-4 text-right font-black">{money(line.price)}</td>
                    <td className="px-4 py-4 text-right font-black text-[#047857]">{money(line.qty * line.price)}</td>
                    <td className="px-4 py-4"><button onClick={() => removeLine(line.id)} className="rounded-xl p-2 text-[#6f6258] hover:bg-red-50 hover:text-red-700"><Trash2 className="h-4 w-4" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {lines.length === 0 && <div className="grid h-56 place-items-center text-center"><div><Plus className="mx-auto mb-3 h-8 w-8 text-[#b17643]" /><p className="font-black text-[#241b14]">Search products to start a quote.</p><p className="mt-1 text-sm font-semibold text-[#6f6258]">Catalogue images and price details will appear here.</p></div></div>}
          </div>
        </div>
      </section>

      <aside className="hidden overflow-hidden rounded-[2.25rem] bg-[#241b14] p-5 text-white shadow-2xl shadow-[#241b14]/15 xl:flex xl:flex-col">
        <div className="rounded-[1.75rem] bg-[#ffffff] p-5 text-[#241b14]">
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#6f6258]">Live preview</p>
          <h2 className="mt-2 text-3xl font-black tracking-[-0.04em]">{projectTitle || 'Retail quotation'}</h2>
          <p className="mt-2 text-sm font-bold text-[#6f6258]">{selectedCustomer?.name || 'Select a customer'}</p>
        </div>
        <div className="mt-5 flex-1 overflow-y-auto rounded-[1.75rem] border border-white/10 bg-white/[0.08] p-4 custom-scrollbar">
          {lines.slice(0, 8).map((line) => <div key={line.id} className="mb-4 rounded-[1.5rem] bg-white/10 p-3"><ProductImageFrame src={productImage(line.media)} alt={line.name} className="mb-3 h-36 w-full rounded-[1.25rem]" imageClassName="p-2" /><div className="min-w-0"><p className="line-clamp-2 text-sm font-black">{line.name}</p><p className="mt-1 text-[10px] font-black uppercase text-[#ead7bd]">{line.sku} · {line.qty} x {money(line.price)}</p></div></div>)}
          {lines.length === 0 && <div className="grid h-full place-items-center text-center text-[#f6eadb]"><div><ImageIcon className="mx-auto mb-3 h-10 w-10" /><p className="text-sm font-bold">Product image preview appears after adding items.</p></div></div>}
        </div>
        <div className="mt-5 rounded-[1.75rem] bg-[#ffffff] p-5 text-[#241b14]">
          <div className="flex justify-between text-sm font-bold"><span>Subtotal</span><span>{money(subtotal)}</span></div>
          <div className="mt-2 flex justify-between text-sm font-bold"><span>GST 18%</span><span>{money(tax)}</span></div>
          <div className="mt-4 flex justify-between border-t border-[#d9cbbd]/12 pt-4 text-2xl font-black"><span>Total</span><span>{money(total)}</span></div>
        </div>
      </aside>
    </div>
  );
}
