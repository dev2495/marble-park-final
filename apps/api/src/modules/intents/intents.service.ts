import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ulid } from 'ulid';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';

// Intent states — single source of truth.
// draft           -> sales is still building the selection
// pending_quote   -> submitted to office, sales may still edit until staff picks up
// in_quote        -> office staff has the lock, sales cannot edit
// converted       -> priced quote built from this intent (frozen for audit)
// cancelled       -> customer/sales dropped this round (frozen for audit)
export const INTENT_STATES = ['draft', 'pending_quote', 'in_quote', 'converted', 'cancelled'] as const;
export type IntentState = (typeof INTENT_STATES)[number];

export const INTENT_TYPES = ['initial', 'revision', 'followup', 'replacement'] as const;
export type IntentType = (typeof INTENT_TYPES)[number];

// Stale-lock threshold. Office staff lock auto-falls back to pending_quote
// after this much idle time so a forgotten browser tab doesn't block sales.
const LOCK_TTL_MS = 30 * 60 * 1000;

export interface IntentRow {
  productId?: string;
  sku?: string;
  name?: string;
  category?: string;
  brand?: string;
  finish?: string;
  qty?: number;
  quantity?: number;
  price?: number;
  sellPrice?: number;
  unit?: string;
  area?: string;
  room?: string;
  notes?: string;
  // tile shorthand path
  tileCode?: string;
  tileSize?: string;
  pcsPerBox?: number;
  uom?: string;
  type?: string;
}

