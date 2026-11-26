import { Harness, Session, stamp } from '../harness';
import { numberingPeriod } from '../../src/modules/common/sequence';
import { assertLedger, delivered, invoiceRow, newCustomer, paise } from '../money-support';

/** Report figures (C6, C7, C9) and the two Settings switches (C10, C11). */
describe('money: reports and settings switches', () => {
  let h: Harness; let admin: Session;
  let original: { documentNumberingPeriod: string; invoiceGstSplitEnabled: boolean } | null = null;
  beforeAll(async () => {
    h = await Harness.boot(); admin = await h.as('admin');
    const row: any = await h.prisma.appSetting.findFirst({ orderBy: { updatedAt: 'desc' } });
    original = row ? { documentNumberingPeriod: row.documentNumberingPeriod, invoiceGstSplitEnabled: row.invoiceGstSplitEnabled } : null;
  });
  afterAll(async () => {
    if (original) await admin.gql(`mutation($input: UpdateSettingsInput!) { updateAppSettings(input: $input) { data } }`, { input: original }).catch(() => undefined);
    await h.close();
  });

  const settings = (input: Record<string, any>) => admin.gql(`mutation($input: UpdateSettingsInput!) { updateAppSettings(input: $input) { data } }`, { input });
  const taxableOf = (lines: any) => Math.round((Array.isArray(lines) ? lines : []).reduce((s: number, l: any) => s + Number(l?.taxableValue || 0), 0) * 100) / 100;

  // C6: one quote value rule.
  it('quote value is the same on the owner dashboard, the sales dashboard and the owner report; replaced and cancelled quotes are left out', async () => {
    const w = await h.world(admin, { stock: 10 });
    const owner = (await admin.gql(`query($id: String!) { salesDashboard(ownerId: $id) { stats } }`, { id: w.ownerId })).salesDashboard.stats;
    const before = (await admin.gql(`query { ownerDashboard { stats } }`)).ownerDashboard.stats;
    const q1 = await w.createQuote([w.line({ qty: 2 })]);
    const q2 = await w.createQuote([w.line({ qty: 3 })], { supersedes: q1.id, leadId: q1.leadId });
    const q3 = await w.createQuote([w.line({ qty: 4 })]);
    await w.cancelQuote(q3.id);
    const rows = await h.prisma.quote.findMany({ where: { id: { in: [q1.id, q2.id, q3.id] } } });
    const byId = new Map(rows.map((r: any) => [r.id, r]));
    expect(byId.get(q1.id)!.supersededByQuoteId).toBe(q2.id);
    const value = taxableOf(byId.get(q2.id)!.lines);
    expect(value).toBeGreaterThan(0);

    const after = (await admin.gql(`query { ownerDashboard { stats } }`)).ownerDashboard.stats;
    expect(paise(after.totalQuoteValue) - paise(before.totalQuoteValue)).toBe(paise(value));
    const ownerAfter = (await admin.gql(`query($id: String!) { salesDashboard(ownerId: $id) { stats } }`, { id: w.ownerId })).salesDashboard.stats;
    expect(paise(ownerAfter.quoteValue) - paise(owner.quoteValue)).toBe(paise(value));

    const report = (await admin.gql(`query($f: OwnerReportFilters) { ownerReport(kind: "sales-quotes", filters: $f) }`, { f: { ownerId: w.ownerId } })).ownerReport;
    const mine = (report.table?.rows || []).filter((r: any) => [q1.id, q2.id, q3.id].includes(r.id));
    expect(mine.find((r: any) => r.id === q1.id)).toBeUndefined();
    const counted = mine.filter((r: any) => !['cancelled', 'superseded'].includes(r.status));
    expect(counted.map((r: any) => r.id)).toEqual([q2.id]);
    expect(paise(counted[0].taxable)).toBe(paise(value));
  });

  // C7: stock at MRP for boxed tiles.
  it('stock at MRP for a tile sold by the box of 10, stocked in pieces, and for a per sq ft tile', async () => {
    const brand = `HarnessTile${stamp()}`;
    const make = (o: Record<string, any>) => admin.gql(`mutation($input: CreateProductInput!) { createProduct(input: $input) { id sku } }`, {
      input: { sku: `HT-TL-${stamp()}`, internalCode: `HT-TL-${stamp()}`, name: `Harness tile ${stamp()}`, category: 'Tiles', brand, finish: 'Matt', baseUom: 'PC', piecesPerPack: 10, mrpSource: 'MANUAL', taxClass: 'GST_18', ...o },
    }).then((d) => d.createProduct);
    const w = await h.world(admin, { stock: 0 });
    const before = (await admin.gql(`query { inventoryDashboard { stats } }`)).inventoryDashboard.stats;
    // Tiles are priced per piece or per area (the product rules refuse a per-box tile price), so a box of 10 at 1,200 is 120 a piece.
    const box = await make({ unit: 'BOX', salesUom: 'BOX', priceUom: 'PC', priceRateBasis: 'PIECE', defaultMrpInclusive: 120, defaultNrpInclusive: 100 });
    await w.receiveGoods({ qty: 500, productId: box.id });
    expect((await w.balance(box.id)).onHand).toBe(500);
    const mid = (await admin.gql(`query { inventoryDashboard { stats } }`)).inventoryDashboard.stats;
    expect(paise(mid.mrpValue) - paise(before.mrpValue)).toBe(paise(60000));

    const area = await make({ unit: 'BOX', salesUom: 'BOX', priceUom: 'SQFT', priceRateBasis: 'AREA', coveragePerPack: 15, defaultMrpInclusive: 100, defaultNrpInclusive: 90 });
    await w.receiveGoods({ qty: 200, productId: area.id });
    const after = (await admin.gql(`query { inventoryDashboard { stats } }`)).inventoryDashboard.stats;
    // 100 per sq ft x 15 sq ft per box / 10 pieces per box = 150 per piece; 200 pieces = 30,000.
    expect(paise(after.mrpValue) - paise(mid.mrpValue)).toBe(paise(30000));

    const report = (await admin.gql(`query($f: OwnerReportFilters) { ownerReport(kind: "stock-value", filters: $f) }`, { f: { brand, tab: 'top' } })).ownerReport;
    const rows = report.table?.rows || [];
    expect(paise(rows.find((r: any) => r.id === box.id)?.valueMrp)).toBe(paise(60000));
    expect(paise(rows.find((r: any) => r.id === area.id)?.valueMrp)).toBe(paise(30000));
  });

  // C10: numbering.
  it('numbering restarts on 1 April in India time when the switch is on', async () => {
    const tx = (mode: string) => ({ appSetting: { findFirst: async () => ({ documentNumberingPeriod: mode }) } });
    expect(await numberingPeriod(tx('financial'), new Date('2027-03-31T18:29:59.999Z'))).toEqual({ key: 'FY2026', label: '2026-27' });
    expect(await numberingPeriod(tx('financial'), new Date('2027-03-31T18:30:00.000Z'))).toEqual({ key: 'FY2027', label: '2027-28' });
    expect(await numberingPeriod(tx('financial'), new Date('2026-04-01T00:00:00+05:30'))).toEqual({ key: 'FY2026', label: '2026-27' });
    const d = new Date('2026-06-15T10:00:00Z');
    expect(await numberingPeriod(tx('calendar'), d)).toEqual({ key: String(d.getFullYear()), label: String(d.getFullYear()) });
    expect(await numberingPeriod({}, d)).toEqual({ key: String(d.getFullYear()), label: String(d.getFullYear()) });
  });

  it('switches off: same numbering as before and no GST split; on: April-March numbers, CGST+SGST in state, IGST out of state', async () => {
    const doc = (await admin.gql(`query { documentSettings { data } }`)).documentSettings.data;
    expect(doc.invoiceGstSplitEnabled).toBe(false);
    expect((await h.prisma.appSetting.findFirst({ orderBy: { updatedAt: 'desc' } }) as any).documentNumberingPeriod).toBe('calendar');
    const year = new Date().getFullYear();
    const w = await h.world(admin, { stock: 20 });
    const issue = async () => { const { order, challan } = await delivered(w, { qty: 1 }); return w.invoice(order.id, challan.id); };
    const view = (id: string) => admin.gql(`query($id: ID!) { salesInvoice(id: $id) }`, { id }).then((d) => d.salesInvoice);

    const off = await issue();
    expect(off.invoiceNumber).toMatch(new RegExp(`^INV/${year}/\\d{4}$`));
    const counter = await h.prisma.sequenceCounter.findUniqueOrThrow({ where: { scope: `sales_invoice:${year}` } });
    expect(Number(off.invoiceNumber.split('/')[2])).toBe(Number(counter.value));
    expect(off.gstSplit.enabled).toBe(false);
    expect(off.gstSplit.documentTitle).toBe('TAX INVOICE');
    const paidOff = await w.receipt({ amount: 1 });
    expect(paidOff.receiptNumber).toMatch(new RegExp(`^RCPT/${year}/\\d{4}$`));

    try {
      await settings({ documentNumberingPeriod: 'financial', invoiceGstSplitEnabled: true });
      const india = new Date(Date.now() + 330 * 60000);
      const fy = india.getUTCMonth() >= 3 ? india.getUTCFullYear() : india.getUTCFullYear() - 1;
      const label = `${fy}-${String((fy + 1) % 100).padStart(2, '0')}`;
      const fin = await issue();
      expect(fin.invoiceNumber).toMatch(new RegExp(`^INV/${label}/\\d{4}$`));
      expect(Number((await h.prisma.sequenceCounter.findUniqueOrThrow({ where: { scope: `sales_invoice:FY${fy}` } })).value)).toBe(Number(fin.invoiceNumber.split('/')[2]));

      // Walk-in with no GSTIN or state: shop's own state (Gujarat in the test data), CGST + SGST.
      const local = await view(fin.id);
      const tax = paise(local.taxAmount);
      expect(tax).toBeGreaterThan(0);
      expect(local.gstSplit.enabled).toBe(true);
      expect(local.gstSplit.interState).toBe(false);
      expect(paise(local.gstSplit.cgst) + paise(local.gstSplit.sgst)).toBe(tax);
      expect(Math.abs(paise(local.gstSplit.cgst) - paise(local.gstSplit.sgst))).toBeLessThanOrEqual(local.lines.length);
      expect(local.gstSplit.igst).toBe(0);

      await newCustomer(w, { state: 'Gujarat' });
      const guj = await view((await issue()).id);
      expect(guj.gstSplit.interState).toBe(false);
      expect(paise(guj.gstSplit.cgst) + paise(guj.gstSplit.sgst)).toBe(paise(guj.taxAmount));

      const letters = () => Array.from({ length: 5 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');
      await newCustomer(w, { gstNo: `27${letters()}${String(Math.floor(Math.random() * 9000) + 1000)}F1ZV`, state: 'Maharashtra' });
      const mh = await view((await issue()).id);
      expect(mh.gstSplit.interState).toBe(true);
      expect(mh.gstSplit.placeOfSupply).toBe('Maharashtra');
      expect(paise(mh.gstSplit.igst)).toBe(paise(mh.taxAmount));
      expect(mh.gstSplit.cgst + mh.gstSplit.sgst).toBe(0);
    } finally {
      await settings({ documentNumberingPeriod: 'calendar', invoiceGstSplitEnabled: false });
    }
    const back = await issue();
    expect(back.invoiceNumber).toMatch(new RegExp(`^INV/${year}/\\d{4}$`));
    expect(Number(back.invoiceNumber.split('/')[2])).toBe(Number(off.invoiceNumber.split('/')[2]) + 1);
    expect((await view(back.id)).gstSplit.enabled).toBe(false);
    await assertLedger(h, admin, w.customer.id);
    expect(Number((await invoiceRow(w, back.id)).openAmount)).toBeGreaterThan(0);
  });
});
