// Header search end to end: number formats, phones, and who sees what.
//   API_URL=http://localhost:4100/graphql OWNER_TOKEN=… SALES_TOKEN=… DISPATCH_TOKEN=… INVENTORY_TOKEN=… \
//   QUOTE_OTHER=QT/2026/0008 QUOTE_SALES=QT/2026/0231 ORDER=SO/2026/0001 VEHICLE=E2E-001 PO=PO/2026/… RECEIPT=RCPT/2026/0001 PHONE=9909055120 \
//   node scripts/e2e-global-search-smoke.mjs
// QUOTE_OTHER must belong to someone other than the SALES_TOKEN user; QUOTE_SALES to that user.
import assert from 'node:assert/strict';

const API = process.env.API_URL || 'http://localhost:4100/graphql';
const env = (key) => { const value = process.env[key]; if (!value) throw new Error(`Set ${key}`); return value; };
async function search(token, query) {
  const response = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ query: 'query($q: String!) { searchEverything(query: $q) }', variables: { q: query } }) });
  const body = await response.json();
  if (body.errors?.length) throw new Error(body.errors[0].message);
  return body.data.searchEverything;
}
const group = (groups, key) => groups.find((row) => row.key === key);
const titles = (groups, key) => (group(groups, key)?.items || []).map((item) => item.title);
const owner = env('OWNER_TOKEN'); const sales = env('SALES_TOKEN'); const dispatch = env('DISPATCH_TOKEN'); const inventory = env('INVENTORY_TOKEN');
const other = env('QUOTE_OTHER'); const mine = env('QUOTE_SALES');
const dashed = (value) => value.replace(/\//g, '-');
const spaced = (value) => value.replace(/\//g, ' ').replace(/ 0+(\d)/, ' $1');

// Document numbers in any format, exact match first.
assert.equal(titles(await search(owner, dashed(other)), 'quotes')[0], other, 'dashed quote number');
assert.equal(titles(await search(owner, spaced(other)), 'quotes')[0], other, 'spaced, unpadded quote number');
assert.equal(titles(await search(owner, dashed(env('ORDER'))), 'orders')[0], env('ORDER'));
assert.ok(titles(await search(owner, spaced(env('RECEIPT'))), 'money').includes(env('RECEIPT')));
assert.ok(titles(await search(owner, env('PO')), 'purchasing').includes(env('PO')));

// Phone in any format finds the customer, and their quotes.
const phone = env('PHONE');
const byPhone = await search(owner, `+91 ${phone.slice(0, 5)} ${phone.slice(5)}`);
assert.ok(group(byPhone, 'customers')?.items.length, 'phone finds the customer');
assert.ok(group(byPhone, 'customers').items[0].subtitle.includes(`••${phone.slice(-4)}`));

// Sales sees only their own quotes.
assert.ok(!titles(await search(sales, other), 'quotes').includes(other), 'sales must not find another person’s quote');
assert.ok(titles(await search(sales, mine), 'quotes').includes(mine), 'sales finds their own quote');

// Dispatch: dispatch records yes; quotes, money and users no.
const dispatchGroups = await search(dispatch, env('VEHICLE'));
assert.ok(group(dispatchGroups, 'dispatch')?.items.length, 'dispatch finds a challan by vehicle');
for (const key of ['quotes', 'money', 'users', 'purchasing']) assert.ok(!group(await search(dispatch, other), key), `dispatch has no ${key} group`);
assert.ok(!group(await search(dispatch, other), 'quotes'), 'dispatch has no quote group');
assert.ok(!group(await search(dispatch, 'admin'), 'users'), 'dispatch has no user group');

// Inventory: no customer or quote groups.
const inventoryGroups = await search(inventory, phone);
assert.ok(!group(inventoryGroups, 'customers') && !group(inventoryGroups, 'quotes'), 'inventory sees no customers or quotes');

// Results carry only list fields, never whole records.
const sample = group(await search(owner, other), 'quotes').items[0];
assert.deepEqual(Object.keys(sample).sort(), ['href', 'id', 'kind', 'meta', 'rank', 'subtitle', 'title', 'when'].filter((key) => key in sample).sort());
assert.ok(!('lines' in sample) && !('approval' in sample));

// Product pickers keep working; old leads/quotes fields are now empty.
const picker = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${owner}` }, body: JSON.stringify({ query: '{ globalSearch(query: "tile") { products leads quotes } }' }) }).then((r) => r.json());
assert.ok(Array.isArray(picker.data.globalSearch.products));
assert.deepEqual(picker.data.globalSearch.quotes, []);

console.log('Global search smoke passed.');
