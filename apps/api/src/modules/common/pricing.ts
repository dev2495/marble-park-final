import { BadRequestException } from '@nestjs/common';
import {
  PRICING_VERSION,
  PricingContractError,
  priceQuoteLines as priceCanonicalQuoteLines,
  priceUnit,
} from '@marble-park/pricing-contract';

export const DEFAULT_TAX_RATE = 18;
export const RETAIL_LADDER_VERSION = PRICING_VERSION;

export type CommercialTotals = {
  mrpValueInclusive: number;
  nrpValueInclusive: number;
  specialValueInclusive: number;
  quoteDiscountInclusive: number;
  taxableValue: number;
  taxAmount: number;
  grandTotal: number;
};

export type QuotePricingOptions = { requireMrp?: boolean; requireComplete?: boolean; allowSpecialAboveNrp?: boolean; preserveAllocatedDiscount?: boolean };

function asBadRequest(error: unknown): never {
  if (error instanceof PricingContractError) {
    throw new BadRequestException({ statusCode: 400, error: 'Bad Request', code: error.code, field: error.field, message: error.message, remediation: error.remediation });
  }
  throw error;
}

function normalizeBasis(value: unknown) {
  const raw = String(value || '').toUpperCase();
  if (raw === 'PACK') return 'BOX';
  if (raw === 'PC') return 'PIECE';
  if (['BOX', 'PIECE', 'AREA'].includes(raw)) return raw;
  return '';
}

function inferredBasis(line: any) {
  const uom = String(line?.pricingUom || line?.salesUom || line?.unit || 'PC').toUpperCase();
  return ['SQFT', 'SQM', 'M2'].includes(uom) ? 'AREA' : uom === 'PC' ? 'PIECE' : 'BOX';
}

function canonicalBasis(line: any) {
  return normalizeBasis(line?.lineRateBasis || line?.rateBasis) || normalizeBasis(line?.priceRateBasis || line?.mrpRateBasis) || inferredBasis(line);
}

function commercialQuantity(line: any) {
  const inventoryQuantity = Number(line?.qty ?? line?.quantity ?? 0);
  const basis = canonicalBasis(line);
  const piecesPerPack = Math.max(1, Math.trunc(Number(line?.piecesPerPack || line?.pcsPerBox || 1)));
  const coveragePerPack = Number(line?.coveragePerPack || 0);
  if (basis === 'AREA' && (!Number.isFinite(coveragePerPack) || coveragePerPack <= 0)) {
    throw new BadRequestException(`${line?.sku || line?.name || 'Area-priced item'} needs positive governed coverage per box`);
  }
  return basis === 'PIECE' ? inventoryQuantity * piecesPerPack : basis === 'AREA' ? inventoryQuantity * coveragePerPack : inventoryQuantity;
}

function canonicalLine(line: any) {
  const lineBasis = canonicalBasis(line);
  const priceBasis = normalizeBasis(line?.priceRateBasis || line?.mrpRateBasis) || lineBasis;
  return {
    ...line,
    quantity: Number(line?.qty ?? line?.quantity ?? 0),
    pricingQuantity: Number(line?.pricingQuantity || commercialQuantity(line)),
    priceRateBasis: priceBasis,
    lineRateBasis: lineBasis,
    mrpInclusive: line?.mrpInclusive ?? line?.mrp,
    nrpMode: line?.nrpMode || 'PERCENT_OFF_MRP',
    nrpInput: line?.nrpInput ?? 0,
    specialMode: line?.specialMode || 'NONE',
    specialInput: line?.specialInput ?? 0,
    taxRate: line?.taxRate ?? DEFAULT_TAX_RATE,
  };
}

export function finalUnitRate(line: any) {
  try {
    return priceUnit(canonicalLine(line), { requireComplete: true });
  } catch (error) {
    return asBadRequest(error);
  }
}

