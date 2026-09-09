import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QuotesService } from '../quotes/quotes.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ulid } from 'ulid';

export interface CreateLeadInput {
  customerId: string;
  title: string;
  source?: string;
  ownerId: string;
  stage?: string;
  expectedValue?: number;
  notes?: string;
  nextActionAt?: Date;
  intentRows?: string;
  intentNotes?: string;
}

export interface UpdateLeadInput {
  title?: string;
  source?: string;
  ownerId?: string;
  stage?: string;
  expectedValue?: number;
  notes?: string;
  nextActionAt?: Date;
}

const LEAD_STAGES = ['new', 'contacted', 'qualified', 'proposal', 'quoted', 'negotiation', 'won', 'lost'];

@Injectable()
export class LeadsService {
  constructor(private prisma: PrismaService, private quotes: QuotesService, private notifications: NotificationsService) {}

  async completeFollowUp(id: string, outcome: string, user: any) {
    const note = String(outcome || '').trim();
    if (note.length < 3 || note.length > 2000) throw new BadRequestException('Record an outcome between 3 and 2,000 characters.');
    return this.prisma.$transaction(async tx => {
      const task = await tx.followUpTask.findUnique({ where: { id } });
      if (!task) throw new NotFoundException('Follow-up not found');
      if (task.ownerId !== user.id && !['owner','admin','sales_manager'].includes(user.role)) throw new ForbiddenException('Only the assigned salesperson or their manager can complete this follow-up.');
      if (task.status === 'completed') return task;
      if (!['pending','open'].includes(task.status)) throw new BadRequestException('This follow-up is no longer open.');
      const claimed = await tx.followUpTask.updateMany({ where: { id, status: { in: ['pending','open'] } }, data: { status: 'completed', updatedAt: new Date() } });
      if (!claimed.count) throw new BadRequestException('Follow-up changed. Refresh before trying again.');
      await tx.activity.create({ data: { id: ulid(), leadId: task.leadId, userId: user.id, type: 'followup_completed', message: note } });
      await tx.auditEvent.create({ data: { id: ulid(), actorUserId: user.id, action: 'followup.complete', entityType: 'FollowUpTask', entityId: id, summary: note, metadata: { leadId: task.leadId, previousStatus: task.status } } });
      return tx.followUpTask.findUnique({ where: { id } });
    });
  }

