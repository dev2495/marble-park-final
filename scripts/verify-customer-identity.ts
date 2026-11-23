// Phone-as-identity and quote naming rules.
// Run: npx tsx scripts/verify-customer-identity.ts
import assert from 'node:assert/strict';
import { indianMobile, maskedMobile, mobileForStorage, mobileKey } from '../apps/api/src/modules/common/phone';
import { customerFirstName, quoteNameFor, quoteSerialForYear } from '../apps/api/src/modules/quotes/quotes.service';

// Every way a number gets typed reduces to the same 10 digits.
for (const typed of ['9825012345', '+91 98250 12345', '098250-12345', '91-9825012345', ' 98250 12345 ', '+91(98250)12345']) {
  assert.equal(mobileKey(typed), '9825012345', typed);
}
assert.equal(mobileKey('12345'), '');
assert.equal(mobileKey('98241483322'), ''); // 11 digits, no 0/91 prefix: a typo, not guessed
assert.equal(mobileKey('919825012345'), '9825012345');
assert.equal(mobileKey('09825012345'), '9825012345');
assert.equal(mobileForStorage('98241483322'), '98241483322'); // kept as typed for a person to fix
assert.equal(mobileKey(''), '');
assert.equal(mobileKey(null), '');
assert.equal(indianMobile('+91 98250 12345'), '9825012345');
assert.equal(indianMobile('0261 2345678'), ''); // landline: 10 digits but not a mobile
assert.equal(mobileForStorage('+91 98250 12345'), '9825012345');
assert.equal(mobileForStorage('  2345 678 '), '2345 678'); // too short to clean: kept as typed
assert.equal(maskedMobile('9825012345'), '••2345');
assert.equal(maskedMobile(''), '');

// Quote names: 2026 keeps First-NNNN; from 2027 the year is in the name.
assert.equal(customerFirstName('Mr. Rakesh Patel'), 'Rakesh');
assert.equal(quoteNameFor('Mr. Rakesh Patel', 2026, '0412'), 'Rakesh-0412');
assert.equal(quoteNameFor('Mr. Rakesh Patel', 2027, '0001'), 'Rakesh-27-0001');
assert.equal(quoteNameFor('', 2030, '0007'), 'Quote-30-0007');

// The counter guard reads every format, so the serial always moves past what is taken.
assert.equal(quoteSerialForYear('QT/2026/0063', 2026), 63);
assert.equal(quoteSerialForYear('QT/2026/0063b', 2026), 63);
assert.equal(quoteSerialForYear('QT/2026/0063', 2027), null);
assert.equal(quoteSerialForYear('Rakesh-0412', 2026), 412);
assert.equal(quoteSerialForYear('Rakesh-0412ab', 2026), 412);
assert.equal(quoteSerialForYear('Rakesh-0412', 2027), null);
assert.equal(quoteSerialForYear('Rakesh-27-0001', 2027), 1);
assert.equal(quoteSerialForYear('Rakesh-27-0001c', 2027), 1);
assert.equal(quoteSerialForYear('Rakesh-27-0001', 2026), null);
assert.equal(quoteSerialForYear('Direct order', 2026), null);

// New Year: 2026 has used up to 0412; 2027 restarts at 0001 but cannot clash.
const names2026 = ['Rakesh-0411', 'Rakesh-0412', 'QT/2026/0063b'];
const first2027 = quoteNameFor('Rakesh Patel', 2027, '0001');
assert.ok(!names2026.includes(first2027));
assert.equal(Math.max(...names2026.map((name) => quoteSerialForYear(name, 2027) ?? 0)), 0);

console.log('Customer identity and quote naming checks passed.');
