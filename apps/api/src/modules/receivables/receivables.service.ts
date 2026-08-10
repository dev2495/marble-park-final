import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ulid } from 'ulid';
import { AuditService } from '../audit/audit.service';
import { nextDocumentNumber } from '../common/sequence';
import { PrismaService } from '../prisma/prisma.service';

type InvoiceInput = {
  salesOrderId: string;
  dispatchLineIds?: string[];
  dueDate?: string | Date | null;
  notes?: string;
  idempotencyKey?: string;
};

type PaymentInput = {
  customerId: string;
  salesOrderId?: string | null;
  salesInvoiceId?: string | null;
  paymentMode: string;
  moneyAccount?: string;
  amount: number;
  receivedAt?: string | Date | null;
  valueDate?: string | Date | null;
  reference?: string;
  notes?: string;
  attachmentUrls?: string[];
  autoAllocate?: boolean;
  idempotencyKey?: string;
};

type CollectionTaskInput = {
  customerId: string;
  salesInvoiceId?: string | null;
  ownerId?: string | null;
  priority?: string;
  dueAt?: string | Date | null;
  note?: string;
};

const ACTIVE_ALLOCATION = 'posted';
const ACTIVE_INVOICE = ['posted', 'partial'];

function roundMoney(value: number) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function asDate(value?: string | Date | null) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new BadRequestException('Enter a valid date.');
  return parsed;
}

function paymentDays(terms: string | null | undefined) {
  const match = String(terms || '').match(/(\d+)\s*(?:day|days)/i);
  return match ? Math.max(0, Number(match[1])) : 0;
}

function sourceLabel(type: string) {
  if (type === 'SalesInvoice') return 'Invoice';
  if (type === 'CustomerPayment') return 'Receipt';
  if (type === 'CreditNote') return 'Credit note';
  if (type === 'CreditNoteRefund') return 'Refund';
  if (type === 'CustomerPaymentVoid') return 'Receipt reversal';
  return type;
}

