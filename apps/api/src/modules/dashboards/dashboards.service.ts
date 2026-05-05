import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
      catalogueImages,
      totalCustomers,
      totalUsers,
      activeDispatchJobs,
      pendingDispatchJobs,
    ] = await Promise.all([
      this.prisma.lead.count(),
      this.prisma.lead.count({ where: { stage: 'new' } }),
      this.prisma.quote.count(),
      this.prisma.quote.count({ where: { status: 'sent' } }),
      this.prisma.quote.count({ where: { status: 'confirmed' } }),
      this.prisma.product.count(),
      this.prisma.product.count({
        where: {
          media: {
            path: ['source'],
            equals: 'pdf-catalogue-extract',
          } as any,
        },
      }),
      this.prisma.customer.count(),
      this.prisma.user.count({ where: { active: true } }),
      this.prisma.dispatchJob.count({ where: { status: { not: 'delivered' } } as any }),
      this.prisma.dispatchJob.count({ where: { status: 'pending' } }),
    ]);

    const allQuotes = await this.prisma.quote.findMany({
      include: { customer: true, owner: true },
      orderBy: { createdAt: 'desc' },
    } as any) as any[];
    const totalQuoteValue = allQuotes.reduce((sum, quote) => sum + this.quoteTotal(quote.lines), 0);
    const confirmedQuoteValue = allQuotes
      .filter((quote) => quote.status === 'confirmed')
      .reduce((sum, quote) => sum + this.quoteTotal(quote.lines), 0);

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
      const confirmed = ownedQuotes.filter((quote) => quote.status === 'confirmed');
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        leads: leads?._count?._all || 0,
        pipelineValue: leads?._sum?.expectedValue || 0,
        quotes: ownedQuotes.length,
        confirmedQuotes: confirmed.length,
        quoteValue: ownedQuotes.reduce((sum, quote) => sum + this.quoteTotal(quote.lines), 0),
        wonValue: confirmed.reduce((sum, quote) => sum + this.quoteTotal(quote.lines), 0),
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
    const [myLeads, myQuotes, wonQuotes] = await Promise.all([
      this.prisma.lead.count({ where: { ownerId } }),
      this.prisma.quote.count({ where: { ownerId } }),
      this.prisma.quote.count({ where: { ownerId, status: 'confirmed' } }),
    ]);

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
        quoteValue: quotes.reduce((sum, quote) => sum + this.quoteTotal(quote.lines), 0),
      },
      pendingFollowups,
      recentQuotes: quotes,
    };
  }

  async getInventoryDashboard(): Promise<any> {
    const balances = await this.prisma.inventoryBalance.findMany({
      include: { product: true },
    } as any) as any[];

    const summary = {
      totalQuantity: 0,
      totalAvailable: 0,
      totalReserved: 0,
      lowStock: 0,
      outOfStock: 0,
      totalValue: 0,
    };

    for (const balance of balances) {
      summary.totalQuantity += balance.onHand;
      summary.totalAvailable += balance.available;
      summary.totalReserved += balance.reserved;
      if (balance.available < 5) summary.lowStock++;
      if (balance.available === 0) summary.outOfStock++;
      summary.totalValue += balance.available * (balance.product.sellPrice || 0);
    }

    return { stats: summary, summary };
  }

  private quoteTotal(lines: any) {
    const parsed = Array.isArray(lines) ? lines : [];
    return parsed.reduce((sum, line: any) => {
      const qty = Number(line.qty || line.quantity || 0);
      const price = Number(line.price || line.sellPrice || 0);
      return sum + qty * price;
    }, 0);
  }
}