@Injectable()
export class IntentsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private notifications: NotificationsService,
  ) {}

  // ---------- lookups ----------

  async findOne(id: string) {
    const intent = await this.maybeAutoRelease(await this.getRaw(id));
    return this.attachRelations([intent]).then((rows) => rows[0]);
  }

  async list(args: { status?: string; leadId?: string; ownerId?: string; lockedBy?: string; pendingOnly?: boolean; mineOnly?: boolean; userId?: string }) {
    const where: any = {};
    if (args.status) where.status = args.status;
    if (args.pendingOnly) where.status = { in: ['pending_quote', 'in_quote'] };
    if (args.leadId) where.leadId = args.leadId;
    if (args.ownerId) where.ownerId = args.ownerId;
    if (args.lockedBy) where.lockedBy = args.lockedBy;
    if (args.mineOnly && args.userId) where.ownerId = args.userId;
    const rows = await this.prisma.leadIntent.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
    const released = await Promise.all(rows.map((row) => this.maybeAutoRelease(row)));
    return this.attachRelations(released);
  }

  // ---------- mutations ----------

  // Create an intent attached to an existing lead. intentType is set by the
  // caller; for revision intents the referencesQuoteId must point at an
  // existing quote and the rows are typically seeded from that quote.
  async create(
    input: {
      leadId: string;
      rows: IntentRow[] | string;
      notes?: string | null;
      intentType?: IntentType;
      followUpReason?: string | null;
      referencesQuoteId?: string | null;
      // When true, the intent enters pending_quote immediately. When false,
      // it stays in draft so the sales rep can keep editing before submitting.
      submit?: boolean;
    },
    actor: { id: string; role: string },
  ) {
    const lead = await this.prisma.lead.findUnique({ where: { id: input.leadId } });
    if (!lead) throw new NotFoundException('Lead not found');
    this.assertLeadAccess(lead, actor);

    let referencesQuote = null as any;
    if (input.referencesQuoteId) {
      referencesQuote = await this.prisma.quote.findUnique({ where: { id: input.referencesQuoteId } });
      if (!referencesQuote) throw new NotFoundException('Referenced quote not found');
      if (referencesQuote.leadId !== lead.id) {
        throw new BadRequestException('Referenced quote does not belong to this lead');
      }
      if (referencesQuote.supersededByQuoteId) {
        throw new BadRequestException('Referenced quote is already superseded. Revise the current quote version.');
      }
    }

    const rows = await this.validateRows(this.normalizeRows(input.rows));
    if (!rows.length && input.submit) {
      throw new BadRequestException('Cannot submit an empty intent. Add at least one row.');
    }

    const intentType = (input.intentType || (referencesQuote ? 'revision' : 'initial')) as IntentType;
    const initialStatus: IntentState = input.submit ? 'pending_quote' : 'draft';
    const created = await this.prisma.leadIntent.create({
      data: {
        id: ulid(),
        leadId: lead.id,
        customerId: lead.customerId,
        ownerId: lead.ownerId,
        createdBy: actor.id,
        status: initialStatus,
        intentType,
        source: input.followUpReason ? 'follow_up' : referencesQuote ? 'quote_revision' : 'manual',
        notes: input.notes || '',
        followUpReason: input.followUpReason || '',
        rows: rows as any,
        referencesQuoteId: referencesQuote?.id ?? null,
        submittedAt: input.submit ? new Date() : null,
        updatedAt: new Date(),
      } as any,
    });

    // Bookkeeping side effects.
    await this.recordActivity(lead.id, actor.id, 'intent.created', `New ${intentType} intent captured${input.submit ? ' and submitted to office' : ' as draft'}.`);
    await this.audit.record({
      actorUserId: actor.id,
      action: 'intent.create',
      entityType: 'LeadIntent',
      entityId: created.id,
      summary: `${intentType} intent for lead ${lead.title}`,
      metadata: { leadId: lead.id, rowCount: rows.length, intentType, submitted: !!input.submit, referencesQuoteId: referencesQuote?.id ?? null },
    });
    if (input.submit) {
      await this.notifyPendingIntent(created, lead);
    }
    await this.maybeReopenLead(lead, intentType, actor.id);
    return this.attachRelations([created]).then((r) => r[0]);
  }

  // Update an intent in draft / pending_quote. The lead owner + manager + admin
  // can edit at any time before office staff picks it up. While in_quote, only
  // the locking staff member may edit (this enables in-flight quote-building).
  async update(
    id: string,
    input: { rows?: IntentRow[] | string; notes?: string | null; followUpReason?: string | null },
    actor: { id: string; role: string },
  ) {
    const intent = await this.maybeAutoRelease(await this.getRaw(id));
    this.assertEditable(intent, actor);
    const data: any = { updatedAt: new Date() };
    if (input.rows !== undefined) {
      const rows = await this.validateRows(this.normalizeRows(input.rows));
      data.rows = rows;
    }
    if (input.notes !== undefined) data.notes = input.notes || '';
    if (input.followUpReason !== undefined) data.followUpReason = input.followUpReason || '';
    const updated = await this.prisma.leadIntent.update({ where: { id }, data });
    await this.recordActivity(intent.leadId, actor.id, 'intent.edited', `Intent updated while ${intent.status}.`);
    return this.attachRelations([updated]).then((r) => r[0]);
  }

  // Move a draft intent into pending_quote so office staff sees it.
  async submit(id: string, actor: { id: string; role: string }) {
    const intent = await this.maybeAutoRelease(await this.getRaw(id));
    if (intent.status !== 'draft') {
      throw new BadRequestException(`Intent is already ${intent.status}, cannot submit again.`);
    }
    this.assertEditable(intent, actor);
    const rows = this.normalizeRows(intent.rows);
    if (!rows.length) throw new BadRequestException('Cannot submit an empty intent.');
    const updated = await this.prisma.leadIntent.update({
      where: { id },
      data: { status: 'pending_quote', submittedAt: new Date(), updatedAt: new Date() },
    });
    const lead = await this.prisma.lead.findUnique({ where: { id: intent.leadId } });
    await this.recordActivity(intent.leadId, actor.id, 'intent.submitted', 'Intent submitted to office for pricing.');
    if (lead) await this.notifyPendingIntent(updated, lead);
    await this.audit.record({
      actorUserId: actor.id,
      action: 'intent.submit',
      entityType: 'LeadIntent',
      entityId: id,
      summary: `Intent for ${lead?.title || 'lead'} submitted to office`,
    });
    return this.attachRelations([updated]).then((r) => r[0]);
  }

  // Office staff claims a pending intent, preventing sales-side edits.
  async pickUp(id: string, actor: { id: string; role: string }) {
    if (!['admin', 'owner', 'sales_manager', 'office_staff'].includes(actor.role)) {
      throw new ForbiddenException('Only office staff or managers can pick up intents.');
    }
    const intent = await this.maybeAutoRelease(await this.getRaw(id));
    if (intent.status === 'in_quote') {
      if (intent.lockedBy === actor.id) return this.attachRelations([intent]).then((r) => r[0]);
      throw new BadRequestException('Another user has already picked up this intent.');
    }
    if (intent.status !== 'pending_quote') {
      throw new BadRequestException(`Intent is ${intent.status}, cannot pick up.`);
    }
    const updated = await this.prisma.leadIntent.update({
      where: { id },
      data: { status: 'in_quote', lockedBy: actor.id, lockedAt: new Date(), updatedAt: new Date() },
    });
    await this.recordActivity(intent.leadId, actor.id, 'intent.picked_up', 'Office staff started building the quote.');
    return this.attachRelations([updated]).then((r) => r[0]);
  }

  // Voluntarily drop the lock — back to pending_quote so others can pick up
  // or the lead owner can edit. Force=true (admin/manager) ignores ownership.
  async release(id: string, actor: { id: string; role: string }, force = false) {
    const intent = await this.maybeAutoRelease(await this.getRaw(id));
    if (intent.status !== 'in_quote') {
      throw new BadRequestException(`Intent is ${intent.status}, nothing to release.`);
    }
    if (!force && intent.lockedBy !== actor.id && !['admin', 'owner', 'sales_manager'].includes(actor.role)) {
      throw new ForbiddenException('Only the locker or a manager can release this intent.');
    }
    const updated = await this.prisma.leadIntent.update({
      where: { id },
      data: { status: 'pending_quote', lockedBy: null, lockedAt: null, updatedAt: new Date() },
    });
    await this.recordActivity(intent.leadId, actor.id, 'intent.released', force ? 'Lock force-released by manager.' : 'Office staff released the intent back to the queue.');
    return this.attachRelations([updated]).then((r) => r[0]);
  }

  // Sales nudges staff to release a locked intent because the customer just
  // requested another change. Doesn't mutate state — only sends a notification.
  async requestChanges(id: string, actor: { id: string; role: string }, message?: string) {
    const intent = await this.maybeAutoRelease(await this.getRaw(id));
    if (intent.status !== 'in_quote') {
      throw new BadRequestException(`Intent is ${intent.status}, nothing to request changes on.`);
    }
    const lead = await this.prisma.lead.findUnique({ where: { id: intent.leadId } });
    await this.notifications.create({
      title: 'Intent edit requested',
      message: `${actor.id} wants to edit the intent for ${lead?.title || 'a lead'}. ${message ? `"${message.slice(0, 120)}"` : 'Please release the lock when ready.'}`,
      type: 'intent_edit_requested',
      entityType: 'LeadIntent',
      entityId: id,
      href: '/dashboard/intents',
      targetUserId: intent.lockedBy || undefined,
      metadata: { leadId: intent.leadId, requestedBy: actor.id, message: message || null },
    }).catch(() => null);
    await this.recordActivity(intent.leadId, actor.id, 'intent.edit_requested', `Edit requested while ${intent.lockedBy ? 'staff has lock' : 'in_quote'}.`);
    return { success: true };
  }

  async cancel(id: string, actor: { id: string; role: string }, reason?: string) {
    const intent = await this.maybeAutoRelease(await this.getRaw(id));
    if (intent.status === 'converted' || intent.status === 'quoted') {
      throw new BadRequestException('Converted intents cannot be cancelled. Cancel the resulting quote instead.');
    }
    if (intent.status === 'cancelled') return this.attachRelations([intent]).then((r) => r[0]);
    this.assertEditable(intent, actor, { allowInQuoteForManagers: true });
    const updated = await this.prisma.leadIntent.update({
      where: { id },
      data: { status: 'cancelled', lockedBy: null, lockedAt: null, updatedAt: new Date() },
    });
    await this.recordActivity(intent.leadId, actor.id, 'intent.cancelled', reason ? `Cancelled: ${reason}` : 'Intent cancelled.');
    await this.audit.record({
      actorUserId: actor.id,
      action: 'intent.cancel',
      entityType: 'LeadIntent',
      entityId: id,
      summary: `Cancelled intent (${intent.intentType})`,
      metadata: { reason: reason || null },
    });
    return this.attachRelations([updated]).then((r) => r[0]);
  }

  // Convenience for the lead detail page — pre-fill a new revision intent
  // from an existing quote's lines. Returns the new draft intent so the UI
  // can navigate to the editor.
  async startRevisionFromQuote(quoteId: string, actor: { id: string; role: string }) {
    const quote = await this.prisma.quote.findUnique({ where: { id: quoteId } });
    if (!quote) throw new NotFoundException('Quote not found');
    if (quote.supersededByQuoteId) {
      throw new BadRequestException('This quote has already been superseded. Revise the head quote instead.');
    }
    const rows = (Array.isArray(quote.lines) ? quote.lines : []) as any[];
    const lead = await this.prisma.lead.findUnique({ where: { id: quote.leadId } });
    if (!lead) throw new NotFoundException('Lead not found');
    this.assertLeadAccess(lead, actor);
    return this.create(
      {
        leadId: quote.leadId,
        rows: rows.map((row) => ({ ...row })) as any,
        notes: `Revision of ${quote.quoteNumber}`,
        intentType: 'revision',
        referencesQuoteId: quote.id,
        submit: false,
      },
      actor,
    );
  }

  // ---------- helpers ----------

  private async getRaw(id: string) {
    const intent = await this.prisma.leadIntent.findUnique({ where: { id } });
    if (!intent) throw new NotFoundException('Intent not found');
    return intent;
  }

  // Auto-release stale locks. Cheap to call on every read since the lock
  // window is short — keeps the queue UI honest without a cron job.
  private async maybeAutoRelease(intent: any) {
    if (intent.status !== 'in_quote' || !intent.lockedAt) return intent;
    const age = Date.now() - new Date(intent.lockedAt).getTime();
    if (age < LOCK_TTL_MS) return intent;
    const updated = await this.prisma.leadIntent.update({
      where: { id: intent.id },
      data: { status: 'pending_quote', lockedBy: null, lockedAt: null, updatedAt: new Date() },
    });
    await this.recordActivity(intent.leadId, 'system', 'intent.released', 'Stale lock auto-released after 30 minutes idle.');
    return updated;
  }

  private assertEditable(intent: any, actor: { id: string; role: string }, opts: { allowInQuoteForManagers?: boolean } = {}) {
    if (intent.status === 'converted' || intent.status === 'quoted' || intent.status === 'cancelled') {
      throw new BadRequestException(`Intent is ${intent.status} and frozen for audit.`);
    }
    const isManager = ['admin', 'owner', 'sales_manager'].includes(actor.role);
    if (intent.status === 'in_quote') {
      if (intent.lockedBy === actor.id) return;
      if (opts.allowInQuoteForManagers && isManager) return;
      throw new ForbiddenException('Office staff is currently building the quote. Use "Request changes" to ask for a release.');
    }
    // draft / pending_quote — owner of the lead, or any manager/office staff
    const ownerOk = intent.ownerId === actor.id || intent.createdBy === actor.id;
    if (!ownerOk && !isManager && actor.role !== 'office_staff') {
      throw new ForbiddenException('Only the lead owner, office staff, or a manager can edit this intent.');
    }
  }

  private assertLeadAccess(lead: any, actor: { id: string; role: string }) {
    const isManager = ['admin', 'owner', 'sales_manager'].includes(actor.role);
    if (!isManager && actor.role !== 'office_staff' && lead.ownerId !== actor.id) {
      throw new ForbiddenException('This lead is restricted.');
    }
  }

  private normalizeRows(rows: any): IntentRow[] {
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

  private isTileRow(row: IntentRow) {
    return row?.type === 'tile' || String(row?.category || '').toLowerCase() === 'tiles';
  }

  private normalizeTileRow(row: IntentRow) {
    const qty = Math.trunc(Number(row.qty || row.quantity || 0));
    const tileCode = String(row.tileCode || row.sku || '').trim();
    const tileSize = String(row.tileSize || (row as any).size || '').trim();
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
      productId: undefined,
      sku: tileCode,
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
      sellPrice: price,
      area: row.area || row.room || 'General Selection',
      source: 'tile-intent',
      inventoryTracked: false,
      nonStock: true,
    };
  }

  // Validate that intent rows reference real, active products. Non-stock tile
  // rows are allowed, but normal catalogue rows must come from Product Master.
  private async validateRows(rows: IntentRow[]) {
    const active = rows
      .map((row) => ({
        ...row,
        productId: String(row.productId || '').trim(),
        qty: Number(row.qty || row.quantity || 0),
      }))
      .filter((row) => row.qty > 0);

    if (!active.length) return [];

    const productRows = active.filter((row) => !this.isTileRow(row));
    const missingProduct = productRows.find((row) => !row.productId);
    if (missingProduct) {
      throw new BadRequestException('Every non-tile intent row must use a Product Master SKU.');
    }

    const productIds = Array.from(new Set(productRows.map((row) => row.productId).filter(Boolean)));
    const products = productIds.length
      ? await this.prisma.product.findMany({
          where: { id: { in: productIds }, status: 'active' },
          select: { id: true, sku: true, name: true, category: true, brand: true, finish: true, unit: true, sellPrice: true, media: true },
        })
      : [];
    const productMap = new Map(products.map((product) => [product.id, product]));
    const missingIds = productIds.filter((id) => !productMap.has(id));
    if (missingIds.length) {
      throw new BadRequestException(`Product Master SKU missing or inactive for ${missingIds.length} intent row(s).`);
    }

    return active.map((row) => {
      if (this.isTileRow(row)) return this.normalizeTileRow(row);
      const product = productMap.get(row.productId)!;
      const price = Number(row.price || row.sellPrice || product.sellPrice || 0);
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
        sellPrice: price,
        media: product.media || (row as any).media || {},
        area: row.area || row.room || 'General Selection',
        source: 'product-master',
        inventoryTracked: true,
      };
    });
  }

  private async recordActivity(leadId: string, userId: string, type: string, message: string) {
    await this.prisma.activity.create({
      data: { id: ulid(), leadId, userId, type, message },
    }).catch(() => null);
  }

  // Bring a follow-up intent's parent lead back into "active" visibility
  // without overwriting its terminal stage. Won leads stay won, but get a
  // reopenedAt marker so dashboards can flag them.
  private async maybeReopenLead(lead: any, intentType: IntentType, actorId: string) {
    if (intentType !== 'followup') return;
    if (!['won', 'lost'].includes(lead.stage)) return;
    await this.prisma.lead.update({
      where: { id: lead.id },
      data: { reopenedAt: new Date(), lastContactAt: new Date(), updatedAt: new Date() },
    }).catch(() => null);
    await this.recordActivity(lead.id, actorId, 'lead.reopened', 'Follow-up intent created - lead marked reopened.');
  }

  private async notifyPendingIntent(intent: any, lead: any) {
    const rowCount = Array.isArray(intent.rows) ? intent.rows.length : 0;
    await this.notifications.create({
      title: 'New intent waiting for quote',
      message: `${lead.title || 'Lead'} - ${rowCount} row(s), ${intent.intentType} intent`,
      type: 'intent_submitted',
      entityType: 'LeadIntent',
      entityId: intent.id,
      href: '/dashboard/intents',
      targetRole: 'office_staff',
      metadata: { leadId: lead.id, intentType: intent.intentType, rowCount },
    }).catch(() => null);
  }

  // Attach lead + customer + owner + locker so the UI doesn't issue 4 follow-up
  // queries per intent. Cheap because intent lists cap at 200 rows.
  private async attachRelations(intents: any[]) {
    if (!intents.length) return intents;
    const leadIds = Array.from(new Set(intents.map((intent) => intent.leadId).filter(Boolean)));
    const customerIds = Array.from(new Set(intents.map((intent) => intent.customerId).filter(Boolean)));
    const userIds = Array.from(new Set([
      ...intents.map((intent) => intent.ownerId).filter(Boolean),
      ...intents.map((intent) => intent.lockedBy).filter(Boolean),
      ...intents.map((intent) => intent.createdBy).filter(Boolean),
    ]));
    const [leads, customers, users] = await Promise.all([
      this.prisma.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, title: true, stage: true, ownerId: true, reopenedAt: true } }),
      this.prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true, mobile: true, city: true, siteAddress: true } }),
      this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true, role: true } }),
    ]);
    const leadMap = new Map(leads.map((row) => [row.id, row]));
    const customerMap = new Map(customers.map((row) => [row.id, row]));
    const userMap = new Map(users.map((row) => [row.id, row]));
    return intents.map((intent) => ({
      ...intent,
      lead: leadMap.get(intent.leadId) || null,
      customer: customerMap.get(intent.customerId) || null,
      owner: userMap.get(intent.ownerId) || null,
      locker: intent.lockedBy ? userMap.get(intent.lockedBy) || null : null,
      createdByUser: userMap.get(intent.createdBy) || null,
    }));
  }
}
