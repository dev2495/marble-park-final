const assert = require('node:assert/strict');
const { brandCodeFor, productCodeFor, identityCodesFor } = require('../apps/web/scripts/render-quote-pdf.cjs');

const brands = [
  { id: 'brand-a', name: 'Aquant', code: 'AQUANT' },
  { id: 'brand-b', name: 'Metro World', code: 'METRO' },
];

const genericProduct = { internalCode: 'P-BASIN-001', sku: 'WH-BASIN-001', brand: 'Aquant' };
const tileVariant = { productCode: 'P-GREY-600X600-MATT', sku: 'TILE-PGREY-6060', brandCode: 'METRO', brand: 'Metro World' };

assert.equal(productCodeFor(genericProduct), 'P-BASIN-001');
assert.equal(brandCodeFor(genericProduct, brands), 'AQUANT');
assert.equal(identityCodesFor(genericProduct, brands), 'P-BASIN-001 · AQUANT');
assert.equal(identityCodesFor(tileVariant, brands), 'P-GREY-600X600-MATT · METRO');
assert.equal(identityCodesFor({ sku: 'SKU-FALLBACK', brand: 'Missing master' }, brands), 'SKU-FALLBACK');

console.log(JSON.stringify({
  ok: true,
  genericQuoteIdentity: identityCodesFor(genericProduct, brands),
  tileQuoteIdentity: identityCodesFor(tileVariant, brands),
}));
