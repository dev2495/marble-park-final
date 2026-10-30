import { priceQuoteLines, priceUnit } from '@marble-park/pricing-contract';

export type DiscountMode = 'PERCENT' | 'FIXED_AMOUNT';
export type TaxTreatment = 'INCLUSIVE' | 'EXCLUSIVE';

export function roundMoney(value: number) {
  return Number(Number(value || 0).toFixed(2));
}

// Typed values arrive as strings ('', '05', '5.') while the user is editing.
// Treat anything that is not a usable non-negative number as 0 for pricing.
export function draftNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function taxTreatmentOf(line: any): TaxTreatment {
  return String(line?.taxTreatment || '').toUpperCase() === 'EXCLUSIVE' ? 'EXCLUSIVE' : 'INCLUSIVE';
}

function unitInput(line: any, taxRate: number) {
  return {
    ...line,
    mrpInclusive: draftNumber(line.mrpInclusive ?? line.mrp),
    priceRateBasis: line.priceRateBasis || line.mrpRateBasis || line.rateBasis,
    lineRateBasis: line.rateBasis || line.priceRateBasis || line.mrpRateBasis,
    nrpMode: line.nrpMode || 'PERCENT_OFF_MRP',
    nrpInput: draftNumber(line.nrpInput),
    specialMode: line.specialMode || 'NONE',
    specialInput: draftNumber(line.specialInput),
    taxRate: draftNumber(taxRate),
    taxTreatment: taxTreatmentOf(line),
  };
}

export function retailLadder(line: any, pricingQuantity: number, taxRate: number) {
  let priced: any;
  let pricingError: any = null;
  try {
    priced = priceUnit(unitInput(line, taxRate), { requireComplete: false });
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
      taxRate: draftNumber(taxRate),
      taxTreatment: taxTreatmentOf(line),
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

function contractRow(row: any) {
  return {
    ...row,
    pricingQuantity: row.pricingQuantity,
    priceRateBasis: row.priceRateBasis || row.mrpRateBasis || row.rateBasis,
    lineRateBasis: row.rateBasis || row.priceRateBasis || row.mrpRateBasis,
    mrpInclusive: row.pricingError ? 0 : draftNumber(row.mrpInclusive ?? row.mrp),
    nrpMode: row.pricingError ? 'PERCENT_OFF_MRP' : (row.nrpMode || 'PERCENT_OFF_MRP'),
    nrpInput: row.pricingError ? 0 : draftNumber(row.nrpInput),
    specialMode: row.pricingError ? 'NONE' : (row.specialMode || 'NONE'),
    specialInput: row.pricingError ? 0 : draftNumber(row.specialInput),
    taxRate: draftNumber(row.taxRate),
    taxTreatment: taxTreatmentOf(row),
  };
}

function withLadderAliases(line: any) {
  return {
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
    // Value after every discount and before GST is added (EXCLUSIVE), or the
    // GST-inclusive value (legacy INCLUSIVE). The MRP ceiling uses this.
    grossAfterQuoteDiscount: taxTreatmentOf(line) === 'EXCLUSIVE' ? line.taxableValue : line.grossLineTotal,
  };
}

// A row that cannot be priced yet (no quantity, invalid input) still renders.
function unpricedRow(row: any, pricingError: any) {
  return withLadderAliases({
    ...row,
    taxTreatment: taxTreatmentOf(row),
    mrpInclusive: draftNumber(row.mrpInclusive ?? row.mrp),
    nrpInclusive: 0,
    specialRateInclusive: 0,
    specialRateExclusive: 0,
    specialValueInclusive: 0,
    quoteDiscountAllocatedInclusive: 0,
    taxableValue: 0,
    taxAmount: 0,
    grossLineTotal: 0,
    nrpValueInclusive: 0,
    pricingError: row.pricingError || pricingError,
  });
}

function priceRows(rows: any[], mode: DiscountMode, value: number) {
  return priceQuoteLines(rows.map(contractRow), { mode, value }, { requireComplete: false }).lines;
}

export type QuoteDraftPricing<T> = { rows: (T & Record<string, any>)[]; discountError: { code: string; message: string } | null };

// Prices a quote that is still being typed. It never throws: unusable rows and
// impossible quote discounts are reported instead of crashing the page.
export function priceQuoteDraft<T extends Record<string, any>>(rows: T[], mode: DiscountMode, value: unknown): QuoteDraftPricing<T> {
  const discountValue = draftNumber(value);
  const priceable = rows.filter((row) => draftNumber(row.pricingQuantity) > 0);
  let priced: any[] = [];
  let discountError: QuoteDraftPricing<T>['discountError'] = null;
  try {
    priced = priceRows(priceable, mode, discountValue);
  } catch (error: any) {
    discountError = { code: error?.code || 'PRICING_INVALID', message: error?.message || 'Quote pricing is invalid.' };
    try {
      priced = priceRows(priceable, mode, 0);
    } catch {
      priced = priceable.map((row) => {
        try { return priceRows([row], mode, 0)[0]; } catch (rowError: any) {
          return unpricedRow(row, { code: rowError?.code || 'PRICING_INVALID', field: rowError?.field || 'pricing', message: rowError?.message || 'Pricing is invalid.' });
        }
      });
    }
  }
  const pricedByRow = new Map(priceable.map((row, index) => [row, priced[index]]));
  return {
    rows: rows.map((row) => {
      const line = pricedByRow.get(row);
      return line
        ? withLadderAliases(line)
        : unpricedRow(row, { code: 'QUANTITY_REQUIRED', field: 'quantity', message: 'Enter a quantity to price this line.' });
    }),
    discountError,
  };
}

export function allocateQuoteDiscount<T extends Record<string, any>>(rows: T[], mode: DiscountMode, value: number) {
  return priceQuoteDraft(rows, mode, value).rows;
}
