import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SearchService {
  constructor(private prisma: PrismaService) {}

  async search(query: string) {
    const q = query.toLowerCase();
    
    const [products, leads, quotes] = await Promise.all([
      this.prisma.product.findMany({
        where: {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { sku: { contains: q, mode: 'insensitive' } },
          ]
        },
        take: 5
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
