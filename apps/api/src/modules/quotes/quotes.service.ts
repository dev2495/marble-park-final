import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { nextDocumentNumber } from '../common/sequence';
import { applyStockPostingTx, syncSalesOrderLinesForQuoteTx } from '../common/stock-posting';
import { releaseReservedLotsTx, reserveAvailableLotsTx } from '../common/lot-allocation';
import { commercialTotalsFromLines, priceQuoteLines } from '../common/pricing';
import { ulid } from 'ulid';

export interface CreateQuoteInput {
  leadId: string;
  customerId: string;
  ownerId: string;
  title: string;
  projectName?: string;
  validUntil?: Date;
  notes?: string;
  lines?: any[];
  discountPercent?: number;
  displayMode?: string;
  quoteMeta?: any;
  intentId?: string | null;
  supersedesQuoteId?: string | null;
}

export interface UpdateQuoteInput {
  title?: string;
  projectName?: string;
  validUntil?: Date;
  notes?: string;
  lines?: any[];
  discountPercent?: number;
  displayMode?: string;
  quoteMeta?: any;
  coverImage?: string;
}

export interface CreateSalesOrderInput {
  quoteId: string;
  paymentMode: string;
  advanceAmount?: number;
  notes?: string;
  lines?: any[] | string;
  idempotencyKey?: string;
  promisedDate?: Date;
  paymentTerms?: string;
}

const QUOTE_STATUSES = ['draft', 'pending_approval', 'approved', 'sent', 'customer_followup', 'partially_ordered', 'confirmed', 'won', 'closed', 'lost', 'expired', 'superseded'];

// Eager-include retained ONLY for endpoints that legitimately need the embedded
// objects in a single round-trip (e.g. internal services that don't go through
// the GraphQL resolver layer where DataLoaders kick in). Resolver-driven reads
// should rely on per-field DataLoader resolution and pass `quoteInclude: false`
// (or use `findRaw`) so we don't double-fetch.
const quoteInclude = {
  customer: true,
  lead: true,
  owner: { select: { id: true, name: true, email: true, role: true, phone: true, active: true } },
} as any;

@Injectable()
export class QuotesService {
  constructor(private prisma: PrismaService, private notifications: NotificationsService) {}

