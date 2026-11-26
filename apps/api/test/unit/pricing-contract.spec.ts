// Pure money maths. These rules must not change: exact paise (BigInt), half-up rounding,
// MRP -> NRP -> special -> whole-quote discount, GST inclusive or exclusive.
const contract = require('@marble-park/pricing-contract');
const { priceUnit, priceQuoteLines, PricingContractError } = contract;

const base = { priceRateBasis: 'BOX', mrpInclusive: 1180, nrpMode: 'PERCENT_OFF_MRP', nrpInput: 0 };
const line = (over: any = {}) => ({ quantity: 1, priceRateBasis: 'BOX', mrpInclusive: 100, nrpInput: 0, ...over });

function code(fn: () => unknown): string {
  try { fn(); } catch (e: any) { expect(e).toBeInstanceOf(PricingContractError); return e.code; }
  throw new Error('expected PricingContractError');
}

describe('priceUnit: NRP and special rate', () => {
  it('NRP as percent off MRP is rounded half-up to the paisa', () => {
    const r = priceUnit({ ...base, nrpInput: 15 });
    expect(r.mrpPaise).toBe(118000n);
    expect(r.nrpPaise).toBe(100300n);
    expect(r.nrpInclusive).toBe(1003);
  });
  it('fixed NRP is used as entered, even above MRP (MRP is a reference, not a ceiling)', () => {
    const r = priceUnit({ ...base, nrpMode: 'FIXED_NRP', nrpInput: 1500 });
    expect(r.nrpPaise).toBe(150000n);
  });
  it('percent rounding: 0.5 paisa rounds up, 0.4 paisa rounds down', () => {
    expect(priceUnit({ ...base, mrpInclusive: 0.05, nrpInput: 50 }).nrpPaise).toBe(2n); // 2.5p off rounds up to 3p, 5p - 3p = 2p
    expect(priceUnit({ ...base, mrpInclusive: 0.05, nrpInput: 40 }).nrpPaise).toBe(3n); // 2p off, exact
  });
  it('special percent off NRP and fixed special rate', () => {
    const pct = priceUnit({ ...base, nrpMode: 'FIXED_NRP', nrpInput: 1000, specialMode: 'PERCENT_OFF_NRP', specialInput: 10 });
    expect(pct.specialRatePaise).toBe(90000n);
    const fixed = priceUnit({ ...base, nrpMode: 'FIXED_NRP', nrpInput: 1000, specialMode: 'FIXED_SPECIAL_RATE', specialInput: 850.5 });
    expect(fixed.specialRatePaise).toBe(85050n);
  });
  it('special rate above NRP is refused unless an override is allowed', () => {
    const input = { ...base, nrpMode: 'FIXED_NRP', nrpInput: 1000, specialMode: 'FIXED_SPECIAL_RATE', specialInput: 1001 };
    expect(code(() => priceUnit(input))).toBe('SPECIAL_ABOVE_NRP');
    expect(priceUnit(input, { allowSpecialAboveNrp: true }).specialRatePaise).toBe(100100n);
  });
  it('requires a positive MRP, NRP and special rate for a commercial action', () => {
    expect(code(() => priceUnit({ ...base, mrpInclusive: 0 }))).toBe('PRICE_INVALID'); // zero MRP is caught by the money parser first
    expect(code(() => priceUnit({ ...base, nrpInput: 100 }))).toBe('NRP_REQUIRED');
    expect(code(() => priceUnit({ ...base, nrpMode: 'FIXED_NRP', nrpInput: 500, specialMode: 'FIXED_SPECIAL_RATE', specialInput: 0 }))).toBe('PRICE_INVALID');
    expect(code(() => priceUnit({ ...base, nrpMode: 'FIXED_NRP', nrpInput: 500, specialMode: 'PERCENT_OFF_NRP', specialInput: 100 }))).toBe('SPECIAL_RATE_INVALID');
  });
  it('a draft (requireComplete false) may leave prices at zero', () => {
    const r = priceUnit({ ...base, mrpInclusive: 0 }, { requireComplete: false });
    expect(r.mrpPaise).toBe(0n);
  });
  it('rejects negative, non-numeric and out-of-range inputs', () => {
    expect(code(() => priceUnit({ ...base, mrpInclusive: -1 }))).toBe('PRICE_INVALID');
    expect(code(() => priceUnit({ ...base, mrpInclusive: 'abc' }))).toBe('PRICE_INVALID');
    expect(code(() => priceUnit({ ...base, nrpInput: 101 }))).toBe('PERCENT_INVALID');
    expect(code(() => priceUnit({ ...base, nrpInput: -1 }))).toBe('PERCENT_INVALID');
    expect(code(() => priceUnit({ ...base, nrpMode: 'WHATEVER' }))).toBe('NRP_MODE_INVALID');
    expect(code(() => priceUnit({ ...base, specialMode: 'WHATEVER' }))).toBe('SPECIAL_MODE_INVALID');
  });
  it('100 percent off NRP leaves nothing to sell and is refused', () => {
    expect(code(() => priceUnit({ ...base, nrpInput: 100 }))).toBe('NRP_REQUIRED');
  });
  it('float noise does not break parsing (0.1 + 0.2, 1e-7)', () => {
    expect(priceUnit({ ...base, mrpInclusive: 0.1 + 0.2 }).mrpPaise).toBe(30n);
    expect(priceUnit({ ...base, mrpInclusive: 1e-7 }, { requireComplete: false }).mrpPaise).toBe(0n);
  });
  it('accepts decimal strings', () => {
    expect(priceUnit({ ...base, mrpInclusive: '1180.50' }).mrpPaise).toBe(118050n);
  });
});

