import { priceQuoteLines, priceUnit } from '@marble-park/pricing-contract';

export type DiscountMode = 'PERCENT' | 'FIXED_AMOUNT';

export function roundMoney(value: number) {
  return Number(Number(value || 0).toFixed(2));
}

export function retailLadder(line: any, pricingQuantity: number, taxRate: number) {
  let priced: any;
  let pricingError: any = null;
  try {
    priced = priceUnit({
      ...line,
      mrpInclusive: line.mrpInclusive ?? line.mrp,
      priceRateBasis: line.priceRateBasis || line.mrpRateBasis || line.rateBasis,
      lineRateBasis: line.rateBasis || line.priceRateBasis || line.mrpRateBasis,
      nrpMode: line.nrpMode || 'PERCENT_OFF_MRP',
      nrpInput: line.nrpInput ?? 0,
      specialMode: line.specialMode || 'NONE',
      specialInput: line.specialInput ?? 0,
      taxRate,
    }, { requireComplete: false });
  } catch (error: any) {
    pricingError = { code: error?.code || 'PRICING_INVALID', field: error?.field || 'pricing', message: error?.message || 'Pricing is invalid.' };
    priced = priceUnit({
      mrpInclusive: 0,
      priceRateBasis: line.priceRateBasis || line.mrpRateBasis || line.rateBasis || 'BOX',
      lineRateBasis: line.rateBasis || line.priceRateBasis || line.mrpRateBasis || 'BOX',
      nrpMode: 'PERCENT_OFF_MRP',
      nrpInput: 0,
      specialMode: 'NONE',
      specialInput: 0,
      taxRate,
    }, { requireComplete: false });
  }
  return {
    ...priced,
    pricingQuantity,
    mrp: priced.mrpInclusive,
    safeMrp: priced.mrpInclusive,
    nrp: priced.nrpInclusive,
    baseDiscountType: priced.nrpMode,
    baseDiscountValue: priced.nrpInput,
    baseDiscountAmount: roundMoney(priced.mrpInclusive - priced.nrpInclusive),
    specialDiscountType: priced.specialMode,
    specialDiscountValue: priced.specialInput,
    specialDiscountAmount: roundMoney(priced.nrpInclusive - priced.specialRateInclusive),
    netSellingPrice: priced.specialRateInclusive,
    unitRate: priced.specialRateInclusive,
    grossBeforeQuoteDiscount: roundMoney(pricingQuantity * priced.specialRateInclusive),
    pricingError,
  };
}

export function allocateQuoteDiscount<T extends Record<string, any>>(rows: T[], mode: DiscountMode, value: number) {
  return priceQuoteLines(rows.map((row) => ({
    ...row,
    pricingQuantity: row.pricingQuantity,
    priceRateBasis: row.priceRateBasis || row.mrpRateBasis || row.rateBasis,
    lineRateBasis: row.rateBasis || row.priceRateBasis || row.mrpRateBasis,
    mrpInclusive: row.pricingError ? 0 : (row.mrpInclusive ?? row.mrp),
    nrpMode: row.pricingError ? 'PERCENT_OFF_MRP' : (row.nrpMode || 'PERCENT_OFF_MRP'),
    nrpInput: row.pricingError ? 0 : (row.nrpInput ?? 0),
    specialMode: row.pricingError ? 'NONE' : (row.specialMode || 'NONE'),
    specialInput: row.pricingError ? 0 : (row.specialInput ?? 0),
  })), { mode, value }, { requireComplete: false }).lines.map((line) => ({
    ...line,
    mrp: line.mrpInclusive,
    safeMrp: line.mrpInclusive,
    nrp: line.nrpInclusive,
    baseDiscountType: line.nrpMode,
    baseDiscountValue: line.nrpInput,
    baseDiscountAmount: roundMoney(line.mrpInclusive - line.nrpInclusive),
    specialDiscountType: line.specialMode,
    specialDiscountValue: line.specialInput,
    specialDiscountAmount: roundMoney(line.nrpInclusive - line.specialRateInclusive),
    netSellingPrice: line.specialRateInclusive,
    unitRate: line.specialRateInclusive,
    quoteDiscountAmount: line.quoteDiscountAllocatedInclusive,
    grossBeforeQuoteDiscount: line.specialValueInclusive,
    grossAfterQuoteDiscount: line.grossLineTotal,
  }));
}
