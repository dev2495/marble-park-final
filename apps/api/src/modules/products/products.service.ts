import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ulid } from 'ulid';

export interface CreateProductInput {
  sku: string;
  name: string;
  category: string;
  brand: string;
  finish?: string;
  dimensions?: string;
  unit?: string;
  sellPrice: number;
  floorPrice?: number;
  taxClass?: string;
  description?: string;
  media?: any;
}

export interface UpdateProductInput {
  name?: string;
  category?: string;
  brand?: string;
  finish?: string;
  dimensions?: string;
  unit?: string;
  sellPrice?: number;
  floorPrice?: number;
  taxClass?: string;
  description?: string;
  status?: string;
  media?: any;
}

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  async findAll(args?: { search?: string; category?: string; take?: number }) {
    const where: any = {};
    if (args?.search) {
      where.OR = [
        { name: { contains: args.search, mode: 'insensitive' } },
        { sku: { contains: args.search, mode: 'insensitive' } },
        { brand: { contains: args.search, mode: 'insensitive' } },
      ];
    }
    if (args?.category) where.category = args.category;

    return this.prisma.product.findMany({
      where,
      orderBy: { name: 'asc' },
      take: args?.take,
    });
  }

  async findById(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async findBySku(sku: string) {
    return this.prisma.product.findUnique({ where: { sku: this.normalizeSku(sku) } });
  }

  async create(data: CreateProductInput): Promise<any> {
    const sku = this.normalizeSku(data.sku);
    const name = String(data.name || '').trim();
    const category = String(data.category || '').trim();
    const brand = String(data.brand || '').trim();
    const finish = String(data.finish || 'Standard').trim() || 'Standard';
    const sellPrice = Number(data.sellPrice || 0);
    if (!sku) throw new BadRequestException('SKU is required');
    if (!name) throw new BadRequestException('Product name is required');
    if (!category) throw new BadRequestException('Category is required');
    if (!brand) throw new BadRequestException('Brand is required');
    if (!Number.isFinite(sellPrice) || sellPrice <= 0) throw new BadRequestException('Sell price must be greater than zero');

    const existing = await this.findBySku(sku);
    if (existing) {
      throw new BadRequestException('Product with this SKU already exists');
    }
    await this.ensureCategory(category);
    await this.ensureBrand(brand);
    await this.ensureFinish(finish);
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          id: ulid(),
          sku,
          name,
          category,
          brand,
          finish,
          dimensions: String(data.dimensions || '').trim(),
          unit: String(data.unit || 'PC').trim().toUpperCase() || 'PC',
          tags: [],
          sellPrice,
          floorPrice: data.floorPrice ?? sellPrice * 0.88,
          taxClass: data.taxClass || 'GST_18',
          status: 'active',
          media: data.media || {},
          sourceRefs: {},
          description: data.description || '',
          updatedAt: new Date(),
        } as any,
      });
      await tx.inventoryBalance.create({
        data: {
          id: ulid(),
          productId: product.id,
          onHand: 0,
          available: 0,
          reserved: 0,
          damaged: 0,
          hold: 0,
          updatedAt: new Date(),
        } as any,
      });
      return product;
    });
  }

  async update(id: string, data: UpdateProductInput): Promise<any> {
    await this.findById(id);
    if (data.category) await this.ensureCategory(data.category);
    if (data.brand) await this.ensureBrand(data.brand);
    if (data.finish) await this.ensureFinish(data.finish);
    return this.prisma.product.update({ where: { id }, data: data as any });
  }

  async delete(id: string) {
    await this.findById(id);
    return this.prisma.product.delete({ where: { id } });
  }

  async getCategories() {
    const [masterCategories, productCategories] = await Promise.all([
      this.prisma.productCategory.findMany({
        where: { status: 'active' },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.product.findMany({
        select: { category: true },
        distinct: ['category'],
        orderBy: { category: 'asc' },
      }),
    ]);
    return Array.from(new Set([
      ...masterCategories.map((category) => category.name),
      ...productCategories.map((product) => product.category),
    ].filter(Boolean)));
  }

  async getBrands() {
    const [masterBrands, productBrands] = await Promise.all([
      this.prisma.productBrand.findMany({
        where: { status: 'active' },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.product.findMany({
        select: { brand: true },
        distinct: ['brand'],
        orderBy: { brand: 'asc' },
      }),
    ]);
    return Array.from(new Set([
      ...masterBrands.map((brand) => brand.name),
      ...productBrands.map((product) => product.brand),
    ].filter(Boolean)));
  }

  async getFinishes() {
    const [masterFinishes, productFinishes] = await Promise.all([
      this.prisma.productFinish.findMany({
        where: { status: 'active' },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.product.findMany({
        select: { finish: true },
        distinct: ['finish'],
        orderBy: { finish: 'asc' },
      }),
    ]);
    return Array.from(new Set([
      ...masterFinishes.map((finish) => finish.name),
      ...productFinishes.map((product) => product.finish),
    ].filter(Boolean)));
  }

  async getStats() {
    const [totalProducts, categories, brands, activeProducts] = await Promise.all([
      this.prisma.product.count(),
      this.prisma.product.groupBy({
        by: ['category'],
        _count: { _all: true },
        orderBy: { _count: { category: 'desc' } },
      } as any),
      this.prisma.product.groupBy({
        by: ['brand'],
        _count: { _all: true },
        orderBy: { _count: { brand: 'desc' } },
      } as any),
      this.prisma.product.count({ where: { status: 'active' } }),
    ]);

    return {
      totalProducts,
      activeProducts,
      totalCategories: categories.length,
      totalBrands: brands.length,
      categories: categories.map((row: any) => ({
        name: row.category,
        count: row._count._all,
      })),
      brands: brands.map((row: any) => ({
        name: row.brand,
        count: row._count._all,
      })),
    };
  }

  private async ensureCategory(name: string) {
    const clean = String(name || '').trim();
    if (!clean) return;
    await this.prisma.productCategory.upsert({
      where: { name: clean },
      update: { status: 'active', updatedAt: new Date() },
      create: {
        id: ulid(),
        name: clean,
        code: clean.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32),
        description: 'Created from product master entry',
        status: 'active',
        sortOrder: 100,
        metadata: { source: 'product-create' },
        updatedAt: new Date(),
      },
    });
  }

  private async ensureBrand(name: string) {
    const clean = String(name || '').trim();
    if (!clean) return;
    await this.prisma.productBrand.upsert({
      where: { name: clean },
      update: { status: 'active', updatedAt: new Date() },
      create: {
        id: ulid(),
        name: clean,
        code: clean.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32),
        description: 'Created from product master entry',
        status: 'active',
        sortOrder: 100,
        metadata: { source: 'product-create' },
        updatedAt: new Date(),
      },
    });
  }

  private async ensureFinish(name: string) {
    const clean = String(name || '').trim();
    if (!clean) return;
    await this.prisma.productFinish.upsert({
      where: { name: clean },
      update: { status: 'active', updatedAt: new Date() },
      create: {
        id: ulid(),
        name: clean,
        code: clean.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32),
        description: 'Created from product master entry',
        status: 'active',
        sortOrder: 100,
        metadata: { source: 'product-create' },
        updatedAt: new Date(),
      },
    });
  }

  private normalizeSku(sku: string) {
    return String(sku || '').trim().replace(/\s+/g, '').toUpperCase();
  }
}
