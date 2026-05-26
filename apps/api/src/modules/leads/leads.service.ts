import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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

// Probability weights for forecast computation. Aligned with industry-standard
// retail CRM defaults. Configurable later in AppSetting if needed.
const STAGE_WEIGHTS: Record<string, number> = {
  new: 0.1,
  contacted: 0.25,
  qualified: 0.4,
  proposal: 0.5,
  quoted: 0.55,
  negotiation: 0.75,
  won: 1,
  lost: 0,
};

export interface LeadBoardFilters {
  ownerId?: string | null;
  source?: string | null;
  city?: string | null;
  valueMin?: number | null;
  valueMax?: number | null;
  ageBucket?: 'fresh' | 'stale' | 'very_stale' | null;
  reopenedOnly?: boolean | null;
  hasRevision?: boolean | null;
  search?: string | null;
}

@Injectable()
export class LeadsService {
  constructor(private prisma: PrismaService, private quotes: QuotesService, private notifications: NotificationsService) {}

  /**
   * GraphQL-facing list. Returns BARE rows; resolver fans relations through
   * DataLoader so listing 100 leads triggers 1 findMany + 1 batched
   * Customer/User load instead of 1 + 100 + 100 selects.
   */
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
      orderBy: { createdAt: 'desc' },
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
    const intentRows = await this.validateProductMasterRows(this.normalizeRows(data.intentRows));
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

