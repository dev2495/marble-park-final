import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ulid } from 'ulid';

export interface CreateProductInput {
  sku: string;
  name: string;
  category: string;
  brand?: string;
  finish?: string;
  dimensions?: string;
  unit?: string;
  sellPrice?: number;
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
  expectedUpdatedAt?: string;
}

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  async findAll(args?: { search?: string; category?: string; take?: number; includeInactive?: boolean }) {
    const where: any = args?.includeInactive ? {} : { status: 'active' };
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

  async create(data: CreateProductInput, actorUserId?: string): Promise<any> {
    const sku = this.normalizeSku(data.sku);
    const name = String(data.name || '').trim();
    const category = String(data.category || '').trim();
    const brand = String(data.brand || '').trim();
    const finish = String(data.finish || '').trim();
    const sellPrice = Number(data.sellPrice || 0);
    const floorPrice = Number(data.floorPrice || 0);
    if (!sku) throw new BadRequestException('SKU is required');
    if (!name) throw new BadRequestException('Product name is required');
    if (!category) throw new BadRequestException('Category is required');
    if (!Number.isFinite(sellPrice) || sellPrice < 0) throw new BadRequestException('Sell price must be zero or greater');
    if (!Number.isFinite(floorPrice) || floorPrice < 0) throw new BadRequestException('Floor price must be zero or greater');
    if (sellPrice > 0 && floorPrice > sellPrice) throw new BadRequestException('Floor price cannot exceed the sell price');

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
          floorPrice,
          taxClass: data.taxClass || 'GST_18',
          status: 'active',
          media: this.normalizeMedia(data.media),
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
      await tx.auditEvent.create({
        data: {
          id: ulid(),
          actorUserId: actorUserId || 'system',
          action: 'product.create',
          entityType: 'Product',
          entityId: product.id,
          summary: `Created product ${product.sku}`,
          metadata: { sku: product.sku, name: product.name, sellPrice: product.sellPrice, floorPrice: product.floorPrice },
        },
      });
      return product;
    });
  }

  async update(id: string, data: UpdateProductInput, actorUserId?: string): Promise<any> {
    const current = await this.findById(id);
    const expectedUpdatedAt = data.expectedUpdatedAt ? new Date(data.expectedUpdatedAt) : null;
    if (data.expectedUpdatedAt && (!expectedUpdatedAt || !Number.isFinite(expectedUpdatedAt.getTime()) || current.updatedAt.getTime() !== expectedUpdatedAt.getTime())) {
      throw new BadRequestException('This product was changed by another user. Refresh it before saving your changes.');
    }

    const update: any = {};
    for (const key of ['name', 'category', 'brand', 'finish', 'dimensions', 'unit', 'taxClass', 'description', 'status']) {
      if ((data as any)[key] !== undefined) update[key] = String((data as any)[key] || '').trim();
    }
    if (update.unit !== undefined) update.unit = update.unit.toUpperCase() || 'PC';
    if (update.name !== undefined && !update.name) throw new BadRequestException('Product name is required');
    if (update.category !== undefined && !update.category) throw new BadRequestException('Category is required');
    if (update.status !== undefined && !['active', 'inactive', 'archived'].includes(update.status)) {
      throw new BadRequestException('Product status must be active, inactive, or archived');
    }
    if (data.sellPrice !== undefined) update.sellPrice = this.numberAtLeastZero(data.sellPrice, 'Sell price');
    if (data.floorPrice !== undefined) update.floorPrice = this.numberAtLeastZero(data.floorPrice, 'Floor price');
    const effectiveSellPrice = update.sellPrice ?? Number(current.sellPrice || 0);
    const effectiveFloorPrice = update.floorPrice ?? Number(current.floorPrice || 0);
    if (effectiveSellPrice > 0 && effectiveFloorPrice > effectiveSellPrice) {
      throw new BadRequestException('Floor price cannot exceed the sell price');
    }
    if (data.media !== undefined) update.media = this.normalizeMedia(data.media);
    if (update.category) await this.ensureCategory(update.category);
    if (update.brand) await this.ensureBrand(update.brand);
    if (update.finish) await this.ensureFinish(update.finish);

    const updatedAt = new Date();
    update.updatedAt = updatedAt;
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.product.updateMany({
        where: expectedUpdatedAt ? { id, updatedAt: expectedUpdatedAt } : { id },
        data: update,
      });
      if (result.count !== 1) throw new BadRequestException('This product was changed by another user. Refresh it before saving your changes.');
      const product = await tx.product.findUniqueOrThrow({ where: { id } });
      await tx.auditEvent.create({
        data: {
          id: ulid(),
          actorUserId: actorUserId || 'system',
          action: 'product.update',
          entityType: 'Product',
          entityId: id,
          summary: `Updated product ${product.sku}`,
          metadata: { before: this.auditProduct(current), after: this.auditProduct(product) },
        },
      });
      return product;
    });
  }

  async delete(id: string, actorUserId?: string) {
    const product = await this.findById(id);
    return this.prisma.$transaction(async (tx) => {
      const archived = await tx.product.update({
        where: { id },
        data: { status: 'archived', updatedAt: new Date() },
      });
      await tx.auditEvent.create({
        data: {
          id: ulid(),
          actorUserId: actorUserId || 'system',
          action: 'product.archive',
          entityType: 'Product',
          entityId: id,
          summary: `Archived product ${product.sku}`,
          metadata: { sku: product.sku, previousStatus: product.status },
        },
      });
      return archived;
    });
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

  private numberAtLeastZero(value: unknown, label: string) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue) || numberValue < 0) throw new BadRequestException(`${label} must be zero or greater`);
    return numberValue;
  }

  private normalizeMedia(media: any) {
    if (!media) return {};
    let candidate = media;
    if (typeof candidate === 'string') {
      try {
        candidate = JSON.parse(candidate);
      } catch {
        throw new BadRequestException('Product media must be valid structured data');
      }
    }
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new BadRequestException('Product media must be an object');
    }
    const entries = Array.isArray(candidate.gallery) ? candidate.gallery : Array.isArray(candidate.images) ? candidate.images : [];
    if (entries.length > 8) throw new BadRequestException('A product can have at most 8 images');
    const gallery = entries.map((entry: any) => {
      const url = typeof entry === 'string' ? entry : entry?.url;
      if (!this.isSafeMediaUrl(url)) throw new BadRequestException('Product images must use an approved uploaded image URL');
      return typeof entry === 'string' ? { url } : { url, alt: String(entry.alt || '').slice(0, 180) };
    });
    const urls = new Set<string>();
    for (const image of gallery) {
      if (urls.has(image.url)) throw new BadRequestException('Product image URLs must be unique');
      urls.add(image.url);
    }
    const primaryUrl = candidate.primaryUrl || candidate.primaryImage || gallery[0]?.url || null;
    if (primaryUrl && !urls.has(primaryUrl)) throw new BadRequestException('The primary product image must be part of the gallery');
    return { gallery, primaryUrl };
  }

  private isSafeMediaUrl(value: unknown) {
    const url = String(value || '').trim();
    if (!url || url.length > 2048 || url.startsWith('data:') || url.startsWith('file:')) return false;
    return /^https:\/\//i.test(url) || /^\/catalogue-images\/manual\/[A-Za-z0-9_-]+\.(?:jpe?g|png|webp)$/i.test(url);
  }

  private auditProduct(product: any) {
    return {
      sku: product.sku,
      name: product.name,
      category: product.category,
      brand: product.brand,
      finish: product.finish,
      dimensions: product.dimensions,
      unit: product.unit,
      sellPrice: product.sellPrice,
      floorPrice: product.floorPrice,
      taxClass: product.taxClass,
      status: product.status,
      media: product.media,
    };
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
