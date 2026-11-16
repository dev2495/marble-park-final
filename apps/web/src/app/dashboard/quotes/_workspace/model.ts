// Quote line model shared by the new-quote and existing-quote workspace.
// Every rule here is carried over unchanged from the previous quote pages:
// Product Master MRP -> NRP (% off MRP or set NRP) -> optional special ->
// quote discount -> GST on top. Only the screen around it changed.
import { draftNumber, priceQuoteDraft, retailLadder, type DiscountMode } from '@/lib/quote-pricing';
import { tilePriceBasis, tilePriceUom, tilePricingCoverage, tilePricingQuantity, tileStockUnitGeometry } from '@/lib/tile-rate';

export type QuoteType = 'tile' | 'cp_sanitary';
export type RateBasis = 'AREA' | 'PIECE' | 'BOX';
export type TaxMode = 'gst' | 'non_gst';
export type Line = Record<string, any> & { _k: string };

export const DEFAULT_AREA = 'General Selection';
export const AREA_SUGGESTIONS = [
  'Master Bedroom Bathroom', '1st Floor Guest Bathroom', '2nd Floor Powder Bathroom', 'General Floor Guest Bathroom', 'Steam Shower Bathroom',
  'Upper Terrace Powder Bathroom', 'Terrace Powder', 'Guest Room Deck', 'Upper Terrace', 'Balcony', 'Living Room', 'Kitchen', 'Powder Room', 'Drying Yard',
];

let keySeed = 0;
export const lineKey = () => `k${Date.now().toString(36)}${(keySeed++).toString(36)}`;

export function money(value: number) {
  return `₹${Math.round(Number(value || 0)).toLocaleString('en-IN')}`;
}

export function productImage(media: any) {
  if (!media) return '';
  if (typeof media === 'string') {
    try { return JSON.parse(media)?.primary || ''; } catch { return media || ''; }
  }
  const gallery = Array.isArray(media.gallery) ? media.gallery : [];
  return media.thumbnailUrl || media.primaryUrl || media.primary || media.primaryImage || (typeof gallery[0] === 'string' ? gallery[0] : gallery[0]?.url) || '';
}

export function quoteTypeForProduct(product: any): QuoteType {
  return ['tiles', 'chemicals'].includes(String(product?.category || '').trim().toLowerCase()) ? 'tile' : 'cp_sanitary';
}
export function isTileLine(line: any) {
  return String(line?.category || '').toLowerCase() === 'tiles';
}

export function pricingBasis(line: any): RateBasis {
  if (isTileLine(line)) return tilePriceBasis(line.pricingUom || line.priceUom);
  const explicit = String(line.rateBasis || line.priceRateBasis || '').toUpperCase();
  if (explicit === 'AREA' || explicit === 'PIECE' || explicit === 'BOX') return explicit;
  if (explicit === 'PACK') return 'BOX';
  const uom = String(line.pricingUom || line.salesUom || line.unit || '').toUpperCase();
  return ['SQFT', 'SQM', 'M2'].includes(uom) ? 'AREA' : uom === 'PC' ? 'PIECE' : 'BOX';
}

export function mrpUom(line: any) {
  if (isTileLine(line)) return tilePriceUom(line.pricingUom || line.priceUom);
  const basis = pricingBasis(line);
  if (basis === 'AREA') return String(line.pricingUom || line.salesUom || 'SQFT').toUpperCase();
  if (basis === 'PIECE') return 'PC';
  return String(line.inventoryUom || line.purchaseUom || line.unit || line.uom || 'BOX').toUpperCase();
}

function areaPriced(line: any) {
  return pricingBasis(line) === 'AREA' && Number(line.coveragePerPack || 0) > 0;
}

// Wastage is not counted: boxes cover exactly the requested area.
export function packsForArea(requestedArea: number, coveragePerPack: number) {
  if (requestedArea <= 0) return 0;
  if (coveragePerPack <= 0) return 1;
  return Math.max(1, Math.ceil(requestedArea / coveragePerPack - 1e-9));
}
export function packsForPieces(requestedPieces: number, piecesPerPack: number) {
  if (requestedPieces <= 0 || piecesPerPack <= 0) return 1;
  return Math.max(1, Math.ceil(requestedPieces / piecesPerPack));
}

