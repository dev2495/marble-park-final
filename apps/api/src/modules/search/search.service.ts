import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SearchService {
  constructor(private prisma: PrismaService) {}

  async search(query: string) {
    const q = String(query || '').trim();
    const normalized = q.toUpperCase();
    
    const [products, leads, quotes] = await Promise.all([
      this.prisma.product.findMany({
        where: {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { sku: { contains: q, mode: 'insensitive' } },
            { internalCode: { contains: q, mode: 'insensitive' } },
            { brand: { contains: q, mode: 'insensitive' } },
            { aliases: { some: { normalizedValue: { contains: normalized }, status: 'active' } } },
          ]
        },
        select: {
          id: true, sku: true, internalCode: true, name: true, category: true, brand: true, finish: true,
          dimensions: true, unit: true, baseUom: true, purchaseUom: true, salesUom: true,
          piecesPerPack: true, coveragePerPack: true, allowLoose: true, media: true, status: true,
          defaultMrpInclusive: true, defaultNrpInclusive: true, priceRateBasis: true, priceUom: true,
          mrpSource: true, pricingEffectiveFrom: true, pricingVersion: true,
        },
        orderBy: [{ internalCode: 'asc' }, { name: 'asc' }],
        take: 20
      }),
      this.prisma.lead.findMany({
        where: {
          title: { contains: q, mode: 'insensitive' }
        },
        include: { customer: true },
        take: 5
      }),
      this.prisma.quote.findMany({
        where: {
          OR: [
            { quoteNumber: { contains: q, mode: 'insensitive' } },
            { title: { contains: q, mode: 'insensitive' } },
          ]
        },
        include: { customer: true },
        take: 5
      })
    ]);

    return {
      products,
      leads,
      quotes
    };
  }
}
