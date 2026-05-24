import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { nextDocumentNumber } from '../common/sequence';
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
}

const QUOTE_STATUSES = ['draft', 'pending_approval', 'approved', 'sent', 'customer_followup', 'confirmed', 'won', 'lost', 'expired'];

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

    const normalizedLines = await this.assertQuoteLines(data.lines, 'creating a quote');
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
                expectedValue: this.getLinesTotal(normalizedLines),
                lastContactAt: new Date(),
                nextActionAt: new Date(Date.now() + 86400000 * 2),
                notes: 'Auto-created from quote builder.',
                updatedAt: new Date(),
              },
            });
            leadId = lead.id;
          }

          const quote = await tx.quote.create({
            data: {
              id: ulid(),
              ...data,
              customerId,
              ownerId,
              leadId,
              lines: normalizedLines,
              quoteNumber,
              status: 'draft',
              approvalStatus: 'approved',
              discountPercent: data.discountPercent || 0,
              displayMode,
              projectName: data.projectName || '',
              title: data.title || 'Retail quotation',
              validUntil: data.validUntil || this.defaultValidUntil(),
              coverImage: '',
              notes: data.notes || '',
              versions: [],
              quoteMeta,
              approval: {
                requestedAt: new Date().toISOString(),
                reason: 'quote_ready_no_owner_approval_required',
                availabilityIssues,
                discountPercent: data.discountPercent || 0,
                total: this.getLinesTotal(normalizedLines),
                displayMode,
                autoApprovedAt: new Date().toISOString(),
              },
              updatedAt: new Date(),
            },
            include: quoteInclude,
          } as any) as any;
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
    await this.findById(id);
    
    const updateData: any = { ...data };
    if (data.discountPercent !== undefined || data.lines !== undefined) {
      const current = await this.findById(id);
      const lines = data.lines !== undefined ? await this.assertQuoteLines(data.lines, 'updating a quote') : await this.assertQuoteLines(current.lines, 'updating a quote');
      updateData.lines = data.lines !== undefined ? lines : undefined;
      updateData.quoteMeta = data.quoteMeta !== undefined ? this.normalizeQuoteMeta(data.quoteMeta, lines) : undefined;
      updateData.approvalStatus = 'approved';
      updateData.status = 'draft';
      updateData.approval = {
        requestedAt: new Date().toISOString(),
        reason: 'quote_changed_no_owner_reapproval_required',
        availabilityIssues: await this.getAvailabilityIssues(lines),
        discountPercent: data.discountPercent,
        total: this.getLinesTotal(lines),
        autoApprovedAt: new Date().toISOString(),
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
      if (['lost', 'expired'].includes(status)) {
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
    const existingOrder = await (this.prisma as any).salesOrder.findUnique({ where: { quoteId: id } }).catch(() => null);
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
    // Same as confirmQuote: needs `customer.siteAddress`.
    const quote = await this.findByIdWithRelations(input.quoteId);
    const paymentMode = String(input.paymentMode || '').toLowerCase() === 'credit' ? 'credit' : 'cash';
    const lines = await this.assertQuoteLines(quote.lines, 'creating a sales order');
    const totalAmount = this.getLinesTotal(lines);
    const advanceAmount = paymentMode === 'cash' ? Number(input.advanceAmount || 0) : 0;
    const paymentStatus = paymentMode === 'credit' ? 'credit' : advanceAmount >= totalAmount ? 'paid' : advanceAmount > 0 ? 'advance' : 'pending_cash';

    return this.prisma.$transaction(async (tx) => {
      const existingOrder = await tx.salesOrder.findUnique({ where: { quoteId: quote.id } }).catch(() => null);
      if (existingOrder) {
        await this.syncSalesOrderLinesTx(tx, { quote, salesOrder: existingOrder, lines });
        await this.ensureSalesOrderDocumentsTx(tx, quote, existingOrder, actorUserId);
        await this.createPurchaseDemandForSalesOrderTx(tx, { quote, salesOrder: existingOrder, lines });
        return existingOrder;
      }

      const existingReservations = await tx.reservation.count({ where: { quoteId: quote.id } });
      if (!existingReservations) await this.createReservationsForQuote(tx, { ...quote, lines });

      const existingJob = await tx.dispatchJob.findUnique({ where: { quoteId: quote.id } });
      if (!existingJob) {
        await tx.dispatchJob.create({
          data: {
            id: ulid(),
            quoteId: quote.id,
            customerId: quote.customerId,
            siteAddress: quote.customer?.siteAddress || '',
            status: 'pending',
            dueDate: new Date(Date.now() + 86400000),
            ownerId: quote.ownerId,
            updatedAt: new Date(),
          },
        });
      }

      const salesOrderId = ulid();
      const orderNumber = await nextDocumentNumber(tx as any, 'sales_order', 'SO', new Date(), {
        existingNumbers: async (prefixForYear) => (await tx.salesOrder.findMany({
          where: { orderNumber: { startsWith: prefixForYear } },
          select: { orderNumber: true },
        })).map((row: any) => row.orderNumber),
      });
      const salesOrder = await tx.salesOrder.create({
        data: {
          id: salesOrderId,
          orderNumber,
          quoteId: quote.id,
          leadId: quote.leadId,
          customerId: quote.customerId,
          ownerId: quote.ownerId,
          status: 'open',
          paymentMode,
          paymentStatus,
          advanceAmount,
          totalAmount,
          lines,
          notes: input.notes || '',
          documents: {
            quotePdfUrl: `/api/pdf/quote/${quote.id}`,
            salesOrderPdfUrl: `/api/pdf/order/${salesOrderId}`,
            quotePdf: { url: `/api/pdf/quote/${quote.id}`, status: 'generated_on_request', checkedAt: new Date().toISOString() },
            salesOrderPdf: { url: `/api/pdf/order/${salesOrderId}`, status: 'generated_on_request', checkedAt: new Date().toISOString() },
            generatedAt: new Date().toISOString(),
            forwardingUse: 'Send sales-order PDF to customer and use it for dispatch marking.',
          },
          updatedAt: new Date(),
        },
      });
      await this.syncSalesOrderLinesTx(tx, { quote, salesOrder, lines });
      await this.ensureSalesOrderDocumentsTx(tx, quote, salesOrder, actorUserId);
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
            metadata: { orderNumber, paymentStatus },
          },
        });
      }

      await tx.quote.update({
        where: { id: quote.id },
        data: { status: 'confirmed', confirmedAt: quote.confirmedAt || new Date(), updatedAt: new Date() },
      });
      await tx.lead.update({
        where: { id: quote.leadId },
        data: { stage: 'won', updatedAt: new Date(), lastContactAt: new Date() },
      }).catch(() => null);
      await tx.leadIntent.updateMany({
        where: { quoteId: quote.id },
        data: { status: 'converted', salesOrderId: salesOrder.id, updatedAt: new Date() },
      }).catch(() => null);
      await this.createPurchaseDemandForSalesOrderTx(tx, { quote, salesOrder, lines });
      await tx.activity.create({
        data: {
          id: ulid(),
          leadId: quote.leadId,
          quoteId: quote.id,
          userId: actorUserId,
          type: 'sales_order_created',
          message: `${salesOrder.orderNumber} created as ${paymentMode.toUpperCase()} order (${paymentStatus}).`,
        },
      }).catch(() => null);
      await tx.notification.createMany({
        data: [
          {
            id: ulid(),
            title: 'Sales order created',
            message: `${salesOrder.orderNumber} created from ${quote.quoteNumber}. Payment: ${paymentMode.toUpperCase()} ${paymentStatus}.`,
            type: 'sales_order_created',
            entityType: 'SalesOrder',
            entityId: salesOrder.id,
            href: '/dashboard/orders',
            targetRole: 'owner',
            metadata: { quoteId: quote.id, paymentMode, paymentStatus, totalAmount, salesOrderPdfUrl: `/api/pdf/order/${salesOrder.id}` },
          },
          {
            id: ulid(),
            title: 'Sales order ready for dispatch',
            message: `${salesOrder.orderNumber} is ready. Dispatch only in-stock rows; backorders remain blocked until inward.`,
            type: 'dispatch_ready',
            entityType: 'SalesOrder',
            entityId: salesOrder.id,
            href: '/dashboard/dispatch',
            targetRole: 'dispatch_ops',
            metadata: { quoteId: quote.id, salesOrderPdfUrl: `/api/pdf/order/${salesOrder.id}` },
          },
          {
            id: ulid(),
            title: 'Customer order confirmed',
            message: `${salesOrder.orderNumber} is live. Track stocked and pending inward items from this lead.`,
            type: 'sales_order_created',
            entityType: 'SalesOrder',
            entityId: salesOrder.id,
            href: `/dashboard/leads/${quote.leadId}`,
            targetUserId: quote.ownerId,
            metadata: { quoteId: quote.id, salesOrderPdfUrl: `/api/pdf/order/${salesOrder.id}` },
          },
        ],
      }).catch(() => null);
      return salesOrder;
    });
  }

  private async syncQuoteLinesTx(tx: any, quote: any, lines: any[]) {
    for (const [index, line] of this.normalizeLines(lines).entries()) {
      const key = this.quoteLineKey(line, index);
      const quantity = Math.trunc(Number(line.qty || line.quantity || 0));
      const unitPrice = Number(line.price || line.sellPrice || 0);
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
          unitPrice,
          lineTotal: quantity * unitPrice,
          status: 'quoted',
          isTileSpecial: this.isTileLine(line) && !String(line.productId || '').trim(),
          metadata: { snapshot: line },
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
          unitPrice,
          lineTotal: quantity * unitPrice,
          status: 'quoted',
          isTileSpecial: this.isTileLine(line) && !String(line.productId || '').trim(),
          metadata: { snapshot: line },
          updatedAt: new Date(),
        },
      });
    }
  }

  private async syncSalesOrderLinesTx(tx: any, args: { quote: any; salesOrder: any; lines: any[] }) {
    const lines = this.normalizeLines(args.salesOrder.lines || args.lines);
    const reservations = await tx.reservation.findMany({ where: { quoteId: args.quote.id } });
    const reservedByProduct = new Map<string, number>();
    const backorderedByProduct = new Map<string, number>();
    for (const reservation of reservations) {
      const target = reservation.status === 'reserved' ? reservedByProduct : reservation.status === 'backordered' ? backorderedByProduct : null;
      if (!target) continue;
      target.set(reservation.productId, (target.get(reservation.productId) || 0) + Number(reservation.quantity || 0));
    }
    const quoteLines = await tx.quoteLine.findMany({ where: { quoteId: args.quote.id } }).catch(() => []);
    const quoteLineMap = new Map((quoteLines as any[]).map((row) => [row.lineKey, row]));

    for (const [index, line] of lines.entries()) {
      const productId = String(line.productId || '').trim();
      const quoteLineKey = this.quoteLineKey(line, index);
      const key = productId ? quoteLineKey : this.tileDemandKey(args.salesOrder.id, line, index);
      const quantity = Math.trunc(Number(line.qty || line.quantity || 0));
      const unitPrice = Number(line.price || line.sellPrice || 0);
      const reservedQuantity = productId ? Number(reservedByProduct.get(productId) || 0) : 0;
      const backorderedQuantity = productId ? Number(backorderedByProduct.get(productId) || 0) : quantity;
      const existing = await tx.salesOrderLine.findUnique({
        where: { salesOrderId_lineKey: { salesOrderId: args.salesOrder.id, lineKey: key } },
      }).catch(() => null);
      const deliveredQuantity = Number(existing?.deliveredQuantity || 0);
      const dispatchedQuantity = Number(existing?.dispatchedQuantity || 0);
      const status = deliveredQuantity >= quantity
        ? 'delivered'
        : dispatchedQuantity > 0
          ? 'partial_dispatched'
          : reservedQuantity > 0 && backorderedQuantity > 0
            ? 'partial_ready'
            : backorderedQuantity > 0
              ? 'pending_inward'
              : 'ready';
      const payload = {
        quoteLineId: (quoteLineMap.get(quoteLineKey) as any)?.id || null,
        lineNo: index + 1,
        productId: productId || null,
        sku: String(line.sku || line.tileCode || productId || `LINE-${index + 1}`),
        name: String(line.name || line.description || line.sku || `Line ${index + 1}`),
        category: String(line.category || (this.isTileLine(line) ? 'Tiles' : 'Product')),
        brand: String(line.brand || ''),
        finish: line.finish || line.tileSize || line.dimensions || null,
        area: line.area || line.room || line.section || null,
        unit: String(line.unit || line.uom || 'PC').toUpperCase(),
        orderedQuantity: quantity,
        reservedQuantity,
        backorderedQuantity,
        unitPrice,
        lineTotal: quantity * unitPrice,
        status,
        isTileSpecial: this.isTileLine(line) && !productId,
        metadata: { snapshot: line },
        updatedAt: new Date(),
      };
      await tx.salesOrderLine.upsert({
        where: { salesOrderId_lineKey: { salesOrderId: args.salesOrder.id, lineKey: key } },
        update: payload,
        create: {
          id: ulid(),
          salesOrderId: args.salesOrder.id,
          quoteId: args.quote.id,
          lineKey: key,
          createdAt: new Date(),
          ...payload,
        },
      });
    }
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
    // Release reservations and remove dependent rows in one tx so we never
    // leave orphan reservations / activities pointing at a deleted quote.
    return this.prisma.$transaction(async (tx) => {
      await this.releaseReservationsTx(tx, id, 'Quote deleted');
      await tx.reservation.deleteMany({ where: { quoteId: id } });
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
    const qty = Math.trunc(Number(line.qty || line.quantity || 0));
    const uom = String(line.uom || line.unit || 'box').toLowerCase() === 'pc' ? 'pc' : 'box';
    if (!tileCode) throw new BadRequestException(`Tile row ${index + 1} needs a tile code`);
    if (!tileSize) throw new BadRequestException(`Tile ${tileCode} needs a tile size`);
    if (!Number.isFinite(qty) || qty <= 0) throw new BadRequestException(`Tile ${tileCode} needs a positive whole-number quantity`);
    const price = Number(line.price || line.sellPrice || 0);
    if (!Number.isFinite(price) || price < 0) throw new BadRequestException(`Tile ${tileCode} has an invalid price`);
    return {
      ...line,
      type: 'tile',
      category: 'Tiles',
      productId: undefined,
      sku: tileCode,
      name: String(line.name || `Tile ${tileCode} ${tileSize}`).trim(),
      tileCode,
      tileSize,
      dimensions: tileSize,
      uom,
      unit: uom === 'box' ? 'BOX' : 'PC',
      pcsPerBox: Number(line.pcsPerBox || 0),
      qty,
      quantity: qty,
      price,
      sellPrice: price,
      area: String(line.area || line.room || line.section || 'General Selection').trim() || 'General Selection',
      quoteImage: line.quoteImage || line.customImageUrl || '',
      source: 'tile-intent',
      inventoryTracked: false,
      nonStock: true,
    };
  }

  private async assertQuoteLines(linesInput: any, action: string) {
    const lines = this.normalizeLines(linesInput);
    if (!lines.length) {
      throw new BadRequestException(`At least one Product Master SKU or tile row is required before ${action}`);
    }

    const productLines = lines.filter((line: any) => !this.isTileLine(line));
    const missingProduct = productLines.find((line: any) => !String(line.productId || '').trim());
    if (missingProduct) {
      throw new BadRequestException(`Every non-tile quote row must be selected from Product Master before ${action}`);
    }

    const productIds: string[] = Array.from(new Set(productLines.map((line: any) => String(line.productId || '').trim()).filter(Boolean) as string[]));
    const products = productIds.length
      ? await this.prisma.product.findMany({ where: { id: { in: productIds } } })
      : [];
    const productMap = new Map(products.map((product) => [product.id, product]));

    return lines.map((line: any, index: number) => {
      if (this.isTileLine(line)) return this.normalizeTileLine(line, index);
      const productId = String(line.productId || '').trim();
      const product = productMap.get(productId) as any;
      if (!product || product.status !== 'active') {
        throw new BadRequestException(`${line.name || line.sku || `Line ${index + 1}`} is not an active Product Master SKU`);
      }
      const qty = Math.trunc(Number(line.qty || line.quantity || 0));
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new BadRequestException(`${product.sku} needs a positive whole-number quantity`);
      }
      const price = Number(line.price || line.sellPrice || product.sellPrice || 0);
      if (!Number.isFinite(price) || price < 0) {
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
        price,
        sellPrice: price,
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

  private getLinesTotal(lines: any) {
    return this.normalizeLines(lines).reduce((sum: number, line: any) => {
      const qty = Number(line.qty || line.quantity || 0);
      const price = Number(line.price || line.sellPrice || 0);
      return sum + qty * price;
    }, 0);
  }

  private async createReservationsForQuote(tx: any, quote: any) {
    const lines = this.normalizeLines(quote.lines);

    // Idempotency guard: if reservations for this quote already exist (e.g. a
    // concurrent confirm just wrote them) bail out instead of double-deducting.
    const existing = await tx.reservation.count({ where: { quoteId: quote.id } });
    if (existing > 0) return;

    for (const line of lines) {
      const productId = line.productId;
      const quantity = Number(line.qty || line.quantity || 0);
      if (!productId || quantity <= 0) continue;

      const balance = await tx.inventoryBalance.findUnique({ where: { productId } });
      const available = Math.max(0, Number(balance?.available || 0));
      const reserveQty = Math.min(quantity, available);
      const backorderQty = Math.max(0, quantity - reserveQty);

      if (reserveQty > 0) {
        await tx.reservation.create({
          data: {
            id: ulid(),
            quoteId: quote.id,
            productId,
            quantity: reserveQty,
            status: 'reserved',
            updatedAt: new Date(),
          },
        });
        await tx.inventoryBalance.update({
          where: { productId },
          data: {
            reserved: Number(balance.reserved || 0) + reserveQty,
            available: Math.max(0, available - reserveQty),
            updatedAt: new Date(),
          },
        });
        await tx.inventoryMovement.create({
          data: {
            id: ulid(),
            productId,
            type: 'reserve',
            quantity: reserveQty,
            reason: `Reserved for ${quote.quoteNumber}`,
            relatedQuoteId: quote.id,
            createdBy: quote.ownerId,
          },
        });
      }

      if (backorderQty > 0) {
        await tx.reservation.create({
          data: {
            id: ulid(),
            quoteId: quote.id,
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
      where: { quoteId: quote.id, status: 'backordered' },
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

    this.normalizeLines(salesOrder.lines || args.lines).forEach((line: any, index: number) => {
      if (!this.isTileLine(line) || String(line.productId || '').trim()) return;
      const quantity = Math.trunc(Number(line.qty || line.quantity || 0));
      if (quantity <= 0) return;
      const sku = String(line.tileCode || line.sku || `TILE-${index + 1}`).trim();
      rows.push({
        id: ulid(),
        sourceType: 'tile_special_order',
        sourceLineKey: this.tileDemandKey(salesOrder.id, line, index),
        sourceOrderId: salesOrder.id,
        sourceQuoteId: quote.id,
        customerId: quote.customerId,
        ownerId: quote.ownerId,
        sku,
        name: String(line.name || `Tile ${sku}`).trim(),
        category: 'Tiles',
        brand: line.brand || 'Tile vendor',
        finish: line.tileSize || line.dimensions || '',
        unit: line.unit || line.uom || 'BOX',
        quantity,
        status: 'open',
        vendorName: line.brand || 'Tile vendor',
        notes: `${salesOrder.orderNumber} tile special order for ${quote.quoteNumber}`,
        metadata: {
          orderNumber: salesOrder.orderNumber,
          quoteNumber: quote.quoteNumber,
          tileCode: sku,
          tileSize: line.tileSize || line.dimensions || '',
          lineIndex: index,
          source: 'sales_order_conversion',
        },
        updatedAt: new Date(),
      });
    });

    if (!rows.length) return;
    await tx.purchaseDemand.createMany({ data: rows, skipDuplicates: true }).catch(() => null);
  }

  private tileDemandKey(orderId: string, line: any, index: number) {
    return `tile:${orderId}:${String(line.tileCode || line.sku || index).trim()}:${index}`;
  }

  private async releaseReservationsTx(tx: any, quoteId: string, reason: string) {
    const reservations = await tx.reservation.findMany({ where: { quoteId, status: 'reserved' } });
    for (const reservation of reservations) {
      const balance = await tx.inventoryBalance.findUnique({ where: { productId: reservation.productId } });
      if (balance) {
        await tx.inventoryBalance.update({
          where: { productId: reservation.productId },
          data: {
            reserved: Math.max(0, Number(balance.reserved || 0) - reservation.quantity),
            available: Number(balance.available || 0) + reservation.quantity,
            updatedAt: new Date(),
          },
        });
      }
      await tx.reservation.update({
        where: { id: reservation.id },
        data: { status: 'released', updatedAt: new Date() },
      });
      await tx.inventoryMovement.create({
        data: {
          id: ulid(),
          productId: reservation.productId,
          type: 'release',
          quantity: reservation.quantity,
          reason,
          relatedQuoteId: quoteId,
          createdBy: 'system',
        },
      });
    }
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
