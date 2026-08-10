import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { nextDocumentNumber } from '../common/sequence';
import { applyStockPostingTx, syncSalesOrderLinesForQuoteTx } from '../common/stock-posting';
import { releaseReservedLotsTx, reserveAvailableLotsTx } from '../common/lot-allocation';
import { priceQuoteLines } from '../common/pricing';
import { ulid } from 'ulid';
import { randomBytes } from 'crypto';
import { StoredImageService } from '../assets/stored-image.service';
import { ReceivablesService } from '../receivables/receivables.service';

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
  architectId?: string | null;
  saveAsDraft?: boolean;
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
  architectId?: string | null;
  saveAsDraft?: boolean;
}

export interface UpdateQuotePresentationInput {
  displayMode?: string;
  quoteMeta?: any;
  coverImage?: string;
  linePresentation?: any[] | string;
}

export interface CreateDirectSalesOrderInput {
  customerId: string;
  ownerId: string;
  paymentMode: string;
  advanceAmount?: number;
  paymentTerms?: string;
  promisedDate?: Date;
  notes?: string;
  lines: any[] | string;
  idempotencyKey?: string;
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

const QUOTE_STATUSES = ['incomplete_pricing', 'draft', 'pending_approval', 'approved', 'sent', 'customer_followup', 'partially_ordered', 'confirmed', 'won', 'closed', 'lost', 'expired', 'superseded', 'cancelled'];

// Eager-include retained ONLY for endpoints that legitimately need the embedded
// objects in a single round-trip (e.g. internal services that don't go through
// the GraphQL resolver layer where DataLoaders kick in). Resolver-driven reads
// should rely on per-field DataLoader resolution and pass `quoteInclude: false`
// (or use `findRaw`) so we don't double-fetch.
const quoteInclude = {
  customer: true,
  lead: true,
  architect: true,
  owner: { select: { id: true, name: true, email: true, role: true, phone: true, active: true } },
} as any;

@Injectable()
export class QuotesService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private storedImages: StoredImageService,
    private receivables: ReceivablesService,
  ) {}

  /**
   * GraphQL-facing list. Returns BARE rows (no relations eagerly joined) so
   * the resolver can fan relations through DataLoader and avoid the classic
   * 1 + 2N (`customer`, `owner` per row) hit pattern when listing 100s of quotes.
   */
  async findAll(args?: { leadId?: string; customerId?: string; ownerId?: string; status?: string; architectId?: string }): Promise<any[]> {
    const where: any = {};
    if (args?.leadId) where.leadId = args.leadId;
    if (args?.customerId) where.customerId = args.customerId;
    if (args?.ownerId) where.ownerId = args.ownerId;
    if (args?.status) where.status = args.status;
    if (args?.architectId) where.architectId = args.architectId;

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

  async create(data: CreateQuoteInput, actorUserId?: string): Promise<any> {
    const ownerId = data.ownerId || (await this.prisma.user.findFirst({
      where: { active: true, role: { in: ['sales', 'owner', 'admin'] } as any },
      orderBy: { createdAt: 'asc' },
    }))?.id;
    if (!ownerId) throw new BadRequestException('A quote owner is required');

    const customerId = data.customerId;
    if (!customerId) throw new BadRequestException('A customer is required');

    const saveAsDraft = Boolean((data as any).saveAsDraft);
    const assertedLines = await this.persistQuoteLineImages(await this.assertQuoteLines(data.lines, 'creating a quote'));
    const pricing = priceQuoteLines(assertedLines, data.discountPercent || 0, { requireMrp: !saveAsDraft });
    const normalizedLines = this.withMrpConfirmation(pricing.lines, saveAsDraft ? null : (actorUserId || ownerId));
    const incompletePricing = pricing.pricingErrors.length > 0;
    const displayMode = this.normalizeDisplayMode(data.displayMode);
    const consultingArchitect = await this.resolveConsultingArchitect(data.architectId);
    const quoteMeta = this.normalizeQuoteMeta(
      {
        ...(typeof data.quoteMeta === 'string'
          ? (() => { try { return JSON.parse(data.quoteMeta); } catch { return {}; } })()
          : (data.quoteMeta || {})),
        architectName: consultingArchitect?.name || undefined,
      },
      normalizedLines,
    );
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

          const supersedesId = data.supersedesQuoteId || null;
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

          const { intentId, supersedesQuoteId: _supersedesQuoteId, saveAsDraft: _saveAsDraft, architectId: _architectId, ...quoteData } = data as any;
          const quote = await tx.quote.create({
            data: {
              id: ulid(),
              ...quoteData,
              customerId,
              ownerId,
              leadId,
              architectId: consultingArchitect?.id || null,
              architectName: consultingArchitect?.name || null,
              lines: normalizedLines,
              quoteNumber,
              status: incompletePricing ? 'incomplete_pricing' : pricing.requiresApproval ? 'pending_approval' : 'draft',
              approvalStatus: incompletePricing ? 'incomplete' : pricing.requiresApproval ? 'pending' : 'approved',
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
                pricingReadiness: pricing.pricingErrors,
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
    await this.audit(actorUserId || created.ownerId, 'quote.create', created.id, `Created ${created.quoteNumber}`, { customerId: created.customerId, incompletePricing });
    await this.notifications.createMany([
      {
        title: 'Quote ready',
        message: incompletePricing ? `${created.quoteNumber} is saved as a draft. Add MRP to every line before sharing or confirming.` : `${created.quoteNumber} is ready to share or confirm for ${created.customer?.name || 'customer'}.`,
        type: 'quote_ready',
        entityType: 'Quote',
        entityId: created.id,
        href: `/dashboard/quotes/${created.id}`,
        targetUserId: created.ownerId,
        metadata: { quoteNumber: created.quoteNumber, displayMode, incompletePricing, pdfUrl: `/api/pdf/quote/${created.id}` },
      },
      {
        title: 'Quote ready',
        message: incompletePricing ? `${created.quoteNumber} needs MRP completion before commercial actions.` : `${created.quoteNumber} is visible to admin/owner without approval blocking.`,
        type: 'quote_ready',
        entityType: 'Quote',
        entityId: created.id,
        href: `/dashboard/quotes/${created.id}`,
        targetRole: 'admin',
        metadata: { quoteNumber: created.quoteNumber, displayMode, incompletePricing, pdfUrl: `/api/pdf/quote/${created.id}` },
      },
    ]);
    return created;
  }

  async update(id: string, data: UpdateQuoteInput, actorUserId?: string): Promise<any> {
    const current = await this.findById(id);
    if (data.discountPercent !== undefined || data.lines !== undefined) {
      const existingOrders = await this.prisma.salesOrder.count({ where: { quoteId: id } });
      if (existingOrders > 0) {
        throw new BadRequestException('Commercial lines are frozen once an order exists. Create a quote revision for a new commercial agreement.');
      }
    }
    const saveAsDraft = Boolean((data as any).saveAsDraft);
    const updateData: any = { ...data };
    delete updateData.saveAsDraft;
    if (data.discountPercent !== undefined || data.lines !== undefined) {
      const assertedLines = await this.persistQuoteLineImages(data.lines !== undefined
        ? await this.assertQuoteLines(data.lines, 'updating a quote')
        : await this.assertQuoteLines(current.lines, 'updating a quote'));
      const pricing = priceQuoteLines(assertedLines, data.discountPercent ?? current.discountPercent ?? 0, { requireMrp: !saveAsDraft });
      const incompletePricing = pricing.pricingErrors.length > 0;
      updateData.lines = this.withMrpConfirmation(pricing.lines, saveAsDraft ? null : (actorUserId || current.ownerId));
      updateData.discountPercent = pricing.quoteDiscountPercent;
      updateData.quoteMeta = this.normalizeQuoteMeta(data.quoteMeta ?? current.quoteMeta, pricing.lines);
      updateData.approvalStatus = incompletePricing ? 'incomplete' : pricing.requiresApproval ? 'pending' : 'approved';
      updateData.status = incompletePricing ? 'incomplete_pricing' : pricing.requiresApproval ? 'pending_approval' : 'draft';
      updateData.approval = {
        requestedAt: new Date().toISOString(),
        reason: pricing.requiresApproval ? 'below_floor_rate_requires_owner_approval' : 'quote_changed_no_owner_reapproval_required',
        availabilityIssues: await this.getAvailabilityIssues(pricing.lines),
        pricing: pricing.totals,
        discountPercent: pricing.quoteDiscountPercent,
        total: pricing.totals.grandTotal,
        requiresPriceApproval: pricing.requiresApproval,
        pricingReadiness: pricing.pricingErrors,
        ...(pricing.requiresApproval ? {} : { autoApprovedAt: new Date().toISOString() }),
      };
    }
    if (data.displayMode !== undefined) updateData.displayMode = this.normalizeDisplayMode(data.displayMode);
    if (data.quoteMeta !== undefined && updateData.quoteMeta === undefined) updateData.quoteMeta = this.normalizeQuoteMeta(data.quoteMeta, await this.assertQuoteLines((await this.findById(id)).lines, 'updating quote metadata'));
    if (data.architectId !== undefined) {
      const consultingArchitect = await this.resolveConsultingArchitect(data.architectId);
      updateData.architectId = consultingArchitect?.id || null;
      updateData.architectName = consultingArchitect?.name || null;
      const baseMeta = updateData.quoteMeta !== undefined
        ? updateData.quoteMeta
        : this.normalizeQuoteMeta(current.quoteMeta, await this.assertQuoteLines(current.lines, 'updating quote architect'));
      updateData.quoteMeta = {
        ...baseMeta,
        architectName: consultingArchitect?.name || '',
      };
    }
    
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
    await this.audit(actorUserId || updated.ownerId, 'quote.update', id, `Updated ${updated.quoteNumber}`, updateData);
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

  async updatePresentation(id: string, data: UpdateQuotePresentationInput, actorUserId: string): Promise<any> {
    const current = await this.findById(id);
    const updateData: any = {};
    if (data.displayMode !== undefined) updateData.displayMode = this.normalizeDisplayMode(data.displayMode);
    if (data.coverImage !== undefined) updateData.coverImage = String(data.coverImage || '');
    if (data.quoteMeta !== undefined) {
      updateData.quoteMeta = this.normalizeQuoteMeta(data.quoteMeta, await this.assertQuoteLines(current.lines, 'updating quote presentation'));
    }

    if (data.linePresentation !== undefined) {
      let patches: any;
      try {
        patches = typeof data.linePresentation === 'string' ? JSON.parse(data.linePresentation || '[]') : data.linePresentation;
      } catch {
        throw new BadRequestException('Quote presentation rows must be valid JSON. Reload the quote and try again.');
      }
      if (!Array.isArray(patches) || patches.length > 500) throw new BadRequestException('Quote presentation rows are invalid or exceed 500 items.');
      const byKey = new Map(patches.map((patch: any, index: number) => [String(patch?.lineKey || patch?.id || `index:${index}`), patch]));
      const currentLines = await this.assertQuoteLines(current.lines, 'updating quote presentation');
      updateData.lines = await this.persistQuoteLineImages(currentLines.map((line: any, index: number) => {
        const key = String(line.lineKey || line.id || `index:${index}`);
        const patch: any = byKey.get(key);
        if (!patch) return line;
        return {
          ...line,
          area: String(patch.area ?? line.area ?? '').slice(0, 160),
          quoteImage: String(patch.quoteImage ?? line.quoteImage ?? '').slice(0, 2048),
          customImageUrl: String(patch.customImageUrl ?? patch.quoteImage ?? line.customImageUrl ?? '').slice(0, 2048),
          designCode: String(patch.designCode ?? line.designCode ?? '').slice(0, 120),
        };
      }));
    }

    if (!Object.keys(updateData).length) return current;
    const updated = await this.prisma.quote.update({ where: { id }, data: updateData, include: quoteInclude } as any) as any;
    await this.audit(actorUserId, 'quote.presentation.update', id, `Updated document presentation for ${updated.quoteNumber}`, {
      displayMode: updateData.displayMode,
      coverImageChanged: data.coverImage !== undefined,
      quoteMetaChanged: data.quoteMeta !== undefined,
      linePresentationCount: Array.isArray(data.linePresentation) ? data.linePresentation.length : undefined,
    });
    return updated;
  }

  async createShare(quoteId: string, actorUserId: string, expiresInDays = 30, allowDownload = true) {
    const quote = await this.findById(quoteId);
    this.ensureCommercialReady(quote, 'sharing this quote');
    const days = Math.min(Math.max(Math.trunc(Number(expiresInDays || 30)), 1), 365);
    const now = new Date();
    const reusable = await (this.prisma as any).quoteShare.findFirst({
      where: { quoteId, createdBy: actorUserId, allowDownload: Boolean(allowDownload), revokedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });
    if (reusable) return reusable;
    return (this.prisma as any).quoteShare.create({
      data: {
        id: ulid(),
        token: randomBytes(32).toString('base64url'),
        quoteId,
        createdBy: actorUserId,
        allowDownload: Boolean(allowDownload),
        expiresAt: new Date(now.getTime() + days * 24 * 60 * 60 * 1000),
      },
    });
  }

  async quoteShares(quoteId: string) {
    await this.findById(quoteId);
    return (this.prisma as any).quoteShare.findMany({ where: { quoteId }, orderBy: { createdAt: 'desc' }, take: 25 });
  }

  async revokeShare(quoteId: string, shareId: string, actorUserId: string) {
    const share = await (this.prisma as any).quoteShare.findFirst({ where: { id: shareId, quoteId } });
    if (!share) throw new NotFoundException('Quote share link not found');
    if (!share.revokedAt) {
      await (this.prisma as any).quoteShare.update({ where: { id: share.id }, data: { revokedAt: new Date() } });
      await this.audit(actorUserId, 'quote.share.revoke', quoteId, 'Revoked quote share link', { shareId });
    }
    return { ...share, revokedAt: share.revokedAt || new Date() };
  }

  async publicQuoteShareDocument(tokenInput: string) {
    const token = String(tokenInput || '').trim();
    if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) throw new NotFoundException('Quote share link not found');
    const now = new Date();
    const share = await (this.prisma as any).quoteShare.findUnique({ where: { token } });
    if (!share || share.revokedAt || share.expiresAt <= now) throw new NotFoundException('Quote share link is unavailable or has expired');
    const quote = await this.prisma.quote.findUnique({ where: { id: share.quoteId }, include: quoteInclude } as any) as any;
    if (!quote) throw new NotFoundException('Quote share link not found');
    this.ensureCommercialReady(quote, 'opening this quote share');
    const [settings, brands] = await Promise.all([
      this.prisma.appSetting.findFirst({ orderBy: { updatedAt: 'desc' } }),
      this.prisma.productBrand.findMany({ where: { status: 'active' }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    ]);
    await (this.prisma as any).quoteShare.update({
      where: { id: share.id },
      data: { viewCount: { increment: 1 }, lastViewedAt: now },
    }).catch(() => null);
    return {
      quote,
      settings: settings ? {
        companyName: settings.companyName,
        logoUrl: settings.logoUrl,
        companyAddress: settings.companyAddress,
        gstNumber: settings.gstNumber,
        website: settings.website,
        quotationTitle: settings.quotationTitle,
        documentTagline: settings.documentTagline,
        defaultTerms: settings.defaultTerms,
        bankDetails: settings.bankDetails,
        documentFooter: settings.documentFooter,
        supportPhone: settings.supportPhone,
        supportEmail: settings.supportEmail,
        quoteBrandSelectionMode: (settings as any).quoteBrandSelectionMode || 'all',
        quoteBrandIds: Array.isArray((settings as any).quoteBrandIds) ? (settings as any).quoteBrandIds : [],
      } : {},
      brands,
      share: { id: share.id, expiresAt: share.expiresAt, allowDownload: share.allowDownload },
    };
  }

  async updateStatus(id: string, status: string): Promise<any> {
    if (!QUOTE_STATUSES.includes(status)) {
      throw new BadRequestException(`Invalid status: ${status}`);
    }

    const current = await this.findById(id);
    if (['sent', 'approved', 'confirmed', 'won'].includes(status)) this.ensureCommercialReady(current, `marking the quote ${status}`);

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
    this.ensureCommercialReady(quote, 'sending this quote');
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
    this.ensureCommercialReady(quote, 'confirming this quote');
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

  private async assertCustomerCreditAvailableTx(tx: any, customerId: string, additionalAmount: number) {
    const profile = await tx.customerCreditProfile.findUnique({ where: { customerId } });
    if (profile?.creditHold) {
      throw new BadRequestException(profile.holdReason || 'This customer is on credit hold. Release the hold before creating a credit sales order.');
    }
    const creditLimit = Number(profile?.creditLimit || 0);
    if (creditLimit <= 0) return;

    const [ledger, creditOrders] = await Promise.all([
      tx.customerLedgerEntry.aggregate({
        where: { customerId },
        _sum: { debit: true, credit: true },
      }),
      tx.salesOrder.findMany({
        where: { customerId, paymentMode: 'credit', status: { not: 'cancelled' } },
        select: { id: true, totalAmount: true },
      }),
    ]);
    const orderIds = creditOrders.map((order: any) => order.id);
    const billed = orderIds.length
      ? await tx.salesInvoice.groupBy({
          by: ['salesOrderId'],
          where: { salesOrderId: { in: orderIds }, status: { not: 'void' } },
          _sum: { totalAmount: true },
        })
      : [];
    const billedByOrder = new Map(billed.map((row: any) => [row.salesOrderId, Number(row._sum?.totalAmount || 0)]));
    const unbilledCommitment = creditOrders.reduce(
      (sum: number, order: any) => sum + Math.max(0, Number(order.totalAmount || 0) - Number(billedByOrder.get(order.id) || 0)),
      0,
    );
    const ledgerExposure = Number(ledger._sum.debit || 0) - Number(ledger._sum.credit || 0);
    const currentExposure = Math.max(0, ledgerExposure + unbilledCommitment);
    if (currentExposure + additionalAmount > creditLimit + 0.01) {
      throw new BadRequestException(`Credit limit exceeded. Current committed exposure is ₹${currentExposure.toFixed(2)} against a limit of ₹${creditLimit.toFixed(2)}.`);
    }
  }

  async createSalesOrderFromQuote(input: CreateSalesOrderInput, actorUserId: string) {
    const quote = await this.findByIdWithRelations(input.quoteId);
    this.ensureCommercialReady(quote, 'converting this quote to a sales order');
    if (quote.approvalStatus === 'pending') {
      throw new BadRequestException('Owner approval is required because this quote contains a below-floor rate.');
    }
    if (['closed', 'lost', 'expired', 'superseded', 'cancelled'].includes(quote.status)) {
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
            const priced = priceQuoteLines(historicalLines, latestQuote.discountPercent || 0, { requireMrp: true });
            await this.syncQuoteLinesTx(tx, latestQuote, priced.lines);
            quoteLines = await tx.quoteLine.findMany({ where: { quoteId: quote.id }, orderBy: { lineNo: 'asc' } });
          }

          const selected = this.selectOrderLines(latestQuote, quoteLines as any[], requestedSelections);
          const commercial = priceQuoteLines(selected.lines, latestQuote.discountPercent || 0, { requireMrp: true });
          const totalAmount = commercial.totals.grandTotal;
          const advanceAmount = paymentMode === 'cash' ? Number(input.advanceAmount || 0) : 0;
          if (!Number.isFinite(advanceAmount) || advanceAmount < 0 || advanceAmount > totalAmount) {
            throw new BadRequestException('Advance amount must be between zero and the selected order total.');
          }
          if (paymentMode === 'credit') {
            await this.assertCustomerCreditAvailableTx(tx, latestQuote.customerId, totalAmount);
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

          // An advance is real money, so it enters the customer ledger as an
          // unapplied receipt. A credit order creates no zero-value receipt;
          // it becomes receivable only when dispatched value is invoiced.
          if (advanceAmount > 0) {
            await this.receivables.recordCustomerPaymentTx(tx, {
              customerId: salesOrder.customerId,
              salesOrderId: salesOrder.id,
              paymentMode: 'cash',
              amount: advanceAmount,
              notes: `Advance received during ${orderNumber} conversion.`,
              autoAllocate: false,
              idempotencyKey: `sales-order-advance:${salesOrder.id}`,
            }, actorUserId);
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

  async createDirectSalesOrder(input: CreateDirectSalesOrderInput, actorUserId: string) {
    const customerId = String(input.customerId || '').trim();
    const ownerId = String(input.ownerId || '').trim();
    if (!customerId) throw new BadRequestException('Select a customer.');
    if (!ownerId) throw new BadRequestException('Select the responsible sales user.');
    const [customer, owner] = await Promise.all([
      this.prisma.customer.findUnique({ where: { id: customerId } }),
      this.prisma.user.findUnique({ where: { id: ownerId } }),
    ]);
    if (!customer) throw new NotFoundException('Customer not found.');
    if (!owner || !owner.active || !['sales', 'sales_manager', 'owner', 'admin'].includes(owner.role)) {
      throw new BadRequestException('Select an active sales user.');
    }
    const asserted = await this.persistQuoteLineImages(await this.assertQuoteLines(input.lines, 'creating a direct sales order'));
    const commercial = priceQuoteLines(asserted, 0, { requireMrp: true });
    const lines = this.withMrpConfirmation(commercial.lines, actorUserId);
    if (commercial.totals.grandTotal <= 0) throw new BadRequestException('A direct sales order must have a positive value.');
    const paymentMode = String(input.paymentMode || '').toLowerCase() === 'credit' ? 'credit' : 'cash';
    const advanceAmount = paymentMode === 'cash' ? Number(input.advanceAmount || 0) : 0;
    if (!Number.isFinite(advanceAmount) || advanceAmount < 0 || advanceAmount > commercial.totals.grandTotal) {
      throw new BadRequestException('Advance amount must be between zero and the order total.');
    }
    const idempotencyKey = String(input.idempotencyKey || ulid()).trim();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const existing = await tx.salesOrder.findUnique({ where: { idempotencyKey } }).catch(() => null);
          if (existing) return existing;
          if (paymentMode === 'credit') {
            await this.assertCustomerCreditAvailableTx(tx, customerId, commercial.totals.grandTotal);
          }
          const lead = await tx.lead.create({
            data: {
              id: ulid(), customerId, ownerId, title: `Direct sales order for ${customer.name}`,
              source: 'Direct sales order', stage: 'won', expectedValue: commercial.totals.grandTotal,
              lastContactAt: new Date(), nextActionAt: new Date(Date.now() + 86400000), notes: 'Auto-created for a direct sales order without a quotation.', updatedAt: new Date(),
            },
          });
          const salesOrderId = ulid();
          const orderNumber = await nextDocumentNumber(tx as any, 'sales_order', 'SO', new Date(), {
            existingNumbers: async (prefixForYear) => (await tx.salesOrder.findMany({ where: { orderNumber: { startsWith: prefixForYear } }, select: { orderNumber: true } })).map((row: any) => row.orderNumber),
          });
          const paymentStatus = paymentMode === 'credit' ? 'credit' : advanceAmount >= commercial.totals.grandTotal ? 'paid' : advanceAmount > 0 ? 'advance' : 'pending_cash';
          const salesOrder = await tx.salesOrder.create({
            data: {
              id: salesOrderId, orderNumber, quoteId: null, idempotencyKey, leadId: lead.id, customerId, ownerId,
              status: 'open', paymentMode, paymentStatus,
              paymentTerms: String(input.paymentTerms || (paymentMode === 'credit' ? 'Net 30' : 'Cash on order')).trim(),
              promisedDate: input.promisedDate ? new Date(input.promisedDate) : new Date(Date.now() + 86400000),
              advanceAmount, totalAmount: commercial.totals.grandTotal, lines, notes: String(input.notes || ''),
              documents: { salesOrderPdfUrl: `/api/pdf/order/${salesOrderId}`, salesOrderPdf: { url: `/api/pdf/order/${salesOrderId}`, status: 'generated_on_request' }, pricing: commercial.totals, source: 'direct_order' },
              updatedAt: new Date(),
            },
          });
          const orderLines: any[] = [];
          for (const [index, line] of lines.entries()) {
            const lineKey = this.quoteLineKey(line, index);
            orderLines.push(await tx.salesOrderLine.create({
              data: {
                id: ulid(), salesOrderId, quoteId: null, quoteLineId: null, lineKey, lineNo: index + 1,
                productId: line.productId || null, sku: String(line.sku || line.tileCode || `LINE-${index + 1}`),
                name: String(line.name || line.description || line.sku || `Line ${index + 1}`), category: String(line.category || 'Product'),
                brand: String(line.brand || ''), finish: line.finish || null, area: line.area || 'General Selection',
                unit: String(line.unit || line.inventoryUom || 'PC').toUpperCase(), orderedQuantity: Number(line.qty || line.quantity || 0),
                listPrice: Number(line.listPrice || 0), mrp: Number(line.mrp), mrpRateBasis: line.mrpRateBasis || line.rateBasis || null,
                mrpSource: line.mrpSource || 'direct_order', mrpConfirmedAt: new Date(), mrpConfirmedById: actorUserId,
                unitPrice: Number(line.unitRate || 0), discountPercent: Number(line.discountPercent || 0), taxRate: Number(line.taxRate || 0),
                taxableValue: Number(line.taxableValue || 0), taxAmount: Number(line.taxAmount || 0), grossLineTotal: Number(line.grossLineTotal || line.total || 0),
                lineTotal: Number(line.grossLineTotal || line.total || 0), status: 'open', isTileSpecial: this.isTileLine(line) && !line.productId,
                metadata: { snapshot: line, source: 'direct_order' }, updatedAt: new Date(),
              },
            }));
          }
          const source = { id: null, ownerId, customerId, quoteNumber: 'Direct order' };
          await this.createReservationsForSalesOrder(tx, { quote: source, salesOrder, lines, salesOrderLines: orderLines });
          await tx.dispatchJob.create({
            data: { id: ulid(), quoteId: null, salesOrderId, customerId, siteAddress: customer.siteAddress || '', status: 'pending', dueDate: salesOrder.promisedDate || new Date(Date.now() + 86400000), ownerId, updatedAt: new Date() },
          });
          await this.upsertDocumentJobTx(tx, { entityType: 'SalesOrder', entityId: salesOrderId, documentType: 'sales_order_pdf', url: `/api/pdf/order/${salesOrderId}`, actorUserId, metadata: { orderNumber, source: 'direct_order' } });
          if (advanceAmount > 0) {
            await this.receivables.recordCustomerPaymentTx(tx, { customerId, salesOrderId, paymentMode: 'cash', amount: advanceAmount, notes: `Advance received for ${orderNumber}.`, autoAllocate: false, idempotencyKey: `sales-order-advance:${salesOrderId}` }, actorUserId);
          }
          await this.createPurchaseDemandForSalesOrderTx(tx, { quote: source, salesOrder, lines });
          await tx.activity.create({ data: { id: ulid(), leadId: lead.id, quoteId: null, userId: actorUserId, type: 'sales_order_created', message: `${orderNumber} created directly and assigned to ${owner.name}.` } });
          await tx.auditEvent.create({ data: { id: ulid(), actorUserId, action: 'sales_order.direct_create', entityType: 'SalesOrder', entityId: salesOrderId, summary: `Created direct order ${orderNumber}`, metadata: { customerId, ownerId, totalAmount: commercial.totals.grandTotal } } });
          return salesOrder;
        }, { isolationLevel: 'Serializable', timeout: 30000 });
      } catch (error: any) {
        if ((error?.code === 'P2034' || error?.code === 'P2002') && attempt < 2) continue;
        throw error;
      }
    }
    throw new BadRequestException('Could not safely create this direct sales order. Review the customer credit and submit again.');
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
          mrp: line.mrp === null || line.mrp === undefined || line.mrp === '' ? null : Number(line.mrp),
          mrpRateBasis: line.mrpRateBasis || line.rateBasis || null,
          mrpSource: line.mrpSource || 'quote_entry',
          mrpConfirmedAt: line.mrpConfirmedAt ? new Date(line.mrpConfirmedAt) : null,
          mrpConfirmedById: line.mrpConfirmedById || null,
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
          mrp: line.mrp === null || line.mrp === undefined || line.mrp === '' ? null : Number(line.mrp),
          mrpRateBasis: line.mrpRateBasis || line.rateBasis || null,
          mrpSource: line.mrpSource || 'quote_entry',
          mrpConfirmedAt: line.mrpConfirmedAt ? new Date(line.mrpConfirmedAt) : null,
          mrpConfirmedById: line.mrpConfirmedById || null,
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

  private withMrpConfirmation(lines: any[], actorUserId: string | null) {
    const confirmedAt = actorUserId ? new Date().toISOString() : null;
    return this.normalizeLines(lines).map((line: any) => {
      if (!actorUserId || !line.mrpValid) {
        return { ...line, mrpConfirmedAt: null, mrpConfirmedById: null };
      }
      return {
        ...line,
        mrpConfirmedAt: confirmedAt,
        mrpConfirmedById: actorUserId,
      };
    });
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
        mrp: quoteLine.mrp === null || quoteLine.mrp === undefined ? undefined : Number(quoteLine.mrp),
        mrpRateBasis: quoteLine.mrpRateBasis || snapshot.mrpRateBasis || snapshot.rateBasis,
        mrpSource: quoteLine.mrpSource || snapshot.mrpSource || 'quote_entry',
        mrpConfirmedAt: quoteLine.mrpConfirmedAt || snapshot.mrpConfirmedAt || null,
        mrpConfirmedById: quoteLine.mrpConfirmedById || snapshot.mrpConfirmedById || null,
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

  /**
   * Operational order read model. The old `salesOrders` query intentionally
   * remains for dashboard compatibility, while this endpoint is the scalable
   * source for the order/dispatch control tower: bounded pages, server-side
   * search, derived fulfilment quantities, and KPI totals from persisted
   * SalesOrderLine quantities.
   */
  async salesOrderControlTower(args?: {
    search?: string;
    fulfillmentStatus?: string;
    paymentMode?: string;
    range?: string;
    cursor?: string;
    take?: number;
    ownerId?: string;
    brand?: string;
    category?: string;
    locationId?: string;
    promisedRisk?: string;
    completeness?: string;
    sort?: string;
  }) {
    const limit = Math.max(1, Math.min(100, Math.trunc(Number(args?.take || 25))));
    const search = String(args?.search || '').trim();
    const where: any = {};
    if (args?.paymentMode) where.paymentMode = String(args.paymentMode).toLowerCase();
    if (args?.ownerId) where.ownerId = args.ownerId;
    const createdAt = this.rangeWhere(args?.range);
    if (createdAt) where.createdAt = createdAt;

    if (search) {
      where.OR = [
        { id: { contains: search, mode: 'insensitive' } },
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { quoteId: { contains: search, mode: 'insensitive' } },
        { customer: { is: { OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { mobile: { contains: search, mode: 'insensitive' } },
          { gstNo: { contains: search, mode: 'insensitive' } },
        ] } } },
        { lineItems: { some: { OR: [
          { sku: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } },
          { brand: { contains: search, mode: 'insensitive' } },
        ] } } },
      ];
    }

    const lineFilters: any[] = [];
    if (args?.brand) lineFilters.push({ brand: args.brand });
    if (args?.category) lineFilters.push({ category: args.category });
    if (args?.locationId) lineFilters.push({ lotReservations: { some: { locationId: args.locationId } } });
    if (args?.completeness === 'missing_mrp') lineFilters.push({ OR: [{ mrp: null }, { mrpConfirmedAt: null }] });
    if (args?.completeness === 'missing_list') lineFilters.push({ listPrice: { lte: 0 } });
    if (args?.completeness === 'unpriced') lineFilters.push({ OR: [{ mrp: null }, { mrpConfirmedAt: null }, { listPrice: { lte: 0 } }] });
    if (lineFilters.length) where.AND = [...(where.AND || []), { lineItems: { some: { AND: lineFilters } } }];

    const now = new Date();
    const weekFromNow = new Date(now.getTime() + 7 * 86400000);
    if (args?.promisedRisk === 'overdue') {
      where.promisedDate = { lt: now };
      where.status = { notIn: ['delivered', 'cancelled'] };
    } else if (args?.promisedRisk === 'due_7') {
      where.promisedDate = { gte: now, lte: weekFromNow };
      where.status = { notIn: ['delivered', 'cancelled'] };
    } else if (args?.promisedRisk === 'missing') {
      where.promisedDate = null;
    }

    const requestedStatus = String(args?.fulfillmentStatus || '').trim().toLowerCase();
    if (requestedStatus && requestedStatus !== 'all') {
      const statusMap: Record<string, string[]> = {
        pending_inward: ['pending_inward'],
        ready_to_pick: ['ready', 'partial_ready'],
        partial_dispatch: ['partial_dispatched'],
        dispatched: ['dispatched'],
        delivered: ['delivered'],
        left_to_dispatch: ['open', 'ready', 'partial_ready', 'pending_inward', 'partial_dispatched'],
      };
      const lineStatuses = statusMap[requestedStatus] || [requestedStatus];
      where.AND = [...(where.AND || []), { lineItems: { some: { status: { in: lineStatuses } } } }];
    }

    const cursor = String(args?.cursor || '').trim();
    const sortMap: Record<string, any[]> = {
      oldest: [{ createdAt: 'asc' }, { id: 'asc' }],
      promise: [{ promisedDate: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
      value_desc: [{ totalAmount: 'desc' }, { id: 'desc' }],
      newest: [{ createdAt: 'desc' }, { id: 'desc' }],
    };
    const query: any = {
      where,
      orderBy: sortMap[String(args?.sort || 'newest')] || sortMap.newest,
      take: limit + 1,
      select: {
        id: true,
        orderNumber: true,
        quoteId: true,
        leadId: true,
        customerId: true,
        ownerId: true,
        status: true,
        paymentMode: true,
        paymentStatus: true,
        paymentTerms: true,
        promisedDate: true,
        advanceAmount: true,
        totalAmount: true,
        lines: true,
        documents: true,
        createdAt: true,
        updatedAt: true,
      },
    };
    if (cursor) {
      query.cursor = { id: cursor };
      query.skip = 1;
    }
    const orders = await this.prisma.salesOrder.findMany(query) as any[];
    const hasNextPage = orders.length > limit;
    const page = hasNextPage ? orders.slice(0, limit) : orders;
    if (!page.length) {
      return this.emptySalesOrderControlTower();
    }

    const orderIds = page.map((order) => order.id);
    const quoteIds = Array.from(new Set(page.map((order) => order.quoteId).filter(Boolean)));
    const customerIds = Array.from(new Set(page.map((order) => order.customerId).filter(Boolean)));
    const ownerIds = Array.from(new Set(page.map((order) => order.ownerId).filter(Boolean)));
    const [lines, quotes, customers, owners, jobs, challans] = await Promise.all([
      this.prisma.salesOrderLine.findMany({ where: { salesOrderId: { in: orderIds } }, orderBy: [{ salesOrderId: 'asc' }, { lineNo: 'asc' }] } as any),
      quoteIds.length ? this.prisma.quote.findMany({ where: { id: { in: quoteIds } }, select: { id: true, quoteNumber: true } } as any) : [],
      customerIds.length ? this.prisma.customer.findMany({ where: { id: { in: customerIds } } } as any) : [],
      ownerIds.length ? this.prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true, email: true, role: true, phone: true, active: true } } as any) : [],
      this.prisma.dispatchJob.findMany({ where: { salesOrderId: { in: orderIds } }, select: { id: true, salesOrderId: true, status: true, dueDate: true, updatedAt: true } } as any),
      this.prisma.dispatchChallan.findMany({ where: { salesOrderId: { in: orderIds } }, select: { id: true, salesOrderId: true, challanNumber: true, status: true, dispatchedAt: true, deliveredAt: true, updatedAt: true } } as any),
    ]);
    const lineMap = new Map<string, any[]>();
    for (const line of lines as any[]) lineMap.set(line.salesOrderId, [...(lineMap.get(line.salesOrderId) || []), line]);
    const quoteMap = new Map((quotes as any[]).map((quote) => [quote.id, quote]));
    const customerMap = new Map((customers as any[]).map((customer) => [customer.id, customer]));
    const ownerMap = new Map((owners as any[]).map((owner) => [owner.id, owner]));
    const jobMap = new Map((jobs as any[]).map((job) => [job.salesOrderId, job]));
    const challanMap = new Map<string, any[]>();
    for (const challan of challans as any[]) challanMap.set(challan.salesOrderId, [...(challanMap.get(challan.salesOrderId) || []), challan]);

    const items = page.map((order) => {
      const orderLines = lineMap.get(order.id) || [];
      const metrics = orderLines.reduce((sum, line: any) => ({
        ordered: sum.ordered + Number(line.orderedQuantity || 0),
        reserved: sum.reserved + Number(line.reservedQuantity || 0),
        allocated: sum.allocated + Number(line.allocatedQuantity || 0),
        backordered: sum.backordered + Number(line.backorderedQuantity || 0),
        dispatched: sum.dispatched + Number(line.dispatchedQuantity || 0),
        delivered: sum.delivered + Number(line.deliveredQuantity || 0),
        returned: sum.returned + Number(line.returnedQuantity || 0),
      }), { ordered: 0, reserved: 0, allocated: 0, backordered: 0, dispatched: 0, delivered: 0, returned: 0 });
      const leftToDispatch = Math.max(0, metrics.ordered - metrics.dispatched);
      const readyToPick = Math.max(0, Math.min(leftToDispatch, metrics.reserved + metrics.allocated));
      const status = this.deriveControlTowerStatus(order.status, metrics);
      const dispatchRows = challanMap.get(order.id) || [];
      const job = jobMap.get(order.id) || null;
      return {
        ...order,
        quoteNumber: quoteMap.get(order.quoteId)?.quoteNumber || null,
        customer: customerMap.get(order.customerId) || null,
        owner: ownerMap.get(order.ownerId) || null,
        fulfillmentStatus: status,
        quantities: { ...metrics, leftToDispatch, readyToPick },
        lines: orderLines.map((line: any) => ({
          id: line.id,
          lineKey: line.lineKey,
          sku: line.sku,
          name: line.name,
          brand: line.brand,
          category: line.category,
          unit: line.unit,
          orderedQuantity: line.orderedQuantity,
          reservedQuantity: line.reservedQuantity,
          allocatedQuantity: line.allocatedQuantity,
          backorderedQuantity: line.backorderedQuantity,
          dispatchedQuantity: line.dispatchedQuantity,
          deliveredQuantity: line.deliveredQuantity,
          remainingQuantity: Math.max(0, Number(line.orderedQuantity || 0) - Number(line.dispatchedQuantity || 0)),
          listPrice: Number(line.listPrice || 0),
          mrp: line.mrp === null || line.mrp === undefined ? null : Number(line.mrp),
          mrpRateBasis: line.mrpRateBasis || null,
          mrpSource: line.mrpSource || null,
          mrpConfirmedAt: line.mrpConfirmedAt || null,
          mrpConfirmedById: line.mrpConfirmedById || null,
          unitPrice: Number(line.unitPrice || 0),
          grossLineTotal: Number(line.grossLineTotal || line.lineTotal || 0),
          status: line.status,
        })),
        dispatch: {
          job: job ? { id: job.id, status: job.status, dueDate: job.dueDate, updatedAt: job.updatedAt } : null,
          challans: dispatchRows,
        },
      };
    });

    // KPI totals are database aggregates over the exact filtered population;
    // only the visible page is hydrated with customer, line and document data.
    const lineScope: any = { order: { is: where } };
    const statusScope = (statuses: string[]) => ({ AND: [where, { lineItems: { some: { status: { in: statuses } } } }] });
    const [orderAggregate, lineAggregate, overdueOrders, dueSoonOrders, missingPromiseOrders, unpricedOrders, pendingOrders, readyOrders, partialOrders, dispatchedOrders, deliveredOrders] = await Promise.all([
      this.prisma.salesOrder.aggregate({ where, _count: true, _sum: { totalAmount: true, advanceAmount: true } } as any),
      this.prisma.salesOrderLine.aggregate({ where: lineScope, _sum: { orderedQuantity: true, reservedQuantity: true, allocatedQuantity: true, backorderedQuantity: true, dispatchedQuantity: true, deliveredQuantity: true } } as any),
      this.prisma.salesOrder.count({ where: { AND: [where, { promisedDate: { lt: now } }, { status: { notIn: ['delivered', 'cancelled'] } }] } } as any),
      this.prisma.salesOrder.count({ where: { AND: [where, { promisedDate: { gte: now, lte: weekFromNow } }, { status: { notIn: ['delivered', 'cancelled'] } }] } } as any),
      this.prisma.salesOrder.count({ where: { AND: [where, { promisedDate: null }] } } as any),
      this.prisma.salesOrder.count({
        where: {
          AND: [where, { lineItems: { some: { OR: [{ mrp: null }, { mrpConfirmedAt: null }, { listPrice: { lte: 0 } }] } } }],
        },
      } as any),
      this.prisma.salesOrder.count({ where: statusScope(['pending_inward']) } as any),
      this.prisma.salesOrder.count({ where: statusScope(['ready', 'partial_ready']) } as any),
      this.prisma.salesOrder.count({ where: statusScope(['partial_dispatched']) } as any),
      this.prisma.salesOrder.count({ where: statusScope(['dispatched']) } as any),
      this.prisma.salesOrder.count({ where: statusScope(['delivered']) } as any),
    ]);
    const summaryMetrics = (lineAggregate as any)?._sum || {};
    const totalOrders = Number((orderAggregate as any)?._count || 0);
    const totalAmount = Number((orderAggregate as any)?._sum?.totalAmount || 0);
    const advanceAmount = Number((orderAggregate as any)?._sum?.advanceAmount || 0);
    return {
      items,
      nextCursor: hasNextPage ? page[page.length - 1].id : null,
      total: totalOrders,
      summary: {
        orders: totalOrders,
        totalValue: totalAmount,
        advanceValue: advanceAmount,
        balanceValue: Math.max(0, totalAmount - advanceAmount),
        reservedQty: Number(summaryMetrics.reservedQuantity || 0),
        readyToPickQty: Math.max(0, Math.min(Number(summaryMetrics.orderedQuantity || 0) - Number(summaryMetrics.dispatchedQuantity || 0), Number(summaryMetrics.reservedQuantity || 0) + Number(summaryMetrics.allocatedQuantity || 0))),
        leftToDispatchQty: Math.max(0, Number(summaryMetrics.orderedQuantity || 0) - Number(summaryMetrics.dispatchedQuantity || 0)),
        pendingInwardQty: Number(summaryMetrics.backorderedQuantity || 0),
        deliveredQty: Number(summaryMetrics.deliveredQuantity || 0),
        overdueOrders,
        dueSoonOrders,
        missingPromiseOrders,
        unpricedOrders,
        statusCounts: { pending_inward: pendingOrders, ready_to_pick: readyOrders, partial_dispatch: partialOrders, dispatched: dispatchedOrders, delivered: deliveredOrders },
      },
    };
  }

  private emptySalesOrderControlTower() {
    return {
      items: [],
      nextCursor: null,
      total: 0,
      summary: {
        orders: 0, totalValue: 0, advanceValue: 0, balanceValue: 0,
        reservedQty: 0, readyToPickQty: 0, leftToDispatchQty: 0, pendingInwardQty: 0, deliveredQty: 0,
        overdueOrders: 0, dueSoonOrders: 0, missingPromiseOrders: 0, unpricedOrders: 0,
        statusCounts: {},
      },
    };
  }

  private deriveControlTowerStatus(orderStatus: string, metrics: { ordered: number; reserved: number; allocated: number; backordered: number; dispatched: number; delivered: number }) {
    if (metrics.ordered <= 0) return String(orderStatus || 'open');
    if (metrics.delivered >= metrics.ordered) return 'delivered';
    if (metrics.dispatched >= metrics.ordered) return 'dispatched';
    if (metrics.dispatched > 0) return 'partial_dispatch';
    const ready = metrics.reserved + metrics.allocated;
    if (ready > 0 && metrics.backordered > 0) return 'partial_ready';
    if (metrics.backordered > 0) return 'pending_inward';
    if (ready > 0) return 'ready_to_pick';
    return String(orderStatus || 'open');
  }

  async salesOrder(id: string) {
    const order = await this.prisma.salesOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('Sales order not found');
    const [customer, owner] = await Promise.all([
      this.prisma.customer.findUnique({ where: { id: order.customerId } }),
      this.prisma.user.findUnique({
        where: { id: order.ownerId },
        select: { id: true, name: true, email: true, role: true, phone: true, active: true },
      }),
    ]);
    return { ...order, customer, owner };
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
          unit: line.unit,
          listPrice: Number(line.listPrice || 0),
          mrp: line.mrp === null || line.mrp === undefined ? null : Number(line.mrp),
          mrpRateBasis: line.mrpRateBasis || null,
          mrpSource: line.mrpSource || null,
          mrpConfirmedAt: line.mrpConfirmedAt || null,
          mrpConfirmedById: line.mrpConfirmedById || null,
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
    this.ensureCommercialReady(quote, 'approving this quote');
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

  async cancelQuote(id: string, reason: string, actorUserId: string) {
    const quote = await this.findById(id);
    if (quote.status === 'cancelled') return quote;
    const cancellationReason = String(reason || '').trim();
    if (!cancellationReason) throw new BadRequestException('Enter a cancellation reason.');
    const orders = await this.prisma.salesOrder.findMany({ where: { quoteId: id } });
    const orderIds = orders.map((order: any) => order.id);
    if (orderIds.length) {
      const [physicalActivity, nonReversibleChallans, dispatchedPicks, invoices, postedPayments] = await Promise.all([
        this.prisma.dispatchLine.count({ where: { salesOrderId: { in: orderIds }, OR: [{ dispatchedQuantity: { gt: 0 } }, { deliveredQuantity: { gt: 0 } }] } as any }),
        this.prisma.dispatchChallan.count({ where: { salesOrderId: { in: orderIds }, status: { in: ['dispatched', 'delivered', 'failed_delivery'] } } }),
        this.prisma.pickList.count({ where: { salesOrderId: { in: orderIds }, status: 'dispatched' } }),
        this.prisma.salesInvoice.count({ where: { salesOrderId: { in: orderIds }, status: { not: 'void' } } }),
        this.prisma.customerPayment.count({ where: { salesOrderId: { in: orderIds }, status: 'posted' } }),
      ]);
      if (physicalActivity || nonReversibleChallans || dispatchedPicks || invoices || postedPayments) {
        throw new BadRequestException('This quote has dispatched goods, invoices, or posted receipts. Reverse those documents first; commercial history cannot be silently cancelled.');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const pendingChallans = orderIds.length
        ? await tx.dispatchChallan.findMany({ where: { salesOrderId: { in: orderIds }, status: 'pending' }, select: { id: true } })
        : [];
      const pendingChallanIds = pendingChallans.map((challan: any) => challan.id);
      if (pendingChallanIds.length) {
        await tx.dispatchLine.updateMany({
          where: { challanId: { in: pendingChallanIds }, dispatchedQuantity: 0, deliveredQuantity: 0 },
          data: { status: 'cancelled', updatedAt: new Date() },
        });
        await tx.shipment.updateMany({
          where: { challanId: { in: pendingChallanIds }, status: { notIn: ['dispatched', 'delivered'] } },
          data: { status: 'cancelled', updatedAt: new Date() },
        });
        await tx.dispatchChallan.updateMany({
          where: { id: { in: pendingChallanIds }, status: 'pending' },
          data: { status: 'cancelled', updatedAt: new Date() },
        });
      }

      const activePickLists = orderIds.length
        ? await tx.pickList.findMany({
            where: { salesOrderId: { in: orderIds }, status: { notIn: ['cancelled', 'dispatched'] } },
            select: { id: true, metadata: true },
          })
        : [];
      const activePickListIds = activePickLists.map((pick: any) => pick.id);
      if (activePickListIds.length) {
        await tx.pickLine.updateMany({
          where: { pickListId: { in: activePickListIds }, status: { not: 'dispatched' } },
          data: { status: 'cancelled', updatedAt: new Date() },
        });
        for (const pick of activePickLists) {
          await tx.pickList.update({
            where: { id: pick.id },
            data: {
              status: 'cancelled',
              cancelledAt: new Date(),
              metadata: { ...((pick.metadata as any) || {}), cancelReason: `Quote cancelled: ${cancellationReason}`, cancelledBy: actorUserId },
              updatedAt: new Date(),
            },
          });
        }
      }

      const reservations = await tx.reservation.findMany({ where: { quoteId: id, status: 'reserved' } });
      for (const reservation of reservations) {
        const allocated = await tx.lotReservation.count({ where: { reservationId: reservation.id, status: 'reserved' } });
        if (allocated > 0) {
          await releaseReservedLotsTx(tx, { reservation, reason: `Quote cancelled: ${cancellationReason}`, actorUserId });
        } else {
          await applyStockPostingTx(tx, {
            productId: reservation.productId, type: 'release', movementType: 'release', ledgerType: 'release',
            quantity: Number(reservation.quantity || 0), reservedDelta: -Number(reservation.quantity || 0),
            locationReservedDelta: -Number(reservation.quantity || 0), requireReserved: true,
            reason: `Quote cancelled: ${cancellationReason}`, relatedQuoteId: id,
            referenceType: 'Reservation', referenceId: reservation.id, createdBy: actorUserId,
          });
        }
        await tx.reservation.update({ where: { id: reservation.id }, data: { status: 'released', updatedAt: new Date() } });
      }
      if (orderIds.length) {
        await tx.salesOrderLine.updateMany({ where: { salesOrderId: { in: orderIds } }, data: { status: 'cancelled', updatedAt: new Date() } });
        await tx.salesOrder.updateMany({ where: { id: { in: orderIds } }, data: { status: 'cancelled', updatedAt: new Date() } });
        await tx.dispatchJob.updateMany({ where: { salesOrderId: { in: orderIds } }, data: { status: 'cancelled', updatedAt: new Date() } });
        const activeDemands = await tx.purchaseDemand.findMany({
          where: { sourceOrderId: { in: orderIds }, status: { in: ['open', 'ordered', 'partial_received'] } },
        });
        for (const demand of activeDemands) {
          await tx.purchaseDemand.update({
            where: { id: demand.id },
            data: {
              status: Number(demand.receivedQuantity || 0) > 0 ? 'partial_received_cancelled' : 'cancelled',
              updatedAt: new Date(),
            },
          });
        }
      }
      const lines = await tx.quoteLine.findMany({ where: { quoteId: id } });
      for (const line of lines) {
        const remaining = Math.max(
          0,
          Number(line.quantity || 0)
            - Number(line.orderedQuantity || 0)
            - Number(line.cancelledQuantity || 0)
            - Number(line.closedQuantity || 0),
        );
        await tx.quoteLine.update({
          where: { id: line.id },
          data: { cancelledQuantity: { increment: remaining }, status: 'cancelled', updatedAt: new Date() },
        });
      }
      await tx.quoteShare.updateMany({ where: { quoteId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.lead.update({ where: { id: quote.leadId }, data: { stage: 'lost', updatedAt: new Date(), lastContactAt: new Date() } }).catch(() => null);
      const updated = await tx.quote.update({
        where: { id },
        data: {
          status: 'cancelled',
          approvalStatus: 'cancelled',
          approval: { ...((quote.approval as any) || {}), cancellation: { reason: cancellationReason, cancelledAt: new Date().toISOString(), cancelledBy: actorUserId, orderIds } },
          updatedAt: new Date(),
        },
        include: quoteInclude,
      } as any) as any;
      await tx.auditEvent.create({
        data: {
          id: ulid(), actorUserId, action: 'quote.cancel', entityType: 'Quote', entityId: id,
          summary: `Cancelled ${quote.quoteNumber}`,
          metadata: { reason: cancellationReason, orderIds, pickListIds: activePickListIds, challanIds: pendingChallanIds },
        },
      });
      return updated;
    }, { isolationLevel: 'Serializable', timeout: 30000 });
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

  private tileRateForBasis(rate: unknown, sourceUom: string, targetBasis: string, piecesPerPack: unknown, coveragePerPack: unknown) {
    const sourceRate = Number(rate || 0);
    const pieces = Math.max(1, Math.trunc(Number(piecesPerPack || 1)));
    const coverage = Number(coveragePerPack || 0);
    const source = String(sourceUom || 'BOX').trim().toUpperCase();
    const packRate = ['SQFT', 'SQM', 'M2'].includes(source)
      ? sourceRate * Math.max(0, coverage)
      : source === 'PC' ? sourceRate * pieces : sourceRate;
    if (targetBasis === 'AREA') return coverage > 0 ? packRate / coverage : sourceRate;
    if (targetBasis === 'PIECE') return packRate / pieces;
    return packRate;
  }

  private normalizeTileLine(line: any, index: number) {
    const tileCode = String(line.tileCode || line.sku || '').trim();
    const tileSize = String(line.tileSize || line.size || line.dimensions || '').trim();
    const coveragePerPack = Number(line.coveragePerPack || 0);
    const piecesPerPack = Math.max(1, Math.trunc(Number(line.piecesPerPack || line.pcsPerBox || 1)));
    const requestedBasis = String(line.rateBasis || '').trim().toUpperCase();
    const fallbackPricingUom = String(line.pricingUom || line.salesUom || line.unit || 'BOX').trim().toUpperCase();
    const rateBasis = requestedBasis || (['SQFT', 'SQM', 'M2'].includes(fallbackPricingUom)
      ? 'AREA'
      : fallbackPricingUom === 'PC' ? 'PIECE' : 'PACK');
    if (!['AREA', 'PIECE', 'PACK'].includes(rateBasis)) {
      throw new BadRequestException(`Tile ${tileCode || index + 1} rate basis must be AREA, PIECE, or PACK`);
    }
    const pricingUom = rateBasis === 'PIECE'
      ? 'PC'
      : rateBasis === 'PACK'
        ? String(line.inventoryUom || line.purchaseUom || line.unit || 'BOX').trim().toUpperCase()
        : (['SQFT', 'SQM', 'M2'].includes(fallbackPricingUom) ? fallbackPricingUom : 'SQFT');
    const areaPriced = rateBasis === 'AREA';
    const requestedArea = Number(line.requestedArea || 0);
    const requestedPieces = Math.trunc(Number(line.requestedPieces || 0));
    const wastagePercent = Number(line.wastagePercent || 0);
    if (!Number.isFinite(wastagePercent) || wastagePercent < 0 || wastagePercent > 100) throw new BadRequestException(`Tile ${tileCode || index + 1} wastage must be between 0 and 100`);
    if (areaPriced && coveragePerPack <= 0) throw new BadRequestException(`Tile ${tileCode || index + 1} needs coverage per pack in Product Master`);
    const areaWithWastage = requestedArea > 0 ? requestedArea * (1 + wastagePercent / 100) : 0;
    if (rateBasis === 'PIECE' && requestedPieces < 0) throw new BadRequestException(`Tile ${tileCode || index + 1} requested pieces cannot be negative`);
    const calculatedPacks = areaPriced && areaWithWastage > 0
      ? Math.ceil(areaWithWastage / coveragePerPack)
      : rateBasis === 'PIECE' && requestedPieces > 0
        ? Math.ceil(requestedPieces / piecesPerPack)
        : 0;
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
      rateBasis,
      piecesPerPack,
      pcsPerBox: piecesPerPack,
      coveragePerPack,
      requestedArea: requestedArea > 0 ? requestedArea : null,
      requestedPieces: requestedPieces > 0 ? requestedPieces : null,
      wastagePercent,
      requiredArea: areaWithWastage || null,
      requiredPieces: rateBasis === 'PIECE' ? qty * piecesPerPack : null,
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
        const inventoryUom = String(product.purchaseUom || product.unit || 'BOX').trim().toUpperCase();
        const productSalesUom = String(product.salesUom || product.unit || inventoryUom).trim().toUpperCase();
        const requestedBasis = String(line.rateBasis || '').trim().toUpperCase();
        const inferredBasis = ['SQFT', 'SQM', 'M2'].includes(productSalesUom)
          ? 'AREA'
          : productSalesUom === 'PC' && inventoryUom !== 'PC' ? 'PIECE' : 'PACK';
        const rateBasis = ['AREA', 'PIECE', 'PACK'].includes(requestedBasis) ? requestedBasis : inferredBasis;
        const pricingUom = rateBasis === 'AREA'
          ? (['SQFT', 'SQM', 'M2'].includes(String(line.pricingUom || '').toUpperCase()) ? String(line.pricingUom).toUpperCase() : (['SQFT', 'SQM', 'M2'].includes(productSalesUom) ? productSalesUom : 'SQFT'))
          : rateBasis === 'PIECE' ? 'PC' : inventoryUom;
        const defaultListPrice = this.tileRateForBasis(product.sellPrice, productSalesUom, rateBasis, product.piecesPerPack, product.coveragePerPack);
        const floorPrice = this.tileRateForBasis(product.floorPrice, productSalesUom, rateBasis, product.piecesPerPack, product.coveragePerPack);
        return this.normalizeTileLine({
          ...line, productId: product.id, sku: product.sku, name: product.name, brand: product.brand,
          tileSize: line.tileSize || product.dimensions, dimensions: product.dimensions,
          listPrice: defaultListPrice, sellPrice: defaultListPrice,
          floorPrice, media: line.media || product.media || {},
          inventoryUom, pricingUom, rateBasis, sourceSalesUom: productSalesUom,
          sourceSellPrice: Number(product.sellPrice || 0),
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

  private async persistQuoteLineImages(lines: any[]) {
    const cache = new Map<string, string>();
    const persisted: any[] = [];
    for (const line of lines) {
      const media = line?.media && typeof line.media === 'object' ? line.media : {};
      const gallery = Array.isArray(media.gallery) ? media.gallery : Array.isArray(media.images) ? media.images : [];
      const firstGallery = typeof gallery[0] === 'string' ? gallery[0] : gallery[0]?.url;
      const source = String(line.quoteImage || line.customImageUrl || media.primaryUrl || media.primaryImage || firstGallery || '').trim();
      if (!source) {
        persisted.push(line);
        continue;
      }
      let stored = cache.get(source);
      if (!stored) {
        try {
          stored = await this.storedImages.persistRemoteImage(source);
          cache.set(source, stored);
        } catch (error: any) {
          const detail = error?.response?.message || error?.message || 'the image could not be imported';
          throw new BadRequestException(`${line.sku || line.name || 'Quote line'} image was not saved: ${detail}`);
        }
      }
      persisted.push({ ...line, quoteImage: stored, customImageUrl: stored });
    }
    return persisted;
  }

  private normalizeDisplayMode(value?: string) {
    return String(value || '').toLowerCase() === 'selection' ? 'selection' : 'priced';
  }

  private async resolveConsultingArchitect(architectId?: string | null) {
    const id = String(architectId || '').trim();
    if (!id) return null;
    const architect = await (this.prisma as any).architect.findUnique({ where: { id } });
    if (!architect) throw new BadRequestException('Consulting architect was not found');
    if (String(architect.status || '').toLowerCase() === 'inactive') {
      throw new BadRequestException('Consulting architect is inactive');
    }
    return architect;
  }

  private normalizeQuoteMeta(meta: any, lines: any[]) {
    const parsed = typeof meta === 'string'
      ? (() => { try { return JSON.parse(meta); } catch { return {}; } })()
      : (meta || {});
    const areas = Array.from(new Set(this.normalizeLines(lines).map((line: any) => String(line.area || 'General Selection'))));
    return {
      preparedBy: parsed.preparedBy || '',
      showBrandLogos: parsed.showBrandLogos !== false,
      selectedBrandIds: Array.isArray(parsed.selectedBrandIds) ? parsed.selectedBrandIds.map(String) : undefined,
      terms: parsed.terms || 'Prices are valid until the quote validity date. Installation, civil work and unloading are excluded unless mentioned.',
      bankDetails: parsed.bankDetails || 'Bank details will be shared by Marble Park accounts team at order confirmation.',
      remarks: parsed.remarks && !/^prepared from quote studio\.?$/i.test(String(parsed.remarks).trim()) ? parsed.remarks : '',
      areas,
      ...parsed,
    };
  }

  private getLinesTotal(lines: any, quoteDiscountPercent = 0) {
    return priceQuoteLines(this.normalizeLines(lines), quoteDiscountPercent).totals.grandTotal;
  }

  private ensureCommercialReady(quote: any, action: string) {
    const lines = this.normalizeLines(quote?.lines);
    const pricing = priceQuoteLines(lines, quote?.discountPercent || 0, { requireMrp: true });
    const contractStartedAt = Date.UTC(2026, 7, 4);
    const isLegacy = !quote?.createdAt || new Date(quote.createdAt).getTime() < contractStartedAt;
    if (!isLegacy) {
      const missingIndex = lines.findIndex((line: any) => !line.mrpConfirmedAt || !line.mrpConfirmedById);
      if (missingIndex >= 0) {
        const line = lines[missingIndex];
        throw new BadRequestException({
          message: `Cannot ${action}: confirm MRP for ${line.sku || line.name || `line ${missingIndex + 1}`}.`,
          code: 'QUOTE_MRP_CONFIRMATION_REQUIRED',
          field: 'mrp',
          lineKey: line.lineKey || line.quoteLineId || String(missingIndex),
          remediation: 'Open the quote, verify MRP per selected UOM, then Validate changes.',
        });
      }
    }
    if (quote?.approvalStatus === 'pending' && !/approv/i.test(action)) {
      throw new BadRequestException(`Cannot ${action}: owner approval is still required for a below-floor rate.`);
    }
    return pricing;
  }

  private async createReservationsForSalesOrder(tx: any, args: { quote: any; salesOrder: any; lines: any[]; salesOrderLines: any[] }) {
    const { quote, salesOrder, lines, salesOrderLines } = args;
    const existing = await tx.reservation.count({ where: { salesOrderId: salesOrder.id } });
    if (existing > 0) return;

    for (const [index, line] of this.normalizeLines(lines).entries()) {
      const productId = line.productId;
      const quantity = Number(line.qty || line.quantity || 0);
      if (!productId || quantity <= 0) continue;
      const lineKey = String(line.lineKey || this.quoteLineKey(line, index));
      const salesOrderLine = salesOrderLines.find((row: any) => row.quoteLineId === line.quoteLineId || row.lineKey === lineKey);

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
            quoteId: quote.id || null,
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
          productId, quantity: reserveQty, actorUserId: quote.ownerId, quoteId: quote.id || null,
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
            quoteId: quote.id || null,
            salesOrderId: salesOrder.id,
            salesOrderLineId: salesOrderLine?.id || null,
            productId,
            quantity: backorderQty,
            status: 'backordered',
            updatedAt: new Date(),
          },
        });
      }
      if (salesOrderLine) {
        await tx.salesOrderLine.update({
          where: { id: salesOrderLine.id },
          data: {
            reservedQuantity: reserveQty,
            backorderedQuantity: backorderQty,
            status: backorderQty > 0 ? (reserveQty > 0 ? 'partial_ready' : 'backordered') : 'reserved',
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
        sourceQuoteId: quote.id || null,
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
        notes: `${salesOrder.orderNumber} shortage for ${quote.quoteNumber || 'direct order'}`,
        metadata: {
          orderNumber: salesOrder.orderNumber,
          quoteNumber: quote.quoteNumber || null,
          source: quote.id ? 'sales_order_conversion' : 'direct_sales_order',
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
