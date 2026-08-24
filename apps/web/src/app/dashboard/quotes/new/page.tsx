'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import { AnimatePresence, motion } from 'framer-motion';
import Link from 'next/link';
import { AlertTriangle, BadgeIndianRupee, Building2, Camera, Check, CheckCircle, Download, FileText, Image as ImageIcon, Percent, Plus, Save, Search, ShieldCheck, Trash2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ProductImageFrame } from '@/components/product-image-frame';
import { QueryErrorBanner } from '@/components/query-state';
import { SelectMenu, SelectMenuTrigger, SelectMenuContent, SelectMenuItem, SelectMenuValue } from '@/components/ui/select-menu';
import { describeApolloError } from '@/lib/apollo-errors';
import { PhysicalQrScanner } from '@/components/physical-qr-scanner';
import { ScanProductSelector } from '@/components/scan-product-selector';
import { allocateQuoteDiscount, retailLadder, type DiscountMode } from '@/lib/quote-pricing';

const GET_QUOTE_SETUP = gql`
  query GetQuoteSetup {
    customers { id name email mobile siteAddress city }
    architects(status: "active", take: 200)
    salesAssignees
    documentSettings { data }
    masterProductBrands(status: "active")
  }
`;

const SEARCH_PRODUCTS = gql`
  query SearchProducts($query: String!) { globalSearch(query: $query) { products } }
`;
const PRELOAD_PRODUCTS = gql`query QuotePreloadProducts($ids:[ID!]!){productsByIds(ids:$ids){id sku internalCode name category brand finish dimensions unit purchaseUom salesUom piecesPerPack coveragePerPack defaultMrpInclusive defaultNrpInclusive priceRateBasis priceUom mrpSource pricingEffectiveFrom media}}`;
const SCAN_LABEL = gql`mutation QuoteScanLabel($labelCode:String!,$input:InternalLabelScanInput){scanInternalLabel(labelCode:$labelCode,input:$input)}`;

const CREATE_QUOTE = gql`
  mutation CreateQuote($input: CreateQuoteInput!) { createQuote(input: $input) { id quoteNumber architectId architectName } }
`;

function money(value: number) {
  return `₹${Math.round(value || 0).toLocaleString('en-IN')}`;
}

function masterBrandCode(brands: any[], name: unknown) {
  const normalized = String(name || '').trim().toLowerCase();
  return String(brands.find((brand: any) => String(brand.name || '').trim().toLowerCase() === normalized)?.code || '').trim();
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
  const gallery = Array.isArray(media.gallery) ? media.gallery : [];
  return media.primaryUrl || media.primary || media.primaryImage || (typeof gallery[0] === 'string' ? gallery[0] : gallery[0]?.url) || '/catalogue-art/faucet.svg';
}

type TileRateBasis = 'AREA' | 'PIECE' | 'BOX';

function isTileLine(line: any) {
  return String(line.category || '').toLowerCase() === 'tiles';
}

function pricingBasis(line: any): TileRateBasis {
  const explicit = String(line.rateBasis || '').toUpperCase();
  if (explicit === 'AREA' || explicit === 'PIECE' || explicit === 'BOX') return explicit;
  const uom = String(line.pricingUom || line.salesUom || line.unit || '').toUpperCase();
  return ['SQFT', 'SQM', 'M2'].includes(uom) ? 'AREA' : uom === 'PC' ? 'PIECE' : 'BOX';
}

function mrpUom(line: any) {
  const basis = pricingBasis(line);
  if (basis === 'AREA') return String(line.pricingUom || line.salesUom || 'SQFT').toUpperCase();
  if (basis === 'PIECE') return 'PC';
  return String(line.inventoryUom || line.purchaseUom || line.unit || 'BOX').toUpperCase();
}

function areaPriced(line: any) {
  return pricingBasis(line) === 'AREA' && Number(line.coveragePerPack || 0) > 0;
}

function packsForArea(requestedArea: number, wastagePercent: number, coveragePerPack: number) {
  if (requestedArea <= 0 || coveragePerPack <= 0) return 1;
  return Math.max(1, Math.ceil((requestedArea * (1 + Math.max(0, wastagePercent) / 100)) / coveragePerPack));
}

function packsForPieces(requestedPieces: number, piecesPerPack: number) {
  if (requestedPieces <= 0 || piecesPerPack <= 0) return 1;
  return Math.max(1, Math.ceil(requestedPieces / piecesPerPack));
}

