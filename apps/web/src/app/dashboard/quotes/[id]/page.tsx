'use client';

import Link from 'next/link';
import { groupQuoteLines, requestedQuantityLabel } from '@marble-park/pricing-contract/quote-display';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { gql, useMutation, useQuery } from '@apollo/client';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, BadgeIndianRupee, Building2, Download, ImagePlus, LockKeyhole, PenLine, Printer, Save, Send, Share2, ShieldCheck, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryErrorBanner } from '@/components/query-state';
import { allocateQuoteDiscount, retailLadder, type DiscountMode } from '@/lib/quote-pricing';

const QUOTE_DETAIL = gql`
  query QuoteDetail($id: ID!) {
    quote(id: $id) {
      id quoteNumber title projectName status approvalStatus discountPercent displayMode quoteType createdAt validUntil sentAt confirmedAt notes lines quoteMeta customer owner lead approval coverImage
      versionNumber supersedesQuoteId supersededByQuoteId intentId architectId architectName architect pricingVersion pricingStatus
    }
    architects(status: "active", take: 200)
    documentSettings { data }
    masterProductBrands(status: "active")
  }
`;

const QUOTE_PRODUCTS = gql`
  query QuotePricingProducts($ids: [ID!]!) {
    productsByIds(ids: $ids) {
      id sku internalCode name category brand finish dimensions unit purchaseUom salesUom
      piecesPerPack coveragePerPack defaultMrpInclusive defaultNrpInclusive floorPriceInclusive
      priceRateBasis priceUom mrpVerifiedAt mrpSource pricingVersion media
    }
  }
`;

const UPDATE_QUOTE = gql`mutation UpdateQuote($id: ID!, $input: UpdateQuoteInput!) { updateQuote(id: $id, input: $input) { id displayMode quoteType lines quoteMeta approvalStatus status architectId architectName } }`;
const UPDATE_QUOTE_PRESENTATION = gql`mutation UpdateQuotePresentation($id: ID!, $input: UpdateQuotePresentationInput!) { updateQuotePresentation(id: $id, input: $input) { id displayMode lines quoteMeta coverImage } }`;
const SEND_QUOTE = gql`mutation SendQuote($id: ID!) { sendQuote(id: $id) { id status sentAt } }`;
const CREATE_SALES_ORDER = gql`mutation CreateSalesOrderFromQuote($input: CreateSalesOrderInput!) { createSalesOrderFromQuote(input: $input) }`;
const START_REVISION_FROM_QUOTE = gql`mutation StartRevisionFromQuote($quoteId: String!) { startQuoteRevision(quoteId: $quoteId) }`;
const QUOTE_FULFILLMENT = gql`query QuoteFulfillment($quoteId: ID!) { quoteFulfillment(quoteId: $quoteId) }`;
const CLOSE_QUOTE_REMAINDER = gql`mutation CloseQuoteRemainder($quoteId: ID!, $reason: String!) { closeQuoteRemainder(quoteId: $quoteId, reason: $reason) { id status } }`;
const UPLOAD_QUOTE_COVER = gql`mutation UploadQuoteCover($filename: String!, $contentBase64: String!, $scope: String) { uploadStoredAsset(filename: $filename, contentBase64: $contentBase64, scope: $scope) { result } }`;
const CREATE_QUOTE_SHARE = gql`mutation CreateQuoteShare($quoteId: ID!) { createQuoteShare(quoteId: $quoteId) }`;
const CANCEL_QUOTE = gql`mutation CancelQuote($id: ID!, $reason: String!) { cancelQuote(id: $id, reason: $reason) { id status approvalStatus } }`;

async function fileBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function money(value: number) { return `₹${Math.round(Number(value || 0)).toLocaleString('en-IN')}`; }
function masterBrandCode(brands: any[], name: unknown) {
  const normalized = String(name || '').trim().toLowerCase();
  return String(brands.find((brand: any) => String(brand.name || '').trim().toLowerCase() === normalized)?.code || '').trim();
}
function mrpUom(line: any) {
  if (String(line.category || '').toLowerCase() === 'tiles' && String(line.priceRateBasis || line.rateBasis || '').toUpperCase() === 'AREA') return 'SQFT';
  const basis = String(line.rateBasis || '').toUpperCase();
  if (basis === 'AREA') return String(line.pricingUom || line.salesUom || 'SQFT').toUpperCase();
  if (basis === 'PIECE') return 'PC';
  return String(line.inventoryUom || line.purchaseUom || line.unit || line.uom || 'BOX').toUpperCase();
}
function lineRate(line: any, taxMode: 'gst' | 'non_gst' = 'gst') {
  const qty = Number(line.qty || line.quantity || 0);
  const basis = String(line.priceRateBasis || line.rateBasis || 'BOX').toUpperCase();
  const pricingQuantity = Number(line.pricingQuantity || (basis === 'AREA'
    ? qty * Number(line.coveragePerPack || 0)
    : basis === 'PIECE' ? qty * Number(line.piecesPerPack || line.pcsPerBox || 1) : qty));
  const taxRate = taxMode === 'non_gst' ? 0 : Math.max(0, Number(line.taxRate ?? 18));
  const ladder = retailLadder({
    ...line,
    priceRateBasis: line.priceRateBasis || line.rateBasis || 'BOX',
    mrpInclusive: line.mrpInclusive,
    nrpMode: line.nrpMode || 'PERCENT_OFF_MRP',
    nrpInput: line.nrpInput ?? 0,
    specialMode: line.specialMode || 'NONE',
    specialInput: line.specialInput ?? 0,
  }, pricingQuantity, taxRate);
  return { qty, pricingQuantity, amount: ladder.grossBeforeQuoteDiscount, taxRate, mrpUom: mrpUom(line), ...ladder };
}
function groupLines(lines: any[]) {
  return groupQuoteLines(lines);
}

function quoteFamilyBrandIds(settings: any, brands: any[], quoteType: string) {
  const tile = quoteType === 'tile';
  const mode = String(tile
    ? settings.tileQuoteBrandSelectionMode ?? settings.quoteBrandSelectionMode ?? 'all'
    : settings.cpSanitaryQuoteBrandSelectionMode ?? settings.quoteBrandSelectionMode ?? 'all');
  const configuredIds = tile
    ? settings.tileQuoteBrandIds ?? settings.quoteBrandIds ?? []
    : settings.cpSanitaryQuoteBrandIds ?? settings.quoteBrandIds ?? [];
  const configured = new Set((Array.isArray(configuredIds) ? configuredIds : []).map(String));
  return mode === 'none' ? [] : brands.filter((brand: any) => mode === 'all' || configured.has(String(brand.id))).map((brand: any) => String(brand.id));
}

function legacyNegotiatedRate(line: any, pricingQuantity: number) {
  const direct = [line.specialRateInclusive, line.netSellingPrice, line.nrpInclusive, line.sellingPrice, line.rate]
    .map(Number)
    .find((value) => Number.isFinite(value) && value > 0);
  if (direct) return direct;
  const total = Number(line.grossLineTotal ?? line.total ?? line.lineTotal ?? 0);
  if (Number.isFinite(total) && total > 0 && pricingQuantity > 0) return Number((total / pricingQuantity).toFixed(2));
  const legacyUnit = Number(line.unitPrice ?? line.price ?? 0);
  return Number.isFinite(legacyUnit) && legacyUnit > 0 ? legacyUnit : 0;
}

