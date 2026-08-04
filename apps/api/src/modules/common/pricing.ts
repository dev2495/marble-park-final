import { BadRequestException } from '@nestjs/common';

export const DEFAULT_TAX_RATE = 18;

export type CommercialTotals = {
  subtotal: number;
  lineDiscountAmount: number;
  quoteDiscountAmount: number;
  taxableValue: number;
  taxAmount: number;
  grandTotal: number;
};

export type QuotePricingOptions = {
  /** Require a positive tax-inclusive MRP for a commercial action. */
  requireMrp?: boolean;
  /** Extra rupee tolerance for decimal/rounding differences at the MRP edge. */
  mrpTolerance?: number;
};

export type PricingIssue = {
  code: 'QUOTE_MRP_REQUIRED' | 'QUOTE_MRP_INVALID' | 'QUOTE_MRP_EXCEEDED' | 'QUOTE_MRP_BASIS_STALE';
  field: string;
  lineKey: string;
  message: string;
  remediation: string;
  maximumPreTaxNetRate?: number;
};

function structuredPricingError(issue: PricingIssue): never {
  throw new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    ...issue,
  });
}

function money(value: unknown) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) throw new BadRequestException('Commercial values must be valid numbers');
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function percent(value: unknown, fallback = 0, label = 'Discount') {
  if (value === undefined || value === null || value === '') return fallback;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 100) {
    throw new BadRequestException(`${label} must be between 0 and 100`);
  }
  return money(amount);
}

function hasRate(value: any) {
  return value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value));
}

function rateBasis(line: any) {
  const explicit = String(line?.rateBasis || '').trim().toUpperCase();
  if (['PACK', 'PIECE', 'AREA'].includes(explicit)) return explicit;
  const uom = String(line?.pricingUom || line?.salesUom || line?.unit || 'PC').trim().toUpperCase();
  return ['SQFT', 'SQM', 'M2'].includes(uom) ? 'AREA' : uom === 'PC' ? 'PIECE' : 'PACK';
}

function pricingUom(line: any, basis: string) {
  if (basis === 'AREA') return String(line?.pricingUom || line?.salesUom || 'SQFT').trim().toUpperCase();
  if (basis === 'PIECE') return 'PC';
  return String(line?.inventoryUom || line?.purchaseUom || line?.unit || 'PACK').trim().toUpperCase();
}

function mrpSnapshot(line: any, lineIndex: number, unitRate: number, quoteDiscountPercent: number, taxRate: number, options: QuotePricingOptions) {
  const raw = line?.mrp;
  const hasMrp = raw !== undefined && raw !== null && raw !== '';
  const numericMrp = hasMrp ? Number(raw) : null;
  const mrp = numericMrp !== null && Number.isFinite(numericMrp) ? money(numericMrp) : null;
  const basis = rateBasis(line);
  const mrpRateBasis = String(line?.mrpRateBasis || basis).trim().toUpperCase();
  const uom = pricingUom(line, basis);
  const finalUnitPayable = money(unitRate * (1 - quoteDiscountPercent / 100) * (1 + taxRate / 100));
  const tolerance = Math.max(0, Number(options.mrpTolerance ?? 0.5));
  const lineKey = String(line?.lineKey || line?.id || line?.sku || `line-${lineIndex + 1}`);
  const field = `lines[${lineIndex}].mrp`;
  const missing = !hasMrp;
  const invalid = hasMrp && (mrp === null || mrp <= 0);
  const staleBasis = !missing && !invalid && mrpRateBasis !== basis;
  const exceeded = !missing && !invalid && !staleBasis && finalUnitPayable > Number(mrp) + tolerance;
  const maximumPreTaxNetRate = mrp === null ? undefined : money(Number(mrp) / (1 + taxRate / 100) / Math.max(0.000001, 1 - quoteDiscountPercent / 100));
  const issue: PricingIssue | null = missing
    ? { code: 'QUOTE_MRP_REQUIRED', field, lineKey, message: `Enter MRP / ${uom} for ${line?.sku || line?.name || `line ${lineIndex + 1}`} before confirming this quote.`, remediation: `Open line ${lineIndex + 1} and enter the tax-inclusive MRP for one ${uom}.` }
    : invalid
      ? { code: 'QUOTE_MRP_INVALID', field, lineKey, message: `MRP / ${uom} for ${line?.sku || line?.name || `line ${lineIndex + 1}`} must be a finite number greater than zero.`, remediation: `Replace the MRP on line ${lineIndex + 1} with the tax-inclusive package or price-list value.` }
      : staleBasis
        ? { code: 'QUOTE_MRP_BASIS_STALE', field, lineKey, message: `MRP for ${line?.sku || line?.name || `line ${lineIndex + 1}`} was confirmed for ${mrpRateBasis}, not ${basis}.`, remediation: `Review the converted suggestion and confirm a new MRP / ${uom} on line ${lineIndex + 1}.` }
        : exceeded
          ? { code: 'QUOTE_MRP_EXCEEDED', field, lineKey, message: `${line?.sku || line?.name || 'Quote line'} payable ${finalUnitPayable.toFixed(2)} per ${uom} exceeds MRP ${Number(mrp).toFixed(2)}.`, remediation: `Reduce the pre-tax negotiated rate to ${Number(maximumPreTaxNetRate).toFixed(2)} or less, or verify the correct MRP.`, maximumPreTaxNetRate }
          : null;
  if (options.requireMrp && issue) structuredPricingError(issue);
  return {
    mrp,
    mrpRateBasis,
    mrpSource: String(line?.mrpSource || 'quote_entry'),
    mrpUom: uom,
    finalUnitPayable,
    mrpVariance: mrp === null ? null : money(Number(mrp) - finalUnitPayable),
    mrpMissing: missing,
    mrpValid: !issue,
    pricingCompletenessCode: issue?.code || 'READY',
    pricingRemediation: issue?.remediation || null,
    pricingIssue: issue,
  };
}