  /**
   * GraphQL-facing list. Returns BARE rows (no relations eagerly joined) so
   * the resolver can fan relations through DataLoader and avoid the classic
   * 1 + 2N (`customer`, `owner` per row) hit pattern when listing 100s of quotes.
   */
  async findAll(args?: { leadId?: string; customerId?: string; ownerId?: string; status?: string }): Promise<any[]> {
    const where: any = {};
    if (args?.leadId) where.leadId = args.leadId;
    if (args?.customerId) where.customerId = args.customerId;
    if (args?.ownerId) where.ownerId = args.ownerId;
    if (args?.status) where.status = args.status;

    return this.prisma.quote.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    } as any) as any;
  }

  /**
   * GraphQL-facing single read — bare row, relations fetched via DataLoader.
   */
  async findById(id: string): Promise<any> {
    const quote = await this.prisma.quote.findUnique({ where: { id } } as any) as any;
    if (!quote) throw new NotFoundException('Quote not found');
    return quote;
  }

  /**
   * Internal-only loader that DOES eager-include relations. Use sparingly
   * (notification builders, sales-order conversion) where the relation is
   * accessed once and DataLoader infrastructure is unavailable.
   */
  async findByIdWithRelations(id: string): Promise<any> {
    const quote = await this.prisma.quote.findUnique({
      where: { id },
      include: quoteInclude,
    } as any) as any;
    if (!quote) throw new NotFoundException('Quote not found');
    return quote;
  }

  async create(data: CreateQuoteInput): Promise<any> {
    const ownerId = data.ownerId || (await this.prisma.user.findFirst({
      where: { active: true, role: { in: ['sales', 'owner', 'admin'] } as any },
      orderBy: { createdAt: 'asc' },
    }))?.id;
    if (!ownerId) throw new BadRequestException('A quote owner is required');

    const customerId = data.customerId;
    if (!customerId) throw new BadRequestException('A customer is required');

    const assertedLines = await this.assertQuoteLines(data.lines, 'creating a quote');
    const pricing = priceQuoteLines(assertedLines, data.discountPercent || 0);
    const normalizedLines = pricing.lines;
    const displayMode = this.normalizeDisplayMode(data.displayMode);
    const quoteMeta = this.normalizeQuoteMeta(data.quoteMeta, normalizedLines);
    const availabilityIssues = await this.getAvailabilityIssues(normalizedLines);

    // Atomic boundary: lead-autocreate + quote insert + (reservation pre-allocation
    // for fully-available lines) all succeed or roll back together. Quote-number
    // collisions retry inside the loop with a fresh transaction so partial state
    // can never leak between attempts.
    let created: any = null;
    let lastError: any = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const quoteNumber = await this.generateQuoteNumber();
      try {
        created = await this.prisma.$transaction(async (tx) => {
          let leadId = data.leadId;
          if (!leadId) {
            const lead = await tx.lead.create({
              data: {
                id: ulid(),
                customerId,
                ownerId,
                title: data.projectName || data.title || 'Retail quote opportunity',
                source: 'Quote desk',
                stage: 'quoted',
                expectedValue: pricing.totals.grandTotal,
                lastContactAt: new Date(),
                nextActionAt: new Date(Date.now() + 86400000 * 2),
                notes: 'Auto-created from quote builder.',
                updatedAt: new Date(),
              },
            });
            leadId = lead.id;
          }

          let supersedesId = data.supersedesQuoteId || null;
          let versionNumber = 1;
          if (supersedesId) {
            const parent = await tx.quote.findUnique({ where: { id: supersedesId } });
            if (!parent) throw new BadRequestException('Parent quote to revise was not found');
            if (parent.leadId !== leadId) throw new BadRequestException('Revision target belongs to a different lead');
            if ((parent as any).supersededByQuoteId) {
              throw new BadRequestException('This quote is already superseded. Revise the current quote version.');
            }
            versionNumber = Number((parent as any).versionNumber || 1) + 1;
            await this.releaseReservationsTx(tx, supersedesId, 'Quote superseded by revision');
          }

          const { intentId, supersedesQuoteId: _supersedesQuoteId, ...quoteData } = data as any;
          const quote = await tx.quote.create({
            data: {
              id: ulid(),
              ...quoteData,
              customerId,
              ownerId,
              leadId,
              lines: normalizedLines,
              quoteNumber,
              status: pricing.requiresApproval ? 'pending_approval' : 'draft',
              approvalStatus: pricing.requiresApproval ? 'pending' : 'approved',
              discountPercent: pricing.quoteDiscountPercent,
              displayMode,
              projectName: data.projectName || '',
              title: data.title || 'Retail quotation',
              validUntil: data.validUntil || this.defaultValidUntil(),
              coverImage: '',
              notes: data.notes || '',
              versions: [],
              quoteMeta,
              intentId: intentId || null,
              supersedesQuoteId: supersedesId,
              versionNumber,
              approval: {
                requestedAt: new Date().toISOString(),
                reason: pricing.requiresApproval ? 'below_floor_rate_requires_owner_approval' : 'quote_ready_no_owner_approval_required',
                availabilityIssues,
                pricing: pricing.totals,
                discountPercent: pricing.quoteDiscountPercent,
                total: pricing.totals.grandTotal,
                requiresPriceApproval: pricing.requiresApproval,
                displayMode,
                ...(pricing.requiresApproval ? {} : { autoApprovedAt: new Date().toISOString() }),
              },
              updatedAt: new Date(),
            },
            include: quoteInclude,
          } as any) as any;
          if (supersedesId) {
            await tx.quote.update({
              where: { id: supersedesId },
              data: { supersededByQuoteId: quote.id, status: 'superseded', updatedAt: new Date() } as any,
            });
          }
          await this.syncQuoteLinesTx(tx, quote, normalizedLines);
          await this.upsertDocumentJobTx(tx, {
            entityType: 'Quote',
            entityId: quote.id,
            documentType: 'quote_pdf',
            url: `/api/pdf/quote/${quote.id}`,
            actorUserId: ownerId,
            metadata: { quoteNumber: quote.quoteNumber, statusSource: 'route_verified_on_request' },
          });
          return quote;
        }, { timeout: 15000 });
        break;
      } catch (error: any) {
        lastError = error;
        if (error?.code === 'P2002' && attempt < 4) continue;
        throw error;
      }
    }
    if (!created) throw new BadRequestException(lastError?.message || 'Could not allocate quote number');
    await this.audit(created.ownerId, 'quote.create', created.id, `Created ${created.quoteNumber}`, { customerId: created.customerId });
    await this.notifications.createMany([
      {
        title: 'Quote ready',
        message: `${created.quoteNumber} is ready to share or confirm for ${created.customer?.name || 'customer'}.`,
        type: 'quote_ready',
        entityType: 'Quote',
        entityId: created.id,
        href: `/dashboard/quotes/${created.id}`,
        targetUserId: created.ownerId,
        metadata: { quoteNumber: created.quoteNumber, displayMode, pdfUrl: `/api/pdf/quote/${created.id}` },
      },
      {
        title: 'Quote ready',
        message: `${created.quoteNumber} is visible to admin/owner without approval blocking.`,
        type: 'quote_ready',
        entityType: 'Quote',
        entityId: created.id,
        href: `/dashboard/quotes/${created.id}`,
        targetRole: 'admin',
        metadata: { quoteNumber: created.quoteNumber, displayMode, pdfUrl: `/api/pdf/quote/${created.id}` },
      },
    ]);
    return created;
  }

  async update(id: string, data: UpdateQuoteInput): Promise<any> {
    const current = await this.findById(id);
    if (data.discountPercent !== undefined || data.lines !== undefined) {
      const existingOrders = await this.prisma.salesOrder.count({ where: { quoteId: id } });
      if (existingOrders > 0) {
        throw new BadRequestException('Commercial lines are frozen once an order exists. Create a quote revision for a new commercial agreement.');
      }
    }
    const updateData: any = { ...data };
    if (data.discountPercent !== undefined || data.lines !== undefined) {
      const assertedLines = data.lines !== undefined
        ? await this.assertQuoteLines(data.lines, 'updating a quote')
        : await this.assertQuoteLines(current.lines, 'updating a quote');
      const pricing = priceQuoteLines(assertedLines, data.discountPercent ?? current.discountPercent ?? 0);
      updateData.lines = pricing.lines;
      updateData.discountPercent = pricing.quoteDiscountPercent;
      updateData.quoteMeta = this.normalizeQuoteMeta(data.quoteMeta ?? current.quoteMeta, pricing.lines);
      updateData.approvalStatus = pricing.requiresApproval ? 'pending' : 'approved';
      updateData.status = pricing.requiresApproval ? 'pending_approval' : 'draft';
      updateData.approval = {
        requestedAt: new Date().toISOString(),
        reason: pricing.requiresApproval ? 'below_floor_rate_requires_owner_approval' : 'quote_changed_no_owner_reapproval_required',
        availabilityIssues: await this.getAvailabilityIssues(pricing.lines),
        pricing: pricing.totals,
        discountPercent: pricing.quoteDiscountPercent,
        total: pricing.totals.grandTotal,
        requiresPriceApproval: pricing.requiresApproval,
        ...(pricing.requiresApproval ? {} : { autoApprovedAt: new Date().toISOString() }),
      };
    }
    if (data.displayMode !== undefined) updateData.displayMode = this.normalizeDisplayMode(data.displayMode);
    if (data.quoteMeta !== undefined && updateData.quoteMeta === undefined) updateData.quoteMeta = this.normalizeQuoteMeta(data.quoteMeta, await this.assertQuoteLines((await this.findById(id)).lines, 'updating quote metadata'));
    
    const updated = await this.prisma.quote.update({
      where: { id },
      data: updateData,
      include: quoteInclude,
    } as any) as any;
    if (updateData.lines) {
      await this.prisma.$transaction(async (tx) => {
        await tx.quoteLine.deleteMany({ where: { quoteId: id } }).catch(() => null);
        await this.syncQuoteLinesTx(tx, updated, this.normalizeLines(updateData.lines));
      }, { timeout: 10000 });
    }
    await this.audit(updated.ownerId, 'quote.update', id, `Updated ${updated.quoteNumber}`, updateData);
    await this.notifications.createMany([
      {
        title: 'Quote updated',
        message: `${updated.quoteNumber} was updated and is ready to share or confirm.`,
        type: 'quote_ready',
        entityType: 'Quote',
        entityId: updated.id,
        href: `/dashboard/quotes/${updated.id}`,
        targetUserId: updated.ownerId,
        metadata: { pdfUrl: `/api/pdf/quote/${updated.id}` },
      },
      {
        title: 'Quote updated',
        message: `${updated.quoteNumber} was updated and remains unblocked for confirmation.`,
        type: 'quote_ready',
        entityType: 'Quote',
        entityId: updated.id,
        href: `/dashboard/quotes/${updated.id}`,
        targetRole: 'admin',
        metadata: { pdfUrl: `/api/pdf/quote/${updated.id}` },
      },
    ]);
    return updated;
  }

  async updateStatus(id: string, status: string): Promise<any> {
    if (!QUOTE_STATUSES.includes(status)) {
      throw new BadRequestException(`Invalid status: ${status}`);
    }

    await this.findById(id);

    const updateData: any = { status };
    if (status === 'sent') {
      updateData.sentAt = new Date();
    } else if (status === 'confirmed') {
      updateData.confirmedAt = new Date();
    }

    // Status flip + reservation release + audit must be atomic so we never
    // leave reservations dangling against a lost/expired quote.
    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.quote.update({
        where: { id },
        data: updateData,
        include: quoteInclude,
      } as any) as any;
      if (['lost', 'expired', 'superseded'].includes(status)) {
        await this.releaseReservationsTx(tx, id, `Quote marked ${status}`);
      }
      await tx.auditEvent.create({
        data: {
          id: ulid(),
          actorUserId: next.ownerId,
          action: 'quote.status',
          entityType: 'Quote',
          entityId: id,
          summary: `Quote status changed to ${status}`,
          metadata: { status },
        },
      }).catch(() => null);
      return next;
    }, { timeout: 15000 });
    return updated;
  }

  async sendQuote(id: string): Promise<any> {
    const quote = await this.findById(id);
    const sent = await this.prisma.quote.update({
      where: { id },
      data: { status: 'sent', approvalStatus: quote.approvalStatus === 'pending' ? 'approved' : quote.approvalStatus, sentAt: new Date() },
      include: quoteInclude,
    } as any) as any;
    await this.audit(sent.ownerId, 'quote.send', id, `Sent ${sent.quoteNumber}`, {});
    await this.notifications.create({
      title: 'Quote PDF ready for follow-up',
      message: `${sent.quoteNumber} has been marked sent. Continue customer follow-up from CRM.`,
      type: 'quote_sent',
      entityType: 'Quote',
      entityId: sent.id,
      href: `/dashboard/leads/${sent.leadId}`,
      targetUserId: sent.ownerId,
      metadata: { pdfUrl: `/api/pdf/quote/${sent.id}` },
    });
    return sent;
  }

  async confirmQuote(id: string) {
    const quote = await this.findByIdWithRelations(id);
    const existingOrder = await this.prisma.salesOrder.findFirst({ where: { quoteId: id } }).catch(() => null);
    if (!existingOrder) {
      throw new BadRequestException('Final confirmation must create a Sales Order with payment details. Use createSalesOrderFromQuote instead.');
    }
    return this.prisma.quote.update({
      where: { id },
      data: {
        status: 'confirmed',
        approvalStatus: quote.approvalStatus === 'pending' ? 'approved' : quote.approvalStatus,
        confirmedAt: quote.confirmedAt || new Date(),
        updatedAt: new Date(),
      },
      include: quoteInclude,
    } as any) as any;
  }

  async createSalesOrderFromQuote(input: CreateSalesOrderInput, actorUserId: string) {
    const quote = await this.findByIdWithRelations(input.quoteId);
    if (quote.approvalStatus === 'pending') {
      throw new BadRequestException('Owner approval is required because this quote contains a below-floor rate.');
    }
    if (['closed', 'lost', 'expired', 'superseded'].includes(quote.status)) {
      throw new BadRequestException(`This quote is ${quote.status} and cannot create another sales order.`);
    }

    const paymentMode = String(input.paymentMode || '').toLowerCase() === 'credit' ? 'credit' : 'cash';
    const idempotencyKey = String(input.idempotencyKey || ulid()).trim();
    const requestedSelections = this.normalizeOrderSelections(input.lines);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const existing = await tx.salesOrder.findUnique({ where: { idempotencyKey } }).catch(() => null);
          if (existing) return existing;

          const latestQuote = await tx.quote.findUnique({ where: { id: quote.id }, include: quoteInclude } as any) as any;
          if (!latestQuote) throw new NotFoundException('Quote not found');
          if (latestQuote.approvalStatus === 'pending') throw new BadRequestException('Owner approval is required before creating an order.');

          let quoteLines = await tx.quoteLine.findMany({ where: { quoteId: quote.id }, orderBy: { lineNo: 'asc' } });
          if (!quoteLines.length) {
            const historicalLines = await this.assertQuoteLines(latestQuote.lines, 'creating a sales order');
            const priced = priceQuoteLines(historicalLines, latestQuote.discountPercent || 0);
            await this.syncQuoteLinesTx(tx, latestQuote, priced.lines);
            quoteLines = await tx.quoteLine.findMany({ where: { quoteId: quote.id }, orderBy: { lineNo: 'asc' } });
          }

          const selected = this.selectOrderLines(latestQuote, quoteLines as any[], requestedSelections);
          const commercial = priceQuoteLines(selected.lines, latestQuote.discountPercent || 0);
          const totalAmount = commercial.totals.grandTotal;
          const advanceAmount = paymentMode === 'cash' ? Number(input.advanceAmount || 0) : 0;
          if (!Number.isFinite(advanceAmount) || advanceAmount < 0 || advanceAmount > totalAmount) {
            throw new BadRequestException('Advance amount must be between zero and the selected order total.');
          }
          const paymentStatus = paymentMode === 'credit' ? 'credit' : advanceAmount >= totalAmount ? 'paid' : advanceAmount > 0 ? 'advance' : 'pending_cash';
          const salesOrderId = ulid();
          const orderNumber = await nextDocumentNumber(tx as any, 'sales_order', 'SO', new Date(), {
            existingNumbers: async (prefixForYear) => (await tx.salesOrder.findMany({
              where: { orderNumber: { startsWith: prefixForYear } },
              select: { orderNumber: true },
            })).map((row: any) => row.orderNumber),
          });

          for (const item of selected.items) {
            const updated = await tx.quoteLine.updateMany({
              where: { id: item.quoteLine.id, orderedQuantity: Number(item.quoteLine.orderedQuantity || 0) },
              data: {
                orderedQuantity: { increment: item.quantity },
                status: Number(item.quoteLine.orderedQuantity || 0) + item.quantity >= Number(item.quoteLine.quantity || 0)
                  ? 'fully_ordered'
                  : 'partially_ordered',
                updatedAt: new Date(),
              },
            });
            if (updated.count !== 1) throw new BadRequestException('Quote quantities changed while this order was being created. Review the remaining balance and try again.');
          }

          const salesOrder = await tx.salesOrder.create({
            data: {
              id: salesOrderId,
              orderNumber,
              quoteId: latestQuote.id,
              idempotencyKey,
              leadId: latestQuote.leadId,
              customerId: latestQuote.customerId,
              ownerId: latestQuote.ownerId,
              status: 'open',
              paymentMode,
              paymentStatus,
              paymentTerms: String(input.paymentTerms || (paymentMode === 'credit' ? 'Net 30' : 'Cash on order')).trim(),
              promisedDate: input.promisedDate ? new Date(input.promisedDate) : new Date(Date.now() + 86400000),
              advanceAmount,
              totalAmount,
              lines: commercial.lines,
              notes: input.notes || '',
              documents: {
                quotePdfUrl: `/api/pdf/quote/${latestQuote.id}`,
                salesOrderPdfUrl: `/api/pdf/order/${salesOrderId}`,
                quotePdf: { url: `/api/pdf/quote/${latestQuote.id}`, status: 'generated_on_request', checkedAt: new Date().toISOString() },
                salesOrderPdf: { url: `/api/pdf/order/${salesOrderId}`, status: 'generated_on_request', checkedAt: new Date().toISOString() },
                pricing: commercial.totals,
                generatedAt: new Date().toISOString(),
              },
              updatedAt: new Date(),
            },
          });

          await this.syncSalesOrderLinesTx(tx, { quote: latestQuote, salesOrder, lines: commercial.lines });
          const salesOrderLines = await tx.salesOrderLine.findMany({ where: { salesOrderId } });
          await this.createReservationsForSalesOrder(tx, { quote: latestQuote, salesOrder, lines: commercial.lines, salesOrderLines });
          await this.syncSalesOrderLinesTx(tx, { quote: latestQuote, salesOrder, lines: commercial.lines });
          await tx.dispatchJob.create({
            data: {
              id: ulid(),
              quoteId: latestQuote.id,
              salesOrderId: salesOrder.id,
              customerId: latestQuote.customerId,
              siteAddress: latestQuote.customer?.siteAddress || '',
              status: 'pending',
              dueDate: salesOrder.promisedDate || new Date(Date.now() + 86400000),
              ownerId: latestQuote.ownerId,
              updatedAt: new Date(),
            },
          });
          await this.ensureSalesOrderDocumentsTx(tx, latestQuote, salesOrder, actorUserId);

          if (advanceAmount > 0 || paymentMode === 'credit') {
            await tx.paymentReceipt.create({
              data: {
                id: ulid(),
                receiptNumber: await nextDocumentNumber(tx as any, 'payment_receipt', 'RCPT', new Date(), {
                  existingNumbers: async (prefixForYear) => (await tx.paymentReceipt.findMany({
                    where: { receiptNumber: { startsWith: prefixForYear } },
                    select: { receiptNumber: true },
                  })).map((row: any) => row.receiptNumber),
                }),
                salesOrderId: salesOrder.id,
                customerId: salesOrder.customerId,
                paymentMode,
                amount: paymentMode === 'credit' ? 0 : advanceAmount,
                status: paymentMode === 'credit' ? 'credit_due' : 'posted',
                receivedAt: new Date(),
                dueDate: paymentMode === 'credit' ? new Date(Date.now() + 86400000 * 30) : null,
                reference: '',
                notes: paymentMode === 'credit' ? 'Credit order opened; collection due date tracked here.' : 'Advance received during sales order conversion.',
                createdBy: actorUserId,
                updatedAt: new Date(),
                metadata: { orderNumber, paymentStatus, pricing: commercial.totals },
              },
            });
          }

          const refreshedLines = await tx.quoteLine.findMany({ where: { quoteId: latestQuote.id } });
          const isFullyOrdered = refreshedLines.every((line: any) => Number(line.orderedQuantity || 0) + Number(line.closedQuantity || 0) >= Number(line.quantity || 0));
          await tx.quote.update({
            where: { id: latestQuote.id },
            data: {
              status: isFullyOrdered ? 'confirmed' : 'partially_ordered',
              confirmedAt: latestQuote.confirmedAt || new Date(),
              updatedAt: new Date(),
            },
          });
          await tx.lead.update({ where: { id: latestQuote.leadId }, data: { stage: 'won', updatedAt: new Date(), lastContactAt: new Date() } }).catch(() => null);
          await tx.leadIntent.updateMany({
            where: { quoteId: latestQuote.id, salesOrderId: null },
            data: { status: 'converted', salesOrderId: salesOrder.id, updatedAt: new Date() },
          }).catch(() => null);
          await this.createPurchaseDemandForSalesOrderTx(tx, { quote: latestQuote, salesOrder, lines: commercial.lines });
          await tx.activity.create({
            data: {
              id: ulid(), leadId: latestQuote.leadId, quoteId: latestQuote.id, userId: actorUserId,
              type: 'sales_order_created', message: `${salesOrder.orderNumber} created for selected quote quantities as ${paymentMode.toUpperCase()} (${paymentStatus}).`,
            },
          }).catch(() => null);
          await tx.notification.createMany({
            data: [
              { id: ulid(), title: 'Sales order created', message: `${salesOrder.orderNumber} created from ${latestQuote.quoteNumber}.`, type: 'sales_order_created', entityType: 'SalesOrder', entityId: salesOrder.id, href: '/dashboard/orders', targetRole: 'owner', metadata: { quoteId: latestQuote.id, salesOrderId: salesOrder.id, paymentMode, paymentStatus, totalAmount, salesOrderPdfUrl: `/api/pdf/order/${salesOrder.id}` } },
              { id: ulid(), title: 'Sales order ready for dispatch', message: `${salesOrder.orderNumber} has its own dispatch job and reservations.`, type: 'dispatch_ready', entityType: 'SalesOrder', entityId: salesOrder.id, href: '/dashboard/dispatch', targetRole: 'dispatch_ops', metadata: { quoteId: latestQuote.id, salesOrderId: salesOrder.id, salesOrderPdfUrl: `/api/pdf/order/${salesOrder.id}` } },
            ],
          }).catch(() => null);
          return salesOrder;
        }, { timeout: 20000, isolationLevel: 'Serializable' as any });
      } catch (error: any) {
        if ((error?.code === 'P2034' || error?.code === 'P2002') && attempt < 2) continue;
        throw error;
      }
    }
    throw new BadRequestException('Could not safely create this sales order. Review remaining quote quantities and try again.');
  }

  private async syncQuoteLinesTx(tx: any, quote: any, lines: any[]) {
    for (const [index, line] of this.normalizeLines(lines).entries()) {
      const key = this.quoteLineKey(line, index);
      const quantity = Math.trunc(Number(line.qty || line.quantity || 0));
      const listPrice = Number(line.listPrice ?? line.price ?? line.sellPrice ?? 0);
      const unitPrice = Number(line.unitRate ?? line.specialRate ?? listPrice);
      const discountPercent = Number(line.discountPercent ?? line.discount ?? 0);
      const taxRate = Number(line.taxRate ?? 18);
      const taxableValue = Number(line.taxableValue ?? quantity * unitPrice);
      const taxAmount = Number(line.taxAmount ?? 0);
      const grossLineTotal = Number(line.grossLineTotal ?? line.total ?? taxableValue + taxAmount);
      const pricing = { listPrice, unitPrice, discountPercent, taxRate, taxableValue, taxAmount, grossLineTotal };
      await tx.quoteLine.upsert({
        where: { quoteId_lineKey: { quoteId: quote.id, lineKey: key } },
        update: {
          lineNo: index + 1,
          productId: line.productId || null,
          sku: String(line.sku || line.tileCode || line.productId || `LINE-${index + 1}`),
          name: String(line.name || line.description || line.sku || `Line ${index + 1}`),
          category: String(line.category || (this.isTileLine(line) ? 'Tiles' : 'Product')),
          brand: String(line.brand || ''),
          finish: line.finish || line.tileSize || line.dimensions || null,
          area: line.area || line.room || line.section || null,
          unit: String(line.unit || line.uom || 'PC').toUpperCase(),
          quantity,
          listPrice,
          unitPrice,
          discountPercent,
          taxRate,
          taxableValue,
          taxAmount,
          grossLineTotal,
          lineTotal: grossLineTotal,
          status: 'quoted',
          isTileSpecial: this.isTileLine(line) && !String(line.productId || '').trim(),
          metadata: { snapshot: line, pricing },
          updatedAt: new Date(),
        },
        create: {
          id: ulid(),
          quoteId: quote.id,
          lineKey: key,
          lineNo: index + 1,
          productId: line.productId || null,
          sku: String(line.sku || line.tileCode || line.productId || `LINE-${index + 1}`),
          name: String(line.name || line.description || line.sku || `Line ${index + 1}`),
          category: String(line.category || (this.isTileLine(line) ? 'Tiles' : 'Product')),
          brand: String(line.brand || ''),
          finish: line.finish || line.tileSize || line.dimensions || null,
          area: line.area || line.room || line.section || null,
          unit: String(line.unit || line.uom || 'PC').toUpperCase(),
          quantity,
          listPrice,
          unitPrice,
          discountPercent,
          taxRate,
          taxableValue,
          taxAmount,
          grossLineTotal,
          lineTotal: grossLineTotal,
          status: 'quoted',
          isTileSpecial: this.isTileLine(line) && !String(line.productId || '').trim(),
          metadata: { snapshot: line },
          updatedAt: new Date(),
        },
      });
    }
  }

  private async syncSalesOrderLinesTx(tx: any, args: { quote: any; salesOrder: any; lines: any[] }) {
    await syncSalesOrderLinesForQuoteTx(tx, args.quote.id);
  }

  private async ensureSalesOrderDocumentsTx(tx: any, quote: any, salesOrder: any, actorUserId: string) {
    await this.upsertDocumentJobTx(tx, {
      entityType: 'Quote',
      entityId: quote.id,
      documentType: 'quote_pdf',
      url: `/api/pdf/quote/${quote.id}`,
      actorUserId,
      metadata: { quoteNumber: quote.quoteNumber },
    });
    await this.upsertDocumentJobTx(tx, {
      entityType: 'SalesOrder',
      entityId: salesOrder.id,
      documentType: 'sales_order_pdf',
      url: `/api/pdf/order/${salesOrder.id}`,
      actorUserId,
      metadata: { orderNumber: salesOrder.orderNumber, quoteNumber: quote.quoteNumber },
    });
  }

  private async upsertDocumentJobTx(tx: any, args: { entityType: string; entityId: string; documentType: string; url: string; actorUserId: string; metadata?: any }) {
    await tx.documentJob.upsert({
      where: { entityType_entityId_documentType: { entityType: args.entityType, entityId: args.entityId, documentType: args.documentType } },
      update: {
        status: 'generated_on_request',
        url: args.url,
        error: null,
        generatedBy: args.actorUserId,
        generatedAt: new Date(),
        updatedAt: new Date(),
        metadata: args.metadata || {},
      },
      create: {
        id: ulid(),
        entityType: args.entityType,
        entityId: args.entityId,
        documentType: args.documentType,
        status: 'generated_on_request',
        url: args.url,
        generatedBy: args.actorUserId,
        generatedAt: new Date(),
        updatedAt: new Date(),
        metadata: args.metadata || {},
      },
    });
  }

  private quoteLineKey(line: any, index: number) {
    const productId = String(line.productId || '').trim();
    const tileCode = String(line.tileCode || line.sku || '').trim();
    const area = String(line.area || line.room || line.section || '').trim();
    return productId ? `product:${productId}:${area || index}` : `tile:${tileCode || index}:${area || index}`;
  }

  private normalizeOrderSelections(value: any) {
    const parsed = typeof value === 'string'
      ? (() => { try { return JSON.parse(value); } catch { throw new BadRequestException('Selected order lines must be valid JSON'); } })()
      : value;
    if (parsed === undefined || parsed === null || parsed === '') return new Map<string, number>();
    if (!Array.isArray(parsed)) throw new BadRequestException('Selected order lines must be an array');
    const selections = new Map<string, number>();
    for (const item of parsed) {
      const key = String(item?.quoteLineId || item?.lineKey || '').trim();
      const quantity = Math.trunc(Number(item?.quantity ?? item?.qty ?? 0));
      if (!key) throw new BadRequestException('Every selected order line needs a quote line reference');
      if (!Number.isFinite(quantity) || quantity <= 0) throw new BadRequestException('Selected order quantities must be positive whole numbers');
      selections.set(key, (selections.get(key) || 0) + quantity);
    }
    return selections;
  }

  private selectOrderLines(quote: any, quoteLines: any[], selections: Map<string, number>) {
    const quoteLinesById = new Map(quoteLines.map((line: any) => [line.id, line]));
    const quoteLinesByKey = new Map(quoteLines.map((line: any) => [line.lineKey, line]));
    const rawByKey = new Map(this.normalizeLines(quote.lines).map((line: any, index: number) => [this.quoteLineKey(line, index), line]));
    const selectedRows: Array<{ quoteLine: any; quantity: number }> = [];
    const requested = selections.size
      ? Array.from(selections.entries()).map(([key, quantity]) => ({ key, quantity }))
      : quoteLines.map((line: any) => ({ key: line.id, quantity: Math.max(0, Number(line.quantity || 0) - Number(line.orderedQuantity || 0) - Number(line.cancelledQuantity || 0) - Number(line.closedQuantity || 0)) })).filter((item) => item.quantity > 0);

    for (const request of requested) {
      const quoteLine = quoteLinesById.get(request.key) || quoteLinesByKey.get(request.key);
      if (!quoteLine) throw new BadRequestException('A selected line no longer belongs to this quote. Refresh the quote and try again.');
      const remaining = Math.max(0, Number(quoteLine.quantity || 0) - Number(quoteLine.orderedQuantity || 0) - Number(quoteLine.cancelledQuantity || 0) - Number(quoteLine.closedQuantity || 0));
      if (request.quantity > remaining) {
        throw new BadRequestException(`${quoteLine.sku} has only ${remaining} remaining on this quote.`);
      }
      selectedRows.push({ quoteLine, quantity: request.quantity });
    }
    if (!selectedRows.length) throw new BadRequestException('This quote has no remaining quantity to order.');

    const lines = selectedRows.map(({ quoteLine, quantity }) => {
      const snapshot = (quoteLine.metadata as any)?.snapshot || rawByKey.get(quoteLine.lineKey) || {};
      return {
        ...snapshot,
        quoteLineId: quoteLine.id,
        lineKey: quoteLine.lineKey,
        productId: quoteLine.productId || undefined,
        sku: quoteLine.sku,
        name: quoteLine.name,
        category: quoteLine.category,
        brand: quoteLine.brand,
        finish: quoteLine.finish || undefined,
        area: quoteLine.area || 'General Selection',
        unit: quoteLine.unit,
        qty: quantity,
        quantity,
        price: Number(quoteLine.listPrice ?? quoteLine.unitPrice ?? 0),
        sellPrice: Number(quoteLine.listPrice ?? quoteLine.unitPrice ?? 0),
        listPrice: Number(quoteLine.listPrice ?? quoteLine.unitPrice ?? 0),
        specialRate: Number(quoteLine.unitPrice ?? 0),
        discountPercent: Number(quoteLine.discountPercent || 0),
        taxRate: Number(quoteLine.taxRate ?? 18),
        floorPrice: Number((quoteLine.metadata as any)?.snapshot?.floorPrice || 0),
        isTileSpecial: Boolean(quoteLine.isTileSpecial),
      };
    });
    return { items: selectedRows, lines };
  }

  async salesOrders(args?: { paymentMode?: string; range?: string; ownerId?: string }) {
    const where: any = {};
    if (args?.paymentMode) where.paymentMode = args.paymentMode.toLowerCase();
    if (args?.ownerId) where.ownerId = args.ownerId;
    const createdAt = this.rangeWhere(args?.range);
    if (createdAt) where.createdAt = createdAt;
    const orders = await this.prisma.salesOrder.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
    const customerIds = Array.from(new Set(orders.map((order) => order.customerId)));
    const ownerIds = Array.from(new Set(orders.map((order) => order.ownerId)));
    const [customers, owners] = await Promise.all([
      this.prisma.customer.findMany({ where: { id: { in: customerIds } } }),
      this.prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true, email: true, role: true, phone: true, active: true } }),
    ]);
    const customerMap = new Map(customers.map((customer) => [customer.id, customer]));
    const ownerMap = new Map(owners.map((owner) => [owner.id, owner]));
    return orders.map((order) => ({ ...order, customer: customerMap.get(order.customerId), owner: ownerMap.get(order.ownerId) }));
  }

  async salesOrderStats(args?: { range?: string }) {
    const createdAt = this.rangeWhere(args?.range);
    const where: any = createdAt ? { createdAt } : {};
    const orders = await this.prisma.salesOrder.findMany({ where });
    const cashOrders = orders.filter((order) => order.paymentMode === 'cash');
    const creditOrders = orders.filter((order) => order.paymentMode === 'credit');
    return {
      totalOrders: orders.length,
      totalValue: orders.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0),
      cashOrders: cashOrders.length,
      cashValue: cashOrders.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0),
      cashAdvance: cashOrders.reduce((sum, order) => sum + Number(order.advanceAmount || 0), 0),
      creditOrders: creditOrders.length,
      creditValue: creditOrders.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0),
    };
  }

  async quoteFulfillment(quoteId: string) {
    const [quote, lines, orders] = await Promise.all([
      this.findByIdWithRelations(quoteId),
      this.prisma.quoteLine.findMany({ where: { quoteId }, orderBy: { lineNo: 'asc' } }),
      this.prisma.salesOrder.findMany({ where: { quoteId }, orderBy: { createdAt: 'asc' } }),
    ]);
    return {
      quoteId: quote.id,
      quoteNumber: quote.quoteNumber,
      status: quote.status,
      lines: lines.map((line: any) => {
        const quantity = Number(line.quantity || 0);
        const ordered = Number(line.orderedQuantity || 0);
        const cancelled = Number(line.cancelledQuantity || 0);
        const closed = Number(line.closedQuantity || 0);
        return {
          id: line.id,
          lineKey: line.lineKey,
          sku: line.sku,
          name: line.name,
          area: line.area,
          quantity,
          ordered,
          cancelled,
          closed,
          remaining: Math.max(0, quantity - ordered - cancelled - closed),
          status: line.status,
          unitRate: Number(line.unitPrice || 0),
          grossLineTotal: Number(line.grossLineTotal || line.lineTotal || 0),
        };
      }),
      orders: orders.map((order: any) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        paymentMode: order.paymentMode,
        paymentStatus: order.paymentStatus,
        promisedDate: order.promisedDate,
        totalAmount: Number(order.totalAmount || 0),
        lines: order.lines,
      })),
    };
  }

  async closeQuoteRemainder(quoteId: string, actorUserId: string, reason: string) {
    const note = String(reason || '').trim();
    if (!note) throw new BadRequestException('A reason is required when closing remaining quote quantity.');
    return this.prisma.$transaction(async (tx) => {
      const quote = await tx.quote.findUnique({ where: { id: quoteId } });
      if (!quote) throw new NotFoundException('Quote not found');
      const lines = await tx.quoteLine.findMany({ where: { quoteId } });
      for (const line of lines as any[]) {
        const remaining = Math.max(0, Number(line.quantity || 0) - Number(line.orderedQuantity || 0) - Number(line.cancelledQuantity || 0) - Number(line.closedQuantity || 0));
        if (!remaining) continue;
        await tx.quoteLine.update({
          where: { id: line.id },
          data: { closedQuantity: { increment: remaining }, status: 'closed', updatedAt: new Date() },
        });
      }
      const updated = await tx.quote.update({
        where: { id: quoteId },
        data: { status: 'closed', updatedAt: new Date(), approval: { ...(quote.approval as any || {}), remainderClosedAt: new Date().toISOString(), remainderClosedBy: actorUserId, remainderCloseReason: note } },
        include: quoteInclude,
      } as any) as any;
      await tx.auditEvent.create({
        data: { id: ulid(), actorUserId, action: 'quote.remainder.close', entityType: 'Quote', entityId: quoteId, summary: `Closed remaining quantity on ${quote.quoteNumber}`, metadata: { reason: note } },
      }).catch(() => null);
      return updated;
    });
  }

  async approveQuote(id: string, approvedByUserId: string, note?: string) {
    const quote = await this.findById(id);
    const approved = await this.prisma.quote.update({
      where: { id },
      data: {
        approvalStatus: 'approved',
        status: quote.status === 'pending_approval' ? 'approved' : quote.status,
        approval: {
          approvedByUserId,
          approvedAt: new Date().toISOString(),
          note: note || '',
          previousStatus: quote.status,
          displayMode: quote.displayMode,
        },
        updatedAt: new Date(),
      },
      include: quoteInclude,
    } as any) as any;
    await this.audit(approvedByUserId, 'quote.approve', id, `Approved ${approved.quoteNumber}`, { note });
    await this.notifications.create({
      title: 'Quote approved',
      message: `${approved.quoteNumber} is approved. Sales can send PDF and office can convert to sales order after confirmation.`,
      type: 'quote_approved',
      entityType: 'Quote',
      entityId: approved.id,
      href: `/dashboard/quotes/${approved.id}`,
      targetUserId: approved.ownerId,
      metadata: { pdfUrl: `/api/pdf/quote/${approved.id}` },
    });
    return approved;
  }

  async createVersion(id: string): Promise<any> {
    const quote = await this.findById(id);
    const versions = (quote.versions || []) as any[];
    
    const newVersion = {
      version: versions.length + 1,
      lines: quote.lines,
      discountPercent: quote.discountPercent,
      displayMode: quote.displayMode,
      quoteMeta: quote.quoteMeta,
      createdAt: new Date().toISOString(),
    };
    
    return this.prisma.quote.update({
      where: { id },
      data: { versions: [...versions, newVersion] },
      include: quoteInclude,
    } as any) as any;
  }

  async delete(id: string) {
    await this.findById(id);
    const orders = await this.prisma.salesOrder.count({ where: { quoteId: id } });
    if (orders > 0) throw new BadRequestException('A quote with sales orders is an audit record and cannot be deleted. Close any remaining quantity instead.');
    // Release reservations and remove dependent rows in one tx so we never
    // leave orphan reservations / activities pointing at a deleted quote.
    return this.prisma.$transaction(async (tx) => {
      await this.releaseReservationsTx(tx, id, 'Quote deleted');
      await tx.reservation.deleteMany({ where: { quoteId: id, salesOrderId: null } });
      await tx.activity.deleteMany({ where: { quoteId: id } });
      await tx.leadIntent.updateMany({ where: { quoteId: id }, data: { quoteId: null, status: 'pending_quote', updatedAt: new Date() } }).catch(() => null);
      return tx.quote.delete({ where: { id } });
    }, { timeout: 15000 });
  }

  private async generateQuoteNumber(): Promise<string> {
    return nextDocumentNumber(this.prisma as any, 'quote', 'QT', new Date(), {
      existingNumbers: async (prefixForYear) => (await this.prisma.quote.findMany({
        where: { quoteNumber: { startsWith: prefixForYear } },
        select: { quoteNumber: true },
      })).map((row) => row.quoteNumber),
    });
  }

  private defaultValidUntil(): Date {
    const date = new Date();
    date.setDate(date.getDate() + 30);
    return date;
  }

  private normalizeLines(lines: any) {
    if (!lines) return [];
    if (typeof lines === 'string') {
      try {
        return JSON.parse(lines);
      } catch {
        return [];
      }
    }
    return Array.isArray(lines) ? lines.map((line) => ({
      ...line,
      area: String(line.area || line.room || line.section || 'General Selection').trim() || 'General Selection',
      quoteImage: line.quoteImage || line.customImageUrl || '',
    })) : [];
  }

  private isTileLine(line: any) {
    return line?.type === 'tile' || line?.nonStock === true || String(line?.category || '').toLowerCase() === 'tiles';
  }

  private normalizeTileLine(line: any, index: number) {
    const tileCode = String(line.tileCode || line.sku || '').trim();
    const tileSize = String(line.tileSize || line.size || line.dimensions || '').trim();
    const coveragePerPack = Number(line.coveragePerPack || 0);
    const piecesPerPack = Math.max(1, Math.trunc(Number(line.piecesPerPack || line.pcsPerBox || 1)));
    const pricingUom = String(line.pricingUom || line.salesUom || line.unit || 'BOX').trim().toUpperCase();
    const areaPriced = ['SQFT', 'SQM', 'M2'].includes(pricingUom);
    const requestedArea = Number(line.requestedArea || 0);
    const wastagePercent = Number(line.wastagePercent || 0);
    if (!Number.isFinite(wastagePercent) || wastagePercent < 0 || wastagePercent > 100) throw new BadRequestException(`Tile ${tileCode || index + 1} wastage must be between 0 and 100`);
    if (areaPriced && coveragePerPack <= 0) throw new BadRequestException(`Tile ${tileCode || index + 1} needs coverage per pack in Product Master`);
    const areaWithWastage = requestedArea > 0 ? requestedArea * (1 + wastagePercent / 100) : 0;
    const calculatedPacks = areaWithWastage > 0 ? Math.ceil(areaWithWastage / coveragePerPack) : 0;
    const qty = calculatedPacks || Math.trunc(Number(line.qty || line.quantity || 0));
    const inventoryUom = String(line.inventoryUom || line.purchaseUom || line.unit || 'BOX').trim().toUpperCase();
    if (!tileCode) throw new BadRequestException(`Tile row ${index + 1} needs a tile code`);
    if (!tileSize) throw new BadRequestException(`Tile ${tileCode} needs a tile size`);
    if (!Number.isFinite(qty) || qty <= 0) throw new BadRequestException(`Tile ${tileCode} needs a positive whole-number quantity`);
    const listPrice = Number(line.listPrice ?? line.price ?? line.sellPrice ?? 0);
    if (!Number.isFinite(listPrice) || listPrice < 0) throw new BadRequestException(`Tile ${tileCode} has an invalid price`);
    const specialRate = line.specialRate ?? line.specialPrice;
    if (specialRate !== undefined && specialRate !== null && specialRate !== '' && (!Number.isFinite(Number(specialRate)) || Number(specialRate) < 0)) {
      throw new BadRequestException(`Tile ${tileCode} has an invalid negotiated rate`);
    }
    return {
      ...line,
      type: 'tile',
      category: 'Tiles',
      productId: String(line.productId || '').trim(),
      sku: tileCode,
      name: String(line.name || `Tile ${tileCode} ${tileSize}`).trim(),
      tileCode,
      tileSize,
      dimensions: tileSize,
      uom: inventoryUom.toLowerCase(),
      unit: inventoryUom,
      inventoryUom,
      pricingUom,
      rateBasis: areaPriced ? 'AREA' : pricingUom === 'PC' && inventoryUom !== 'PC' ? 'PIECE' : 'PACK',
      piecesPerPack,
      pcsPerBox: piecesPerPack,
      coveragePerPack,
      requestedArea: requestedArea > 0 ? requestedArea : null,
      wastagePercent,
      requiredArea: areaWithWastage || null,
      calculatedPacks: qty,
      coveredArea: coveragePerPack > 0 ? Number((qty * coveragePerPack).toFixed(4)) : null,
      qty,
      quantity: qty,
      price: listPrice,
      sellPrice: listPrice,
      listPrice,
      specialRate: specialRate === undefined || specialRate === null || specialRate === '' ? null : Number(specialRate),
      discountPercent: Number(line.discountPercent ?? line.discount ?? 0),
      taxRate: Number(line.taxRate ?? 18),
      area: String(line.area || line.room || line.section || 'General Selection').trim() || 'General Selection',
      quoteImage: line.quoteImage || line.customImageUrl || '',
      source: 'product-master-tile',
      inventoryTracked: true,
      nonStock: false,
    };
  }

  private async assertQuoteLines(linesInput: any, action: string) {
    const lines = this.normalizeLines(linesInput);
    if (!lines.length) {
      throw new BadRequestException(`At least one Product Master SKU or tile row is required before ${action}`);
    }

    const productLines = lines;
    const missingProduct = productLines.find((line: any) => !String(line.productId || '').trim());
    if (missingProduct) {
        throw new BadRequestException(`Every quote row, including tile designs, must be selected from Product Master before ${action}`);
    }

    const productIds: string[] = Array.from(new Set(productLines.map((line: any) => String(line.productId || '').trim()).filter(Boolean) as string[]));
    const products = productIds.length
      ? await this.prisma.product.findMany({ where: { id: { in: productIds } } })
      : [];
    const productMap = new Map(products.map((product) => [product.id, product]));

    return lines.map((line: any, index: number) => {
      const productId = String(line.productId || '').trim();
      const product = productMap.get(productId) as any;
      if (!product || product.status !== 'active') {
        throw new BadRequestException(`${line.name || line.sku || `Line ${index + 1}`} is not an active Product Master SKU`);
      }
      if (this.isTileLine(line) || String(product.category || '').toLowerCase() === 'tiles') {
        return this.normalizeTileLine({
          ...line, productId: product.id, sku: product.sku, name: product.name, brand: product.brand,
          tileSize: line.tileSize || product.dimensions, dimensions: product.dimensions,
          listPrice: Number(product.sellPrice || 0), sellPrice: Number(product.sellPrice || 0),
          floorPrice: Number(product.floorPrice || 0), media: line.media || product.media || {},
          inventoryUom: product.purchaseUom || product.unit, pricingUom: product.salesUom || product.unit,
          piecesPerPack: product.piecesPerPack, coveragePerPack: product.coveragePerPack,
        }, index);
      }
      const qty = Math.trunc(Number(line.qty || line.quantity || 0));
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new BadRequestException(`${product.sku} needs a positive whole-number quantity`);
      }
      const listPrice = Number(product.sellPrice || 0);
      const suppliedSpecial = line.specialRate ?? line.specialPrice;
      const legacyRate = Number(line.price ?? line.sellPrice);
      const specialRate = suppliedSpecial !== undefined && suppliedSpecial !== null && suppliedSpecial !== ''
        ? Number(suppliedSpecial)
        : Number.isFinite(legacyRate) && legacyRate !== listPrice ? legacyRate : null;
      if (!Number.isFinite(listPrice) || listPrice < 0 || (specialRate !== null && (!Number.isFinite(specialRate) || specialRate < 0))) {
        throw new BadRequestException(`${product.sku} has an invalid price`);
      }
      const media = line.media || product.media || {};
      return {
        ...line,
        productId: product.id,
        sku: product.sku,
        name: product.name,
        category: product.category,
        brand: product.brand,
        finish: product.finish,
        dimensions: product.dimensions,
        unit: product.unit,
        qty,
        quantity: qty,
        price: listPrice,
        sellPrice: listPrice,
        listPrice,
        specialRate,
        discountPercent: Number(line.discountPercent ?? line.discount ?? 0),
        taxRate: Number(line.taxRate ?? 18),
        floorPrice: Number(product.floorPrice || 0),
        media,
        area: String(line.area || line.room || line.section || 'General Selection').trim() || 'General Selection',
        quoteImage: line.quoteImage || line.customImageUrl || '',
        source: 'product-master',
        inventoryTracked: true,
        nonStock: false,
      };
    });
  }

  private normalizeDisplayMode(value?: string) {
    return String(value || '').toLowerCase() === 'selection' ? 'selection' : 'priced';
  }

  private normalizeQuoteMeta(meta: any, lines: any[]) {
    const parsed = typeof meta === 'string'
      ? (() => { try { return JSON.parse(meta); } catch { return {}; } })()
      : (meta || {});
    const areas = Array.from(new Set(this.normalizeLines(lines).map((line: any) => String(line.area || 'General Selection'))));
    return {
      preparedBy: parsed.preparedBy || '',
      showBrandLogos: parsed.showBrandLogos !== false,
      terms: parsed.terms || 'Prices are valid until the quote validity date. Delivery depends on stock availability. Installation, civil work and unloading are excluded unless mentioned.',
      bankDetails: parsed.bankDetails || 'Bank details will be shared by Marble Park accounts team at order confirmation.',
      remarks: parsed.remarks || '',
      areas,
      ...parsed,
    };
  }

  private getLinesTotal(lines: any, quoteDiscountPercent = 0) {
    return priceQuoteLines(this.normalizeLines(lines), quoteDiscountPercent).totals.grandTotal;
  }

  private async createReservationsForSalesOrder(tx: any, args: { quote: any; salesOrder: any; lines: any[]; salesOrderLines: any[] }) {
    const { quote, salesOrder, lines, salesOrderLines } = args;
    const existing = await tx.reservation.count({ where: { salesOrderId: salesOrder.id } });
    if (existing > 0) return;

    for (const line of this.normalizeLines(lines)) {
      const productId = line.productId;
      const quantity = Number(line.qty || line.quantity || 0);
      if (!productId || quantity <= 0) continue;
      const salesOrderLine = salesOrderLines.find((row: any) => row.quoteLineId === line.quoteLineId || row.lineKey === line.lineKey);

      const lotAvailability = await tx.inventoryLotBalance.aggregate({
        where: { lot: { productId, status: 'active' } }, _sum: { available: true },
      });
      const available = Math.max(0, Number(lotAvailability._sum.available || 0));
      const reserveQty = Math.min(quantity, available);
      const backorderQty = Math.max(0, quantity - reserveQty);

      if (reserveQty > 0) {
        const reservation = await tx.reservation.create({
          data: {
            id: ulid(),
            quoteId: quote.id,
            salesOrderId: salesOrder.id,
            salesOrderLineId: salesOrderLine?.id || null,
            productId,
            quantity: reserveQty,
            status: 'reserved',
            updatedAt: new Date(),
          },
        });
        const allocations = await reserveAvailableLotsTx(tx, {
          reservationId: reservation.id, salesOrderLineId: salesOrderLine?.id,
          productId, quantity: reserveQty, actorUserId: quote.ownerId, quoteId: quote.id,
          orderNumber: salesOrder.orderNumber,
        });
        const locations = Array.from(new Set(allocations.map((row: any) => row.locationId)));
        await tx.reservation.update({
          where: { id: reservation.id }, data: { locationId: locations.length === 1 ? locations[0] : null, updatedAt: new Date() },
        });
      }

      if (backorderQty > 0) {
        await tx.reservation.create({
          data: {
            id: ulid(),
            quoteId: quote.id,
            salesOrderId: salesOrder.id,
            salesOrderLineId: salesOrderLine?.id || null,
            productId,
            quantity: backorderQty,
            status: 'backordered',
            updatedAt: new Date(),
          },
        });
      }
    }
  }

  private async createPurchaseDemandForSalesOrderTx(tx: any, args: { quote: any; salesOrder: any; lines: any[] }) {
    const { quote, salesOrder } = args;
    const backorders = await tx.reservation.findMany({
      where: { salesOrderId: salesOrder.id, status: 'backordered' },
      orderBy: { createdAt: 'asc' },
    });
    const productIds = Array.from(new Set(backorders.map((reservation: any) => reservation.productId).filter(Boolean)));
    const products = productIds.length ? await tx.product.findMany({ where: { id: { in: productIds } } }) : [];
    const productMap = new Map(products.map((product: any) => [product.id, product]));
    const rows: any[] = [];

    for (const reservation of backorders) {
      const product = productMap.get(reservation.productId) as any;
      if (!product) continue;
      rows.push({
        id: ulid(),
        sourceType: 'backorder_reservation',
        sourceLineKey: `reservation:${reservation.id}`,
        sourceOrderId: salesOrder.id,
        sourceQuoteId: quote.id,
        sourceReservationId: reservation.id,
        customerId: quote.customerId,
        ownerId: quote.ownerId,
        productId: product.id,
        sku: product.sku,
        name: product.name,
        category: product.category,
        brand: product.brand,
        finish: product.finish,
        unit: product.unit || 'PC',
        quantity: Number(reservation.quantity || 0),
        status: 'open',
        vendorName: product.brand || null,
        notes: `${salesOrder.orderNumber} shortage for ${quote.quoteNumber}`,
        metadata: {
          orderNumber: salesOrder.orderNumber,
          quoteNumber: quote.quoteNumber,
          source: 'sales_order_conversion',
        },
        updatedAt: new Date(),
      });
    }

    if (!rows.length) return;
    await tx.purchaseDemand.createMany({ data: rows, skipDuplicates: true });
  }

  private tileDemandKey(orderId: string, line: any, index: number) {
    return `tile:${orderId}:${String(line.tileCode || line.sku || index).trim()}:${index}`;
  }

  private async releaseReservationsTx(tx: any, quoteId: string, reason: string) {
    const reservations = await tx.reservation.findMany({ where: { quoteId, salesOrderId: null, status: 'reserved' } });
    for (const reservation of reservations) {
      const balance = await tx.inventoryBalance.findUnique({ where: { productId: reservation.productId } });
      if (balance) {
        const allocations = await tx.lotReservation.count({ where: { reservationId: reservation.id, status: 'reserved' } });
        if (allocations > 0) {
          await releaseReservedLotsTx(tx, { reservation, reason, actorUserId: 'system' });
        } else {
          await applyStockPostingTx(tx, {
            productId: reservation.productId, type: 'release', movementType: 'release', ledgerType: 'release',
            quantity: Number(reservation.quantity || 0), reservedDelta: -Number(reservation.quantity || 0),
            locationReservedDelta: -Number(reservation.quantity || 0), requireReserved: true, reason,
            relatedQuoteId: quoteId, referenceType: 'Reservation', referenceId: reservation.id,
            createdBy: 'system', metadata: { source: 'legacy_quote_release' },
          });
        }
      }
      await tx.reservation.update({
        where: { id: reservation.id },
        data: { status: 'released', updatedAt: new Date() },
      });
    }
    await syncSalesOrderLinesForQuoteTx(tx, quoteId);
  }

  private async getAvailabilityIssues(lines: any[]) {
    const issues: any[] = [];
    for (const line of this.normalizeLines(lines)) {
      const productId = line.productId;
      const quantity = Number(line.qty || line.quantity || 0);
      if (!productId || quantity <= 0) continue;
      const balance = await this.prisma.inventoryBalance.findUnique({ where: { productId } });
      const available = Number(balance?.available || 0);
      if (available < quantity) {
        issues.push({
          productId,
          sku: line.sku,
          name: line.name,
          requested: quantity,
          available,
          shortage: quantity - available,
          approvalReason: 'availability_shortage',
        });
      }
    }
    return issues;
  }

  private async releaseReservations(quoteId: string, reason: string) {
    await this.prisma.$transaction(async (tx) => {
      await this.releaseReservationsTx(tx, quoteId, reason);
    }, { timeout: 15000 });
  }

  private rangeWhere(range?: string) {
    if (!range || range === 'all') return null;
    const now = new Date();
    const from = new Date(now);
    if (range === 'today') from.setHours(0, 0, 0, 0);
    else if (range === 'week') from.setDate(now.getDate() - 7);
    else if (range === 'month') from.setDate(now.getDate() - 30);
    else return null;
    return { gte: from };
  }

  private async audit(actorUserId: string, action: string, entityId: string, summary: string, metadata: any) {
    await this.prisma.auditEvent.create({
      data: {
        id: ulid(),
        actorUserId,
        action,
        entityType: 'Quote',
        entityId,
        summary,
        metadata,
      },
    }).catch(() => {});
  }
}
