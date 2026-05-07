'use client';

import { useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle, Download, FileText, Image as ImageIcon, Plus, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ProductImageFrame } from '@/components/product-image-frame';

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

export default function QuoteBuilderPage() {
  const [lines, setLines] = useState<any[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [projectTitle, setProjectTitle] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [success, setSuccess] = useState('');
  const [savedQuote, setSavedQuote] = useState<any>(null);
  const [displayMode, setDisplayMode] = useState<'priced' | 'selection'>('priced');
  const { data: customerData } = useQuery(GET_CUSTOMERS);
  const { data: searchData, loading: searching } = useQuery(SEARCH_PRODUCTS, { variables: { query: searchQuery }, skip: searchQuery.length < 2 });
  const [createQuote, { loading: saving }] = useMutation(CREATE_QUOTE);

  const addProduct = (product: any) => {
    setLines((current) => [...current, { id: `${product.id}-${Date.now()}`, area: 'General Selection', productId: product.id, name: product.name, sku: product.sku, qty: 1, price: product.sellPrice || 0, unit: product.unit || 'PC', category: product.category, brand: product.brand, media: product.media, quoteImage: '' }]);
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
    if (!selectedCustomerId || lines.length === 0) return;
    let ownerId = '';
    try {
      ownerId = JSON.parse(localStorage.getItem('user') || 'null')?.id || '';
    } catch {
      ownerId = '';
    }
    const { data } = await createQuote({
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
    setSavedQuote(data?.createQuote || null);
    setSuccess(data?.createQuote?.quoteNumber || 'Quote saved');
  };

  return (
    <div className="grid h-[calc(100vh-10rem)] gap-5 overflow-hidden pb-4 xl:grid-cols-[1fr_0.52fr]">
      <AnimatePresence>{success && <motion.div initial={{ opacity: 0, y: -18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="fixed right-8 top-24 z-50 flex flex-wrap items-center gap-3 rounded-2xl bg-[#24544d] px-5 py-4 text-sm font-black text-white shadow-2xl"><CheckCircle className="h-5 w-5" /> {success} created {savedQuote?.id && <><a className="rounded-xl bg-white/15 px-3 py-2" href={`/dashboard/quotes/${savedQuote.id}`}>Open</a><a className="rounded-xl bg-white/15 px-3 py-2" href={`/api/pdf/quote/${savedQuote.id}`} target="_blank" rel="noreferrer"><Download className="mr-1 inline h-4 w-4" /> PDF</a></>}</motion.div>}</AnimatePresence>

      <section className="flex min-w-0 flex-col overflow-hidden rounded-[2.25rem] bg-[#fffaf3]/72 shadow-2xl shadow-[#6b4f38]/10 backdrop-blur-xl">
        <div className="border-b border-[#7a5b3c]/10 p-5 lg:p-6">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.26em] text-[#8b6b4c]">Quote studio</p>
              <h1 className="mt-2 text-4xl font-black tracking-[-0.045em] text-[#211b16]">Build a beautiful retail proposal.</h1>
              <p className="mt-2 text-sm font-semibold text-[#7d6b5c]">Search catalogue SKUs, add product-image rows, and save a quote version.</p>
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
              <span className="text-xs font-black uppercase tracking-widest text-[#8b6b4c]">Customer</span>
              <select value={selectedCustomerId} onChange={(event) => setSelectedCustomerId(event.target.value)} className="h-[3.25rem] w-full rounded-2xl border border-[#7a5b3c]/18 bg-white px-4 text-sm font-bold text-[#211b16] outline-none focus:border-[#b57942]/45 focus:ring-4 focus:ring-[#b57942]/10">
                <option value="">Select customer...</option>
                {customerData?.customers?.map((customer: any) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
              </select>
            </label>
            <label className="block space-y-2">
              <span className="text-xs font-black uppercase tracking-widest text-[#8b6b4c]">Project / site</span>
              <Input value={projectTitle} onChange={(event) => setProjectTitle(event.target.value)} placeholder="e.g. Patel Residence bathroom package" className="h-[3.25rem]" />
            </label>
            <label className="block space-y-2">
              <span className="text-xs font-black uppercase tracking-widest text-[#8b6b4c]">PDF type</span>
              <select value={displayMode} onChange={(event) => setDisplayMode(event.target.value as any)} className="h-[3.25rem] w-full rounded-2xl border border-[#7a5b3c]/18 bg-white px-4 text-sm font-bold text-[#211b16] outline-none focus:border-[#b57942]/45 focus:ring-4 focus:ring-[#b57942]/10">
                <option value="priced">Show prices - quotation</option>
                <option value="selection">Hide prices - selection summary</option>
              </select>
            </label>
          </div>

          <div className="relative mt-6">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#8b6b4c]" />
            <Input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search 7,000+ products by SKU, brand or name..." className="h-14 pl-12 text-base" />
            <AnimatePresence>
              {searchQuery.length >= 2 && searchData?.globalSearch?.products?.length > 0 && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="absolute left-0 right-0 top-full z-40 mt-3 max-h-96 overflow-y-auto rounded-[1.75rem] border border-[#7a5b3c]/12 bg-[#fffaf3] p-2 shadow-2xl custom-scrollbar">
                  {searchData.globalSearch.products.map((product: any) => (
                    <button key={product.id} onClick={() => addProduct(product)} className="flex w-full items-center justify-between gap-4 rounded-2xl p-3 text-left transition hover:bg-[#ead7c0]/65">
                      <div className="flex min-w-0 items-center gap-3">
                        <ProductImageFrame src={productImage(product.media)} alt={product.name} className="h-20 w-24 shrink-0 rounded-2xl" imageClassName="p-1.5" />
                        <div className="min-w-0"><p className="truncate text-sm font-black">{product.name}</p><p className="text-[10px] font-black uppercase tracking-wider text-[#8b6b4c]">{product.sku} · {product.brand}</p></div>
                      </div>
                      <span className="shrink-0 text-sm font-black text-[#24544d]">{money(product.sellPrice)}</span>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="mt-6 overflow-hidden rounded-[1.75rem] border border-[#7a5b3c]/12 bg-white/70">
            <table className="w-full min-w-[760px] text-left">
              <thead className="bg-[#ead7c0]/70 text-[10px] font-black uppercase tracking-widest text-[#7a5b3c]"><tr><th className="px-4 py-4">Product</th><th className="px-4 py-4 text-center">Qty</th><th className="px-4 py-4 text-right">Rate</th><th className="px-4 py-4 text-right">Amount</th><th className="px-4 py-4" /></tr></thead>
              <tbody className="divide-y divide-[#7a5b3c]/10">
                {lines.map((line) => (
                  <tr key={line.id}>
                    <td className="px-4 py-4"><div className="flex items-center gap-4"><ProductImageFrame src={line.quoteImage || productImage(line.media)} alt={line.name} className="h-24 w-28 shrink-0 rounded-[1.35rem]" imageClassName="p-1.5" /><div className="min-w-0 space-y-2"><input value={line.area || ''} onChange={(event)=>updateLine(line.id,{area:event.target.value})} placeholder="Area / room" className="h-8 w-full rounded-xl border border-[#7a5b3c]/15 bg-white px-3 text-[10px] font-black uppercase tracking-wider text-[#b57942]" /><p className="font-black">{line.name}</p><p className="text-[10px] font-black uppercase tracking-wider text-[#8b6b4c]">{line.sku} · {line.unit}</p><input value={line.quoteImage || ''} onChange={(event)=>updateLine(line.id,{quoteImage:event.target.value})} placeholder="Optional quote photo URL" className="h-8 w-full rounded-xl border border-[#7a5b3c]/15 bg-white px-3 text-[10px] font-bold" /></div></div></td>
                    <td className="px-4 py-4 text-center"><input type="number" value={line.qty} min={0} onChange={(event) => updateQty(line.id, Number(event.target.value) || 0)} className="h-10 w-20 rounded-xl border border-[#7a5b3c]/18 bg-white text-center text-sm font-black outline-none focus:ring-4 focus:ring-[#b57942]/10" /></td>
                    <td className="px-4 py-4 text-right font-black">{money(line.price)}</td>
                    <td className="px-4 py-4 text-right font-black text-[#24544d]">{money(line.qty * line.price)}</td>
                    <td className="px-4 py-4"><button onClick={() => removeLine(line.id)} className="rounded-xl p-2 text-[#8b6b4c] hover:bg-red-50 hover:text-red-700"><Trash2 className="h-4 w-4" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {lines.length === 0 && <div className="grid h-56 place-items-center text-center"><div><Plus className="mx-auto mb-3 h-8 w-8 text-[#b57942]" /><p className="font-black text-[#211b16]">Search products to start a quote.</p><p className="mt-1 text-sm font-semibold text-[#7d6b5c]">Catalogue images and price details will appear here.</p></div></div>}
          </div>
        </div>
      </section>

      <aside className="hidden overflow-hidden rounded-[2.25rem] bg-[#211b16] p-5 text-white shadow-2xl shadow-[#211b16]/15 xl:flex xl:flex-col">
        <div className="rounded-[1.75rem] bg-[#fffaf3] p-5 text-[#211b16]">
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#8b6b4c]">Live preview</p>
          <h2 className="mt-2 text-3xl font-black tracking-[-0.04em]">{projectTitle || 'Retail quotation'}</h2>
          <p className="mt-2 text-sm font-bold text-[#7d6b5c]">{selectedCustomer?.name || 'Select a customer'}</p>
        </div>
        <div className="mt-5 flex-1 overflow-y-auto rounded-[1.75rem] border border-white/10 bg-white/[0.08] p-4 custom-scrollbar">
          {lines.slice(0, 8).map((line) => <div key={line.id} className="mb-4 rounded-[1.5rem] bg-white/10 p-3"><ProductImageFrame src={productImage(line.media)} alt={line.name} className="mb-3 h-36 w-full rounded-[1.25rem]" imageClassName="p-2" /><div className="min-w-0"><p className="line-clamp-2 text-sm font-black">{line.name}</p><p className="mt-1 text-[10px] font-black uppercase text-[#d5b58f]">{line.sku} · {line.qty} x {money(line.price)}</p></div></div>)}
          {lines.length === 0 && <div className="grid h-full place-items-center text-center text-[#d9c4a9]"><div><ImageIcon className="mx-auto mb-3 h-10 w-10" /><p className="text-sm font-bold">Product image preview appears after adding items.</p></div></div>}
        </div>
        <div className="mt-5 rounded-[1.75rem] bg-[#fffaf3] p-5 text-[#211b16]">
          <div className="flex justify-between text-sm font-bold"><span>Subtotal</span><span>{money(subtotal)}</span></div>
          <div className="mt-2 flex justify-between text-sm font-bold"><span>GST 18%</span><span>{money(tax)}</span></div>
          <div className="mt-4 flex justify-between border-t border-[#7a5b3c]/12 pt-4 text-2xl font-black"><span>Total</span><span>{money(total)}</span></div>
        </div>
      </aside>
    </div>
  );
}