export function finalUnitRate(line: any) {
  const listPrice = money(line.listPrice ?? line.price ?? line.sellPrice ?? 0);
  if (listPrice < 0) throw new BadRequestException('List price must be zero or greater');
  const discountPercent = percent(line.discountPercent ?? line.discount, 0, 'Line discount');
  const specialRaw = hasRate(line.specialRate) ? line.specialRate : hasRate(line.specialPrice) ? line.specialPrice : undefined;
  const unitRate = specialRaw === undefined
    ? money(listPrice * (1 - discountPercent / 100))
    : money(specialRaw);
  if (unitRate < 0) throw new BadRequestException('Negotiated rate must be zero or greater');
  return { listPrice, discountPercent, unitRate };
}

function commercialQuantity(line: any, inventoryQuantity: number) {
  const basis = rateBasis(line);
  if (!['PACK', 'PIECE', 'AREA'].includes(basis)) throw new BadRequestException('Rate basis must be PACK, PIECE, or AREA');
  const piecesPerPack = Math.max(1, Math.trunc(Number(line.piecesPerPack || line.pcsPerBox || 1)));
  const coveragePerPack = Number(line.coveragePerPack || 0);
  if (basis === 'AREA' && (!Number.isFinite(coveragePerPack) || coveragePerPack <= 0)) {
    throw new BadRequestException(`${line.sku || line.name || 'Area-priced item'} needs positive coverage per pack in Product Master`);
  }
  const pricingQuantity = basis === 'PIECE'
    ? inventoryQuantity * piecesPerPack
    : basis === 'AREA' ? money(inventoryQuantity * coveragePerPack) : inventoryQuantity;
  return { basis, piecesPerPack, coveragePerPack, pricingQuantity };
}

