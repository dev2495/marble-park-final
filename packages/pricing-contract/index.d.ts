export const PRICING_VERSION: 'unified_retail_v1';
export const NRP_MODES: { readonly PERCENT_OFF_MRP: 'PERCENT_OFF_MRP'; readonly FIXED_NRP: 'FIXED_NRP' };
export const SPECIAL_MODES: { readonly NONE: 'NONE'; readonly PERCENT_OFF_NRP: 'PERCENT_OFF_NRP'; readonly FIXED_SPECIAL_RATE: 'FIXED_SPECIAL_RATE' };
export const QUOTE_DISCOUNT_MODES: { readonly PERCENT: 'PERCENT'; readonly FIXED_AMOUNT: 'FIXED_AMOUNT' };
export class PricingContractError extends Error { code: string; field: string; remediation: string; }
export function priceUnit(input: Record<string, unknown>, options?: { requireComplete?: boolean; allowSpecialAboveNrp?: boolean }): any;
export function priceQuoteLines(lines: Array<Record<string, unknown>>, quoteDiscount?: { mode?: string; type?: string; value?: unknown }, options?: { requireComplete?: boolean; allowSpecialAboveNrp?: boolean; preserveAllocatedDiscount?: boolean }): { lines: any[]; totals: Record<string, number>; quoteDiscountMode: string; quoteDiscountValue: number };
