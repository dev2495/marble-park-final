'use client';

// One workspace for creating, editing and revising a quote.
// Areas sit in a rail on the left, items in compact rows in the middle, money,
// people and settings on the right. Editing a confirmed quote prepares the next
// lettered revision of the same quote (Rakesh-0412 -> Rakesh-0412a).
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { gql, useMutation, useQuery } from '@apollo/client';
import { Fragment, isValidElement, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import {
  AlertTriangle, ArrowLeft, Camera, Check, ChevronDown, ChevronUp, Copy, Download, FileImage, ImagePlus, Layers3, Bath, Loader2, Plus, Printer, Search, Send, Share2, ShoppingCart, Trash2, Undo2, X,
} from 'lucide-react';
import { ProductImageFrame } from '@/components/product-image-frame';
import { QueryErrorBanner } from '@/components/query-state';
import { PhysicalQrScanner } from '@/components/physical-qr-scanner';
import { ScanProductSelector } from '@/components/scan-product-selector';
import { ArchitectPicker, CustomerPicker, Field, Modal, QuickSkuDialog, inputClass, isFollowUp, primaryButton, secondaryButton } from '@/components/quick-add/quick-add';
import { describeApolloError } from '@/lib/apollo-errors';
import { cn } from '@/lib/utils';
import {
  AREA_SUGGESTIONS, DEFAULT_AREA, baseQuoteNumber, commercialFingerprint, draftNumber, isTileLine, lineChanges, lineFromProduct, lineIssues, lineKey, money, patchLine,
  prepareLegacyLine, priceLines, pricingBasis, productImage, quoteFamilyBrandIds, quoteTypeForProduct, revisionLetter, serializeLines, tilePriceUom, tilePricingCoverage,
  type DiscountMode, type Line, type QuoteType, type TaxMode,
} from './model';

const SETUP = gql`
  query QuoteWorkspaceSetup {
    architects(status: "active", take: 300)
    salesAssignees
    documentSettings { data }
    masterProductBrands(status: "active")
  }
`;
const QUOTE = gql`
  query QuoteWorkspaceQuote($id: ID!) {
    quote(id: $id) {
      id quoteNumber title projectName status approvalStatus discountPercent displayMode quoteType createdAt validUntil sentAt confirmedAt notes lines quoteMeta
      customer owner lead approval coverImage leadId customerId ownerId
      versionNumber supersedesQuoteId supersededByQuoteId intentId architectId architectName architect pricingVersion pricingStatus commercialTotal versions
    }
  }
`;
const PRESET_CUSTOMER = gql`query QuoteWorkspaceCustomer($id: ID!) { customer(id: $id) { id name email mobile siteAddress city tags } }`;
const PRODUCTS_BY_IDS = gql`query QuoteWorkspaceProducts($ids: [ID!]!) { productsByIds(ids: $ids) { id sku internalCode name category brand finish dimensions unit purchaseUom salesUom piecesPerPack coveragePerPack defaultMrpInclusive defaultNrpInclusive floorPriceInclusive priceRateBasis priceUom mrpSource media } }`;
const SEARCH = gql`query QuoteWorkspaceSearch($query: String!) { globalSearch(query: $query) { products } }`;
const FULFILLMENT = gql`query QuoteWorkspaceFulfillment($quoteId: ID!) { quoteFulfillment(quoteId: $quoteId) }`;
const SCAN_LABEL = gql`mutation QuoteWorkspaceScan($labelCode: String!, $input: InternalLabelScanInput) { scanInternalLabel(labelCode: $labelCode, input: $input) }`;
const OPEN_QUOTES = gql`query QuoteWorkspaceOpenQuotes($customerId: ID!) { customerOpenQuotes(customerId: $customerId) }`;
const CREATE_QUOTE = gql`mutation QuoteWorkspaceCreate($input: CreateQuoteInput!) { createQuote(input: $input) { id quoteNumber status pricingStatus } }`;
const UPDATE_QUOTE = gql`mutation QuoteWorkspaceUpdate($id: ID!, $input: UpdateQuoteInput!) { updateQuote(id: $id, input: $input) { id quoteNumber versionNumber status pricingStatus approvalStatus } }`;
const SEND_QUOTE = gql`mutation QuoteWorkspaceSend($id: ID!) { sendQuote(id: $id) { id status sentAt } }`;
const SHARE_QUOTE = gql`mutation QuoteWorkspaceShare($quoteId: ID!) { createQuoteShare(quoteId: $quoteId) }`;
const CANCEL_QUOTE = gql`mutation QuoteWorkspaceCancel($id: ID!, $reason: String!) { cancelQuote(id: $id, reason: $reason) { id status } }`;
const CREATE_ORDER = gql`mutation QuoteWorkspaceOrder($input: CreateSalesOrderInput!) { createSalesOrderFromQuote(input: $input) }`;
const CLOSE_REMAINDER = gql`mutation QuoteWorkspaceClose($quoteId: ID!, $reason: String!) { closeQuoteRemainder(quoteId: $quoteId, reason: $reason) { id status } }`;
const UPLOAD = gql`mutation QuoteWorkspaceUpload($filename: String!, $contentBase64: String!, $scope: String) { uploadStoredAsset(filename: $filename, contentBase64: $contentBase64, scope: $scope) { result } }`;

type Mode = 'new' | 'draft' | 'confirmed' | 'revising' | 'locked' | 'reviseOrdered' | 'closed';
const SERVER_META = ['preparedById', 'preparedByName', 'preparedAt', 'confirmedById', 'confirmedByName', 'confirmedAt', 'baseQuoteNumber', 'revisedById', 'revisedByName', 'revisedAt'];

function errorText(error: unknown, operation: string) {
  const diagnostic = describeApolloError(error, operation);
  return diagnostic.remediation ? `${diagnostic.message} ${diagnostic.remediation}`.trim() : diagnostic.message;
}
function isoDate(value: unknown, fallbackDays = 15) {
  const date = value ? new Date(String(value)) : new Date(Date.now() + fallbackDays * 86400000);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}
function shortDate(value: unknown) {
  if (!value) return '';
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}
async function fileBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}
function pct(value: number) {
  if (!Number.isFinite(value)) return '';
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

const PHONE_BAR_ACTIONS = new Set(['draft', 'confirm', 'docs', 'share', 'order', 'discard', 'save']);

const STATUS_PILL: Record<Mode, { label: string; className: string }> = {
  new: { label: 'New', className: 'bg-[var(--bg-soft)] text-[var(--ink-3)]' },
  draft: { label: 'Draft', className: 'bg-[var(--warning-bg)] text-[var(--warning)]' },
  confirmed: { label: 'Ready to send', className: 'bg-[var(--success-bg)] text-[var(--success)]' },
  revising: { label: 'Revising', className: 'bg-[var(--info-bg)] text-[var(--info)]' },
  locked: { label: 'Ordered', className: 'bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300' },
  reviseOrdered: { label: 'Revising', className: 'bg-[var(--info-bg)] text-[var(--info)]' },
  closed: { label: 'Closed', className: 'bg-[var(--bg-soft)] text-[var(--ink-3)]' },
};

export function QuoteWorkspace({ quoteId }: { quoteId?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isNew = !quoteId;

  const setup = useQuery(SETUP);
  const quoteQuery = useQuery(QUOTE, { variables: { id: quoteId }, skip: isNew });
  const quote = quoteQuery.data?.quote;
  const fulfillmentQuery = useQuery(FULFILLMENT, { variables: { quoteId }, skip: isNew });
  const fulfillment = fulfillmentQuery.data?.quoteFulfillment;

  const settings = useMemo(() => setup.data?.documentSettings?.data || {}, [setup.data?.documentSettings?.data]);
  const brands = useMemo<any[]>(() => (setup.data?.masterProductBrands || []).filter((brand: any) => brand.metadata?.quoteEnabled !== false), [setup.data?.masterProductBrands]);
  const architects = useMemo<any[]>(() => setup.data?.architects || [], [setup.data?.architects]);
  const assignees = useMemo<any[]>(() => setup.data?.salesAssignees || [], [setup.data?.salesAssignees]);

  // ---------- editable state ----------
  const [lines, setLines] = useState<Line[]>([]);
  const [baseline, setBaseline] = useState<Map<string, Line> | null>(null);
  const [baselineFingerprint, setBaselineFingerprint] = useState('');
  const [baselineSettings, setBaselineSettings] = useState('');
  const [quoteType, setQuoteType] = useState<QuoteType>('cp_sanitary');
  const quoteTypeLocked = useRef(false);
  const [customer, setCustomer] = useState<any>(null);
  const [ownerId, setOwnerId] = useState('');
  const [architect, setArchitect] = useState<any>(null);
  const [projectName, setProjectName] = useState('');
  const [validUntil, setValidUntil] = useState(isoDate(null));
  const [displayMode, setDisplayMode] = useState<'priced' | 'selection'>('priced');
  const [taxMode, setTaxMode] = useState<TaxMode>('gst');
  const [discountType, setDiscountType] = useState<DiscountMode>('PERCENT');
  const [discountValue, setDiscountValue] = useState('');
  const [remarks, setRemarks] = useState('');
  const [terms, setTerms] = useState('');
  const [bankDetails, setBankDetails] = useState('');
  const [coverImage, setCoverImage] = useState('');
  const [tagline, setTagline] = useState('');
  const [extraAreas, setExtraAreas] = useState<string[]>([]);
  const [reviseOrdered, setReviseOrdered] = useState(false);

  // ---------- ui state ----------
  const [areaFilter, setAreaFilter] = useState('all');
  const [targetArea, setTargetArea] = useState(DEFAULT_AREA);
  const [newArea, setNewArea] = useState('');
  const [search, setSearch] = useState('');
  const [searchIndex, setSearchIndex] = useState(0);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'' | 'customer' | 'architect' | 'sku' | 'order' | 'cancel' | 'documents'>('');
  const [scanOpen, setScanOpen] = useState(false);
  const [scanPayload, setScanPayload] = useState('');
  const [scanResult, setScanResult] = useState<any>(null);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const loadedFor = useRef<string>('');

  const notify = useCallback((message: string) => { setToast(message); window.setTimeout(() => setToast((current) => (current === message ? '' : current)), 5200); }, []);

  // ---------- load: new quote ----------
  const [presetCustomerId, setPresetCustomerId] = useState('');
  const [preloadIds, setPreloadIds] = useState<string[]>([]);
  const presetCustomer = useQuery(PRESET_CUSTOMER, { variables: { id: presetCustomerId }, skip: !presetCustomerId });
  const preload = useQuery(PRODUCTS_BY_IDS, { variables: { ids: preloadIds }, skip: !preloadIds.length });
  // Heads-up only: a new quote for a customer who already has one open. Never blocks.
  const openQuotesQuery = useQuery(OPEN_QUOTES, { variables: { customerId: customer?.id || '' }, skip: !isNew || !customer?.id, fetchPolicy: 'network-only' });
  const openQuotes: any[] = isNew && customer?.id ? (openQuotesQuery.data?.customerOpenQuotes || []) : [];
  const preloadApplied = useRef(false);

  useEffect(() => {
    if (!isNew) return;
    const requestedType = String(searchParams.get('type') || '').toLowerCase();
    if (requestedType === 'tile' || requestedType === 'cp_sanitary') { setQuoteType(requestedType); quoteTypeLocked.current = true; }
    const customerId = String(searchParams.get('customer') || '').trim();
    if (customerId) setPresetCustomerId(customerId);
    const ids = (searchParams.get('products') || searchParams.get('product') || '').split(',').map((value) => value.trim()).filter(Boolean).slice(0, 250);
    setPreloadIds(Array.from(new Set(ids)));
  }, [isNew, searchParams]);
  useEffect(() => { if (presetCustomer.data?.customer) setCustomer(presetCustomer.data.customer); }, [presetCustomer.data?.customer]);
  useEffect(() => {
    if (!isNew || ownerId || !assignees.length) return;
    let currentUserId = '';
    try { currentUserId = JSON.parse(localStorage.getItem('user') || 'null')?.id || ''; } catch {}
    setOwnerId((assignees.find((user: any) => user.id === currentUserId) || assignees[0]).id);
  }, [assignees, isNew, ownerId]);
  useEffect(() => {
    const products = preload.data?.productsByIds || [];
    if (!isNew || !products.length || preloadApplied.current) return;
    preloadApplied.current = true;
    const inferred = quoteTypeForProduct(products[0]);
    const family = quoteTypeLocked.current ? quoteType : products.every((product: any) => quoteTypeForProduct(product) === inferred) ? inferred : quoteType;
    if (!quoteTypeLocked.current) setQuoteType(family);
    const eligible = products.filter((product: any) => quoteTypeForProduct(product) === family);
    setLines(eligible.map((product: any) => lineFromProduct(product, DEFAULT_AREA)));
    notify(`${eligible.length} showroom selection${eligible.length === 1 ? '' : 's'} added with Product Master MRP.`);
  }, [isNew, notify, preload.data?.productsByIds, quoteType]);

  // ---------- load: existing quote ----------
  const legacyIds = useMemo(() => Array.from(new Set((Array.isArray(quote?.lines) ? quote.lines : [])
    .filter((line: any) => String(line.pricingVersion || '') !== 'unified_retail_v1')
    .map((line: any) => String(line.productId || '')).filter(Boolean))) as string[], [quote?.lines]);
  const legacyProducts = useQuery(PRODUCTS_BY_IDS, { variables: { ids: legacyIds }, skip: !legacyIds.length });

  const settingsFingerprint = useCallback((values: { projectName: string; validUntil: string; displayMode: string; architectId: string; remarks: string; terms: string; bankDetails: string; coverImage: string; tagline: string }) => JSON.stringify(values), []);
  const currentSettings = useMemo(() => settingsFingerprint({ projectName, validUntil, displayMode, architectId: architect?.id || '', remarks, terms, bankDetails, coverImage, tagline }), [architect?.id, bankDetails, coverImage, displayMode, projectName, remarks, settingsFingerprint, tagline, terms, validUntil]);

  useEffect(() => {
    if (isNew || !quote) return;
    if (legacyIds.length && legacyProducts.loading) return;
    const signature = `${quote.id}:${quote.quoteNumber}:${quote.versionNumber}:${quote.status}:${quote.pricingStatus}:${JSON.stringify(quote.lines).length}`;
    if (loadedFor.current === signature) return;
    loadedFor.current = signature;
    const meta = quote.quoteMeta || {};
    const productMap = new Map((legacyProducts.data?.productsByIds || []).map((product: any) => [String(product.id), product]));
    const roomNames = new Map<string, string>();
    const loaded: Line[] = (Array.isArray(quote.lines) ? quote.lines : []).map((line: any, index: number) => {
      const prepared = String(line.pricingVersion || '') === 'unified_retail_v1'
        ? { ...line, area: line.area || DEFAULT_AREA, quoteImage: line.quoteImage || line.customImageUrl || '' }
        : prepareLegacyLine(line, productMap.get(String(line.productId || '')));
      // One spelling per room, so "kitchen" and "Kitchen" are the same room.
      const room = String(prepared.area || DEFAULT_AREA).trim().replace(/\s+/g, ' ') || DEFAULT_AREA;
      const key = room.toLowerCase();
      if (!roomNames.has(key)) roomNames.set(key, room);
      return { ...prepared, area: roomNames.get(key), qty: prepared.qty ?? prepared.quantity, _k: `q${index}` };
    });
    const nextTaxMode: TaxMode = meta.taxMode === 'non_gst' ? 'non_gst' : 'gst';
    const nextDiscountType: DiscountMode = (meta.quoteDiscount?.mode || meta.quoteDiscount?.type) === 'FIXED_AMOUNT' || meta.quoteDiscount?.type === 'amount' ? 'FIXED_AMOUNT' : 'PERCENT';
    const rawDiscount = meta.quoteDiscount?.value ?? quote.discountPercent;
    const nextDiscountValue = Number(rawDiscount || 0) > 0 ? String(rawDiscount) : '';
    setLines(loaded);
    setBaseline(new Map(loaded.map((line) => [line._k, line])));
    setBaselineFingerprint(commercialFingerprint(loaded, nextTaxMode, nextDiscountType, nextDiscountValue));
    setQuoteType(quote.quoteType === 'tile' ? 'tile' : 'cp_sanitary');
    setCustomer(quote.customer || null);
    setOwnerId(quote.ownerId || quote.owner?.id || '');
    const nextArchitect = quote.architectId ? { id: quote.architectId, name: quote.architectName || quote.architect?.name, firmName: quote.architect?.firmName, metadata: quote.architect?.metadata } : null;
    setArchitect(nextArchitect);
    const loadedRemarks = String(meta.remarks || quote.notes || '').trim();
    const nextValues = {
      projectName: quote.projectName || '',
      validUntil: isoDate(quote.validUntil),
      displayMode: (quote.displayMode === 'selection' ? 'selection' : 'priced') as 'priced' | 'selection',
      architectId: nextArchitect?.id || '',
      remarks: /^prepared from quote studio\.?$/i.test(loadedRemarks) || /^generated from product intent\.?$/i.test(loadedRemarks) ? '' : loadedRemarks,
      terms: meta.terms || '',
      bankDetails: meta.bankDetails || '',
      coverImage: quote.coverImage || meta.coverImage || '',
      tagline: meta.tagline || '',
    };
    setProjectName(nextValues.projectName);
    setValidUntil(nextValues.validUntil);
    setDisplayMode(nextValues.displayMode);
    setRemarks(nextValues.remarks);
    setTerms(nextValues.terms);
    setBankDetails(nextValues.bankDetails);
    setCoverImage(nextValues.coverImage);
    setTagline(nextValues.tagline);
    setTaxMode(nextTaxMode);
    setDiscountType(nextDiscountType);
    setDiscountValue(nextDiscountValue);
    setBaselineSettings(settingsFingerprint(nextValues));
    setReviseOrdered(false);
    setExtraAreas([]);
    const firstArea = loaded[0]?.area || DEFAULT_AREA;
    setTargetArea(firstArea);
  }, [isNew, legacyIds.length, legacyProducts.data?.productsByIds, legacyProducts.loading, quote, settingsFingerprint]);

  // ---------- derived ----------
  const activeLines = useMemo(() => lines.filter((line) => !line._removed), [lines]);
  const pricing = useMemo(() => priceLines(activeLines, taxMode, discountType, discountValue), [activeLines, discountType, discountValue, taxMode]);
  const rowByKey = useMemo(() => new Map(pricing.rows.map((row: any) => [row._k, row])), [pricing.rows]);
  const issuesByKey = useMemo(() => new Map(activeLines.map((line) => [line._k, lineIssues(line, rowByKey.get(line._k), quoteType)])), [activeLines, quoteType, rowByKey]);
  const blocking = useMemo(() => activeLines.flatMap((line) => (issuesByKey.get(line._k) || []).filter((issue) => issue.blocking).map((issue) => ({ line, issue }))), [activeLines, issuesByKey]);
  const floorWarnings = useMemo(() => activeLines.filter((line) => (issuesByKey.get(line._k) || []).some((issue) => issue.key === 'floor')), [activeLines, issuesByKey]);
  const subtotalBeforeQuoteDiscount = pricing.rows.reduce((sum: number, row: any) => sum + Number(row.grossBeforeQuoteDiscount || 0), 0);
  const quoteDiscountNumber = Number(discountValue || 0);
  const discountIssue = pricing.discountError || !Number.isFinite(quoteDiscountNumber) || quoteDiscountNumber < 0
    || (discountType === 'PERCENT' && quoteDiscountNumber > 100) || (discountType === 'FIXED_AMOUNT' && quoteDiscountNumber > subtotalBeforeQuoteDiscount)
    ? (discountType === 'PERCENT' ? 'Quote discount must be 0 to 100%.' : `Quote discount cannot be more than ${money(subtotalBeforeQuoteDiscount)}.`) : '';
  const totals = useMemo(() => pricing.rows.reduce((sum: any, row: any) => ({
    mrp: sum.mrp + Number(row.grossMrp || 0),
    lineNet: sum.lineNet + Number(row.grossBeforeQuoteDiscount || 0),
    quoteDiscount: sum.quoteDiscount + Number(row.quoteDiscountAmount || 0),
    taxable: sum.taxable + Number(row.taxableValue || 0),
    gst: sum.gst + Number(row.taxAmount || 0),
    total: sum.total + Number(row.total || 0),
  }), { mrp: 0, lineNet: 0, quoteDiscount: 0, taxable: 0, gst: 0, total: 0 }), [pricing.rows]);
  const gstOnTop = activeLines.some((line) => String(line.taxTreatment || '').toUpperCase() === 'EXCLUSIVE');
  const pricingReady = activeLines.length > 0 && blocking.length === 0 && !discountIssue;

  const meta = quote?.quoteMeta || {};
  const persistedConfirmed = Boolean(quote && quote.status !== 'incomplete_pricing' && quote.pricingStatus !== 'incomplete'
    && String(quote.pricingVersion || '') === 'unified_retail_v1' && Array.isArray(quote.lines) && quote.lines.length > 0
    && quote.lines.every((line: any) => String(line.pricingVersion || '') === 'unified_retail_v1' && Number(line.mrpInclusive || 0) > 0 && line.mrpConfirmedAt && line.mrpConfirmedById));
  const commercialLocked = Boolean(fulfillment?.orders?.length);
  const closedStatus = Boolean(quote && (['cancelled', 'superseded', 'closed', 'lost', 'expired'].includes(quote.status) || quote.supersededByQuoteId));
  const fingerprint = useMemo(() => commercialFingerprint(lines, taxMode, discountType, discountValue), [discountType, discountValue, lines, taxMode]);
  const commercialDirty = !isNew && fingerprint !== baselineFingerprint;
  const settingsDirty = !isNew && currentSettings !== baselineSettings;
  const mode: Mode = isNew ? 'new'
    : closedStatus ? 'closed'
      : commercialLocked ? (reviseOrdered ? 'reviseOrdered' : 'locked')
        : persistedConfirmed ? (commercialDirty ? 'revising' : 'confirmed')
          : 'draft';
  const canEditLines = ['new', 'draft', 'confirmed', 'revising', 'reviseOrdered'].includes(mode);
  const versionNumber = Number(quote?.versionNumber || 1);
  const familyBase = quote ? baseQuoteNumber(quote) : '';
  const nextRevisionName = quote ? `${familyBase}${revisionLetter(versionNumber + 1)}` : '';
  const orderedQtyByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of fulfillment?.lines || []) map.set(String(row.lineKey || ''), Number(row.ordered || 0));
    return map;
  }, [fulfillment?.lines]);

  const areas = useMemo(() => {
    const seen: string[] = [];
    for (const line of lines) { const area = String(line.area || DEFAULT_AREA); if (!seen.some((value) => value.toLowerCase() === area.toLowerCase())) seen.push(area); }
    for (const area of extraAreas) if (!seen.some((value) => value.toLowerCase() === area.toLowerCase())) seen.push(area);
    return seen.length ? seen : [DEFAULT_AREA];
  }, [extraAreas, lines]);
  useEffect(() => { if (!areas.some((area) => area === targetArea)) setTargetArea(areas[0]); }, [areas, targetArea]);
  useEffect(() => { if (areaFilter !== 'all' && !areas.includes(areaFilter)) setAreaFilter('all'); }, [areaFilter, areas]);
  const sameRoom = (a: unknown, b: unknown) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  const canonicalRoom = (name: string) => areas.find((area) => sameRoom(area, name)) || name.trim();
  // Combined quantity of each item across every room.
  const itemTotals = useMemo(() => {
    const map = new Map<string, { name: string; unit: string; qty: number; rooms: Array<{ area: string; qty: number }> }>();
    for (const line of activeLines) {
      const key = String(line.productId || '');
      if (!key) continue;
      const tile = isTileLine(line);
      const qty = tile && tilePriceUom(line.pricingUom) !== 'PC' ? draftNumber(line.requestedArea) : draftNumber(line.qty ?? line.quantity);
      const unit = tile && tilePriceUom(line.pricingUom) !== 'PC' ? tilePriceUom(line.pricingUom).toLowerCase() : String(line.inventoryUom || line.unit || 'pc').toLowerCase();
      const entry = map.get(key) || { name: String(line.name || line.sku || ''), unit, qty: 0, rooms: [] };
      entry.qty += qty;
      entry.rooms.push({ area: String(line.area || DEFAULT_AREA), qty });
      map.set(key, entry);
    }
    return map;
  }, [activeLines]);
  const multiRoomItems = useMemo(() => Array.from(itemTotals.entries()).filter(([, entry]) => entry.rooms.length > 1), [itemTotals]);
  const areaTotals = useMemo(() => new Map(areas.map((area) => {
    const keys = activeLines.filter((line) => line.area === area).map((line) => line._k);
    return [area, { count: keys.length, value: keys.reduce((sum, key) => sum + Number(rowByKey.get(key)?.grossBeforeQuoteDiscount || 0), 0), warn: keys.some((key) => (issuesByKey.get(key) || []).some((issue) => issue.blocking)) }];
  })), [activeLines, areas, issuesByKey, rowByKey]);

  type RevisionChange = { line: Line; kind: 'added' | 'changed' | 'removed'; detail: string[] };
  const revisionChanges = useMemo<RevisionChange[]>(() => {
    if (!baseline || !(mode === 'revising' || mode === 'reviseOrdered')) return [];
    return lines.flatMap((line): RevisionChange[] => {
      if (line._removed) return [{ line, kind: 'removed', detail: [] }];
      const detail = lineChanges(line, baseline.get(line._k));
      if (detail[0] === 'added') return [{ line, kind: 'added', detail: [] }];
      return detail.length ? [{ line, kind: 'changed', detail }] : [];
    });
  }, [baseline, lines, mode]);

  // ---------- search ----------
  const [debounced, setDebounced] = useState('');
  useEffect(() => { const timer = window.setTimeout(() => setDebounced(search.trim()), 180); return () => window.clearTimeout(timer); }, [search]);
  const searchQuery = useQuery(SEARCH, { variables: { query: debounced }, skip: debounced.length < 2 });
  const results = useMemo(() => (searchQuery.data?.globalSearch?.products || []).filter((product: any) => activeLines.length === 0 && !quoteTypeLocked.current && isNew ? true : quoteTypeForProduct(product) === quoteType).slice(0, 8), [activeLines.length, isNew, quoteType, searchQuery.data?.globalSearch?.products]);
  const otherFamilyOnly = debounced.length >= 2 && !searchQuery.loading && (searchQuery.data?.globalSearch?.products || []).length > 0 && results.length === 0;

  // ---------- line actions ----------
  const addProduct = (product: any, area = targetArea) => {
    if (!canEditLines) return false;
    const family = quoteTypeForProduct(product);
    let effective = quoteType;
    if (family !== quoteType) {
      if (activeLines.length === 0 && !quoteTypeLocked.current && isNew) { effective = family; setQuoteType(family); }
      else { setError(`${product.internalCode || product.sku} belongs in a ${family === 'tile' ? 'Tile & Chemical' : 'CP & Sanitary'} quote.`); return false; }
    }
    if (family !== effective) return false;
    const room = canonicalRoom(area);
    const existing = activeLines.find((line) => line.productId === product.id && sameRoom(line.area, room));
    if (existing) {
      setFocusKey(existing._k);
      const others = (itemTotals.get(product.id)?.rooms || []).filter((row) => !sameRoom(row.area, room)).map((row) => row.area);
      notify(`${product.name} is already in ${room}, so its quantity is selected to change.${others.length ? '' : ' To use it in another room, pick that room in "into" first.'}`);
      return false;
    }
    const line = lineFromProduct(product, room);
    setLines((current) => [...current, line]);
    setFocusKey(line._k);
    setError('');
    return true;
  };
  const updateLine = (key: string, patch: Record<string, any>) => {
    if ('area' in patch) {
      const moving = lines.find((line) => line._k === key);
      const clash = moving && activeLines.find((line) => line._k !== key && line.productId === moving.productId && sameRoom(line.area, patch.area));
      if (clash) { setFocusKey(clash._k); notify(`${moving!.name} is already in ${clash.area}. Change the quantity there instead of moving this line.`); return; }
      patch = { ...patch, area: canonicalRoom(String(patch.area)) };
    }
    setLines((current) => current.map((line) => (line._k === key ? patchLine(line, patch) : line)));
  };
  const undoRemove = (line: Line) => {
    const clash = activeLines.find((row) => row.productId === line.productId && sameRoom(row.area, line.area));
    if (clash) { setFocusKey(clash._k); notify(`${line.name} was added to ${line.area} again, so the removed line cannot come back. Change the quantity on the new line.`); return; }
    setLines((current) => current.map((row) => (row._k === line._k ? { ...row, _removed: undefined } : row)));
  };
  const removeLine = (line: Line) => {
    if (baseline?.has(line._k) && persistedConfirmed) setLines((current) => current.map((row) => (row._k === line._k ? { ...row, _removed: true } : row)));
    else setLines((current) => current.filter((row) => row._k !== line._k));
  };
  const copyToArea = (line: Line, area: string) => {
    const existing = activeLines.find((row) => row.productId === line.productId && sameRoom(row.area, area));
    if (existing) { setFocusKey(existing._k); notify(`${line.name} is already in ${area}. Its quantity is selected to change.`); return; }
    const key = lineKey();
    const copy: Line = { ...line, _k: key, area, lineKey: `product:${line.productId}:${key}`, _removed: undefined };
    delete (copy as any).quoteLineId;
    delete (copy as any).mrpConfirmedAt;
    delete (copy as any).mrpConfirmedById;
    setLines((current) => [...current, copy]);
    setFocusKey(key);
    notify(`${line.name} added to ${area} as its own line.`);
  };
  const addArea = () => {
    const typed = newArea.trim().replace(/\s+/g, ' ');
    if (!typed) return;
    const existing = areas.find((area) => sameRoom(area, typed));
    if (!existing) setExtraAreas((current) => [...current, typed]);
    const name = existing || typed;
    setTargetArea(name);
    setAreaFilter(name);
    if (existing) notify(`${existing} already exists. New items will go there.`);
    setNewArea('');
    window.setTimeout(() => searchRef.current?.focus(), 30);
  };
  const renameArea = (from: string, to: string) => {
    const typed = to.trim().replace(/\s+/g, ' ');
    if (!typed || typed === from) return;
    const into = areas.find((area) => area !== from && sameRoom(area, typed));
    const name = into || typed;
    if (into) {
      const clash = activeLines.find((line) => sameRoom(line.area, from) && activeLines.some((other) => sameRoom(other.area, into) && other.productId === line.productId));
      if (clash) { notify(`${from} and ${into} both have ${clash.name}. Remove one of them before joining the two rooms.`); return; }
    }
    setLines((current) => current.map((line) => (line.area === from ? { ...line, area: name } : line)));
    setExtraAreas((current) => current.map((area) => (area === from ? name : area)));
    if (targetArea === from) setTargetArea(name);
    if (areaFilter === from) setAreaFilter(name);
  };

  useEffect(() => {
    if (!focusKey) return;
    const timer = window.setTimeout(() => {
      const row = document.getElementById(`line-${focusKey}`);
      row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const input = row?.querySelector<HTMLInputElement>('input[data-primary]');
      input?.focus();
      input?.select();
      setFocusKey(null);
    }, 60);
    return () => window.clearTimeout(timer);
  }, [focusKey, lines]);

  // ---------- scan ----------
  const [scanLabel, scanState] = useMutation(SCAN_LABEL);
  const scanToQuote = async (payload: string) => {
    setScanPayload(payload);
    setScanResult(null);
    const result = (await scanLabel({ variables: { labelCode: payload, input: { action: 'quote_similar_lookup', metadata: { surface: 'quote_workspace' } } } })).data?.scanInternalLabel;
    if (result?.result !== 'success' || !result?.label?.product) { setError(`Scan blocked: ${result?.message || 'No active label matched this code.'} The quote was not changed.`); return; }
    setScanResult(result);
  };
  const addScanned = async (products: any[]) => {
    await scanLabel({ variables: { labelCode: scanPayload, input: { action: 'quote_similar_select', entityType: 'QuoteDraft', metadata: { surface: 'quote_workspace', selectedProductIds: products.map((product) => product.id) } } } });
    const added = products.filter((product) => addProduct(product)).length;
    notify(added ? `${added} scanned item${added === 1 ? '' : 's'} added to ${targetArea}.` : 'Those items belong to the other quote type. Nothing was added.');
    setScanResult(null);
    setScanOpen(false);
  };

  // ---------- saving ----------
  const [createQuote] = useMutation(CREATE_QUOTE);
  const [updateQuote] = useMutation(UPDATE_QUOTE);
  const buildMeta = (forCommercial: boolean) => {
    const loaded = Object.fromEntries(Object.entries(meta).filter(([key]) => !SERVER_META.includes(key)));
    const commercialMeta = forCommercial
      ? { taxMode, quoteDiscount: { mode: discountType, value: Number(discountValue || 0) } }
      : { taxMode: meta.taxMode || 'gst', quoteDiscount: meta.quoteDiscount || { mode: 'PERCENT', value: Number(quote?.discountPercent || 0) } };
    return JSON.stringify({
      ...loaded,
      remarks, terms: terms || undefined, bankDetails: bankDetails || undefined, coverImage, tagline,
      quoteType, pricingVersion: 'unified_retail_v1', taxTreatment: isNew ? 'EXCLUSIVE' : (meta.taxTreatment || undefined),
      ...commercialMeta,
    });
  };
  const firstBlockingFocus = () => {
    const first = blocking[0];
    if (first) { setAreaFilter('all'); setFocusKey(first.line._k); }
  };
  const validateBeforeSave = (asDraft: boolean) => {
    if (!customer?.id) { setError('Choose the customer first.'); setDialog('customer'); return false; }
    if (!activeLines.length) { setError('Add at least one item.'); searchRef.current?.focus(); return false; }
    if (!ownerId) { setError('Choose the responsible sales person.'); return false; }
    const family = activeLines.find((line) => quoteTypeForProduct(line) !== quoteType);
    if (family) { setError(`${family.sku || family.name} does not belong in this quote type. Remove it first.`); setFocusKey(family._k); return false; }
    if (discountIssue) { setError(discountIssue); return false; }
    const hard = blocking.find(({ issue }) => asDraft ? ['family', 'nrpInput', 'special', 'coverage', 'qty'].includes(issue.key) : true);
    if (hard) { setError(`${hard.line.name}: ${hard.issue.message}.`); setAreaFilter('all'); setFocusKey(hard.line._k); return false; }
    return true;
  };
  const commonInput = () => ({
    quoteType,
    architectId: architect?.id || '',
    projectName,
    validUntil: validUntil ? new Date(`${validUntil}T23:59:59`).toISOString() : undefined,
    displayMode,
    discountPercent: discountType === 'PERCENT' ? Number(discountValue || 0) : 0,
  });
  const run = async (operation: string, task: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try { await task(); } catch (err) {
      const message = errorText(err, operation);
      setError(message);
      const lineKeyFromError = describeApolloError(err, operation).lineKey;
      const line = lineKeyFromError ? activeLines.find((row) => row.lineKey === lineKeyFromError) : null;
      if (line) setFocusKey(line._k);
    } finally { setBusy(false); }
  };
  const saveNew = (asDraft: boolean) => {
    if (!validateBeforeSave(asDraft)) return;
    void run('CreateQuote', async () => {
      const result = await createQuote({ variables: { input: {
        ...commonInput(),
        customerId: customer.id,
        ownerId,
        architectId: architect?.id || undefined,
        title: projectName || (quoteType === 'tile' ? 'Tile & chemical quotation' : 'CP & sanitary quotation'),
        saveAsDraft: asDraft,
        quoteMeta: buildMeta(true),
        lines: serializeLines(activeLines, rowByKey, taxMode, discountType, discountValue, 'EXCLUSIVE'),
      } } });
      const created = result.data?.createQuote;
      if (!created?.id) throw new Error('The quote was not saved.');
      notify(`${created.quoteNumber} ${asDraft ? 'saved as a draft' : 'confirmed'}.`);
      router.replace(`/dashboard/quotes/${created.id}`);
    });
  };
  const saveExisting = (asDraft: boolean) => {
    if (!quote) return;
    if (!validateBeforeSave(asDraft)) return;
    void run('UpdateQuote', async () => {
      const result = await updateQuote({ variables: { id: quote.id, input: {
        ...commonInput(),
        saveAsDraft: asDraft,
        coverImage,
        quoteMeta: buildMeta(true),
        lines: serializeLines(activeLines, rowByKey, taxMode, discountType, discountValue),
      } } });
      const saved = result.data?.updateQuote;
      loadedFor.current = '';
      await Promise.all([quoteQuery.refetch(), fulfillmentQuery.refetch()]);
      if (saved && saved.quoteNumber !== quote.quoteNumber) notify(`Saved as ${saved.quoteNumber}. The PDF, share link and architect bundle now show this revision.`);
      else notify(asDraft ? 'Draft saved.' : `${saved?.quoteNumber || quote.quoteNumber} confirmed.`);
    });
  };
  const saveSettings = () => {
    if (!quote) return;
    void run('UpdateQuote', async () => {
      await updateQuote({ variables: { id: quote.id, input: {
        architectId: architect?.id || '',
        projectName,
        validUntil: validUntil ? new Date(`${validUntil}T23:59:59`).toISOString() : undefined,
        displayMode,
        coverImage,
        quoteMeta: buildMeta(false),
      } } });
      loadedFor.current = '';
      await quoteQuery.refetch();
      notify('Changes saved.');
    });
  };
  const saveOrderedRevision = () => {
    if (!quote || !validateBeforeSave(false)) return;
    void run('CreateQuote', async () => {
      const result = await createQuote({ variables: { input: {
        ...commonInput(),
        customerId: quote.customerId,
        leadId: quote.leadId,
        ownerId: quote.ownerId,
        architectId: architect?.id || undefined,
        supersedesQuoteId: quote.id,
        title: quote.title || projectName || 'Retail quotation',
        saveAsDraft: false,
        quoteMeta: buildMeta(true),
        lines: serializeLines(activeLines.map((line) => { const { quoteLineId, mrpConfirmedAt, mrpConfirmedById, ...rest } = line as any; return rest as Line; }), rowByKey, taxMode, discountType, discountValue, 'EXCLUSIVE'),
      } } });
      const created = result.data?.createQuote;
      if (!created?.id) throw new Error('The revision was not saved.');
      notify(`${created.quoteNumber} saved. ${quote.quoteNumber} keeps its sales order history.`);
      router.push(`/dashboard/quotes/${created.id}`);
    });
  };
  const discard = () => {
    loadedFor.current = '';
    setReviseOrdered(false);
    void quoteQuery.refetch().then(() => notify('Changes discarded. The saved quote is unchanged.'));
  };

  // ---------- other actions ----------
  const [sendQuote] = useMutation(SEND_QUOTE);
  const [shareQuote] = useMutation(SHARE_QUOTE);
  const [cancelQuote] = useMutation(CANCEL_QUOTE);
  const [uploadCover] = useMutation(UPLOAD);
  const share = () => void run('CreateQuoteShare', async () => {
    const token = (await shareQuote({ variables: { quoteId: quote.id } })).data?.createQuoteShare?.token;
    if (!token) throw new Error('The share link could not be created.');
    const url = `${window.location.origin}/share/quotes/${token}`;
    try { await navigator.clipboard.writeText(url); notify('Share link copied. The same link shows every later revision.'); } catch { notify(`Share link: ${url}`); }
  });
  const markSent = () => void run('SendQuote', async () => { await sendQuote({ variables: { id: quote.id } }); await quoteQuery.refetch(); notify(`${quote.quoteNumber} marked as sent.`); });
  const onCoverFile = async (file: File | null) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) { setError('Use a JPG, PNG or WebP image under 5 MB.'); return; }
    setUploadingCover(true);
    try {
      const url = (await uploadCover({ variables: { filename: file.name, contentBase64: await fileBase64(file), scope: 'product-image' } })).data?.uploadStoredAsset?.result?.publicUrl;
      if (!url) throw new Error('Upload failed.');
      setCoverImage(url);
    } catch (err) { setError(errorText(err, 'UploadCover')); } finally { setUploadingCover(false); }
  };

  // ---------- keyboard ----------
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if (event.key === '/' && !typing && !dialog) { event.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog]);
  // Enter pressed before results arrive adds the first match once they do.
  const [pendingEnter, setPendingEnter] = useState(false);
  useEffect(() => {
    if (!pendingEnter || searchQuery.loading || debounced !== search.trim()) return;
    setPendingEnter(false);
    if (results[0]) { if (addProduct(results[0])) { setSearch(''); setResultsOpen(false); } }
    else if (search.trim().length >= 2) setResultsOpen(true);
  }, [pendingEnter, searchQuery.loading, debounced, search, results]); // eslint-disable-line react-hooks/exhaustive-deps
  const onSearchKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    const count = results.length + 1;
    if (event.key === 'ArrowDown') { event.preventDefault(); setResultsOpen(true); setSearchIndex((index) => (index + 1) % count); }
    if (event.key === 'ArrowUp') { event.preventDefault(); setSearchIndex((index) => (index - 1 + count) % count); }
    if (event.key === 'Escape') { setResultsOpen(false); setSearch(''); }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (search.trim().length < 2) return;
      const settled = !searchQuery.loading && debounced === search.trim();
      if (!settled) { setPendingEnter(true); return; }
      if (searchIndex < results.length && results[searchIndex]) { if (addProduct(results[searchIndex])) { setSearch(''); setResultsOpen(false); } }
      else if (searchIndex === results.length) { setResultsOpen(false); setDialog('sku'); }
    }
  };

  // ---------- render helpers ----------
  if (!isNew && quoteQuery.loading && !quote) return <div role="status" className="mp-card rounded-r5 p-10 text-center font-semibold text-[var(--ink-4)]">Loading quote…</div>;
  if (!isNew && quoteQuery.error && !quote) return <div className="mp-card rounded-r5 p-6"><QueryErrorBanner error={quoteQuery.error} onRetry={() => quoteQuery.refetch()} /></div>;
  if (!isNew && !quote) return <div className="mp-card rounded-r5 p-10 text-center font-semibold text-[var(--ink-4)]">Quote not found.</div>;

  const visibleAreas = areaFilter === 'all' ? areas : [areaFilter];
  const pill = STATUS_PILL[mode];
  const approvalPending = quote?.approvalStatus === 'pending';
  const preparedBy = meta.preparedByName || (/^[0-9A-HJKMNP-TV-Z]{26}$/.test(String(meta.preparedBy || '')) ? '' : meta.preparedBy) || quote?.owner?.name || '';
  const owner = assignees.find((user: any) => user.id === ownerId) || quote?.owner;
  const pdfReady = persistedConfirmed && !closedStatus && mode !== 'revising';
  const quoteTitle = isNew ? 'New quote' : (mode === 'revising' ? nextRevisionName : quote.quoteNumber);

  const headerActions = (() => {
    const buttons: ReactNode[] = [];
    if (mode === 'new' || mode === 'draft') {
      buttons.push(<button key="draft" type="button" disabled={busy} onClick={() => (isNew ? saveNew(true) : saveExisting(true))} className={secondaryButton}>Save draft</button>);
      buttons.push(<button key="confirm" type="button" disabled={busy || !customer || !activeLines.length} onClick={() => { if (!pricingReady) { firstBlockingFocus(); setError(blocking.length ? `${blocking.length} thing${blocking.length === 1 ? '' : 's'} to fix before confirming. They are listed on the right.` : discountIssue || 'Add items first.'); return; } return isNew ? saveNew(false) : saveExisting(false); }} className={primaryButton}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{blocking.length ? `Fix ${blocking.length} to confirm` : 'Confirm quote'}</button>);
    }
    if (mode === 'confirmed' || mode === 'locked') {
      if (settingsDirty) buttons.push(<button key="save-settings" type="button" disabled={busy} onClick={saveSettings} className={primaryButton}>Save changes</button>);
      buttons.push(<button key="docs" type="button" onClick={() => setDialog('documents')} className={secondaryButton}><Download className="h-4 w-4" /><span className="mp-bar-label">PDF</span></button>);
      buttons.push(<button key="share" type="button" disabled={busy || approvalPending} onClick={share} className={secondaryButton}><Share2 className="h-4 w-4" /><span className="mp-bar-label">Share</span></button>);
      if (mode === 'locked') buttons.push(<button key="rev" type="button" onClick={() => setReviseOrdered(true)} className={secondaryButton}>Revise</button>);
      buttons.push(<button key="order" type="button" disabled={approvalPending} onClick={() => setDialog('order')} className={primaryButton}><ShoppingCart className="h-4 w-4" />{mode === 'locked' ? 'Order remaining' : 'Convert to order'}</button>);
    }
    if (mode === 'revising') {
      buttons.push(<button key="discard" type="button" disabled={busy} onClick={discard} className={secondaryButton}><Undo2 className="h-4 w-4" />Discard</button>);
      buttons.push(<button key="save" type="button" disabled={busy || !pricingReady} onClick={() => saveExisting(false)} className={primaryButton}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Save as {nextRevisionName}</button>);
    }
    if (mode === 'reviseOrdered') {
      buttons.push(<button key="discard" type="button" disabled={busy} onClick={discard} className={secondaryButton}>Cancel revision</button>);
      buttons.push(<button key="save" type="button" disabled={busy || !pricingReady} onClick={saveOrderedRevision} className={primaryButton}>Save as {nextRevisionName}</button>);
    }
    return buttons;
  })();
  // On phones the sticky bottom bar carries the main actions; the header keeps only the others, so nothing shows twice.
  const inPhoneBar = (node: ReactNode) => isValidElement(node) && PHONE_BAR_ACTIONS.has(String(node.key));
  const phoneBarActions = headerActions.filter(inPhoneBar);
  const phoneHeaderActions = headerActions.filter((node) => !inPhoneBar(node));
  const sentLabel = quote?.status === 'sent' ? `Sent ${shortDate(quote.sentAt)}` : '';

  return (
    <div className="flex flex-col gap-3 pb-24 xl:h-[calc(100vh-7.5rem)] xl:pb-0">
      {/* Header */}
      <section className="rounded-r5 border border-[var(--line)] bg-[var(--surface)] px-4 py-3 shadow-sm-soft">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Link href="/dashboard/quotes" aria-label="Back to quotes" className="rounded-md p-1.5 text-[var(--ink-4)] hover:bg-[var(--bg-soft)]"><ArrowLeft className="h-4 w-4" /></Link>
          <h1 className="font-display text-xl font-bold tracking-[-0.01em] text-[var(--ink)]">{quoteTitle}</h1>
          <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', pill.className)}><span className="h-1.5 w-1.5 rounded-full bg-current" />{mode === 'closed' ? (quote?.supersededByQuoteId ? 'Superseded' : String(quote?.status || '').replace('_', ' ')) : mode === 'confirmed' && sentLabel ? sentLabel : pill.label}{mode === 'draft' && blocking.length ? ` · ${blocking.length} to fix` : ''}</span>
          {approvalPending ? <span className="rounded-full bg-[var(--warning-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--warning)]">Waiting for owner price approval</span> : null}
          {sentLabel && mode !== 'confirmed' ? <span className="rounded-full bg-[var(--bg-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--ink-3)]">{sentLabel}</span> : null}
          <div className="-mx-1 flex w-full items-center gap-1.5 overflow-x-auto px-1 [&>*]:shrink-0 sm:mx-0 sm:w-auto sm:flex-wrap sm:overflow-visible sm:px-0">
            <button type="button" disabled={!isNew} onClick={() => setDialog('customer')} className={cn('inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-medium', customer ? 'border-[var(--line)] bg-[var(--surface)] text-[var(--ink-2)] disabled:cursor-default' : 'border-[var(--brand-500)] bg-[var(--brand-50)] font-semibold text-[var(--brand-700)]')}>
              {customer ? <><b className="font-semibold text-[var(--ink)]">{customer.name}</b><span className="text-[var(--ink-4)]">{customer.mobile}{customer.city ? ` · ${customer.city}` : ''}</span>{isFollowUp(customer) ? <span className="rounded bg-[var(--warning-bg)] px-1.5 text-[10px] font-semibold text-[var(--warning)]">follow up</span> : null}</> : <><Plus className="h-3.5 w-3.5" />Customer (name and mobile is enough)</>}
            </button>
            <button type="button" disabled={mode === 'closed'} onClick={() => setDialog('architect')} className={cn('inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-medium', architect ? 'border-[var(--line)] text-[var(--ink-2)]' : 'border-dashed border-[var(--line-strong)] font-semibold text-[var(--brand-700)]')}>
              {architect ? <><span className="text-[var(--ink-4)]">Architect</span><b className="font-semibold text-[var(--ink)]">{architect.name}</b></> : <><Plus className="h-3.5 w-3.5" />Architect</>}
            </button>
            <QuoteTypeChip quoteType={quoteType} editable={isNew && activeLines.length === 0} onChange={(value) => { quoteTypeLocked.current = true; setQuoteType(value); }} />
          </div>
          <div className="flex flex-wrap items-center gap-2 xl:ml-auto">
            <span className="text-xs text-[var(--ink-4)]">{busy ? 'Saving…' : mode === 'revising' ? `Customer still sees ${quote.quoteNumber}` : settingsDirty || (mode === 'draft' && commercialDirty) ? 'Unsaved changes' : !isNew ? 'All changes saved' : ''}</span>
            <span className="hidden xl:contents">{headerActions}</span>
            <span className="contents xl:hidden">{phoneHeaderActions}</span>
          </div>
        </div>
      </section>

      {/* Banners */}
      {setup.error ? <QueryErrorBanner error={setup.error} /> : null}
      {error ? <div role="alert" className="flex items-start gap-2 rounded-r4 border border-[var(--warning)]/40 bg-[var(--warning-bg)] px-4 py-2.5 text-sm font-medium text-[var(--warning)]"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span className="flex-1">{error}</span><button type="button" aria-label="Dismiss" onClick={() => setError('')}><X className="h-4 w-4" /></button></div> : null}
      {openQuotes.length ? (
        <Banner tone="info" title={`${customer?.name || 'This customer'} already has ${openQuotes.length === 1 ? 'an open quote' : `${openQuotes.length} open quotes`}.`}>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {openQuotes.map((row) => {
              const label = `${row.quoteNumber} · ${String(row.status || '').replace(/_/g, ' ')}${row.total != null ? ` · ${money(Number(row.total))}` : ''} · ${shortDate(row.updatedAt || row.createdAt)}${row.mine ? '' : row.ownerName ? ` · ${row.ownerName}` : ''}`;
              return row.id ? <Link key={row.quoteNumber} href={`/dashboard/quotes/${row.id}`} className="font-semibold underline">{label}</Link> : <span key={row.quoteNumber} className="font-semibold">{label}</span>;
            })}
            <span>Open one of these, or carry on with a new quote.</span>
          </span>
        </Banner>
      ) : null}
      {searchParams.get('pdfError') === 'commercial-pricing' && !persistedConfirmed ? <Banner tone="warning" title="The PDF needs a confirmed quote.">Fix the items listed on the right, then press Confirm quote.</Banner> : null}
      {mode === 'revising' ? <Banner tone="info" title={`You are editing ${nextRevisionName}.`}>{quote.quoteNumber} ({money(Number(quote.commercialTotal || 0))}) stays as it is until you save. Saving updates this same quote, its PDF, share link and architect bundle. No extra quote or file is made.</Banner> : null}
      {mode === 'locked' ? <Banner tone="violet" title="This quote has a sales order.">Prices and quantities are locked. Press Revise to prepare {nextRevisionName}; the ordered quote keeps its order history.</Banner> : null}
      {mode === 'reviseOrdered' ? <Banner tone="info" title={`Preparing ${nextRevisionName}.`}>Saving creates {nextRevisionName} with these items and marks {quote.quoteNumber} as replaced. Its sales orders stay unchanged.</Banner> : null}
      {mode === 'draft' && activeLines.some((line) => String(line.pricingVersion) === 'legacy_unverified') ? <Banner tone="info" title="Older quote loaded with current Product Master MRP.">The customer rate is kept as a fixed NRP. Check each line, then press Confirm quote.</Banner> : null}
      {quote?.supersededByQuoteId ? <Banner tone="warning" title="A newer version replaced this quote."><Link className="font-semibold underline" href={`/dashboard/quotes/${quote.supersededByQuoteId}`}>Open the current version</Link></Banner> : null}
      {quote?.status === 'cancelled' ? <Banner tone="danger" title="This quote is cancelled.">Its history is kept; changes and orders are turned off.</Banner> : null}

      {/* Workspace */}
      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[11.5rem_minmax(0,1fr)_18rem] 2xl:grid-cols-[13.5rem_minmax(0,1fr)_20rem]">
        {/* Areas rail */}
        <aside aria-label="Areas" className="flex min-h-0 gap-1 overflow-x-auto rounded-r5 border border-[var(--line)] bg-[var(--surface-2)] p-2 xl:flex-col xl:overflow-y-auto">
          <p className="hidden px-2 pb-1 pt-1 text-[10.5px] font-bold uppercase tracking-[0.1em] text-[var(--ink-4)] xl:block">Areas</p>
          <AreaButton active={areaFilter === 'all'} name="All areas" count={activeLines.length} value={totals.lineNet} onClick={() => setAreaFilter('all')} />
          {areas.map((area) => {
            const info = areaTotals.get(area) || { count: 0, value: 0, warn: false };
            return <AreaButton key={area} active={areaFilter === area} name={area} count={info.count} value={info.value} warn={info.warn} onClick={() => { setAreaFilter(area); setTargetArea(area); }} />;
          })}
          {canEditLines ? (
            <div className="mt-1 hidden gap-1 px-1 xl:flex">
              <input list="mp-area-list" value={newArea} onChange={(event) => setNewArea(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addArea(); } }} placeholder="+ New area" aria-label="New area name" className="h-8 min-w-0 flex-1 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2 text-xs" />
              <button type="button" onClick={addArea} className="h-8 rounded-md border border-[var(--line-strong)] px-2 text-xs font-semibold">Add</button>
            </div>
          ) : null}
          <datalist id="mp-area-list">{AREA_SUGGESTIONS.map((area) => <option key={area} value={area} />)}</datalist>
        </aside>

        {/* Lines */}
        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-r5 border border-[var(--line)] bg-[var(--surface)]">
          {canEditLines ? (
            <div className="relative border-b border-[var(--line)] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[14rem] flex-1">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--ink-4)]" />
                  <input ref={searchRef} value={search} onChange={(event) => { setSearch(event.target.value); setResultsOpen(true); setSearchIndex(0); }} onFocus={() => setResultsOpen(true)} onBlur={() => window.setTimeout(() => setResultsOpen(false), 160)} onKeyDown={onSearchKey}
                    aria-label="Add item by code or name" placeholder={quoteType === 'tile' ? 'Add tile or chemical: code, name or brand' : 'Add item: code, name or brand'} className="h-9 w-full rounded-lg border border-[var(--line-strong)] bg-[var(--surface-2)] pl-9 pr-10 text-sm outline-none focus:border-[var(--brand-500)] focus:ring-2 focus:ring-[var(--ring)]" />
                  <kbd className="absolute right-2 top-2 rounded border border-[var(--line-strong)] bg-[var(--surface)] px-1.5 font-mono text-[10px] text-[var(--ink-4)]">/</kbd>
                </div>
                <label className="flex items-center gap-1.5 text-xs text-[var(--ink-3)]">into
                  <select aria-label="Room for new items" value={targetArea} onChange={(event) => setTargetArea(event.target.value)} className="h-9 max-w-[12rem] rounded-lg border-2 border-[var(--brand-500)] bg-[var(--brand-50)] px-2 text-xs font-semibold text-[var(--brand-800)]">{areas.map((area) => <option key={area}>{area}</option>)}</select>
                </label>
                <button type="button" onClick={() => { setScanOpen((value) => !value); setScanResult(null); }} className={cn(secondaryButton, 'h-9 px-3')}><Camera className="h-4 w-4" />{scanOpen ? 'Close scan' : 'Scan'}</button>
                <button type="button" onClick={() => setDialog('sku')} className={cn(secondaryButton, 'h-9 px-3')}><Plus className="h-4 w-4" />New SKU</button>
              </div>
              {resultsOpen && search.trim().length >= 2 ? (
                <div className="absolute left-3 right-3 top-full z-30 mt-1 max-h-[22rem] overflow-y-auto rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] shadow-lg-soft" role="listbox">
                  {searchQuery.loading && !results.length ? <p className="flex items-center gap-2 px-3 py-3 text-xs text-[var(--ink-4)]"><Loader2 className="h-3.5 w-3.5 animate-spin" />Searching…</p> : null}
                  {otherFamilyOnly ? <p className="px-3 py-3 text-xs font-medium text-[var(--warning)]">Matches exist only in the {quoteType === 'tile' ? 'CP & Sanitary' : 'Tile & Chemical'} family. Start that quote type to use them.</p> : null}
                  {results.map((product: any, index: number) => {
                    const onQuote = activeLines.filter((line) => line.productId === product.id).map((line) => line.area);
                    return (
                      <button key={product.id} type="button" role="option" aria-selected={index === searchIndex} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setSearchIndex(index)} onClick={() => { if (addProduct(product)) { setSearch(''); setResultsOpen(false); } }}
                        className={cn('grid w-full grid-cols-[2.75rem_1fr_auto] items-center gap-3 border-b border-[var(--line)] px-3 py-2 text-left', index === searchIndex ? 'bg-[var(--bg-soft)]' : '')}>
                        <ProductImageFrame src={productImage(product.media) || '/catalogue-art/faucet.svg'} alt="" className="h-11 w-11 rounded-md" imageClassName="p-1" />
                        <span className="min-w-0"><b className="block truncate text-sm text-[var(--ink)]">{product.name}</b><span className="block truncate text-xs text-[var(--ink-4)]"><span className="font-mono">{product.internalCode || product.sku}</span> · {product.brand || product.category}{onQuote.length ? ` · already in ${onQuote.join(', ')}` : ''}</span></span>
                        <span className="text-right text-xs">{Number(product.defaultMrpInclusive || 0) > 0 ? <><b className="block text-[var(--ink)]">{money(product.defaultMrpInclusive)}</b><span className="text-[var(--ink-4)]">MRP / {String(product.priceUom || product.salesUom || product.unit || 'pc').toLowerCase()}</span></> : <span className="font-semibold text-[var(--warning)]">MRP missing</span>}</span>
                      </button>
                    );
                  })}
                  <button type="button" onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setSearchIndex(results.length)} onClick={() => { setResultsOpen(false); setDialog('sku'); }} className={cn('flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold text-[var(--brand-700)]', searchIndex === results.length ? 'bg-[var(--brand-50)]' : '')}>
                    <Plus className="h-4 w-4" />Not in the catalogue? Quick add “{search.trim()}” as a new SKU
                  </button>
                </div>
              ) : null}
              {scanOpen ? <div className="mt-2 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2"><PhysicalQrScanner compact busy={scanState.loading} onDetected={scanToQuote} /></div> : null}
              {scanResult ? <div className="mt-2"><ScanProductSelector result={scanResult} busy={scanState.loading} existingProductIds={activeLines.filter((line) => line.area === targetArea).map((line) => line.productId)} primaryLabel={`Add to ${targetArea}`} onPrimary={addScanned} onDismiss={() => setScanResult(null)} /></div> : null}
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-auto">
            {!lines.length ? (
              <div className="mx-auto max-w-md px-6 py-14 text-center">
                <h2 className="font-display text-xl font-bold text-[var(--ink)]">Start with the customer or the first item</h2>
                <p className="mt-2 text-sm text-[var(--ink-3)]">Type a code or name above, or scan a showroom label. A walk-in needs only a name and mobile. Anything quick-added is listed in the Follow-up queue, so the quote never waits on master data.</p>
                <div className="mt-5 flex justify-center gap-2">
                  {!customer ? <button type="button" onClick={() => setDialog('customer')} className={primaryButton}>Add customer</button> : null}
                  <button type="button" onClick={() => searchRef.current?.focus()} className={secondaryButton}>Add first item</button>
                </div>
              </div>
            ) : (
              <table className="w-full min-w-[44rem] table-fixed border-separate border-spacing-0 text-sm">
                <thead className="sticky top-0 z-10 bg-[var(--surface)]">
                  <tr className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-[var(--ink-4)]">
                    <th className="w-[3.25rem] border-b border-[var(--line)] px-3 py-2" />
                    <th className="border-b border-[var(--line)] px-2 py-2 text-left">Item</th>
                    <th className="w-[7.5rem] border-b border-[var(--line)] px-2 py-2 text-right">{quoteType === 'tile' ? 'Area / qty' : 'Qty'}</th>
                    <th className="w-[8.5rem] border-b border-[var(--line)] px-2 py-2 text-right" title="MRP from Product Master, then NRP as % off MRP or a set rupee price">MRP → NRP</th>
                    <th className="w-[6.5rem] border-b border-[var(--line)] px-2 py-2 text-right" title="Rate after special price; % is the saving on MRP after every discount">Rate · off MRP</th>
                    <th className="w-[6.5rem] border-b border-[var(--line)] px-2 py-2 text-right">Amount</th>
                    <th className="w-[4rem] border-b border-[var(--line)] px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {visibleAreas.map((area) => {
                    const areaLines = lines.filter((line) => line.area === area);
                    const info = areaTotals.get(area) || { count: 0, value: 0, warn: false };
                    return (
                      <Fragment key={area}>
                        <tr className="sticky top-[33px] z-[5]">
                          <td colSpan={7} className="border-y border-[var(--line)] bg-[var(--bg-soft)] px-3 py-1.5">
                            <div className="flex items-center gap-3">
                              {canEditLines ? <AreaName name={area} onRename={(value) => renameArea(area, value)} /> : <b className="text-[12.5px]">{area}</b>}
                              <span className="font-mono text-[11px] text-[var(--ink-4)]">{info.count} item{info.count === 1 ? '' : 's'}</span>
                              {canEditLines ? (area === targetArea
                                ? <span className="rounded-full bg-[var(--brand-600)] px-2 py-0.5 text-[10.5px] font-semibold text-white">new items go here</span>
                                : <button type="button" onClick={() => { setTargetArea(area); searchRef.current?.focus(); }} className="rounded-full border border-[var(--line-strong)] px-2 py-0.5 text-[10.5px] font-semibold text-[var(--ink-3)] hover:border-[var(--brand-400)] hover:text-[var(--brand-700)]">Add items here</button>) : null}
                              <span className="ml-auto text-[12.5px] font-semibold tabular-nums">{money(info.value)}</span>
                            </div>
                          </td>
                        </tr>
                        {areaLines.map((line) => (
                          <LineRow key={line._k} onFocusRoom={() => { if (!line._removed && line.area !== targetArea) setTargetArea(line.area); }} total={itemTotals.get(String(line.productId || ''))} line={line} row={rowByKey.get(line._k)} issues={issuesByKey.get(line._k) || []} editable={canEditLines && !line._removed} quoteType={quoteType}
                            change={revisionChanges.find((item) => item.line._k === line._k)} ordered={orderedQtyByKey.get(String(line.lineKey || '')) || 0} brands={brands}
                            otherAreas={areas.filter((value) => value !== line.area)} alsoIn={activeLines.filter((row) => row.productId === line.productId && row._k !== line._k).map((row) => row.area)}
                            expanded={expanded === line._k} onToggle={() => setExpanded((current) => (current === line._k ? null : line._k))}
                            onChange={(patch) => updateLine(line._k, patch)} onRemove={() => removeLine(line)} onUndo={() => undoRemove(line)}
                            onCopy={(target) => copyToArea(line, target)} taxMode={taxMode} />
                        ))}
                        {!areaLines.length ? <tr><td colSpan={7} className="px-14 py-3 text-xs text-[var(--ink-4)]">Nothing here yet.</td></tr> : null}
                        {canEditLines ? <tr><td colSpan={7} className="px-14 pb-3 pt-1"><button type="button" onClick={() => { setTargetArea(area); searchRef.current?.focus(); }} className="text-xs font-semibold text-[var(--ink-4)] hover:text-[var(--brand-700)]">+ Add item to {area}</button></td></tr> : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* Side panel */}
        <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          <Card title="Totals">
            <Row label="MRP value" value={money(totals.mrp)} />
            <Row label="Line discounts" value={`− ${money(Math.max(0, totals.mrp - totals.lineNet))}`} />
            {totals.quoteDiscount > 0 ? <Row label={`Quote discount ${discountType === 'PERCENT' ? `${discountValue}%` : ''}`} value={`− ${money(totals.quoteDiscount)}`} /> : null}
            <Row label={taxMode === 'gst' ? 'Taxable value' : 'Value'} value={money(totals.taxable)} />
            {taxMode === 'gst' ? <Row label={gstOnTop ? 'GST added' : 'GST (included)'} value={money(totals.gst)} /> : null}
            <div className="mt-2 flex items-baseline justify-between border-t border-[var(--line)] pt-2"><span className="text-sm font-semibold">Total</span><b className="font-display text-2xl tabular-nums">{money(totals.total)}</b></div>
            {totals.mrp > 0 ? <p className="mt-1 text-right text-xs text-[var(--ink-4)]">{pct((1 - totals.taxable / Math.max(1, totals.mrp)) * 100)} below MRP overall</p> : null}
            {mode === 'revising' ? <Row label={`Change from ${quote.quoteNumber}`} value={`${totals.total >= Number(quote.commercialTotal || 0) ? '+' : '−'} ${money(Math.abs(totals.total - Number(quote.commercialTotal || 0)))}`} /> : null}
          </Card>

          {blocking.length || discountIssue ? (
            <Card title={`To fix before confirming · ${blocking.length + (discountIssue ? 1 : 0)}`}>
              <div className="space-y-1">
                {blocking.slice(0, 12).map(({ line, issue }, index) => (
                  <button key={`${line._k}-${issue.key}-${index}`} type="button" onClick={() => { setAreaFilter('all'); setFocusKey(line._k); }} className="flex w-full flex-col rounded-md bg-[var(--warning-bg)] px-2.5 py-1.5 text-left text-xs text-[var(--warning)] hover:brightness-95">
                    <b>{issue.message}</b><span className="truncate">{line.name} · {line.area}</span>
                  </button>
                ))}
                {discountIssue ? <p className="rounded-md bg-[var(--warning-bg)] px-2.5 py-1.5 text-xs font-semibold text-[var(--warning)]">{discountIssue}</p> : null}
                {blocking.some(({ issue }) => issue.key === 'mrp') ? <Link href="/dashboard/master-data/pricing-readiness?tab=missing" className="block pt-1 text-xs font-semibold text-[var(--brand-700)] underline">Add missing MRP in MRP Control Desk</Link> : null}
              </div>
            </Card>
          ) : null}
          {floorWarnings.length ? <Card title="Below floor price"><p className="text-xs text-[var(--ink-3)]">{floorWarnings.length} line{floorWarnings.length === 1 ? ' is' : 's are'} below the owner floor. Saving sends the quote for owner approval.</p></Card> : null}

          {revisionChanges.length || mode === 'revising' ? (
            <Card title={`This revision · ${revisionChanges.length} change${revisionChanges.length === 1 ? '' : 's'}`}>
              <div className="space-y-1.5">
                {revisionChanges.map(({ line, kind, detail }) => (
                  <div key={line._k} className="flex gap-2 text-xs">
                    <b className={cn('w-3 shrink-0', kind === 'added' ? 'text-[var(--success)]' : kind === 'removed' ? 'text-[var(--danger)]' : 'text-[var(--info)]')}>{kind === 'added' ? '+' : kind === 'removed' ? '−' : '~'}</b>
                    <span><b className="text-[var(--ink)]">{line.name}</b> · {line.area}{detail.length ? <span className="block text-[var(--ink-4)]">{detail.join(', ')}</span> : null}</span>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}

          {multiRoomItems.length ? (
            <Card title={`Same item in more than one room · ${multiRoomItems.length}`}>
              <div className="space-y-2 text-xs">
                {multiRoomItems.map(([key, entry]) => (
                  <div key={key}>
                    <div className="flex justify-between gap-2"><b className="truncate text-[var(--ink)]">{entry.name}</b><b className="shrink-0 tabular-nums">{Number(entry.qty.toFixed(2))} {entry.unit}</b></div>
                    <p className="text-[var(--ink-4)]">{entry.rooms.map((room) => `${room.area} ${Number(room.qty.toFixed(2))}`).join(' · ')}</p>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-[var(--ink-4)]">Each room keeps its own line and price. The total is what is ordered and dispatched.</p>
            </Card>
          ) : null}

          <Card title="People">
            <Row label="Prepared by" value={preparedBy || (isNew ? 'You' : '—')} />
            {meta.preparedAt ? <p className="-mt-0.5 mb-1 text-right text-[11px] text-[var(--ink-4)]">{shortDate(meta.preparedAt)}</p> : null}
            <Row label="Confirmed by" value={meta.confirmedByName || (persistedConfirmed ? (quote?.owner?.name || '—') : 'Not yet')} />
            {meta.confirmedAt ? <p className="-mt-0.5 mb-1 text-right text-[11px] text-[var(--ink-4)]">{shortDate(meta.confirmedAt)}</p> : null}
            {isNew ? (
              <label className="mt-1 flex items-center justify-between gap-2 text-xs text-[var(--ink-3)]">Sales person
                <select value={ownerId} onChange={(event) => setOwnerId(event.target.value)} className="h-8 max-w-[11rem] rounded-md border border-[var(--line)] bg-[var(--surface)] px-2 text-xs font-semibold">{assignees.map((user: any) => <option key={user.id} value={user.id}>{user.name}</option>)}</select>
              </label>
            ) : <Row label="Sales person" value={owner?.name || '—'} />}
            <p className="mt-1 text-[11px] text-[var(--ink-4)]">Prepared and confirmed names print on the PDF.</p>
          </Card>

          {!isNew && (Array.isArray(quote.versions) && quote.versions.length) ? (
            <Card title="Revisions">
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center gap-2"><span className="rounded bg-[var(--ink)] px-1.5 py-0.5 font-mono text-[10.5px] text-[var(--surface)]">{quote.quoteNumber}</span><span className="flex-1 text-[var(--ink-4)]">current</span><b className="tabular-nums">{money(Number(quote.commercialTotal || 0))}</b></div>
                {quote.versions.map((version: any) => (
                  <div key={`${version.version}-${version.quoteNumber}`} className="flex items-center gap-2"><span className="rounded bg-[var(--bg-soft)] px-1.5 py-0.5 font-mono text-[10.5px] text-[var(--ink-3)]">{version.quoteNumber}</span><span className="flex-1 text-[var(--ink-4)]">{shortDate(version.replacedAt)}{version.replacedByName ? ` · ${version.replacedByName}` : ''}</span><b className="tabular-nums">{money(version.total)}</b></div>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-[var(--ink-4)]">One quote and one live PDF. Earlier revisions are listed here as a log only.</p>
            </Card>
          ) : null}

          <Card title="Quote settings">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <label className="flex flex-col gap-1 text-[var(--ink-4)]">Quote discount
                <div className="flex gap-1">
                  <select disabled={!canEditLines} value={discountType} onChange={(event) => setDiscountType(event.target.value as DiscountMode)} className="h-8 w-14 rounded-md border border-[var(--line)] bg-[var(--surface)] px-1 text-xs"><option value="PERCENT">%</option><option value="FIXED_AMOUNT">₹</option></select>
                  <input disabled={!canEditLines} type="number" min={0} value={discountValue} onChange={(event) => setDiscountValue(event.target.value)} placeholder="0" className={cn('h-8 min-w-0 flex-1 rounded-md border bg-[var(--surface)] px-2 text-right text-xs tabular-nums', discountIssue ? 'border-[var(--warning)]' : 'border-[var(--line)]')} />
                </div>
              </label>
              <label className="flex flex-col gap-1 text-[var(--ink-4)]">Tax
                <select disabled={!canEditLines} value={taxMode} onChange={(event) => setTaxMode(event.target.value as TaxMode)} className="h-8 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2 text-xs"><option value="gst">GST quotation</option><option value="non_gst">Without GST</option></select>
              </label>
              <label className="flex flex-col gap-1 text-[var(--ink-4)]">Valid until<input type="date" disabled={mode === 'closed'} value={validUntil} onChange={(event) => setValidUntil(event.target.value)} className="h-8 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2 text-xs" /></label>
              <label className="flex flex-col gap-1 text-[var(--ink-4)]">PDF type
                <select disabled={mode === 'closed'} value={displayMode} onChange={(event) => setDisplayMode(event.target.value as 'priced' | 'selection')} className="h-8 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2 text-xs"><option value="priced">Show prices</option><option value="selection">Selection only</option></select>
              </label>
              <label className="col-span-2 flex flex-col gap-1 text-[var(--ink-4)]">Project / site<input disabled={mode === 'closed'} value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="e.g. Patel Residence" className="h-8 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2 text-xs" /></label>
              <label className="col-span-2 flex flex-col gap-1 text-[var(--ink-4)]">Remarks on PDF<input disabled={mode === 'closed'} value={remarks} onChange={(event) => setRemarks(event.target.value)} className="h-8 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2 text-xs" /></label>
            </div>
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer font-semibold text-[var(--ink-3)]">Terms, bank details and cover</summary>
              <div className="mt-2 space-y-2">
                <label className="flex flex-col gap-1 text-[var(--ink-4)]">Terms<textarea disabled={mode === 'closed'} value={terms} onChange={(event) => setTerms(event.target.value)} placeholder={settings.defaultTerms || 'Default terms from Settings'} className="min-h-20 rounded-md border border-[var(--line)] bg-[var(--surface)] p-2 text-xs" /></label>
                <label className="flex flex-col gap-1 text-[var(--ink-4)]">Bank details<textarea disabled={mode === 'closed'} value={bankDetails} onChange={(event) => setBankDetails(event.target.value)} placeholder={settings.bankDetails || 'Default bank details from Settings'} className="min-h-16 rounded-md border border-[var(--line)] bg-[var(--surface)] p-2 text-xs" /></label>
                {displayMode === 'selection' ? (
                  <>
                    <label className="flex flex-col gap-1 text-[var(--ink-4)]">Cover tagline<input value={tagline} onChange={(event) => setTagline(event.target.value)} placeholder={settings.documentTagline || ''} className="h-8 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2 text-xs" /></label>
                    <div className="flex items-center gap-2">
                      <div className="grid h-14 w-20 place-items-center overflow-hidden rounded-md border border-[var(--line)] bg-[var(--bg-soft)]">{coverImage ? <img src={coverImage} alt="Cover" className="h-full w-full object-cover" /> : <FileImage className="h-5 w-5 text-[var(--ink-4)]" />}</div>
                      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[var(--line-strong)] px-2.5 py-1.5 font-semibold"><ImagePlus className="h-3.5 w-3.5" />{uploadingCover ? 'Uploading…' : coverImage ? 'Replace cover' : 'Upload cover'}<input type="file" accept="image/*" className="hidden" onChange={(event) => onCoverFile(event.target.files?.[0] || null)} /></label>
                      {coverImage ? <button type="button" onClick={() => setCoverImage('')} className="text-[var(--danger)]">Remove</button> : null}
                    </div>
                  </>
                ) : null}
                <p className="text-[11px] text-[var(--ink-4)]">Footer brand logos follow the {quoteType === 'tile' ? 'Tile & Chemical' : 'CP & Sanitary'} policy in Settings ({quoteFamilyBrandIds(settings, brands, quoteType).length} logos) and are locked on the quote when it is saved.</p>
              </div>
            </details>
          </Card>

          {!isNew && mode !== 'closed' ? (
            <div className="flex flex-wrap gap-2 px-1 pb-2 text-xs">
              {pdfReady && quote.status !== 'sent' && !approvalPending ? <button type="button" onClick={markSent} className="inline-flex items-center gap-1 font-semibold text-[var(--ink-3)] hover:text-[var(--ink)]"><Send className="h-3.5 w-3.5" />Mark as sent</button> : null}
              <button type="button" onClick={() => setDialog('cancel')} className="font-semibold text-[var(--danger)] hover:underline">Cancel quote</button>
            </div>
          ) : null}
        </aside>
      </div>

      {/* Mobile action bar */}
      <div className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-2 border-t border-[var(--line)] bg-[var(--surface)]/95 p-3 backdrop-blur xl:hidden">
        <div className="min-w-0 flex-1"><p className="text-[11px] text-[var(--ink-4)]">Total</p><b className="whitespace-nowrap font-display text-base tabular-nums sm:text-lg">{money(totals.total)}</b></div>
        {/* Narrow phones: PDF and Share become square icon buttons and the cart icon drops, so the total stays readable. */}
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2 [&_.mp-bar-label]:sr-only [&>button:has(.mp-bar-label)]:w-10 [&>button:has(.mp-bar-label)]:px-0 [&>button]:px-3 [&_.lucide-shopping-cart]:hidden sm:[&_.mp-bar-label]:not-sr-only sm:[&>button:has(.mp-bar-label)]:w-auto sm:[&>button]:px-4 sm:[&_.lucide-shopping-cart]:inline">{phoneBarActions}</div>
      </div>

      {/* Dialogs */}
      <CustomerPicker open={dialog === 'customer'} onClose={() => setDialog('')} onPick={(picked, note) => { setCustomer(picked); setDialog(''); if (note) notify(note); window.setTimeout(() => searchRef.current?.focus(), 50); }} />
      <ArchitectPicker open={dialog === 'architect'} onClose={() => setDialog('')} architects={architects} currentId={architect?.id} onAdded={() => setup.refetch()} onPick={(picked) => { setArchitect(picked); setDialog(''); }} />
      <QuickSkuDialog open={dialog === 'sku'} onClose={() => setDialog('')} initialName={search.trim()} family={quoteType} onCreated={(product) => { setDialog(''); setSearch(''); if (addProduct(product)) notify(`${product.sku} created in Product Master and added to ${targetArea}. It is listed in the Follow-up queue.`); }} />
      {quote ? <DocumentsDialog open={dialog === 'documents'} onClose={() => setDialog('')} quote={quote} pdfReady={pdfReady} hasArchitect={Boolean(architect?.id || quote.architectId)} /> : null}
      {quote ? <OrderDrawer open={dialog === 'order'} onClose={() => setDialog('')} quote={quote} fulfillment={fulfillment} onDone={async (message) => { await Promise.all([quoteQuery.refetch(), fulfillmentQuery.refetch()]); loadedFor.current = ''; notify(message); }} /> : null}
      {quote ? <CancelDialog open={dialog === 'cancel'} onClose={() => setDialog('')} onConfirm={(reason) => run('CancelQuote', async () => { await cancelQuote({ variables: { id: quote.id, reason } }); setDialog(''); loadedFor.current = ''; await quoteQuery.refetch(); notify(`${quote.quoteNumber} cancelled.`); })} /> : null}

      {toast ? <div role="status" className="fixed bottom-20 left-1/2 z-[80] max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-xl bg-[var(--ink)] px-4 py-2.5 text-sm font-medium text-[var(--surface)] shadow-lg-soft xl:bottom-6">{toast}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

function QuoteTypeChip({ quoteType, editable, onChange }: { quoteType: QuoteType; editable: boolean; onChange: (value: QuoteType) => void }) {
  if (!editable) return <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--line)] px-3 text-xs text-[var(--ink-3)]">{quoteType === 'tile' ? <Layers3 className="h-3.5 w-3.5" /> : <Bath className="h-3.5 w-3.5" />}{quoteType === 'tile' ? 'Tile & Chemical' : 'CP & Sanitary'}</span>;
  return (
    <div className="inline-flex h-8 rounded-full border border-[var(--line)] p-0.5 text-xs" role="radiogroup" aria-label="Quote type">
      {(['cp_sanitary', 'tile'] as QuoteType[]).map((value) => (
        <button key={value} type="button" role="radio" aria-checked={quoteType === value} onClick={() => onChange(value)} className={cn('rounded-full px-3 font-semibold', quoteType === value ? 'bg-[var(--ink)] text-[var(--surface)]' : 'text-[var(--ink-3)]')}>{value === 'tile' ? 'Tile & Chemical' : 'CP & Sanitary'}</button>
      ))}
    </div>
  );
}

function Banner({ tone, title, children }: { tone: 'info' | 'warning' | 'danger' | 'violet'; title: string; children?: ReactNode }) {
  const tones = {
    info: 'border-[var(--info)]/25 bg-[var(--info-bg)] text-[var(--info)]',
    warning: 'border-[var(--warning)]/30 bg-[var(--warning-bg)] text-[var(--warning)]',
    danger: 'border-[var(--danger)]/30 bg-[var(--danger-bg)] text-[var(--danger)]',
    violet: 'border-violet-300/40 bg-violet-50 text-violet-800 dark:bg-violet-500/10 dark:text-violet-300',
  };
  return <div className={cn('rounded-r4 border px-4 py-2 text-sm', tones[tone])}><b className="font-semibold">{title}</b> {children}</div>;
}

function AreaButton({ active, name, count, value, warn, onClick }: { active: boolean; name: string; count: number; value: number; warn?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={cn('flex min-w-[9rem] shrink-0 flex-col rounded-md px-2.5 py-2 text-left xl:min-w-0', active ? 'bg-[var(--surface)] shadow-[inset_3px_0_0_var(--brand-600),0_1px_2px_rgba(0,0,0,.06)]' : 'hover:bg-[var(--bg-soft)]')}>
      <span className="flex items-center justify-between gap-2 text-[13px] font-semibold text-[var(--ink)]"><span className="truncate">{name}{warn ? <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[var(--warning)] align-middle" title="Needs attention" /> : null}</span><span className="font-mono text-[11px] font-normal text-[var(--ink-4)]">{count}</span></span>
      <span className="text-[11.5px] tabular-nums text-[var(--ink-4)]">{money(value)}</span>
    </button>
  );
}

function AreaName({ name, onRename }: { name: string; onRename: (value: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  useEffect(() => setValue(name), [name]);
  if (!editing) return <button type="button" onClick={() => setEditing(true)} title="Rename area" className="text-[12.5px] font-bold text-[var(--ink)] hover:underline">{name}</button>;
  return <input autoFocus list="mp-area-list" value={value} onChange={(event) => setValue(event.target.value)} onBlur={() => { setEditing(false); onRename(value); }} onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); if (event.key === 'Escape') { setValue(name); setEditing(false); } }} className="h-7 w-56 rounded border border-[var(--line-strong)] bg-[var(--surface)] px-2 text-xs font-semibold" aria-label="Area name" />;
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return <section className="rounded-r4 border border-[var(--line)] bg-[var(--surface)] px-3 py-2.5"><h3 className="pb-1.5 text-[10.5px] font-bold uppercase tracking-[0.1em] text-[var(--ink-4)]">{title}</h3>{children}</section>;
}
function Row({ label, value }: { label: string; value: ReactNode }) {
  return <div className="flex justify-between gap-3 py-0.5 text-[13px] text-[var(--ink-3)]"><span>{label}</span><b className="text-right font-semibold tabular-nums text-[var(--ink)]">{value}</b></div>;
}

const numberCell = 'h-8 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-2 text-right text-[13px] tabular-nums outline-none hover:border-[var(--line-strong)] focus:border-[var(--brand-500)] focus:ring-2 focus:ring-[var(--ring)] disabled:bg-[var(--bg-soft)] disabled:text-[var(--ink-4)]';

function LineRow({ line, row, issues, editable, quoteType, change, ordered, brands, otherAreas, alsoIn, expanded, onToggle, onChange, onRemove, onUndo, onCopy, taxMode, onFocusRoom, total }: {
  onFocusRoom: () => void; total?: { qty: number; unit: string; rooms: Array<{ area: string; qty: number }> };
  line: Line; row: any; issues: Array<{ key: string; message: string; blocking: boolean }>; editable: boolean; quoteType: QuoteType;
  change?: { kind: 'added' | 'changed' | 'removed'; detail: string[] }; ordered: number; brands: any[]; otherAreas: string[]; alsoIn: string[];
  expanded: boolean; onToggle: () => void; onChange: (patch: Record<string, any>) => void; onRemove: () => void; onUndo: () => void; onCopy: (area: string) => void; taxMode: TaxMode;
}) {
  const tile = isTileLine(line);
  const unit = tile ? tilePriceUom(line.pricingUom) : '';
  const tileArea = tile && unit !== 'PC';
  const coverage = tile ? tilePricingCoverage(line.coveragePerPack, unit) : 0;
  const blockingKeys = new Set(issues.filter((issue) => issue.blocking).map((issue) => issue.key));
  const lockedByOrder = ordered > 0;
  const canEdit = editable;
  const brandCode = String(brands.find((brand: any) => String(brand.name || '').trim().toLowerCase() === String(line.brand || '').trim().toLowerCase())?.code || '');
  const stripe = line._removed ? 'shadow-[inset_3px_0_0_var(--danger)]' : change?.kind === 'added' ? 'shadow-[inset_3px_0_0_var(--success)]' : change?.kind === 'changed' ? 'shadow-[inset_3px_0_0_var(--info)]' : blockingKeys.size ? 'shadow-[inset_3px_0_0_var(--warning)]' : '';
  const qty = draftNumber(line.qty ?? line.quantity);
  const mrpUnit = row?.mrpUnit || '';
  return (
    <>
      <tr id={`line-${line._k}`} onFocusCapture={onFocusRoom} className={cn('group bg-[var(--surface)] hover:bg-[var(--surface-2)]', line._removed && 'opacity-60')}>
        <td className={cn('border-b border-[var(--line)] px-3 py-1.5 align-middle', stripe)}>
          <ProductImageFrame src={productImage(line.media) || line.quoteImage || '/catalogue-art/faucet.svg'} alt="" className="h-10 w-10 rounded-md" imageClassName="p-0.5" />
        </td>
        <td className="max-w-0 border-b border-[var(--line)] px-2 py-1.5 align-middle">
          <p className={cn('truncate font-semibold text-[var(--ink)]', line._removed && 'line-through')} title={line.name}>{line.name}</p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-[var(--ink-4)]">
            <span className="font-mono">{line.internalCode || line.sku}</span>
            {brandCode || line.brand ? <span>{brandCode || line.brand}</span> : null}
            {tile && Number(line.coveragePerPack || 0) > 0 ? <span className="rounded bg-[var(--bg-soft)] px-1.5 text-[10.5px] font-semibold text-[var(--ink-3)]">1 {String(line.inventoryUom || 'box').toLowerCase()} = {Number(line.coveragePerPack).toFixed(2)} sqft</span> : null}
            {alsoIn.length && total ? <span className="rounded bg-[var(--info-bg)] px-1.5 text-[10.5px] font-semibold text-[var(--info)]" title={total.rooms.map((room) => `${room.area}: ${room.qty} ${total.unit}`).join('\n')}>also in {Array.from(new Set(alsoIn)).join(', ')} · {Number(total.qty.toFixed(2))} {total.unit} in total</span> : null}
            {lockedByOrder ? <span className="rounded bg-violet-100 px-1.5 text-[10.5px] font-semibold text-violet-800 dark:bg-violet-500/15 dark:text-violet-300">{ordered} ordered</span> : null}
            {line._removed ? <span className="rounded bg-[var(--danger-bg)] px-1.5 text-[10.5px] font-semibold text-[var(--danger)]">removed in this revision</span>
              : change?.kind === 'added' ? <span className="rounded bg-[var(--success-bg)] px-1.5 text-[10.5px] font-semibold text-[var(--success)]">added</span>
                : change?.kind === 'changed' ? <span className="rounded bg-[var(--info-bg)] px-1.5 text-[10.5px] font-semibold text-[var(--info)]" title={change.detail.join(', ')}>changed: {change.detail.join(', ')}</span> : null}
            {issues.map((issue) => <span key={issue.key} className={cn('rounded px-1.5 text-[10.5px] font-semibold', issue.blocking ? 'bg-[var(--warning-bg)] text-[var(--warning)]' : 'bg-[var(--bg-soft)] text-[var(--ink-3)]')}>{issue.message}</span>)}
          </div>
        </td>
        <td className="border-b border-[var(--line)] px-2 py-1.5 align-middle">
          {tile ? (
            unit === 'PC' ? (
              <div><input data-primary aria-label={`Pieces for ${line.name}`} type="number" min={1} step={1} disabled={!canEdit} value={draftNumber(line.requestedPieces) || ''} placeholder="pieces" onChange={(event) => onChange({ requestedPieces: event.target.value === '' ? '' : Number(event.target.value) })} className={cn(numberCell, blockingKeys.has('qty') && 'border-[var(--warning)] bg-[var(--warning-bg)]')} />
                <p className="mt-0.5 text-right text-[11px] text-[var(--ink-4)]">{qty} {String(line.inventoryUom || '').toLowerCase()} · {qty * Number(line.piecesPerPack || 1)} pc</p></div>
            ) : coverage > 0 ? (
              <div><input data-primary aria-label={`Area in ${unit} for ${line.name}`} type="number" min={0} disabled={!canEdit} value={draftNumber(line.requestedArea) || ''} placeholder={unit.toLowerCase()} onChange={(event) => onChange({ requestedArea: event.target.value === '' ? '' : Number(event.target.value) })} className={cn(numberCell, blockingKeys.has('qty') && 'border-[var(--warning)] bg-[var(--warning-bg)]')} />
                <p className="mt-0.5 text-right text-[11px] text-[var(--ink-4)]">{qty ? `${qty} ${String(line.inventoryUom || 'box').toLowerCase()} · covers ${(qty * coverage).toFixed(unit === 'SQM' ? 3 : 2)} ${unit.toLowerCase()}` : `boxes follow the ${unit.toLowerCase()}`}</p></div>
            ) : <p className="text-right text-[11px] font-semibold text-[var(--warning)]">Add box coverage in Tile Master</p>
          ) : (
            <div><input data-primary aria-label={`Quantity for ${line.name}`} type="number" min={Math.max(1, ordered)} step={1} disabled={!canEdit} value={qty || ''} placeholder="qty" onChange={(event) => onChange({ qty: event.target.value === '' ? '' : Number(event.target.value) })} className={cn(numberCell, blockingKeys.has('qty') && 'border-[var(--warning)] bg-[var(--warning-bg)]')} />
              <p className="mt-0.5 text-right text-[11px] text-[var(--ink-4)]">{String(line.inventoryUom || line.unit || 'pc').toLowerCase()}</p></div>
          )}
        </td>
        <td className="border-b border-[var(--line)] px-2 py-1.5 align-middle">
          {row?.mrpMissing ? <div className="text-right"><Link href={`/dashboard/master-data/pricing-readiness?tab=missing&search=${encodeURIComponent(line.sku || '')}`} className="inline-block rounded-md bg-[var(--warning-bg)] px-2 py-1 text-xs font-semibold text-[var(--warning)]">Add MRP</Link></div> : (
            <>
              <p className="mb-0.5 text-right text-[11px] tabular-nums text-[var(--ink-4)]">MRP <b className="font-semibold text-[var(--ink-2)]">{money(Number(row?.mrpInclusive || line.mrpInclusive || 0))}</b> / {mrpUnit.toLowerCase()}</p>
              <div className="flex gap-1">
                <input aria-label={`NRP for ${line.name}`} type="number" min={0} step="0.01" disabled={!canEdit} value={line.nrpInput === '' || line.nrpInput == null || Number(line.nrpInput) === 0 ? '' : line.nrpInput}
                  placeholder={line.nrpMode === 'FIXED_NRP' ? 'NRP ₹' : '% off'} onChange={(event) => onChange({ nrpInput: event.target.value, pricingVersion: 'unified_retail_v1' })} className={cn(numberCell, (blockingKeys.has('nrp') || blockingKeys.has('nrpInput')) && 'border-[var(--warning)] bg-[var(--warning-bg)]')} />
                <button type="button" disabled={!canEdit} title={line.nrpMode === 'FIXED_NRP' ? 'Entering NRP in rupees. Click to enter % off MRP.' : 'Entering % off MRP. Click to enter NRP in rupees.'} onClick={() => onChange({ nrpMode: line.nrpMode === 'FIXED_NRP' ? 'PERCENT_OFF_MRP' : 'FIXED_NRP', nrpInput: '', pricingVersion: 'unified_retail_v1' })}
                  className="h-8 w-8 shrink-0 rounded-md border border-[var(--line)] text-xs font-bold text-[var(--ink-3)] hover:bg-[var(--bg-soft)] disabled:opacity-50">{line.nrpMode === 'FIXED_NRP' ? '₹' : '%'}</button>
              </div>
            </>
          )}
        </td>
        <td className="border-b border-[var(--line)] px-2 py-1.5 text-right align-middle tabular-nums">
          {row?.mrpMissing ? '—' : <><b className="font-semibold">{money(Number(row?.specialRateInclusive || 0))}</b><p className="text-[11px] text-[var(--ink-4)]">{(line.specialMode || 'NONE') !== 'NONE' ? <span className="font-semibold text-[var(--info)]">special · </span> : null}{qty ? `${pct(Number(row?.discountOnMrp || 0))} off` : `/ ${mrpUnit.toLowerCase()}`}</p></>}
        </td>
        <td className="border-b border-[var(--line)] px-2 py-1.5 text-right align-middle font-semibold tabular-nums">{row?.mrpMissing || line._removed ? '—' : money(Number(row?.grossBeforeQuoteDiscount || 0))}</td>
        <td className="border-b border-[var(--line)] px-2 py-1.5 text-right align-middle">
          {line._removed ? <button type="button" onClick={onUndo} className="rounded-md border border-[var(--line-strong)] px-2 py-1 text-xs font-semibold">Undo</button> : (
            <div className="flex justify-end gap-0.5">
              <button type="button" onClick={onToggle} aria-expanded={expanded} title="Special rate, GST, add to another area" className="rounded-md p-1.5 text-[var(--ink-4)] hover:bg-[var(--bg-soft)] hover:text-[var(--ink)]">{expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button>
              {editable ? <button type="button" onClick={onRemove} title="Remove" className="rounded-md p-1.5 text-[var(--ink-4)] hover:bg-[var(--danger-bg)] hover:text-[var(--danger)] disabled:opacity-40"><Trash2 className="h-4 w-4" /></button> : null}
            </div>
          )}
        </td>
      </tr>
      {expanded && !line._removed ? (
        <tr className="bg-[var(--surface-2)]">
          <td className="border-b border-[var(--line)]" />
          <td colSpan={6} className="border-b border-[var(--line)] px-2 py-2.5">
            <div className="flex flex-wrap items-end gap-4 text-xs text-[var(--ink-3)]">
              <label className="flex flex-col gap-1">Special pricing
                <div className="flex gap-1">
                  <select disabled={!canEdit || row?.mrpMissing} value={line.specialMode || 'NONE'} onChange={(event) => onChange({ specialMode: event.target.value, specialInput: '', pricingVersion: 'unified_retail_v1' })} className="h-8 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2 text-xs"><option value="NONE">No special</option><option value="PERCENT_OFF_NRP">% off NRP</option><option value="FIXED_SPECIAL_RATE">Set rate ₹</option></select>
                  <input disabled={!canEdit || row?.mrpMissing || (line.specialMode || 'NONE') === 'NONE'} type="number" min={0} value={Number(line.specialInput || 0) ? line.specialInput : ''} placeholder={(line.specialMode || 'NONE') === 'NONE' ? '—' : line.specialMode === 'PERCENT_OFF_NRP' ? '%' : '₹'} onChange={(event) => onChange({ specialInput: event.target.value, pricingVersion: 'unified_retail_v1' })} className={cn(numberCell, 'w-24', blockingKeys.has('special') && 'border-[var(--warning)] bg-[var(--warning-bg)]')} />
                </div>
              </label>
              <label className="flex flex-col gap-1">GST %
                {taxMode === 'gst' ? <input disabled={!canEdit} type="number" min={0} max={100} value={line.taxRate ?? 18} onChange={(event) => onChange({ taxRate: event.target.value })} className={cn(numberCell, 'w-20')} /> : <span className="h-8 rounded-md bg-[var(--bg-soft)] px-2 leading-8">Without GST</span>}
              </label>
              {!row?.mrpMissing && qty ? <div className="flex flex-col gap-0.5 text-[11.5px]"><span>Final {money(Number(row?.finalUnitPayable || 0))} / {mrpUnit.toLowerCase()} after quote discount</span>{taxMode === 'gst' ? <span>Line incl. GST {money(Number(row?.total || 0))}</span> : null}</div> : null}
              {canEdit && otherAreas.length ? (
                <div className="flex flex-wrap items-center gap-1.5"><span className="flex items-center gap-1"><Copy className="h-3.5 w-3.5" />Also add to</span>
                  {otherAreas.slice(0, 8).map((area) => <button key={area} type="button" onClick={() => onCopy(area)} className="rounded-md border border-[var(--line-strong)] bg-[var(--surface)] px-2 py-1 font-semibold hover:border-[var(--brand-400)]">+ {area}</button>)}
                </div>
              ) : null}
              {canEdit && otherAreas.length ? (
                <label className="flex items-center gap-1.5">Move to
                  <select value="" onChange={(event) => { if (event.target.value) onChange({ area: event.target.value }); }} className="h-8 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2 text-xs"><option value="">Choose area</option>{otherAreas.map((area) => <option key={area}>{area}</option>)}</select>
                </label>
              ) : null}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function DocumentsDialog({ open, onClose, quote, pdfReady, hasArchitect }: { open: boolean; onClose: () => void; quote: any; pdfReady: boolean; hasArchitect: boolean }) {
  return (
    <Modal open={open} onClose={onClose} title="Documents" subtitle={`Always built from ${quote.quoteNumber}. A later revision replaces them; no old files are kept.`}>
      <div className="space-y-2">
        <DocLink disabled={!pdfReady} href={`/api/pdf/quote/${quote.id}?download=1`} icon={<Download className="h-4 w-4" />} title="Quotation PDF" detail={pdfReady ? 'Prices, discount on MRP per item, prepared and confirmed by.' : 'Confirm the quote to enable the PDF.'} />
        <DocLink disabled={!pdfReady} href={`/api/pdf/quote/${quote.id}`} newTab icon={<Printer className="h-4 w-4" />} title="Print" detail="Opens the PDF in a new tab." />
        <DocLink disabled={!hasArchitect} href={`/api/pdf/architect-bundle/${quote.id}?download=1`} icon={<FileImage className="h-4 w-4" />} title="Architect bundle" detail={hasArchitect ? 'Pictures of every item by area, no prices. Matches the current revision.' : 'Link an architect to the quote to enable this.'} />
      </div>
    </Modal>
  );
}
function DocLink({ href, icon, title, detail, disabled, newTab }: { href: string; icon: ReactNode; title: string; detail: string; disabled?: boolean; newTab?: boolean }) {
  const body = <><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--brand-50)] text-[var(--brand-700)]">{icon}</span><span><b className="block text-sm text-[var(--ink)]">{title}</b><span className="text-xs text-[var(--ink-4)]">{detail}</span></span></>;
  if (disabled) return <div className="flex items-center gap-3 rounded-lg border border-[var(--line)] p-3 opacity-55">{body}</div>;
  return <a href={href} target={newTab ? '_blank' : undefined} rel="noreferrer" className="flex items-center gap-3 rounded-lg border border-[var(--line)] p-3 hover:border-[var(--brand-400)] hover:bg-[var(--surface-2)]">{body}</a>;
}

function CancelDialog({ open, onClose, onConfirm }: { open: boolean; onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <Modal open={open} onClose={onClose} title="Cancel quote" subtitle="Converted orders can only be cancelled before dispatch, invoice or payment activity."
      footer={<><button type="button" onClick={onClose} className={secondaryButton}>Keep quote</button><button type="button" disabled={!reason.trim()} onClick={() => onConfirm(reason.trim())} className={cn(primaryButton, 'bg-[var(--danger)] hover:bg-[var(--danger)]')}>Cancel quote</button></>}>
      <Field label="Reason"><input value={reason} onChange={(event) => setReason(event.target.value)} className={inputClass} placeholder="Why is this quote cancelled?" /></Field>
    </Modal>
  );
}

function OrderDrawer({ open, onClose, quote, fulfillment, onDone }: { open: boolean; onClose: () => void; quote: any; fulfillment: any; onDone: (message: string) => Promise<void> }) {
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [paymentMode, setPaymentMode] = useState('cash');
  const [advance, setAdvance] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [promisedDate, setPromisedDate] = useState('');
  const [closeReason, setCloseReason] = useState('');
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<any>(null);
  const [createOrder, orderState] = useMutation(CREATE_ORDER);
  const [closeRemainder, closeState] = useMutation(CLOSE_REMAINDER);
  useEffect(() => {
    if (!open) return;
    setError(''); setResult(null);
    const next: Record<string, string> = {};
    for (const line of fulfillment?.lines || []) next[line.id] = String(line.remaining || 0);
    setQuantities(next);
  }, [fulfillment?.lines, open]);
  const lines = fulfillment?.lines || [];
  // Same item ordered for several rooms: show the combined quantity.
  const skuTotals = lines.reduce((map: Map<string, { order: number; rooms: number }>, line: any) => {
    const entry = map.get(line.sku) || { order: 0, rooms: 0 };
    entry.order += Number(quantities[line.id] || 0);
    entry.rooms += 1;
    return map.set(line.sku, entry);
  }, new Map<string, { order: number; rooms: number }>());
  const selected = lines.map((line: any) => ({ quoteLineId: line.id, quantity: Number(quantities[line.id] || 0) })).filter((line: any) => line.quantity > 0);
  const submit = async () => {
    setError('');
    const idempotencyKey = key || (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`);
    setKey(idempotencyKey);
    try {
      const order = (await createOrder({ variables: { input: { quoteId: quote.id, paymentMode, advanceAmount: Number(advance || 0), paymentTerms: paymentTerms || undefined, promisedDate: promisedDate || undefined, idempotencyKey, lines: JSON.stringify(selected), notes: 'Created from quote workspace' } } })).data?.createSalesOrderFromQuote;
      setResult(order);
      setKey('');
      await onDone(`Sales order ${order?.orderNumber} created from ${quote.quoteNumber}.`);
    } catch (err) { setError(errorText(err, 'CreateSalesOrderFromQuote')); }
  };
  return (
    <Modal open={open} onClose={onClose} width="max-w-2xl" title={(fulfillment?.orders || []).length ? 'Order remaining items' : 'Convert to sales order'} subtitle={`${quote.quoteNumber} · confirmed by ${quote.quoteMeta?.confirmedByName || quote.owner?.name || '—'}. Choose the quantities being ordered now; the rest stays on the quote.`}
      footer={<><button type="button" onClick={onClose} className={secondaryButton}>Close</button><button type="button" disabled={orderState.loading || !selected.length} onClick={submit} className={primaryButton}>{orderState.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}Create sales order</button></>}>
      <div className="space-y-4">
        {result ? <div className="rounded-lg bg-[var(--success-bg)] p-3 text-sm font-semibold text-[var(--success)]">Sales order {result.orderNumber} created. <a className="underline" href={result.documents?.salesOrderPdfUrl || `/api/pdf/order/${result.id}`} target="_blank" rel="noreferrer">Open its PDF</a></div> : null}
        {error ? <p role="alert" className="rounded-lg bg-[var(--warning-bg)] p-3 text-sm font-medium text-[var(--warning)]">{error}</p> : null}
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {lines.map((line: any) => (
            <label key={line.id} className="grid grid-cols-[1fr_6rem] items-center gap-3 rounded-lg border border-[var(--line)] px-3 py-2">
              <span className="min-w-0"><b className="block truncate text-sm text-[var(--ink)]">{line.name}</b><span className="text-xs text-[var(--ink-4)]">{line.area} · ordered {line.ordered} of {line.quantity} {String(line.unit || '').toLowerCase()} · {line.remaining} left</span>{(skuTotals.get(line.sku)?.rooms || 0) > 1 ? <span className="block text-[11px] font-semibold text-[var(--info)]">In {skuTotals.get(line.sku)!.rooms} rooms · {skuTotals.get(line.sku)!.order} {String(line.unit || '').toLowerCase()} ordering now in total</span> : null}</span>
              <input type="number" min={0} max={line.remaining} disabled={!line.remaining} value={quantities[line.id] ?? ''} onChange={(event) => setQuantities((current) => ({ ...current, [line.id]: event.target.value }))} aria-label={`Order quantity for ${line.name}`} className={numberCell} />
            </label>
          ))}
          {!lines.length ? <p className="text-sm text-[var(--ink-4)]">Nothing left to order on this quote.</p> : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Payment"><select value={paymentMode} onChange={(event) => setPaymentMode(event.target.value)} className={inputClass}><option value="cash">Cash</option><option value="credit">Credit</option></select></Field>
          {paymentMode === 'cash' ? <Field label="Advance / paid ₹"><input type="number" min={0} value={advance} onChange={(event) => setAdvance(event.target.value)} className={inputClass} placeholder="0" /></Field> : <div />}
          <Field label="Payment terms"><input value={paymentTerms} onChange={(event) => setPaymentTerms(event.target.value)} placeholder={paymentMode === 'credit' ? 'Net 30' : 'Cash on order'} className={inputClass} /></Field>
          <Field label="Promised dispatch"><input type="date" value={promisedDate} onChange={(event) => setPromisedDate(event.target.value)} className={inputClass} /></Field>
        </div>
        {(fulfillment?.orders || []).length ? (
          <div className="border-t border-[var(--line)] pt-3">
            <p className="text-xs font-bold uppercase tracking-wider text-[var(--ink-4)]">Orders from this quote</p>
            {fulfillment.orders.map((order: any) => <div key={order.id} className="mt-1 flex justify-between text-sm"><a className="font-semibold underline" href={`/api/pdf/order/${order.id}`} target="_blank" rel="noreferrer">{order.orderNumber}</a><span className="text-[var(--ink-4)]">{order.status}</span><b className="tabular-nums">{money(order.totalAmount)}</b></div>)}
            <div className="mt-3 flex gap-2">
              <input value={closeReason} onChange={(event) => setCloseReason(event.target.value)} placeholder="Reason to close what is left" className={cn(inputClass, 'h-9')} />
              <button type="button" disabled={closeState.loading || !closeReason.trim() || !lines.some((line: any) => Number(line.remaining || 0) > 0)} onClick={async () => { try { await closeRemainder({ variables: { quoteId: quote.id, reason: closeReason } }); setCloseReason(''); await onDone('Remaining quantities closed. Order history is kept.'); } catch (err) { setError(errorText(err, 'CloseQuoteRemainder')); } }} className={cn(secondaryButton, 'h-9 shrink-0')}>Close remainder</button>
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