function prepareLegacyLine(line: any, product: any) {
  const isTile = String(product?.category || line.category || '').toLowerCase() === 'tiles';
  const basis = isTile
    ? 'AREA'
    : String(product?.priceRateBasis || line.priceRateBasis || line.rateBasis || 'BOX').toUpperCase().replace('PACK', 'BOX');
  const qty = Number(line.qty || line.quantity || 0);
  const piecesPerPack = Number(product?.piecesPerPack || line.piecesPerPack || line.pcsPerBox || 1);
  const coveragePerPack = Number(product?.coveragePerPack || line.coveragePerPack || 0);
  const pricingQuantity = basis === 'AREA' ? qty * coveragePerPack : basis === 'PIECE' ? qty * piecesPerPack : qty;
  const legacyRate = legacyNegotiatedRate(line, pricingQuantity);
  const masterNrp = Number(product?.defaultNrpInclusive || 0);
  const fallbackRate = legacyRate > 0 ? legacyRate : masterNrp;
  const mrp = Number(product?.defaultMrpInclusive || 0);
  return {
    ...line,
    productId: product?.id || line.productId,
    sku: product?.sku || line.sku,
    name: product?.name || line.name,
    category: product?.category || line.category,
    brand: product?.brand || line.brand,
    finish: product?.finish || line.finish,
    dimensions: product?.dimensions || line.dimensions,
    media: product?.media || line.media,
    pricingVersion: 'legacy_unverified',
    mrpInclusive: mrp > 0 ? mrp : '',
    mrpSource: mrp > 0 ? 'PRODUCT_MASTER_PENDING_CONFIRMATION' : 'PRODUCT_MASTER_MRP_MISSING',
    floorPriceInclusive: product?.floorPriceInclusive == null ? line.floorPriceInclusive : Number(product.floorPriceInclusive),
    priceRateBasis: basis,
    rateBasis: basis,
    pricingUom: isTile ? 'SQFT' : String(product?.priceUom || line.pricingUom || (basis === 'PIECE' ? 'PC' : product?.salesUom || product?.unit || line.unit || 'BOX')).toUpperCase(),
    inventoryUom: String(product?.purchaseUom || line.inventoryUom || line.purchaseUom || line.unit || 'BOX').toUpperCase(),
    piecesPerPack,
    pcsPerBox: piecesPerPack,
    coveragePerPack,
    nrpMode: 'FIXED_NRP',
    nrpInput: fallbackRate > 0 ? fallbackRate : 0,
    specialMode: 'NONE',
    specialInput: 0,
    area: line.area || 'General Selection',
    quoteImage: line.quoteImage || line.customImageUrl || '',
    legacyPricingPrepared: Boolean(product),
  };
}

