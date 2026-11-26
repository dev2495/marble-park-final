/**
 * Sales lane: quote revisions of ordered quotes (A4/A6), lost / expired / replaced quotes (A3, A10, A14),
 * owner rejection (A14), save clash (A8), status rules (A13), GST (A7) and box/piece availability (A12).
 */
import { Harness, Session, World, stamp } from '../harness';
import { QuotesService } from '../../src/modules/quotes/quotes.service';

const SEND = `mutation($id: ID!) { sendQuote(id: $id) { id status } }`;
const SHARE = `mutation($id: ID!, $allow: Boolean) { createQuoteShare(quoteId: $id, allowDownload: $allow) }`;
const STATUS = `mutation($id: ID!, $status: String!, $reason: String) { updateQuoteStatus(id: $id, status: $status, reason: $reason) { id status } }`;
const LOST = `mutation($id: ID!, $reason: String!) { markQuoteLost(id: $id, reason: $reason) { id status } }`;
const REJECT = `mutation($id: ID!, $note: String!) { rejectQuote(id: $id, note: $note) { id status approvalStatus } }`;
const APPROVE = `mutation($id: ID!, $note: String) { approveQuote(id: $id, note: $note) { id status approvalStatus } }`;
const UPDATE = `mutation($id: ID!, $input: UpdateQuoteInput!) { updateQuote(id: $id, input: $input) { id status approvalStatus updatedAt } }`;
const READ = `query($id: ID!) { quote(id: $id) { id status updatedAt validUntil } }`;
const FROM_QUOTE = `mutation($input: CreateSalesOrderInput!) { createSalesOrderFromQuote(input: $input) }`;

function refusal(r: { errors?: any[] }) {
  expect(r.errors?.length).toBeGreaterThan(0);
  return String(r.errors![0].message);
}
const sum = (rows: Array<{ quantity: any; status: string }>, status = 'reserved') => rows.filter((r) => r.status === status).reduce((n, r) => n + Number(r.quantity), 0);
const DAY = 86400000;
/** A line at a set special rate (the price ladder ignores listPrice; MRP and NRP come from the product). Floor is 800. */
const special = (w: World, qty: number, rate: number) => ({ ...w.line({ qty }), specialMode: 'FIXED_SPECIAL_RATE', specialInput: rate });

