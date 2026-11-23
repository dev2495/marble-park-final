// Sales-person handover on a quote, and chemicals sold per KG or BAG.
//   API_URL=… DATABASE_URL=… OWNER_TOKEN=… SALES_TOKEN=… OFFICE_TOKEN=… QUOTE_ID=… NEW_OWNER_ID=… SUPERSEDED_QUOTE_ID=… \
//   node scripts/e2e-quote-owner-handover-smoke.mjs
// QUOTE_ID: a current quote with a lead and at least one sales order. It is handed to NEW_OWNER_ID and back.
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';

const API = process.env.API_URL || 'http://localhost:4100/graphql';
const env = (key) => { const value = process.env[key]; if (!value) throw new Error(`Set ${key}`); return value; };
const prisma = new PrismaClient();
async function gql(token, query, variables = {}) {
  const body = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ query, variables }) }).then((r) => r.json());
  return { data: body.data, error: body.errors?.[0] };
}
const REASSIGN = 'mutation($q: ID!, $o: ID!, $r: String) { reassignQuoteOwner(quoteId: $q, ownerId: $o, reason: $r) }';
const quoteId = env('QUOTE_ID'); const nextId = env('NEW_OWNER_ID');

const before = await prisma.quote.findUnique({ where: { id: quoteId }, select: { ownerId: true, leadId: true, quoteMeta: true } });
const lead = await prisma.lead.findUnique({ where: { id: before.leadId } });
const ordersBefore = await prisma.salesOrder.findMany({ where: { quoteId }, select: { id: true, ownerId: true } });
// An open follow-up and a done one for the lead, owned by the current person.
const openTask = await prisma.followUpTask.create({ data: { id: `handover-open-${Date.now()}`, leadId: before.leadId, ownerId: before.ownerId, dueAt: new Date(Date.now() + 86400000), status: 'pending', notes: 'handover smoke: open', updatedAt: new Date() } });
const doneTask = await prisma.followUpTask.create({ data: { id: `handover-done-${Date.now()}`, leadId: before.leadId, ownerId: before.ownerId, dueAt: new Date(), status: 'completed', notes: 'handover smoke: done', updatedAt: new Date() } });

// Sales (no quotes.manage) cannot hand over.
assert.ok((await gql(env('SALES_TOKEN'), REASSIGN, { q: quoteId, o: nextId })).error, 'sales must not change the sales person');
// A replaced version cannot be handed over.
assert.match((await gql(env('OFFICE_TOKEN'), REASSIGN, { q: env('SUPERSEDED_QUOTE_ID'), o: nextId })).error?.message || '', /newer version/);

// Office staff hands it over.
const moved = await gql(env('OFFICE_TOKEN'), REASSIGN, { q: quoteId, o: nextId, r: 'Smoke test handover' });
assert.ok(!moved.error, moved.error?.message);
const after = await prisma.quote.findUnique({ where: { id: quoteId }, select: { ownerId: true, quoteMeta: true, lines: true, commercialTotal: true, status: true } });
assert.equal(after.ownerId, nextId, 'quote moves');
assert.equal(after.quoteMeta.ownerHistory.at(-1).toId, nextId, 'handover kept on the quote');
assert.equal(after.quoteMeta.ownerHistory.at(-1).reason, 'Smoke test handover');
if (lead.ownerId === before.ownerId) assert.equal((await prisma.lead.findUnique({ where: { id: before.leadId } })).ownerId, nextId, 'lead moves');
assert.equal((await prisma.followUpTask.findUnique({ where: { id: openTask.id } })).ownerId, nextId, 'open follow-up moves');
assert.equal((await prisma.followUpTask.findUnique({ where: { id: doneTask.id } })).ownerId, before.ownerId, 'done follow-up stays');
for (const order of ordersBefore) assert.equal((await prisma.salesOrder.findUnique({ where: { id: order.id } })).ownerId, order.ownerId, 'existing order stays');
assert.equal(moved.data.reassignQuoteOwner.ordersKept, ordersBefore.length);
assert.ok(await prisma.activity.findFirst({ where: { quoteId, type: 'owner_changed' } }), 'activity logged');
assert.ok(await prisma.notification.findFirst({ where: { entityId: quoteId, type: 'quote_assigned', targetUserId: nextId } }), 'new owner notified');
// Same person again is refused.
assert.match((await gql(env('OFFICE_TOKEN'), REASSIGN, { q: quoteId, o: nextId })).error?.message || '', /already the sales person/);

// Hand it back so the test data is as it was (history keeps both entries).
assert.ok(!(await gql(env('OWNER_TOKEN'), REASSIGN, { q: quoteId, o: before.ownerId, r: 'Smoke test: back' })).error);
await prisma.followUpTask.deleteMany({ where: { id: { in: [openTask.id, doneTask.id] } } });

// Chemicals: quick add per BAG; the quote line uses BAG.
const QUICK = 'mutation($input: QuickAddProductInput!) { quickAddProduct(input: $input) }';
const bag = await gql(env('OWNER_TOKEN'), QUICK, { input: { name: `Adhesive 20kg bag ${Date.now().toString(36)}`, category: 'Chemicals', mrp: 650, unit: 'BAG' } });
assert.ok(!bag.error, bag.error?.message);
const bagProduct = await prisma.product.findUnique({ where: { id: bag.data.quickAddProduct.id } });
assert.deepEqual([bagProduct.unit, bagProduct.baseUom, bagProduct.purchaseUom, bagProduct.salesUom, bagProduct.priceUom, bagProduct.allowLoose], ['BAG', 'BAG', 'BAG', 'BAG', 'BAG', false]);
const kg = await gql(env('OWNER_TOKEN'), QUICK, { input: { name: `Grout loose ${Date.now().toString(36)}`, category: 'Chemicals', mrp: 90 } });
const kgProduct = await prisma.product.findUnique({ where: { id: kg.data.quickAddProduct.id } });
assert.deepEqual([kgProduct.unit, kgProduct.priceUom, kgProduct.allowLoose], ['KG', 'KG', true], 'KG stays the default');
// Switching a chemical's unit needs a new MRP.
const UPDATE = 'mutation($id: ID!, $input: UpdateProductInput!) { updateProduct(id: $id, input: $input) { id unit } }';
assert.match((await gql(env('OWNER_TOKEN'), UPDATE, { id: kgProduct.id, input: { unit: 'BAG' } })).error?.message || '', /needs its MRP per BAG/);

await prisma.$disconnect();
console.log('Quote owner handover and chemical BAG smoke passed.');
