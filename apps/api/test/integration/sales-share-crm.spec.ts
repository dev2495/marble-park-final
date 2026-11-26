/**
 * Sales lane: the public share link (C1, C16 API side), follow-ups (A5), customers (A15),
 * walk-in to quote (A16) and building a quote from an intent (A9).
 */
import { Harness, Session, World, stamp, uniquePhone } from '../harness';

const SEND = `mutation($id: ID!) { sendQuote(id: $id) { id status } }`;
const SHARE = `mutation($id: ID!, $allow: Boolean) { createQuoteShare(quoteId: $id, allowDownload: $allow) }`;
const DOC = `query($t: String!) { publicQuoteShareDocument(token: $t) }`;
const SHARE_STATUS = `query($t: String!) { publicQuoteShareStatus(token: $t) }`;
const UPDATE = `mutation($id: ID!, $input: UpdateQuoteInput!) { updateQuote(id: $id, input: $input) { id quoteNumber versionNumber } }`;
const NEW_CUSTOMER = `mutation($input: CreateCustomerInput!) { createCustomer(input: $input) { id name } }`;

function refusal(r: { errors?: any[] }) {
  expect(r.errors?.length).toBeGreaterThan(0);
  return String(r.errors![0].message);
}

describe('sales: share link, follow-ups, customers, walk-ins, intents', () => {
  let h: Harness; let admin: Session; let owner: Session;
  beforeAll(async () => { h = await Harness.boot(); admin = await h.as('admin'); owner = await h.as('owner'); });
  afterAll(async () => { await h.close(); });

  async function share(quoteId: string, allow = true) {
    const row = (await admin.gql(SHARE, { id: quoteId, allow })).createQuoteShare;
    return { id: row.id as string, token: String(row.token) };
  }

  /** Every key anywhere in a JSON value. */
  function allKeys(value: any, out = new Set<string>()): Set<string> {
    if (Array.isArray(value)) value.forEach((v) => allKeys(v, out));
    else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { out.add(k); allKeys(v, out); }
    return out;
  }

  // ---------------- C1: what the customer's link carries ----------------
  it('the public share document has no floor rate, no approval note, no lead and no earlier revisions', async () => {
    const w = await h.world(admin, { stock: 5 });
    const parent = await w.createQuote([w.line({ qty: 1 })]);
    const secret = `OWNER-ONLY-${stamp()}`;
    // Revision priced below the floor, approved by the owner with a private note.
    const revision = await w.createQuote([{ ...w.line({ qty: 2 }), specialMode: 'FIXED_SPECIAL_RATE', specialInput: 500 } as any], { supersedes: parent.id, leadId: parent.leadId });
    await owner.gql(`mutation($id: ID!, $note: String) { approveQuote(id: $id, note: $note) { id } }`, { id: revision.id, note: secret });
    await admin.gql(SEND, { id: revision.id });
    const { token } = await share(revision.id);

    const r = await h.publicGql(DOC, { t: token });
    expect(r.errors).toBeUndefined();
    const doc = r.data.publicQuoteShareDocument;
    const text = JSON.stringify(doc);
    const keys = [...allKeys(doc)];
    expect(keys.filter((k) => /floor|cost|margin|landed|vendor|supplier/i.test(k))).toEqual([]);
    for (const k of ['approval', 'approvalStatus', 'versions', 'lead', 'leadId', 'supersedesQuoteId', 'supersededByQuoteId', 'ownerHistory', 'confirmedById', 'preparedById', 'intentId']) {
      expect(keys).not.toContain(k);
    }
    expect(text).not.toContain(secret);
    expect(text).not.toContain(parent.id);
    expect(text).not.toMatch(/:800(\.0+)?[,}]/); // the floor rate itself (rate 1000 x 0.8)
    expect(text).toContain(w.product.sku);
    expect(doc.quote.lines).toHaveLength(1);
  });

  it('a quote revised in place keeps its change log out of the public document', async () => {
    const w = await h.world(admin, { stock: 5 });
    const quote = await w.createQuote([w.line({ qty: 1 })]);
    await admin.gql(SEND, { id: quote.id });
    const before = (await w.quoteRow(quote.id))!.quoteNumber;
    const saved = (await admin.gql(UPDATE, { id: quote.id, input: { lines: JSON.stringify([w.line({ qty: 3 })]) } })).updateQuote;
    const row: any = await w.quoteRow(quote.id);
    expect(Array.isArray(row.versions) && row.versions.length).toBeTruthy();
    expect(saved.quoteNumber).not.toBe(before);
    const { token } = await share(quote.id);
    const doc = (await h.publicGql(DOC, { t: token })).data.publicQuoteShareDocument;
    expect([...allKeys(doc)]).not.toContain('versions');
    expect(doc.quote.quoteNumber).toBe(saved.quoteNumber);
  });

  // ---------------- C16 (API side): downloads, junk and revoked links ----------------
  it('a share made without download says so, and the status check does not count a view', async () => {
    const w = await h.world(admin, { stock: 2 });
    const quote = await w.createQuote([w.line({ qty: 1 })]);
    const { id, token } = await share(quote.id, false);
    const status = (await h.publicGql(SHARE_STATUS, { t: token })).data.publicQuoteShareStatus;
    expect(status).toMatchObject({ ok: true, allowDownload: false });
    expect((await h.prisma.quoteShare.findUnique({ where: { id } }))!.viewCount).toBe(0);
    const doc = (await h.publicGql(DOC, { t: token })).data.publicQuoteShareDocument;
    expect(doc.share.allowDownload).toBe(false);
    expect((await h.prisma.quoteShare.findUnique({ where: { id } }))!.viewCount).toBe(1);
    // A download-allowed link is a separate link.
    const open = await share(quote.id, true);
    expect(open.token).not.toBe(token);
    expect((await h.publicGql(SHARE_STATUS, { t: open.token })).data.publicQuoteShareStatus.allowDownload).toBe(true);
  });

  it('a junk or revoked token is turned away', async () => {
    const w = await h.world(admin, { stock: 2 });
    const quote = await w.createQuote([w.line({ qty: 1 })]);
    for (const junk of ['abc', '../../etc/passwd', 'x'.repeat(50)]) {
      expect((await h.publicGql(SHARE_STATUS, { t: junk })).data.publicQuoteShareStatus.ok).toBe(false);
      expect((await h.publicGql(DOC, { t: junk })).errors?.length).toBeGreaterThan(0);
    }
    const s = await share(quote.id);
    await admin.gql(`mutation($q: ID!, $s: ID!) { revokeQuoteShare(quoteId: $q, shareId: $s) }`, { q: quote.id, s: s.id });
    expect((await h.publicGql(SHARE_STATUS, { t: s.token })).data.publicQuoteShareStatus.ok).toBe(false);
  });

  it('cancelling a quote revokes its share links', async () => {
    const w = await h.world(admin, { stock: 2 });
    const quote = await w.createQuote([w.line({ qty: 1 })]);
    const s = await share(quote.id);
    await w.cancelQuote(quote.id, 'Wrong customer');
    expect((await h.publicGql(SHARE_STATUS, { t: s.token })).data.publicQuoteShareStatus.ok).toBe(false);
  });

  // ---------------- A5: both follow-up completions ----------------
  it('the lead page completes a follow-up task (completeLeadFollowUp)', async () => {
    const w = await h.world(admin, { stock: 1 });
    const quote = await w.createQuote([w.line({ qty: 1 })]);
    const task = await h.prisma.followUpTask.create({ data: { id: `HTF${stamp()}`, leadId: quote.leadId!, ownerId: admin.userId, dueAt: new Date(), status: 'pending', notes: 'Call back', updatedAt: new Date() } });
    const MUT = `mutation($id: ID!, $o: String!) { completeLeadFollowUp(id: $id, outcome: $o) }`;
    refusal(await admin.gqlRaw(MUT, { id: task.id, o: 'x' }));
    const done = (await admin.gql(MUT, { id: task.id, o: 'Customer will visit on Saturday' })).completeLeadFollowUp;
    expect(done.status).toBe('completed');
    expect(await h.prisma.activity.count({ where: { leadId: quote.leadId!, type: 'followup_completed' } })).toBe(1);
    expect(await h.prisma.auditEvent.count({ where: { entityId: task.id, action: 'followup.complete', actorUserId: admin.userId } })).toBe(1);
    // A second tap does not log twice.
    await admin.gql(MUT, { id: task.id, o: 'Customer will visit on Saturday' });
    expect(await h.prisma.activity.count({ where: { leadId: quote.leadId!, type: 'followup_completed' } })).toBe(1);
  });

  it('the Follow-up desk completes a customer record (completeFollowUp) and refuses another customer\'s GSTIN', async () => {
    const w = await h.world(admin, { stock: 0 });
    const MUT = `mutation($t: String!, $id: ID!, $v: JSON!, $m: Boolean!) { completeFollowUp(entityType: $t, id: $id, values: $v, markComplete: $m) }`;
    const city = `Rajkot ${stamp()}`;
    expect((await admin.gql(MUT, { t: 'Customer', id: w.customer.id, v: { city }, m: true })).completeFollowUp).toBe(true);
    expect((await h.prisma.customer.findUnique({ where: { id: w.customer.id } }))!.city).toBe(city);

    const other = await w.createCustomer();
    const gst = `24${stamp().replace(/[^A-Z0-9]/g, '').padEnd(13, 'Z').slice(0, 13)}`;
    await h.prisma.customer.update({ where: { id: other.id }, data: { gstNo: gst } });
    expect(refusal(await admin.gqlRaw(MUT, { t: 'Customer', id: w.customer.id, v: { gstNo: gst }, m: true }))).toContain(other.name);
    expect((await h.prisma.customer.findUnique({ where: { id: w.customer.id } }))!.gstNo).not.toBe(gst);
  });

  // ---------------- A15: same mobile at the same moment ----------------
  it('two quick-adds of the same mobile at the same moment make one customer', async () => {
    const phone = uniquePhone();
    const results = await Promise.all([1, 2].map((n) => admin.gqlRaw(NEW_CUSTOMER, { input: { name: `Harness twin ${n} ${stamp()}`, phone } })));
    expect(results.filter((r) => !r.errors?.length)).toHaveLength(1);
    expect(results.filter((r) => r.errors?.length)).toHaveLength(1);
    expect(await h.prisma.customer.count({ where: { mobile: { contains: phone.slice(-10) } } })).toBe(1);
  });

  // ---------------- A16: walk-in to quote ----------------
  it('a quote saved from a walk-in remembers the visit', async () => {
    const w = await h.world(admin, { stock: 1 });
    const visit = await h.prisma.showroomVisit.create({ data: { id: `HTV${stamp()}`, token: `HTV${stamp()}`, name: w.customer.name, mobile: uniquePhone(), customerId: w.customer.id, updatedAt: new Date() } });
    const quote = (await admin.gql(`mutation($input: CreateQuoteInput!) { createQuote(input: $input) { id } }`, {
      input: { customerId: w.customer.id, ownerId: w.ownerId, title: 'Walk-in quote', lines: JSON.stringify([w.line({ qty: 1 })]), quoteMeta: JSON.stringify({ walkInVisitId: visit.id }) },
    })).createQuote;
    const after = (await h.prisma.showroomVisit.findUnique({ where: { id: visit.id } }))!;
    expect(after.quoteId).toBe(quote.id);
    expect(after.status).toBe('quoting');
  });

  // ---------------- A9: build quote from an intent, double tap ----------------
  it('building a quote from an intent twice at once makes one quote and one follow-up task', async () => {
    const w: World = await h.world(admin, { stock: 1 });
    const seed = await w.createQuote([w.line({ qty: 1 })]);
    const intent = (await admin.gql(`mutation($input: CreateIntentInputDto!) { createIntent(input: $input) }`, {
      input: { leadId: seed.leadId, rows: [{ productId: w.product.id, qty: 2, area: 'Kitchen' }], submit: true },
    })).createIntent;
    const tasksBefore = await h.prisma.followUpTask.count({ where: { leadId: seed.leadId! } });
    const BUILD = `mutation($id: String!) { generateQuoteFromIntent(intentId: $id) }`;
    const both = await Promise.all([admin.gqlRaw(BUILD, { id: intent.id }), admin.gqlRaw(BUILD, { id: intent.id })]);
    expect(both.filter((r) => !r.errors?.length)).toHaveLength(1);
    expect(both.filter((r) => r.errors?.length)).toHaveLength(1);
    expect(await h.prisma.quote.count({ where: { intentId: intent.id } })).toBe(1);
    expect(await h.prisma.followUpTask.count({ where: { leadId: seed.leadId! } })).toBe(tasksBefore + 1);
    const claimed = (await h.prisma.leadIntent.findUnique({ where: { id: intent.id } }))!;
    expect(claimed.quoteId).toBeTruthy();
    // A third, later tap is told plainly.
    expect(refusal(await admin.gqlRaw(BUILD, { id: intent.id }))).toMatch(/already/i);
  });
});