  /**
   * GraphQL-facing list. Returns BARE rows; resolver fans relations through
   * DataLoader so listing 100 leads triggers 1 findMany + 1 batched
   * Customer/User load instead of 1 + 100 + 100 selects.
   */
  async findAll(args?: { ownerId?: string; stage?: string; search?: string; take?: number; skip?: number }): Promise<any[]> {
    const where: any = {};
    if (args?.ownerId) where.ownerId = args.ownerId;
    if (args?.stage) where.stage = args.stage === 'proposal' ? { in: ['proposal', 'quoted'] } : args.stage;
    if (args?.search) {
      where.OR = [
        { title: { contains: args.search, mode: 'insensitive' } },
        { notes: { contains: args.search, mode: 'insensitive' } },
      ];
    }
    return this.prisma.lead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(Number(args?.take) || 50, 1), 101),
      skip: Math.max(Number(args?.skip) || 0, 0),
    } as any) as any;
  }

  /**
   * Single-lead read for the detail page. We DO eager-include the deep
   * relations (quotes, followUps, activities) here because they're rendered
   * on the same screen and don't benefit from DataLoader (they're 1:N from a
   * single lead). Customer + owner could go via DataLoader; we keep them
   * eager here to keep the detail-page payload self-contained.
   */
  async findById(id: string): Promise<any> {
    const lead = await this.prisma.lead.findUnique({
      where: { id },
      include: { customer: true, owner: true, quotes: true, followUps: true, activities: { orderBy: { createdAt: 'desc' } } },
    } as any) as any;
    if (!lead) throw new NotFoundException('Lead not found');
    const intents = await this.prisma.leadIntent.findMany({ where: { leadId: id }, orderBy: { createdAt: 'desc' } }).catch(() => []);
    return { ...lead, intents };
  }

  async create(data: CreateLeadInput, createdBy = 'system'): Promise<any> {
    const intentRows = await this.validateIntentRows(this.normalizeRows(data.intentRows));
    return this.prisma.$transaction(async (tx) => {
      const lead = await tx.lead.create({
        data: {
          id: ulid(),
          customerId: data.customerId,
          title: data.title,
          source: data.source || 'Website',
          ownerId: data.ownerId,
          stage: data.stage || 'new',
          expectedValue: data.expectedValue || this.getRowsTotal(intentRows),
          lastContactAt: new Date(),
          nextActionAt: data.nextActionAt || new Date(Date.now() + 86400000),
          notes: data.notes || '',
          updatedAt: new Date(),
        },
        include: { customer: true, owner: true },
      } as any) as any;

      if (intentRows.length) {
        const intent = await tx.leadIntent.create({
          data: {
            id: ulid(),
            leadId: lead.id,
            customerId: lead.customerId,
            ownerId: lead.ownerId,
            createdBy,
            status: 'pending_quote',
            intentType: this.detectIntentType(intentRows),
            source: 'lead_intake',
            notes: data.intentNotes || '',
            rows: intentRows,
            updatedAt: new Date(),
          },
        });
        await tx.activity.create({
          data: {
            id: ulid(),
            leadId: lead.id,
            userId: createdBy,
            type: 'intent_created',
            message: `Lead intent captured with ${intentRows.length} row(s).`,
          },
        }).catch(() => null);
        await tx.notification.create({
          data: {
            id: ulid(),
            title: 'New lead intent submitted',
            message: `${lead.title} has ${intentRows.length} selection row(s) waiting for office quote generation.`,
            type: 'intent_submitted',
            entityType: 'LeadIntent',
            entityId: intent.id,
            href: '/dashboard/intents',
            targetRole: 'office_staff',
            metadata: { leadId: lead.id, rowCount: intentRows.length },
          },
        }).catch(() => null);
      }
      return lead;
    });
  }

  async update(id: string, data: UpdateLeadInput): Promise<any> {
    await this.findById(id);
    return this.prisma.lead.update({
      where: { id },
      data,
      include: { customer: true, owner: true },
    } as any) as any;
  }

  async updateStage(id: string, stage: string): Promise<any> {
    if (!LEAD_STAGES.includes(stage)) {
      throw new Error(`Invalid stage: ${stage}`);
    }
    await this.findById(id);
    return this.prisma.lead.update({
      where: { id },
      data: { stage, lastContactAt: new Date() },
      include: { customer: true, owner: true },
    } as any) as any;
  }

  async delete(id: string) {
    await this.findById(id);
    return this.prisma.lead.delete({ where: { id } });
  }

  async timeline(leadId: string) {
    const lead = await this.findById(leadId);
    const quoteList: any[] = Array.isArray(lead.quotes) ? lead.quotes : [];
    const quoteIds = quoteList.map((quote: any) => quote.id).filter(Boolean);

    const [intents, dispatchJobs, challans, salesOrders] = await Promise.all([
      this.prisma.leadIntent.findMany({ where: { leadId }, orderBy: { createdAt: 'desc' } }),
      quoteIds.length ? this.prisma.dispatchJob.findMany({ where: { quoteId: { in: quoteIds } } }).catch(() => []) : [],
      quoteIds.length ? this.prisma.dispatchChallan.findMany({ where: { quoteId: { in: quoteIds } } }).catch(() => []) : [],
      quoteIds.length ? this.prisma.salesOrder.findMany({ where: { quoteId: { in: quoteIds } } }).catch(() => []) : [],
    ]);
    const orderIds = (salesOrders as any[]).map((order) => order.id).filter(Boolean);
    const challanIds = (challans as any[]).map((challan) => challan.id).filter(Boolean);
    const [paymentReceipts, returnOrders] = await Promise.all([
      orderIds.length ? this.prisma.paymentReceipt.findMany({ where: { salesOrderId: { in: orderIds } }, orderBy: { receivedAt: 'desc' } }).catch(() => []) : [],
      orderIds.length || challanIds.length
        ? this.prisma.returnOrder.findMany({
            where: {
              OR: [
                ...(orderIds.length ? [{ salesOrderId: { in: orderIds } }] : []),
                ...(challanIds.length ? [{ challanId: { in: challanIds } }] : []),
              ],
            },
            orderBy: { createdAt: 'desc' },
          }).catch(() => [])
        : [],
    ]);

    const quoteIndex = new Map(quoteList.map((quote: any) => [quote.id, quote]));
    const heads = quoteList.filter((quote: any) => !quote.supersededByQuoteId);
    const chains = heads.map((head: any) => {
      const versions: any[] = [];
      let current = head;
      while (current) {
        versions.push(current);
        current = current.supersedesQuoteId ? quoteIndex.get(current.supersedesQuoteId) : null;
      }
      versions.sort((a: any, b: any) => Number(a.versionNumber || 1) - Number(b.versionNumber || 1));
      return { headQuoteId: head.id, versions };
    });

    const entries: Array<{ id: string; kind: string; at: Date; payload: any }> = [];
    const push = (kind: string, id: string, at: any, payload: any) => {
      if (!at) return;
      entries.push({ id: `${kind}:${id}`, kind, at: new Date(at), payload });
    };
    for (const intent of intents as any[]) push('intent', intent.id, intent.createdAt, intent);
    for (const quote of quoteList) push('quote', quote.id, quote.createdAt, quote);
    for (const activity of (lead.activities || []) as any[]) push('activity', activity.id, activity.createdAt, activity);
    for (const followUp of (lead.followUps || []) as any[]) push('followup', followUp.id, followUp.createdAt || followUp.dueAt, followUp);
    for (const job of dispatchJobs as any[]) push('dispatch_job', job.id, job.createdAt, job);
    for (const challan of challans as any[]) push('challan', challan.id, challan.createdAt, challan);
    for (const order of salesOrders as any[]) push('order', order.id, order.createdAt, order);
    for (const receipt of paymentReceipts as any[]) push('payment_receipt', receipt.id, receipt.receivedAt || receipt.createdAt, receipt);
    for (const returnOrder of returnOrders as any[]) push('return_order', returnOrder.id, returnOrder.createdAt, returnOrder);
    entries.sort((a, b) => b.at.getTime() - a.at.getTime());

    return {
      lead,
      chains,
      inFlight: {
        activeIntents: (intents as any[]).filter((intent) => ['draft', 'pending_quote', 'in_quote'].includes(intent.status)),
        activeQuotes: chains
          .map((chain) => chain.versions[chain.versions.length - 1])
          .filter((quote) => quote && !['superseded', 'lost', 'expired', 'won'].includes(quote.status)),
      },
      entries,
    };
  }

  async findIntents(args?: { status?: string; leadId?: string; ownerId?: string }) {
    const where: any = {};
    if (args?.status) where.status = args.status;
    if (args?.leadId) where.leadId = args.leadId;
    if (args?.ownerId) where.ownerId = args.ownerId;
    const intents = await this.prisma.leadIntent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const leadIds = Array.from(new Set(intents.map((intent) => intent.leadId)));
    const customerIds = Array.from(new Set(intents.map((intent) => intent.customerId)));
    const ownerIds = Array.from(new Set(intents.map((intent) => intent.ownerId)));
    const [leads, customers, owners] = await Promise.all([
      this.prisma.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, title: true, stage: true } }),
      this.prisma.customer.findMany({ where: { id: { in: customerIds } } }),
      this.prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true, email: true, role: true, phone: true, active: true } }),
    ]);
    const leadMap = new Map(leads.map((lead) => [lead.id, lead]));
    const customerMap = new Map(customers.map((customer) => [customer.id, customer]));
    const ownerMap = new Map(owners.map((owner) => [owner.id, owner]));
    return intents.map((intent) => ({
      ...intent,
      lead: leadMap.get(intent.leadId),
      customer: customerMap.get(intent.customerId),
      owner: ownerMap.get(intent.ownerId),
    }));
  }

  async createIntent(input: { leadId: string; rows?: string; notes?: string; intentType?: string; followUpReason?: string }, createdBy: string, role: string) {
    const lead = await this.findById(input.leadId);
    if (!['admin', 'owner', 'sales_manager', 'office_staff'].includes(role) && lead.ownerId !== createdBy) {
      throw new Error('This lead is restricted');
    }
    const rows = await this.validateIntentRows(this.normalizeRows(input.rows));
    if (!rows.length) throw new Error('At least one intent row is required');
    const intent = await this.prisma.leadIntent.create({
      data: {
        id: ulid(),
        leadId: lead.id,
        customerId: lead.customerId,
        ownerId: lead.ownerId,
        createdBy,
        status: 'pending_quote',
        intentType: input.intentType || this.detectIntentType(rows),
        source: input.followUpReason ? 'follow_up' : 'manual',
        notes: input.notes || '',
        followUpReason: input.followUpReason || '',
        rows,
        updatedAt: new Date(),
      },
    });
    await this.prisma.activity.create({
      data: {
        id: ulid(),
        leadId: lead.id,
        userId: createdBy,
        type: 'intent_created',
        message: `New ${intent.intentType} intent captured${input.followUpReason ? ` after ${input.followUpReason}` : ''}.`,
      },
    }).catch(() => null);
    await this.notifications.create({
      title: 'Follow-up intent submitted',
      message: `${lead.title} has a new ${intent.intentType} intent ready for office quote generation.`,
      type: 'intent_submitted',
      entityType: 'LeadIntent',
      entityId: intent.id,
      href: '/dashboard/intents',
      targetRole: 'office_staff',
      metadata: { leadId: lead.id, followUpReason: input.followUpReason || '' },
    });
    await this.prisma.lead.update({
      where: { id: lead.id },
      data: { stage: 'proposal', nextActionAt: new Date(Date.now() + 86400000), updatedAt: new Date() },
    }).catch(() => null);
    return intent;
  }

  async generateQuoteFromIntent(intentId: string, createdBy: string, note?: string, displayMode?: string) {
    const intent = await this.prisma.leadIntent.findUnique({ where: { id: intentId } });
    if (!intent) throw new NotFoundException('Lead intent not found');
    if (intent.quoteId) throw new Error('This intent already has a quote');
    if (['cancelled', 'converted', 'quoted'].includes(intent.status)) {
      throw new BadRequestException(`Intent is ${intent.status}, cannot generate quote.`);
    }
    const lead = await this.findById(intent.leadId);
    const rows = this.normalizeRows(intent.rows);
    const lines = await this.intentRowsToQuoteLines(rows);
    const referencesQuoteId = (intent as any).referencesQuoteId || null;
    const parentQuote = referencesQuoteId
      ? await this.prisma.quote.findUnique({ where: { id: referencesQuoteId } })
      : null;
    const quote = await this.quotes.create({
      leadId: intent.leadId,
      customerId: intent.customerId,
      ownerId: intent.ownerId,
      title: `${lead.title} - intent quote`,
      projectName: lead.title,
      notes: note || intent.notes || 'Generated from product intent.',
      lines,
      displayMode: String(displayMode || '').toLowerCase() === 'selection' ? 'selection' : 'priced',
      quoteMeta: {
        preparedBy: createdBy,
        areas: Array.from(new Set(lines.map((line) => line.area || 'General Selection'))),
        remarks: note || intent.notes || '',
      },
      intentId: intent.id,
      supersedesQuoteId: referencesQuoteId,
      architectId: (parentQuote as any)?.architectId || undefined,
      saveAsDraft: true,
    } as any);
    const incompletePricing = (quote.lines || []).some((line: any) => line.mrpMissing || !line.mrpValid);
    const pdfUrl = `/api/pdf/quote/${quote.id}`;
    await this.prisma.leadIntent.update({
      where: { id: intent.id },
      data: { status: 'converted', quoteId: quote.id, lockedBy: null, lockedAt: null, updatedAt: new Date() } as any,
    });
    await this.prisma.lead.update({
      where: { id: intent.leadId },
      data: { stage: 'quoted', nextActionAt: new Date(Date.now() + 86400000), updatedAt: new Date() },
    });
    await this.prisma.followUpTask.create({
      data: {
        id: ulid(),
        leadId: intent.leadId,
        ownerId: intent.ownerId,
        dueAt: new Date(Date.now() + 86400000),
        status: 'pending',
        notes: incompletePricing ? `Complete missing pricing for ${quote.quoteNumber} before sharing.` : quote.approvalStatus === 'pending' ? `Follow up on price approval for ${quote.quoteNumber} before confirmation.` : `Follow up with the customer on ${quote.quoteNumber}.`,
        updatedAt: new Date(),
      },
    }).catch(() => null);
    await this.prisma.activity.create({
      data: {
        id: ulid(),
        leadId: intent.leadId,
        quoteId: quote.id,
        userId: createdBy,
        type: 'quote_generated_from_intent',
        message: `Office generated ${quote.quoteNumber}. PDF: ${pdfUrl}`,
      },
    }).catch(() => null);
    await this.notifications.createMany([
      {
        title: incompletePricing ? 'Quote pricing needs completion' : quote.approvalStatus === 'pending' ? 'Quote awaiting price approval' : 'Quote prepared by office',
        message: incompletePricing
          ? `${quote.quoteNumber} is saved as a draft. Add MRP to every line before sharing or confirming.`
          : quote.approvalStatus === 'pending' ? `${quote.quoteNumber} needs price approval before confirmation.` : `${quote.quoteNumber} is ready from office. Open the quote to share its PDF.`,
        type: 'quote_generated',
        entityType: 'Quote',
        entityId: quote.id,
        href: `/dashboard/leads/${intent.leadId}`,
        targetUserId: intent.ownerId,
        metadata: { pdfUrl, intentId: intent.id, displayMode: quote.displayMode, incompletePricing },
      },
      {
        title: 'Quotation status updated',
        message: incompletePricing
          ? `${quote.quoteNumber} was generated from an intent and needs MRP completion before commercial actions.`
          : quote.approvalStatus === 'pending' ? `${quote.quoteNumber} requires price approval before confirmation.` : `${quote.quoteNumber} was prepared from an intent with complete pricing.`,
        type: 'quote_ready',
        entityType: 'Quote',
        entityId: quote.id,
        href: `/dashboard/quotes/${quote.id}`,
        targetRole: 'owner',
        metadata: { intentId: intent.id, pdfUrl, displayMode: quote.displayMode, incompletePricing },
      },
      {
        title: 'Quotation status updated',
        message: incompletePricing
          ? `${quote.quoteNumber} was generated from an intent and needs MRP completion before confirmation.`
          : quote.approvalStatus === 'pending' ? `${quote.quoteNumber} requires price approval before confirmation.` : `${quote.quoteNumber} was prepared from an intent with complete pricing.`,
        type: 'quote_ready',
        entityType: 'Quote',
        entityId: quote.id,
        href: `/dashboard/quotes/${quote.id}`,
        targetRole: 'admin',
        metadata: { intentId: intent.id, pdfUrl, displayMode: quote.displayMode, incompletePricing },
      },
    ]);
    return { intentId: intent.id, quote, pdfUrl };
  }

  async getDashboardStats() {
    const [newLeads, contacted, qualified, proposal, negotiation, won, lost] = await Promise.all([
      this.prisma.lead.count({ where: { stage: 'new' } }),
      this.prisma.lead.count({ where: { stage: 'contacted' } }),
      this.prisma.lead.count({ where: { stage: 'qualified' } }),
      this.prisma.lead.count({ where: { stage: 'proposal' } }),
      this.prisma.lead.count({ where: { stage: 'negotiation' } }),
      this.prisma.lead.count({ where: { stage: 'won' } }),
      this.prisma.lead.count({ where: { stage: 'lost' } }),
    ]);

    return {
      new: newLeads,
      contacted,
      qualified,
      proposal,
      negotiation,
      won,
      lost,
      total: newLeads + contacted + qualified + proposal + negotiation + won + lost,
    };
  }

  private normalizeRows(rows: any): any[] {
    if (!rows) return [];
    if (typeof rows === 'string') {
      try {
        const parsed = JSON.parse(rows);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return Array.isArray(rows) ? rows : [];
  }

  private detectIntentType(rows: any[]) {
    return rows.some((row) => String(row.category || '').toLowerCase() === 'tiles' || row.type === 'tile') ? 'mixed_or_tiles' : 'catalogue_items';
  }

  private getRowsTotal(rows: any[]) {
    return rows.reduce((sum, row) => sum + Number(row.qty || row.quantity || 0) * Number(row.price || row.sellPrice || 0), 0);
  }

  private isTileRow(row: any) {
    return row?.type === 'tile' || String(row?.category || '').toLowerCase() === 'tiles';
  }

  private normalizeTileRow(row: any) {
    const qty = Math.trunc(Number(row.qty || row.quantity || 0));
    const tileCode = String(row.tileCode || row.sku || '').trim();
    const tileSize = String(row.tileSize || row.size || row.dimensions || '').trim();
    const uom = String(row.uom || row.unit || 'box').toLowerCase() === 'pc' ? 'pc' : 'box';
    if (!tileCode) throw new BadRequestException('Tile intent rows need a tile code');
    if (!tileSize) throw new BadRequestException(`Tile ${tileCode} needs a tile size`);
    if (!Number.isFinite(qty) || qty <= 0) throw new BadRequestException(`Tile ${tileCode} needs a positive whole-number quantity`);
    const price = Number(row.price || row.sellPrice || 0);
    if (!Number.isFinite(price) || price < 0) throw new BadRequestException(`Tile ${tileCode} has an invalid price`);
    return {
      ...row,
      type: 'tile',
      category: 'Tiles',
      productId: String(row.productId || '').trim(),
      sku: String(row.sku || tileCode).trim(),
      name: String(row.name || `Tile ${tileCode} ${tileSize}`).trim(),
      tileCode,
      tileSize,
      dimensions: tileSize,
      qty,
      quantity: qty,
      uom,
      unit: uom === 'box' ? 'BOX' : 'PC',
      pcsPerBox: Number(row.pcsPerBox || 0),
      price,
      indicativeNrpInclusive: price,
      area: row.area || row.room || 'General Selection',
      source: 'product-master-tile',
      inventoryTracked: true,
      nonStock: false,
    };
  }

  private async validateIntentRows(rows: any[]) {
    const activeRows = rows
      .map((row) => ({ ...row, productId: String(row.productId || '').trim(), qty: Number(row.qty || row.quantity || 0) }))
      .filter((row) => row.qty > 0);

    if (!activeRows.length) return [];

    const productRows = activeRows;
    const missingProduct = productRows.find((row) => !row.productId);
    if (missingProduct) {
      throw new BadRequestException(
        'Every intent row, including tile designs, must use a Product Master SKU. Create or select the SKU in Product Master before making an intent or quote.',
      );
    }

    const productIds = Array.from(new Set(productRows.map((row) => row.productId)));
    type LeadIntentProductRow = {
      id: string;
      sku: string;
      name: string;
      category: string;
      brand: string;
      finish: string | null;
      unit: string;
      defaultMrpInclusive: any;
      defaultNrpInclusive: any;
      priceRateBasis: string | null;
      media: any;
    };
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, status: 'active' },
      select: {
        id: true,
        sku: true,
        name: true,
        category: true,
        brand: true,
        finish: true,
        unit: true,
        defaultMrpInclusive: true,
        defaultNrpInclusive: true,
        priceRateBasis: true,
        media: true,
      },
    }) as LeadIntentProductRow[];
    const productMap = new Map(products.map((product) => [product.id, product]));
    const missingIds = productIds.filter((id) => !productMap.has(id));
    if (missingIds.length) {
      throw new BadRequestException(`Product Master SKU missing or inactive for ${missingIds.length} intent row(s).`);
    }

    return activeRows.map((row) => {
      const product = productMap.get(row.productId)!;
      if (this.isTileRow(row)) return this.normalizeTileRow({
        ...row,
        productId: product.id,
        sku: product.sku,
        name: product.name,
        brand: product.brand,
        finish: product.finish || row.finish || '',
        unit: row.unit || product.unit || 'BOX',
        price: Number(row.price || row.sellPrice || product.defaultNrpInclusive || 0),
        media: product.media || row.media || {},
      });
      const price = Number(row.price || row.sellPrice || product.defaultNrpInclusive || 0);
      if (!Number.isFinite(price) || price < 0) throw new BadRequestException(`${product.sku} has an invalid price`);
      return {
        ...row,
        productId: product.id,
        sku: product.sku,
        name: product.name,
        category: product.category,
        brand: product.brand,
        finish: product.finish || row.finish || '',
        unit: row.unit || product.unit || 'PC',
        qty: Math.trunc(row.qty),
        quantity: Math.trunc(row.qty),
        price,
        indicativeNrpInclusive: price,
        media: product.media || row.media || {},
        area: row.area || row.room || 'General Selection',
        source: 'product-master',
        inventoryTracked: true,
      };
    });
  }

  private async intentRowsToQuoteLines(rows: any[]) {
    const lines: any[] = [];
    for (const row of rows) {
      const isTile = row.type === 'tile' || String(row.category || '').toLowerCase() === 'tiles';
      if (isTile) {
        lines.push(this.normalizeTileRow(row));
        continue;
      }
      let product: any = null;
      if (row.productId) product = await this.prisma.product.findUnique({ where: { id: row.productId } });
      if (!product && row.sku) product = await this.prisma.product.findUnique({ where: { sku: row.sku } }).catch(() => null);
      if (!product || product.status !== 'active') {
        throw new BadRequestException('Quote generation requires active Product Master rows. Re-select the SKU and try again.');
      }
      lines.push({
        productId: product.id,
        sku: product.sku,
        name: product.name,
        category: product.category,
        brand: product.brand,
        finish: product.finish || row.finish || '',
        qty: Number(row.qty || row.quantity || 0),
        unit: row.unit || product?.unit || 'PC',
        mrpInclusive: row.mrpInclusive ?? row.mrp ?? (product.defaultMrpInclusive == null ? null : Number(product.defaultMrpInclusive)),
        nrpMode: row.nrpMode || row.baseDecisionMode || 'FIXED_NRP',
        nrpInput: row.nrpInput ?? row.baseDecisionValue ?? row.nrpInclusive ?? row.price ?? row.sellPrice ?? (product.defaultNrpInclusive == null ? 0 : Number(product.defaultNrpInclusive)),
        specialMode: row.specialMode || row.specialDecisionMode || 'NONE',
        specialInput: row.specialInput ?? row.specialDecisionValue ?? 0,
        priceRateBasis: row.priceRateBasis || row.mrpRateBasis || row.rateBasis || product.priceRateBasis || null,
        mrpSource: row.mrpSource || 'quote_entry',
        taxRate: row.taxRate === undefined ? 18 : Number(row.taxRate),
        media: product.media || row.media || {},
        area: row.area || row.room || 'General Selection',
        quoteImage: row.quoteImage || row.customImageUrl || '',
        source: 'product-master',
        inventoryTracked: true,
      });
    }
    return lines;
  }
}
