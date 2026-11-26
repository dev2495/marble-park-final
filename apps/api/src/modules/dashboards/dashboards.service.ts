import { stockStatus, stockThreshold } from '../common/stock-status';
import { Injectable } from '@nestjs/common';
import { inventoryTruthByProduct, zeroInventoryTruth } from '../common/inventory-truth';
import { PrismaService } from '../prisma/prisma.service';
import { COUNTED_QUOTE_WHERE, CONFIRMED_QUOTE_STATUSES, isQuoteConfirmed, quoteValue } from '../owner-reports/quote-value';
import { mrpPerBaseUnit } from '../common/stock-units';

@Injectable()
export class DashboardsService {
  constructor(private prisma: PrismaService) {}

  async getOwnerDashboard(): Promise<any> {
    const [
      totalLeads,
      newLeads,
      totalQuotes,
      sentQuotes,
      confirmedQuotes,
      totalProducts,
      productsForImageCoverage,
      totalCustomers,
      totalUsers,
      activeDispatchJobs,
      pendingDispatchJobs,
    ] = await Promise.all([
      this.prisma.lead.count(),
      this.prisma.lead.count({ where: { stage: 'new' } }),
      this.prisma.quote.count({ where: COUNTED_QUOTE_WHERE as any }),
      this.prisma.quote.count({ where: { ...COUNTED_QUOTE_WHERE, status: 'sent' } as any }),
      this.prisma.quote.count({ where: { ...COUNTED_QUOTE_WHERE, OR: [{ status: { in: CONFIRMED_QUOTE_STATUSES } }, { confirmedAt: { not: null } }] } as any }),
      this.prisma.product.count(),
      // Counted in the database instead of loading every product's media on each call (same rule as before).
      this.prisma.$queryRawUnsafe<Array<{ count: number }>>(`SELECT COUNT(*)::int AS count FROM "Product" WHERE jsonb_typeof(media) = 'object' AND ((media->>'primary') IS NOT NULL AND (media->>'primary') NOT IN ('', 'false', '0', 'null') OR (jsonb_typeof(media->'gallery') = 'array' AND jsonb_array_length(media->'gallery') > 0))`),
      this.prisma.customer.count(),
      this.prisma.user.count({ where: { active: true } }),
      // Open dispatch work only: delivered and cancelled jobs are finished.
      this.prisma.dispatchJob.count({ where: { status: { in: ['pending', 'packed', 'dispatched'] } } as any }),
      this.prisma.dispatchJob.count({ where: { status: 'pending' } }),
    ]);
    const catalogueImages = Number((productsForImageCoverage as any[])[0]?.count || 0);

    // Same value rule as the owner reports: pre-GST taxable value, replaced and cancelled revisions left out.
    const allQuotes = await this.prisma.quote.findMany({
      where: COUNTED_QUOTE_WHERE,
      select: { id: true, ownerId: true, status: true, confirmedAt: true, lines: true, commercialTotal: true, supersededByQuoteId: true },
      orderBy: { createdAt: 'desc' },
    } as any) as any[];
    const totalQuoteValue = allQuotes.reduce((sum, quote) => sum + this.quoteTotal(quote), 0);
    const confirmedQuoteValue = allQuotes
      .filter((quote) => isQuoteConfirmed(quote))
      .reduce((sum, quote) => sum + this.quoteTotal(quote), 0);

    const salesUsers = await this.prisma.user.findMany({
      where: { active: true, role: { in: ['owner', 'admin', 'sales_manager', 'sales'] } as any },
      orderBy: { name: 'asc' },
    });
    const [leadGroups, quoteGroups] = await Promise.all([
      this.prisma.lead.groupBy({
        by: ['ownerId'],
        _count: { _all: true },
        _sum: { expectedValue: true },
      } as any),
      this.prisma.quote.groupBy({
        by: ['ownerId', 'status'],
        _count: { _all: true },
      } as any),
    ]);

    const userPerformance = salesUsers.map((user) => {
      const ownedQuotes = allQuotes.filter((quote) => quote.ownerId === user.id);
      const leads: any = leadGroups.find((row: any) => row.ownerId === user.id);
      const confirmed = ownedQuotes.filter((quote) => isQuoteConfirmed(quote));
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        leads: leads?._count?._all || 0,
        pipelineValue: leads?._sum?.expectedValue || 0,
        quotes: ownedQuotes.length,
        confirmedQuotes: confirmed.length,
        quoteValue: ownedQuotes.reduce((sum, quote) => sum + this.quoteTotal(quote), 0),
        wonValue: confirmed.reduce((sum, quote) => sum + this.quoteTotal(quote), 0),
      };
    });

    const statusBreakdown = quoteGroups.reduce((acc: any, row: any) => {
      acc[row.status] = (acc[row.status] || 0) + row._count._all;
      return acc;
    }, {});

