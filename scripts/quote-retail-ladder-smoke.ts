import assert from 'node:assert/strict';
import { priceQuoteLines, RETAIL_LADDER_VERSION } from '../apps/api/src/modules/common/pricing';

const exact = priceQuoteLines([{
  lineKey: 'exact-example', sku: 'EXAMPLE', quantity: 1, pricingQuantity: 1,
  pricingVersion: RETAIL_LADDER_VERSION, mrpInclusive: 1180,
  priceRateBasis: 'PIECE', rateBasis: 'PIECE', nrpMode: 'PERCENT_OFF_MRP', nrpInput: 10,
  specialMode: 'PERCENT_OFF_NRP', specialInput: 5, taxRate: 18,
}], { mode: 'PERCENT', value: 2 }, { requireMrp: true });
const line = exact.lines[0];
assert.equal(line.mrpInclusive, 1180);
assert.equal(line.nrpInclusive, 1062);
assert.equal(line.specialRateInclusive, 1008.9);
assert.equal(line.quoteDiscountAllocatedInclusive, 20.18);
assert.equal(line.grossLineTotal, 988.72);
assert.equal(line.taxableValue, 837.9);
assert.equal(line.taxAmount, 150.82);
assert.equal(line.taxableValue + line.taxAmount, line.grossLineTotal);

const fixed = priceQuoteLines([{
  lineKey: 'fixed', sku: 'FIXED', quantity: 1, pricingQuantity: 1,
  mrpInclusive: 1000, priceRateBasis: 'BOX', rateBasis: 'BOX',
  nrpMode: 'FIXED_NRP', nrpInput: 900,
  specialMode: 'FIXED_SPECIAL_RATE', specialInput: 850, taxRate: 0,
}], { mode: 'FIXED_AMOUNT', value: 100 }, { requireMrp: true });
assert.equal(fixed.lines[0].nrpInclusive, 900);
assert.equal(fixed.lines[0].specialRateInclusive, 850);
assert.equal(fixed.lines[0].grossLineTotal, 750);
assert.equal(fixed.lines[0].taxableValue, 750);
assert.equal(fixed.lines[0].taxAmount, 0);
assert.equal(fixed.requiresApproval, false);

const belowFloor = priceQuoteLines([{
  lineKey: 'floor', sku: 'FLOOR', quantity: 2, pricingQuantity: 2,
  mrpInclusive: 1000, floorPriceInclusive: 800, priceRateBasis: 'PIECE', rateBasis: 'PIECE',
  nrpMode: 'FIXED_NRP', nrpInput: 850, specialMode: 'NONE', specialInput: 0, taxRate: 0,
}], { mode: 'FIXED_AMOUNT', value: 200 }, { requireMrp: true });
assert.equal(belowFloor.lines[0].grossLineTotal, 1500);
assert.equal(belowFloor.requiresApproval, true);
assert.deepEqual(belowFloor.floorBreaches, [{ index: 0, lineKey: 'floor', sku: 'FLOOR', floorPriceInclusive: 800, finalUnitPayable: 750 }]);

const allocation = priceQuoteLines([
  { lineKey: 'a', sku: 'A', quantity: 1, mrpInclusive: 1000, priceRateBasis: 'PIECE', rateBasis: 'PIECE', nrpMode: 'FIXED_NRP', nrpInput: 1000, specialMode: 'NONE', specialInput: 0, taxRate: 18 },
  { lineKey: 'b', sku: 'B', quantity: 1, mrpInclusive: 500, priceRateBasis: 'PIECE', rateBasis: 'PIECE', nrpMode: 'FIXED_NRP', nrpInput: 500, specialMode: 'NONE', specialInput: 0, taxRate: 18 },
], { mode: 'FIXED_AMOUNT', value: 100 }, { requireMrp: true });
assert.equal(allocation.lines.reduce((sum, row) => sum + row.quoteDiscountAllocatedInclusive, 0), 100);
assert.equal(allocation.totals.grandTotal, 1400);

assert.throws(() => priceQuoteLines([{ lineKey: 'bad-nrp', sku: 'BAD', quantity: 1, mrpInclusive: 100, priceRateBasis: 'PIECE', rateBasis: 'PIECE', nrpMode: 'FIXED_NRP', nrpInput: 101, specialMode: 'NONE', taxRate: 18 }], {}, { requireMrp: true }), /cannot exceed MRP/i);
assert.throws(() => priceQuoteLines([{ lineKey: 'bad-basis', sku: 'BASIS', quantity: 1, mrpInclusive: 100, priceRateBasis: 'PIECE', rateBasis: 'BOX', nrpMode: 'FIXED_NRP', nrpInput: 90, specialMode: 'NONE', taxRate: 18 }], {}, { requireMrp: true }), /not BOX/i);

console.log('unified retail pricing contract smoke: PASS');