// Product Master owns the MRP basis. Older imports may lack it, so fall back
// to the master's own selling unit exactly like the server does.
function masterRateBasis(product: any): RateBasis {
  const explicit = String(product?.priceRateBasis || '').trim().toUpperCase();
  if (explicit === 'AREA' || explicit === 'PIECE' || explicit === 'BOX') return explicit;
  if (explicit === 'PACK') return 'BOX';
  const uom = String(product?.priceUom || product?.salesUom || product?.purchaseUom || product?.unit || 'PC').trim().toUpperCase();
  return ['SQFT', 'SQM', 'M2'].includes(uom) ? 'AREA' : uom === 'PC' ? 'PIECE' : 'BOX';
}

export function lineFromProduct(product: any, area: string): Line {
  const isTile = String(product.category || '').toLowerCase() === 'tiles';
  const nonTileBasis = isTile ? null : masterRateBasis(product);
  const pricingUom = isTile ? tilePriceUom(product.priceUom) : product.priceUom || (nonTileBasis === 'PIECE' ? 'PC' : product.salesUom || product.unit) || 'PC';
  // Stock-unit geometry: a tile stocked by the piece covers one piece's area.
  const geometry = isTile ? tileStockUnitGeometry(product) : { piecesPerUnit: Number(product.piecesPerPack || 1), coveragePerUnitSqFt: Number(product.coveragePerPack || 0) };
  const coveragePerPack = geometry.coveragePerUnitSqFt;
  const inventoryUom = product.purchaseUom || product.unit || 'PC';
  const rateBasis: RateBasis = isTile ? tilePriceBasis(pricingUom) : nonTileBasis!;
  const pricingCoveragePerPack = isTile ? tilePricingCoverage(coveragePerPack, pricingUom) : coveragePerPack;
  const requestedPieces = isTile && rateBasis === 'PIECE' ? geometry.piecesPerUnit : 0;
  const qty = rateBasis === 'AREA' ? packsForArea(0, pricingCoveragePerPack) : rateBasis === 'PIECE' && isTile ? packsForPieces(requestedPieces, geometry.piecesPerUnit) : 1;
  const defaultMrp = Number(product.defaultMrpInclusive || 0);
  const defaultNrp = Number(product.defaultNrpInclusive || 0);
  const key = lineKey();
  return {
    _k: key,
    lineKey: `product:${product.id}:${key}`,
    pricingVersion: 'unified_retail_v1',
    area: area || DEFAULT_AREA,
    productId: product.id,
    name: product.name,
    sku: product.sku,
    internalCode: product.internalCode || '',
    tileCode: isTile ? (product.internalCode || product.sku) : undefined,
    tileSize: product.dimensions || '',
    qty,
    requestedArea: 0,
    requestedPieces,
    wastagePercent: 0,
    coveragePerPack,
    pricingCoveragePerPack,
    piecesPerPack: geometry.piecesPerUnit,
    inventoryUom,
    pricingUom,
    rateBasis,
    priceRateBasis: rateBasis,
    mrpInclusive: defaultMrp || '',
    mrpSource: 'PRODUCT_MASTER',
    floorPriceInclusive: product.floorPriceInclusive == null ? null : Number(product.floorPriceInclusive),
    nrpMode: defaultNrp > 0 ? 'FIXED_NRP' : 'PERCENT_OFF_MRP',
    nrpInput: defaultNrp > 0 ? defaultNrp : '',
    specialMode: 'NONE',
    specialInput: '',
    taxRate: 18,
    taxTreatment: 'EXCLUSIVE',
    unit: inventoryUom,
    category: product.category,
    brand: product.brand,
    finish: product.finish,
    media: product.media,
  };
}

// Applies an edit and keeps boxes in step with a requested area or piece count.
export function patchLine(line: Line, patch: Record<string, any>): Line {
  const updated: Line = { ...line, ...patch };
  if ('qty' in patch) updated.quantity = updated.qty;
  if (isTileLine(updated) && ('requestedArea' in patch || 'requestedPieces' in patch)) {
    const unit = tilePriceUom(updated.pricingUom);
    if (unit === 'PC') {
      updated.qty = packsForPieces(draftNumber(updated.requestedPieces), Number(updated.piecesPerPack || 1));
    } else {
      const coverage = tilePricingCoverage(updated.coveragePerPack, unit);
      updated.pricingCoveragePerPack = coverage;
      updated.qty = packsForArea(draftNumber(updated.requestedArea), coverage);
    }
    updated.quantity = updated.qty;
    updated.wastagePercent = 0;
  } else if (areaPriced(updated) && ('requestedArea' in patch || 'coveragePerPack' in patch)) {
    updated.qty = packsForArea(draftNumber(updated.requestedArea), Number(updated.coveragePerPack || 0));
    updated.quantity = updated.qty;
    updated.wastagePercent = 0;
  }
  return updated;
}