function TileQuantityEditor({ line, onChangeBasis, onChange }: { line: any; onChangeBasis: (basis: TileRateBasis) => void; onChange: (patch: any) => void }) {
  const basis = pricingBasis(line);
  const pieces = Math.max(1, Number(line.piecesPerPack || 1));
  const coverage = Number(line.coveragePerPack || 0);
  return <div className="mx-auto w-56 space-y-2.5">
    <div className="grid grid-cols-3 rounded-md border border-[#d4d4d8] bg-[#f4f4f5] p-0.5" aria-label={`Pricing basis for ${line.name}`}>
      {([['AREA', 'Area'], ['PIECE', 'Pieces'], ['BOX', 'Boxes']] as const).map(([value, label]) => <button key={value} type="button" disabled={value === 'AREA' && coverage <= 0} onClick={() => onChangeBasis(value)} className={`h-7 rounded text-[10px] font-semibold ${basis === value ? 'bg-white text-[#18181b] shadow-sm' : 'text-[#52525b] hover:text-[#18181b] disabled:cursor-not-allowed disabled:opacity-35'}`}>{label}</button>)}
    </div>
    {basis === 'AREA' ? <>
      <div className="grid grid-cols-[1fr_4rem] gap-2"><input aria-label={`Requested area for ${line.name}`} type="number" min={0} value={line.requestedArea || 0} onChange={(event) => onChange({ requestedArea: Number(event.target.value || 0) })} className="h-9 rounded-md border border-[#e4e4e7] bg-white px-2 text-right text-sm font-semibold"/><div className="grid h-9 place-items-center rounded-md bg-[#f4f4f5] text-xs font-semibold">{line.pricingUom}</div></div>
      <div className="flex items-center justify-between gap-2 text-xs text-[#52525b]"><label>Waste <input aria-label={`Wastage for ${line.name}`} type="number" min={0} max={100} value={line.wastagePercent || 0} onChange={(event) => onChange({ wastagePercent: Number(event.target.value || 0) })} className="ml-1 h-7 w-12 rounded border border-[#e4e4e7] text-center"/>%</label><span className="font-semibold text-[#18181b]">{line.qty} {line.inventoryUom}</span></div>
      <p className="text-[11px] text-[#52525b]">Covers {(Number(line.qty || 0) * coverage).toFixed(2)} {line.pricingUom}</p>
    </> : basis === 'PIECE' ? <>
      <div className="grid grid-cols-[1fr_4rem] gap-2"><input aria-label={`Requested pieces for ${line.name}`} type="number" min={1} step={1} value={line.requestedPieces || pieces} onChange={(event) => onChange({ requestedPieces: Number(event.target.value || 0) })} className="h-9 rounded-md border border-[#e4e4e7] bg-white px-2 text-right text-sm font-semibold"/><div className="grid h-9 place-items-center rounded-md bg-[#f4f4f5] text-xs font-semibold">PC</div></div>
      <p className="text-[11px] text-[#52525b]">{pieces} pc / {line.inventoryUom} → {line.qty} {line.inventoryUom} ({Number(line.qty || 0) * pieces} pc billed)</p>
    </> : <>
      <div className="grid grid-cols-[1fr_4rem] gap-2"><input aria-label={`Boxes for ${line.name}`} type="number" min={1} step={1} value={line.qty} onChange={(event) => onChange({ qty: Number(event.target.value || 0) })} className="h-9 rounded-md border border-[#e4e4e7] bg-white px-2 text-right text-sm font-semibold"/><div className="grid h-9 place-items-center rounded-md bg-[#f4f4f5] text-xs font-semibold">{line.inventoryUom}</div></div>
      <p className="text-[11px] text-[#52525b]">{pieces} pc and {coverage || 0} area units per {line.inventoryUom}</p>
    </>}
  </div>;
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
  const [selectedArchitectId, setSelectedArchitectId] = useState('');
  const [selectedOwnerId, setSelectedOwnerId] = useState('');
  const [projectTitle, setProjectTitle] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [success, setSuccess] = useState('');
  const [savedQuote, setSavedQuote] = useState<any>(null);
  const [displayMode, setDisplayMode] = useState<'priced' | 'selection'>('priced');
  const [taxMode, setTaxMode] = useState<'gst' | 'non_gst'>('gst');
  const [selectedBrandIds, setSelectedBrandIds] = useState<string[]>([]);
  const [defaultArea, setDefaultArea] = useState('General Selection');
  const [quoteDiscountType, setQuoteDiscountType] = useState<DiscountMode>('PERCENT');
  const [quoteDiscountValue, setQuoteDiscountValue] = useState('0');
  const [validUntil, setValidUntil] = useState(() => new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10));
  const { data: customerData, error: customerError } = useQuery(GET_QUOTE_SETUP);
  const { data: searchData, loading: searching, error: searchError } = useQuery(SEARCH_PRODUCTS, { variables: { query: searchQuery }, skip: searchQuery.length < 2 });
  const [createQuote, { loading: saving, error: saveError }] = useMutation(CREATE_QUOTE);
  const [validationError, setValidationError] = useState<string>('');
  const [preloadProductIds,setPreloadProductIds]=useState<string[]>([]);
  const preloadApplied=useRef(false);
  const {data:preloadData,error:preloadError}=useQuery(PRELOAD_PRODUCTS,{variables:{ids:preloadProductIds},skip:!preloadProductIds.length});
  const [scanOpen, setScanOpen] = useState(false);
  const [scanPayload, setScanPayload] = useState('');
  const [scanResult, setScanResult] = useState<any>(null);
  const [scanMessage, setScanMessage] = useState('');
  const [scanLabel, scanState] = useMutation(SCAN_LABEL);
  const documentSettings = customerData?.documentSettings?.data || {};
  const brands = useMemo<any[]>(() => (customerData?.masterProductBrands || []).filter((brand: any) => brand.metadata?.quoteEnabled !== false), [customerData?.masterProductBrands]);
  const brandDefaultsApplied = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!customerData || brandDefaultsApplied.current) return;
    const mode = String(documentSettings.quoteBrandSelectionMode || 'all');
    const configured = new Set((Array.isArray(documentSettings.quoteBrandIds) ? documentSettings.quoteBrandIds : []).map(String));
    setSelectedBrandIds(mode === 'none' ? [] : brands.filter((brand: any) => mode === 'all' || configured.has(String(brand.id))).map((brand: any) => String(brand.id)));
    brandDefaultsApplied.current = true;
  }, [brands, customerData, documentSettings.quoteBrandIds, documentSettings.quoteBrandSelectionMode]);

  useEffect(() => {
    if (selectedOwnerId || !customerData?.salesAssignees?.length) return;
    let currentUserId = '';
    try { currentUserId = JSON.parse(localStorage.getItem('user') || 'null')?.id || ''; } catch {}
    const match = customerData.salesAssignees.find((user: any) => user.id === currentUserId);
    setSelectedOwnerId(match?.id || customerData.salesAssignees[0].id);
  }, [customerData?.salesAssignees, selectedOwnerId]);

  useEffect(()=>{const params=new URLSearchParams(window.location.search);const ids=(params.get('products')||params.get('product')||'').split(',').map((id)=>id.trim()).filter(Boolean).slice(0,250);setPreloadProductIds([...new Set(ids)]);},[]);

  const addProduct = (product: any) => {
    const isTile = String(product.category || '').toLowerCase() === 'tiles';
    const pricingUom = product.salesUom || product.unit || 'PC';
    const coveragePerPack = Number(product.coveragePerPack || 0);
    const inventoryUom = product.purchaseUom || product.unit || 'PC';
    const rateBasis: TileRateBasis = ['SQFT', 'SQM', 'M2'].includes(String(pricingUom).toUpperCase()) ? 'AREA' : String(pricingUom).toUpperCase() === 'PC' && String(inventoryUom).toUpperCase() !== 'PC' ? 'PIECE' : 'BOX';
    const wastagePercent = isTile ? 10 : 0;
    const requestedArea = isTile && coveragePerPack > 0 ? coveragePerPack : 0;
    const qty = rateBasis === 'AREA' ? packsForArea(requestedArea, wastagePercent, coveragePerPack) : 1;
    const sourcePriceRateBasis = String(product.priceRateBasis || '').toUpperCase();
    const defaultsMatchBasis = sourcePriceRateBasis === rateBasis;
    const defaultMrp = defaultsMatchBasis ? Number(product.defaultMrpInclusive || 0) : 0;
    const defaultNrp = defaultsMatchBasis ? Number(product.defaultNrpInclusive || 0) : 0;
    setLines((current) => current.some((line) => line.productId === product.id) ? current : [...current, { id: `${product.id}-${Date.now()}`, lineKey: `product:${product.id}:${Date.now()}`, pricingVersion: 'unified_retail_v1', area: defaultArea || 'General Selection', productId: product.id, name: product.name, sku: product.sku, internalCode: product.internalCode || '', tileCode: isTile ? (product.internalCode || product.sku) : undefined, tileSize: product.dimensions || '', qty, requestedArea, requestedPieces: isTile ? Number(product.piecesPerPack || 1) : 0, wastagePercent, coveragePerPack, piecesPerPack: Number(product.piecesPerPack || 1), inventoryUom, pricingUom, rateBasis, priceRateBasis: rateBasis, mrpInclusive: defaultMrp || '', mrpSource: defaultsMatchBasis && defaultMrp > 0 ? (product.mrpSource || 'PRODUCT_MASTER') : 'MANUAL', nrpMode: defaultNrp > 0 ? 'FIXED_NRP' : 'PERCENT_OFF_MRP', nrpInput: defaultNrp > 0 ? defaultNrp : 0, specialMode: 'NONE', specialInput: 0, taxRate: 18, unit: inventoryUom, category: product.category, brand: product.brand, media: product.media, quoteImage: '' }]);
    const matchedBrand = brands.find((brand: any) => String(brand.name || '').trim().toLowerCase() === String(product.brand || '').trim().toLowerCase());
    if (matchedBrand) setSelectedBrandIds((current) => current.includes(String(matchedBrand.id)) ? current : [...current, String(matchedBrand.id)]);
    setSearchQuery('');
  };
  // The preload is intentionally one-shot; addProduct is a render-local builder.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{const products=preloadData?.productsByIds||[];if(!products.length||preloadApplied.current)return;preloadApplied.current=true;products.forEach(addProduct);setSuccess(`${products.length} scanned selection${products.length === 1 ? '' : 's'} added. Select the customer and verify quantity, MRP and rate before saving.`);},[preloadData?.productsByIds]);
  const scanToQuote = async (payload: string) => {
    setScanMessage('');
    setScanPayload(payload);
    setScanResult(null);
    const response = await scanLabel({ variables: { labelCode: payload, input: { action: 'quote_similar_lookup', metadata: { surface: 'quote_new' } } } });
    const result = response.data?.scanInternalLabel;
    if (result?.result !== 'success' || !result?.label?.product) {
      setScanMessage('No active governed label matched this scan. The quote was not changed.');
      return;
    }
    setScanResult(result);
  };
  const addScannedProducts = async (products: any[]) => {
    await scanLabel({ variables: { labelCode: scanPayload, input: { action: 'quote_similar_select', entityType: 'QuoteDraft', metadata: { surface: 'quote_new', selectedProductIds: products.map((product) => product.id) } } } });
    products.forEach(addProduct);
    setScanMessage(`${products.length} selected item${products.length === 1 ? '' : 's'} added to the quote draft.`);
    setScanResult(null);
    setScanOpen(false);
  };
  const updateQty = (id: string, qty: number) => setLines((current) => current.map((line) => line.id === id ? { ...line, qty } : line));
  const updateLine = (id: string, patch: any) => setLines((current) => current.map((line) => {
    if (line.id !== id) return line;
    const updated = { ...line, ...patch };
    if (areaPriced(updated) && ('requestedArea' in patch || 'wastagePercent' in patch || 'coveragePerPack' in patch)) {
      updated.qty = packsForArea(Number(updated.requestedArea || 0), Number(updated.wastagePercent || 0), Number(updated.coveragePerPack || 0));
    } else if (pricingBasis(updated) === 'PIECE' && ('requestedPieces' in patch || 'piecesPerPack' in patch)) {
      updated.qty = packsForPieces(Number(updated.requestedPieces || 0), Number(updated.piecesPerPack || 1));
    }
    return updated;
  }));
  const changeTileBasis = (id: string, basis: TileRateBasis) => setLines((current) => current.map((line) => {
    if (line.id !== id) return line;
    const sourceUom = String(line.pricingUom || line.unit || 'BOX').toUpperCase();
    const inventoryUom = String(line.inventoryUom || line.unit || 'BOX').toUpperCase();
    const pricingUom = basis === 'AREA'
      ? (['SQFT', 'SQM', 'M2'].includes(sourceUom) ? sourceUom : 'SQFT')
      : basis === 'PIECE' ? 'PC' : inventoryUom;
    const qty = Math.max(1, Number(line.qty || 1));
    const requestedArea = basis === 'AREA' ? Number(line.requestedArea || qty * Number(line.coveragePerPack || 0)) : Number(line.requestedArea || 0);
    const requestedPieces = basis === 'PIECE' ? Number(line.requestedPieces || qty * Number(line.piecesPerPack || 1)) : Number(line.requestedPieces || 0);
    const nextQty = basis === 'AREA'
      ? packsForArea(requestedArea, Number(line.wastagePercent || 0), Number(line.coveragePerPack || 0))
      : basis === 'PIECE' ? packsForPieces(requestedPieces, Number(line.piecesPerPack || 1)) : qty;
    return {
      ...line,
      rateBasis: basis,
      pricingUom,
      qty: nextQty,
      requestedArea,
      requestedPieces,
      mrpInclusive: '',
      priceRateBasis: basis,
      mrpSource: 'MANUAL',
      nrpMode: 'PERCENT_OFF_MRP',
      nrpInput: 0,
      specialMode: 'NONE',
      specialInput: 0,
    };
  }));
  const removeLine = (id: string) => setLines((current) => current.filter((line) => line.id !== id));
  const rawCommercialRows = lines.map((line) => {
    const quantity = Number(line.qty || 0);
    const pricingQuantity = areaPriced(line) ? quantity * Number(line.coveragePerPack || 0) : pricingBasis(line) === 'PIECE' ? quantity * Number(line.piecesPerPack || 1) : quantity;
    const taxRate = taxMode === 'non_gst' ? 0 : Math.max(0, Number(line.taxRate ?? 18));
    const ladder = retailLadder(line, pricingQuantity, taxRate);
    return { id: line.id, line, pricingQuantity, taxRate, ...ladder };
  });
  const allocatedCommercialRows = allocateQuoteDiscount(rawCommercialRows, quoteDiscountType, Number(quoteDiscountValue || 0)).map((row) => {
    const taxableValue = row.grossAfterQuoteDiscount / (1 + row.taxRate / 100);
    const taxAmount = row.grossAfterQuoteDiscount - taxableValue;
    const finalUnitPayable = row.pricingQuantity > 0 ? row.grossAfterQuoteDiscount / row.pricingQuantity : 0;
    const mrpMissing = !Number.isFinite(row.mrpInclusive) || Number(row.mrpInclusive) <= 0;
    const mrpValid = !mrpMissing && finalUnitPayable <= Number(row.mrpInclusive) + 0.005;
    const grossMrp = row.safeMrp > 0 ? row.pricingQuantity * row.safeMrp : 0;
    return { ...row, offeredBeforeQuoteDiscount: row.grossBeforeQuoteDiscount, taxableValue, taxAmount, total: row.grossAfterQuoteDiscount, mrpMissing, mrpValid, finalUnitPayable, mrpUom: mrpUom(row.line), grossMrp, savingFromMrp: Math.max(0, grossMrp - row.grossAfterQuoteDiscount) };
  });
  const commercialById = new Map(allocatedCommercialRows.map((row) => [row.id, row]));
  const lineCommercial = (line: any) => commercialById.get(line.id) as any;
  const subtotal = lines.reduce((sum, line) => sum + lineCommercial(line).taxableValue, 0);
  const tax = lines.reduce((sum, line) => sum + lineCommercial(line).taxAmount, 0);
  const quoteDiscountAmount = lines.reduce((sum, line) => sum + lineCommercial(line).quoteDiscountAmount, 0);
  const lineNetValue = lines.reduce((sum, line) => sum + lineCommercial(line).grossBeforeQuoteDiscount, 0);
  const total = subtotal + tax;
  const grossMrp = lines.reduce((sum, line) => sum + lineCommercial(line).grossMrp, 0);
  const nrpValue = lines.reduce((sum, line) => sum + lineCommercial(line).nrpValueInclusive, 0);
  const specialValue = lines.reduce((sum, line) => sum + lineCommercial(line).specialValueInclusive, 0);
  const totalItems = lines.reduce((sum, line) => sum + Number(line.qty || 0), 0);
  const missingMrpCount = lines.filter((line) => lineCommercial(line).mrpMissing).length;
  const invalidMrpCount = lines.filter((line) => !lineCommercial(line).mrpMissing && !lineCommercial(line).mrpValid).length;
  const missingNrpCount = lines.filter((line) => Number(lineCommercial(line).nrpInclusive || 0) <= 0).length;
  const invalidDiscountLine = lines.find((line) => {
    const rate = lineCommercial(line);
    return Number(line.nrpInput || 0) < 0 || (line.nrpMode === 'PERCENT_OFF_MRP' && Number(line.nrpInput || 0) > 100)
      || Number(line.specialInput || 0) < 0 || (line.specialMode === 'PERCENT_OFF_NRP' && Number(line.specialInput || 0) > 100)
      || (line.nrpMode === 'FIXED_NRP' && Number(line.nrpInput || 0) > Number(rate.safeMrp || 0))
      || (line.specialMode === 'FIXED_SPECIAL_RATE' && Number(line.specialInput || 0) > Number(rate.nrp || 0));
  });
  const invalidQuoteDiscount = Number(quoteDiscountValue || 0) < 0 || (quoteDiscountType === 'PERCENT' ? Number(quoteDiscountValue || 0) > 100 : Number(quoteDiscountValue || 0) > lineNetValue);
  const pricingReady = lines.length > 0 && missingMrpCount === 0 && missingNrpCount === 0 && invalidMrpCount === 0 && !invalidDiscountLine && !invalidQuoteDiscount;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if (event.key === '/' && !typing) { event.preventDefault(); searchInputRef.current?.focus(); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void handleSave(true); }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void handleSave(false); }
      if (event.key === 'Escape') { setSearchQuery(''); setScanOpen(false); setScanResult(null); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const focusLine = (line: any) => {
    if (!line) return;
    const target = document.getElementById(`quote-line-${line.id}`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => target?.querySelector<HTMLElement>('[data-pricing-error="true"]')?.focus(), 350);
  };

  const handleSave = async (saveAsDraft = false) => {
    setValidationError('');
    if (!selectedCustomerId) {
      setValidationError('Pick a customer before saving the quote.');
      return;
    }
    if (lines.length === 0) {
      setValidationError('Add at least one product line before saving.');
      return;
    }
    if (invalidDiscountLine || invalidQuoteDiscount) {
      setValidationError(invalidDiscountLine ? `A discount on ${invalidDiscountLine.sku || invalidDiscountLine.name} exceeds the price it is applied to.` : 'The additional quote discount exceeds the available quote value.');
      if (invalidDiscountLine) focusLine(invalidDiscountLine);
      return;
    }
    const invalidLine = lines.find((line) => !Number(line.qty) || Number(line.qty) <= 0);
    if (invalidLine) {
      setValidationError(`Quantity must be greater than 0 (line: ${invalidLine.name || invalidLine.sku || 'unnamed'}).`);
      return;
    }
    const mrpIssue = lines.map((line) => ({ line, commercial: lineCommercial(line) })).find(({ commercial }) => commercial.mrpMissing || !commercial.mrpValid);
    if (!saveAsDraft && mrpIssue) {
      const { line, commercial } = mrpIssue;
      setValidationError(commercial.mrpMissing
        ? `MRP is required for ${line.sku || line.name}, entered per ${commercial.mrpUom}.`
        : `${line.sku || line.name} exceeds MRP: payable ${money(commercial.finalUnitPayable)} per ${commercial.mrpUom}, MRP ${money(commercial.mrpInclusive || 0)}.`);
      focusLine(line);
      return;
    }
    const ownerId = selectedOwnerId;
    if (!ownerId) {
      setValidationError('Select the responsible sales user so this quote appears in the correct CRM timeline and reports.');
      return;
    }
    try {
      const { data, errors } = await createQuote({
        variables: {
          input: {
            customerId: selectedCustomerId,
            ownerId,
            architectId: selectedArchitectId || undefined,
            projectName: projectTitle,
            title: projectTitle || 'Retail product quotation',
            validUntil: validUntil ? new Date(`${validUntil}T23:59:59`).toISOString() : undefined,
            displayMode,
            discountPercent: quoteDiscountType === 'PERCENT' ? Number(quoteDiscountValue || 0) : 0,
            saveAsDraft,
            quoteMeta: JSON.stringify({ remarks: '', taxMode, pricingVersion: 'unified_retail_v1', quoteDiscount: { mode: quoteDiscountType, value: Number(quoteDiscountValue || 0) }, showBrandLogos: selectedBrandIds.length > 0, selectedBrandIds, pricingReadiness: { missingMrpCount, missingNrpCount, invalidMrpCount } }),
            lines: JSON.stringify(lines.map((line) => {
              const commercial = lineCommercial(line);
              const { id: _clientId, ...persisted } = line;
              return { ...persisted, pricingVersion: 'unified_retail_v1', taxRate: taxMode === 'non_gst' ? 0 : Number(line.taxRate ?? 18), priceRateBasis: pricingBasis(line), mrpInclusive: commercial.mrpInclusive, mrpSource: line.mrpSource || 'MANUAL', nrpMode: commercial.nrpMode, nrpInput: commercial.nrpInput, nrpInclusive: commercial.nrpInclusive, nrpExclusive: commercial.nrpExclusive, specialMode: commercial.specialMode, specialInput: commercial.specialInput, specialRateInclusive: commercial.specialRateInclusive, specialRateExclusive: commercial.specialRateExclusive, pricingQuantity: commercial.pricingQuantity, quoteDiscountMode: quoteDiscountType, quoteDiscountValue: Number(quoteDiscountValue || 0), quoteDiscountAllocatedInclusive: commercial.quoteDiscountAllocatedInclusive, taxableValue: commercial.taxableValue, taxAmount: commercial.taxAmount, grossLineTotal: commercial.total, total: commercial.total };
            })),
          },
        },
      });
      if (errors?.length) {
        setValidationError(errors.map((e) => e.message).join(' • '));
        return;
      }
      setSavedQuote(data?.createQuote || null);
      setSuccess(`${data?.createQuote?.quoteNumber || 'Quote'} ${saveAsDraft ? 'saved as draft' : 'validated'}`);
      setLines([]);
      setSelectedCustomerId('');
      setSelectedArchitectId('');
      setProjectTitle('');
      setQuoteDiscountType('PERCENT');
      setQuoteDiscountValue('0');
    } catch (err) {
      const diagnostic = describeApolloError(err, 'CreateQuote');
      setValidationError(diagnostic.remediation || diagnostic.message);
      const line = diagnostic.lineKey ? lines.find((row) => row.lineKey === diagnostic.lineKey) : null;
      if (line) focusLine(line);
    }
  };

  const queryError = customerError || searchError || preloadError || scanState.error;
  return (
    <div className="pb-24 xl:h-[calc(100vh-10rem)] xl:overflow-hidden xl:pb-4">
      {queryError ? <div className="xl:col-span-2"><QueryErrorBanner error={queryError} /></div> : null}
      {saveError ? <div className="xl:col-span-2"><QueryErrorBanner error={saveError} /></div> : null}
      {validationError ? (
        <div role="alert" aria-live="polite" className="xl:col-span-2 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm font-bold text-amber-900">{validationError}</div>
      ) : null}
      <AnimatePresence>{success && <motion.div initial={{ opacity: 0, y: -18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="fixed right-8 top-24 z-50 flex flex-wrap items-center gap-3 rounded-2xl bg-[#059669] px-4 py-3 text-sm font-medium text-white shadow-md-soft"><CheckCircle className="h-5 w-5" /> {success} created {savedQuote?.id && <><a className="rounded-xl bg-white/15 px-3 py-2" href={`/dashboard/quotes/${savedQuote.id}`}>Open</a><a className="rounded-xl bg-white/15 px-3 py-2" href={`/api/pdf/quote/${savedQuote.id}`} target="_blank" rel="noreferrer"><Download className="mr-1 inline h-4 w-4" /> PDF</a></>}</motion.div>}</AnimatePresence>

      <section className="flex h-full min-w-0 flex-col overflow-hidden rounded-r6 bg-white/72 shadow-2xl shadow-[#475569]/10 backdrop-blur-xl">
        <div className="border-b border-[#e4e4e7]/10 p-5 lg:p-6">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-[#52525b]">Quote studio</p>
              <h1 className="mt-2 font-display text-3xl font-bold tracking-[-0.02em] text-[#18181b]">Build a beautiful retail proposal.</h1>
              <p className="mt-2 text-sm font-semibold text-[#52525b]">Search catalogue SKUs, add product-image rows, and save a quote version.</p>
            </div>
            <div className="flex gap-3">
              <Button disabled={saving || !selectedCustomerId || !selectedOwnerId || lines.length === 0} onClick={() => handleSave(true)} size="lg" variant="outline"><Save className="mr-2 h-5 w-5" /> {saving ? 'Saving...' : 'Save draft'}</Button>
              <Button disabled={saving || !selectedCustomerId || !selectedOwnerId || lines.length === 0 || !pricingReady} onClick={() => handleSave(false)} size="lg"><ShieldCheck className="mr-2 h-5 w-5" /> Validate quote</Button>
              {savedQuote?.id && <Button asChild variant="warning" size="lg"><a href={`/api/pdf/quote/${savedQuote.id}`} target="_blank" rel="noreferrer"><Download className="mr-2 h-5 w-5" /> PDF</a></Button>}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 custom-scrollbar lg:p-6">
          <div className="grid gap-4 lg:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#71717a]">Customer</span>
              <SelectMenu value={selectedCustomerId || undefined} onValueChange={(v) => setSelectedCustomerId(v)}>
                <SelectMenuTrigger className="h-11 text-sm" placeholder="Select customer…" />
                <SelectMenuContent>
                  {customerData?.customers?.map((customer: any) => (
                    <SelectMenuItem key={customer.id} value={customer.id}>{customer.name}</SelectMenuItem>
                  ))}
                </SelectMenuContent>
              </SelectMenu>
            </label>
            <label className="block space-y-1.5">
              <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#71717a]">Responsible sales user</span>
              <SelectMenu value={selectedOwnerId || undefined} onValueChange={setSelectedOwnerId}>
                <SelectMenuTrigger className="h-11 text-sm" placeholder="Select sales user…" />
                <SelectMenuContent>
                  {(customerData?.salesAssignees || []).map((user: any) => <SelectMenuItem key={user.id} value={user.id}>{user.name} · {String(user.role || '').replace('_', ' ')}</SelectMenuItem>)}
                </SelectMenuContent>
              </SelectMenu>
            </label>
            <label className="block space-y-1.5">
              <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#71717a]">Consulting architect</span>
              <SelectMenu value={selectedArchitectId || '__none__'} onValueChange={(v) => setSelectedArchitectId(v === '__none__' ? '' : v)}>
                <SelectMenuTrigger className="h-11 text-sm" placeholder="Optional — select architect…" />
                <SelectMenuContent>
                  <SelectMenuItem value="__none__">No architect</SelectMenuItem>
                  {(customerData?.architects || []).map((architect: any) => (
                    <SelectMenuItem key={architect.id} value={architect.id}>
                      {architect.name}{architect.firmName ? ` · ${architect.firmName}` : ''}
                    </SelectMenuItem>
                  ))}
                </SelectMenuContent>
              </SelectMenu>
            </label>
            <label className="block space-y-1.5">
              <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#71717a]">Valid until</span>
              <Input type="date" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} className="h-11" />
            </label>
            <div className="space-y-1.5">
              <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#71717a]">Additional quote discount</span>
              <div className="grid grid-cols-[7rem_1fr] gap-2">
                <select aria-label="Quote discount mode" value={quoteDiscountType} onChange={(event) => setQuoteDiscountType(event.target.value as DiscountMode)} className="h-11 rounded-md border border-[#d4d4d8] bg-white px-3 text-sm font-semibold"><option value="PERCENT">Percent %</option><option value="FIXED_AMOUNT">Amount ₹</option></select>
                <Input aria-label="Quote discount value" type="number" min={0} max={quoteDiscountType === 'PERCENT' ? 100 : undefined} step="0.01" value={quoteDiscountValue} onChange={(event) => setQuoteDiscountValue(event.target.value)} className="h-11" />
              </div>
              <p className="text-[10px] font-semibold text-[#71717a]">Applied after every line&apos;s NRP and special discount.</p>
            </div>
            <div className="space-y-1.5">
              <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#71717a]">Tax treatment</span>
              <div className="grid h-11 grid-cols-2 rounded-md border border-[#d4d4d8] bg-[#f4f4f5] p-1">
                <button type="button" onClick={() => setTaxMode('gst')} className={`rounded text-xs font-semibold ${taxMode === 'gst' ? 'bg-white text-[#18181b] shadow-sm' : 'text-[#52525b]'}`}>GST quotation</button>
                <button type="button" onClick={() => setTaxMode('non_gst')} className={`rounded text-xs font-semibold ${taxMode === 'non_gst' ? 'bg-white text-[#18181b] shadow-sm' : 'text-[#52525b]'}`}>Without GST</button>
              </div>
            </div>
            <label className="block space-y-1.5">
              <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#71717a]">Project / site</span>
              <Input value={projectTitle} onChange={(event) => setProjectTitle(event.target.value)} placeholder="e.g. Patel Residence bathroom package" className="h-11" />
            </label>
            <label className="block space-y-1.5">
              <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#71717a]">PDF type</span>
              <SelectMenu value={displayMode} onValueChange={(v) => setDisplayMode(v as any)}>
                <SelectMenuTrigger className="h-11 text-sm" />
                <SelectMenuContent>
                  <SelectMenuItem value="priced">Show prices — quotation</SelectMenuItem>
                  <SelectMenuItem value="selection">Hide prices — selection summary</SelectMenuItem>
                </SelectMenuContent>
              </SelectMenu>
            </label>
            <label className="block space-y-2 lg:col-span-2">
              <span className="text-xs font-black uppercase tracking-widest text-[#52525b]">Default area for new lines</span>
              <input
                list="mp-area-list"
                value={defaultArea}
                onChange={(event) => setDefaultArea(event.target.value)}
                placeholder="e.g. Master Bedroom Bathroom"
                className="h-[3.25rem] w-full rounded-2xl border border-[#e4e4e7]/18 bg-white px-4 text-sm font-bold text-[#18181b] outline-none focus:border-[#2563eb]/45 focus:ring-4 focus:ring-[#2563eb]/10"
              />
              <div className="flex flex-wrap gap-2 pt-1">
                {AREA_SUGGESTIONS.slice(0, 8).map((area) => (
                  <button
                    key={area}
                    type="button"
                    onClick={() => setDefaultArea(area)}
                    className={`rounded-full px-3 py-1 text-xs font-medium uppercase tracking-wider transition ${defaultArea === area ? 'bg-[#18181b] text-white' : 'bg-white/75 text-[#27272a] hover:bg-[#eff6ff]'}`}
                  >{area}</button>
                ))}
              </div>
            </label>
            <div className="rounded-md border border-[#e4e4e7] bg-white p-4 lg:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center overflow-hidden rounded border border-[#e4e4e7] bg-white p-1">{documentSettings.logoUrl ? <img src={documentSettings.logoUrl} alt="Company logo" className="max-h-full max-w-full object-contain" /> : <Building2 className="h-4 w-4 text-[#71717a]" />}</div>
                  <div><p className="text-sm font-semibold text-[#18181b]">{documentSettings.companyName || 'Marble Park'}</p><p className="text-xs text-[#71717a]">Global quotation identity</p></div>
                </div>
                <div className="flex items-center gap-2"><button type="button" onClick={() => setSelectedBrandIds(brands.map((brand: any) => String(brand.id)))} className="rounded border border-[#e4e4e7] px-2.5 py-1 text-xs font-semibold text-[#52525b]">All</button><button type="button" onClick={() => setSelectedBrandIds([])} className="rounded border border-[#e4e4e7] px-2.5 py-1 text-xs font-semibold text-[#52525b]">Clear</button><span className="text-xs font-semibold text-[#52525b]">{selectedBrandIds.length} selected</span></div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-7">
                {brands.map((brand: any) => { const selected = selectedBrandIds.includes(String(brand.id)); return <button key={brand.id} type="button" title={brand.name} onClick={() => setSelectedBrandIds((current) => selected ? current.filter((id) => id !== String(brand.id)) : [...current, String(brand.id)])} className={`relative grid h-16 place-items-center rounded border bg-white p-2 ${selected ? 'border-[#2563eb] ring-2 ring-[#2563eb]/15' : 'border-[#e4e4e7]'}`}>{brand.metadata?.logoUrl ? <img src={brand.metadata.logoUrl} alt={brand.name} className="max-h-9 max-w-full object-contain" /> : <span className="line-clamp-2 text-center text-[10px] font-semibold text-[#52525b]">{brand.name}</span>}{selected ? <span className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-[#2563eb] text-white"><Check className="h-2.5 w-2.5" /></span> : null}</button>; })}
              </div>
              {!brands.length ? <p className="mt-3 text-xs font-semibold text-amber-700">Upload and enable served-brand logos in Settings or Brand Master before printing them.</p> : null}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-[#e4e4e7] bg-[#fafafa] px-3 py-2 text-[10px] font-semibold text-[#52525b]" aria-label="Keyboard shortcuts">
            <span className="mr-1 font-black uppercase tracking-wider text-[#18181b]">Shortcuts</span><kbd className="rounded border bg-white px-2 py-1">/ Search</kbd><kbd className="rounded border bg-white px-2 py-1">⌘/Ctrl S Draft</kbd><kbd className="rounded border bg-white px-2 py-1">⌘/Ctrl ↵ Validate</kbd><kbd className="rounded border bg-white px-2 py-1">Esc Close</kbd><span>Tab moves through fields in pricing order.</span>
          </div>
          <datalist id="mp-area-list">
            {AREA_SUGGESTIONS.map((area) => <option key={area} value={area} />)}
          </datalist>

          <section aria-label="Pricing readiness" className="mt-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8">
            {[
              [FileText, 'Lines / items', `${lines.length} / ${totalItems}`, null],
              [BadgeIndianRupee, 'Gross MRP', money(grossMrp), missingMrpCount ? () => focusLine(lines.find((line) => lineCommercial(line).mrpMissing)) : null],
              [BadgeIndianRupee, 'NRP value', money(nrpValue), missingNrpCount ? () => focusLine(lines.find((line) => Number(lineCommercial(line).nrpInclusive || 0) <= 0)) : null],
              [BadgeIndianRupee, 'Special value', money(specialValue), null],
              [Percent, 'Quote discount', money(quoteDiscountAmount), null],
              [BadgeIndianRupee, 'GST', money(tax), null],
              [AlertTriangle, 'Pricing exceptions', `${missingMrpCount + missingNrpCount + invalidMrpCount + (invalidDiscountLine ? 1 : 0)}`, () => focusLine(lines.find((line) => { const rate = lineCommercial(line); return rate.mrpMissing || !rate.mrpValid || Number(rate.nrpInclusive || 0) <= 0 || rate.pricingError; }))],
              [ShieldCheck, 'Readiness', pricingReady ? 'Ready' : lines.length ? 'Draft only' : 'No lines', null],
            ].map(([Icon, label, value, action]: any) => <button key={label} type="button" onClick={action || undefined} className={`min-w-0 rounded-lg border p-3 text-left transition ${action ? 'border-amber-200 bg-amber-50 hover:border-amber-400' : 'border-[#e4e4e7] bg-white'} ${label === 'Readiness' && pricingReady ? 'border-emerald-200 bg-emerald-50' : ''}`}><Icon className="h-4 w-4 text-[#a52b23]"/><p className="mt-2 truncate text-base font-black text-[#18181b]">{value}</p><p className="mt-1 text-[9px] font-bold uppercase tracking-[0.12em] text-[#71717a]">{label}</p></button>)}
          </section>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <div className="relative min-w-0 flex-1">
            <Search className="absolute left-4 top-7 h-5 w-5 -translate-y-1/2 text-[#52525b]" />
            <Input ref={searchInputRef} value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search showroom code, SKU, brand or name..." className="h-14 pl-12 text-base" />
            <AnimatePresence>
              {searchQuery.length >= 2 && searchData?.globalSearch?.products?.length > 0 && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="absolute left-0 right-0 top-full z-40 mt-3 max-h-96 overflow-y-auto rounded-r4 border border-[#e4e4e7]/12 bg-white p-2 shadow-2xl custom-scrollbar">
                  {searchData.globalSearch.products.map((product: any) => (
                    <button key={product.id} onClick={() => addProduct(product)} className="flex w-full items-center justify-between gap-4 rounded-2xl p-3 text-left transition hover:bg-[#eff6ff]/65">
                      <div className="flex min-w-0 items-center gap-3">
                        <ProductImageFrame src={productImage(product.media)} alt={product.name} className="h-20 w-24 shrink-0 rounded-2xl" imageClassName="p-1.5" />
                        <div className="min-w-0"><p className="truncate text-sm font-black">{product.internalCode || product.sku} · {product.name}</p><p className="text-xs font-medium uppercase tracking-wider text-[#52525b]">{product.sku}{masterBrandCode(brands, product.brand) ? ` · ${masterBrandCode(brands, product.brand)}` : ''}</p>{Number(product.coveragePerPack || 0) > 0 ? <p className="mt-1 text-xs text-[#52525b]">{product.coveragePerPack} {product.salesUom || 'area'} / {product.purchaseUom || product.unit || 'pack'} · {product.piecesPerPack || 1} pcs</p> : null}</div>
                      </div>
                      <span className="shrink-0 text-right text-xs font-black text-[#059669]">{Number(product.defaultNrpInclusive || 0) > 0 ? <>Default NRP<br/>{money(product.defaultNrpInclusive)}</> : 'Enter price in quote'}</span>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
            </div>
            <Button type="button" variant="outline" size="lg" onClick={() => { setScanOpen((value) => !value); setScanResult(null); }} className="h-14 shrink-0">
              <Camera className="mr-2 h-5 w-5" />{scanOpen ? 'Close scanner' : 'Scan showroom item'}
            </Button>
          </div>
          {scanOpen ? <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3"><PhysicalQrScanner compact busy={scanState.loading} onDetected={scanToQuote}/></div> : null}
          {scanResult ? <div className="mt-3"><ScanProductSelector result={scanResult} busy={scanState.loading} existingProductIds={lines.map((line) => line.productId)} primaryLabel="Add selected to quote" onPrimary={addScannedProducts} onDismiss={() => setScanResult(null)}/></div> : null}
          {scanMessage ? <div role="status" className={`mt-3 flex items-center gap-2 rounded-xl p-3 text-xs font-semibold ${scanMessage.startsWith('No active') ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800'}`}>{scanMessage.startsWith('No active') ? <XCircle className="h-4 w-4"/> : <CheckCircle className="h-4 w-4"/>}{scanMessage}</div> : null}

          <div className="mt-6 overflow-hidden rounded-r4 border border-[#e4e4e7] bg-white/80">
            <div className="divide-y divide-[#e4e4e7]">
              {lines.map((line) => { const commercial = lineCommercial(line); return <article id={`quote-line-${line.id}`} key={line.id} className="scroll-mt-24 p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <ProductImageFrame src={line.quoteImage || productImage(line.media)} alt={line.name} className="h-24 w-24 shrink-0 rounded-md sm:h-28 sm:w-32" imageClassName="p-1.5" />
                  <div className="min-w-0 flex-1"><input list="mp-area-list" value={line.area || ''} onChange={(event)=>updateLine(line.id,{area:event.target.value})} placeholder="Area / room" className="h-8 max-w-full rounded-md border border-[#d4d4d8] bg-white px-3 text-xs font-medium uppercase tracking-wider text-[#2563eb]"/><p className="mt-2 text-base font-black text-[#18181b] sm:text-lg">{line.internalCode || line.sku} · {line.name}</p><p className="mt-1 text-xs font-bold uppercase tracking-wider text-[#71717a]">{line.sku}{masterBrandCode(brands, line.brand) ? ` · ${masterBrandCode(brands, line.brand)}` : ''} · {line.unit}</p></div>
                  <button type="button" title="Remove line" onClick={() => removeLine(line.id)} className="shrink-0 rounded-lg p-2 text-[#71717a] hover:bg-red-50 hover:text-red-700"><Trash2 className="h-4 w-4"/></button>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-[1.25fr_0.85fr_1.05fr_1.1fr_0.65fr_1fr]">
                  <div><p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[#71717a]">Quantity / basis</p>{isTileLine(line) ? <TileQuantityEditor line={line} onChangeBasis={(basis) => changeTileBasis(line.id, basis)} onChange={(patch) => updateLine(line.id, patch)}/> : <div className="flex h-10 items-center gap-2"><input type="number" value={line.qty} min={1} onChange={(event)=>updateQty(line.id,Number(event.target.value)||0)} className="h-10 w-full rounded-md border border-[#d4d4d8] bg-white px-3 text-right text-sm font-semibold"/><span className="text-xs font-bold text-[#52525b]">{line.unit}</span></div>}</div>
                  <div><p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[#71717a]">MRP / {commercial.mrpUom}</p><input data-pricing-error={commercial.mrpMissing || !commercial.mrpValid ? 'true' : undefined} aria-label={`MRP per ${commercial.mrpUom} for ${line.name}`} type="number" min={0.01} step="0.01" value={line.mrpInclusive ?? ''} onChange={(event)=>updateLine(line.id,{mrpInclusive:event.target.value,priceRateBasis:pricingBasis(line),mrpSource:'MANUAL'})} className={`h-10 w-full rounded-md border px-3 text-right text-sm font-black ${commercial.mrpMissing || !commercial.mrpValid ? 'border-red-300 bg-red-50' : 'border-emerald-300 bg-emerald-50'}`}/><p className="mt-1 text-[10px] font-semibold text-[#71717a]">Tax-inclusive · {line.mrpSource === 'PRODUCT_MASTER' ? 'master default' : 'quote decision'}</p></div>
                  <div className="rounded-md border border-[#f1d5d1] bg-[#fff8f7] p-2"><p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[#8f2f28]">Base pricing → NRP</p><div className="grid grid-cols-[1fr_7.5rem] gap-1"><input data-pricing-error={Number(commercial.nrpInclusive || 0) <= 0 ? 'true' : undefined} aria-label={`NRP input for ${line.name}`} type="number" min={0} max={line.nrpMode === 'PERCENT_OFF_MRP' ? 100 : undefined} step="0.01" value={line.nrpInput ?? 0} onChange={(event)=>updateLine(line.id,{nrpInput:event.target.value})} className="h-10 min-w-0 rounded-md border border-[#e4e4e7] bg-white px-2 text-right text-sm font-black"/><select aria-label={`NRP mode for ${line.name}`} value={line.nrpMode || 'PERCENT_OFF_MRP'} onChange={(event)=>updateLine(line.id,{nrpMode:event.target.value,nrpInput:0})} className="h-10 rounded-md border border-[#e4e4e7] bg-white px-1 text-[10px] font-black"><option value="PERCENT_OFF_MRP">% off MRP</option><option value="FIXED_NRP">Set NRP ₹</option></select></div><p className="mt-1 text-right text-[10px] font-black text-[#8f2f28]">NRP {money(commercial.nrpInclusive)}</p></div>
                  <div className="rounded-md border border-[#d9e6fb] bg-[#f5f8ff] p-2"><p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[#1d4ed8]">Optional special pricing</p><div className="grid grid-cols-[1fr_7.8rem] gap-1"><input aria-label={`Special pricing input for ${line.name}`} type="number" min={0} max={line.specialMode === 'PERCENT_OFF_NRP' ? 100 : undefined} step="0.01" disabled={(line.specialMode || 'NONE') === 'NONE'} value={line.specialInput ?? 0} onChange={(event)=>updateLine(line.id,{specialInput:event.target.value})} className="h-10 min-w-0 rounded-md border border-[#e4e4e7] bg-white px-2 text-right text-sm font-black disabled:bg-[#f4f4f5]"/><select aria-label={`Special pricing mode for ${line.name}`} value={line.specialMode || 'NONE'} onChange={(event)=>updateLine(line.id,{specialMode:event.target.value,specialInput:0})} className="h-10 rounded-md border border-[#e4e4e7] bg-white px-1 text-[10px] font-black"><option value="NONE">No special</option><option value="PERCENT_OFF_NRP">% off NRP</option><option value="FIXED_SPECIAL_RATE">Set rate ₹</option></select></div><p className="mt-1 text-right text-[10px] font-black text-[#1d4ed8]">Special rate {money(commercial.specialRateInclusive)}</p></div>
                  <div><p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[#71717a]">GST</p>{taxMode==='gst'?<><input aria-label={`GST rate for ${line.name}`} type="number" min={0} max={100} value={line.taxRate??18} onChange={(event)=>updateLine(line.id,{taxRate:event.target.value})} className="h-10 w-full rounded-md border border-[#e4e4e7] px-3 text-right text-sm font-black"/><p className="mt-1 text-right text-[10px] font-semibold text-[#71717a]">{money(commercial.taxAmount)}</p></>:<span className="inline-flex rounded bg-[#f4f4f5] px-2 py-2 text-xs font-semibold text-[#52525b]">Without GST</span>}</div>
                  <div className="rounded-md bg-[#f8fafc] p-3 text-right"><p className="text-[10px] font-bold uppercase tracking-wider text-[#71717a]">Final payable</p><p className="mt-2 text-xl font-black text-[#059669]">{money(commercial.total)}</p><p className="mt-1 text-[10px] font-semibold text-[#71717a]">{money(commercial.finalUnitPayable)} / {commercial.mrpUom}</p></div>
                </div>
                <div className="mt-3 flex items-center gap-2"><ImageIcon className="h-4 w-4 text-[#a52b23]"/><input value={line.quoteImage || ''} onChange={(event)=>updateLine(line.id,{quoteImage:event.target.value})} placeholder="Optional HTTPS quote photo URL" className="h-9 min-w-0 flex-1 rounded-md border border-[#e4e4e7] bg-white px-3 text-xs font-semibold"/></div>
                {!commercial.mrpMissing && !commercial.mrpValid ? <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs font-bold text-red-800">Final payable {money(commercial.finalUnitPayable)} per {commercial.mrpUom} exceeds MRP. Reduce the negotiated rate or verify MRP.</p> : null}
              </article>;})}
            </div>
            {lines.length === 0 && <div className="grid h-56 place-items-center text-center"><div><Plus className="mx-auto mb-3 h-8 w-8 text-[#2563eb]" /><p className="font-semibold text-[#18181b]">Search products to start a quote.</p><p className="mt-1 text-sm font-semibold text-[#52525b]">Catalogue images and price details will appear here.</p></div></div>}
            {lines.length > 0 && <p className="border-t border-[#e4e4e7] px-4 py-3 text-xs font-semibold text-[#52525b]">Drafts preserve incomplete work. Validation, PDF, sharing and Sales Order conversion require a confirmed tax-inclusive MRP in the selected billing basis.</p>}
          </div>
        </div>
      </section>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[#e4e4e7] bg-white/95 p-3 shadow-[0_-12px_30px_rgba(15,23,42,0.12)] backdrop-blur xl:hidden">
        <div className="mx-auto grid max-w-xl grid-cols-[1fr_auto_1fr] items-center gap-2"><Button disabled={saving || !selectedCustomerId || !selectedOwnerId || !lines.length} variant="outline" onClick={() => handleSave(true)}><Save className="mr-2 h-4 w-4"/>Draft</Button><button type="button" onClick={() => { const line = lines.find((row) => { const rate = lineCommercial(row); return rate.mrpMissing || !rate.mrpValid; }); focusLine(line); }} className={`grid h-10 min-w-14 place-items-center rounded-md px-2 text-xs font-black ${pricingReady ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>{pricingReady ? 'Ready' : `${missingMrpCount + invalidMrpCount} errors`}</button><Button disabled={saving || !selectedCustomerId || !selectedOwnerId || !lines.length || !pricingReady} onClick={() => handleSave(false)}><ShieldCheck className="mr-2 h-4 w-4"/>Validate</Button></div>
      </div>
    </div>
  );
}