export function priceQuoteLines(lines: any[], quoteDiscountPercent: unknown = 0, options: QuotePricingOptions = {}) {
  const normalizedQuoteDiscount = percent(quoteDiscountPercent, 0, 'Quote discount');
  let totals: CommercialTotals = {
    subtotal: 0,
    lineDiscountAmount: 0,
    quoteDiscountAmount: 0,
    taxableValue: 0,
    taxAmount: 0,
    grandTotal: 0,
  };
  let requiresApproval = false;

  const pricedLines = (Array.isArray(lines) ? lines : []).map((line, lineIndex) => {
    const quantity = Math.trunc(Number(line.qty ?? line.quantity ?? 0));
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new BadRequestException('Each commercial line needs a positive whole-number quantity');
    }
    const { basis, piecesPerPack, coveragePerPack, pricingQuantity } = commercialQuantity(line, quantity);
    const { listPrice, discountPercent, unitRate } = finalUnitRate(line);
    const taxRate = percent(line.taxRate, DEFAULT_TAX_RATE, 'Tax rate');
    const mrp = mrpSnapshot(line, lineIndex, unitRate, normalizedQuoteDiscount, taxRate, options);
    const listAmount = money(pricingQuantity * listPrice);
    const lineSubtotal = money(pricingQuantity * unitRate);
    const lineDiscountAmount = money(Math.max(0, listAmount - lineSubtotal));
    const quoteDiscountAmount = money(lineSubtotal * normalizedQuoteDiscount / 100);
    const taxableValue = money(lineSubtotal - quoteDiscountAmount);
    const taxAmount = money(taxableValue * taxRate / 100);
    const grossLineTotal = money(taxableValue + taxAmount);
    const floorPrice = money(line.floorPrice ?? 0);
    const belowFloor = floorPrice > 0 && unitRate < floorPrice;
    requiresApproval ||= belowFloor;

    totals = {
      subtotal: money(totals.subtotal + lineSubtotal),
      lineDiscountAmount: money(totals.lineDiscountAmount + lineDiscountAmount),
      quoteDiscountAmount: money(totals.quoteDiscountAmount + quoteDiscountAmount),
      taxableValue: money(totals.taxableValue + taxableValue),
      taxAmount: money(totals.taxAmount + taxAmount),
      grandTotal: money(totals.grandTotal + grossLineTotal),
    };

    return {
      ...line,
      qty: quantity,
      quantity,
      inventoryQuantity: quantity,
      pricingQuantity,
      rateBasis: basis,
      piecesPerPack,
      coveragePerPack,
      price: listPrice,
      sellPrice: listPrice,
      listPrice,
      discountPercent,
      specialRate: unitRate === listPrice && discountPercent === 0 ? null : unitRate,
      unitRate,
      taxRate,
      listAmount,
      lineDiscountAmount,
      quoteDiscountPercent: normalizedQuoteDiscount,
      quoteDiscountAmount,
      taxableValue,
      taxAmount,
      grossLineTotal,
      total: grossLineTotal,
      floorPrice,
      belowFloor,
      ...mrp,
    };
  });

  return {
    lines: pricedLines,
    totals,
    requiresApproval,
    quoteDiscountPercent: normalizedQuoteDiscount,
    pricingErrors: pricedLines.map((line: any) => line.pricingIssue).filter(Boolean),
  };
}

export function commercialTotalsFromLines(lines: any[]) {
  return (Array.isArray(lines) ? lines : []).reduce<CommercialTotals>((totals, line) => {
    const gross = money(line.grossLineTotal ?? line.total ?? line.lineTotal ?? 0);
    const taxable = money(line.taxableValue ?? gross);
    const tax = money(line.taxAmount ?? 0);
    const unitRate = money(line.unitRate ?? line.specialRate ?? line.price ?? line.sellPrice ?? 0);
    const quantity = Math.trunc(Number(line.qty ?? line.quantity ?? 0));
    const pricingQuantity = Number(line.pricingQuantity ?? commercialQuantity(line, Math.max(0, quantity)).pricingQuantity);
    const subtotal = money(unitRate * Math.max(0, pricingQuantity));
    return {
      subtotal: money(totals.subtotal + subtotal),
      lineDiscountAmount: money(totals.lineDiscountAmount + money(line.lineDiscountAmount ?? 0)),
      quoteDiscountAmount: money(totals.quoteDiscountAmount + money(line.quoteDiscountAmount ?? 0)),
      taxableValue: money(totals.taxableValue + taxable),
      taxAmount: money(totals.taxAmount + tax),
      grandTotal: money(totals.grandTotal + gross),
    };
  }, { subtotal: 0, lineDiscountAmount: 0, quoteDiscountAmount: 0, taxableValue: 0, taxAmount: 0, grandTotal: 0 });
}
