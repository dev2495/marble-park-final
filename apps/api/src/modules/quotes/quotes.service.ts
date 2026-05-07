import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
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
}

export interface CreateSalesOrderInput {
  quoteId: string;
  paymentMode: string;
  advanceAmount?: number;
  notes?: string;
}

const QUOTE_STATUSES = ['draft', 'pending_approval', 'approved', 'sent', 'customer_followup', 'confirmed', 'won', 'lost', 'expired'];
const quoteInclude = {
  customer: true,
  lead: true,
  owner: { select: { id: true, name: true, email: true, role: true, phone: true, active: true } },
} as any;

@Injectable()
export class QuotesService {
  constructor(private prisma: PrismaService, private notifications: NotificationsService) {}

  async findAll(args?: { leadId?: string; customerId?: string; ownerId?: string; status?: string }): Promise<any[]> {
    const where: any = {};
    if (args?.leadId) where.leadId = args.leadId;
    if (args?.customerId) where.customerId = args.customerId;
    if (args?.ownerId) where.ownerId = args.ownerId;
    if (args?.status) where.status = args.status;
    
    return this.prisma.quote.findMany({
      where,
      include: quoteInclude,
      orderBy: { createdAt: 'desc' },
    } as any) as any;
  }

  async findById(id: string): Promise<any> {
    const quote = await this.prisma.quote.findUnique({
      where: { id },
      include: quoteInclude,
    } as any) as any;
    if (!quote) throw new NotFoundException('Quote not found');
    return quote;
  }

