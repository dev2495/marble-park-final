'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { gql, useMutation, useQuery } from '@apollo/client';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle, Download, ImagePlus, Save, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ProductImageFrame } from '@/components/product-image-frame';
import { QueryErrorBanner } from '@/components/query-state';

const QUOTE_DETAIL = gql`
  query QuoteDetail($id: ID!) {
    quote(id: $id) {
      id quoteNumber title projectName status approvalStatus discountPercent displayMode createdAt validUntil sentAt confirmedAt notes lines quoteMeta customer owner lead approval coverImage
    }
  }
`;

const UPDATE_QUOTE = gql`mutation UpdateQuote($id: ID!, $input: UpdateQuoteInput!) { updateQuote(id: $id, input: $input) { id displayMode lines quoteMeta approvalStatus status } }`;
const SEND_QUOTE = gql`mutation SendQuote($id: ID!) { sendQuote(id: $id) { id status sentAt } }`;
const CONFIRM_QUOTE = gql`mutation ConfirmQuote($id: ID!) { confirmQuote(id: $id) { id status confirmedAt } }`;
const CREATE_SALES_ORDER = gql`mutation CreateSalesOrderFromQuote($input: CreateSalesOrderInput!) { createSalesOrderFromQuote(input: $input) }`;

function money(value: number) { return `₹${Math.round(Number(value || 0)).toLocaleString('en-IN')}`; }
function productImage(line: any) {
  if (line.quoteImage || line.customImageUrl) return line.quoteImage || line.customImageUrl;
  const media = line.media;
  if (!media) return '/catalogue-art/faucet.svg';
  if (typeof media === 'string') {
    try { return JSON.parse(media)?.primary || '/catalogue-art/faucet.svg'; } catch { return media || '/catalogue-art/faucet.svg'; }
  }
  return media.primary || media.gallery?.[0] || '/catalogue-art/faucet.svg';
}
function lineRate(line: any) {
  const qty = Number(line.qty || line.quantity || 0);
  const price = Number(line.price || line.sellPrice || 0);
  const discount = Number(line.discountPercent || line.discount || 0);
  const specialRate = Number(line.specialRate || line.specialPrice || 0);
  const unitRate = specialRate > 0 ? specialRate : price * (1 - discount / 100);
  return { qty, price, discount, specialRate: unitRate, amount: qty * unitRate };
}
function groupLines(lines: any[]) {
  const groups = new Map<string, any[]>();
  for (const line of lines) {
    const area = String(line.area || 'General Selection');
    groups.set(area, [...(groups.get(area) || []), line]);
  }
  return Array.from(groups.entries()).map(([area, rows]) => ({ area, rows }));
}