describe('sales quotes: revisions, endings, approvals, saves', () => {
  let h: Harness; let admin: Session; let owner: Session;
  beforeAll(async () => { h = await Harness.boot(); admin = await h.as('admin'); owner = await h.as('owner'); });
  afterAll(async () => { await h.close(); });

  async function convertRaw(w: World, quoteId: string, qty?: number) {
    const f = await w.quoteFulfillment(quoteId);
    return admin.gqlRaw(FROM_QUOTE, { input: { quoteId, paymentMode: 'credit', idempotencyKey: `HT-R-${stamp()}`, lines: JSON.stringify([{ quoteLineId: f.lines[0].id, quantity: qty ?? Math.max(1, f.lines[0].remaining) }]) } });
  }

  /**
   * An order cancelled by the old code: marked cancelled but its stock hold left behind, and the quote
   * back to an open offer. releaseReservationsTx must free exactly these holds.
   */
  async function staleCancel(orderId: string, quoteId: string, keepOrdered = 0) {
    await h.prisma.salesOrder.update({ where: { id: orderId }, data: { status: 'cancelled' } });
    await h.prisma.quoteLine.updateMany({ where: { quoteId }, data: { orderedQuantity: keepOrdered, status: keepOrdered ? 'partially_ordered' : 'quoted' } });
    if (!keepOrdered) await h.prisma.quote.update({ where: { id: quoteId }, data: { status: 'sent', sentAt: new Date() } });
  }

  // ---------------- A4 / A6: revisions of ordered quotes ----------------
  describe('a revision remembers what was ordered', () => {
    it('3 of 5 ordered, revised to 8: the revision starts at 3 ordered, orders 5 more, and stock is not reserved twice', async () => {
      const w = await h.world(admin, { stock: 20 });
      const quote = await w.createQuote([w.line({ qty: 5 })]);
      const first = await w.convertQuote(quote.id, { picks: { 0: 3 } });
      expect(await w.balance()).toMatchObject({ reserved: 3 });

      const revision = await w.createQuote([w.line({ qty: 8 })], { supersedes: quote.id, leadId: quote.leadId });
      const carried = (await w.quoteLines(revision.id))[0];
      expect(carried.orderedQuantity).toBe(3);
      expect(carried.status).toBe('partially_ordered');
      expect((await w.quoteRow(revision.id))!.status).toBe('partially_ordered');
      expect((await w.quoteRow(quote.id))!.status).toBe('superseded');
      // The first order keeps its 3; the revision itself holds nothing yet.
      expect(await w.balance()).toMatchObject({ reserved: 3, available: 17 });
      expect(sum(await w.reservations(first.id))).toBe(3);

      const f = await w.quoteFulfillment(revision.id);
      expect(f.lines[0].remaining).toBe(5);
      expect(f.orders.map((o: any) => o.id)).toContain(first.id); // earlier versions' orders are listed

      const order = await w.convertQuote(revision.id);
      const lines = await h.prisma.salesOrderLine.findMany({ where: { salesOrderId: order.id } });
      expect(lines.reduce((n, l) => n + l.orderedQuantity, 0)).toBe(5);
      expect(sum(await w.reservations(order.id))).toBe(5);
      expect(await w.balance()).toMatchObject({ onHand: 20, reserved: 8, available: 12 });
      expect((await w.quoteLines(revision.id))[0].orderedQuantity).toBe(8);
      expect((await w.quoteRow(revision.id))!.status).toBe('confirmed');
      // Nothing more can be ordered from the revision.
      refusal(await convertRaw(w, revision.id, 1));
    });

    it('40 ordered, revised to 45: converting the revision orders 5', async () => {
      const w = await h.world(admin, { stock: 50 });
      const quote = await w.createQuote([w.line({ qty: 40 })]);
      await w.convertQuote(quote.id);
      const revision = await w.createQuote([w.line({ qty: 45 })], { supersedes: quote.id, leadId: quote.leadId });
      expect((await w.quoteLines(revision.id))[0].orderedQuantity).toBe(40);
      const order = await w.convertQuote(revision.id);
      expect((await h.prisma.salesOrderLine.findFirst({ where: { salesOrderId: order.id } }))!.orderedQuantity).toBe(5);
      expect(await w.balance()).toMatchObject({ reserved: 45, available: 5 });
    });

    it('a revision below the ordered quantity, without the ordered line, or with it moved to another room is refused and changes nothing', async () => {
      const w = await h.world(admin, { stock: 20 });
      const other = await w.createProduct();
      const quote = await w.createQuote([w.line({ qty: 5 })]);
      await w.convertQuote(quote.id, { picks: { 0: 3 } });
      const attempts = [
        [w.line({ qty: 2 })],
        [w.line({ qty: 4, productId: other.id, sku: other.sku, name: other.name })],
        [w.line({ qty: 5, area: 'Kitchen' })],
      ];
      for (const lines of attempts) {
        const r = await admin.gqlRaw(`mutation($input: CreateQuoteInput!) { createQuote(input: $input) { id } }`, {
          input: { customerId: w.customer.id, ownerId: w.ownerId, leadId: quote.leadId, supersedesQuoteId: quote.id, title: 'Bad revision', lines: JSON.stringify(lines) },
        });
        expect(refusal(r)).toContain(w.product.sku);
      }
      const parent = (await w.quoteRow(quote.id))!;
      expect(parent.supersededByQuoteId).toBeNull();
      expect(parent.status).toBe('partially_ordered');
      expect(await h.prisma.quote.count({ where: { supersedesQuoteId: quote.id } })).toBe(0);
    });

    it('the revision built from an intent (Revise on the lead page) also carries the ordered quantity', async () => {
      const w = await h.world(admin, { stock: 20 });
      const quote = await w.createQuote([w.line({ qty: 5 })]);
      await w.convertQuote(quote.id, { picks: { 0: 3 } });
      const intent = (await admin.gql(`mutation($q: String!) { startQuoteRevision(quoteId: $q) }`, { q: quote.id })).startQuoteRevision;
      const rows = (intent.rows as any[]).map((row) => ({ ...row, qty: 6 }));
      await admin.gql(`mutation($id: ID!, $input: UpdateIntentInputDto!) { updateIntent(id: $id, input: $input) }`, { id: intent.id, input: { rows } }).catch(async () => {
        await h.prisma.leadIntent.update({ where: { id: intent.id }, data: { rows } });
      });
      await admin.gql(`mutation($id: ID!) { submitIntent(id: $id) }`, { id: intent.id });
      await admin.gql(`mutation($id: String!) { generateQuoteFromIntent(intentId: $id) }`, { id: intent.id });
      const revision = (await h.prisma.quote.findFirst({ where: { intentId: intent.id } }))!;
      expect(revision.supersedesQuoteId).toBe(quote.id);
      const line = (await w.quoteLines(revision.id))[0];
      expect(line.quantity).toBe(6);
      expect(line.orderedQuantity).toBe(3);
    });

    it('cancelling the revision cancels the order made from the earlier version too', async () => {
      const w = await h.world(admin, { stock: 10 });
      const quote = await w.createQuote([w.line({ qty: 4 })]);
      const first = await w.convertQuote(quote.id);
      const revision = await w.createQuote([w.line({ qty: 6 })], { supersedes: quote.id, leadId: quote.leadId });
      const second = await w.convertQuote(revision.id);
      expect(await w.balance()).toMatchObject({ reserved: 6 });
      await w.cancelQuote(revision.id, 'Project dropped');
      expect((await w.order(first.id))!.status).toBe('cancelled');
      expect((await w.order(second.id))!.status).toBe('cancelled');
      expect(await w.balance()).toMatchObject({ reserved: 0, available: 10 });
    });

    it('cancelling the earlier order after a revision gives the quantity back on the current version', async () => {
      const w = await h.world(admin, { stock: 10 });
      const quote = await w.createQuote([w.line({ qty: 5 })]);
      const first = await w.convertQuote(quote.id, { picks: { 0: 3 } });
      const revision = await w.createQuote([w.line({ qty: 8 })], { supersedes: quote.id, leadId: quote.leadId });
      await w.cancelOrder(first.id, 'Customer wants it all in one delivery');
      expect((await w.quoteLines(revision.id))[0].orderedQuantity).toBe(0);
      expect(await w.balance()).toMatchObject({ reserved: 0 });
      const order = await w.convertQuote(revision.id);
      expect((await h.prisma.salesOrderLine.findFirst({ where: { salesOrderId: order.id } }))!.orderedQuantity).toBe(8);
    });
  });

  // ---------------- A3 / A10 / A14: lost, expired, replaced ----------------
  describe('lost, expired and replaced quotes', () => {
    it.each(['lost', 'expired'])('a quote with a live order cannot be marked %s, and the order keeps its stock', async (status) => {
      const w = await h.world(admin, { stock: 4 });
      const quote = await w.createQuote([w.line({ qty: 4 })]);
      const order = await w.convertQuote(quote.id);
      refusal(await admin.gqlRaw(STATUS, { id: quote.id, status, reason: 'Customer went quiet' }));
      expect((await w.quoteRow(quote.id))!.status).toBe('confirmed');
      expect(sum(await w.reservations(order.id))).toBe(4);
      expect(await w.balance()).toMatchObject({ reserved: 4 });
    });

    it.each(['lost', 'expired'])('a quote marked %s frees a hold left by an already cancelled order', async (status) => {
      const w = await h.world(admin, { stock: 4 });
      const quote = await w.createQuote([w.line({ qty: 3 })]);
      const order = await w.convertQuote(quote.id);
      await staleCancel(order.id, quote.id);
      expect(await w.balance()).toMatchObject({ reserved: 3 });
      const r = await admin.gql(STATUS, { id: quote.id, status, reason: 'Customer bought elsewhere' });
      expect(r.updateQuoteStatus.status).toBe(status);
      expect((await w.reservations(order.id)).map((x) => x.status)).toEqual(['released']);
      expect(await h.prisma.lotReservation.count({ where: { reservation: { salesOrderId: order.id }, status: 'reserved' } } as any)).toBe(0);
      expect(await w.balance()).toMatchObject({ onHand: 4, reserved: 0, available: 4 });
    });

    it('a replaced quote frees only the hold no live order uses', async () => {
      const w = await h.world(admin, { stock: 10 });
      const quote = await w.createQuote([w.line({ qty: 6 })]);
      const live = await w.convertQuote(quote.id, { picks: { 0: 2 } });
      const dead = await w.convertQuote(quote.id, { picks: { 0: 2 } });
      await staleCancel(dead.id, quote.id, 2);
      expect(await w.balance()).toMatchObject({ reserved: 4 });
      const revision = await w.createQuote([w.line({ qty: 6 })], { supersedes: quote.id, leadId: quote.leadId });
      expect(sum(await w.reservations(live.id))).toBe(2);
      expect((await w.reservations(dead.id)).map((x) => x.status)).toEqual(['released']);
      expect(await w.balance()).toMatchObject({ reserved: 2, available: 8 });
      expect((await w.quoteLines(revision.id))[0].orderedQuantity).toBe(2);
    });

    it('once the order is cancelled the quote can be marked lost, the reason is kept and no stock stays held', async () => {
      const w = await h.world(admin, { stock: 4 });
      const quote = await w.createQuote([w.line({ qty: 4 })]);
      const order = await w.convertQuote(quote.id);
      refusal(await admin.gqlRaw(LOST, { id: quote.id, reason: 'Too costly' }));
      await w.cancelOrder(order.id, 'Customer said no');
      await admin.gql(LOST, { id: quote.id, reason: 'Too costly' });
      const row: any = await w.quoteRow(quote.id);
      expect(row.status).toBe('lost');
      expect(row.approval.lost.reason).toBe('Too costly');
      expect(await w.balance()).toMatchObject({ reserved: 0, available: 4 });
    });

    it('marking lost needs a reason', async () => {
      const w = await h.world(admin, { stock: 1 });
      const quote = await w.createQuote([w.line({ qty: 1 })]);
      refusal(await admin.gqlRaw(LOST, { id: quote.id, reason: '  ' }));
      refusal(await admin.gqlRaw(STATUS, { id: quote.id, status: 'lost' }));
      expect((await w.quoteRow(quote.id))!.status).not.toBe('lost');
    });

    it('the lead becomes lost only when nothing else is open on it', async () => {
      const w = await h.world(admin, { stock: 5 });
      const a = await w.createQuote([w.line({ qty: 1 })]);
      const b = await w.createQuoteOnLead(a.leadId!, [w.line({ qty: 2 })]);
      await admin.gql(LOST, { id: a.id, reason: 'Chose the other option' });
      expect((await h.prisma.lead.findUnique({ where: { id: a.leadId! } }))!.stage).not.toBe('lost');
      await admin.gql(LOST, { id: b.id, reason: 'Project shelved' });
      expect((await h.prisma.lead.findUnique({ where: { id: a.leadId! } }))!.stage).toBe('lost');
    });

    it('cancelling a quote while another order is live on the lead keeps the lead won', async () => {
      const w = await h.world(admin, { stock: 5 });
      const a = await w.createQuote([w.line({ qty: 1 })]);
      const b = await w.createQuoteOnLead(a.leadId!, [w.line({ qty: 2 })]);
      await w.convertQuote(b.id);
      await w.cancelQuote(a.id, 'Merged into the other quote');
      expect((await h.prisma.lead.findUnique({ where: { id: a.leadId! } }))!.stage).toBe('won');
    });
  });

  // ---------------- A14: validity ----------------
  async function setExpirySwitch(on: boolean) {
    const row = await h.prisma.appSetting.findFirst({ orderBy: { updatedAt: 'desc' } });
    if (!row) throw new Error('No settings row in the test database');
    await h.prisma.appSetting.update({ where: { id: row.id }, data: { quoteExpiryEnabled: on, updatedAt: new Date() } as any });
  }

  describe('valid-until date with the expiry switch off (the default)', () => {
    beforeAll(() => setExpirySwitch(false));

    it('a quote past its date still opens as it was, converts and keeps its stock', async () => {
      const w = await h.world(admin, { stock: 5 });
      const quote = await w.createQuote([w.line({ qty: 2 })]);
      await h.prisma.quote.update({ where: { id: quote.id }, data: { validUntil: new Date(Date.now() - 2 * DAY) } });
      expect((await admin.gql(READ, { id: quote.id })).quote.status).toBe('draft');
      expect((await admin.gql(SEND, { id: quote.id })).sendQuote.status).toBe('sent');
      await admin.gql(SHARE, { id: quote.id, allow: true });
      const order = await w.convertQuote(quote.id);
      expect(sum(await w.reservations(order.id))).toBe(2);
      const run: any = await h.app.get(QuotesService).expireOverdueQuotes();
      expect(run.expired).toBe(0);
      expect((await w.quoteRow(quote.id))!.status).toBe('confirmed');
      expect(await w.balance()).toMatchObject({ reserved: 2, available: 3 });
    });
  });

  describe('valid-until date with the expiry switch on', () => {
    beforeAll(() => setExpirySwitch(true));
    afterAll(() => setExpirySwitch(false));

    it('a quote past its date cannot be sent, shared or ordered until it is re-dated', async () => {
      const w = await h.world(admin, { stock: 5 });
      const quote = await w.createQuote([w.line({ qty: 1 })]);
      await h.prisma.quote.update({ where: { id: quote.id }, data: { validUntil: new Date(Date.now() - 2 * DAY) } });
      expect((await admin.gql(READ, { id: quote.id })).quote.status).toBe('expired');
      for (const [q, v] of [[SEND, { id: quote.id }], [SHARE, { id: quote.id, allow: true }]] as const) {
        expect(refusal(await admin.gqlRaw(q, v as any))).toMatch(/valid until/i);
      }
      expect(refusal(await convertRaw(w, quote.id, 1))).toMatch(/valid until/i);
      expect(await h.prisma.salesOrder.count({ where: { quoteId: quote.id } })).toBe(0);

      // Re-dating to a date already past is refused; a future date brings it back.
      refusal(await admin.gqlRaw(UPDATE, { id: quote.id, input: { validUntil: new Date(Date.now() - DAY).toISOString() } }));
      const back = (await admin.gql(UPDATE, { id: quote.id, input: { validUntil: new Date(Date.now() + 10 * DAY).toISOString() } })).updateQuote;
      expect(back.status).toBe('draft');
      expect((await admin.gql(SEND, { id: quote.id })).sendQuote.status).toBe('sent');
      await admin.gql(SHARE, { id: quote.id, allow: true });
      const order = await w.convertQuote(quote.id);
      expect(order.id).toBeTruthy();
    });

    it('the expiry sweep expires open quotes past their date and leaves part-ordered ones alone', async () => {
      const w = await h.world(admin, { stock: 10 });
      const open = await w.createQuote([w.line({ qty: 1 })]);
      const partial = await w.createQuote([w.line({ qty: 4 })]);
      await w.convertQuote(partial.id, { picks: { 0: 1 } });
      const past = new Date(Date.now() - 3 * DAY);
      await h.prisma.quote.updateMany({ where: { id: { in: [open.id, partial.id] } }, data: { validUntil: past } });
      const service = h.app.get(QuotesService);
      for (let i = 0; i < 30 && (await w.quoteRow(open.id))!.status !== 'expired'; i += 1) {
        const run: any = await service.expireOverdueQuotes();
        if (!run.checked) break;
      }
      expect((await w.quoteRow(open.id))!.status).toBe('expired');
      expect((await w.quoteRow(partial.id))!.status).toBe('partially_ordered');
      expect(await w.balance()).toMatchObject({ reserved: 1 });
    });
  });

  // ---------------- A14: owner turns down a price ----------------
  describe('approvals', () => {
    it('the owner turns down a below-floor price: the quote goes back as a draft and cannot be sent, shared or ordered', async () => {
      const w = await h.world(admin, { stock: 5 });
      const quote = await w.createQuote([special(w, 1, 500)]); // floor is 800
      expect((await w.quoteRow(quote.id))!.status).toBe('pending_approval');
      refusal(await owner.gqlRaw(REJECT, { id: quote.id, note: ' ' }));
      const rejected = (await owner.gql(REJECT, { id: quote.id, note: 'I can do 850, not 500' })).rejectQuote;
      expect(rejected).toMatchObject({ status: 'draft', approvalStatus: 'rejected' });
      const row: any = await w.quoteRow(quote.id);
      expect(row.approval.rejection.note).toBe('I can do 850, not 500');
      expect(row.approval.rejection.rejectedByUserId).toBe(owner.userId);
      expect(await h.prisma.auditEvent.count({ where: { entityId: quote.id, action: 'quote.reject', actorUserId: owner.userId } })).toBe(1);
      expect(refusal(await admin.gqlRaw(SEND, { id: quote.id }))).toContain('850');
      refusal(await admin.gqlRaw(SHARE, { id: quote.id, allow: true }));
      refusal(await convertRaw(w, quote.id, 1));
      // Turning it down twice is refused (it is no longer waiting).
      refusal(await owner.gqlRaw(REJECT, { id: quote.id, note: 'again' }));

      // Still below the floor: asks again. Above it: approved without the owner.
      const again = (await admin.gql(UPDATE, { id: quote.id, input: { lines: JSON.stringify([special(w, 1, 600)]) } })).updateQuote;
      expect(again).toMatchObject({ status: 'pending_approval', approvalStatus: 'pending' });
      const fixed = (await admin.gql(UPDATE, { id: quote.id, input: { lines: JSON.stringify([special(w, 1, 950)]) } })).updateQuote;
      expect(fixed.approvalStatus).toBe('approved');
      expect((await admin.gql(SEND, { id: quote.id })).sendQuote.status).toBe('sent');
    });

    it('the owner approves a below-floor price and the quote can then be ordered', async () => {
      const w = await h.world(admin, { stock: 5 });
      const quote = await w.createQuote([special(w, 1, 500)]);
      refusal(await convertRaw(w, quote.id, 1));
      expect((await owner.gql(APPROVE, { id: quote.id, note: 'Old customer' })).approveQuote.approvalStatus).toBe('approved');
      const row: any = await w.quoteRow(quote.id);
      expect(row.approval.pricing).toBeTruthy(); // approval keeps the stored pricing snapshot
      expect(row.approval.approvedByUserId).toBe(owner.userId);
      expect((await w.convertQuote(quote.id)).id).toBeTruthy();
    });
  });

  // ---------------- A8 / A13: saves and statuses ----------------
  describe('saving and status rules', () => {
    it('two saves of one quote from the same starting point: the second is refused', async () => {
      const w = await h.world(admin, { stock: 2 });
      const quote = await w.createQuote([w.line({ qty: 1 })]);
      const loaded = (await admin.gql(READ, { id: quote.id })).quote.updatedAt;
      await admin.gql(UPDATE, { id: quote.id, input: { notes: 'First tab', expectedUpdatedAt: loaded } });
      expect(refusal(await admin.gqlRaw(UPDATE, { id: quote.id, input: { notes: 'Second tab', expectedUpdatedAt: loaded } }))).toMatch(/someone else saved/i);
      expect((await w.quoteRow(quote.id))!.notes).toBe('First tab');

      // Both at the same moment: exactly one lands.
      const fresh = (await admin.gql(READ, { id: quote.id })).quote.updatedAt;
      const both = await Promise.all(['Tab A', 'Tab B'].map((notes) => admin.gqlRaw(UPDATE, { id: quote.id, input: { notes, expectedUpdatedAt: fresh } })));
      expect(both.filter((r) => !r.errors?.length)).toHaveLength(1);
      expect(both.filter((r) => r.errors?.length)).toHaveLength(1);
    });

    it('a cancelled quote cannot be saved', async () => {
      const w = await h.world(admin, { stock: 2 });
      const quote = await w.createQuote([w.line({ qty: 1 })]);
      await w.cancelQuote(quote.id, 'Duplicate quote');
      refusal(await admin.gqlRaw(UPDATE, { id: quote.id, input: { notes: 'Edit after cancel' } }));
      refusal(await admin.gqlRaw(UPDATE, { id: quote.id, input: { lines: JSON.stringify([w.line({ qty: 2 })]) } }));
    });

    it('a quote with an order cannot have its lines changed in place', async () => {
      const w = await h.world(admin, { stock: 5 });
      const quote = await w.createQuote([w.line({ qty: 2 })]);
      await w.convertQuote(quote.id, { picks: { 0: 1 } });
      refusal(await admin.gqlRaw(UPDATE, { id: quote.id, input: { lines: JSON.stringify([w.line({ qty: 1 })]) } }));
      expect((await w.quoteLines(quote.id))[0].orderedQuantity).toBe(1);
    });

    it.each(['approved', 'confirmed', 'won', 'partially_ordered'])('the status call refuses to set %s directly', async (status) => {
      const w = await h.world(admin, { stock: 1 });
      const quote = await w.createQuote([w.line({ qty: 1 })]);
      refusal(await admin.gqlRaw(STATUS, { id: quote.id, status }));
      expect((await w.quoteRow(quote.id))!.status).toBe('draft');
    });

    it('the status call still moves a quote to customer follow-up', async () => {
      const w = await h.world(admin, { stock: 1 });
      const quote = await w.createQuote([w.line({ qty: 1 })]);
      expect((await admin.gql(STATUS, { id: quote.id, status: 'customer_followup' })).updateQuoteStatus.status).toBe('customer_followup');
    });
  });

  // ---------------- A7: GST ----------------
  it('a quote line with 0% GST stays 0%, and an empty GST box saves 18%', async () => {
    const w = await h.world(admin, { stock: 2 });
    const zero = { ...w.line({ qty: 1 }), taxRate: 0 };
    const empty: any = { ...w.line({ qty: 1, area: 'Bathroom' }), taxRate: '' };
    const quote = await w.createQuote([zero, empty]);
    expect((await w.quoteLines(quote.id)).map((l) => Number(l.taxRate))).toEqual([0, 18]);
  });

  // ---------------- A12: boxes vs pieces ----------------
  it('the availability check on a boxed tile compares pieces, not boxes', async () => {
    const w = await h.world(admin, { stock: 0 });
    const tile = await w.createProduct({ unit: 'BOX', name: `Harness tile ${stamp()}` });
    await h.prisma.product.update({ where: { id: tile.id }, data: { baseUom: 'PC', piecesPerPack: 10 } as any });
    await w.receiveGoods({ qty: 25, productId: tile.id });
    const onHandPieces = (await w.balance(tile.id)).onHand;
    expect(onHandPieces).toBeGreaterThanOrEqual(10);
    const fullBoxes = Math.floor(onHandPieces / 10);
    const tileLine = (qty: number) => ({ ...w.line({ qty, productId: tile.id, sku: tile.sku, name: tile.name }), unit: 'BOX' });

    const fits = await w.createQuote([tileLine(fullBoxes)]);
    expect(((await w.quoteRow(fits.id)) as any).approval.availabilityIssues).toEqual([]);

    const short = await w.createQuote([tileLine(fullBoxes + 1)]);
    const issues = ((await w.quoteRow(short.id)) as any).approval.availabilityIssues;
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ requested: fullBoxes + 1, available: fullBoxes, shortage: 1, requestedBase: (fullBoxes + 1) * 10, availableBase: onHandPieces, factor: 10 });

    // Ordering the boxes that fit reserves their pieces.
    const order = await w.convertQuote(fits.id);
    expect(sum(await w.reservations(order.id))).toBe(fullBoxes * 10);
  });
});
