// How the header search reads what people type.
// Run: npx tsx scripts/verify-search-matching.ts
import assert from 'node:assert/strict';
import { matchRank, numberVariants, phoneDigits, searchTokens } from '../apps/api/src/modules/search/search-match';

// Words in any order, longest first, duplicates dropped.
assert.deepEqual(searchTokens('ram  patel'), ['patel', 'ram']);
assert.deepEqual(searchTokens('kajaria 60x60 matt'), ['kajaria', '60x60', 'matt']);
assert.deepEqual(searchTokens('  '), []);

// Document numbers typed with any separator, or without zero padding.
const v = numberVariants('QT-2026-0063');
assert.ok(v.includes('QT/2026/0063'));
assert.ok(numberVariants('qt 2026 63').includes('qt/2026/0063'));
assert.ok(numberVariants('Rakesh 27 1').includes('Rakesh-27-0001'));
assert.ok(numberVariants('SO/2026/12').includes('SO/2026/0012'));
assert.deepEqual(numberVariants('patel'), []);

// Phones: only digit-like input, last 10 digits.
assert.equal(phoneDigits('+91 98250 12345'), '9825012345');
assert.equal(phoneDigits('5120'), '5120');
assert.equal(phoneDigits('12'), '');
assert.equal(phoneDigits('QT/2026/0063'), '');

// Exact number first, then starts-with, then contains; separators ignored.
assert.equal(matchRank('QT-2026-0063b', ['QT/2026/0063b']), 100);
assert.equal(matchRank('qt 2026 63', ['QT/2026/0063']), 100);
assert.ok(matchRank('QT/2026/0063', ['QT/2026/0063b']) > matchRank('0063', ['QT/2026/0063b']));
assert.ok(matchRank('0063', ['QT/2026/0063']) >= 50);
assert.equal(matchRank('xyz', ['QT/2026/0063']), 0);

console.log('Search matching checks passed.');
