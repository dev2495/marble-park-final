const assert = require('node:assert/strict');
const { priceQuoteLines } = require('../apps/api/dist/src/modules/common/pricing.js');

function line(overrides = {}) {
  return {
    lineKey: 'MATRIX-1', sku: 'MATRIX-SKU', qty: 1, unit: 'PC',
    rateBasis: 'PIECE', listPrice: 100, specialRate: 100,
    taxRate: 18, mrp: 118, mrpRateBasis: 'PIECE', floorPrice: 90,
    ...overrides,
  };
}

function issueFor(input, discount = 0) {
  try { priceQuoteLines([input], discount, { requireMrp: true, mrpTolerance: 0 }); }
  catch (error) { return typeof error.getResponse === 'function' ? error.getResponse() : { message: error.message }; }
  return null;
}

for (const taxRate of [0, 5, 12, 18, 28]) {
  const mrp = Math.round(100 * (1 + taxRate / 100) * 100) / 100;
  const priced = priceQuoteLines([line({ taxRate, mrp })], 0, { requireMrp: true, mrpTolerance: 0 });
  assert.equal(priced.lines[0].finalUnitPayable, mrp, `GST ${taxRate}: payable must equal MRP at boundary`);
  assert.equal(priced.lines[0].pricingCompletenessCode, 'READY');
  assert.equal(issueFor(line({ taxRate, mrp: mrp - 0.01 })).code, 'QUOTE_MRP_EXCEEDED');
}

for (const mrp of [undefined, null, '', 0, -1, 'not-a-number']) {
  const issue = issueFor(line({ mrp }));
  assert.ok(issue, `MRP ${String(mrp)} must be rejected`);
  assert.match(issue.code, /^QUOTE_MRP_(REQUIRED|INVALID)$/);
  assert.equal(issue.field, 'lines[0].mrp');
  assert.equal(issue.lineKey, 'MATRIX-1');
  assert.ok(issue.remediation);
}

for (const rateBasis of ['PACK', 'PIECE', 'AREA']) {
  const input = line({
    rateBasis,
    mrpRateBasis: rateBasis,
    unit: rateBasis === 'PACK' ? 'BOX' : 'PC',
    piecesPerPack: 4,
    coveragePerPack: rateBasis === 'AREA' ? 2.5 : undefined,
    pricingUom: rateBasis === 'AREA' ? 'SQFT' : undefined,
    mrp: 118,
  });
  const priced = priceQuoteLines([input], 0, { requireMrp: true, mrpTolerance: 0 });
  assert.equal(priced.lines[0].rateBasis, rateBasis);
  assert.equal(priced.lines[0].pricingCompletenessCode, 'READY');
}

const stale = issueFor(line({ rateBasis: 'PACK', mrpRateBasis: 'PIECE', unit: 'BOX' }));
assert.equal(stale.code, 'QUOTE_MRP_BASIS_STALE');

const discounted = priceQuoteLines([line({ listPrice: 120, specialRate: null, discountPercent: 10, mrp: 125 })], 5, { requireMrp: true, mrpTolerance: 0 });
assert.equal(discounted.lines[0].unitRate, 108);
assert.equal(discounted.lines[0].quoteDiscountPercent, 5);
assert.equal(discounted.lines[0].belowFloor, false, 'floor approval must remain independent from MRP validation');

const belowFloor = priceQuoteLines([line({ specialRate: 80, floorPrice: 90, mrp: 118 })], 0, { requireMrp: true });
assert.equal(belowFloor.requiresApproval, true);

console.log(JSON.stringify({ ok: true, taxRates: 5, mrpInvalidCases: 6, bases: 3, structuredErrors: true }, null, 2));
