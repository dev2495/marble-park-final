import { Injectable, NotFoundException } from '@nestjs/common';
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

  async findAll(args?: { ownerId?: string; stage?: string; search?: string }): Promise<any[]> {
    const where: any = {};
    if (args?.ownerId) where.ownerId = args.ownerId;
    if (args?.stage) where.stage = args.stage;
    if (args?.search) {
      where.OR = [
        { title: { contains: args.search, mode: 'insensitive' } },
        { notes: { contains: args.search, mode: 'insensitive' } },
      ];
    }
    return this.prisma.lead.findMany({
      where,
      include: { customer: true, owner: true },
      orderBy: { createdAt: 'desc' },
    } as any) as any;
  }

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
    const intentRows = this.normalizeRows(data.intentRows);
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
        await tx.leadIntent.create({
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
            entityId: lead.id,
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
    const rows = this.normalizeRows(input.rows);
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
    const lead = await this.findById(intent.leadId);
    const rows = this.normalizeRows(intent.rows);
    const lines = await this.intentRowsToQuoteLines(rows);
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
    } as any);
    const pdfUrl = `/api/pdf/quote/${quote.id}`;
    await this.prisma.leadIntent.update({
      where: { id: intent.id },
      data: { status: 'quoted', quoteId: quote.id, updatedAt: new Date() },
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
        notes: `Quote ${quote.quoteNumber} ready from office. Share PDF: ${pdfUrl}`,
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
        title: 'Quote PDF generated',
        message: `${quote.quoteNumber} is ready from office. Share the PDF and continue follow-up.`,
        type: 'quote_generated',
        entityType: 'Quote',
        entityId: quote.id,
        href: `/dashboard/leads/${intent.leadId}`,
        targetUserId: intent.ownerId,
        metadata: { pdfUrl, intentId: intent.id, displayMode: quote.displayMode },
      },
      {
        title: 'Owner approval requested',
        message: `${quote.quoteNumber} was generated from an intent and needs approval before customer confirmation.`,
        type: 'approval',
        entityType: 'Quote',
        entityId: quote.id,
        href: '/dashboard/approvals',
        targetRole: 'owner',
        metadata: { intentId: intent.id },
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

  private async intentRowsToQuoteLines(rows: any[]) {
    const lines: any[] = [];
    for (const row of rows) {
      const isTile = row.type === 'tile' || String(row.category || '').toLowerCase() === 'tiles';
      if (isTile) {
        lines.push({
          type: 'tile',
          category: 'Tiles',
          sku: row.tileCode || row.sku || 'TILE-CODE-PENDING',
          name: `Tile ${row.tileCode || row.sku || ''} ${row.tileSize || row.size || ''}`.trim(),
          tileCode: row.tileCode || row.sku || '',
          tileSize: row.tileSize || row.size || '',
          uom: row.uom || 'box',
          pcsPerBox: Number(row.pcsPerBox || 0),
          qty: Number(row.qty || row.quantity || 0),
          price: Number(row.price || row.sellPrice || 0),
          area: row.area || row.room || 'General Selection',
          source: 'tile-intent',
        });
        continue;
      }
      let product: any = null;
      if (row.productId) product = await this.prisma.product.findUnique({ where: { id: row.productId } });
      if (!product && row.sku) product = await this.prisma.product.findUnique({ where: { sku: row.sku } }).catch(() => null);
      lines.push({
        productId: product?.id || row.productId || undefined,
        sku: product?.sku || row.sku || '',
        name: product?.name || row.name || row.description || row.sku || 'Catalogue item',
        category: product?.category || row.category || '',
        brand: product?.brand || row.brand || '',
        finish: product?.finish || row.finish || '',
        qty: Number(row.qty || row.quantity || 0),
        unit: row.unit || product?.unit || 'PC',
        price: Number(row.price || row.sellPrice || product?.sellPrice || 0),
        sellPrice: Number(row.price || row.sellPrice || product?.sellPrice || 0),
        media: product?.media || row.media || {},
        area: row.area || row.room || 'General Selection',
        quoteImage: row.quoteImage || row.customImageUrl || '',
        source: product ? 'inventory-or-catalogue' : 'manual-intent',
      });
    }
    return lines;
  }
}
