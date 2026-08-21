const assert = require('node:assert/strict');
const { priceQuoteLines, PricingContractError, PRICING_VERSION } = require('../packages/pricing-contract');

function line(overrides = {}) {
  return {
    lineKey: 'MATRIX-1', sku: 'MATRIX-SKU', quantity: 1,
    priceRateBasis: 'PIECE', lineRateBasis: 'PIECE', mrpInclusive: 1180,
    nrpMode: 'PERCENT_OFF_MRP', nrpInput: 10,
    specialMode: 'PERCENT_OFF_NRP', specialInput: 5, taxRate: 18,
    ...overrides,
  };
}

for (const taxRate of [0, 5, 12, 18, 28]) {
  const priced = priceQuoteLines([line({ taxRate })], { mode: 'PERCENT', value: 2 });
  assert.equal(priced.lines[0].pricingVersion, PRICING_VERSION);
  assert.equal(priced.lines[0].grossLineTotal, 988.72);
  assert.equal(priced.lines[0].taxableValue + priced.lines[0].taxAmount, priced.lines[0].grossLineTotal);
}

for (const basis of ['BOX', 'PIECE', 'AREA']) {
  const priced = priceQuoteLines([line({ priceRateBasis: basis, lineRateBasis: basis })]);
  assert.equal(priced.lines[0].priceRateBasis, basis);
}

assert.throws(
  () => priceQuoteLines([line({ lineRateBasis: 'BOX' })]),
  (error) => error instanceof PricingContractError && error.code === 'PRICE_BASIS_STALE',
);
assert.throws(
  () => priceQuoteLines([line({ nrpMode: 'FIXED_NRP', nrpInput: 1180.01 })]),
  (error) => error instanceof PricingContractError && error.code === 'NRP_ABOVE_MRP',
);
assert.throws(
  () => priceQuoteLines([line({ specialMode: 'FIXED_SPECIAL_RATE', specialInput: 1200 })]),
  (error) => error instanceof PricingContractError && error.code === 'SPECIAL_ABOVE_NRP',
);

console.log(JSON.stringify({ ok: true, taxRates: 5, bases: 3, pricingVersion: PRICING_VERSION }, null, 2));