describe('priceUnit: basis', () => {
  it('PACK means BOX and PC means PIECE', () => {
    expect(priceUnit({ ...base, priceRateBasis: 'PACK', lineRateBasis: 'BOX' }).priceRateBasis).toBe('BOX');
    expect(priceUnit({ ...base, priceRateBasis: 'PC', lineRateBasis: 'PIECE' }).priceRateBasis).toBe('PIECE');
  });
  it('refuses a price confirmed for one basis used on another (no guessed conversion)', () => {
    expect(code(() => priceUnit({ ...base, priceRateBasis: 'BOX', lineRateBasis: 'PIECE' }))).toBe('PRICE_BASIS_STALE');
  });
  it('refuses an unknown basis', () => {
    expect(code(() => priceUnit({ ...base, priceRateBasis: 'KG' }))).toBe('PRICE_BASIS_INVALID');
  });
});

describe('priceUnit: GST', () => {
  it('inclusive: tax is carved out of the price (1003 at 18% -> 850 + 153)', () => {
    const r = priceUnit({ ...base, nrpInput: 15 });
    expect(r.taxablePaise).toBe(85000n);
    expect(r.taxPaise).toBe(15300n);
    expect(r.specialRateWithTax).toBe(1003);
  });
  it('exclusive: tax is added on top', () => {
    const r = priceUnit({ ...base, nrpMode: 'FIXED_NRP', nrpInput: 1000, taxTreatment: 'EXCLUSIVE' });
    expect(r.taxablePaise).toBe(100000n);
    expect(r.taxPaise).toBe(18000n);
    expect(r.specialRateWithTax).toBe(1180);
  });
  it('defaults to inclusive and to 18 percent', () => {
    const r = priceUnit({ ...base });
    expect(r.taxTreatment).toBe('INCLUSIVE');
    expect(r.taxRate).toBe(18);
  });
  it('taxable plus tax always equals the price (no paisa lost)', () => {
    for (const mrp of [1, 7.77, 99.99, 1234.56, 100000.01]) {
      for (const rate of [0, 5, 12, 18, 28]) {
        const r = priceUnit({ ...base, mrpInclusive: mrp, taxRate: rate });
        expect(r.taxablePaise + r.taxPaise).toBe(r.specialRatePaise);
      }
    }
  });
  it('0 percent GST has no tax', () => {
    expect(priceUnit({ ...base, taxRate: 0 }).taxPaise).toBe(0n);
  });
});