  async create(data: CreateQuoteInput): Promise<any> {
    let quoteNumber = await this.generateQuoteNumber();
    const ownerId = data.ownerId || (await this.prisma.user.findFirst({
      where: { active: true, role: { in: ['sales', 'owner', 'admin'] } as any },
      orderBy: { createdAt: 'asc' },
    }))?.id;
    if (!ownerId) throw new BadRequestException('A quote owner is required');

    const customerId = data.customerId;
    if (!customerId) throw new BadRequestException('A customer is required');

    let leadId = data.leadId;
    if (!leadId) {
      const lead = await this.prisma.lead.create({
        data: {
          id: ulid(),
          customerId,
          ownerId,
          title: data.projectName || data.title || 'Retail quote opportunity',
          source: 'Quote desk',
          stage: 'quoted',
          expectedValue: this.getLinesTotal(data.lines),
          lastContactAt: new Date(),
          nextActionAt: new Date(Date.now() + 86400000 * 2),
          notes: 'Auto-created from quote builder.',
          updatedAt: new Date(),
        },
      });
      leadId = lead.id;
    }
    
    const normalizedLines = this.normalizeLines(data.lines);
    const displayMode = this.normalizeDisplayMode(data.displayMode);
    const quoteMeta = this.normalizeQuoteMeta(data.quoteMeta, normalizedLines);
    const availabilityIssues = await this.getAvailabilityIssues(normalizedLines);
    let created: any = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (attempt > 0) quoteNumber = await this.generateQuoteNumber();
      try {
        created = await this.prisma.quote.create({
          data: {
            id: ulid(),
            ...data,
            customerId,
            ownerId,
            leadId,
            lines: normalizedLines,
            quoteNumber,
            status: 'pending_approval',
            approvalStatus: 'pending',
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
              reason: 'owner_quote_approval_required',
              availabilityIssues,
              discountPercent: data.discountPercent || 0,
              total: this.getLinesTotal(normalizedLines),
              displayMode,
            },
            updatedAt: new Date(),
          },
          include: quoteInclude,
        } as any) as any;
        break;
      } catch (error: any) {
        if (error?.code === 'P2002' && attempt < 4) continue;
        throw error;
      }
    }
    if (!created) throw new BadRequestException('Could not allocate quote number');
    await this.audit(created.ownerId, 'quote.create', created.id, `Created ${created.quoteNumber}`, { customerId: created.customerId });
    await this.notifications.createMany([
      {
        title: 'Quote needs approval',
        message: `${created.quoteNumber} is waiting for owner approval for ${created.customer?.name || 'customer'}.`,
        type: 'approval',
        entityType: 'Quote',
        entityId: created.id,
        href: `/dashboard/approvals?quote=${created.id}`,
        targetRole: 'owner',
        metadata: { quoteNumber: created.quoteNumber, displayMode },
      },
      {
        title: 'Quote needs approval',
        message: `${created.quoteNumber} is waiting for admin approval for ${created.customer?.name || 'customer'}.`,
        type: 'approval',
        entityType: 'Quote',
        entityId: created.id,
        href: `/dashboard/approvals?quote=${created.id}`,
        targetRole: 'admin',
        metadata: { quoteNumber: created.quoteNumber, displayMode },
      },
    ]);
    return created;
  }

  async update(id: string, data: UpdateQuoteInput): Promise<any> {
    await this.findById(id);
    
    const updateData: any = { ...data };
    if (data.discountPercent !== undefined || data.lines !== undefined) {
      const lines = data.lines !== undefined ? this.normalizeLines(data.lines) : this.normalizeLines((await this.findById(id)).lines);
      updateData.lines = data.lines !== undefined ? lines : undefined;
      updateData.quoteMeta = data.quoteMeta !== undefined ? this.normalizeQuoteMeta(data.quoteMeta, lines) : undefined;
      updateData.approvalStatus = 'pending';
      updateData.status = 'pending_approval';
      updateData.approval = {
        requestedAt: new Date().toISOString(),
        reason: 'quote_changed_owner_reapproval_required',
        availabilityIssues: await this.getAvailabilityIssues(lines),
        discountPercent: data.discountPercent,
        total: this.getLinesTotal(lines),
      };
    }
    if (data.displayMode !== undefined) updateData.displayMode = this.normalizeDisplayMode(data.displayMode);
    if (data.quoteMeta !== undefined && updateData.quoteMeta === undefined) updateData.quoteMeta = this.normalizeQuoteMeta(data.quoteMeta, this.normalizeLines((await this.findById(id)).lines));
    
    const updated = await this.prisma.quote.update({
      where: { id },
      data: updateData,
      include: quoteInclude,
    } as any) as any;
    await this.audit(updated.ownerId, 'quote.update', id, `Updated ${updated.quoteNumber}`, updateData);
    if (updated.approvalStatus === 'pending') {
      await this.notifications.create({
        title: 'Quote changed',
        message: `${updated.quoteNumber} was changed and needs owner re-approval.`,
        type: 'approval',
        entityType: 'Quote',
        entityId: updated.id,
        href: `/dashboard/approvals?quote=${updated.id}`,
        targetRole: 'owner',
      });
    }
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
    
    const updated = await this.prisma.quote.update({
      where: { id },
      data: updateData,
      include: quoteInclude,
    } as any) as any;
    if (['lost', 'expired'].includes(status)) {
      await this.releaseReservations(id, `Quote marked ${status}`);
    }
    await this.audit(updated.ownerId, 'quote.status', id, `Quote status changed to ${status}`, { status });
    return updated;
  }

  async sendQuote(id: string): Promise<any> {
    const quote = await this.findById(id);
    if (quote.approvalStatus === 'pending') {
      throw new BadRequestException('Quote needs approval before sending');
    }
    const sent = await this.prisma.quote.update({
      where: { id },
      data: { status: 'sent', sentAt: new Date() },
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
    const quote = await this.findById(id);
    if (quote.approvalStatus === 'pending') {
      throw new BadRequestException('Quote needs approval before confirmation');
    }
    
    return this.prisma.$transaction(async (tx) => {
      const confirmed = await tx.quote.update({
        where: { id },
        data: { status: 'confirmed', confirmedAt: new Date() },
        include: quoteInclude,
      });

      const existingJob = await tx.dispatchJob.findUnique({ where: { quoteId: id } });
      const existingReservations = await tx.reservation.count({ where: { quoteId: id } });
      if (!existingReservations) {
        await this.createReservationsForQuote(tx, quote);
      }
      if (!existingJob) {
        await tx.dispatchJob.create({
          data: {
            id: ulid(),
            quoteId: id,
            customerId: quote.customerId,
            siteAddress: quote.customer?.siteAddress || '',
            status: 'pending',
            dueDate: new Date(Date.now() + 86400000),
            ownerId: quote.ownerId,
            updatedAt: new Date(),
          },
        });
      }
      
      await tx.auditEvent.create({
        data: {
          id: ulid(),
          actorUserId: quote.ownerId,
          action: 'quote.confirm',
          entityType: 'Quote',
          entityId: id,
          summary: `Confirmed ${quote.quoteNumber}`,
          metadata: {},
        },
      });
      await tx.notification.create({
        data: {
          id: ulid(),
          title: 'Dispatch job opened',
          message: `${quote.quoteNumber} is confirmed and ready for dispatch planning.`,
          type: 'dispatch_ready',
          entityType: 'Quote',
          entityId: quote.id,
          href: '/dashboard/dispatch',
          targetRole: 'dispatch_ops',
          metadata: { quoteNumber: quote.quoteNumber },
        },
      }).catch(() => null);
      return confirmed;
    });
  }

  async createSalesOrderFromQuote(input: CreateSalesOrderInput, actorUserId: string) {
    const quote = await this.findById(input.quoteId);
    if (quote.approvalStatus === 'pending') {
      throw new BadRequestException('Quote needs owner approval before sales order conversion');
    }
    const paymentMode = String(input.paymentMode || '').toLowerCase() === 'credit' ? 'credit' : 'cash';
    const lines = this.normalizeLines(quote.lines);
    const totalAmount = this.getLinesTotal(lines);
    const advanceAmount = paymentMode === 'cash' ? Number(input.advanceAmount || 0) : 0;
    const paymentStatus = paymentMode === 'credit' ? 'credit' : advanceAmount >= totalAmount ? 'paid' : advanceAmount > 0 ? 'advance' : 'pending_cash';

    return this.prisma.$transaction(async (tx) => {
      const existingOrder = await tx.salesOrder.findUnique({ where: { quoteId: quote.id } }).catch(() => null);
      if (existingOrder) return existingOrder;

      const existingReservations = await tx.reservation.count({ where: { quoteId: quote.id } });
      if (!existingReservations) await this.createReservationsForQuote(tx, quote);

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

      const count = await tx.salesOrder.count({ where: { orderNumber: { startsWith: `SO/${new Date().getFullYear()}` } } });
      const salesOrder = await tx.salesOrder.create({
        data: {
          id: ulid(),
          orderNumber: `SO/${new Date().getFullYear()}/${String(count + 1).padStart(4, '0')}`,
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
          updatedAt: new Date(),
        },
      });

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
            metadata: { quoteId: quote.id, paymentMode, paymentStatus, totalAmount },
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
            metadata: { quoteId: quote.id },
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
            metadata: { quoteId: quote.id },
          },
        ],
      }).catch(() => null);
      return salesOrder;
    });
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
    return this.prisma.quote.delete({ where: { id } });
  }

  private async generateQuoteNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.prisma.quote.count({
      where: { quoteNumber: { startsWith: `QT/${year}` } },
    });
    return `QT/${year}/${String(count + 1).padStart(4, '0')}`;
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
    for (const line of lines) {
      const productId = line.productId;
      const quantity = Number(line.qty || line.quantity || 0);
      if (!productId || quantity <= 0) continue;

      const balance = await tx.inventoryBalance.findUnique({ where: { productId } });
      const canReserve = balance && Number(balance.available || 0) >= quantity;
      await tx.reservation.create({
        data: {
          id: ulid(),
          quoteId: quote.id,
          productId,
          quantity,
          status: canReserve ? 'reserved' : 'backordered',
          updatedAt: new Date(),
        },
      });

      if (canReserve) {
        await tx.inventoryBalance.update({
          where: { productId },
          data: {
            reserved: Number(balance.reserved || 0) + quantity,
            available: Math.max(0, Number(balance.available || 0) - quantity),
            updatedAt: new Date(),
          },
        });
        await tx.inventoryMovement.create({
          data: {
            id: ulid(),
            productId,
            type: 'reserve',
            quantity,
            reason: `Reserved for ${quote.quoteNumber}`,
            relatedQuoteId: quote.id,
            createdBy: quote.ownerId,
          },
        });
      }
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
    const reservations = await this.prisma.reservation.findMany({ where: { quoteId, status: 'reserved' } });
    await this.prisma.$transaction(async (tx) => {
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
    });
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