export function priceQuoteLines(lines: any[], quoteDiscountInput: any = {}, options: QuotePricingOptions = {}): any {
  try {
    const discount = typeof quoteDiscountInput === 'object' && quoteDiscountInput !== null
      ? { mode: quoteDiscountInput.mode || quoteDiscountInput.type, value: quoteDiscountInput.value }
      : { mode: 'PERCENT', value: quoteDiscountInput };
    const result = priceCanonicalQuoteLines(
      (Array.isArray(lines) ? lines : []).map(canonicalLine),
      discount,
      { requireComplete: options.requireComplete ?? options.requireMrp ?? true, allowSpecialAboveNrp: options.allowSpecialAboveNrp, preserveAllocatedDiscount: options.preserveAllocatedDiscount },
    );
    const floorBreaches = result.lines.flatMap((line: any, index: number) => {
      const floor = Number(line.floorPriceInclusive || 0);
      const quantity = Number(line.pricingQuantity ?? line.quantity ?? line.qty ?? 0);
      const finalUnit = quantity > 0 ? Number(line.grossLineTotal || 0) / quantity : 0;
      return floor > 0 && finalUnit + 0.005 < floor
        ? [{ index, lineKey: line.lineKey || String(index), sku: line.sku, floorPriceInclusive: floor, finalUnitPayable: Number(finalUnit.toFixed(2)) }]
        : [];
    });
    return {
      ...result,
      requiresApproval: floorBreaches.length > 0,
      floorBreaches,
      quoteDiscountType: result.quoteDiscountMode,
      quoteDiscountPercent: result.quoteDiscountMode === 'PERCENT' ? result.quoteDiscountValue : 0,
      pricingErrors: result.lines.flatMap((line: any, index: number) => {
        if (Number(line.mrpInclusive || 0) <= 0) return [{ code: 'MRP_REQUIRED', field: `lines[${index}].mrpInclusive`, lineKey: line.lineKey || String(index), message: 'MRP is required.', remediation: 'Enter and confirm a positive tax-inclusive MRP.' }];
        if (Number(line.nrpInclusive || 0) <= 0) return [{ code: 'NRP_REQUIRED', field: `lines[${index}].nrpInput`, lineKey: line.lineKey || String(index), message: 'Normal Retail Price (NRP) is required.', remediation: 'Enter a positive NRP or % off MRP.' }];
        if (Number(line.specialRateInclusive || 0) <= 0) return [{ code: 'SPECIAL_RATE_INVALID', field: `lines[${index}].specialInput`, lineKey: line.lineKey || String(index), message: 'Final line rate is incomplete.', remediation: 'Complete the line pricing ladder.' }];
        return [];
      }),
      totals: {
        ...result.totals,
        subtotal: result.totals.specialValueInclusive,
        lineDiscountAmount: Number((result.totals.mrpValueInclusive - result.totals.specialValueInclusive).toFixed(2)),
        quoteDiscountAmount: result.totals.quoteDiscountInclusive,
      },
    };
  } catch (error) {
    return asBadRequest(error);
  }
}

export function commercialTotalsFromLines(lines: any[]): CommercialTotals {
  return (Array.isArray(lines) ? lines : []).reduce((totals, line) => ({
    mrpValueInclusive: Number((totals.mrpValueInclusive + Number(line.mrpValueInclusive || 0)).toFixed(2)),
    nrpValueInclusive: Number((totals.nrpValueInclusive + Number(line.nrpValueInclusive || 0)).toFixed(2)),
    specialValueInclusive: Number((totals.specialValueInclusive + Number(line.specialValueInclusive || 0)).toFixed(2)),
    quoteDiscountInclusive: Number((totals.quoteDiscountInclusive + Number(line.quoteDiscountAllocatedInclusive || 0)).toFixed(2)),
    taxableValue: Number((totals.taxableValue + Number(line.taxableValue || line.taxableValueInclusive || 0)).toFixed(2)),
    taxAmount: Number((totals.taxAmount + Number(line.taxAmount || line.taxAmountInclusive || 0)).toFixed(2)),
    grandTotal: Number((totals.grandTotal + Number(line.grossLineTotal || line.grossLineTotalInclusive || line.lineTotal || 0)).toFixed(2)),
  }), { mrpValueInclusive: 0, nrpValueInclusive: 0, specialValueInclusive: 0, quoteDiscountInclusive: 0, taxableValue: 0, taxAmount: 0, grandTotal: 0 });
}