export function pricingQuantityFor(line: any) {
  const quantity = draftNumber(line.qty ?? line.quantity);
  if (isTileLine(line)) return tilePricingQuantity({ ...line, qty: quantity });
  if (areaPriced(line)) return quantity * Number(line.coveragePerPack || 0);
  if (pricingBasis(line) === 'PIECE') return quantity * Number(line.piecesPerPack || line.pcsPerBox || 1);
  return quantity;
}

export type PricedRow = ReturnType<typeof priceLines>['rows'][number];

export function priceLines(lines: Line[], taxMode: TaxMode, discountType: DiscountMode, discountValue: unknown) {
  const raw = lines.map((line) => {
    const pricingQuantity = pricingQuantityFor(line);
    const taxRate = taxMode === 'non_gst' ? 0 : draftNumber(line.taxRate ?? 18);
    return { _k: line._k, line, pricingQuantity, taxRate, ...retailLadder(line, pricingQuantity, taxRate) };
  });
  const draft = priceQuoteDraft(raw, discountType, discountValue);
  const rows = draft.rows.map((row: any) => {
    const finalUnitPayable = row.pricingQuantity > 0 ? Number(row.grossAfterQuoteDiscount || 0) / row.pricingQuantity : 0;
    const mrpMissing = !Number.isFinite(Number(row.mrpInclusive)) || Number(row.mrpInclusive) <= 0;
    const mrpUnit = mrpUom(row.line);
    const discountOnMrp = !mrpMissing && row.pricingQuantity > 0 ? (1 - finalUnitPayable / Number(row.mrpInclusive)) * 100 : 0;
    return {
      ...row,
      taxableValue: Number(row.taxableValue || 0),
      taxAmount: Number(row.taxAmount || 0),
      total: Number(row.grossLineTotal || 0),
      finalUnitPayable,
      mrpMissing,
      mrpUnit,
      discountOnMrp,
      grossMrp: !mrpMissing ? row.pricingQuantity * Number(row.mrpInclusive) : 0,
    };
  });
  return { rows, discountError: draft.discountError };
}

export type LineIssue = { key: string; message: string; blocking: boolean };

export function lineIssues(line: Line, row: any, quoteType: QuoteType): LineIssue[] {
  const issues: LineIssue[] = [];
  if (quoteTypeForProduct(line) !== quoteType) issues.push({ key: 'family', message: quoteType === 'tile' ? 'Belongs in a CP & Sanitary quote' : 'Belongs in a Tile & Chemical quote', blocking: true });
  const tileArea = isTileLine(line) && pricingBasis(line) === 'AREA';
  if (tileArea && Number(line.coveragePerPack || 0) <= 0) issues.push({ key: 'coverage', message: 'Box coverage missing in Tile Master', blocking: true });
  if (draftNumber(line.qty ?? line.quantity) <= 0) issues.push({ key: 'qty', message: tileArea ? 'Enter area' : isTileLine(line) && pricingBasis(line) === 'PIECE' ? 'Enter pieces' : 'Enter quantity', blocking: true });
  if (row?.mrpMissing) issues.push({ key: 'mrp', message: 'MRP missing', blocking: true });
  else if (row && Number(row.nrpInclusive || 0) <= 0 && draftNumber(line.qty ?? line.quantity) > 0) issues.push({ key: 'nrp', message: 'NRP missing', blocking: true });
  const nrpValue = Number(line.nrpInput || 0);
  const specialValue = Number(line.specialInput || 0);
  if (nrpValue < 0 || (line.nrpMode === 'PERCENT_OFF_MRP' && nrpValue > 100)) issues.push({ key: 'nrpInput', message: 'Discount must be 0 to 100%', blocking: true });
  if (specialValue < 0 || (line.specialMode === 'PERCENT_OFF_NRP' && specialValue > 100)) issues.push({ key: 'special', message: 'Special discount must be 0 to 100%', blocking: true });
  if (line.specialMode === 'FIXED_SPECIAL_RATE' && row && specialValue > Number(row.nrpInclusive || 0)) issues.push({ key: 'special', message: 'Special rate is above NRP', blocking: true });
  if (line.specialMode === 'FIXED_SPECIAL_RATE' && specialValue <= 0) issues.push({ key: 'special', message: 'Enter the special rate', blocking: true });
  if (row && Number(line.floorPriceInclusive || 0) > 0 && Number(row.finalUnitPayable || 0) > 0 && Number(row.finalUnitPayable) + 0.005 < Number(line.floorPriceInclusive)) {
    issues.push({ key: 'floor', message: `Below floor ${money(line.floorPriceInclusive)} · owner approval`, blocking: false });
  }
  return issues;
}

