import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ulid } from 'ulid';
import { AuditService } from '../audit/audit.service';
import { nextDocumentNumber } from '../common/sequence';
import { PrismaService } from '../prisma/prisma.service';
import { stockFactor, tileBoxReading } from '../common/stock-units';
import { invoiceGstSplit } from './gst-split';
import { receivablePosition } from './receivable-position';
import { withSerializableRetry } from '../common/serializable-retry';

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

/** Dispatched quantity still to bill: what went out, less what came back before the invoice. */
function billableQuantity(line: { dispatchedQuantity?: unknown; packedQuantity?: unknown; returnedQuantity?: unknown }) {
  const sent = Number(line.dispatchedQuantity || line.packedQuantity || 0);
  return Math.max(0, sent - Math.max(0, Number(line.returnedQuantity || 0)));
}

/** First day of the current month in India time. */
function indiaMonthStart(now = new Date()) {
  const india = new Date(now.getTime() + 330 * 60000);
  return new Date(Date.UTC(india.getUTCFullYear(), india.getUTCMonth(), 1) - 330 * 60000);
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
  if (type === 'AdvanceRefund') return 'Advance refund';
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
    if (invoice.status === 'void') return invoice; // a voided invoice stays void with nothing open
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
      tx.salesInvoice.findMany({ where: { salesOrderId, status: { not: 'void' } }, select: { id: true, openAmount: true, totalAmount: true } }),
      tx.customerPayment.findMany({ where: { salesOrderId, status: 'posted' }, select: { amount: true, unappliedAmount: true } }),
    ]);
    if (!order) return;
    // What this order has really received: receipt money applied to its own invoices,
    // plus its own receipts still waiting unapplied. An advance that was applied to
    // another order's invoice no longer counts here.
    const appliedToOrder = invoices.length ? await tx.customerAllocation.findMany({
      where: { salesInvoiceId: { in: invoices.map((row: any) => row.id) }, sourceType: 'CustomerPayment', status: ACTIVE_ALLOCATION },
      select: { amount: true },
    }) : [];
    const received = roundMoney(
      appliedToOrder.reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0)
      + payments.reduce((sum: number, row: any) => sum + Number(row.unappliedAmount || 0), 0),
    );
    const orderTotal = roundMoney(Number(order.totalAmount || 0));
    const advanceAmount = Math.max(0, Math.min(received, orderTotal));
    if (!invoices.length) {
      const paymentStatus = order.paymentMode === 'credit'
        ? 'credit'
        : received >= orderTotal && orderTotal > 0 ? 'paid' : received > 0 ? 'advance' : 'pending_cash';
      await tx.salesOrder.update({ where: { id: salesOrderId }, data: { paymentStatus, advanceAmount, updatedAt: new Date() } });
      return;
    }
    const total = invoices.reduce((sum: number, row: any) => sum + Number(row.totalAmount || 0), 0);
    const open = invoices.reduce((sum: number, row: any) => sum + Number(row.openAmount || 0), 0);
    const paymentStatus = open <= 0 ? 'paid' : open < total ? 'partial' : 'awaiting_payment';
    await tx.salesOrder.update({ where: { id: salesOrderId }, data: { paymentStatus, advanceAmount, updatedAt: new Date() } });
  }

  private async allocateSourceTx(tx: any, args: {
    customerId: string;
    sourceType: string;
    sourceId: string;
    amount: number;
    createdBy: string;
    invoiceIds?: string[];
    /** Apply in the order of invoiceIds instead of oldest due first. */
    keepOrder?: boolean;
  }) {
    let remaining = roundMoney(args.amount);
    if (remaining <= 0) return { allocated: 0, remaining: 0, invoiceIds: [] as string[] };
    const where: any = {
      customerId: args.customerId,
      status: { in: ACTIVE_INVOICE },
      openAmount: { gt: 0 },
    };
    // An explicit list limits the target; an empty list means "nothing to apply to"
    // (an order with no invoice yet keeps its advance), never "any invoice of the customer".
    if (args.invoiceIds) {
      if (!args.invoiceIds.length) return { allocated: 0, remaining, invoiceIds: [] as string[] };
      where.id = { in: args.invoiceIds };
    }
    const invoices = await tx.salesInvoice.findMany({ where, orderBy: [{ dueDate: 'asc' }, { issueDate: 'asc' }] });
    if (args.keepOrder && args.invoiceIds && args.invoiceIds.length > 1) {
      const rank = new Map(args.invoiceIds.map((id, index) => [id, index]));
      invoices.sort((a: any, b: any) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
    }
    const touched: string[] = [];
    for (const invoice of invoices) {
      if (remaining <= 0) break;
      const existing = await tx.customerAllocation.findUnique({
        where: { sourceType_sourceId_salesInvoiceId: { sourceType: args.sourceType, sourceId: args.sourceId, salesInvoiceId: invoice.id } },
      });
      const existingAmount = existing?.status === ACTIVE_ALLOCATION ? Number(existing.amount || 0) : 0;
      const amount = roundMoney(Math.min(remaining, Math.max(0, Number(invoice.openAmount || 0))));
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
    const productIds = Array.from(new Set((invoice.lines || []).map((line: any) => line.productId).filter(Boolean))) as string[];
    const [customer, order, products, settings] = await Promise.all([
      this.prisma.customer.findUnique({ where: { id: invoice.customerId } }),
      this.prisma.salesOrder.findUnique({ where: { id: invoice.salesOrderId } }),
      productIds.length ? this.prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, hsnCode: true, category: true, unit: true, baseUom: true, salesUom: true, purchaseUom: true, piecesPerPack: true } }) : [],
      this.prisma.appSetting.findFirst({ orderBy: { updatedAt: 'desc' } }),
    ]);
    const hsnByProduct = new Map((products as any[]).map((row) => [row.id, row.hsnCode || null]));
    const factorByProduct = new Map((products as any[]).map((row) => [row.id, stockFactor(row)]));
    const invoiceProductById = new Map((products as any[]).map((row) => [row.id, row]));
    // piecesPerUnit / piecesPerBox / soldBy: a tile's line is billed in pieces; the invoice reads it in boxes like the order. Older lines billed in boxes stay as stored.
    const lines = (invoice.lines || []).map((line: any) => {
      const inPieces = Boolean(line.productId) && String(line.unit || '').toUpperCase() === 'PC';
      return {
        ...line,
        hsnCode: line.productId ? hsnByProduct.get(line.productId) || null : null,
        piecesPerUnit: inPieces ? factorByProduct.get(line.productId) || 1 : 1,
        ...(inPieces ? tileBoxReading(invoiceProductById.get(line.productId)) : { piecesPerBox: 1, soldBy: null }),
      };
    });
    const quote = invoice.quoteId ? await this.prisma.quote.findUnique({ where: { id: invoice.quoteId }, select: { quoteMeta: true } }).catch(() => null) : null;
    const withoutGst = (order as any)?.documents?.taxMode === 'non_gst' || (quote as any)?.quoteMeta?.taxMode === 'non_gst'
      || (lines.length > 0 && lines.every((line: any) => Number(line.taxRate || 0) === 0 && Number(line.taxAmount || 0) === 0));
    const gstSplit = invoiceGstSplit({ enabled: Boolean((settings as any)?.invoiceGstSplitEnabled), companyGstin: settings?.gstNumber, customer, withoutGst, lines });
    return { ...invoice, lines, customer, salesOrder: order, gstSplit };
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
    // Goods returned before invoicing are not billed: a fully returned line has nothing left to invoice.
    const candidates = dispatchLines.filter((row: any) => !used.has(row.id) && billableQuantity(row) > 0);
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
        lines: rows.map((row) => ({ id: row.id, sku: row.sku, name: row.name, quantity: billableQuantity(row), dispatchedQuantity: row.dispatchedQuantity, returnedQuantity: Number(row.returnedQuantity || 0), status: row.status, challanId: row.challanId })),
      };
    });
  }

  async issueSalesInvoice(input: InvoiceInput, actorUserId: string) {
    const now = new Date();
    const result = await withSerializableRetry(() => this.prisma.$transaction(async (tx) => {
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
      const fetchedDispatchLines = await tx.dispatchLine.findMany({ where: dispatchWhere, include: { lot: { select: { unitCost: true, lotNumber: true } } } });
      if (!fetchedDispatchLines.length) throw new BadRequestException('There are no dispatched lines available to invoice. Dispatch goods first.');
      if (input.dispatchLineIds?.length && fetchedDispatchLines.length !== new Set(input.dispatchLineIds).size) {
        throw new BadRequestException('One or more selected lines are not dispatched for this sales order.');
      }
      // Goods returned before invoicing are not billed.
      const fullyReturned = fetchedDispatchLines.filter((row: any) => billableQuantity(row) <= 0);
      if (input.dispatchLineIds?.length && fullyReturned.length) {
        throw new BadRequestException(`${fullyReturned.map((row: any) => row.sku).join(', ')} came back in full before invoicing, so there is nothing to bill. Refresh the list.`);
      }
      const dispatchLines = fetchedDispatchLines.filter((row: any) => billableQuantity(row) > 0);
      if (!dispatchLines.length) throw new BadRequestException('Everything dispatched on this order was returned, so there is nothing to invoice.');
      const previous = await tx.salesInvoiceLine.findMany({ where: { dispatchLineId: { in: dispatchLines.map((row: any) => row.id) } }, select: { dispatchLineId: true } });
      if (previous.length) throw new BadRequestException('One or more selected dispatch lines are already invoiced. Refresh the invoiceable queue.');

      const orderLineIds = dispatchLines.map((row: any) => row.salesOrderLineId).filter(Boolean);
      const orderLines = orderLineIds.length ? await tx.salesOrderLine.findMany({ where: { id: { in: orderLineIds } } }) : [];
      const orderLineById = new Map((orderLines as any[]).map((row) => [row.id, row]));
      const orderJsonLines: any[] = Array.isArray(order.lines) ? (order.lines as any[]) : [];
      // Dispatch lines count base units (pieces for a boxed tile); order lines count selling units (boxes).
      const invoiceProductIds = Array.from(new Set(dispatchLines.map((row: any) => row.productId).filter(Boolean))) as string[];
      const invoiceProducts = invoiceProductIds.length ? await tx.product.findMany({ where: { id: { in: invoiceProductIds } } }) : [];
      const factorByProduct = new Map((invoiceProducts as any[]).map((product) => [product.id, stockFactor(product)]));
      const productById = new Map((invoiceProducts as any[]).map((product) => [product.id, product]));
      const computed = dispatchLines.map((dispatchLine: any) => {
        const orderLine = orderLineById.get(dispatchLine.salesOrderLineId);
        const fallback: any = orderJsonLines.find((row: any) => String(row.lineKey || row.sku || '') === String(dispatchLine.dispatchKey || dispatchLine.sku || ''))
          || orderJsonLines.find((row: any) => String(row.sku || '') === String(dispatchLine.sku || '')) || {};
        const factor = factorByProduct.get(dispatchLine.productId) || 1;
        const orderedSelling = Number(orderLine?.orderedQuantity || fallback.qty || fallback.quantity || 0);
        const orderedQuantity = Math.max(1, orderedSelling > 0 ? orderedSelling * factor : Number(dispatchLine.orderedQuantity || 1));
        const quantity = Math.max(1, billableQuantity(dispatchLine));
        const taxableValue = roundMoney(Number(orderLine?.taxableValue ?? fallback.taxableValue ?? 0) * quantity / orderedQuantity);
        const taxAmount = roundMoney(Number(orderLine?.taxAmount ?? fallback.taxAmount ?? 0) * quantity / orderedQuantity);
        const grossLineTotal = roundMoney(Number(orderLine?.grossLineTotal ?? fallback.grossLineTotal ?? fallback.lineTotal ?? 0) * quantity / orderedQuantity);
        const lotUnitCost = Number(dispatchLine.lot?.unitCost || 0);
        const costSnapshot = Number.isFinite(lotUnitCost) && lotUnitCost > 0 ? lotUnitCost : null;
        const costSnapshotSource = costSnapshot ? 'InventoryLot.unitCost' : null;
        return {
          dispatchLineId: dispatchLine.id, salesOrderLineId: dispatchLine.salesOrderLineId || null, productId: dispatchLine.productId || orderLine?.productId || fallback.productId || null,
          sku: dispatchLine.sku, name: dispatchLine.name, brand: orderLine?.brand || fallback.brand || '', finish: orderLine?.finish || fallback.finish || null,
          unit: factor > 1 ? String(productById.get(dispatchLine.productId)?.baseUom || 'PC').toUpperCase() : (orderLine?.unit || fallback.unit || 'PC'), quantity,
          unitPrice: roundMoney(grossLineTotal / quantity), taxRate: Number(orderLine?.taxRate ?? fallback.taxRate ?? 0), taxableValue, taxAmount, grossLineTotal,
          pricingVersion: orderLine?.pricingVersion || 'unified_retail_v1',
          priceRateBasis: orderLine?.priceRateBasis || orderLine?.mrpRateBasis || fallback.priceRateBasis || fallback.rateBasis || null,
          mrpInclusive: orderLine?.mrpInclusive ?? orderLine?.mrp ?? fallback.mrpInclusive ?? null,
          nrpMode: orderLine?.nrpMode || fallback.nrpMode || null,
          nrpInput: orderLine?.nrpInput ?? fallback.nrpInput ?? null,
          nrpInclusive: orderLine?.nrpInclusive ?? fallback.nrpInclusive ?? null,
          specialMode: orderLine?.specialMode || fallback.specialMode || 'NONE',
          specialInput: orderLine?.specialInput ?? fallback.specialInput ?? null,
          specialRateInclusive: orderLine?.specialRateInclusive ?? fallback.specialRateInclusive ?? null,
          quoteDiscountAllocatedInclusive: roundMoney(Number(orderLine?.quoteDiscountAllocatedInclusive ?? fallback.quoteDiscountAllocatedInclusive ?? 0) * quantity / orderedQuantity),
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
      // Money waiting for this invoice: first this order's own advances, then receipts
      // taken on account (no order), oldest first. Another order's advance stays with that order.
      const waiting = await tx.customerPayment.findMany({
        where: { customerId: order.customerId, status: 'posted', unappliedAmount: { gt: 0 }, OR: [{ salesOrderId: order.id }, { salesOrderId: null }] },
        orderBy: [{ receivedAt: 'asc' }, { createdAt: 'asc' }],
      });
      const advances = [...waiting.filter((row: any) => row.salesOrderId === order.id), ...waiting.filter((row: any) => !row.salesOrderId)];
      let openNow = Number(invoice.openAmount || 0);
      for (const payment of advances) {
        if (openNow <= 0) break;
        await this.allocateSourceTx(tx, { customerId: order.customerId, sourceType: 'CustomerPayment', sourceId: payment.id, amount: Number(payment.unappliedAmount || 0), createdBy: actorUserId, invoiceIds: [invoice.id] });
        await this.updatePaymentUnappliedTx(tx, payment.id);
        const refreshed = await this.syncInvoiceOpenAmountTx(tx, invoice.id);
        openNow = Number(refreshed?.openAmount || 0);
      }
      // Customer credit from an earlier return on this same order (store credit / adjust balance) is used next.
      if (openNow > 0) {
        const credits = await tx.creditNote.findMany({
          where: { customerId: order.customerId, salesOrderId: order.id, status: 'issued', unappliedAmount: { gt: 0 }, refundMode: { not: 'refund' } },
          orderBy: { issuedAt: 'asc' },
        });
        // Only credit for goods that were billed (return lines carry the invoice line they
        // came from). Older credit notes for goods returned before billing are already left
        // out of this invoice's quantity, so applying them too would credit the customer twice;
        // they stay as customer credit.
        const creditReturnIds = credits.map((row: any) => row.returnOrderId).filter(Boolean);
        const billedReturnLines = creditReturnIds.length ? await tx.returnLine.findMany({ where: { returnOrderId: { in: creditReturnIds } }, select: { returnOrderId: true, metadata: true } }) : [];
        const billedReturnIds = new Set(billedReturnLines.filter((row: any) => String(row.metadata?.sourceInvoiceLineId || '')).map((row: any) => row.returnOrderId));
        for (const credit of credits) {
          if (openNow <= 0) break;
          if (!credit.returnOrderId || !billedReturnIds.has(credit.returnOrderId)) continue;
          const applied = await this.allocateSourceTx(tx, { customerId: order.customerId, sourceType: 'CreditNote', sourceId: credit.id, amount: Number(credit.unappliedAmount || 0), createdBy: actorUserId, invoiceIds: [invoice.id] });
          await tx.creditNote.update({ where: { id: credit.id }, data: { unappliedAmount: roundMoney(Number(credit.unappliedAmount || 0) - applied.allocated), updatedAt: new Date() } });
          const refreshed = await tx.salesInvoice.findUnique({ where: { id: invoice.id }, select: { openAmount: true } });
          openNow = Number(refreshed?.openAmount || 0);
        }
      }
      await this.syncSalesOrderPaymentStatusTx(tx, order.id);
      return invoice;
    }, { isolationLevel: 'Serializable', timeout: 30000 }));
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
    const payment = await withSerializableRetry(() => this.prisma.$transaction((tx) => this.recordCustomerPaymentTx(tx, input, actorUserId), { isolationLevel: 'Serializable', timeout: 30000 }));
    await this.audit.record({ actorUserId, action: 'payment.post', entityType: 'CustomerPayment', entityId: payment.id, summary: `Posted receipt ${payment.receiptNumber}`, metadata: { customerId: payment.customerId, amount: payment.amount, paymentMode: payment.paymentMode } });
    return this.customerPayment(payment.id);
  }

  async allocateCustomerPayment(paymentId: string, salesInvoiceId: string, amount: number, actorUserId: string) {
    const result = await withSerializableRetry(() => this.prisma.$transaction(async (tx) => {
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
      if (payment.salesOrderId && payment.salesOrderId !== invoice.salesOrderId) await this.syncSalesOrderPaymentStatusTx(tx, payment.salesOrderId);
      return payment;
    }, { isolationLevel: 'Serializable', timeout: 30000 }));
    await this.audit.record({ actorUserId, action: 'payment.allocate', entityType: 'CustomerPayment', entityId: paymentId, summary: `Allocated receipt ${result.receiptNumber}`, metadata: { salesInvoiceId, amount } });
    return this.customerPayment(paymentId);
  }

  async voidCustomerPayment(id: string, actorUserId: string, reason?: string) {
    const note = String(reason || '').trim().slice(0, 500);
    let changed = false;
    const payment = await withSerializableRetry(() => this.prisma.$transaction(async (tx) => {
      const payment = await tx.customerPayment.findUnique({ where: { id } });
      if (!payment) throw new NotFoundException('Receipt not found.');
      if (payment.status === 'void') return payment;
      // A refunded advance already has its money-out debit on the ledger; a void would charge the customer twice.
      if ((payment.metadata as any)?.advanceRefund) throw new BadRequestException('This advance was already refunded. It cannot be voided.');
      changed = true;
      const allocations = await tx.customerAllocation.findMany({ where: { sourceType: 'CustomerPayment', sourceId: id, status: ACTIVE_ALLOCATION } });
      await tx.customerAllocation.updateMany({ where: { id: { in: allocations.map((row: any) => row.id) } }, data: { status: 'void', updatedAt: new Date() } });
      // Mark the receipt void first so the order figures below no longer count it.
      const voided = await tx.customerPayment.update({ where: { id }, data: { status: 'void', unappliedAmount: 0, voidedAt: new Date(), voidedBy: actorUserId, updatedAt: new Date(), metadata: { ...((payment.metadata as any) || {}), ...(note ? { voidReason: note } : {}) } } });
      const orderIds = new Set<string>();
      for (const allocation of allocations) {
        const invoice = await this.syncInvoiceOpenAmountTx(tx, allocation.salesInvoiceId);
        if (invoice?.salesOrderId) orderIds.add(invoice.salesOrderId);
      }
      if (payment.salesOrderId) orderIds.add(payment.salesOrderId);
      for (const orderId of orderIds) await this.syncSalesOrderPaymentStatusTx(tx, orderId);
      await this.ledgerEntry(tx, {
        customerId: payment.customerId, sourceType: 'CustomerPaymentVoid', sourceId: payment.id, sourceKey: `payment-void:${payment.id}`,
        debit: Number(payment.amount || 0), narration: `Receipt reversal ${payment.receiptNumber}${note ? ` (${note})` : ''}`, createdBy: actorUserId,
      });
      return voided;
    }, { isolationLevel: 'Serializable', timeout: 30000 }));
    if (changed) await this.audit.record({ actorUserId, action: 'payment.void', entityType: 'CustomerPayment', entityId: id, summary: `Voided receipt ${payment.receiptNumber}`, metadata: { amount: payment.amount, reason: note || null } });
    return payment;
  }

  /** A posted receipt still linked to a cancelled order with money not yet used (gaps lane). */
  private async cancelledOrderAdvanceTx(tx: any, paymentId: string) {
    const payment = await tx.customerPayment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException('Receipt not found.');
    if (payment.status !== 'posted') throw new BadRequestException(`Receipt ${payment.receiptNumber} is void, so there is nothing to refund or move.`);
    if (!payment.salesOrderId) return { payment, order: null };
    const order = await tx.salesOrder.findUnique({ where: { id: payment.salesOrderId }, select: { id: true, orderNumber: true, status: true } });
    if (!order || order.status !== 'cancelled') throw new BadRequestException(`Receipt ${payment.receiptNumber} belongs to a live order. Only an advance on a cancelled order can be refunded or moved here.`);
    return { payment, order };
  }

  /**
   * Pay back the unused advance of a receipt on a cancelled order. Recorded as money
   * going out, the same way a cash refund on a return is: a debit on the customer
   * ledger (marked moneyOut) that cancels the receipt's credit. The receipt keeps
   * its history; its free amount becomes 0.
   */
  async refundOrderAdvance(paymentId: string, reason: string, actorUserId: string, refundMode?: string | null) {
    const note = String(reason || '').replace(/\s+/g, ' ').trim().slice(0, 500);
    if (note.length < 3) throw new BadRequestException('Give a short reason for the refund.');
    const mode = String(refundMode || 'cash').trim().toLowerCase();
    if (!['cash', 'upi', 'neft', 'rtgs', 'card', 'cheque', 'bank_transfer', 'other'].includes(mode)) throw new BadRequestException('Choose how the refund was paid.');
    let changed = false;
    let refunded = 0;
    const result = await withSerializableRetry(() => this.prisma.$transaction(async (tx) => {
      changed = false;
      const { payment, order } = await this.cancelledOrderAdvanceTx(tx, paymentId);
      if ((payment.metadata as any)?.advanceRefund) return payment; // already refunded: a double click does nothing
      if (!order) throw new BadRequestException(`Receipt ${payment.receiptNumber} is not on a cancelled order. It is already on the customer's account.`);
      const amount = roundMoney(Number(payment.unappliedAmount || 0));
      if (amount <= 0) throw new BadRequestException(`Receipt ${payment.receiptNumber} has no unused money left to refund.`);
      const paidAt = new Date();
      const moneyAccount = mode === 'cash' ? 'cash_drawer' : 'bank';
      await this.ledgerEntry(tx, {
        customerId: payment.customerId, sourceType: 'AdvanceRefund', sourceId: payment.id, sourceKey: `advance-refund:${payment.id}`,
        effectiveAt: paidAt, debit: amount, narration: `Advance refunded from ${payment.receiptNumber} (order ${order.orderNumber} cancelled): ${note}`,
        createdBy: actorUserId, metadata: { moneyOut: true, moneyAccount, paymentMode: mode, salesOrderId: order.id, receiptNumber: payment.receiptNumber },
      });
      const updated = await tx.customerPayment.update({
        where: { id: payment.id },
        data: { unappliedAmount: 0, updatedAt: paidAt, metadata: { ...((payment.metadata as any) || {}), advanceRefund: { amount, paidAt: paidAt.toISOString(), paidBy: actorUserId, reason: note, paymentMode: mode, moneyAccount, salesOrderId: order.id } } },
      });
      await this.syncSalesOrderPaymentStatusTx(tx, order.id);
      changed = true;
      refunded = amount;
      return updated;
    }, { isolationLevel: 'Serializable', timeout: 30000 }));
    if (changed) await this.audit.record({ actorUserId, action: 'payment.advance_refund', entityType: 'CustomerPayment', entityId: paymentId, summary: `Refunded advance ${refunded.toFixed(2)} from ${result.receiptNumber}`, metadata: { amount: refunded, reason: note, paymentMode: mode, salesOrderId: result.salesOrderId } });
    return this.customerPayment(paymentId);
  }

  /**
   * Move the unused advance of a receipt on a cancelled order onto the customer's
   * account: the order link is removed, so it is treated like a receipt taken on
   * account and goes to the oldest open invoice now (and to the next invoice later).
   */
  async moveAdvanceToAccount(paymentId: string, reason: string, actorUserId: string) {
    const note = String(reason || '').replace(/\s+/g, ' ').trim().slice(0, 500);
    if (note.length < 3) throw new BadRequestException('Give a short reason for moving this advance.');
    let changed = false;
    let fromOrder: { id: string; orderNumber: string } | null = null;
    let applied = 0;
    const result = await withSerializableRetry(() => this.prisma.$transaction(async (tx) => {
      changed = false;
      const { payment, order } = await this.cancelledOrderAdvanceTx(tx, paymentId);
      if (!order) return payment; // already on account: a double click does nothing
      if ((payment.metadata as any)?.advanceRefund) throw new BadRequestException(`The advance on ${payment.receiptNumber} was already refunded.`);
      const now = new Date();
      await tx.customerPayment.update({
        where: { id: payment.id },
        data: { salesOrderId: null, updatedAt: now, metadata: { ...((payment.metadata as any) || {}), movedToAccount: { fromSalesOrderId: order.id, fromOrderNumber: order.orderNumber, at: now.toISOString(), by: actorUserId, reason: note } } },
      });
      const allocation = await this.allocateSourceTx(tx, { customerId: payment.customerId, sourceType: 'CustomerPayment', sourceId: payment.id, amount: Number(payment.unappliedAmount || 0), createdBy: actorUserId });
      const updated = await this.updatePaymentUnappliedTx(tx, payment.id);
      const touched = allocation.invoiceIds.length ? await tx.salesInvoice.findMany({ where: { id: { in: allocation.invoiceIds } }, select: { salesOrderId: true } }) : [];
      for (const orderId of new Set<string>([order.id, ...touched.map((row: any) => row.salesOrderId).filter(Boolean)])) await this.syncSalesOrderPaymentStatusTx(tx, orderId);
      changed = true;
      fromOrder = { id: order.id, orderNumber: order.orderNumber };
      applied = allocation.allocated;
      return updated;
    }, { isolationLevel: 'Serializable', timeout: 30000 }));
    if (changed) await this.audit.record({ actorUserId, action: 'payment.advance_to_account', entityType: 'CustomerPayment', entityId: paymentId, summary: `Moved advance on ${result.receiptNumber} to the customer's account`, metadata: { reason: note, fromOrder, appliedToInvoices: applied } });
    return this.customerPayment(paymentId);
  }

  /**
   * Void a wrong invoice. Receipt money applied to it goes back to unapplied (each
   * receipt keeps its order link), the ledger gets a reversing entry, and its
   * dispatch lines can be invoiced again. Refused once a return or credit note
   * touched it, because voiding cannot undo those.
   */
  async voidSalesInvoice(id: string, reason: string, actorUserId: string) {
    const note = String(reason || '').trim().slice(0, 500);
    if (note.length < 3) throw new BadRequestException('Give a short reason for voiding this invoice.');
    let changed = false;
    const result = await withSerializableRetry(() => this.prisma.$transaction(async (tx) => {
      const invoice = await tx.salesInvoice.findUnique({ where: { id }, include: { lines: true } });
      if (!invoice) throw new NotFoundException('Invoice not found.');
      if (invoice.status === 'void') throw new BadRequestException(`Invoice ${invoice.invoiceNumber} is already void.`);
      changed = true;
      const allocations = await tx.customerAllocation.findMany({ where: { salesInvoiceId: id, status: ACTIVE_ALLOCATION } });
      if (allocations.some((row: any) => row.sourceType !== 'CustomerPayment')) {
        throw new BadRequestException('A credit note from a return is applied to this invoice. A return cannot be undone by voiding, so this invoice cannot be voided.');
      }
      const lineIds = (invoice.lines || []).map((line: any) => line.id);
      const dispatchLineIds = (invoice.lines || []).map((line: any) => line.dispatchLineId);
      const returns = dispatchLineIds.length ? await tx.returnLine.findMany({ where: { dispatchLineId: { in: dispatchLineIds }, status: { not: 'cancelled' } }, select: { metadata: true } }) : [];
      if (returns.some((row: any) => lineIds.includes(String(row.metadata?.sourceInvoiceLineId || '')))) {
        throw new BadRequestException('Goods on this invoice were returned against it. Voiding cannot undo the return, so this invoice cannot be voided.');
      }
      await tx.customerAllocation.updateMany({ where: { id: { in: allocations.map((row: any) => row.id) } }, data: { status: 'void', updatedAt: new Date() } });
      const now = new Date();
      // Free the dispatch lines for a fresh invoice; the void document keeps its lines (original link kept in metadata).
      for (const line of invoice.lines || []) {
        await tx.salesInvoiceLine.update({ where: { id: line.id }, data: { dispatchLineId: `void:${line.id}`, metadata: { ...((line.metadata as any) || {}), voidedDispatchLineId: line.dispatchLineId } } });
      }
      const voided = await tx.salesInvoice.update({
        where: { id }, data: { status: 'void', openAmount: 0, voidedAt: now, voidedBy: actorUserId, updatedAt: now, metadata: { ...((invoice.metadata as any) || {}), voidReason: note, openAmountAtVoid: Number(invoice.openAmount || 0) } },
      });
      for (const paymentId of new Set(allocations.map((row: any) => row.sourceId))) await this.updatePaymentUnappliedTx(tx, String(paymentId));
      await this.ledgerEntry(tx, {
        customerId: invoice.customerId, sourceType: 'SalesInvoiceVoid', sourceId: invoice.id, sourceKey: `invoice-void:${invoice.id}`,
        effectiveAt: now, credit: Number(invoice.totalAmount || 0), narration: `Invoice ${invoice.invoiceNumber} voided: ${note}`, createdBy: actorUserId,
        metadata: { invoiceNumber: invoice.invoiceNumber, salesOrderId: invoice.salesOrderId },
      });
      const orderIds = new Set<string>([invoice.salesOrderId]);
      const payments = allocations.length ? await tx.customerPayment.findMany({ where: { id: { in: allocations.map((row: any) => row.sourceId) } }, select: { salesOrderId: true } }) : [];
      payments.forEach((row: any) => { if (row.salesOrderId) orderIds.add(row.salesOrderId); });
      for (const orderId of orderIds) await this.syncSalesOrderPaymentStatusTx(tx, orderId);
      return voided;
    }, { isolationLevel: 'Serializable', timeout: 30000 }));
    if (changed) await this.audit.record({ actorUserId, action: 'invoice.void', entityType: 'SalesInvoice', entityId: id, summary: `Voided invoice ${result.invoiceNumber}`, metadata: { reason: note, totalAmount: result.totalAmount, salesOrderId: result.salesOrderId } });
    return this.completeInvoiceView(id);
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
    const amount = roundMoney(Number(creditNote.amount || 0));
    const touchedOrders = new Set<string>(creditNote.salesOrderId ? [creditNote.salesOrderId] : []);
    if (refundMode === 'refund') {
      // Cash paid back to the customer: money going out of the cash drawer. The credit
      // and the refund cancel out on the ledger; the invoice is left as it is.
      const paidAt = new Date();
      await this.ledgerEntry(tx, {
        customerId: creditNote.customerId, sourceType: 'CreditNoteRefund', sourceId: creditNote.id, sourceKey: `credit-note-refund:${creditNote.id}`,
        effectiveAt: paidAt, debit: amount, narration: `Refund paid against ${creditNote.creditNoteNumber}`,
        createdBy: actorUserId, metadata: { moneyOut: true, moneyAccount: 'cash_drawer', paymentMode: 'cash', salesOrderId: creditNote.salesOrderId || null },
      });
      await tx.creditNote.update({ where: { id: creditNote.id }, data: { unappliedAmount: 0, updatedAt: new Date(), metadata: { ...((creditNote.metadata as any) || {}), refundPaidAt: paidAt.toISOString(), refundMoneyAccount: 'cash_drawer', refundPaidBy: actorUserId } } });
    } else {
      // Store credit, adjust balance or a plain credit note: first reduce the invoice the
      // returned goods were billed on (never above what is open on it). "Adjust customer
      // balance" then also clears the customer's other open invoices, oldest first.
      // Whatever is left stays as customer credit.
      const returnLines = creditNote.returnOrderId ? await tx.returnLine.findMany({ where: { returnOrderId: creditNote.returnOrderId }, select: { metadata: true } }) : [];
      const invoiceLineIds = Array.from(new Set(returnLines.map((row: any) => String(row.metadata?.sourceInvoiceLineId || '')).filter(Boolean))) as string[];
      const invoiceLines = invoiceLineIds.length ? await tx.salesInvoiceLine.findMany({ where: { id: { in: invoiceLineIds } }, select: { salesInvoiceId: true } }) : [];
      const sourceInvoiceIds = Array.from(new Set(invoiceLines.map((row: any) => row.salesInvoiceId))) as string[];
      let remaining = amount;
      if (sourceInvoiceIds.length) {
        const applied = await this.allocateSourceTx(tx, { customerId: creditNote.customerId, sourceType: 'CreditNote', sourceId: creditNote.id, amount: remaining, createdBy: actorUserId, invoiceIds: sourceInvoiceIds });
        remaining = applied.remaining;
      }
      if (refundMode === 'order_adjustment' && remaining > 0) {
        const applied = await this.allocateSourceTx(tx, { customerId: creditNote.customerId, sourceType: 'CreditNote', sourceId: creditNote.id, amount: remaining, createdBy: actorUserId });
        remaining = applied.remaining;
      }
      await tx.creditNote.update({ where: { id: creditNote.id }, data: { unappliedAmount: remaining, updatedAt: new Date() } });
      const allocated = await tx.customerAllocation.findMany({ where: { sourceType: 'CreditNote', sourceId: creditNote.id, status: ACTIVE_ALLOCATION }, select: { salesInvoiceId: true } });
      if (allocated.length) {
        const invoices = await tx.salesInvoice.findMany({ where: { id: { in: allocated.map((row: any) => row.salesInvoiceId) } }, select: { salesOrderId: true } });
        invoices.forEach((row: any) => touchedOrders.add(row.salesOrderId));
      }
    }
    for (const orderId of touchedOrders) await this.syncSalesOrderPaymentStatusTx(tx, orderId);
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
    const orderIds = Array.from(new Set((invoices as any[]).map((row) => row.salesOrderId).filter(Boolean))) as string[];
    const orders = orderIds.length ? await this.prisma.salesOrder.findMany({ where: { id: { in: orderIds } }, select: { id: true, orderNumber: true } }) : [];
    const orderNumberById = new Map((orders as any[]).map((row) => [row.id, row.orderNumber]));
    const invoiceById = new Map((invoices as any[]).map((row) => [row.id, { ...row, orderNumber: orderNumberById.get(row.salesOrderId) || null }]));
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
    // Unused advances still tied to a cancelled order: the screen offers refund or move to account.
    const advanceRows = await this.prisma.customerPayment.findMany({ where: { customerId, status: 'posted', salesOrderId: { not: null }, unappliedAmount: { gt: 0 } }, orderBy: { receivedAt: 'asc' } });
    const advanceOrders = advanceRows.length ? await this.prisma.salesOrder.findMany({ where: { id: { in: advanceRows.map((row: any) => row.salesOrderId) }, status: 'cancelled' }, select: { id: true, orderNumber: true, documents: true } }) : [];
    const cancelledById = new Map((advanceOrders as any[]).map((row) => [row.id, row]));
    const cancelledOrderAdvances = (advanceRows as any[]).filter((row) => cancelledById.has(row.salesOrderId) && !(row.metadata as any)?.advanceRefund).map((row) => {
      const order: any = cancelledById.get(row.salesOrderId);
      return { paymentId: row.id, receiptNumber: row.receiptNumber, receivedAt: row.receivedAt, paymentMode: row.paymentMode, amount: Number(row.amount || 0), unappliedAmount: Number(row.unappliedAmount || 0), salesOrderId: order.id, orderNumber: order.orderNumber, cancelledAt: order.documents?.cancellation?.cancelledAt || null, cancelReason: order.documents?.cancellation?.reason || null };
    });
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
      invoices, payments, creditNotes, salesOrders, cancelledOrderAdvances, ledger: ledger.map((entry: any) => ({ ...entry, sourceLabel: sourceLabel(entry.sourceType) })), tasks,
    };
  }

  /**
   * Customer statement that adds up: opening balance (everything before `from`),
   * every entry in the range oldest first with a running balance (paged on screen,
   * whole range for the PDF), and closing = opening + debits - credits in range.
   */
  async customerStatement(customerId: string, args?: { from?: string | null; to?: string | null; skip?: number; take?: number }) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundException('Customer not found.');
    const day = (value: string | null | undefined, end = false) => {
      if (!value) return null;
      const text = String(value).slice(0, 10);
      const parsed = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00+05:30`) : new Date(value);
      if (Number.isNaN(parsed.getTime())) throw new BadRequestException('Enter a valid statement date.');
      return end ? new Date(parsed.getTime() + 86400000) : parsed;
    };
    const from = day(args?.from);
    const to = day(args?.to, true);
    if (from && to && from >= to) throw new BadRequestException('The statement start date must be before the end date.');
    const take = Math.min(Math.max(Number(args?.take || 100), 1), 5000);
    const skip = Math.max(Math.trunc(Number(args?.skip || 0)), 0);
    const range: any = {};
    if (from) range.gte = from;
    if (to) range.lt = to;
    const where: any = { customerId, ...(from || to ? { effectiveAt: range } : {}) };
    const order = [{ effectiveAt: 'asc' as const }, { createdAt: 'asc' as const }, { id: 'asc' as const }];
    const [before, within, total, beforePage] = await Promise.all([
      from ? this.prisma.customerLedgerEntry.aggregate({ where: { customerId, effectiveAt: { lt: from } }, _sum: { debit: true, credit: true } }) : null,
      this.prisma.customerLedgerEntry.aggregate({ where, _sum: { debit: true, credit: true } }),
      this.prisma.customerLedgerEntry.count({ where }),
      skip ? this.prisma.customerLedgerEntry.findMany({ where, orderBy: order, take: skip, select: { debit: true, credit: true } }) : [],
    ]);
    const entries = await this.prisma.customerLedgerEntry.findMany({ where, orderBy: order, skip, take });
    const p = (value: unknown) => Math.round((Number(value || 0) || 0) * 100);
    const opening = before ? p(before._sum.debit) - p(before._sum.credit) : 0;
    const debit = p(within._sum.debit); const credit = p(within._sum.credit);
    let running = opening + (beforePage as any[]).reduce((sum, row) => sum + p(row.debit) - p(row.credit), 0);
    const pageOpening = running;
    const rows = entries.map((entry: any) => {
      running += p(entry.debit) - p(entry.credit);
      return { ...entry, sourceLabel: sourceLabel(entry.sourceType), runningBalance: running / 100 };
    });
    return {
      customer, from: from ? from.toISOString() : null, to: to ? to.toISOString() : null,
      openingBalance: opening / 100, totalDebit: debit / 100, totalCredit: credit / 100, closingBalance: (opening + debit - credit) / 100,
      pageOpeningBalance: pageOpening / 100, entries: rows, total, skip, take,
    };
  }

  /** Quantity sent and returned per order line, in the order's selling unit (boxes for boxed tiles). */
  async salesOrderDispatchedQuantities(salesOrderId: string) {
    const [orderLines, dispatchLines] = await Promise.all([
      this.prisma.salesOrderLine.findMany({ where: { salesOrderId }, select: { id: true, lineKey: true, productId: true, sku: true } }),
      this.prisma.dispatchLine.findMany({ where: { salesOrderId, status: { in: ['dispatched', 'delivered'] }, dispatchedQuantity: { gt: 0 } }, select: { salesOrderLineId: true, productId: true, sku: true, dispatchedQuantity: true, returnedQuantity: true } }),
    ]);
    const productIds = Array.from(new Set([...orderLines, ...dispatchLines].map((row: any) => row.productId).filter(Boolean))) as string[];
    const products = productIds.length ? await this.prisma.product.findMany({ where: { id: { in: productIds } } }) : [];
    const factor = new Map((products as any[]).map((row) => [row.id, stockFactor(row)]));
    const productById = new Map((products as any[]).map((row) => [row.id, row]));
    const byLine = new Map<string, { sent: number; returned: number }>();
    for (const row of dispatchLines as any[]) {
      const key = row.salesOrderLineId || `sku:${row.sku}`;
      const entry = byLine.get(key) || { sent: 0, returned: 0 };
      entry.sent += Number(row.dispatchedQuantity || 0); entry.returned += Number(row.returnedQuantity || 0);
      byLine.set(key, entry);
    }
    return (orderLines as any[]).map((line) => {
      const entry = byLine.get(line.id) || { sent: 0, returned: 0 };
      const f = factor.get(line.productId) || 1;
      return { salesOrderLineId: line.id, lineKey: line.lineKey, productId: line.productId, sku: line.sku, sentQuantity: Math.round((entry.sent / f) * 1000) / 1000, returnedQuantity: Math.round((entry.returned / f) * 1000) / 1000, piecesPerUnit: f, ...tileBoxReading(productById.get(line.productId)) };
    });
  }

  async dashboard(args?: { search?: string; take?: number; skip?: number }) {
    const take = Math.min(Math.max(Number(args?.take || 120), 1), 300);
    const skip = Math.max(Math.trunc(Number(args?.skip || 0)), 0);
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
    const allAccounts = balanceRows.map((balance) => {
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
    }).filter((row) => row.customer && (!args?.search || [row.customer.name, row.customer.mobile, row.customer.city].join(' ').toLowerCase().includes(args.search.toLowerCase()))).sort((a, b) => b.balance - a.balance);
    const accounts = allAccounts.slice(skip, skip + take);
    // Tiles are company-wide and server-side: the search box changes the list, never the totals.
    const monthStart = indiaMonthStart(now);
    const [position, monthReceipts, monthRefunds, monthBilling] = await Promise.all([
      receivablePosition(this.prisma, now),
      this.prisma.customerPayment.aggregate({ where: { status: 'posted', receivedAt: { gte: monthStart } }, _sum: { amount: true } }),
      this.prisma.customerLedgerEntry.aggregate({ where: { sourceType: { in: ['CreditNoteRefund', 'AdvanceRefund'] }, effectiveAt: { gte: monthStart } }, _sum: { debit: true } }),
      // Every invoice issued this month counts, paid or not; only voided ones are left out.
      this.prisma.salesInvoice.aggregate({ where: { status: { not: 'void' }, issueDate: { gte: monthStart } }, _sum: { totalAmount: true } }),
    ]);
    const currentMonthRefunds = Number(monthRefunds._sum?.debit || 0);
    return {
      kpis: {
        receivable: position.receivable, overdue: position.overdue,
        currentMonthCollections: roundMoney(Number(monthReceipts._sum?.amount || 0) - currentMonthRefunds),
        currentMonthReceipts: roundMoney(Number(monthReceipts._sum?.amount || 0)), currentMonthRefunds: roundMoney(currentMonthRefunds),
        currentMonthBilling: roundMoney(Number(monthBilling._sum?.totalAmount || 0)),
        unappliedCredit: position.unappliedCredit, openInvoices: position.openInvoices, openTasks: tasks.length,
      },
      accounts,
      accountsTotal: allAccounts.length,
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