    const recentQuotesRaw = await this.prisma.quote.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
    });

    const recentQuotesCustomers = await this.prisma.customer.findMany({
      where: { id: { in: recentQuotesRaw.map(q => q.customerId) } }
    });

    const recentQuotes = recentQuotesRaw.map(q => ({
      ...q,
      customer: recentQuotesCustomers.find(c => c.id === q.customerId)
    }));

    const recentLeadsRaw = await this.prisma.lead.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
    });

    const recentLeadsCustomers = await this.prisma.customer.findMany({
      where: { id: { in: recentLeadsRaw.map(l => l.customerId) } }
    });
    
    const recentLeadsOwners = await this.prisma.user.findMany({
      where: { id: { in: recentLeadsRaw.map(l => l.ownerId) } }
    });

    const recentLeads = recentLeadsRaw.map(l => ({
      ...l,
      customer: recentLeadsCustomers.find(c => c.id === l.customerId),
      owner: recentLeadsOwners.find(o => o.id === l.ownerId)
    }));

    return {
      stats: {
        totalLeads,
        newLeads,
        totalQuotes,
        sentQuotes,
        confirmedQuotes,
        totalProducts,
        catalogueImages,
        catalogueImageCoverage: totalProducts ? Math.round((catalogueImages / totalProducts) * 100) : 0,
        totalCustomers,
        totalUsers,
        totalQuoteValue,
        confirmedQuoteValue,
        activeDispatchJobs,
        pendingDispatchJobs,
        quoteConversionRate: totalQuotes ? Math.round((confirmedQuotes / totalQuotes) * 100) : 0,
      },
      recentQuotes,
      recentLeads,
      userPerformance,
      analytics: {
        statusBreakdown,
        totalQuoteValue,
        confirmedQuoteValue,
      },
    };
  }

  async getSalesDashboard(ownerId: string): Promise<any> {
    const [myLeads, myCountedQuotes] = await Promise.all([
      this.prisma.lead.count({ where: { ownerId } }),
      this.prisma.quote.findMany({ where: { ownerId, ...COUNTED_QUOTE_WHERE } as any, select: { status: true, confirmedAt: true, lines: true, commercialTotal: true } }) as Promise<any[]>,
    ]);
    const myQuotes = myCountedQuotes.length;
    const myConfirmed = myCountedQuotes.filter((quote) => isQuoteConfirmed(quote));
    const wonQuotes = myConfirmed.length;

    const pendingFollowupsRaw = await this.prisma.followUpTask.findMany({
      where: {
        ownerId: ownerId,
        status: 'pending',
        dueAt: { lt: new Date() },
      },
      take: 5,
    });

    const followupsLeads = await this.prisma.lead.findMany({
      where: { id: { in: pendingFollowupsRaw.map(f => f.leadId) } }
    });

    const followupsCustomers = await this.prisma.customer.findMany({
      where: { id: { in: followupsLeads.map(l => l.customerId) } }
    });

    const pendingFollowups = pendingFollowupsRaw.map(f => {
      const lead = followupsLeads.find(l => l.id === f.leadId);
      const customer = lead ? followupsCustomers.find(c => c.id === lead.customerId) : null;
      return {
        ...f,
        lead: lead ? { ...lead, customer } : null
      };
    });

    const quotes = await this.prisma.quote.findMany({
      where: { ownerId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { customer: true },
    } as any) as any[];

    return {
      stats: {
        myLeads,
        myQuotes,
        wonQuotes,
        // Whole book of live quotes, not just the five recent ones listed below.
        quoteValue: myCountedQuotes.reduce((sum, quote) => sum + this.quoteTotal(quote), 0),
        wonValue: myConfirmed.reduce((sum, quote) => sum + this.quoteTotal(quote), 0),
      },
      pendingFollowups,
      recentQuotes: quotes,
    };
  }

  async getInventoryDashboard(): Promise<any> {
    const balances = await this.prisma.inventoryBalance.findMany({ include: { product: true } } as any) as any[];
    const truth = await inventoryTruthByProduct(this.prisma, balances.map((row) => row.productId));
    const stockedBefore = new Set((await this.prisma.inventoryLot.findMany({ distinct: ['productId'], select: { productId: true } } as any) as any[]).map((row) => row.productId));

    const summary = {
      totalQuantity: 0,
      totalAvailable: 0,
      totalReserved: 0,
      lowStock: 0,
      outOfStock: 0,
      totalValue: 0,
      // Value of stock at Product Master MRP (GST included), and what could not be valued.
      mrpValue: 0,
      mrpMissingProducts: 0,
      mrpMissingUnits: 0,
      // Cost value covers only units whose lot carries a cost; the rest are listed as missing.
      costedUnits: 0,
      missingCostUnits: 0,
      missingCostProducts: 0,
      stockedProducts: 0,
    };

    for (const balance of balances) {
      const stock = truth.get(balance.productId) || zeroInventoryTruth(balance.productId);
      summary.totalQuantity += stock.onHand;
      summary.totalAvailable += stock.available;
      summary.totalReserved += stock.reserved;
      const status = stockStatus({ everStocked: stockedBefore.has(balance.productId), onHand: stock.onHand, available: stock.available, threshold: stockThreshold(balance.product?.category, balance.lowStockThreshold, balance.reorderPoint) });
      if (status === 'Running low' || status === 'Ran out') summary.lowStock++;
      if (status === 'Ran out') summary.outOfStock++;
      summary.totalValue += stock.onHandValue;
      if (stock.onHand > 0) {
        summary.stockedProducts++;
        // On hand is in stock base units (pieces for boxed tiles); convert MRP to that unit first.
        const mrp = mrpPerBaseUnit(balance.product);
        if (mrp > 0) summary.mrpValue += Math.round(stock.onHand * mrp * 100) / 100;
        else { summary.mrpMissingProducts++; summary.mrpMissingUnits += stock.onHand; }
        const missing = Math.min(stock.onHand, stock.missingCostQuantity);
        summary.missingCostUnits += missing;
        summary.costedUnits += stock.onHand - missing;
        if (missing > 0) summary.missingCostProducts++;
      }
    }

    return { stats: summary, summary };
  }

  private quoteTotal(quote: any) {
    return quoteValue(quote).taxable;
  }
}