describe('priceQuoteLines', () => {
  it('prices quantity x special rate exactly, with fractional quantities (tile area)', () => {
    const r = priceQuoteLines([line({ quantity: 12.5, mrpInclusive: 80 })]);
    expect(r.lines[0].grossLineTotal).toBe(1000);
    expect(r.totals.grandTotal).toBe(1000);
  });
  it('rejects zero, negative or missing quantity', () => {
    expect(code(() => priceQuoteLines([line({ quantity: 0 })]))).toBe('QUANTITY_INVALID');
    expect(code(() => priceQuoteLines([line({ quantity: -2 })]))).toBe('QUANTITY_INVALID');
    expect(code(() => priceQuoteLines([line({ quantity: undefined })]))).toBe('QUANTITY_INVALID');
  });
  it('whole-quote percent discount is spread over lines and the last line absorbs rounding', () => {
    const r = priceQuoteLines([line({ quantity: 3 }), line(), line()], { mode: 'FIXED_AMOUNT', value: 10 });
    expect(r.lines.map((l: any) => l.quoteDiscountAllocatedInclusive)).toEqual([6, 2, 2]);
    expect(r.totals.quoteDiscountInclusive).toBe(10);
    expect(r.totals.grandTotal).toBe(490);
  });
  it('the allocations always add up to the discount, however awkward the split', () => {
    const lines = [line({ mrpInclusive: 33.33 }), line({ mrpInclusive: 66.67 }), line({ mrpInclusive: 0.01 })];
    const r = priceQuoteLines(lines, { mode: 'PERCENT', value: 7.5 });
    const sum = r.lines.reduce((s: number, l: any) => s + Math.round(l.quoteDiscountAllocatedInclusive * 100), 0);
    expect(sum).toBe(Math.round(r.totals.quoteDiscountInclusive * 100));
  });
  it('percent discount of the whole quote', () => {
    const r = priceQuoteLines([line({ quantity: 10 })], { mode: 'PERCENT', value: 10 });
    expect(r.totals.quoteDiscountInclusive).toBe(100);
    expect(r.totals.grandTotal).toBe(900);
  });
  it('a fixed discount larger than the quote is refused', () => {
    expect(code(() => priceQuoteLines([line()], { mode: 'FIXED_AMOUNT', value: 100.01 }))).toBe('QUOTE_DISCOUNT_EXCEEDED');
    expect(priceQuoteLines([line()], { mode: 'FIXED_AMOUNT', value: 100 }).totals.grandTotal).toBe(0);
  });
  it('refuses an unknown discount mode', () => {
    expect(code(() => priceQuoteLines([line()], { mode: 'BOGO', value: 1 }))).toBe('QUOTE_DISCOUNT_MODE_INVALID');
  });
  it('preserveAllocatedDiscount keeps stored allocations and refuses one above its line', () => {
    const kept = priceQuoteLines([line({ quoteDiscountAllocatedInclusive: 5 })], {}, { preserveAllocatedDiscount: true });
    expect(kept.lines[0].grossLineTotal).toBe(95);
    expect(code(() => priceQuoteLines([line({ quoteDiscountAllocatedInclusive: 101 })], {}, { preserveAllocatedDiscount: true }))).toBe('QUOTE_DISCOUNT_EXCEEDED');
  });
  it('totals equal the sum of lines; tax plus taxable equals gross', () => {
    const r = priceQuoteLines([line({ quantity: 3, mrpInclusive: 333.33 }), line({ quantity: 7, mrpInclusive: 12.34, nrpInput: 5 })], { mode: 'PERCENT', value: 3 });
    expect(Math.round((r.totals.taxableValue + r.totals.taxAmount) * 100)).toBe(Math.round(r.totals.grandTotal * 100));
  });
  it('empty or missing lines price to zero without error', () => {
    expect(priceQuoteLines([]).totals.grandTotal).toBe(0);
    expect(priceQuoteLines(undefined as any).lines).toEqual([]);
  });
  it('keeps the extra fields the caller sent on each line', () => {
    expect(priceQuoteLines([line({ sku: 'ABC', area: 'Kitchen' })]).lines[0]).toMatchObject({ sku: 'ABC', area: 'Kitchen' });
  });
});

describe('quote-display helpers', () => {
  const { groupQuoteLines, requestedQuantityLabel } = require('@marble-park/pricing-contract/quote-display');
  it('groups by room ignoring case and spacing, keeps distinct rooms apart', () => {
    const g = groupQuoteLines([{ area: 'Kitchen' }, { area: ' kitchen ' }, { area: 'Bath  1' }, { area: 'Bath 2' }, {}]);
    expect(g.map((x: any) => x.rows.length)).toEqual([2, 1, 1, 1]);
    expect(g[3].area).toBe('General Selection');
  });
  it('requested quantity label prefers area, then pieces', () => {
    expect(requestedQuantityLabel({ requestedArea: 100, pricingUom: 'sqft' })).toBe('Requested: 100 SQFT');
    expect(requestedQuantityLabel({ requestedPieces: 4 })).toBe('Requested: 4 PC');
    expect(requestedQuantityLabel({})).toBe('');
  });
});

describe('tile-size', () => {
  const { compactTileSize } = require('@marble-park/pricing-contract/tile-size');
  it('only for tiles, face size only', () => {
    expect(compactTileSize({ category: 'Tiles', tileSize: '600x1200 mm Glossy' })).toBe('600 x 1200 mm');
    expect(compactTileSize({ category: 'Faucets', tileSize: '600x1200' })).toBe('');
    expect(compactTileSize({ category: 'tiles', tileSizeMaster: { widthMm: 300, heightMm: 600 } })).toBe('300 x 600 mm');
    expect(compactTileSize({ category: 'tiles' })).toBe('');
  });
});
