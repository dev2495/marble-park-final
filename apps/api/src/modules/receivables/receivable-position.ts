// One definition of "receivable", used by Customer Accounts and the owner reports:
// for each customer, what is open on their invoices less the credit they already
// hold (unapplied receipts and unapplied credit notes), never below zero; summed
// across customers. Worked out on the server in paise, independent of any search.

const ACTIVE_INVOICE = ['posted', 'partial'];
const paise = (value: unknown) => Math.round((Number(value || 0) || 0) * 100);

export type ReceivablePosition = {
  receivable: number;
  overdue: number;
  openInvoices: number;
  unappliedCredit: number;
  byCustomer: Map<string, { open: number; overdue: number; credit: number; receivable: number }>;
};

export async function receivablePosition(prisma: any, now = new Date()): Promise<ReceivablePosition> {
  const [open, overdue, receipts, credits] = await Promise.all([
    prisma.salesInvoice.groupBy({ by: ['customerId'], where: { status: { in: ACTIVE_INVOICE }, openAmount: { gt: 0 } }, _sum: { openAmount: true } }),
    prisma.salesInvoice.groupBy({ by: ['customerId'], where: { status: { in: ACTIVE_INVOICE }, openAmount: { gt: 0 }, dueDate: { lt: now } }, _sum: { openAmount: true } }),
    prisma.customerPayment.groupBy({ by: ['customerId'], where: { status: 'posted', unappliedAmount: { gt: 0 } }, _sum: { unappliedAmount: true } }),
    prisma.creditNote.groupBy({ by: ['customerId'], where: { status: 'issued', unappliedAmount: { gt: 0 }, customerId: { not: null } }, _sum: { unappliedAmount: true } }),
  ]);
  const rows = new Map<string, { open: number; overdue: number; credit: number }>();
  const row = (id: string) => { if (!rows.has(id)) rows.set(id, { open: 0, overdue: 0, credit: 0 }); return rows.get(id)!; };
  (open as any[]).forEach((r) => { row(r.customerId).open += paise(r._sum?.openAmount); });
  (overdue as any[]).forEach((r) => { row(r.customerId).overdue += paise(r._sum?.openAmount); });
  (receipts as any[]).forEach((r) => { row(r.customerId).credit += paise(r._sum?.unappliedAmount); });
  (credits as any[]).forEach((r) => { if (r.customerId) row(r.customerId).credit += paise(r._sum?.unappliedAmount); });
  let receivable = 0; let overdueTotal = 0; let openTotal = 0; let creditTotal = 0;
  const byCustomer = new Map<string, { open: number; overdue: number; credit: number; receivable: number }>();
  for (const [customerId, r] of rows) {
    const net = Math.max(0, r.open - r.credit);
    receivable += net; overdueTotal += r.overdue; openTotal += r.open; creditTotal += r.credit;
    byCustomer.set(customerId, { open: r.open / 100, overdue: r.overdue / 100, credit: r.credit / 100, receivable: net / 100 });
  }
  return { receivable: receivable / 100, overdue: overdueTotal / 100, openInvoices: openTotal / 100, unappliedCredit: creditTotal / 100, byCustomer };
}
