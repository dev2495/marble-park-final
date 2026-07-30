'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { gql, useMutation, useQuery } from '@apollo/client';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BadgeCheck, Building2, Check, Download, Image as ImageIcon, ImagePlus, PenLine, Printer, Save, Send, Share2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ProductImageFrame } from '@/components/product-image-frame';
import { QueryErrorBanner } from '@/components/query-state';

const QUOTE_DETAIL = gql`
  query QuoteDetail($id: ID!) {
    quote(id: $id) {
      id quoteNumber title projectName status approvalStatus discountPercent displayMode createdAt validUntil sentAt confirmedAt notes lines quoteMeta customer owner lead approval coverImage
      versionNumber supersedesQuoteId supersededByQuoteId intentId
    }
    documentSettings { data }
    masterProductBrands(status: "active")
  }
`;

const UPDATE_QUOTE = gql`mutation UpdateQuote($id: ID!, $input: UpdateQuoteInput!) { updateQuote(id: $id, input: $input) { id displayMode lines quoteMeta approvalStatus status } }`;
const UPDATE_QUOTE_PRESENTATION = gql`mutation UpdateQuotePresentation($id: ID!, $input: UpdateQuotePresentationInput!) { updateQuotePresentation(id: $id, input: $input) { id displayMode lines quoteMeta coverImage } }`;
const SEND_QUOTE = gql`mutation SendQuote($id: ID!) { sendQuote(id: $id) { id status sentAt } }`;
const CREATE_SALES_ORDER = gql`mutation CreateSalesOrderFromQuote($input: CreateSalesOrderInput!) { createSalesOrderFromQuote(input: $input) }`;
const START_REVISION_FROM_QUOTE = gql`mutation StartRevisionFromQuote($quoteId: String!) { startQuoteRevision(quoteId: $quoteId) }`;
const QUOTE_FULFILLMENT = gql`query QuoteFulfillment($quoteId: ID!) { quoteFulfillment(quoteId: $quoteId) }`;
const CLOSE_QUOTE_REMAINDER = gql`mutation CloseQuoteRemainder($quoteId: ID!, $reason: String!) { closeQuoteRemainder(quoteId: $quoteId, reason: $reason) { id status } }`;
const UPLOAD_QUOTE_COVER = gql`mutation UploadQuoteCover($filename: String!, $contentBase64: String!, $scope: String) { uploadStoredAsset(filename: $filename, contentBase64: $contentBase64, scope: $scope) { result } }`;
const CREATE_QUOTE_SHARE = gql`mutation CreateQuoteShare($quoteId: ID!) { createQuoteShare(quoteId: $quoteId) }`;