export default function QuoteDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
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
  const [quoteDiscountType, setQuoteDiscountType] = useState<DiscountMode>('PERCENT');
  const [quoteDiscountValue, setQuoteDiscountValue] = useState('0');
  const [coverImage, setCoverImage] = useState('');
  const [tagline, setTagline] = useState('');
  const [selectedBrandIds, setSelectedBrandIds] = useState<string[]>([]);
  const [selectedArchitectId, setSelectedArchitectId] = useState('');
  const [uploadingCover, setUploadingCover] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [shareMessage, setShareMessage] = useState('');
  const [validationMessage, setValidationMessage] = useState('');
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
  const [cancelQuote, { loading: cancelling, error: cancelError }] = useMutation(CANCEL_QUOTE, { onCompleted: () => refetch() });
  const [startRevision, { loading: revising, error: reviseError }] = useMutation(START_REVISION_FROM_QUOTE, {
    onCompleted: (data) => {
      const intent = data?.startQuoteRevision;
      if (intent?.id) router.push(`/dashboard/intents/${intent.id}`);
    },
  });
  const quote = data?.quote;
  const quoteProductIds = useMemo<string[]>(() => Array.from(new Set((Array.isArray(quote?.lines) ? quote.lines : [])
    .map((line: any) => String(line.productId || '').trim()).filter(Boolean))), [quote?.lines]);
  const { data: pricingProductsData, loading: pricingProductsLoading } = useQuery(QUOTE_PRODUCTS, {
    variables: { ids: quoteProductIds },
    skip: quoteProductIds.length === 0,
  });
  const documentSettings = useMemo(() => data?.documentSettings?.data || {}, [data?.documentSettings?.data]);
  const brands = useMemo<any[]>(() => (data?.masterProductBrands || []).filter((brand: any) => brand.metadata?.quoteEnabled !== false), [data?.masterProductBrands]);
  const fulfillment = fulfillmentData?.quoteFulfillment;
  const commercialLocked = Boolean(fulfillment?.orders?.length);
  const cancelled = quote?.status === 'cancelled';
  const legacyLineCount = (Array.isArray(quote?.lines) ? quote.lines : []).filter((line: any) => String(line.pricingVersion || '') !== 'unified_retail_v1').length;
  const persistedPricingReady = Boolean(quote
    && quote.status !== 'incomplete_pricing'
    && quote.pricingStatus !== 'incomplete'
    && String(quote.pricingVersion || '') === 'unified_retail_v1'
    && Array.isArray(quote.lines)
    && quote.lines.length > 0
    && quote.lines.every((line: any) => String(line.pricingVersion || '') === 'unified_retail_v1'
      && Number(line.mrpInclusive || 0) > 0
      && line.mrpConfirmedAt
      && line.mrpConfirmedById));

  useEffect(() => {
    if (!quote) return;
    if (quoteProductIds.length > 0 && pricingProductsLoading) return;
    const meta = quote.quoteMeta || {};
    const productMap = new Map((pricingProductsData?.productsByIds || []).map((product: any) => [String(product.id), product]));
    setEditLines((Array.isArray(quote.lines) ? quote.lines : []).map((line: any) => {
      if (String(line.pricingVersion || '') === 'unified_retail_v1') return { ...line, area: line.area || 'General Selection', quoteImage: line.quoteImage || line.customImageUrl || '' };
      return prepareLegacyLine(line, productMap.get(String(line.productId || '')));
    }));
    setDisplayMode(quote.displayMode || 'priced');
    setTaxMode(meta.taxMode === 'non_gst' ? 'non_gst' : 'gst');
    const loadedRemarks = String(meta.remarks || quote.notes || '').trim();
    setRemarks(/^prepared from quote studio\.?$/i.test(loadedRemarks) ? '' : loadedRemarks);
    setTerms(meta.terms || documentSettings.defaultTerms || 'Prices are valid until the quote validity date. Installation, unloading, plumbing and civil work are excluded unless mentioned.');
    setBankDetails(meta.bankDetails || documentSettings.bankDetails || 'Bank details will be shared by Marble Park accounts team at order confirmation.');
    setQuoteDiscountType((meta.quoteDiscount?.mode || meta.quoteDiscount?.type) === 'FIXED_AMOUNT' || meta.quoteDiscount?.type === 'amount' ? 'FIXED_AMOUNT' : 'PERCENT');
    setQuoteDiscountValue(String(meta.quoteDiscount?.value ?? quote.discountPercent ?? 0));
    setCoverImage(quote.coverImage || meta.coverImage || '');
    setTagline(meta.tagline || documentSettings.documentTagline || '');
    setSelectedBrandIds(Array.isArray(meta.selectedBrandIds)
      ? meta.selectedBrandIds.map(String)
      : quoteFamilyBrandIds(documentSettings, brands, quote.quoteType || meta.quoteType || 'cp_sanitary'));
    setSelectedArchitectId(quote.architectId || '');
  }, [brands, documentSettings, pricingProductsData?.productsByIds, pricingProductsLoading, quote, quoteProductIds.length]);

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

  const pricedEditLines = useMemo(() => allocateQuoteDiscount(editLines.map((line, index) => ({ index, ...lineRate(line, taxMode) })), quoteDiscountType, Number(quoteDiscountValue || 0)).map((rate) => {
    const taxableValue = rate.grossAfterQuoteDiscount / (1 + rate.taxRate / 100);
    const taxAmount = rate.grossAfterQuoteDiscount - taxableValue;
    const finalUnitPayable = rate.pricingQuantity > 0 ? rate.grossAfterQuoteDiscount / rate.pricingQuantity : 0;
    const mrpMissing = rate.mrpInclusive === null || !Number.isFinite(rate.mrpInclusive) || Number(rate.mrpInclusive) <= 0;
    return { ...rate, taxableValue, taxAmount, finalUnitPayable, mrpMissing, mrpValid: !mrpMissing && finalUnitPayable <= Number(rate.mrpInclusive) + 0.005 };
  }), [editLines, quoteDiscountType, quoteDiscountValue, taxMode]);
  const rateForLine = (line: any) => pricedEditLines[editLines.indexOf(line)] || lineRate(line, taxMode);
  const subtotal = pricedEditLines.reduce((sum, rate) => sum + rate.grossBeforeQuoteDiscount, 0);
  const quoteDiscount = pricedEditLines.reduce((sum, rate) => sum + rate.quoteDiscountAmount, 0);
  const tax = pricedEditLines.reduce((sum, rate) => sum + rate.taxAmount, 0);
  const total = pricedEditLines.reduce((sum, rate) => sum + rate.grossAfterQuoteDiscount, 0);
  const showPrices = displayMode !== 'selection';
  const grouped = groupLines(editLines);
  const mrpIssues = editLines.map((line) => ({ line, rate: rateForLine(line) })).filter(({ rate }) => rate.mrpMissing || !rate.mrpValid);
  const grossMrp = editLines.reduce((sum, line) => { const rate = rateForLine(line); return sum + (rate.mrpInclusive && rate.mrpInclusive > 0 ? rate.pricingQuantity * rate.mrpInclusive : 0); }, 0);
  const nrpValue = editLines.reduce((sum, line) => sum + Number(rateForLine(line).nrpValueInclusive || 0), 0);
  const specialValue = editLines.reduce((sum, line) => sum + Number(rateForLine(line).specialValueInclusive || 0), 0);
  const missingNrpCount = editLines.filter((line) => Number(rateForLine(line).nrpInclusive || 0) <= 0).length;
  const discountIssues = editLines.flatMap((line) => {
    const rate = rateForLine(line);
    const baseValue = Number(line.nrpInput ?? 0);
    const specialValue = Number(line.specialInput || 0);
    const issues: Array<{ line: any; field: 'base' | 'special'; message: string }> = [];
    if (!Number.isFinite(baseValue) || baseValue < 0 || (rate.nrpMode === 'PERCENT_OFF_MRP' && baseValue > 100) || (rate.nrpMode === 'FIXED_NRP' && baseValue > Math.max(0, Number(rate.mrpInclusive || 0)))) {
      issues.push({ line, field: 'base', message: `NRP decision for ${line.sku || line.name} must be ${rate.nrpMode === 'PERCENT_OFF_MRP' ? 'between 0% and 100%' : `between ₹0 and MRP ${money(rate.mrpInclusive || 0)}`}.` });
    }
    if (!Number.isFinite(specialValue) || specialValue < 0 || (rate.specialMode === 'PERCENT_OFF_NRP' && specialValue > 100) || (rate.specialMode === 'FIXED_SPECIAL_RATE' && specialValue > Math.max(0, Number(rate.nrpInclusive || 0)))) {
      issues.push({ line, field: 'special', message: `Special pricing for ${line.sku || line.name} must be ${rate.specialMode === 'PERCENT_OFF_NRP' ? 'between 0% and 100%' : `between ₹0 and NRP ${money(rate.nrpInclusive || 0)}`}.` });
    }
    return issues;
  });
  const quoteDiscountNumeric = Number(quoteDiscountValue || 0);
  const quoteDiscountIssue = !Number.isFinite(quoteDiscountNumeric) || quoteDiscountNumeric < 0
    || (quoteDiscountType === 'PERCENT' && quoteDiscountNumeric > 100)
    || (quoteDiscountType === 'FIXED_AMOUNT' && quoteDiscountNumeric > subtotal)
    ? `Whole-quote discount must be ${quoteDiscountType === 'PERCENT' ? 'between 0% and 100%' : `between ₹0 and subtotal ${money(subtotal)}`}.`
    : '';
  const pricingIssueCount = mrpIssues.length + discountIssues.length + (quoteDiscountIssue ? 1 : 0);
  const pricingReady = editLines.length > 0 && pricingIssueCount === 0;
  const updateLine = (index: number, patch: any) => setEditLines((current) => current.map((line, idx) => {
    if (idx !== index) return line;
    const updated = { ...line, ...patch };
    if ('qty' in patch) {
      updated.quantity = updated.qty;
      const basis = String(updated.rateBasis || updated.priceRateBasis || '').toUpperCase();
      updated.pricingQuantity = Number(updated.qty) * (basis === 'AREA' ? Number(updated.coveragePerPack || 0) : basis === 'PIECE' ? Number(updated.piecesPerPack || updated.pcsPerBox || 1) : 1);
      updated.calculatedPacks = updated.qty;
    }
    return updated;
  }));
  const presentationInput = () => ({
    displayMode,
    coverImage,
    quoteMeta: JSON.stringify({ remarks, terms, bankDetails, quoteType: quote?.quoteType || 'cp_sanitary', taxMode, pricingVersion: 'unified_retail_v1', quoteDiscount: { mode: quoteDiscountType, value: Number(quoteDiscountValue || 0) }, coverImage, tagline }),
    linePresentation: JSON.stringify(editLines.map((line, index) => ({
      lineKey: line.lineKey || line.id || `index:${index}`,
      area: line.area || '',
      quoteImage: line.quoteImage || '',
      customImageUrl: line.customImageUrl || line.quoteImage || '',
      designCode: line.designCode || '',
    }))),
  });
  const focusQuoteLine = (line: any) => {
    if (!line) return;
    const index = editLines.indexOf(line);
    const target = document.getElementById(`quote-edit-line-${index}`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => target?.querySelector<HTMLElement>('[data-pricing-error="true"]')?.focus(), 350);
  };
  const saveQuote = (saveAsDraft = false) => {
    if (!commercialLocked && !saveAsDraft) {
      if (mrpIssues.length) {
        const issue = mrpIssues[0];
        setValidationMessage(issue.rate.mrpMissing
          ? `MRP is required for ${issue.line.sku || issue.line.name}, entered per ${issue.rate.mrpUom}.`
          : `${issue.line.sku || issue.line.name} exceeds MRP: payable ${money(issue.rate.finalUnitPayable)} per ${issue.rate.mrpUom}, MRP ${money(issue.rate.mrpInclusive || 0)}.`);
        focusQuoteLine(issue.line);
        return;
      }
      if (discountIssues.length) {
        setValidationMessage(discountIssues[0].message);
        focusQuoteLine(discountIssues[0].line);
        return;
      }
      if (quoteDiscountIssue) {
        setValidationMessage(quoteDiscountIssue);
        document.getElementById('quote-level-discount')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
    }
    setValidationMessage('');
    if (commercialLocked) {
      return Promise.all([
        updatePresentation({ variables: { id: quote.id, input: presentationInput() } }),
        updateQuote({ variables: { id: quote.id, input: { architectId: selectedArchitectId || '' } } }),
      ]);
    }
    return updateQuote({ variables: { id: quote.id, input: {
      ...presentationInput(),
      linePresentation: undefined,
      discountPercent: quoteDiscountType === 'PERCENT' ? Number(quoteDiscountValue || 0) : 0,
      quoteType: quote.quoteType || 'cp_sanitary',
      saveAsDraft,
      architectId: selectedArchitectId || '',
      lines: JSON.stringify(editLines.map((line) => { const rate = rateForLine(line); const isTile = String(line.category || '').toLowerCase() === 'tiles'; return { ...line, pricingVersion: 'unified_retail_v1', taxRate: taxMode === 'non_gst' ? 0 : Number(line.taxRate ?? 18), priceRateBasis: isTile ? 'AREA' : line.priceRateBasis || line.rateBasis || 'BOX', pricingUom: isTile ? 'SQFT' : line.pricingUom, mrpInclusive: rate.mrpInclusive, mrpSource: 'PRODUCT_MASTER', nrpMode: rate.nrpMode, nrpInput: rate.nrpInput, nrpInclusive: rate.nrpInclusive, nrpExclusive: rate.nrpExclusive, specialMode: rate.specialMode, specialInput: rate.specialInput, specialRateInclusive: rate.specialRateInclusive, specialRateExclusive: rate.specialRateExclusive, pricingQuantity: rate.pricingQuantity, quoteDiscountMode: quoteDiscountType, quoteDiscountValue: Number(quoteDiscountValue || 0), quoteDiscountAllocatedInclusive: rate.quoteDiscountAllocatedInclusive, taxableValue: rate.taxableValue, taxAmount: rate.taxAmount, grossLineTotal: rate.grossAfterQuoteDiscount, total: rate.grossAfterQuoteDiscount }; })),
    } } });
  };

  async function shareQuote() {
    setShareMessage('');
    if (!persistedPricingReady) {
      const issue = mrpIssues[0];
      setValidationMessage(issue
        ? (issue.rate.mrpMissing ? `Add MRP for ${issue.line.sku || issue.line.name} before sharing.` : `${issue.line.sku || issue.line.name} exceeds its MRP.`)
        : discountIssues[0]?.message || quoteDiscountIssue || 'Validate and save the governed pricing snapshot before sharing.');
      return;
    }
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

  return <div className="space-y-6 pb-24 xl:pb-10">
    {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
    {validationMessage ? <div role="alert" className="rounded-r4 border border-amber-300 bg-amber-50 p-4 text-sm font-bold text-amber-950">{validationMessage}</div> : null}
    {searchParams.get('pdfError') === 'commercial-pricing' && !persistedPricingReady ? <section role="alert" className="rounded-r4 border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"><p className="font-black">PDF is waiting for a verified commercial snapshot.</p><p className="mt-1 text-xs font-semibold leading-5">Review the highlighted line pricing below and choose Validate changes. The system will not print an old unverified rate as if it were current.</p></section> : null}
    {updateError ? <QueryErrorBanner error={updateError} /> : null}
    {presentationError ? <QueryErrorBanner error={presentationError} /> : null}
    {sendError ? <QueryErrorBanner error={sendError} /> : null}
    {createOrderError ? <QueryErrorBanner error={createOrderError} /> : null}
    {closeRemainderError ? <QueryErrorBanner error={closeRemainderError} /> : null}
    {reviseError ? <QueryErrorBanner error={reviseError} /> : null}
    {!commercialLocked && pricingIssueCount ? <section className="flex flex-col gap-2 rounded-r4 border border-red-200 bg-red-50 p-4 text-sm text-red-950 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-black">Commercial pricing needs attention.</p><p className="mt-1 text-xs font-semibold">Resolve MRP and discount validation before PDF, share, send or order conversion.</p></div><span className="rounded-full bg-red-100 px-3 py-1 text-xs font-black uppercase tracking-wider">{pricingIssueCount} issue{pricingIssueCount === 1 ? '' : 's'}</span></section> : null}
    {legacyLineCount ? <section className={`flex flex-col gap-3 rounded-r4 border p-4 text-sm sm:flex-row sm:items-center sm:justify-between ${commercialLocked ? 'border-amber-300 bg-amber-50 text-amber-950' : 'border-blue-200 bg-blue-50 text-blue-950'}`}><div><p className="font-black">{commercialLocked ? 'This order-linked quote keeps its historical legacy pricing.' : 'Legacy quote loaded with current Product Master MRP.'}</p><p className="mt-1 text-xs font-semibold leading-5">{commercialLocked ? 'Commercial rows cannot be rewritten after order conversion. Start an audited revision to confirm current MRP and NRP before producing a new quote PDF.' : 'The customer-negotiated rate is preserved as a fixed NRP for review. Check every line, then Validate changes to create the governed snapshot and unlock PDF, print, share and send.'}</p></div>{commercialLocked ? <Button size="sm" variant="outline" disabled={revising} onClick={() => startRevision({ variables: { quoteId: quote.id } })}><PenLine className="mr-2 h-4 w-4" />Start pricing-safe revision</Button> : <span className="shrink-0 rounded-full bg-blue-100 px-3 py-1 text-xs font-black uppercase tracking-wider">{legacyLineCount} line{legacyLineCount === 1 ? '' : 's'} to validate</span>}</section> : null}
    {commercialLocked ? <section className="flex flex-col gap-3 rounded-r4 border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold">Commercial terms are locked after sales-order conversion.</p><p className="mt-1 text-xs leading-5 text-amber-800">You can still save the cover, room labels, product images and terms. The quote-family brand snapshot remains locked. Revise the quote to change quantity, rates, discount or GST.</p></div><Button size="sm" variant="outline" disabled={revising} onClick={() => startRevision({ variables: { quoteId: quote.id } })}><PenLine className="mr-2 h-4 w-4" />Revise commercial terms</Button></section> : null}
    <section className="relative overflow-hidden rounded-r5 border border-[var(--line)] bg-[var(--surface)] p-6 shadow-md-soft">
      <div className="relative flex flex-col justify-between gap-6 xl:flex-row xl:items-end">
        <div>
          <Link href="/dashboard/quotes" className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--ink-4)]"><ArrowLeft className="h-4 w-4" /> Back to quote register</Link>
          <p className="mt-5 text-xs font-medium uppercase tracking-[0.14em] text-[var(--brand-700)]">{quote.status} · {quote.approvalStatus} · {displayMode === 'selection' ? 'selection summary' : 'priced quote'}</p>
          <h1 className="mt-2 flex max-w-4xl flex-wrap items-center gap-2 font-display text-3xl font-bold text-[var(--ink)]">
            {quote.quoteNumber}
            <span className={`rounded-full px-2.5 py-1 text-xs font-black uppercase tracking-wider ${quote.quoteType === 'tile' ? 'bg-emerald-100 text-emerald-900' : 'bg-rose-100 text-rose-900'}`}>{quote.quoteType === 'tile' ? 'Tile + Chemical' : 'CP + Sanitary'}</span>
            <span className="rounded-full bg-[var(--brand-600)] px-2.5 py-0.5 text-sm font-bold text-white">v{quote.versionNumber || 1}</span>
            {quote.supersededByQuoteId ? <span className="rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-bold text-slate-700">Superseded</span> : null}
            {quote.supersedesQuoteId ? <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-bold text-violet-800">Replaces prior</span> : null}
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-[var(--ink-3)]">{quote.title || quote.projectName || 'Retail quotation'} for {quote.customer?.name || 'Customer'}.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {!quote.supersededByQuoteId && !['lost', 'expired', 'won', 'cancelled'].includes(quote.status) ? (
            <Button size="lg" variant="outline" disabled={revising} onClick={() => startRevision({ variables: { quoteId: quote.id } })}>
              <PenLine className="mr-2 h-5 w-5" /> {revising ? 'Starting...' : 'Revise quote'}
            </Button>
          ) : null}
          {!commercialLocked && !cancelled ? <Button disabled={savingQuote || quote.status === 'superseded'} onClick={() => saveQuote(true)} size="lg" variant="outline"><Save className="mr-2 h-5 w-5" />Save draft</Button> : null}
          {!cancelled ? <Button disabled={savingQuote || savingPresentation || quote.status === 'superseded' || (!commercialLocked && !pricingReady)} onClick={() => saveQuote(false)} size="lg" variant="outline"><ShieldCheck className="mr-2 h-5 w-5" /> {commercialLocked ? 'Save document presentation' : 'Validate changes'}</Button> : null}
          {!cancelled && persistedPricingReady ? <Button asChild size="lg"><a href={`/api/pdf/quote/${quote.id}?download=1`}><Download className="mr-2 h-5 w-5" /> Download PDF</a></Button> : !cancelled ? <Button size="lg" disabled><Download className="mr-2 h-5 w-5"/>PDF waiting</Button> : null}
          {!cancelled && persistedPricingReady ? <Button asChild size="lg" variant="outline"><a href={`/api/pdf/quote/${quote.id}`} target="_blank" rel="noreferrer"><Printer className="mr-2 h-5 w-5" /> Print</a></Button> : null}
          {!cancelled ? <Button size="lg" variant="outline" disabled={sharing || !persistedPricingReady} onClick={shareQuote}><Share2 className="mr-2 h-5 w-5" />{sharing ? 'Creating link...' : 'Share'}</Button> : null}
          {!cancelled && quote.status !== 'sent' && quote.status !== 'confirmed' && quote.status !== 'superseded' && <Button disabled={sending || !persistedPricingReady} onClick={() => { if (persistedPricingReady) sendQuote({ variables: { id: quote.id } }); }} variant="warning" size="lg"><Send className="mr-2 h-5 w-5" /> Mark sent</Button>}
          {!cancelled && !['won', 'closed', 'superseded'].includes(quote.status) ? <Button size="lg" variant="outline" disabled={cancelling} onClick={() => { const reason = window.prompt('Cancellation reason. Converted orders can only be cancelled before dispatch, invoice, or receipt activity.'); if (reason?.trim()) cancelQuote({ variables: { id: quote.id, reason: reason.trim() } }); }} className="border-red-200 text-red-700">{cancelling ? 'Cancelling...' : 'Cancel quote'}</Button> : null}
        </div>
      </div>
      {shareMessage ? <p role="status" className="relative mt-4 rounded-r3 border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{shareMessage}</p> : null}
      {shareError ? <div className="relative mt-4"><QueryErrorBanner error={shareError} /></div> : null}
      {cancelError ? <div className="relative mt-4"><QueryErrorBanner error={cancelError} /></div> : null}
      {cancelled ? <div className="relative mt-4 rounded-r4 border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-900">This quote is cancelled. Its document history is retained, and commercial actions are disabled.</div> : null}
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

    <section className="space-y-5">
      <div className="space-y-5">
        <div className="mp-card rounded-r5 p-5">
          <div className="grid gap-4 md:grid-cols-5">
            <label className="space-y-2"><span className="text-xs font-medium uppercase tracking-wider text-[var(--ink-4)]">PDF type</span><select value={displayMode} onChange={(event)=>setDisplayMode(event.target.value)} className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-sm font-black"><option value="priced">Show prices - quotation</option><option value="selection">Hide prices - selection summary</option></select></label>
            <label className="space-y-2"><span className="text-xs font-medium uppercase tracking-wider text-[var(--ink-4)]">Tax treatment</span><select disabled={commercialLocked} value={taxMode} onChange={(event)=>setTaxMode(event.target.value as 'gst' | 'non_gst')} className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-sm font-black disabled:cursor-not-allowed disabled:opacity-55"><option value="gst">GST quotation</option><option value="non_gst">Without GST</option></select></label>
            <label id="quote-level-discount" className="scroll-mt-24 space-y-2"><span className="text-xs font-medium uppercase tracking-wider text-[var(--ink-4)]">Additional quote discount</span><div className="grid grid-cols-[5.5rem_1fr] gap-1"><select disabled={commercialLocked} value={quoteDiscountType} onChange={(event)=>setQuoteDiscountType(event.target.value as DiscountMode)} className="h-11 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-2 text-xs font-black disabled:opacity-55"><option value="PERCENT">Percent</option><option value="FIXED_AMOUNT">Amount</option></select><input data-pricing-error={quoteDiscountIssue ? 'true' : undefined} disabled={commercialLocked} type="number" min={0} max={quoteDiscountType === 'PERCENT' ? 100 : undefined} value={quoteDiscountValue} onChange={(event)=>setQuoteDiscountValue(event.target.value)} className={`h-11 w-full rounded-2xl border bg-[var(--surface)] px-3 text-sm font-black disabled:cursor-not-allowed disabled:opacity-55 ${quoteDiscountIssue ? 'border-red-300 bg-red-50' : 'border-[var(--line)]'}`} /></div>{quoteDiscountIssue ? <span className="block text-[10px] font-bold text-red-700">{quoteDiscountIssue}</span> : null}</label>
            <label className="space-y-2 md:col-span-2"><span className="text-xs font-medium uppercase tracking-wider text-[var(--ink-4)]">Remarks</span><input value={remarks} onChange={(event)=>setRemarks(event.target.value)} className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-sm font-black" /></label>
          </div>
        </div>

        <section aria-label="Quote pricing metrics" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8">
          {[
            [BadgeIndianRupee, 'Lines / items', `${editLines.length} / ${editLines.reduce((sum, line) => sum + Number(line.qty || line.quantity || 0), 0)}`, null],
            [BadgeIndianRupee, 'Gross MRP', money(grossMrp), mrpIssues.length ? () => focusQuoteLine(mrpIssues[0].line) : null],
            [BadgeIndianRupee, 'NRP value', money(nrpValue), missingNrpCount ? () => focusQuoteLine(editLines.find((line) => Number(rateForLine(line).nrpInclusive || 0) <= 0)) : null],
            [BadgeIndianRupee, 'Special value', money(specialValue), null],
            [BadgeIndianRupee, 'Quote discount', money(quoteDiscount), null],
            [BadgeIndianRupee, 'GST', money(tax), null],
            [AlertTriangle, 'Exceptions', `${pricingIssueCount + missingNrpCount}`, () => focusQuoteLine(mrpIssues[0]?.line || discountIssues[0]?.line || editLines.find((line) => Number(rateForLine(line).nrpInclusive || 0) <= 0))],
            [ShieldCheck, 'Readiness', pricingReady ? 'Ready' : 'Draft only', null],
          ].map(([Icon, label, value, action]: any) => <button key={label} type="button" onClick={action || undefined} className={`rounded-lg border p-3 text-left ${action ? 'border-amber-200 bg-amber-50' : 'border-[var(--line)] bg-[var(--surface)]'} ${label === 'Readiness' && pricingReady ? 'border-emerald-200 bg-emerald-50' : ''}`}><Icon className="h-4 w-4 text-[var(--brand-700)]"/><p className="mt-2 truncate text-base font-black text-[var(--ink)]">{value}</p><p className="mt-1 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--ink-4)]">{label}</p></button>)}
        </section>

        {grouped.map((group) => <div key={group.area} className="overflow-hidden rounded-r5 border border-[var(--line)] bg-[var(--surface)] shadow-md-soft">
          <div className="flex items-center gap-3 border-b border-[var(--line)] bg-[var(--ink)] px-5 py-4 text-xs font-medium uppercase tracking-widest text-[var(--surface)]"><span className="flex-1">{group.area} · {group.rows.length} item(s)</span>{!commercialLocked ? <button type="button" aria-label={`Rename section ${group.area}`} className="rounded border border-current px-2 py-1" onClick={() => { const area = window.prompt('Section name (all items in this section)', group.area)?.trim(); if (area) setEditLines(current => current.map(line => group.rows.includes(line) ? { ...line, area } : line)); }}>Rename</button> : null}</div>
          <div className="divide-y divide-[var(--line)]">
            {group.rows.map((line: any) => {
              const index = editLines.indexOf(line);
              const rate = rateForLine(line);
              return <article id={`quote-edit-line-${index}`} key={`${line.sku}-${index}`} className="scroll-mt-24 grid gap-4 p-5 xl:grid-cols-[minmax(16rem,1fr)_5rem_7rem_9rem_10rem_8rem] xl:items-center">
                <div className="space-y-2">
                  <p className="text-lg font-semibold text-[var(--ink)]">{line.name}</p>
                  {!commercialLocked ? <button type="button" className="text-xs text-[var(--ink-3)] underline" onClick={() => { const area = window.prompt('Move this item to section', group.area)?.trim(); if (area) updateLine(index, { area }); }}>Move to section</button> : null}
                  <p className="text-xs font-black uppercase tracking-wider text-[var(--ink-4)]">{line.sku || line.tileCode}{masterBrandCode(brands, line.brand) ? ` · ${masterBrandCode(brands, line.brand)}` : ''}</p>
                </div>
                <div className="space-y-2">
                  {requestedQuantityLabel(line) ? <label className="block space-y-1"><span className="text-xs font-bold text-[var(--ink)]">Requested ({Number(line.requestedArea || 0) > 0 ? line.pricingUom || 'SQFT' : 'PC'})</span><input aria-label={`Requested quantity for ${line.name}`} disabled={commercialLocked} type="number" min="0.01" step="any" value={line.requestedArea || line.requestedPieces} onChange={event => { const value = Number(event.target.value); const areaBased = Number(line.requestedArea || 0) > 0; const packs = Math.ceil(value * (areaBased ? 1 + Number(line.wastagePercent || 0) / 100 : 1) / Number(areaBased ? line.coveragePerPack : line.piecesPerPack || line.pcsPerBox)); updateLine(index, { [areaBased ? 'requestedArea' : 'requestedPieces']: value, qty: packs, quantity: packs }); }} className="h-10 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-black" /></label> : null}
                  <label className="block space-y-1"><span className="text-xs font-medium uppercase tracking-wider text-[var(--ink-4)]">Qty ({line.inventoryUom || line.unit || 'PC'})</span><input aria-label={`Quantity for ${line.name}`} disabled={commercialLocked || Number(line.requestedArea || line.requestedPieces || 0) > 0} type="number" value={line.qty ?? line.quantity ?? 0} onChange={(event)=>updateLine(index,{qty:Number(event.target.value),quantity:Number(event.target.value)})} className="h-10 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-black disabled:cursor-not-allowed" /></label>
                  {Number(line.coveragePerPack || 0) > 0 ? <p className="text-xs text-[var(--ink-3)]">Coverage: {(Number(line.qty ?? line.quantity ?? 0) * Number(line.coveragePerPack)).toFixed(2)} {line.pricingUom || 'SQFT'}{requestedQuantityLabel(line) ? ' · rounded to whole packs' : ''}</p> : null}
                </div>
                <label className="space-y-1"><span className="text-xs font-medium uppercase tracking-wider text-[var(--ink-4)]">MRP / {rate.mrpUom}</span><input data-pricing-error={rate.mrpMissing || !rate.mrpValid ? 'true' : undefined} readOnly tabIndex={-1} aria-label={`MRP per ${rate.mrpUom} for ${line.name}`} type="number" value={line.mrpInclusive ?? ''} className={`h-10 w-full cursor-not-allowed rounded-xl border px-3 text-sm font-black ${rate.mrpMissing || !rate.mrpValid ? 'border-red-300 bg-red-50 text-red-950' : 'border-emerald-300 bg-emerald-50 text-emerald-950'}`} /><span className="block text-[10px] font-semibold text-[var(--ink-5)]">Tax-inclusive · Product Master snapshot</span></label>
                <label className="space-y-1"><span className="text-xs font-medium uppercase tracking-wider text-[var(--ink-4)]">Base pricing → NRP</span><div className="grid grid-cols-[1fr_6.2rem] gap-1"><input data-pricing-error={discountIssues.some((issue) => issue.line === line && issue.field === 'base') ? 'true' : undefined} disabled={commercialLocked} type="number" min={0} max={line.nrpMode === 'PERCENT_OFF_MRP' ? 100 : undefined} value={line.nrpInput ?? 0} onChange={(event)=>updateLine(index,{nrpInput:event.target.value,pricingVersion:'unified_retail_v1'})} className={`h-10 min-w-0 rounded-xl border bg-[var(--surface)] px-2 text-sm font-black disabled:opacity-55 ${discountIssues.some((issue) => issue.line === line && issue.field === 'base') ? 'border-red-300 bg-red-50' : 'border-[var(--line)]'}`}/><select disabled={commercialLocked} value={line.nrpMode || 'PERCENT_OFF_MRP'} onChange={(event)=>updateLine(index,{nrpMode:event.target.value,nrpInput:0,pricingVersion:'unified_retail_v1'})} className="h-10 rounded-xl border border-[var(--line)] bg-white px-1 text-[10px] font-black"><option value="PERCENT_OFF_MRP">% off MRP</option><option value="FIXED_NRP">Set NRP ₹</option></select></div><span className="block text-[10px] font-black text-[#8f2f28]">NRP {money(rate.nrpInclusive)}</span></label>
                <label className="space-y-1"><span className="text-xs font-medium uppercase tracking-wider text-[var(--ink-4)]">Optional special</span><div className="grid grid-cols-[1fr_7.5rem] gap-1"><input data-pricing-error={discountIssues.some((issue) => issue.line === line && issue.field === 'special') ? 'true' : undefined} disabled={commercialLocked || (line.specialMode || 'NONE') === 'NONE'} type="number" min={0} max={line.specialMode === 'PERCENT_OFF_NRP' ? 100 : undefined} value={line.specialInput || 0} onChange={(event)=>updateLine(index,{specialInput:event.target.value,pricingVersion:'unified_retail_v1'})} className={`h-10 min-w-0 rounded-xl border bg-[var(--surface)] px-2 text-sm font-black disabled:opacity-55 ${discountIssues.some((issue) => issue.line === line && issue.field === 'special') ? 'border-red-300 bg-red-50' : 'border-[var(--line)]'}`}/><select disabled={commercialLocked} value={line.specialMode || 'NONE'} onChange={(event)=>updateLine(index,{specialMode:event.target.value,specialInput:0,pricingVersion:'unified_retail_v1'})} className="h-10 rounded-xl border border-[var(--line)] bg-white px-1 text-[10px] font-black"><option value="NONE">No special</option><option value="PERCENT_OFF_NRP">% off NRP</option><option value="FIXED_SPECIAL_RATE">Set rate ₹</option></select></div><span className="block text-[10px] font-black text-[#1d4ed8]">Special {money(rate.specialRateInclusive)}</span></label>
                <div className="text-right"><p className="text-xs font-medium uppercase tracking-wider text-[var(--ink-4)]">Final total</p><p className="mt-2 text-sm font-black text-[var(--ink)]">{money(rate.finalUnitPayable)} / {rate.mrpUom}</p>{showPrices && <p className="mt-1 text-xl font-black text-[var(--success)]">{money(rate.grossAfterQuoteDiscount)}</p>}{Number(line.floorPriceInclusive || 0) > 0 && rate.finalUnitPayable + 0.005 < Number(line.floorPriceInclusive) ? <p className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-[10px] font-black text-amber-900">Below floor · owner approval</p> : null}</div>
              </article>;
            })}
          </div>
        </div>)}
      </div>

      <aside className="grid items-start gap-5 lg:grid-cols-2 2xl:grid-cols-3">
        <div className="mp-card rounded-r5 p-6"><h2 className="text-2xl font-black tracking-tight">Customer</h2><p className="mt-4 text-lg font-semibold text-[var(--ink)]">{quote.customer?.name || 'Customer'}</p><p className="mt-2 text-sm font-bold text-[var(--ink-4)]">{quote.customer?.mobile || quote.customer?.phone}</p><p className="mt-2 text-sm font-bold text-[var(--ink-4)]">{quote.customer?.siteAddress || quote.customer?.city}</p></div>
        <div className="mp-card rounded-r5 p-6">
          <h2 className="text-2xl font-black tracking-tight">Consulting architect</h2>
          <p className="mt-2 text-sm font-bold text-[var(--ink-4)]">Who is consulting on this quote. Used on PDFs and available for filters/reports.</p>
          <label className="mt-4 block space-y-2">
            <span className="text-xs font-medium uppercase tracking-wider text-[var(--ink-4)]">Architect</span>
            <select
              value={selectedArchitectId || ''}
              onChange={(e) => setSelectedArchitectId(e.target.value)}
              className="h-11 w-full rounded-2xl border border-[var(--line)] bg-white px-4 text-sm font-black"
            >
              <option value="">No architect</option>
              {(data?.architects || []).map((architect: any) => (
                <option key={architect.id} value={architect.id}>
                  {architect.name}{architect.firmName ? ` · ${architect.firmName}` : ''}
                </option>
              ))}
            </select>
          </label>
          {(quote.architectName || quote.architect?.name) ? (
            <p className="mt-3 text-sm font-semibold text-[var(--ink)]">Saved: {quote.architectName || quote.architect?.name}</p>
          ) : null}
        </div>
        <div className="mp-card rounded-r5 p-6"><h2 className="text-2xl font-black tracking-tight">Totals</h2>{showPrices ? <div className="mt-5 space-y-3 text-sm font-bold text-[var(--ink-2)]"><div className="flex justify-between"><span>Subtotal</span><span>{money(subtotal)}</span></div><div className="flex justify-between"><span>Discount</span><span>{money(quoteDiscount)}</span></div>{taxMode === 'gst' ? <div className="flex justify-between"><span>GST</span><span>{money(tax)}</span></div> : <div className="flex justify-between text-[var(--ink-4)]"><span>Tax treatment</span><span>Without GST</span></div>}<div className="flex justify-between border-t border-[var(--line)] pt-4 text-2xl font-semibold text-[var(--ink)]"><span>Total</span><span>{money(total)}</span></div></div> : <p className="mt-4 rounded-2xl bg-[var(--brand-50)] p-4 text-sm font-black text-[var(--brand-700)]">Selection summary mode hides all prices in the PDF.</p>}</div>
        <div className="mp-panel p-5">
          <div className="flex items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-[var(--brand-50)] text-[var(--brand-700)]"><LockKeyhole className="h-4 w-4" /></div><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--brand-700)]">Governed quotation footer</p><h2 className="mt-1 text-lg font-semibold text-[var(--ink)]">{quote.quoteType === 'tile' ? 'Tile & Chemical' : 'CP & Sanitary'} brand snapshot</h2><p className="mt-2 text-xs leading-5 text-[var(--ink-4)]">{selectedBrandIds.length} served-brand logo{selectedBrandIds.length === 1 ? '' : 's'} {selectedBrandIds.length === 1 ? 'was' : 'were'} locked when this quote was created. Selection is managed only in global Settings and cannot be changed on this quote.</p></div></div>
        </div>
        <div className="mp-panel p-5"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center overflow-hidden rounded-md border border-[var(--line)] bg-white p-1">{documentSettings.logoUrl ? <img src={documentSettings.logoUrl} alt="Company logo" className="max-h-full max-w-full object-contain" /> : <Building2 className="h-4 w-4 text-[var(--ink-4)]" />}</div><div><p className="font-semibold text-[var(--ink)]">{documentSettings.companyName || 'Marble Park'}</p><p className="text-xs text-[var(--ink-4)]">{documentSettings.gstNumber ? `GSTIN ${documentSettings.gstNumber}` : 'Company profile managed globally'}</p></div></div><Link href="/dashboard/settings" className="mt-4 inline-flex text-xs font-semibold text-[var(--brand-700)]">Edit global quotation identity</Link></div>
        <div className="mp-card rounded-r5 p-6"><h2 className="text-2xl font-black tracking-tight">PDF terms</h2><label className="mt-4 block space-y-2"><span className="text-xs font-medium uppercase tracking-wider text-[var(--ink-4)]">Terms</span><textarea value={terms} onChange={(event)=>setTerms(event.target.value)} className="min-h-28 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-xs font-bold" /></label><label className="mt-3 block space-y-2"><span className="text-xs font-medium uppercase tracking-wider text-[var(--ink-4)]">Bank details</span><textarea value={bankDetails} onChange={(event)=>setBankDetails(event.target.value)} className="min-h-24 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-xs font-bold" /></label></div>
        <div className="mp-card rounded-r5 p-6"><h2 className="text-2xl font-black tracking-tight">Convert selected quantity</h2><p className="mt-2 text-sm font-bold text-[var(--ink-4)]">Choose only the quantities being confirmed now. The remaining balance stays on this quote for the next order or an explicit close-out.</p><div className="mt-4 space-y-2">{(fulfillment?.lines || []).map((line: any) => <label key={line.id} className="grid grid-cols-[1fr_5.5rem] items-center gap-3 rounded-lg border border-[var(--line)] p-3"><span className="min-w-0"><span className="block truncate text-sm font-bold text-[var(--ink)]">{line.sku} · {line.name}</span><span className="text-xs font-semibold text-[var(--ink-4)]">Ordered {line.ordered} of {line.quantity} · remaining {line.remaining}</span></span><input aria-label={`Order quantity for ${line.sku}`} type="number" min={0} max={line.remaining} value={orderQuantities[line.id] ?? ''} onChange={(event) => setOrderQuantities((current) => ({ ...current, [line.id]: event.target.value }))} disabled={!line.remaining} className="h-10 rounded-lg border border-[var(--brand-400)] bg-[var(--brand-50)] px-2 text-right text-sm font-black" /></label>)}{fulfillment && !fulfillment.lines?.length ? <p className="text-sm font-semibold text-[var(--ink-4)]">No remaining quote lines.</p> : null}</div><label className="mt-4 block space-y-2"><span className="text-xs font-medium uppercase tracking-wider text-[var(--ink-4)]">Payment</span><select value={paymentMode} onChange={(e)=>setPaymentMode(e.target.value)} className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-sm font-black"><option value="cash">Cash</option><option value="credit">Credit</option></select></label>{paymentMode === 'cash' && <label className="mt-3 block space-y-2"><span className="text-xs font-medium uppercase tracking-wider text-[var(--ink-4)]">Advance / full paid</span><input type="number" min={0} value={advanceAmount} onChange={(e)=>setAdvanceAmount(e.target.value)} className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-sm font-black" /></label>}<label className="mt-3 block space-y-2"><span className="text-xs font-medium uppercase tracking-wider text-[var(--ink-4)]">Payment terms</span><input value={paymentTerms} onChange={(e)=>setPaymentTerms(e.target.value)} placeholder={paymentMode === 'credit' ? 'Net 30' : 'Cash on order'} className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-sm font-black" /></label><label className="mt-3 block space-y-2"><span className="text-xs font-medium uppercase tracking-wider text-[var(--ink-4)]">Promised dispatch date</span><input type="date" value={promisedDate} onChange={(e)=>setPromisedDate(e.target.value)} className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-sm font-black" /></label>{orderMessage && <div className="mt-3 rounded-2xl bg-[var(--brand-50)] p-3 text-xs font-black uppercase tracking-wider text-[var(--brand-700)]"><p>{orderMessage}</p>{orderPdfUrl ? <a className="mt-2 inline-flex rounded-xl bg-[var(--brand-600)] px-3 py-2 text-white" href={orderPdfUrl} target="_blank" rel="noreferrer"><Download className="mr-2 h-4 w-4" /> Sales order PDF</a> : null}</div>}<Button className="mt-4 w-full" disabled={creatingOrder || quote.status === 'superseded' || !(fulfillment?.lines || []).some((line: any) => Number(orderQuantities[line.id] || 0) > 0)} onClick={()=>{ const key = orderKey || (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`); setOrderKey(key); createSalesOrder({variables:{input:{quoteId:quote.id,paymentMode,advanceAmount:Number(advanceAmount||0),paymentTerms:paymentTerms || undefined,promisedDate:promisedDate || undefined,idempotencyKey:key,lines:JSON.stringify((fulfillment?.lines || []).map((line: any) => ({ quoteLineId: line.id, quantity: Number(orderQuantities[line.id] || 0) })).filter((line: any) => line.quantity > 0)),notes:'Created from quote detail'}}}); }}>{creatingOrder ? 'Creating...' : 'Create selected sales order'}</Button>{(fulfillment?.orders || []).length ? <div className="mt-5 border-t border-[var(--line)] pt-4"><p className="text-xs font-medium uppercase tracking-wider text-[var(--ink-4)]">Orders from this quote</p>{fulfillment.orders.map((order: any) => <div key={order.id} className="mt-2 flex justify-between gap-3 text-sm font-bold"><span>{order.orderNumber} · {order.status}</span><span>{money(order.totalAmount)}</span></div>)}</div> : null}<div className="mt-5 border-t border-[var(--line)] pt-4"><p className="text-xs font-medium uppercase tracking-wider text-[var(--ink-4)]">Close unused remainder</p><input value={closeReason} onChange={(event) => setCloseReason(event.target.value)} placeholder="Reason required to close remaining quantity" className="mt-2 h-10 w-full rounded-lg border border-[var(--line)] px-3 text-sm font-semibold" /><Button variant="outline" className="mt-2 w-full" disabled={closingRemainder || !closeReason.trim() || !(fulfillment?.lines || []).some((line: any) => Number(line.remaining || 0) > 0)} onClick={() => closeRemainder({ variables: { quoteId: quote.id, reason: closeReason } })}>{closingRemainder ? 'Closing...' : 'Close remaining quantity'}</Button></div></div>
      </aside>
    </section>
    {!commercialLocked ? <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--line)] bg-[var(--surface)]/95 p-3 shadow-[0_-12px_30px_rgba(15,23,42,0.12)] backdrop-blur xl:hidden"><div className="mx-auto grid max-w-xl grid-cols-[1fr_auto_1fr] gap-2"><Button variant="outline" disabled={savingQuote} onClick={() => saveQuote(true)}><Save className="mr-2 h-4 w-4"/>Draft</Button><button type="button" onClick={() => focusQuoteLine((mrpIssues[0] || discountIssues[0])?.line)} className={`rounded-md px-2 text-xs font-black ${pricingReady ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>{pricingReady ? 'Ready' : `${pricingIssueCount} errors`}</button><Button disabled={savingQuote || !pricingReady} onClick={() => saveQuote(false)}><ShieldCheck className="mr-2 h-4 w-4"/>Validate</Button></div></div> : null}
  </div>;
}
