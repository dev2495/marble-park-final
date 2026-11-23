// Phone is the customer identity: end-to-end through the GraphQL API.
//   API_URL=http://localhost:4100/graphql OWNER_TOKEN=... SALES_TOKEN=... node scripts/e2e-customer-identity-smoke.mjs
// OWNER_TOKEN must belong to an owner/admin, SALES_TOKEN to a sales user. Creates test customers.
import assert from 'node:assert/strict';

const API = process.env.API_URL || 'http://localhost:4100/graphql';
const owner = process.env.OWNER_TOKEN;
const sales = process.env.SALES_TOKEN;
if (!owner || !sales) throw new Error('Set OWNER_TOKEN and SALES_TOKEN');

async function gql(token, query, variables = {}) {
  const response = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ query, variables }) });
  const body = await response.json();
  return { data: body.data, error: body.errors?.[0] };
}
const errorCode = (error) => error?.extensions?.originalError?.code || error?.extensions?.code || error?.extensions?.exception?.response?.code || '';
const CREATE = 'mutation($input: CreateCustomerInput!) { createCustomer(input: $input) { id name mobile city } }';
const run = Date.now().toString(36).toUpperCase();
const digits = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
const spaced = `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;

// 1. Saved as clean 10 digits however typed.
const first = await gql(sales, CREATE, { input: { name: `Ramesh Patel ${run}`, phone: spaced, city: 'Vapi' } });
assert.ok(!first.error, first.error?.message);
assert.equal(first.data.createCustomer.mobile, digits);

// 2. Same phone, different name: blocked, with the existing customer named.
const samePhone = await gql(sales, CREATE, { input: { name: `Suresh Shah ${run}`, phone: `0${digits}`, city: 'Surat' } });
assert.ok(samePhone.error, 'same phone must be refused');
assert.match(samePhone.error.message, /already belongs to Ramesh Patel/);

// 3. Same name and city, different phone: allowed (a different person).
const otherDigits = `8${digits.slice(1)}`;
const sameName = await gql(sales, CREATE, { input: { name: `Ramesh Patel ${run}`, phone: otherDigits, city: 'Vapi' } });
assert.ok(!sameName.error, sameName.error?.message);

// 4. Probe: phone match blocks, name match only warns.
const probe = await gql(sales, 'query($phone: String, $name: String, $city: String) { customerDuplicateCandidates(phone: $phone, name: $name, city: $city) }', { phone: spaced, name: `Ramesh Patel ${run}`, city: 'Vapi' });
const rows = probe.data.customerDuplicateCandidates;
const phoneRow = rows.find((row) => row.id === first.data.createCustomer.id);
const nameRow = rows.find((row) => row.id === sameName.data.createCustomer.id);
assert.ok(phoneRow?.blocking && phoneRow.matchedOn.includes('mobile'));
assert.equal(phoneRow.maskedMobile, `••${digits.slice(-4)}`);
assert.ok(nameRow && !nameRow.blocking && nameRow.matchedOn.includes('name+city'));

// 5. Sales cannot override; owner needs a reason, then may.
const salesForce = await gql(sales, CREATE, { input: { name: `Family ${run}`, phone: digits, forceCreate: true, overrideReason: 'shared phone' } });
assert.ok(salesForce.error, 'sales may not override');
const ownerNoReason = await gql(owner, CREATE, { input: { name: `Family ${run}`, phone: digits, forceCreate: true } });
assert.ok(ownerNoReason.error && /reason/i.test(ownerNoReason.error.message), 'owner override needs a reason');
const ownerOverride = await gql(owner, CREATE, { input: { name: `Family ${run}`, phone: digits, forceCreate: true, overrideReason: 'Husband and wife share one mobile' } });
assert.ok(!ownerOverride.error, ownerOverride.error?.message);

// 6. Quick add with the number typed differently reuses the first customer.
const quick = await gql(sales, 'mutation($input: QuickAddCustomerInput!) { quickAddCustomer(input: $input) }', { input: { name: 'Someone Else', mobile: `91${digits}` } });
assert.ok(!quick.error, quick.error?.message);
assert.equal(quick.data.quickAddCustomer.existing, true);
assert.equal(quick.data.quickAddCustomer.customer.id, first.data.createCustomer.id);

// 7. Search by the number in any format.
const found = await gql(sales, 'query($search: String) { customers(search: $search, take: 20) { id } }', { search: spaced });
assert.ok(found.data.customers.some((row) => row.id === first.data.createCustomer.id));

// 8. Editing a customer onto someone else's phone is refused.
const clash = await gql(sales, 'mutation($id: ID!, $input: UpdateCustomerInput!) { updateCustomer(id: $id, input: $input) { id } }', { id: sameName.data.createCustomer.id, input: { phone: spaced } });
assert.ok(clash.error && /already belongs to another customer/.test(clash.error.message), clash.error?.message);

// 9. Open-quote heads-up: a customer with none returns an empty list.
const open = await gql(sales, 'query($id: ID!) { customerOpenQuotes(customerId: $id) }', { id: first.data.createCustomer.id });
assert.ok(!open.error, open.error?.message);
assert.deepEqual(open.data.customerOpenQuotes, []);

console.log(`Customer identity smoke passed (phone ${digits.slice(0, 2)}…${digits.slice(-2)}, run ${run}).`);
void errorCode;