async function fileBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function money(value: number) { return `₹${Math.round(Number(value || 0)).toLocaleString('en-IN')}`; }
function productImage(line: any) {
  if (line.quoteImage || line.customImageUrl) return line.quoteImage || line.customImageUrl;
  const media = line.media;
  if (!media) return '/catalogue-art/faucet.svg';
  if (typeof media === 'string') {
    try { return JSON.parse(media)?.primary || '/catalogue-art/faucet.svg'; } catch { return media || '/catalogue-art/faucet.svg'; }
  }
  const gallery = Array.isArray(media.gallery) ? media.gallery : [];
  return media.primaryUrl || media.primary || media.primaryImage || (typeof gallery[0] === 'string' ? gallery[0] : gallery[0]?.url) || '/catalogue-art/faucet.svg';
}
function lineRate(line: any) {
  const qty = Number(line.qty || line.quantity || 0);
  const basis = String(line.rateBasis || 'PACK').toUpperCase();
  const pricingQuantity = Number(line.pricingQuantity || (basis === 'AREA'
    ? qty * Number(line.coveragePerPack || 0)
    : basis === 'PIECE' ? qty * Number(line.piecesPerPack || line.pcsPerBox || 1) : qty));
  const price = Number(line.price || line.sellPrice || 0);
  const discount = Number(line.discountPercent || line.discount || 0);
  const specialRate = Number(line.specialRate || line.specialPrice || 0);
  const unitRate = specialRate > 0 ? specialRate : price * (1 - discount / 100);
  return { qty, pricingQuantity, price, discount, specialRate: unitRate, amount: pricingQuantity * unitRate };
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
  const router = useRouter();
  const id = String(params.id);
  const [paymentMode, setPaymentMode] = useState('cash');
  const [advanceAmount, setAdvanceAmount] = useState('0');
  const [orderMessage, setOrderMessage] = useState('');
  const [orderPdfUrl, setOrderPdfUrl] = useState('');
  const [orderQuantities, setOrderQuantities] = useState<Record<string, string>>({});
  const [orderKey, setOrderKey] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [promisedDate, setPromisedDate] = useState('');
  const [closeReason, setCloseReason] = useState('');
  const [editLines, setEditLines] = useState<any[]>([]);
  const [displayMode, setDisplayMode] = useState('priced');
  const [taxMode, setTaxMode] = useState<'gst' | 'non_gst'>('gst');
  const [remarks, setRemarks] = useState('');
  const [terms, setTerms] = useState('');
  const [bankDetails, setBankDetails] = useState('');
  const [discountPercent, setDiscountPercent] = useState('0');
  const [coverImage, setCoverImage] = useState('');
  const [tagline, setTagline] = useState('');
  const [selectedBrandIds, setSelectedBrandIds] = useState<string[]>([]);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [shareMessage, setShareMessage] = useState('');
  const { data, loading, error, refetch } = useQuery(QUOTE_DETAIL, { variables: { id } });
  const { data: fulfillmentData, refetch: refetchFulfillment } = useQuery(QUOTE_FULFILLMENT, { variables: { quoteId: id }, skip: !id });
  const [updateQuote, { loading: savingQuote, error: updateError }] = useMutation(UPDATE_QUOTE, { onCompleted: () => refetch() });
  const [updatePresentation, { loading: savingPresentation, error: presentationError }] = useMutation(UPDATE_QUOTE_PRESENTATION, { onCompleted: () => refetch() });
  const [sendQuote, { loading: sending, error: sendError }] = useMutation(SEND_QUOTE, { onCompleted: () => refetch() });
  const [createSalesOrder, { loading: creatingOrder, error: createOrderError }] = useMutation(CREATE_SALES_ORDER, {
    onCompleted: (result) => {
      const order = result.createSalesOrderFromQuote;
      setOrderMessage(`Sales order ${order.orderNumber} created. Inventory has been reserved where available and dispatch can work split rows.`);
      setOrderPdfUrl(order.documents?.salesOrderPdfUrl || `/api/pdf/order/${order.id}`);
      setOrderKey('');
      refetch();
      refetchFulfillment();
    },
    onError: (error) => {
      setOrderPdfUrl('');
      setOrderMessage(error.message);
    },
  });
  const [closeRemainder, { loading: closingRemainder, error: closeRemainderError }] = useMutation(CLOSE_QUOTE_REMAINDER, {
    onCompleted: () => { setCloseReason(''); setOrderMessage('Remaining quote quantities were closed. The existing sales order history is preserved.'); refetch(); refetchFulfillment(); },
  });
  const [uploadCover] = useMutation(UPLOAD_QUOTE_COVER);
  const [createQuoteShare, { loading: sharing, error: shareError }] = useMutation(CREATE_QUOTE_SHARE);
  const [startRevision, { loading: revising, error: reviseError }] = useMutation(START_REVISION_FROM_QUOTE, {
    onCompleted: (data) => {
      const intent = data?.startQuoteRevision;
      if (intent?.id) router.push(`/dashboard/intents/${intent.id}`);
    },
  });
  const quote = data?.quote;
  const documentSettings = data?.documentSettings?.data || {};
  const brands = useMemo<any[]>(() => (data?.masterProductBrands || []).filter((brand: any) => brand.metadata?.quoteEnabled !== false), [data?.masterProductBrands]);
  const fulfillment = fulfillmentData?.quoteFulfillment;
  const commercialLocked = Boolean(fulfillment?.orders?.length);

  useEffect(() => {
    if (!quote) return;
    const meta = quote.quoteMeta || {};
    setEditLines((Array.isArray(quote.lines) ? quote.lines : []).map((line: any) => ({ ...line, area: line.area || 'General Selection', quoteImage: line.quoteImage || line.customImageUrl || '' })));
    setDisplayMode(quote.displayMode || 'priced');
    setTaxMode(meta.taxMode === 'non_gst' ? 'non_gst' : 'gst');
    setRemarks(meta.remarks || quote.notes || '');
    setTerms(meta.terms || documentSettings.defaultTerms || 'Prices are valid until the quote validity date. Delivery depends on stock availability. Installation, unloading, plumbing and civil work are excluded unless mentioned.');
    setBankDetails(meta.bankDetails || documentSettings.bankDetails || 'Bank details will be shared by Marble Park accounts team at order confirmation.');
    setDiscountPercent(String(quote.discountPercent || 0));
    setCoverImage(quote.coverImage || meta.coverImage || '');
    setTagline(meta.tagline || documentSettings.documentTagline || '');
    const mode = String(documentSettings.quoteBrandSelectionMode || 'all');
    const defaults = new Set((Array.isArray(documentSettings.quoteBrandIds) ? documentSettings.quoteBrandIds : []).map(String));
    setSelectedBrandIds(Array.isArray(meta.selectedBrandIds)
      ? meta.selectedBrandIds.map(String)
      : mode === 'none' ? [] : brands.filter((brand: any) => mode === 'all' || defaults.has(String(brand.id))).map((brand: any) => String(brand.id)));
  }, [brands, documentSettings.bankDetails, documentSettings.defaultTerms, documentSettings.documentTagline, documentSettings.quoteBrandIds, documentSettings.quoteBrandSelectionMode, quote]);

  useEffect(() => {
    const lines = fulfillment?.lines;
    if (!Array.isArray(lines)) return;
    setOrderQuantities((current) => {
      const next = { ...current };
      for (const line of lines) if (next[line.id] === undefined) next[line.id] = String(line.remaining || 0);
      return next;
    });
  }, [fulfillment]);

  async function handleCoverUpload(file: File | null) {
    if (!file) return;
    setCoverError(null);
    setUploadingCover(true);
    try {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size <= 0 || file.size > 5 * 1024 * 1024) {
        throw new Error('Use a JPG, PNG, or WebP image smaller than 5 MB.');
      }
      const result = await uploadCover({ variables: { filename: file.name, contentBase64: await fileBase64(file), scope: 'product-image' } });
      const publicUrl = result.data?.uploadStoredAsset?.result?.publicUrl;
      if (!publicUrl) throw new Error('Upload failed');
      setCoverImage(publicUrl);
    } catch (err) {
      setCoverError((err as any)?.message || 'Upload failed');
    } finally {
      setUploadingCover(false);
    }
  }

  const subtotal = useMemo(() => editLines.reduce((sum, line) => sum + lineRate(line).amount, 0), [editLines]);
  const quoteDiscount = subtotal * (Number(discountPercent || 0) / 100);
  const discountFactor = Math.max(0, 1 - Number(discountPercent || 0) / 100);
  const tax = taxMode === 'non_gst' ? 0 : editLines.reduce((sum, line) => sum + lineRate(line).amount * discountFactor * Math.max(0, Number(line.taxRate ?? 18)) / 100, 0);
  const total = subtotal - quoteDiscount + tax;
  const showPrices = displayMode !== 'selection';
  const grouped = groupLines(editLines);
  const quotedBrandIds = brands.filter((brand: any) => editLines.some((line: any) => String(line.brand || '').trim().toLowerCase() === String(brand.name || '').trim().toLowerCase())).map((brand: any) => String(brand.id));

  const updateLine = (index: number, patch: any) => setEditLines((current) => current.map((line, idx) => idx === index ? { ...line, ...patch } : line));
  const presentationInput = () => ({
    displayMode,
    coverImage,
    quoteMeta: JSON.stringify({ remarks, terms, bankDetails, taxMode, showBrandLogos: selectedBrandIds.length > 0, selectedBrandIds, coverImage, tagline }),
    linePresentation: JSON.stringify(editLines.map((line, index) => ({
      lineKey: line.lineKey || line.id || `index:${index}`,
      area: line.area || '',
      quoteImage: line.quoteImage || '',
      customImageUrl: line.customImageUrl || line.quoteImage || '',
      designCode: line.designCode || '',
    }))),
  });
  const saveQuote = () => commercialLocked
    ? updatePresentation({ variables: { id: quote.id, input: presentationInput() } })
    : updateQuote({ variables: { id: quote.id, input: {
      ...presentationInput(),
      linePresentation: undefined,
      discountPercent: Number(discountPercent || 0),
      lines: JSON.stringify(editLines.map((line) => ({ ...line, taxRate: taxMode === 'non_gst' ? 0 : Number(line.taxRate ?? 18) }))),
    } } });

  async function shareQuote() {
    setShareMessage('');
    const result = await createQuoteShare({ variables: { quoteId: quote.id } });
    const token = result.data?.createQuoteShare?.token;
    if (!token) return;
    const url = `${window.location.origin}/share/quotes/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setShareMessage('Customer share link copied. It expires in 30 days and can be revoked.');
    } catch {
      setShareMessage(`Share link: ${url}`);
    }
  }

  if (loading && !quote) return <div role="status" aria-live="polite" className="mp-card rounded-r5 p-10 text-center font-bold text-[var(--ink-4)]">Loading quote...</div>;
  if (error && !quote) return <div className="mp-card rounded-r5 p-6"><QueryErrorBanner error={error} onRetry={() => refetch()} /></div>;
  if (!quote) return <div className="mp-card rounded-r5 p-10 text-center font-bold text-[var(--ink-4)]">Quote not found.</div>;

  return <div className="space-y-6 pb-10">
    {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
    {commercialLocked ? <section className="flex flex-col gap-3 rounded-r4 border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold">Commercial terms are locked after sales-order conversion.</p><p className="mt-1 text-xs leading-5 text-amber-800">You can still save cover, room labels, product images, terms and brand logos. Revise the quote to change quantity, rates, discount or GST.</p></div><Button size="sm" variant="outline" disabled={revising} onClick={() => startRevision({ variables: { quoteId: quote.id } })}><PenLine className="mr-2 h-4 w-4" />Revise commercial terms</Button></section> : null}
    <section className="relative overflow-hidden rounded-r5 border border-[var(--line)] bg-[var(--surface)] p-6 shadow-md-soft">
      <div className="relative flex flex-col justify-between gap-6 xl:flex-row xl:items-end">
        <div>
          <Link href="/dashboard/quotes" className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--ink-4)]"><ArrowLeft className="h-4 w-4" /> Back to quote register</Link>
          <p className="mt-5 text-xs font-medium uppercase tracking-[0.14em] text-[var(--brand-700)]">{quote.status} · {quote.approvalStatus} · {displayMode === 'selection' ? 'selection summary' : 'priced quote'}</p>
          <h1 className="mt-2 flex max-w-4xl flex-wrap items-center gap-2 font-display text-3xl font-bold text-[var(--ink)]">
            {quote.quoteNumber}
            <span className="rounded-full bg-[var(--brand-600)] px-2.5 py-0.5 text-sm font-bold text-white">v{quote.versionNumber || 1}</span>
            {quote.supersededByQuoteId ? <span className="rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-bold text-slate-700">Superseded</span> : null}
            {quote.supersedesQuoteId ? <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-bold text-violet-800">Replaces prior</span> : null}
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-[var(--ink-3)]">{quote.title || quote.projectName || 'Retail quotation'} for {quote.customer?.name || 'Customer'}.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {!quote.supersededByQuoteId && !['lost', 'expired', 'won'].includes(quote.status) ? (
            <Button size="lg" variant="outline" disabled={revising} onClick={() => startRevision({ variables: { quoteId: quote.id } })}>
              <PenLine className="mr-2 h-5 w-5" /> {revising ? 'Starting...' : 'Revise quote'}
            </Button>
          ) : null}
          <Button disabled={savingQuote || savingPresentation || quote.status === 'superseded'} onClick={saveQuote} size="lg" variant="outline"><Save className="mr-2 h-5 w-5" /> {commercialLocked ? 'Save document presentation' : 'Save quote changes'}</Button>
          <Button asChild size="lg"><a href={`/api/pdf/quote/${quote.id}?download=1`}><Download className="mr-2 h-5 w-5" /> Download PDF</a></Button>
          <Button asChild size="lg" variant="outline"><a href={`/api/pdf/quote/${quote.id}`} target="_blank" rel="noreferrer"><Printer className="mr-2 h-5 w-5" /> Print</a></Button>
          <Button size="lg" variant="outline" disabled={sharing} onClick={shareQuote}><Share2 className="mr-2 h-5 w-5" />{sharing ? 'Creating link...' : 'Share'}</Button>
          {quote.status !== 'sent' && quote.status !== 'confirmed' && quote.status !== 'superseded' && <Button disabled={sending} onClick={() => sendQuote({ variables: { id: quote.id } })} variant="warning" size="lg"><Send className="mr-2 h-5 w-5" /> Mark sent</Button>}
        </div>
      </div>
      {shareMessage ? <p role="status" className="relative mt-4 rounded-r3 border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{shareMessage}</p> : null}
      {shareError ? <div className="relative mt-4"><QueryErrorBanner error={shareError} /></div> : null}
      {quote.supersededByQuoteId ? (
        <div className="relative mt-4 flex flex-wrap items-center gap-3 rounded-r4 border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
          <Sparkles className="h-4 w-4" />
          <span>This quote has been superseded by a newer revision. View the active version:</span>
          <Link href={`/dashboard/quotes/${quote.supersededByQuoteId}`} className="rounded-full bg-amber-700 px-2.5 py-0.5 text-xs font-bold text-white hover:bg-amber-800">
            Go to current version
          </Link>
        </div>
      ) : null}
      {quote.supersedesQuoteId ? (
        <div className="relative mt-3 flex flex-wrap items-center gap-3 rounded-r4 border border-violet-200 bg-violet-50 p-3 text-sm font-semibold text-violet-900">
          <PenLine className="h-4 w-4" />
          <span>This is a revision. View the prior version:</span>
          <Link href={`/dashboard/quotes/${quote.supersedesQuoteId}`} className="rounded-full bg-violet-700 px-2.5 py-0.5 text-xs font-bold text-white hover:bg-violet-800">
            See previous version
          </Link>
        </div>
      ) : null}
    </section>

    {displayMode === 'selection' ? (
      <section className="mp-card rounded-r5 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <div className="lg:w-1/2 space-y-3">
            <p className="text-xs font-medium uppercase tracking-widest text-[var(--ink-4)]">PDF cover (selection layout)</p>
            <div className="flex items-center gap-3">
              <div className="grid h-24 w-40 place-items-center overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--brand-50)]">
                {coverImage ? (
                  <img src={coverImage} alt="Quote cover preview" className="h-full w-full object-cover" />
                ) : (
                  <span className="px-3 text-center text-xs font-bold text-[var(--ink-4)]">No cover image yet</span>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-[var(--ink)] px-4 py-2 text-xs font-semibold text-[var(--surface)]">
                  <ImagePlus className="h-4 w-4" />
                  {uploadingCover ? 'Uploading…' : (coverImage ? 'Replace cover' : 'Upload cover')}
                  <input type="file" accept="image/*" className="hidden" onChange={(event) => handleCoverUpload(event.target.files?.[0] ?? null)} />
                </label>
                {coverImage ? (
                  <button type="button" onClick={() => setCoverImage('')} className="text-xs font-bold text-[var(--brand-700)] underline">Remove cover</button>
                ) : null}
              </div>
            </div>
            {coverError ? <p role="alert" className="rounded-xl bg-red-50 p-2 text-xs font-bold text-red-700">{coverError}</p> : null}
          </div>
          <div className="lg:w-1/2 space-y-3">
            <label className="block space-y-2">
              <span className="text-xs font-medium uppercase tracking-widest text-[var(--ink-4)]">Tagline (printed at top of cover)</span>
              <input
                value={tagline}
                onChange={(event) => setTagline(event.target.value)}
                placeholder="Below Are The Best Quoted Rates, For The Material You Have Selected For Your Prestegious Project."
                className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-sm font-bold text-[var(--ink)]"
              />
            </label>
            <p className="text-xs font-bold leading-5 text-[var(--ink-4)]">Selection layout puts the cover image, tagline, client/architect ribbon and per-area "Utilize / Size / Design Name" cards on the PDF — ideal for tile selections shared with architects.</p>
          </div>
        </div>
      </section>
    ) : null}

    <section className="grid gap-5 xl:grid-cols-[1fr_0.42fr]">
      <div className="space-y-5">
        <div className="mp-card rounded-r5 p-5">
          <div className="grid gap-4 md:grid-cols-5">
            <label className="space-y-2"><span className="text-xs font-medium uppercase tracking-wider text-[var(--ink-4)]">PDF type</span><select value={displayMode} onChange={(event)=>setDisplayMode(event.target.value)} className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-sm font-black"><option value="priced">Show prices - quotation</option><option value="selection">Hide prices - selection summary</option></select></label>
            <label className="space-y-2"><span className="text-xs font-medium uppercase tracking-wider text-[var(--ink-4)]">Tax treatment</span><select disabled={commercialLocked} value={taxMode} onChange={(event)=>setTaxMode(event.target.value as 'gst' | 'non_gst')} className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-sm font-black disabled:cursor-not-allowed disabled:opacity-55"><option value="gst">GST quotation</option><option value="non_gst">Without GST</option></select></label>
            <label className="space-y-2"><span className="text-xs font-medium uppercase tracking-wider text-[var(--ink-4)]">Quote discount %</span><input disabled={commercialLocked} type="number" value={discountPercent} onChange={(event)=>setDiscountPercent(event.target.value)} className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-sm font-black disabled:cursor-not-allowed disabled:opacity-55" /></label>
            <label className="space-y-2 md:col-span-2"><span className="text-xs font-medium uppercase tracking-wider text-[var(--ink-4)]">Remarks</span><input value={remarks} onChange={(event)=>setRemarks(event.target.value)} className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-sm font-black" /></label>
          </div>
        </div>

        {grouped.map((group) => <div key={group.area} className="overflow-hidden rounded-r5 border border-[var(--line)] bg-[var(--surface)] shadow-md-soft">
          <div className="border-b border-[var(--line)] bg-[var(--ink)] px-5 py-4 text-xs font-medium uppercase tracking-widest text-[var(--surface)]">{group.area} · {group.rows.length} item(s)</div>
          <div className="divide-y divide-[var(--line)]">
            {group.rows.map((line: any) => {
              const index = editLines.indexOf(line);
              const rate = lineRate(line);
              return <article key={`${line.sku}-${index}`} className="grid gap-4 p-5 xl:grid-cols-[8rem_1fr_7rem_7rem_7rem_7rem] xl:items-center">
                <ProductImageFrame src={productImage(line)} alt={line.name} className="h-28 w-32 rounded-[1.35rem]" imageClassName="p-2" />
                <div className="space-y-2">
                  <input value={line.area || ''} onChange={(event)=>updateLine(index,{area:event.target.value})} className="h-9 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-xs font-black uppercase tracking-wider text-[var(--brand-700)]" placeholder="Area / room" />
                  <p className="text-lg font-semibold text-[var(--ink)]">{line.name}</p>
                  <p className="text-xs font-black uppercase tracking-wider text-[var(--ink-4)]">{line.sku || line.tileCode} · {line.brand || line.category || ''}</p>
                  <div className="flex items-center gap-2"><ImagePlus className="h-4 w-4 text-[var(--brand-700)]"/><input value={line.quoteImage || ''} onChange={(event)=>updateLine(index,{quoteImage:event.target.value})} placeholder="Optional HTTPS quote image URL" className="h-9 flex-1 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-xs font-bold" /></div><p className="text-[10px] text-[var(--ink-5)]">Saved URLs are copied into Marble Park for reliable PDFs.</p>
                </div>
                <label className="space-y-1"><span className="text-xs font-medium uppercase tracking-wider text-[var(--ink-4)]">Qty</span><input disabled={commercialLocked} type="number" value={line.qty || line.quantity || 0} onChange={(event)=>updateLine(index,{qty:Number(event.target.value)})} className="h-10 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-black disabled:cursor-not-allowed disabled:opacity-55" /></label>
                <label className="space-y-1"><span className="text-xs font-medium uppercase tracking-wider text-[var(--ink-4)]">List rate</span><input disabled={commercialLocked} type="number" min={0} value={line.listPrice ?? line.price ?? line.sellPrice ?? 0} onChange={(event)=>updateLine(index,{listPrice:Number(event.target.value),price:Number(event.target.value),sellPrice:Number(event.target.value)})} className="h-10 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-black disabled:cursor-not-allowed disabled:opacity-55" /></label>
                <label className="space-y-1"><span className="text-xs font-medium uppercase tracking-wider text-[var(--ink-4)]">Disc %</span><input disabled={commercialLocked} type="number" value={line.discountPercent || line.discount || 0} onChange={(event)=>updateLine(index,{discountPercent:Number(event.target.value)})} className="h-10 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-black disabled:cursor-not-allowed disabled:opacity-55" /></label>
                <div className="text-right"><p className="text-xs font-medium uppercase tracking-wider text-[var(--ink-4)]">Negotiated / total</p><input disabled={commercialLocked} aria-label={`Negotiated rate for ${line.name}`} type="number" min={0} value={line.specialRate ?? line.specialPrice ?? ''} placeholder={String(rate.specialRate)} onChange={(event)=>updateLine(index,{specialRate:event.target.value})} className="mt-1 h-10 w-full rounded-xl border border-[var(--brand-400)] bg-[var(--brand-50)] px-2 text-right text-sm font-black disabled:cursor-not-allowed disabled:opacity-55" />{showPrices && <p className="mt-1 text-xl font-black text-[var(--success)]">{money(rate.amount)}</p>}</div>
              </article>;
            })}
          </div>
        </div>)}
      </div>

      <aside className="space-y-5">
        <div className="mp-card rounded-r5 p-6"><h2 className="text-2xl font-black tracking-tight">Customer</h2><p className="mt-4 text-lg font-semibold text-[var(--ink)]">{quote.customer?.name || 'Customer'}</p><p className="mt-2 text-sm font-bold text-[var(--ink-4)]">{quote.customer?.mobile || quote.customer?.phone}</p><p className="mt-2 text-sm font-bold text-[var(--ink-4)]">{quote.customer?.siteAddress || quote.customer?.city}</p></div>
        <div className="mp-card rounded-r5 p-6"><h2 className="text-2xl font-black tracking-tight">Totals</h2>{showPrices ? <div className="mt-5 space-y-3 text-sm font-bold text-[var(--ink-2)]"><div className="flex justify-between"><span>Subtotal</span><span>{money(subtotal)}</span></div><div className="flex justify-between"><span>Discount</span><span>{money(quoteDiscount)}</span></div>{taxMode === 'gst' ? <div className="flex justify-between"><span>GST</span><span>{money(tax)}</span></div> : <div className="flex justify-between text-[var(--ink-4)]"><span>Tax treatment</span><span>Without GST</span></div>}<div className="flex justify-between border-t border-[var(--line)] pt-4 text-2xl font-semibold text-[var(--ink)]"><span>Total</span><span>{money(total)}</span></div></div> : <p className="mt-4 rounded-2xl bg-[var(--brand-50)] p-4 text-sm font-black text-[var(--brand-700)]">Selection summary mode hides all prices in the PDF.</p>}</div>
        <div className="mp-panel p-5">
          <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--brand-700)]">Quotation footer</p><h2 className="mt-1 text-xl font-semibold text-[var(--ink)]">Served brands</h2></div><span className="rounded-full bg-[var(--brand-50)] px-2.5 py-1 text-xs font-semibold text-[var(--brand-700)]">{selectedBrandIds.length} selected</span></div>
          <p className="mt-2 text-xs leading-5 text-[var(--ink-4)]">Only selected logos are printed in the customer PDF. Brand Master controls the artwork.</p>
          <div className="mt-4 flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={() => setSelectedBrandIds(brands.map((brand: any) => String(brand.id)))}>All brands</Button><Button type="button" size="sm" variant="outline" disabled={!quotedBrandIds.length} onClick={() => setSelectedBrandIds(quotedBrandIds)}><BadgeCheck className="mr-1.5 h-3.5 w-3.5" />Quoted brands</Button><Button type="button" size="sm" variant="ghost" onClick={() => setSelectedBrandIds([])}>Clear</Button></div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {brands.map((brand: any) => {
              const selected = selectedBrandIds.includes(String(brand.id));
              return <button key={brand.id} type="button" onClick={() => setSelectedBrandIds((current) => selected ? current.filter((id) => id !== String(brand.id)) : [...current, String(brand.id)])} className={`relative grid min-h-20 place-items-center rounded-md border bg-white p-2 transition ${selected ? 'border-[var(--brand-500)] ring-2 ring-[var(--ring)]' : 'border-[var(--line)] hover:border-[var(--line-strong)]'}`}>
                {brand.metadata?.logoUrl ? <img src={brand.metadata.logoUrl} alt={brand.name} className="max-h-10 max-w-full object-contain" /> : <span className="line-clamp-2 text-center text-xs font-semibold text-[var(--ink-3)]">{brand.name}</span>}
                <span className="mt-1 max-w-full truncate text-[10px] font-semibold text-[var(--ink-4)]">{brand.name}</span>
                {selected ? <span className="absolute right-1.5 top-1.5 grid h-4 w-4 place-items-center rounded-full bg-[var(--brand-600)] text-white"><Check className="h-2.5 w-2.5" /></span> : null}
              </button>;
            })}
          </div>
          {!brands.length ? <Link href="/dashboard/master-data/brands" className="mt-4 flex items-center gap-2 rounded-md border border-dashed border-[var(--line-strong)] p-3 text-xs font-semibold text-[var(--brand-700)]"><ImageIcon className="h-4 w-4" />Upload logos in Brand Master</Link> : null}
        </div>
        <div className="mp-panel p-5"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center overflow-hidden rounded-md border border-[var(--line)] bg-white p-1">{documentSettings.logoUrl ? <img src={documentSettings.logoUrl} alt="Company logo" className="max-h-full max-w-full object-contain" /> : <Building2 className="h-4 w-4 text-[var(--ink-4)]" />}</div><div><p className="font-semibold text-[var(--ink)]">{documentSettings.companyName || 'Marble Park'}</p><p className="text-xs text-[var(--ink-4)]">{documentSettings.gstNumber ? `GSTIN ${documentSettings.gstNumber}` : 'Company profile managed globally'}</p></div></div><Link href="/dashboard/settings" className="mt-4 inline-flex text-xs font-semibold text-[var(--brand-700)]">Edit global quotation identity</Link></div>
        <div className="mp-card rounded-r5 p-6"><h2 className="text-2xl font-black tracking-tight">PDF terms</h2><label className="mt-4 block space-y-2"><span className="text-xs font-medium uppercase tracking-wider text-[var(--ink-4)]">Terms</span><textarea value={terms} onChange={(event)=>setTerms(event.target.value)} className="min-h-28 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-xs font-bold" /></label><label className="mt-3 block space-y-2"><span className="text-xs font-medium uppercase tracking-wider text-[var(--ink-4)]">Bank details</span><textarea value={bankDetails} onChange={(event)=>setBankDetails(event.target.value)} className="min-h-24 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-xs font-bold" /></label></div>
        <div className="mp-card rounded-r5 p-6"><h2 className="text-2xl font-black tracking-tight">Convert selected quantity</h2><p className="mt-2 text-sm font-bold text-[var(--ink-4)]">Choose only the quantities being confirmed now. The remaining balance stays on this quote for the next order or an explicit close-out.</p><div className="mt-4 space-y-2">{(fulfillment?.lines || []).map((line: any) => <label key={line.id} className="grid grid-cols-[1fr_5.5rem] items-center gap-3 rounded-lg border border-[var(--line)] p-3"><span className="min-w-0"><span className="block truncate text-sm font-bold text-[var(--ink)]">{line.sku} · {line.name}</span><span className="text-xs font-semibold text-[var(--ink-4)]">Ordered {line.ordered} of {line.quantity} · remaining {line.remaining}</span></span><input aria-label={`Order quantity for ${line.sku}`} type="number" min={0} max={line.remaining} value={orderQuantities[line.id] ?? ''} onChange={(event) => setOrderQuantities((current) => ({ ...current, [line.id]: event.target.value }))} disabled={!line.remaining} className="h-10 rounded-lg border border-[var(--brand-400)] bg-[var(--brand-50)] px-2 text-right text-sm font-black" /></label>)}{fulfillment && !fulfillment.lines?.length ? <p className="text-sm font-semibold text-[var(--ink-4)]">No remaining quote lines.</p> : null}</div><label className="mt-4 block space-y-2"><span className="text-xs font-medium uppercase tracking-wider text-[var(--ink-4)]">Payment</span><select value={paymentMode} onChange={(e)=>setPaymentMode(e.target.value)} className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-sm font-black"><option value="cash">Cash</option><option value="credit">Credit</option></select></label>{paymentMode === 'cash' && <label className="mt-3 block space-y-2"><span className="text-xs font-medium uppercase tracking-wider text-[var(--ink-4)]">Advance / full paid</span><input type="number" min={0} value={advanceAmount} onChange={(e)=>setAdvanceAmount(e.target.value)} className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-sm font-black" /></label>}<label className="mt-3 block space-y-2"><span className="text-xs font-medium uppercase tracking-wider text-[var(--ink-4)]">Payment terms</span><input value={paymentTerms} onChange={(e)=>setPaymentTerms(e.target.value)} placeholder={paymentMode === 'credit' ? 'Net 30' : 'Cash on order'} className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-sm font-black" /></label><label className="mt-3 block space-y-2"><span className="text-xs font-medium uppercase tracking-wider text-[var(--ink-4)]">Promised dispatch date</span><input type="date" value={promisedDate} onChange={(e)=>setPromisedDate(e.target.value)} className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-sm font-black" /></label>{orderMessage && <div className="mt-3 rounded-2xl bg-[var(--brand-50)] p-3 text-xs font-black uppercase tracking-wider text-[var(--brand-700)]"><p>{orderMessage}</p>{orderPdfUrl ? <a className="mt-2 inline-flex rounded-xl bg-[var(--brand-600)] px-3 py-2 text-white" href={orderPdfUrl} target="_blank" rel="noreferrer"><Download className="mr-2 h-4 w-4" /> Sales order PDF</a> : null}</div>}<Button className="mt-4 w-full" disabled={creatingOrder || quote.status === 'superseded' || !(fulfillment?.lines || []).some((line: any) => Number(orderQuantities[line.id] || 0) > 0)} onClick={()=>{ const key = orderKey || (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`); setOrderKey(key); createSalesOrder({variables:{input:{quoteId:quote.id,paymentMode,advanceAmount:Number(advanceAmount||0),paymentTerms:paymentTerms || undefined,promisedDate:promisedDate || undefined,idempotencyKey:key,lines:JSON.stringify((fulfillment?.lines || []).map((line: any) => ({ quoteLineId: line.id, quantity: Number(orderQuantities[line.id] || 0) })).filter((line: any) => line.quantity > 0)),notes:'Created from quote detail'}}}); }}>{creatingOrder ? 'Creating...' : 'Create selected sales order'}</Button>{(fulfillment?.orders || []).length ? <div className="mt-5 border-t border-[var(--line)] pt-4"><p className="text-xs font-medium uppercase tracking-wider text-[var(--ink-4)]">Orders from this quote</p>{fulfillment.orders.map((order: any) => <div key={order.id} className="mt-2 flex justify-between gap-3 text-sm font-bold"><span>{order.orderNumber} · {order.status}</span><span>{money(order.totalAmount)}</span></div>)}</div> : null}<div className="mt-5 border-t border-[var(--line)] pt-4"><p className="text-xs font-medium uppercase tracking-wider text-[var(--ink-4)]">Close unused remainder</p><input value={closeReason} onChange={(event) => setCloseReason(event.target.value)} placeholder="Reason required to close remaining quantity" className="mt-2 h-10 w-full rounded-lg border border-[var(--line)] px-3 text-sm font-semibold" /><Button variant="outline" className="mt-2 w-full" disabled={closingRemainder || !closeReason.trim() || !(fulfillment?.lines || []).some((line: any) => Number(line.remaining || 0) > 0)} onClick={() => closeRemainder({ variables: { quoteId: quote.id, reason: closeReason } })}>{closingRemainder ? 'Closing...' : 'Close remaining quantity'}</Button></div></div>
      </aside>
    </section>
  </div>;
}