@Injectable()
export class ReceivablesService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  private async nextNumber(tx: any, scope: string, prefix: string, model: string, field: string, date = new Date()) {
    return nextDocumentNumber(tx, scope, prefix, date, {
      existingNumbers: async (prefixForYear) => (await tx[model].findMany({
        where: { [field]: { startsWith: prefixForYear } },
        select: { [field]: true },
      })).map((row: any) => row[field]),
    });
  }

  private ledgerEntry(tx: any, input: {
    customerId: string; sourceType: string; sourceId: string; sourceKey: string;
    effectiveAt?: Date; debit?: number; credit?: number; narration: string; createdBy: string; metadata?: any;
  }) {
    return tx.customerLedgerEntry.upsert({
      where: { sourceKey: input.sourceKey },
      update: {},
      create: {
        id: ulid(),
        entryNumber: `AR/${ulid()}`,
        customerId: input.customerId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        sourceKey: input.sourceKey,
        effectiveAt: input.effectiveAt || new Date(),
        debit: roundMoney(input.debit || 0),
        credit: roundMoney(input.credit || 0),
        narration: input.narration,
        createdBy: input.createdBy,
        metadata: input.metadata || {},
      },
    });
  }

  private async syncInvoiceOpenAmountTx(tx: any, invoiceId: string) {
    const invoice = await tx.salesInvoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) return null;
    const rows = await tx.customerAllocation.findMany({
      where: { salesInvoiceId: invoiceId, status: ACTIVE_ALLOCATION },
      select: { amount: true },
    });
    const allocated = roundMoney(rows.reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0));
    const openAmount = Math.max(0, roundMoney(Number(invoice.totalAmount || 0) - allocated));
    const status = openAmount <= 0 ? 'paid' : allocated > 0 ? 'partial' : 'posted';
    return tx.salesInvoice.update({ where: { id: invoiceId }, data: { openAmount, status, updatedAt: new Date() } });
  }

  private async syncSalesOrderPaymentStatusTx(tx: any, salesOrderId: string) {
    const [order, invoices, payments] = await Promise.all([
      tx.salesOrder.findUnique({ where: { id: salesOrderId }, select: { totalAmount: true, paymentMode: true } }),
      tx.salesInvoice.findMany({ where: { salesOrderId, status: { not: 'void' } }, select: { openAmount: true, totalAmount: true } }),
      tx.customerPayment.findMany({ where: { salesOrderId, status: 'posted' }, select: { amount: true } }),
    ]);
    if (!order) return;
    if (!invoices.length) {
      const received = roundMoney(payments.reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0));
      const total = roundMoney(Number(order.totalAmount || 0));
      const paymentStatus = order.paymentMode === 'credit'
        ? 'credit'
        : received >= total && total > 0 ? 'paid' : received > 0 ? 'advance' : 'pending_cash';
      await tx.salesOrder.update({ where: { id: salesOrderId }, data: { paymentStatus, advanceAmount: Math.min(received, total), updatedAt: new Date() } });
      return;
    }
    const total = invoices.reduce((sum: number, row: any) => sum + Number(row.totalAmount || 0), 0);
    const open = invoices.reduce((sum: number, row: any) => sum + Number(row.openAmount || 0), 0);
    const paymentStatus = open <= 0 ? 'paid' : open < total ? 'partial' : 'awaiting_payment';
    await tx.salesOrder.update({ where: { id: salesOrderId }, data: { paymentStatus, updatedAt: new Date() } });
  }

  private async allocateSourceTx(tx: any, args: {
    customerId: string;
    sourceType: string;
    sourceId: string;
    amount: number;
    createdBy: string;
    invoiceIds?: string[];
  }) {
    let remaining = roundMoney(args.amount);
    if (remaining <= 0) return { allocated: 0, remaining: 0, invoiceIds: [] as string[] };
    const where: any = {
      customerId: args.customerId,
      status: { in: ACTIVE_INVOICE },
      openAmount: { gt: 0 },
    };
    if (args.invoiceIds?.length) where.id = { in: args.invoiceIds };
    const invoices = await tx.salesInvoice.findMany({ where, orderBy: [{ dueDate: 'asc' }, { issueDate: 'asc' }] });
    const touched: string[] = [];
    for (const invoice of invoices) {
      if (remaining <= 0) break;
      const existing = await tx.customerAllocation.findUnique({
        where: { sourceType_sourceId_salesInvoiceId: { sourceType: args.sourceType, sourceId: args.sourceId, salesInvoiceId: invoice.id } },
      });
      const existingAmount = Number(existing?.amount || 0);
      const amount = Math.min(remaining, Math.max(0, Number(invoice.openAmount || 0)));
      if (amount <= 0) continue;
      await tx.customerAllocation.upsert({
        where: { sourceType_sourceId_salesInvoiceId: { sourceType: args.sourceType, sourceId: args.sourceId, salesInvoiceId: invoice.id } },
        update: { amount: roundMoney(existingAmount + amount), status: ACTIVE_ALLOCATION, updatedAt: new Date() },
        create: {
          id: ulid(), customerId: args.customerId, salesInvoiceId: invoice.id,
          sourceType: args.sourceType, sourceId: args.sourceId, amount: roundMoney(amount),
          status: ACTIVE_ALLOCATION, createdBy: args.createdBy, updatedAt: new Date(),
        },
      });
      remaining = roundMoney(remaining - amount);
      touched.push(invoice.id);
      await this.syncInvoiceOpenAmountTx(tx, invoice.id);
    }
    return { allocated: roundMoney(args.amount - remaining), remaining, invoiceIds: touched };
  }

  private async updatePaymentUnappliedTx(tx: any, paymentId: string) {
    const payment = await tx.customerPayment.findUnique({ where: { id: paymentId } });
    if (!payment) return null;
    const allocations = await tx.customerAllocation.findMany({
      where: { sourceType: 'CustomerPayment', sourceId: paymentId, status: ACTIVE_ALLOCATION },
      select: { amount: true },
    });
    const allocated = allocations.reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0);
    return tx.customerPayment.update({
      where: { id: paymentId },
      data: { unappliedAmount: Math.max(0, roundMoney(Number(payment.amount || 0) - allocated)), updatedAt: new Date() },
    });
  }

  private async completeInvoiceView(id: string) {
    const invoice = await this.prisma.salesInvoice.findUnique({
      where: { id },
      include: { lines: true, allocations: { where: { status: ACTIVE_ALLOCATION }, orderBy: { createdAt: 'asc' } } },
    } as any) as any;
    if (!invoice) throw new NotFoundException('Invoice not found.');
    const [customer, order] = await Promise.all([
      this.prisma.customer.findUnique({ where: { id: invoice.customerId } }),
      this.prisma.salesOrder.findUnique({ where: { id: invoice.salesOrderId } }),
    ]);
    return { ...invoice, customer, salesOrder: order };
  }

  async invoiceableOrders(args?: { take?: number }) {
    const take = Math.min(Math.max(Number(args?.take || 80), 1), 300);
    const dispatchLines = await this.prisma.dispatchLine.findMany({
      where: { salesOrderId: { not: null }, status: { in: ['dispatched', 'delivered'] }, dispatchedQuantity: { gt: 0 } },
      orderBy: { createdAt: 'desc' },
      take: take * 10,
    });
    const ids = dispatchLines.map((row: any) => row.id);
    const invoiced = ids.length ? await this.prisma.salesInvoiceLine.findMany({ where: { dispatchLineId: { in: ids } }, select: { dispatchLineId: true } }) : [];
    const used = new Set(invoiced.map((row: any) => row.dispatchLineId));
    const candidates = dispatchLines.filter((row: any) => !used.has(row.id));
    const orderIds = [...new Set(candidates.map((row: any) => row.salesOrderId).filter(Boolean))];
    const orders = orderIds.length ? await this.prisma.salesOrder.findMany({ where: { id: { in: orderIds } } }) : [];
    const orderById = new Map((orders as any[]).map((row) => [row.id, row]));
    const customerIds = [...new Set(candidates.map((row: any) => orderById.get(row.salesOrderId || '')?.customerId).filter(Boolean))];
    const customers = customerIds.length ? await this.prisma.customer.findMany({ where: { id: { in: customerIds } } }) : [];
    const customerById = new Map((customers as any[]).map((row) => [row.id, row]));
    const groups = new Map<string, any[]>();
    for (const row of candidates) groups.set(row.salesOrderId!, [...(groups.get(row.salesOrderId!) || []), row]);
    return [...groups.entries()].slice(0, take).map(([salesOrderId, rows]) => {
      const order = orderById.get(salesOrderId);
      return {
        salesOrderId,
        orderNumber: order?.orderNumber || salesOrderId,
        customer: customerById.get(order?.customerId) || null,
        paymentTerms: order?.paymentTerms || '',
        lineCount: rows.length,
        dispatchLineIds: rows.map((row) => row.id),
        lines: rows.map((row) => ({ id: row.id, sku: row.sku, name: row.name, quantity: row.dispatchedQuantity, status: row.status, challanId: row.challanId })),
      };
    });
  }

  async issueSalesInvoice(input: InvoiceInput, actorUserId: string) {
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      if (input.idempotencyKey) {
        const existing = await tx.salesInvoice.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
        if (existing) return existing;
      }
      const order = await tx.salesOrder.findUnique({ where: { id: input.salesOrderId } });
      if (!order) throw new NotFoundException('Sales order not found.');
      const dispatchWhere: any = {
        salesOrderId: order.id,
        status: { in: ['dispatched', 'delivered'] },
        dispatchedQuantity: { gt: 0 },
      };
      if (input.dispatchLineIds?.length) dispatchWhere.id = { in: input.dispatchLineIds };
      const dispatchLines = await tx.dispatchLine.findMany({ where: dispatchWhere, include: { lot: { select: { unitCost: true, lotNumber: true } } } });
      if (!dispatchLines.length) throw new BadRequestException('There are no dispatched lines available to invoice. Dispatch goods first.');
      if (input.dispatchLineIds?.length && dispatchLines.length !== new Set(input.dispatchLineIds).size) {
        throw new BadRequestException('One or more selected lines are not dispatched for this sales order.');
      }
      const previous = await tx.salesInvoiceLine.findMany({ where: { dispatchLineId: { in: dispatchLines.map((row: any) => row.id) } }, select: { dispatchLineId: true } });
      if (previous.length) throw new BadRequestException('One or more selected dispatch lines are already invoiced. Refresh the invoiceable queue.');

      const orderLineIds = dispatchLines.map((row: any) => row.salesOrderLineId).filter(Boolean);
      const orderLines = orderLineIds.length ? await tx.salesOrderLine.findMany({ where: { id: { in: orderLineIds } } }) : [];
      const orderLineById = new Map((orderLines as any[]).map((row) => [row.id, row]));
      const orderJsonLines: any[] = Array.isArray(order.lines) ? (order.lines as any[]) : [];
      const computed = dispatchLines.map((dispatchLine: any) => {
        const orderLine = orderLineById.get(dispatchLine.salesOrderLineId);
        const fallback: any = orderJsonLines.find((row: any) => String(row.lineKey || row.sku || '') === String(dispatchLine.dispatchKey || dispatchLine.sku || ''))
          || orderJsonLines.find((row: any) => String(row.sku || '') === String(dispatchLine.sku || '')) || {};
        const orderedQuantity = Math.max(1, Number(orderLine?.orderedQuantity || fallback.qty || fallback.quantity || dispatchLine.orderedQuantity || 1));
        const quantity = Math.max(1, Number(dispatchLine.dispatchedQuantity || dispatchLine.packedQuantity || 0));
        const taxableValue = roundMoney(Number(orderLine?.taxableValue ?? fallback.taxableValue ?? 0) * quantity / orderedQuantity);
        const taxAmount = roundMoney(Number(orderLine?.taxAmount ?? fallback.taxAmount ?? 0) * quantity / orderedQuantity);
        const grossLineTotal = roundMoney(Number(orderLine?.grossLineTotal ?? fallback.grossLineTotal ?? fallback.lineTotal ?? 0) * quantity / orderedQuantity);
        const lotUnitCost = Number(dispatchLine.lot?.unitCost || 0);
        const costSnapshot = Number.isFinite(lotUnitCost) && lotUnitCost > 0
          ? lotUnitCost
          : Number(orderLine?.costSnapshot || 0) > 0 ? Number(orderLine.costSnapshot) : null;
        const costSnapshotSource = Number.isFinite(lotUnitCost) && lotUnitCost > 0
          ? 'InventoryLot.unitCost'
          : costSnapshot ? orderLine?.costSnapshotSource || 'Product.costPrice' : null;
        return {
          dispatchLineId: dispatchLine.id, salesOrderLineId: dispatchLine.salesOrderLineId || null, productId: dispatchLine.productId || orderLine?.productId || fallback.productId || null,
          sku: dispatchLine.sku, name: dispatchLine.name, brand: orderLine?.brand || fallback.brand || '', finish: orderLine?.finish || fallback.finish || null,
          unit: orderLine?.unit || fallback.unit || 'PC', quantity,
          unitPrice: roundMoney(grossLineTotal / quantity), taxRate: Number(orderLine?.taxRate ?? fallback.taxRate ?? 0), taxableValue, taxAmount, grossLineTotal,
          costSnapshot, costSnapshotSource, costSnapshotAt: costSnapshot ? now : null,
          metadata: { dispatchChallanId: dispatchLine.challanId || null, dispatchStatus: dispatchLine.status, lotId: dispatchLine.lotId || null, lotNumber: dispatchLine.lot?.lotNumber || null },
        };
      });
      const taxableValue = roundMoney(computed.reduce((sum: number, row: any) => sum + row.taxableValue, 0));
      const taxAmount = roundMoney(computed.reduce((sum: number, row: any) => sum + row.taxAmount, 0));
      const totalAmount = roundMoney(computed.reduce((sum: number, row: any) => sum + row.grossLineTotal, 0));
      if (totalAmount < 0) throw new BadRequestException('An invoice amount cannot be negative.');

      const profile = await tx.customerCreditProfile.findUnique({ where: { customerId: order.customerId } });
      const terms = String(order.paymentTerms || profile?.defaultPaymentTerms || '');
      const dueDate = asDate(input.dueDate) || new Date(now.getTime() + paymentDays(terms) * 86400000);
      const invoiceNumber = await this.nextNumber(tx, 'sales_invoice', 'INV', 'salesInvoice', 'invoiceNumber', now);
      const invoice = await tx.salesInvoice.create({
        data: {
          id: ulid(), invoiceNumber, idempotencyKey: input.idempotencyKey || null, salesOrderId: order.id, quoteId: order.quoteId,
          customerId: order.customerId, status: totalAmount <= 0 ? 'paid' : 'posted', issueDate: now, dueDate,
          taxableValue, taxAmount, totalAmount, openAmount: totalAmount, paymentTerms: terms, notes: String(input.notes || ''),
          createdBy: actorUserId, postedAt: now, updatedAt: now,
          metadata: { dispatchLineIds: computed.map((row: any) => row.dispatchLineId), challanIds: [...new Set(computed.map((row: any) => row.metadata.dispatchChallanId).filter(Boolean))] },
          lines: { create: computed.map((row: any) => ({ id: ulid(), ...row })) },
        },
      });
      await this.ledgerEntry(tx, {
        customerId: order.customerId, sourceType: 'SalesInvoice', sourceId: invoice.id, sourceKey: `invoice:${invoice.id}`,
        effectiveAt: now, debit: totalAmount, narration: `Invoice ${invoiceNumber}`, createdBy: actorUserId,
        metadata: { invoiceNumber, salesOrderId: order.id },
      });
      const advances = await tx.customerPayment.findMany({
        where: { customerId: order.customerId, status: 'posted', unappliedAmount: { gt: 0 } },
        orderBy: [{ receivedAt: 'asc' }, { createdAt: 'asc' }],
      });
      for (const payment of advances) {
        if (Number(invoice.openAmount || 0) <= 0) break;
        await this.allocateSourceTx(tx, { customerId: order.customerId, sourceType: 'CustomerPayment', sourceId: payment.id, amount: Number(payment.unappliedAmount || 0), createdBy: actorUserId, invoiceIds: [invoice.id] });
        await this.updatePaymentUnappliedTx(tx, payment.id);
        await this.syncInvoiceOpenAmountTx(tx, invoice.id);
      }
      await this.syncSalesOrderPaymentStatusTx(tx, order.id);
      return invoice;
    }, { isolationLevel: 'Serializable', timeout: 30000 });
    await this.audit.record({ actorUserId, action: 'invoice.post', entityType: 'SalesInvoice', entityId: result.id, summary: `Posted invoice ${result.invoiceNumber}`, metadata: { salesOrderId: result.salesOrderId, totalAmount: result.totalAmount } });
    return this.completeInvoiceView(result.id);
  }

  async recordCustomerPaymentTx(tx: any, input: PaymentInput, actorUserId: string) {
    const amount = roundMoney(Number(input.amount || 0));
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Payment amount must be greater than zero.');
    const customer = await tx.customer.findUnique({ where: { id: input.customerId } });
    if (!customer) throw new NotFoundException('Customer not found.');
    if (input.idempotencyKey) {
      const existing = await tx.customerPayment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) return existing;
    }
    let salesOrderId = input.salesOrderId || null;
    let selectedInvoice: any = null;
    if (input.salesInvoiceId) {
      selectedInvoice = await tx.salesInvoice.findUnique({ where: { id: input.salesInvoiceId } });
      if (!selectedInvoice || selectedInvoice.customerId !== input.customerId || !ACTIVE_INVOICE.includes(selectedInvoice.status)) {
        throw new BadRequestException('The selected invoice is not open for this customer.');
      }
      if (salesOrderId && salesOrderId !== selectedInvoice.salesOrderId) {
        throw new BadRequestException('The selected invoice does not belong to the selected sales order.');
      }
      salesOrderId = selectedInvoice.salesOrderId;
    }
    if (salesOrderId) {
      const order = await tx.salesOrder.findUnique({ where: { id: salesOrderId } });
      if (!order || order.customerId !== input.customerId) throw new BadRequestException('The selected sales order does not belong to this customer.');
    }
    const receivedAt = asDate(input.receivedAt) || new Date();
    const paymentMode = String(input.paymentMode || '').trim().toLowerCase();
    if (!['cash', 'upi', 'neft', 'rtgs', 'card', 'cheque', 'bank_transfer', 'other'].includes(paymentMode)) {
      throw new BadRequestException('Choose a valid payment mode.');
    }
    const receiptNumber = await this.nextNumber(tx, 'customer_receipt', 'RCPT', 'customerPayment', 'receiptNumber', receivedAt);
    const payment = await tx.customerPayment.create({
      data: {
        id: ulid(), receiptNumber, idempotencyKey: input.idempotencyKey || null, customerId: input.customerId,
        salesOrderId, paymentMode, moneyAccount: String(input.moneyAccount || (paymentMode === 'cash' ? 'cash_drawer' : 'bank')),
        amount, unappliedAmount: amount, status: 'posted', receivedAt, valueDate: asDate(input.valueDate), reference: String(input.reference || '').trim() || null,
        notes: String(input.notes || ''), attachmentUrls: Array.isArray(input.attachmentUrls) ? input.attachmentUrls : [],
        createdBy: actorUserId, postedAt: new Date(), updatedAt: new Date(),
        metadata: { source: 'customer_accounts' },
      },
    });
    await this.ledgerEntry(tx, {
      customerId: payment.customerId, sourceType: 'CustomerPayment', sourceId: payment.id, sourceKey: `payment:${payment.id}`,
      effectiveAt: receivedAt, credit: amount, narration: `Receipt ${receiptNumber}`, createdBy: actorUserId,
      metadata: { receiptNumber, paymentMode, salesOrderId: payment.salesOrderId || null },
    });
    let targets = input.salesInvoiceId ? [input.salesInvoiceId] : undefined;
    if (!targets && salesOrderId) {
      const orderInvoices = await tx.salesInvoice.findMany({
        where: { salesOrderId, customerId: payment.customerId, status: { in: ACTIVE_INVOICE }, openAmount: { gt: 0 } },
        select: { id: true },
      });
      targets = orderInvoices.map((invoice: any) => invoice.id);
    }
    let allocation: { invoiceIds: string[] } = { invoiceIds: [] };
    if (input.autoAllocate !== false) {
      allocation = await this.allocateSourceTx(tx, { customerId: payment.customerId, sourceType: 'CustomerPayment', sourceId: payment.id, amount, createdBy: actorUserId, invoiceIds: targets });
      await this.updatePaymentUnappliedTx(tx, payment.id);
    }
    const touchedInvoices = allocation.invoiceIds.length
      ? await tx.salesInvoice.findMany({ where: { id: { in: allocation.invoiceIds } }, select: { salesOrderId: true } })
      : [];
    const touchedOrderIds = [...new Set([salesOrderId, ...touchedInvoices.map((invoice: any) => invoice.salesOrderId)].filter(Boolean))];
    for (const orderId of touchedOrderIds) await this.syncSalesOrderPaymentStatusTx(tx, String(orderId));
    return tx.customerPayment.findUnique({ where: { id: payment.id } });
  }

  async recordCustomerPayment(input: PaymentInput, actorUserId: string) {
    const payment = await this.prisma.$transaction((tx) => this.recordCustomerPaymentTx(tx, input, actorUserId), { isolationLevel: 'Serializable', timeout: 30000 });
    await this.audit.record({ actorUserId, action: 'payment.post', entityType: 'CustomerPayment', entityId: payment.id, summary: `Posted receipt ${payment.receiptNumber}`, metadata: { customerId: payment.customerId, amount: payment.amount, paymentMode: payment.paymentMode } });
    return this.customerPayment(payment.id);
  }

  async allocateCustomerPayment(paymentId: string, salesInvoiceId: string, amount: number, actorUserId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const [payment, invoice] = await Promise.all([
        tx.customerPayment.findUnique({ where: { id: paymentId } }),
        tx.salesInvoice.findUnique({ where: { id: salesInvoiceId } }),
      ]);
      if (!payment || payment.status !== 'posted') throw new BadRequestException('Only a posted receipt can be allocated.');
      if (!invoice || !ACTIVE_INVOICE.includes(invoice.status) || payment.customerId !== invoice.customerId) throw new BadRequestException('Choose an open invoice for the same customer.');
      const available = Number(payment.unappliedAmount || 0);
      const requested = roundMoney(Number(amount || 0));
      if (requested <= 0 || requested > available + 0.001 || requested > Number(invoice.openAmount || 0) + 0.001) {
        throw new BadRequestException('Allocation exceeds the receipt balance or invoice balance.');
      }
      await this.allocateSourceTx(tx, { customerId: payment.customerId, sourceType: 'CustomerPayment', sourceId: payment.id, amount: requested, createdBy: actorUserId, invoiceIds: [invoice.id] });
      await this.updatePaymentUnappliedTx(tx, payment.id);
      await this.syncSalesOrderPaymentStatusTx(tx, invoice.salesOrderId);
      return payment;
    }, { isolationLevel: 'Serializable', timeout: 30000 });
    await this.audit.record({ actorUserId, action: 'payment.allocate', entityType: 'CustomerPayment', entityId: paymentId, summary: `Allocated receipt ${result.receiptNumber}`, metadata: { salesInvoiceId, amount } });
    return this.customerPayment(paymentId);
  }

  async voidCustomerPayment(id: string, actorUserId: string) {
    const payment = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.customerPayment.findUnique({ where: { id } });
      if (!payment) throw new NotFoundException('Receipt not found.');
      if (payment.status === 'void') return payment;
      const allocations = await tx.customerAllocation.findMany({ where: { sourceType: 'CustomerPayment', sourceId: id, status: ACTIVE_ALLOCATION } });
      await tx.customerAllocation.updateMany({ where: { id: { in: allocations.map((row: any) => row.id) } }, data: { status: 'void', updatedAt: new Date() } });
      for (const allocation of allocations) {
        const invoice = await this.syncInvoiceOpenAmountTx(tx, allocation.salesInvoiceId);
        if (invoice) await this.syncSalesOrderPaymentStatusTx(tx, invoice.salesOrderId);
      }
      if (payment.salesOrderId) await this.syncSalesOrderPaymentStatusTx(tx, payment.salesOrderId);
      await this.ledgerEntry(tx, {
        customerId: payment.customerId, sourceType: 'CustomerPaymentVoid', sourceId: payment.id, sourceKey: `payment-void:${payment.id}`,
        debit: Number(payment.amount || 0), narration: `Receipt reversal ${payment.receiptNumber}`, createdBy: actorUserId,
      });
      return tx.customerPayment.update({ where: { id }, data: { status: 'void', unappliedAmount: 0, voidedAt: new Date(), voidedBy: actorUserId, updatedAt: new Date() } });
    }, { isolationLevel: 'Serializable', timeout: 30000 });
    await this.audit.record({ actorUserId, action: 'payment.void', entityType: 'CustomerPayment', entityId: id, summary: `Voided receipt ${payment.receiptNumber}`, metadata: { amount: payment.amount } });
    return payment;
  }

  async issueCreditNoteForReturnTx(tx: any, creditNote: any, actorUserId: string) {
    if (!creditNote.customerId || Number(creditNote.amount || 0) <= 0) return null;
    const existing = await tx.customerLedgerEntry.findUnique({ where: { sourceKey: `credit-note:${creditNote.id}` } });
    if (existing) return existing;
    await this.ledgerEntry(tx, {
      customerId: creditNote.customerId, sourceType: 'CreditNote', sourceId: creditNote.id, sourceKey: `credit-note:${creditNote.id}`,
      effectiveAt: creditNote.issuedAt || new Date(), credit: Number(creditNote.amount || 0), narration: `Credit note ${creditNote.creditNoteNumber}`,
      createdBy: actorUserId, metadata: { salesOrderId: creditNote.salesOrderId || null },
    });
    const refundMode = String(creditNote.refundMode || '').toLowerCase();
    if (refundMode === 'refund') {
      await this.ledgerEntry(tx, {
        customerId: creditNote.customerId, sourceType: 'CreditNoteRefund', sourceId: creditNote.id, sourceKey: `credit-note-refund:${creditNote.id}`,
        effectiveAt: new Date(), debit: Number(creditNote.amount || 0), narration: `Refund against ${creditNote.creditNoteNumber}`,
        createdBy: actorUserId,
      });
      await tx.creditNote.update({ where: { id: creditNote.id }, data: { unappliedAmount: 0, updatedAt: new Date() } });
    } else if (refundMode === 'order_adjustment') {
      const allocation = await this.allocateSourceTx(tx, { customerId: creditNote.customerId, sourceType: 'CreditNote', sourceId: creditNote.id, amount: Number(creditNote.amount || 0), createdBy: actorUserId });
      await tx.creditNote.update({ where: { id: creditNote.id }, data: { unappliedAmount: allocation.remaining, updatedAt: new Date() } });
    }
    if (creditNote.salesOrderId) await this.syncSalesOrderPaymentStatusTx(tx, creditNote.salesOrderId);
    return tx.customerLedgerEntry.findUnique({ where: { sourceKey: `credit-note:${creditNote.id}` } });
  }

  async customerPayment(id: string) {
    const payment = await this.prisma.customerPayment.findUnique({ where: { id } });
    if (!payment) throw new NotFoundException('Receipt not found.');
    const [customer, allocations] = await Promise.all([
      this.prisma.customer.findUnique({ where: { id: payment.customerId } }),
      this.prisma.customerAllocation.findMany({ where: { sourceType: 'CustomerPayment', sourceId: id }, orderBy: { createdAt: 'asc' } }),
    ]);
    const invoiceIds = allocations.map((row: any) => row.salesInvoiceId);
    const invoices = invoiceIds.length ? await this.prisma.salesInvoice.findMany({ where: { id: { in: invoiceIds } } }) : [];
    const invoiceById = new Map((invoices as any[]).map((row) => [row.id, row]));
    return { ...payment, customer, allocations: allocations.map((row: any) => ({ ...row, invoice: invoiceById.get(row.salesInvoiceId) || null })) };
  }

  async salesInvoice(id: string) {
    return this.completeInvoiceView(id);
  }

  async customerAccount(customerId: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundException('Customer not found.');
    const [profile, invoices, payments, ledger, ledgerTotals, creditNotes, salesOrders, tasks] = await Promise.all([
      this.prisma.customerCreditProfile.findUnique({ where: { customerId } }),
      this.prisma.salesInvoice.findMany({ where: { customerId }, orderBy: [{ dueDate: 'asc' }, { issueDate: 'desc' }], take: 120 }),
      this.prisma.customerPayment.findMany({ where: { customerId }, orderBy: { receivedAt: 'desc' }, take: 120 }),
      this.prisma.customerLedgerEntry.findMany({ where: { customerId }, orderBy: [{ effectiveAt: 'desc' }, { createdAt: 'desc' }], take: 240 }),
      this.prisma.customerLedgerEntry.aggregate({ where: { customerId }, _sum: { debit: true, credit: true } }),
      this.prisma.creditNote.findMany({ where: { customerId, status: 'issued' }, orderBy: { issuedAt: 'desc' }, take: 120 }),
      this.prisma.salesOrder.findMany({ where: { customerId, status: { notIn: ['cancelled', 'closed'] } }, orderBy: { createdAt: 'desc' }, take: 120 }),
      this.prisma.collectionTask.findMany({ where: { customerId }, orderBy: [{ status: 'asc' }, { dueAt: 'asc' }], take: 80 }),
    ]);
    const debit = Number(ledgerTotals._sum.debit || 0);
    const credit = Number(ledgerTotals._sum.credit || 0);
    const now = new Date();
    const aging = { current: 0, d1to30: 0, d31to60: 0, d61plus: 0 };
    for (const invoice of invoices as any[]) {
      if (!ACTIVE_INVOICE.includes(invoice.status) || Number(invoice.openAmount || 0) <= 0) continue;
      const anchor = new Date(invoice.dueDate || invoice.issueDate);
      const days = Math.floor((now.getTime() - anchor.getTime()) / 86400000);
      const amount = Number(invoice.openAmount || 0);
      if (days <= 0) aging.current += amount;
      else if (days <= 30) aging.d1to30 += amount;
      else if (days <= 60) aging.d31to60 += amount;
      else aging.d61plus += amount;
    }
    return {
      customer, profile: profile || { creditLimit: 0, defaultPaymentTerms: '', creditHold: false, holdReason: '' },
      summary: { debit: roundMoney(debit), credit: roundMoney(credit), balance: roundMoney(debit - credit), openInvoices: roundMoney(invoices.filter((row: any) => ACTIVE_INVOICE.includes(row.status)).reduce((sum: number, row: any) => sum + Number(row.openAmount || 0), 0)), unallocatedCredit: roundMoney(payments.filter((row: any) => row.status === 'posted').reduce((sum: number, row: any) => sum + Number(row.unappliedAmount || 0), 0) + creditNotes.reduce((sum: number, row: any) => sum + Number(row.unappliedAmount || 0), 0)), aging: Object.fromEntries(Object.entries(aging).map(([key, value]) => [key, roundMoney(value)])) },
      invoices, payments, creditNotes, salesOrders, ledger: ledger.map((entry: any) => ({ ...entry, sourceLabel: sourceLabel(entry.sourceType) })), tasks,
    };
  }

  async dashboard(args?: { search?: string; take?: number }) {
    const take = Math.min(Math.max(Number(args?.take || 120), 1), 300);
    const [balances, invoices, payments, creditNotes, tasks] = await Promise.all([
      (this.prisma as any).customerLedgerEntry.groupBy({ by: ['customerId'], _sum: { debit: true, credit: true } }),
      this.prisma.salesInvoice.findMany({ where: { status: { in: ACTIVE_INVOICE } }, orderBy: { dueDate: 'asc' }, take: 2500 }),
      this.prisma.customerPayment.findMany({ where: { status: 'posted' }, orderBy: { receivedAt: 'desc' }, take: 2500 }),
      this.prisma.creditNote.findMany({ where: { status: 'issued', unappliedAmount: { gt: 0 } }, orderBy: { issuedAt: 'desc' }, take: 2500 }),
      this.prisma.collectionTask.findMany({ where: { status: 'open' }, orderBy: { dueAt: 'asc' }, take: 500 }),
    ]);
    const balanceRows = (balances as any[]).map((row) => ({ customerId: row.customerId, debit: Number(row._sum?.debit || 0), credit: Number(row._sum?.credit || 0) }));
    const customerIds = [...new Set([...balanceRows.map((row) => row.customerId), ...(invoices as any[]).map((row) => row.customerId), ...(creditNotes as any[]).map((row) => row.customerId), ...(tasks as any[]).map((row) => row.customerId)])];
    const customers = customerIds.length ? await this.prisma.customer.findMany({ where: { id: { in: customerIds } } }) : [];
    const profiles = customerIds.length ? await this.prisma.customerCreditProfile.findMany({ where: { customerId: { in: customerIds } } }) : [];
    const customerById = new Map((customers as any[]).map((row) => [row.id, row]));
    const profileByCustomer = new Map((profiles as any[]).map((row) => [row.customerId, row]));
    const invoiceByCustomer = new Map<string, any[]>();
    for (const invoice of invoices as any[]) invoiceByCustomer.set(invoice.customerId, [...(invoiceByCustomer.get(invoice.customerId) || []), invoice]);
    const tasksByCustomer = new Map<string, any[]>();
    for (const task of tasks as any[]) tasksByCustomer.set(task.customerId, [...(tasksByCustomer.get(task.customerId) || []), task]);
    const now = new Date();
    const accounts = balanceRows.map((balance) => {
      const customer = customerById.get(balance.customerId);
      const profile = profileByCustomer.get(balance.customerId);
      const customerInvoices = invoiceByCustomer.get(balance.customerId) || [];
      const openInvoices = customerInvoices.reduce((sum, row) => sum + Number(row.openAmount || 0), 0);
      const overdue = customerInvoices.filter((row) => row.dueDate && new Date(row.dueDate) < now).reduce((sum, row) => sum + Number(row.openAmount || 0), 0);
      return {
        customerId: balance.customerId, customer, profile: profile || null,
        balance: roundMoney(balance.debit - balance.credit), openInvoices: roundMoney(openInvoices), overdue: roundMoney(overdue),
        unallocatedCredit: roundMoney(
          (payments as any[]).filter((row) => row.customerId === balance.customerId).reduce((sum, row) => sum + Number(row.unappliedAmount || 0), 0)
          + (creditNotes as any[]).filter((row) => row.customerId === balance.customerId).reduce((sum, row) => sum + Number(row.unappliedAmount || 0), 0),
        ),
        openTaskCount: (tasksByCustomer.get(balance.customerId) || []).length,
        nextDueDate: customerInvoices.find((row) => Number(row.openAmount || 0) > 0)?.dueDate || null,
      };
    }).filter((row) => row.customer && (!args?.search || [row.customer.name, row.customer.mobile, row.customer.city].join(' ').toLowerCase().includes(args.search.toLowerCase()))).sort((a, b) => b.balance - a.balance).slice(0, take);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const currentMonthCollections = (payments as any[]).filter((row) => new Date(row.receivedAt) >= monthStart).reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const currentMonthBilling = (invoices as any[]).filter((row) => new Date(row.issueDate) >= monthStart).reduce((sum, row) => sum + Number(row.totalAmount || 0), 0);
    const totalReceivable = accounts.reduce((sum, row) => sum + Math.max(0, row.balance), 0);
    const overdue = accounts.reduce((sum, row) => sum + row.overdue, 0);
    return {
      kpis: {
        receivable: roundMoney(totalReceivable), overdue: roundMoney(overdue), currentMonthCollections: roundMoney(currentMonthCollections), currentMonthBilling: roundMoney(currentMonthBilling),
        unappliedCredit: roundMoney(
          (payments as any[]).reduce((sum, row) => sum + Number(row.unappliedAmount || 0), 0)
          + (creditNotes as any[]).reduce((sum, row) => sum + Number(row.unappliedAmount || 0), 0),
        ), openTasks: tasks.length,
      },
      accounts,
      collectionQueue: (invoices as any[]).filter((invoice) => Number(invoice.openAmount || 0) > 0).map((invoice) => ({ ...invoice, customer: customerById.get(invoice.customerId) || null, overdueDays: invoice.dueDate ? Math.max(0, Math.floor((now.getTime() - new Date(invoice.dueDate).getTime()) / 86400000)) : 0 })).sort((a, b) => b.overdueDays - a.overdueDays || Number(b.openAmount) - Number(a.openAmount)).slice(0, take),
      tasks: tasks.map((task: any) => ({ ...task, customer: customerById.get(task.customerId) || null })),
    };
  }

  async upsertCreditProfile(customerId: string, input: any, actorUserId: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundException('Customer not found.');
    const profile = await this.prisma.customerCreditProfile.upsert({
      where: { customerId },
      update: { creditLimit: Math.max(0, Number(input.creditLimit || 0)), defaultPaymentTerms: String(input.defaultPaymentTerms || ''), creditHold: !!input.creditHold, holdReason: String(input.holdReason || ''), collectionOwnerId: input.collectionOwnerId || null, updatedAt: new Date() },
      create: { id: ulid(), customerId, creditLimit: Math.max(0, Number(input.creditLimit || 0)), defaultPaymentTerms: String(input.defaultPaymentTerms || ''), creditHold: !!input.creditHold, holdReason: String(input.holdReason || ''), collectionOwnerId: input.collectionOwnerId || null, updatedAt: new Date() },
    });
    await this.audit.record({ actorUserId, action: 'customer.credit_profile.update', entityType: 'Customer', entityId: customerId, summary: `Updated credit profile for ${customer.name}`, metadata: { creditLimit: profile.creditLimit, creditHold: profile.creditHold } });
    return profile;
  }

  async createCollectionTask(input: CollectionTaskInput, actorUserId: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id: input.customerId } });
    if (!customer) throw new NotFoundException('Customer not found.');
    if (input.salesInvoiceId) {
      const invoice = await this.prisma.salesInvoice.findUnique({ where: { id: input.salesInvoiceId } });
      if (!invoice || invoice.customerId !== input.customerId) throw new BadRequestException('The selected invoice does not belong to this customer.');
    }
    const task = await this.prisma.collectionTask.create({ data: { id: ulid(), customerId: input.customerId, salesInvoiceId: input.salesInvoiceId || null, ownerId: input.ownerId || null, priority: ['low', 'normal', 'high'].includes(String(input.priority)) ? String(input.priority) : 'normal', dueAt: asDate(input.dueAt), note: String(input.note || ''), createdBy: actorUserId, updatedAt: new Date() } });
    await this.audit.record({ actorUserId, action: 'collection_task.create', entityType: 'CollectionTask', entityId: task.id, summary: `Created collection task for ${customer.name}`, metadata: { customerId: task.customerId, salesInvoiceId: task.salesInvoiceId } });
    return task;
  }

  async completeCollectionTask(id: string, outcome: string, actorUserId: string) {
    const task = await this.prisma.collectionTask.findUnique({ where: { id } });
    if (!task) throw new NotFoundException('Collection task not found.');
    const updated = await this.prisma.collectionTask.update({ where: { id }, data: { status: 'completed', outcome: String(outcome || ''), completedAt: new Date(), updatedAt: new Date() } });
    await this.audit.record({ actorUserId, action: 'collection_task.complete', entityType: 'CollectionTask', entityId: id, summary: 'Completed collection task', metadata: { customerId: task.customerId } });
    return updated;
  }
}