// Payload sent to createQuote / updateQuote. The server re-prices every line
// from Product Master, so these totals are informational only.
export function serializeLines(lines: Line[], rows: Map<string, any>, taxMode: TaxMode, discountType: DiscountMode, discountValue: unknown, taxTreatment?: string) {
  return JSON.stringify(lines.map((line) => {
    const row = rows.get(line._k) || {};
    const { _k, _removed, ...persisted } = line;
    return {
      ...persisted,
      taxTreatment: taxTreatment || persisted.taxTreatment || 'EXCLUSIVE',
      wastagePercent: 0,
      qty: draftNumber(persisted.qty ?? persisted.quantity),
      quantity: draftNumber(persisted.qty ?? persisted.quantity),
      requestedArea: draftNumber(persisted.requestedArea),
      requestedPieces: draftNumber(persisted.requestedPieces),
      pricingVersion: 'unified_retail_v1',
      taxRate: taxMode === 'non_gst' ? 0 : Number(line.taxRate ?? 18),
      priceRateBasis: pricingBasis(line),
      pricingUom: line.pricingUom,
      mrpInclusive: row.mrpInclusive,
      mrpSource: 'PRODUCT_MASTER',
      floorPriceInclusive: line.floorPriceInclusive ?? null,
      nrpMode: row.nrpMode,
      nrpInput: row.nrpInput,
      nrpInclusive: row.nrpInclusive,
      nrpExclusive: row.nrpExclusive,
      specialMode: row.specialMode,
      specialInput: row.specialInput,
      specialRateInclusive: row.specialRateInclusive,
      specialRateExclusive: row.specialRateExclusive,
      pricingQuantity: row.pricingQuantity,
      quoteDiscountMode: discountType,
      quoteDiscountValue: Number(discountValue || 0),
      quoteDiscountAllocatedInclusive: row.quoteDiscountAllocatedInclusive,
      taxableValue: row.taxableValue,
      taxAmount: row.taxAmount,
      grossLineTotal: row.total,
      total: row.total,
    };
  }));
}

// Fingerprint of what decides price and quantity, used to tell a revision
// apart from a settings-only edit. Mirrors the server's comparison.
export function commercialFingerprint(lines: Line[], taxMode: TaxMode, discountType: DiscountMode, discountValue: unknown) {
  return JSON.stringify({
    taxMode,
    discount: [discountType, draftNumber(discountValue)],
    lines: lines.filter((line) => !line._removed).map((line) => [
      line.productId, String(line.area || DEFAULT_AREA).trim(), draftNumber(line.qty ?? line.quantity), draftNumber(line.requestedArea), draftNumber(line.requestedPieces),
      line.nrpMode || 'PERCENT_OFF_MRP', draftNumber(line.nrpInput), line.specialMode || 'NONE', draftNumber(line.specialInput), taxMode === 'non_gst' ? 0 : draftNumber(line.taxRate ?? 18),
    ]),
  });
}

export function lineChanges(line: Line, base: Line | undefined) {
  if (!base) return ['added'];
  const out: string[] = [];
  const tile = isTileLine(line);
  if (tile && draftNumber(base.requestedArea) !== draftNumber(line.requestedArea)) out.push(`area ${draftNumber(base.requestedArea)} → ${draftNumber(line.requestedArea)}`);
  if (draftNumber(base.qty ?? base.quantity) !== draftNumber(line.qty ?? line.quantity)) out.push(`qty ${draftNumber(base.qty ?? base.quantity)} → ${draftNumber(line.qty ?? line.quantity)}`);
  if ((base.nrpMode || 'PERCENT_OFF_MRP') !== (line.nrpMode || 'PERCENT_OFF_MRP') || draftNumber(base.nrpInput) !== draftNumber(line.nrpInput)) out.push('NRP changed');
  if ((base.specialMode || 'NONE') !== (line.specialMode || 'NONE') || draftNumber(base.specialInput) !== draftNumber(line.specialInput)) out.push('special changed');
  if (draftNumber(base.taxRate ?? 18) !== draftNumber(line.taxRate ?? 18)) out.push('GST changed');
  if (String(base.area || '') !== String(line.area || '')) out.push(`moved from ${base.area}`);
  return out;
}