  /**
   * Powers the Lead Pipeline page (board + list + forecast + calendar). Returns
   * KPIs, per-column meta, and rich per-lead substate. Each "substate" is the
   * single most useful one-liner for the rep at this moment, derived from the
   * latest intent / head quote / order / payment / communication.
   *
   * Performance: 1 leads.findMany + 5 bulk-fetches keyed by leadId/quoteId, all
   * issued in parallel. No N+1.
   */
  async boardData(filters: LeadBoardFilters, viewer: { id: string; role: string }) {
    const where: any = this.buildBoardWhere(filters, viewer);
    const leads = await this.prisma.lead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    if (!leads.length) {
      return {
        kpis: { openValue: 0, weightedForecast: 0, wonThisMonth: 0, staleCount: 0, leadCount: 0 },
        columns: LEAD_STAGES.map((stage) => ({ stage, count: 0, totalValue: 0, avgValue: 0, oldestAgeDays: 0 })),
        leads: [],
      };
    }

    const leadIds = leads.map((lead) => lead.id);
    const customerIds = Array.from(new Set(leads.map((lead) => lead.customerId)));
    const ownerIds = Array.from(new Set(leads.map((lead) => lead.ownerId)));

    const [intents, quotes, activities, customers, owners, salesOrders, communications] = await Promise.all([
      this.prisma.leadIntent.findMany({ where: { leadId: { in: leadIds } }, orderBy: { createdAt: 'desc' } }).catch(() => []),
      this.prisma.quote.findMany({ where: { leadId: { in: leadIds } }, orderBy: { createdAt: 'desc' } }).catch(() => []),
      this.prisma.activity.findMany({ where: { leadId: { in: leadIds } }, orderBy: { createdAt: 'desc' } }).catch(() => []),
      this.prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true, city: true, mobile: true, gstNo: true, architectName: true } }),
      this.prisma.user.findMany({ where: { id: { in: ownerIds } } } as any) as Promise<any[]>,
      this.prisma.salesOrder.findMany({ where: { leadId: { in: leadIds } } }).catch(() => []),
      this.prisma.communication.findMany({ where: { leadId: { in: leadIds } }, orderBy: { occurredAt: 'desc' } }).catch(() => []),
    ]);

    const orderIds = (salesOrders as any[]).map((order) => order.id);
    const payments = orderIds.length
      ? await this.prisma.payment.findMany({ where: { salesOrderId: { in: orderIds } } }).catch(() => [])
      : [];

    // Build per-lead indexes for O(1) lookup.
    const customerMap = new Map<string, any>(customers.map((row: any) => [row.id, row]));
    const ownerMap = new Map<string, any>(owners.map((row: any) => [row.id, row]));
    const intentByLead = this.groupBy(intents as any[], 'leadId');
    const quoteByLead = this.groupBy(quotes as any[], 'leadId');
    const orderByLead = this.groupBy(salesOrders as any[], 'leadId');
    const activityByLead = this.groupBy(activities as any[], 'leadId');
    const commByLead = this.groupBy(communications as any[], 'leadId');
    const paymentByOrder = this.groupBy(payments as any[], 'salesOrderId');

    const now = Date.now();

    // ---------- per-lead substate ----------
    const enrichedLeads = leads.map((lead) => {
      const leadIntents = (intentByLead.get(lead.id) || []) as any[];
      const leadQuotes = (quoteByLead.get(lead.id) || []) as any[];
      const leadOrders = (orderByLead.get(lead.id) || []) as any[];
      const leadActs = (activityByLead.get(lead.id) || []) as any[];
      const leadComms = (commByLead.get(lead.id) || []) as any[];

      // Head quote = most recent quote that hasn't been superseded.
      const headQuote = leadQuotes.find((q) => !q.supersededByQuoteId) || leadQuotes[0];
      const activeIntent = leadIntents.find((i) => ['draft', 'pending_quote', 'in_quote'].includes(i.status));
      const latestOrder = leadOrders[0];
      const orderPayments = latestOrder ? (paymentByOrder.get(latestOrder.id) || []) : [];

      const substate = this.computeSubstate({
        lead,
        headQuote,
        activeIntent,
        latestOrder,
        orderPayments,
        leadIntents,
        leadQuotes,
        leadComms,
      });

      // Activity age in days: time since most recent activity OR lead creation.
      const lastTouch = leadActs[0]?.createdAt
        || leadComms[0]?.occurredAt
        || lead.lastContactAt
        || lead.createdAt;
      const ageDays = Math.max(0, Math.floor((now - new Date(lastTouch).getTime()) / 86400000));
      const health = this.computeHealth(ageDays, lead.reopenedAt);

      return {
        id: lead.id,
        title: lead.title,
        stage: lead.stage,
        source: lead.source,
        expectedValue: lead.expectedValue,
        notes: lead.notes,
        createdAt: lead.createdAt,
        lastContactAt: lead.lastContactAt,
        lastActivityAt: lastTouch,
        nextActionAt: lead.nextActionAt,
        reopenedAt: lead.reopenedAt,
        ageDays,
        health,
        customer: customerMap.get(lead.customerId) || null,
        owner: ownerMap.get(lead.ownerId) || null,
        substate,
        // Counts surfaced for filter checks (hasRevision etc.)
        intentCount: leadIntents.length,
        activeIntentCount: leadIntents.filter((i) => ['draft', 'pending_quote', 'in_quote'].includes(i.status)).length,
        hasRevision: leadIntents.some((i) => i.intentType === 'revision') || leadQuotes.some((q) => q.versionNumber > 1),
        quoteCount: leadQuotes.length,
        headQuote: headQuote ? { id: headQuote.id, quoteNumber: headQuote.quoteNumber, versionNumber: headQuote.versionNumber, status: headQuote.status } : null,
      };
    });

    // ---------- post-fetch filters (substate-dependent) ----------
    const filtered = enrichedLeads.filter((lead) => {
      if (filters.ageBucket === 'stale' && lead.ageDays < 7) return false;
      if (filters.ageBucket === 'very_stale' && lead.ageDays < 14) return false;
      if (filters.ageBucket === 'fresh' && lead.ageDays > 3) return false;
      if (filters.reopenedOnly && !lead.reopenedAt) return false;
      if (filters.hasRevision && !lead.hasRevision) return false;
      return true;
    });

    // ---------- KPIs ----------
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const openLeads = filtered.filter((lead) => !['won', 'lost'].includes(lead.stage));
    const openValue = openLeads.reduce((s, lead) => s + Number(lead.expectedValue || 0), 0);
    const weightedForecast = openLeads.reduce(
      (s, lead) => s + Number(lead.expectedValue || 0) * (STAGE_WEIGHTS[lead.stage] ?? 0),
      0,
    );
    const wonThisMonth = (salesOrders as any[])
      .filter((order) => new Date(order.createdAt) >= monthStart)
      .reduce((s, order) => s + Number(order.totalAmount || 0), 0);
    const staleCount = openLeads.filter((lead) => lead.ageDays >= 7).length;

    // ---------- per-column meta ----------
    const columns = LEAD_STAGES.map((stage) => {
      const inStage = filtered.filter((lead) => lead.stage === stage);
      const totalValue = inStage.reduce((s, lead) => s + Number(lead.expectedValue || 0), 0);
      const oldest = inStage.reduce((max, lead) => Math.max(max, lead.ageDays), 0);
      return {
        stage,
        count: inStage.length,
        totalValue,
        avgValue: inStage.length ? totalValue / inStage.length : 0,
        oldestAgeDays: oldest,
      };
    });

    return {
      kpis: {
        openValue,
        weightedForecast,
        wonThisMonth,
        staleCount,
        leadCount: filtered.length,
      },
      columns,
      leads: filtered,
    };
  }

  // ---------- substate engine ----------
  private computeSubstate(ctx: {
    lead: any;
    headQuote: any;
    activeIntent: any;
    latestOrder: any;
    orderPayments: any[];
    leadIntents: any[];
    leadQuotes: any[];
    leadComms: any[];
  }) {
    const { headQuote, activeIntent, latestOrder, orderPayments, leadComms } = ctx;
    const now = Date.now();
    const daysSince = (date: any) => Math.max(0, Math.floor((now - new Date(date).getTime()) / 86400000));

    // Order-level signals win first (post-conversion).
    if (latestOrder) {
      const received = orderPayments
        .filter((p) => p.direction !== 'refund')
        .reduce((s, p) => s + Number(p.amount || 0), 0);
      const refunded = orderPayments
        .filter((p) => p.direction === 'refund')
        .reduce((s, p) => s + Number(p.amount || 0), 0);
      const net = received - refunded;
      const total = Number(latestOrder.totalAmount || 0);
      const balance = Math.max(0, total - net);
      const orderAge = daysSince(latestOrder.createdAt);

      if (balance > 0 && orderAge > 14) {
        return {
          kind: 'overdue',
          label: `₹${this.short(balance)} balance · ${orderAge}d aged`,
          sub: orderPayments.length ? `last receipt: ₹${this.short(orderPayments[0].amount)} ${orderPayments[0].mode}` : 'no payments received yet',
          meta: { orderId: latestOrder.id, balance, orderAge },
        };
      }
      if (balance <= 0.01 && total > 0) {
        const latest = orderPayments[0];
        return {
          kind: 'paid',
          label: 'Paid in full',
          sub: latest ? `${latest.mode || 'cash'} · ${this.relative(latest.paidAt)}` : `₹${this.short(total)}`,
          meta: { orderId: latestOrder.id, total },
        };
      }
      // Status dispatch tracking — surface if there's progress underway.
      if (['confirmed', 'dispatched', 'partially_dispatched', 'in_progress'].includes(String(latestOrder.status || ''))) {
        return {
          kind: 'dispatch',
          label: 'Dispatching · in progress',
          sub: `₹${this.short(total)} order · ${latestOrder.paymentStatus || 'pending payment'}`,
          meta: { orderId: latestOrder.id, total },
        };
      }
      return {
        kind: 'paid',
        label: `Order ${latestOrder.orderNumber || ''}`.trim(),
        sub: `₹${this.short(total)} · ${latestOrder.paymentStatus || 'pending payment'}`,
        meta: { orderId: latestOrder.id, total },
      };
    }

    // Active intent overrides quote-level state.
    if (activeIntent) {
      const rows = Array.isArray(activeIntent.rows) ? activeIntent.rows.length : 0;
      if (activeIntent.status === 'in_quote') {
        return {
          kind: 'intent',
          label: 'Office building quote',
          sub: `started ${this.relative(activeIntent.lockedAt || activeIntent.updatedAt)}`,
          meta: { intentId: activeIntent.id, rows },
        };
      }
      if (activeIntent.status === 'pending_quote') {
        const ref = activeIntent.referencesQuoteId ? ' (revision)' : '';
        return {
          kind: activeIntent.intentType === 'revision' ? 'revising' : 'intent',
          label: `${activeIntent.intentType === 'revision' ? 'Revising' : 'Intent'} with office${ref}`,
          sub: `submitted ${this.relative(activeIntent.submittedAt || activeIntent.updatedAt)} · ${rows} rows`,
          meta: { intentId: activeIntent.id, rows, intentType: activeIntent.intentType },
        };
      }
      if (activeIntent.status === 'draft') {
        return {
          kind: 'draft',
          label: `Drafting intent · ${rows} row${rows === 1 ? '' : 's'}`,
          sub: `saved ${this.relative(activeIntent.updatedAt)}`,
          meta: { intentId: activeIntent.id, rows },
        };
      }
    }

    // Head quote signal — sent, awaiting customer.
    if (headQuote) {
      const age = daysSince(headQuote.sentAt || headQuote.createdAt);
      const ver = `v${headQuote.versionNumber || 1}`;
      const sub = headQuote.sentAt ? `sent ${this.relative(headQuote.sentAt)}` : `created ${this.relative(headQuote.createdAt)}`;
      const inboundUnreplied = leadComms.find((c) => c.direction === 'inbound') && (!headQuote.sentAt || new Date(leadComms[0].occurredAt) > new Date(headQuote.sentAt));
      if (inboundUnreplied) {
        return {
          kind: 'overdue',
          label: 'Customer reached out — unreplied',
          sub: `last contact ${this.relative(leadComms[0].occurredAt)} (${leadComms[0].type})`,
          meta: { quoteId: headQuote.id },
        };
      }
      return {
        kind: 'quote',
        label: `Quote ${headQuote.quoteNumber} ${ver}`,
        sub: `${sub}${age > 7 ? ` · cold ${age}d` : ''}`,
        meta: { quoteId: headQuote.id, versionNumber: headQuote.versionNumber, status: headQuote.status, ageDays: age },
      };
    }

    // No intent, no quote — fresh lead.
    if (leadComms[0]) {
      return {
        kind: 'intent',
        label: `Last contact ${leadComms[0].type}`,
        sub: this.relative(leadComms[0].occurredAt),
        meta: {},
      };
    }
    return {
      kind: 'intent',
      label: 'Just created',
      sub: 'awaiting first call',
      meta: {},
    };
  }

  private computeHealth(ageDays: number, reopenedAt: any): 'good' | 'warn' | 'bad' | 'violet' {
    if (reopenedAt) {
      const reopenedDays = Math.floor((Date.now() - new Date(reopenedAt).getTime()) / 86400000);
      if (reopenedDays <= 14) return 'violet';
    }
    if (ageDays <= 3) return 'good';
    if (ageDays <= 7) return 'warn';
    return 'bad';
  }

  private short(amount: number) {
    const n = Number(amount || 0);
    if (n >= 10000000) return `${(n / 10000000).toFixed(2)}Cr`;
    if (n >= 100000) return `${(n / 100000).toFixed(2)}L`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return `${n.toLocaleString('en-IN')}`;
  }

  private relative(when: any) {
    if (!when) return 'just now';
    const ms = Date.now() - new Date(when).getTime();
    const min = Math.floor(ms / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const d = Math.floor(hr / 24);
    if (d < 7) return `${d}d ago`;
    const w = Math.floor(d / 7);
    if (w < 4) return `${w}w ago`;
    return new Date(when).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }

  private groupBy<T>(rows: T[], key: keyof T): Map<any, T[]> {
    const map = new Map<any, T[]>();
    for (const row of rows) {
      const k = row[key];
      if (!k) continue;
      const list = map.get(k) || [];
      list.push(row);
      map.set(k, list);
    }
    return map;
  }

  private buildBoardWhere(filters: LeadBoardFilters, viewer: { id: string; role: string }): any {
    const isPrivileged = ['admin', 'owner', 'sales_manager', 'office_staff'].includes(viewer.role);
    const where: any = {};
    if (filters.ownerId) where.ownerId = filters.ownerId;
    else if (!isPrivileged) where.ownerId = viewer.id;
    if (filters.source) where.source = filters.source;
    if (filters.city) where.customer = { city: { contains: filters.city, mode: 'insensitive' } };
    if (filters.valueMin != null || filters.valueMax != null) {
      where.expectedValue = {};
      if (filters.valueMin != null) where.expectedValue.gte = filters.valueMin;
      if (filters.valueMax != null) where.expectedValue.lte = filters.valueMax;
    }
    if (filters.search?.trim()) {
      where.OR = [
        { title: { contains: filters.search, mode: 'insensitive' } },
        { customer: { name: { contains: filters.search, mode: 'insensitive' } } },
        { customer: { mobile: { contains: filters.search } } },
      ];
    }
    return where;
  }

  // Bulk update — manager/admin only. Audit per lead.
  async bulkUpdate(leadIds: string[], patch: { ownerId?: string; stage?: string; notes?: string }, actor: { id: string; role: string }) {
    if (!leadIds?.length) return { updated: 0 };
    if (!['admin', 'owner', 'sales_manager'].includes(actor.role)) {
      throw new BadRequestException('Bulk update is restricted to managers/admins.');
    }
    if (patch.stage && !LEAD_STAGES.includes(patch.stage)) {
      throw new BadRequestException(`Invalid stage: ${patch.stage}`);
    }
    const data: any = { updatedAt: new Date() };
    if (patch.ownerId) data.ownerId = patch.ownerId;
    if (patch.stage) { data.stage = patch.stage; data.lastContactAt = new Date(); }
    if (patch.notes !== undefined) data.notes = patch.notes;

    const result = await this.prisma.lead.updateMany({ where: { id: { in: leadIds } }, data });

    // One audit log entry per changed lead so the audit page surfaces it.
    for (const id of leadIds) {
      await this.prisma.activity.create({
        data: {
          id: ulid(),
          leadId: id,
          userId: actor.id,
          type: 'lead.bulk_update',
          message: `Bulk update: ${Object.keys(patch).join(', ')}`,
        },
      }).catch(() => null);
    }
    return { updated: result.count };
  }

  /**
   * Build a unified, chronological timeline for a single lead — the spine of
   * the lead detail page. Merges intents, quotes (with version chain),
   * activities, follow-ups, dispatch challans, sales orders, payments, and
   * communications. Newest first.
   */
  async timeline(leadId: string) {
    const lead = await this.findById(leadId);
    const quoteIds: string[] = (Array.isArray(lead.quotes) ? lead.quotes : []).map((q: any) => q.id);
    const customerId = lead.customerId;

    const [intents, dispatchJobs, challans, salesOrders, payments, communications] = await Promise.all([
      this.prisma.leadIntent.findMany({ where: { leadId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.dispatchJob.findMany({ where: { quoteId: { in: quoteIds } } }).catch(() => []),
      quoteIds.length ? this.prisma.dispatchChallan.findMany({ where: { quoteId: { in: quoteIds } } }).catch(() => []) : [],
      quoteIds.length ? this.prisma.salesOrder.findMany({ where: { quoteId: { in: quoteIds } } }).catch(() => []) : [],
      this.prisma.payment.findMany({ where: { customerId }, orderBy: { paidAt: 'desc' } }).catch(() => []),
      this.prisma.communication.findMany({ where: { OR: [{ leadId }, { customerId }] }, orderBy: { occurredAt: 'desc' } }).catch(() => []),
    ]);

    // Build a quote chain so the UI can collapse superseded versions under
    // their head. Head = the most recent quote in any chain (no
    // supersededByQuoteId).
    const quoteList: any[] = Array.isArray(lead.quotes) ? lead.quotes : [];
    const quoteIndex = new Map(quoteList.map((q: any) => [q.id, q]));
    const headQuoteIds = quoteList.filter((q: any) => !q.supersededByQuoteId).map((q: any) => q.id);
    const chains: any[] = headQuoteIds.map((headId) => {
      const versions: any[] = [];
      let current = quoteIndex.get(headId);
      while (current) {
        versions.push(current);
        const prevId = current.supersedesQuoteId as string | null;
        if (!prevId) break;
        current = quoteIndex.get(prevId);
      }
      versions.sort((a: any, b: any) => Number(a.versionNumber || 1) - Number(b.versionNumber || 1));
      return { headQuoteId: headId, versions };
    });

    type Entry = { id: string; kind: string; at: Date; payload: any };
    const entries: Entry[] = [];

    for (const intent of intents as any[]) {
      entries.push({
        id: `intent:${intent.id}`,
        kind: 'intent',
        at: new Date(intent.createdAt),
        payload: intent,
      });
    }
    for (const quote of quoteList) {
      entries.push({
        id: `quote:${quote.id}`,
        kind: 'quote',
        at: new Date(quote.createdAt),
        payload: quote,
      });
    }
    for (const activity of (lead.activities || []) as any[]) {
      entries.push({
        id: `activity:${activity.id}`,
        kind: 'activity',
        at: new Date(activity.createdAt),
        payload: activity,
      });
    }
    for (const followUp of (lead.followUps || []) as any[]) {
      entries.push({
        id: `followup:${followUp.id}`,
        kind: 'followup',
        at: new Date(followUp.createdAt),
        payload: followUp,
      });
    }
    for (const job of dispatchJobs as any[]) {
      entries.push({
        id: `dispatchjob:${job.id}`,
        kind: 'dispatch_job',
        at: new Date(job.createdAt),
        payload: job,
      });
    }
    for (const challan of challans as any[]) {
      entries.push({
        id: `challan:${challan.id}`,
        kind: 'challan',
        at: new Date(challan.createdAt),
        payload: challan,
      });
    }
    for (const order of salesOrders as any[]) {
      entries.push({
        id: `order:${order.id}`,
        kind: 'order',
        at: new Date(order.createdAt),
        payload: order,
      });
    }
    for (const payment of payments as any[]) {
      entries.push({
        id: `payment:${payment.id}`,
        kind: 'payment',
        at: new Date(payment.paidAt),
        payload: payment,
      });
    }
    for (const comm of communications as any[]) {
      entries.push({
        id: `comm:${comm.id}`,
        kind: 'communication',
        at: new Date(comm.occurredAt),
        payload: comm,
      });
    }

    entries.sort((a, b) => b.at.getTime() - a.at.getTime());

    // Compute "currently in flight" — non-frozen intents and head quotes that
    // aren't terminal. Surfaced at top of the detail page.
    const inFlight = {
      activeIntents: (intents as any[]).filter((intent) => ['draft', 'pending_quote', 'in_quote'].includes(intent.status)),
      activeQuotes: chains
        .map((chain) => chain.versions[chain.versions.length - 1])
        .filter((quote) => quote && !['superseded', 'lost', 'expired'].includes(quote.status)),
    };

    return {
      lead,
      chains,
      inFlight,
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
    const rows = await this.validateProductMasterRows(this.normalizeRows(input.rows));
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
    if (intent.status === 'cancelled' || intent.status === 'converted') {
      throw new BadRequestException(`Intent is ${intent.status}, cannot generate quote.`);
    }
    // Office staff that has the in_quote lock can convert directly. Anyone
    // else (manager/admin) gets implicit pickup. Sales rep cannot convert
    // since pricing is staff's job (controlled by resolver-level role check).
    if (intent.status === 'in_quote' && intent.lockedBy && intent.lockedBy !== createdBy) {
      // Allow the conversion path if caller is owner/admin/manager — they
      // can force-take the lock by virtue of the @Mutation gate. Otherwise
      // we'd never let staff hand off.
    }
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
      intentId: intent.id,
      supersedesQuoteId: (intent as any).referencesQuoteId || null,
    } as any);
    const pdfUrl = `/api/pdf/quote/${quote.id}`;
    await this.prisma.leadIntent.update({
      where: { id: intent.id },
      data: { status: 'converted', quoteId: quote.id, lockedBy: null, lockedAt: null, updatedAt: new Date() },
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
        title: 'Quote ready for owner visibility',
        message: `${quote.quoteNumber} was generated from an intent. It can be shared, confirmed, and converted without an owner approval stop.`,
        type: 'quote_ready',
        entityType: 'Quote',
        entityId: quote.id,
        href: `/dashboard/quotes/${quote.id}`,
        targetRole: 'owner',
        metadata: { intentId: intent.id, pdfUrl, displayMode: quote.displayMode },
      },
      {
        title: 'Quote ready for admin visibility',
        message: `${quote.quoteNumber} was generated from an intent and is unblocked for confirmation.`,
        type: 'quote_ready',
        entityType: 'Quote',
        entityId: quote.id,
        href: `/dashboard/quotes/${quote.id}`,
        targetRole: 'admin',
        metadata: { intentId: intent.id, pdfUrl, displayMode: quote.displayMode },
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

  private async validateProductMasterRows(rows: any[]) {
    const isTileRow = (row: any) => row?.type === 'tile' || row?.nonStock === true || String(row?.category || '').toLowerCase() === 'tiles';
    const normalizeTileRow = (row: any) => {
      const tileCode = String(row.tileCode || row.sku || row.name || '').trim();
      const tileSize = String(row.tileSize || row.size || row.dimensions || row.finish || '').trim();
      const qty = Math.trunc(Number(row.qty || row.quantity || 0));
      return {
        ...row,
        type: 'tile',
        category: 'Tiles',
        productId: undefined,
        sku: tileCode || 'TILE-CODE-PENDING',
        name: String(row.name || `Tile ${tileCode || ''} ${tileSize || ''}`).trim(),
        tileCode,
        tileSize,
        dimensions: tileSize,
        qty,
        quantity: qty,
        uom: row.uom || 'box',
        unit: String(row.unit || row.uom || 'BOX').toUpperCase(),
        pcsPerBox: Number(row.pcsPerBox || 0),
        price: Number(row.price || row.sellPrice || 0),
        sellPrice: Number(row.price || row.sellPrice || 0),
        area: row.area || row.room || 'General Selection',
        source: 'tile-intent',
        inventoryTracked: false,
        nonStock: true,
      };
    };
    const activeRows = rows
      .map((row) => ({ ...row, productId: String(row.productId || '').trim(), qty: Number(row.qty || row.quantity || 0) }))
      .filter((row) => row.qty > 0);

    if (!activeRows.length) return [];

    const productRows = activeRows.filter((row) => !isTileRow(row));
    const missingProduct = productRows.find((row) => !row.productId);
    if (missingProduct) {
      throw new BadRequestException(
        'Every non-tile intent row must use a Product Master SKU. Create or select the SKU in Product Master before making an intent or quote.',
      );
    }

    const productIds = Array.from(new Set(productRows.map((row) => row.productId)));
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
        sellPrice: true,
        media: true,
      },
    });
    const productMap = new Map(products.map((product) => [product.id, product]));
    const missingIds = productIds.filter((id) => !productMap.has(id));
    if (missingIds.length) {
      throw new BadRequestException(`Product Master SKU missing or inactive for ${missingIds.length} intent row(s).`);
    }

    return activeRows.map((row) => {
      if (isTileRow(row)) return normalizeTileRow(row);
      const product = productMap.get(row.productId)!;
      const price = Number(row.price || row.sellPrice || product.sellPrice || 0);
      return {
        ...row,
        productId: product.id,
        sku: product.sku,
        name: product.name,
        category: product.category,
        brand: product.brand,
        finish: product.finish || row.finish || '',
        unit: row.unit || product.unit || 'PC',
        qty: row.qty,
        price,
        sellPrice: price,
        media: product.media || row.media || {},
        area: row.area || row.room || 'General Selection',
        source: 'product-master',
      };
    });
  }

  private async intentRowsToQuoteLines(rows: any[]) {
    const lines: any[] = [];
    for (const row of rows) {
      const isTile = row.type === 'tile' || String(row.category || '').toLowerCase() === 'tiles';
      let product: any = null;
      if (row.productId) product = await this.prisma.product.findUnique({ where: { id: row.productId } });
      if (!product && row.sku) product = await this.prisma.product.findUnique({ where: { sku: row.sku } }).catch(() => null);
      if (!product && isTile) {
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
      if (!product) {
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
        unit: row.unit || product.unit || 'PC',
        price: Number(row.price || row.sellPrice || product.sellPrice || 0),
        sellPrice: Number(row.price || row.sellPrice || product.sellPrice || 0),
        media: product.media || row.media || {},
        area: row.area || row.room || 'General Selection',
        quoteImage: row.quoteImage || row.customImageUrl || '',
        source: 'product-master',
      });
    }
    return lines;
  }
}