export default function QuoteDetailPage() {
  const params = useParams();
  const id = String(params.id);
  const [paymentMode, setPaymentMode] = useState('cash');
  const [advanceAmount, setAdvanceAmount] = useState('0');
  const [orderMessage, setOrderMessage] = useState('');
  const [editLines, setEditLines] = useState<any[]>([]);
  const [displayMode, setDisplayMode] = useState('priced');
  const [remarks, setRemarks] = useState('');
  const [terms, setTerms] = useState('');
  const [bankDetails, setBankDetails] = useState('');
  const [discountPercent, setDiscountPercent] = useState('0');
  const [coverImage, setCoverImage] = useState('');
  const [tagline, setTagline] = useState('');
  const [uploadingCover, setUploadingCover] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);
  const { data, loading, error, refetch } = useQuery(QUOTE_DETAIL, { variables: { id } });
  const [updateQuote, { loading: savingQuote, error: updateError }] = useMutation(UPDATE_QUOTE, { onCompleted: () => refetch() });
  const [sendQuote, { loading: sending, error: sendError }] = useMutation(SEND_QUOTE, { onCompleted: () => refetch() });
  const [confirmQuote, { loading: confirming, error: confirmError }] = useMutation(CONFIRM_QUOTE, { onCompleted: () => refetch() });
  const [createSalesOrder, { loading: creatingOrder, error: createOrderError }] = useMutation(CREATE_SALES_ORDER, { onCompleted: (result) => { setOrderMessage(`Sales order ${result.createSalesOrderFromQuote.orderNumber} created.`); refetch(); }, onError: (error) => setOrderMessage(error.message) });
  const mutationError = updateError || sendError || confirmError || createOrderError;
  const quote = data?.quote;

  useEffect(() => {
    if (!quote) return;
    const meta = quote.quoteMeta || {};
    setEditLines((Array.isArray(quote.lines) ? quote.lines : []).map((line: any) => ({ ...line, area: line.area || 'General Selection', quoteImage: line.quoteImage || line.customImageUrl || '' })));
    setDisplayMode(quote.displayMode || 'priced');
    setRemarks(meta.remarks || quote.notes || '');
    setTerms(meta.terms || 'Prices are valid until the quote validity date. Delivery depends on stock availability. Installation, unloading, plumbing and civil work are excluded unless mentioned.');
    setBankDetails(meta.bankDetails || 'Bank details will be shared by Marble Park accounts team at order confirmation.');
    setDiscountPercent(String(quote.discountPercent || 0));
    setCoverImage(quote.coverImage || meta.coverImage || '');
    setTagline(meta.tagline || '');
  }, [quote]);

  async function handleCoverUpload(file: File | null) {
    if (!file) return;
    setCoverError(null);
    setUploadingCover(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('scope', 'product-image');
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok || !json.publicUrl) throw new Error(json.error || 'Upload failed');
      setCoverImage(json.publicUrl);
    } catch (err) {
      setCoverError((err as any)?.message || 'Upload failed');
    } finally {
      setUploadingCover(false);
    }
  }

  const subtotal = useMemo(() => editLines.reduce((sum, line) => sum + lineRate(line).amount, 0), [editLines]);
  const quoteDiscount = subtotal * (Number(discountPercent || 0) / 100);
  const tax = Math.max(0, subtotal - quoteDiscount) * 0.18;
  const total = subtotal - quoteDiscount + tax;
  const showPrices = displayMode !== 'selection';
  const grouped = groupLines(editLines);

  const updateLine = (index: number, patch: any) => setEditLines((current) => current.map((line, idx) => idx === index ? { ...line, ...patch } : line));
  const saveQuote = () => updateQuote({
    variables: {
      id: quote.id,
      input: {
        displayMode,
        discountPercent: Number(discountPercent || 0),
        lines: JSON.stringify(editLines),
        coverImage: coverImage || undefined,
        quoteMeta: JSON.stringify({ remarks, terms, bankDetails, showBrandLogos: true, coverImage, tagline }),
      },
    },
  });

  if (loading && !quote) return <div role="status" aria-live="polite" className="mp-card rounded-[2rem] p-10 text-center font-bold text-[#475569]">Loading quote...</div>;
  if (error && !quote) return <div className="mp-card rounded-[2rem] p-6"><QueryErrorBanner error={error} onRetry={() => refetch()} /></div>;
  if (!quote) return <div className="mp-card rounded-[2rem] p-10 text-center font-bold text-[#475569]">Quote not found.</div>;

  return <div className="space-y-6 pb-10">
    {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
    {mutationError ? <QueryErrorBanner error={mutationError} /> : null}
    <section className="relative overflow-hidden rounded-[2.25rem] bg-[#0e1a3d] p-7 text-white shadow-2xl shadow-[#0e1a3d]/15">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(59,130,246,0.40),transparent_28%),radial-gradient(circle_at_86%_35%,rgba(99,102,241,0.32),transparent_30%)]" />
      <div className="relative flex flex-col justify-between gap-6 xl:flex-row xl:items-end">
        <div>
          <Link href="/dashboard/quotes" className="inline-flex items-center gap-2 text-sm font-black text-[#bfdbfe]"><ArrowLeft className="h-4 w-4" /> Back to quote register</Link>
          <p className="mt-6 text-[10px] font-black uppercase tracking-[0.28em] text-[#bfdbfe]">{quote.status} · {quote.approvalStatus} · {displayMode === 'selection' ? 'selection summary' : 'priced quote'}</p>
          <h1 className="mt-2 max-w-4xl text-5xl font-black tracking-[-0.055em]">{quote.quoteNumber}</h1>
          <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-[#dbeafe]">{quote.title || quote.projectName || 'Retail quotation'} for {quote.customer?.name || 'Customer'}.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button disabled={savingQuote} onClick={saveQuote} size="lg" className="bg-[#bfdbfe] text-[#0e1a3d] hover:bg-[#dbeafe]"><Save className="mr-2 h-5 w-5" /> Save quote layout</Button>
          <Button asChild size="lg" className="bg-[#ffffff] text-[#0e1a3d] hover:bg-white"><a href={`/api/pdf/quote/${quote.id}`} target="_blank" rel="noreferrer"><Download className="mr-2 h-5 w-5" /> Download PDF</a></Button>
          {quote.status !== 'sent' && quote.status !== 'confirmed' && <Button disabled={sending || quote.approvalStatus === 'pending'} onClick={() => sendQuote({ variables: { id: quote.id } })} variant="warning" size="lg"><Send className="mr-2 h-5 w-5" /> Mark sent</Button>}
          {quote.status !== 'confirmed' && <Button disabled={confirming || quote.approvalStatus === 'pending'} onClick={() => confirmQuote({ variables: { id: quote.id } })} size="lg"><CheckCircle className="mr-2 h-5 w-5" /> Confirm & dispatch</Button>}
        </div>
      </div>
    </section>

    {displayMode === 'selection' ? (
      <section className="mp-card rounded-[2rem] p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <div className="lg:w-1/2 space-y-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-[#475569]">PDF cover (selection layout)</p>
            <div className="flex items-center gap-3">
              <div className="grid h-24 w-40 place-items-center overflow-hidden rounded-2xl border border-[#cbd5e1]/15 bg-[#dbeafe]/40">
                {coverImage ? (
                  <img src={coverImage} alt="Quote cover preview" className="h-full w-full object-cover" />
                ) : (
                  <span className="px-3 text-center text-xs font-bold text-[#475569]">No cover image yet</span>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-[#0e1a3d] px-4 py-2 text-xs font-black text-white">
                  <ImagePlus className="h-4 w-4" />
                  {uploadingCover ? 'Uploading…' : (coverImage ? 'Replace cover' : 'Upload cover')}
                  <input type="file" accept="image/*" className="hidden" onChange={(event) => handleCoverUpload(event.target.files?.[0] ?? null)} />
                </label>
                {coverImage ? (
                  <button type="button" onClick={() => setCoverImage('')} className="text-xs font-bold text-[#2563eb] underline">Remove cover</button>
                ) : null}
              </div>
            </div>
            {coverError ? <p role="alert" className="rounded-xl bg-red-50 p-2 text-xs font-bold text-red-700">{coverError}</p> : null}
          </div>
          <div className="lg:w-1/2 space-y-3">
            <label className="block space-y-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-[#475569]">Tagline (printed at top of cover)</span>
              <input
                value={tagline}
                onChange={(event) => setTagline(event.target.value)}
                placeholder="Below Are The Best Quoted Rates, For The Material You Have Selected For Your Prestegious Project."
                className="h-11 w-full rounded-2xl border border-[#cbd5e1]/15 bg-white px-4 text-sm font-bold text-[#0e1a3d]"
              />
            </label>
            <p className="text-xs font-bold leading-5 text-[#475569]">Selection layout puts the cover image, tagline, client/architect ribbon and per-area "Utilize / Size / Design Name" cards on the PDF — ideal for tile selections shared with architects.</p>
          </div>
        </div>
      </section>
    ) : null}

    <section className="grid gap-5 xl:grid-cols-[1fr_0.42fr]">
      <div className="space-y-5">
        <div className="mp-card rounded-[2rem] p-5">
          <div className="grid gap-4 md:grid-cols-4">
            <label className="space-y-2"><span className="text-[10px] font-black uppercase tracking-wider text-[#475569]">PDF type</span><select value={displayMode} onChange={(event)=>setDisplayMode(event.target.value)} className="h-11 w-full rounded-2xl border border-[#cbd5e1]/15 bg-white px-4 text-sm font-black"><option value="priced">Show prices - quotation</option><option value="selection">Hide prices - selection summary</option></select></label>
            <label className="space-y-2"><span className="text-[10px] font-black uppercase tracking-wider text-[#475569]">Quote discount %</span><input type="number" value={discountPercent} onChange={(event)=>setDiscountPercent(event.target.value)} className="h-11 w-full rounded-2xl border border-[#cbd5e1]/15 bg-white px-4 text-sm font-black" /></label>
            <label className="space-y-2 md:col-span-2"><span className="text-[10px] font-black uppercase tracking-wider text-[#475569]">Remarks</span><input value={remarks} onChange={(event)=>setRemarks(event.target.value)} className="h-11 w-full rounded-2xl border border-[#cbd5e1]/15 bg-white px-4 text-sm font-black" /></label>
          </div>
        </div>

        {grouped.map((group) => <div key={group.area} className="overflow-hidden rounded-[2rem] border border-[#cbd5e1]/10 bg-[#ffffff]/85 shadow-xl shadow-[#475569]/8">
          <div className="border-b border-[#cbd5e1]/10 bg-[#0e1a3d] px-5 py-4 text-[10px] font-black uppercase tracking-widest text-[#bfdbfe]">{group.area} · {group.rows.length} item(s)</div>
          <div className="divide-y divide-[#cbd5e1]/10">
            {group.rows.map((line: any) => {
              const index = editLines.indexOf(line);
              const rate = lineRate(line);
              return <article key={`${line.sku}-${index}`} className="grid gap-4 p-5 xl:grid-cols-[8rem_1fr_7rem_7rem_7rem_7rem] xl:items-center">
                <ProductImageFrame src={productImage(line)} alt={line.name} className="h-28 w-32 rounded-[1.35rem]" imageClassName="p-2" />
                <div className="space-y-2">
                  <input value={line.area || ''} onChange={(event)=>updateLine(index,{area:event.target.value})} className="h-9 w-full rounded-xl border border-[#cbd5e1]/15 bg-white px-3 text-xs font-black uppercase tracking-wider text-[#2563eb]" placeholder="Area / room" />
                  <p className="text-lg font-black text-[#0e1a3d]">{line.name}</p>
                  <p className="text-xs font-black uppercase tracking-wider text-[#475569]">{line.sku || line.tileCode} · {line.brand || line.category || ''}</p>
                  <div className="flex items-center gap-2"><ImagePlus className="h-4 w-4 text-[#2563eb]"/><input value={line.quoteImage || ''} onChange={(event)=>updateLine(index,{quoteImage:event.target.value})} placeholder="Optional quote image URL" className="h-9 flex-1 rounded-xl border border-[#cbd5e1]/15 bg-white px-3 text-xs font-bold" /></div>
                </div>
                <label className="space-y-1"><span className="text-[10px] font-black uppercase tracking-wider text-[#475569]">Qty</span><input type="number" value={line.qty || line.quantity || 0} onChange={(event)=>updateLine(index,{qty:Number(event.target.value)})} className="h-10 w-full rounded-xl border border-[#cbd5e1]/15 bg-white px-3 text-sm font-black" /></label>
                <label className="space-y-1"><span className="text-[10px] font-black uppercase tracking-wider text-[#475569]">MRP</span><input type="number" value={line.price || line.sellPrice || 0} onChange={(event)=>updateLine(index,{price:Number(event.target.value),sellPrice:Number(event.target.value)})} className="h-10 w-full rounded-xl border border-[#cbd5e1]/15 bg-white px-3 text-sm font-black" /></label>
                <label className="space-y-1"><span className="text-[10px] font-black uppercase tracking-wider text-[#475569]">Disc %</span><input type="number" value={line.discountPercent || line.discount || 0} onChange={(event)=>updateLine(index,{discountPercent:Number(event.target.value)})} className="h-10 w-full rounded-xl border border-[#cbd5e1]/15 bg-white px-3 text-sm font-black" /></label>
                <div className="text-right"><p className="text-[10px] font-black uppercase tracking-wider text-[#475569]">Special / total</p><p className="mt-1 font-black text-[#0e1a3d]">{money(rate.specialRate)}</p>{showPrices && <p className="text-xl font-black text-[#047857]">{money(rate.amount)}</p>}</div>
              </article>;
            })}
          </div>
        </div>)}
      </div>

      <aside className="space-y-5">
        <div className="mp-card rounded-[2rem] p-6"><h2 className="text-2xl font-black tracking-tight">Customer</h2><p className="mt-4 text-lg font-black text-[#0e1a3d]">{quote.customer?.name || 'Customer'}</p><p className="mt-2 text-sm font-bold text-[#475569]">{quote.customer?.mobile || quote.customer?.phone}</p><p className="mt-2 text-sm font-bold text-[#475569]">{quote.customer?.siteAddress || quote.customer?.city}</p></div>
        <div className="mp-card rounded-[2rem] p-6"><h2 className="text-2xl font-black tracking-tight">Totals</h2>{showPrices ? <div className="mt-5 space-y-3 text-sm font-bold text-[#1e293b]"><div className="flex justify-between"><span>Subtotal</span><span>{money(subtotal)}</span></div><div className="flex justify-between"><span>Discount</span><span>{money(quoteDiscount)}</span></div><div className="flex justify-between"><span>GST 18%</span><span>{money(tax)}</span></div><div className="flex justify-between border-t border-[#cbd5e1]/10 pt-4 text-2xl font-black text-[#0e1a3d]"><span>Total</span><span>{money(total)}</span></div></div> : <p className="mt-4 rounded-2xl bg-[#dbeafe]/70 p-4 text-sm font-black text-[#1d4ed8]">Selection summary mode hides all prices in the PDF.</p>}</div>
        <div className="mp-card rounded-[2rem] p-6"><h2 className="text-2xl font-black tracking-tight">PDF terms</h2><label className="mt-4 block space-y-2"><span className="text-[10px] font-black uppercase tracking-wider text-[#475569]">Terms</span><textarea value={terms} onChange={(event)=>setTerms(event.target.value)} className="min-h-28 w-full rounded-2xl border border-[#cbd5e1]/15 bg-white px-4 py-3 text-xs font-bold" /></label><label className="mt-3 block space-y-2"><span className="text-[10px] font-black uppercase tracking-wider text-[#475569]">Bank details</span><textarea value={bankDetails} onChange={(event)=>setBankDetails(event.target.value)} className="min-h-24 w-full rounded-2xl border border-[#cbd5e1]/15 bg-white px-4 py-3 text-xs font-bold" /></label></div>
        <div className="mp-card rounded-[2rem] p-6"><h2 className="text-2xl font-black tracking-tight">Convert to sales order</h2><p className="mt-2 text-sm font-bold text-[#475569]">Use after final customer confirmation. Cash orders capture advance/full payment; credit orders are tagged for owner reports.</p><label className="mt-4 block space-y-2"><span className="text-[10px] font-black uppercase tracking-wider text-[#475569]">Payment</span><select value={paymentMode} onChange={(e)=>setPaymentMode(e.target.value)} className="h-11 w-full rounded-2xl border border-[#cbd5e1]/15 bg-white px-4 text-sm font-black"><option value="cash">Cash</option><option value="credit">Credit</option></select></label>{paymentMode === 'cash' && <label className="mt-3 block space-y-2"><span className="text-[10px] font-black uppercase tracking-wider text-[#475569]">Advance / full paid</span><input type="number" value={advanceAmount} onChange={(e)=>setAdvanceAmount(e.target.value)} className="h-11 w-full rounded-2xl border border-[#cbd5e1]/15 bg-white px-4 text-sm font-black" /></label>}{orderMessage && <p className="mt-3 rounded-2xl bg-[#dbeafe]/70 p-3 text-xs font-black uppercase tracking-wider text-[#1d4ed8]">{orderMessage}</p>}<Button className="mt-4 w-full" disabled={creatingOrder || quote.approvalStatus === 'pending'} onClick={()=>createSalesOrder({variables:{input:{quoteId:quote.id,paymentMode,advanceAmount:Number(advanceAmount||0),notes:'Created from quote detail'}}})}>Create sales order</Button>{quote.approvalStatus === 'pending' && <p className="mt-2 text-xs font-bold text-red-700">Owner approval required before conversion.</p>}</div>
      </aside>
    </section>
  </div>;
}