export function revisionLetter(versionNumber: number) {
  let n = Math.max(0, Math.trunc(Number(versionNumber || 1)) - 1);
  let letters = '';
  while (n > 0) {
    n -= 1;
    letters = String.fromCharCode(97 + (n % 26)) + letters;
    n = Math.floor(n / 26);
  }
  return letters;
}
export function baseQuoteNumber(quote: any) {
  const meta = quote?.quoteMeta || {};
  if (meta.baseQuoteNumber) return String(meta.baseQuoteNumber);
  const number = String(quote?.quoteNumber || '');
  const suffix = revisionLetter(Number(quote?.versionNumber || 1));
  return suffix && number.endsWith(suffix) ? number.slice(0, -suffix.length) : number;
}

// --- legacy quotes (saved before the unified retail ladder) ---
function legacyNegotiatedRate(line: any, pricingQuantity: number) {
  const direct = [line.specialRateInclusive, line.netSellingPrice, line.nrpInclusive, line.sellingPrice, line.rate].map(Number).find((value) => Number.isFinite(value) && value > 0);
  if (direct) return direct;
  const total = Number(line.grossLineTotal ?? line.total ?? line.lineTotal ?? 0);
  if (Number.isFinite(total) && total > 0 && pricingQuantity > 0) return Number((total / pricingQuantity).toFixed(2));
  const legacyUnit = Number(line.unitPrice ?? line.price ?? 0);
  return Number.isFinite(legacyUnit) && legacyUnit > 0 ? legacyUnit : 0;
}

export function prepareLegacyLine(line: any, product: any) {
  const isTile = String(product?.category || line.category || '').toLowerCase() === 'tiles';
  const tileUom = tilePriceUom(product?.priceUom || line.pricingUom);
  const basis = isTile ? tilePriceBasis(tileUom) : String(product?.priceRateBasis || line.priceRateBasis || line.rateBasis || 'BOX').toUpperCase().replace('PACK', 'BOX');
  const qty = Number(line.qty || line.quantity || 0);
  const geometry = isTile && product ? tileStockUnitGeometry(product) : null;
  const piecesPerPack = geometry?.piecesPerUnit ?? Number(product?.piecesPerPack || line.piecesPerPack || line.pcsPerBox || 1);
  const coveragePerPack = geometry?.coveragePerUnitSqFt ?? Number(product?.coveragePerPack || line.coveragePerPack || 0);
  const pricingCoveragePerPack = isTile ? tilePricingCoverage(coveragePerPack, tileUom) : coveragePerPack;
  const pricingQuantity = basis === 'AREA' ? qty * pricingCoveragePerPack : basis === 'PIECE' ? qty * piecesPerPack : qty;
  const legacyRate = legacyNegotiatedRate(line, pricingQuantity);
  const fallbackRate = legacyRate > 0 ? legacyRate : Number(product?.defaultNrpInclusive || 0);
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
    pricingUom: isTile ? tileUom : String(product?.priceUom || line.pricingUom || (basis === 'PIECE' ? 'PC' : product?.salesUom || product?.unit || line.unit || 'BOX')).toUpperCase(),
    inventoryUom: String(product?.purchaseUom || line.inventoryUom || line.purchaseUom || line.unit || 'BOX').toUpperCase(),
    piecesPerPack,
    pcsPerBox: piecesPerPack,
    coveragePerPack,
    pricingCoveragePerPack,
    nrpMode: 'FIXED_NRP',
    nrpInput: fallbackRate > 0 ? fallbackRate : 0,
    specialMode: 'NONE',
    specialInput: 0,
    area: line.area || DEFAULT_AREA,
    quoteImage: line.quoteImage || line.customImageUrl || '',
    legacyPricingPrepared: Boolean(product),
  };
}

export function quoteFamilyBrandIds(settings: any, brands: any[], quoteType: string) {
  const tile = quoteType === 'tile';
  const mode = String(tile ? settings.tileQuoteBrandSelectionMode ?? settings.quoteBrandSelectionMode ?? 'all' : settings.cpSanitaryQuoteBrandSelectionMode ?? settings.quoteBrandSelectionMode ?? 'all');
  const configuredIds = tile ? settings.tileQuoteBrandIds ?? settings.quoteBrandIds ?? [] : settings.cpSanitaryQuoteBrandIds ?? settings.quoteBrandIds ?? [];
  const configured = new Set((Array.isArray(configuredIds) ? configuredIds : []).map(String));
  return mode === 'none' ? [] : brands.filter((brand: any) => mode === 'all' || configured.has(String(brand.id))).map((brand: any) => String(brand.id));
}

export { draftNumber, tilePriceUom, tilePricingCoverage };
export type { DiscountMode };
