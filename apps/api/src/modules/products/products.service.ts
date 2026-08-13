import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ulid } from 'ulid';
import { nextDocumentNumber } from '../common/sequence';
import { StoredImageService } from '../assets/stored-image.service';

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
  costPrice?: number;
  mrp?: number;
  mrpRateBasis?: string;
  mrpSource?: string;
  taxClass?: string;
  description?: string;
  status?: string;
  media?: any;
  internalCode?: string;
  materialId?: string;
  tileSizeId?: string;
  baseUom?: string;
  purchaseUom?: string;
  salesUom?: string;
  piecesPerPack?: number;
  coveragePerPack?: number;
  hsnCode?: string;
  allowLoose?: boolean;
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
  costPrice?: number;
  mrp?: number;
  mrpRateBasis?: string;
  mrpSource?: string;
  taxClass?: string;
  description?: string;
  status?: string;
  media?: any;
  expectedUpdatedAt?: string;
  internalCode?: string;
  materialId?: string;
  tileSizeId?: string;
  baseUom?: string;
  purchaseUom?: string;
  salesUom?: string;
  piecesPerPack?: number;
  coveragePerPack?: number;
  hsnCode?: string;
  allowLoose?: boolean;
}

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService, private storedImages: StoredImageService) {}

  async findAll(args?: { search?: string; category?: string; take?: number; skip?: number; includeInactive?: boolean }) {
    const where: any = args?.includeInactive ? {} : { status: 'active' };
    if (args?.search) {
      where.OR = [
        { name: { contains: args.search, mode: 'insensitive' } },
        { sku: { contains: args.search, mode: 'insensitive' } },
        { internalCode: { contains: args.search, mode: 'insensitive' } },
        { brand: { contains: args.search, mode: 'insensitive' } },
        { aliases: { some: { normalizedValue: { contains: String(args.search).trim().toUpperCase() }, status: 'active' } } },
      ];
    }
    if (args?.category) where.category = args.category;

    return this.prisma.product.findMany({
      where,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: Math.min(Math.max(Number(args?.take || 60), 1), 200),
      skip: Math.max(Number(args?.skip || 0), 0),
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
    const status = String(data.status || 'active').trim().toLowerCase();
    const sellPrice = Number(data.sellPrice || 0);
    const floorPrice = Number(data.floorPrice || 0);
    const costPrice = Number(data.costPrice || 0);
    const mrp = data.mrp === undefined || data.mrp === null ? null : Number(data.mrp);
    const mrpRateBasis = mrp === null ? null : this.normalizeMrpBasis(data.mrpRateBasis || this.basisForUom(data.salesUom || data.unit));
    const mrpSource = mrp === null ? null : this.normalizeMrpSource(data.mrpSource || 'MANUAL');
    if (!sku) throw new BadRequestException('SKU is required');
    if (!name) throw new BadRequestException('Product name is required');
    if (!category) throw new BadRequestException('Category is required');
    if (!Number.isFinite(sellPrice) || sellPrice < 0) throw new BadRequestException('Sell price must be zero or greater');
    if (!Number.isFinite(floorPrice) || floorPrice < 0) throw new BadRequestException('Floor price must be zero or greater');
    if (!Number.isFinite(costPrice) || costPrice < 0) throw new BadRequestException('Default purchase cost must be zero or greater');
    if (mrp !== null && (!Number.isFinite(mrp) || mrp <= 0)) throw new BadRequestException('Verified MRP must be greater than zero');
    if (sellPrice > 0 && floorPrice > sellPrice) throw new BadRequestException('Floor price cannot exceed the sell price');
    if (!['active', 'inactive', 'archived'].includes(status)) {
      throw new BadRequestException('Product status must be active, inactive, or archived');
    }

    const existing = await this.findBySku(sku);
    if (existing) {
      throw new BadRequestException('Product with this SKU already exists');
    }
    const [categoryMaster, brandMaster, finishMaster] = await Promise.all([
      this.ensureCategory(category), this.ensureBrand(brand), this.ensureFinish(finish),
    ]);
    const internalCode = this.normalizeInternalCode(data.internalCode || sku);
    const existingInternal = await this.prisma.product.findFirst({ where: { internalCode } });
    if (existingInternal) throw new BadRequestException('This internal product code is already assigned');
    await this.assertCodeAvailable(internalCode, '');
    const tileDefaults = category.toLowerCase() === 'tiles';
    const uoms = [data.baseUom || (tileDefaults ? 'PC' : data.unit) || 'PC', data.purchaseUom || data.unit || (tileDefaults ? 'BOX' : 'PC'), data.salesUom || data.unit || (tileDefaults ? 'BOX' : 'PC')]
      .map((value) => String(value).trim().toUpperCase());
    const coveragePerPack = this.numberAtLeastZero(data.coveragePerPack || 0, 'Coverage per pack');
    const validUoms = await this.prisma.unitOfMeasure.count({ where: { code: { in: Array.from(new Set(uoms)) }, status: 'active' } });
    if (validUoms !== new Set(uoms).size) throw new BadRequestException('Base, purchase and sales UOM must use active UOM masters');
    const normalizedMedia = await this.normalizeMedia(data.media);
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
          unit: String(data.unit || uoms[1]).trim().toUpperCase() || uoms[1],
          tags: [],
          sellPrice,
          floorPrice,
          costPrice,
          mrp,
          mrpRateBasis,
          mrpSource,
          mrpVerifiedAt: mrp === null ? null : new Date(),
          mrpVerifiedById: mrp === null ? null : actorUserId || 'system',
          taxClass: data.taxClass || 'GST_18',
          status,
          media: normalizedMedia,
          sourceRefs: {},
          description: data.description || '',
          internalCode,
          categoryId: categoryMaster?.id || null,
          brandId: brandMaster?.id || null,
          finishId: finishMaster?.id || null,
          materialId: data.materialId || null,
          tileSizeId: data.tileSizeId || null,
          baseUom: uoms[0], purchaseUom: uoms[1], salesUom: uoms[2],
          piecesPerPack: Math.max(1, Math.trunc(Number(data.piecesPerPack || 1))),
          coveragePerPack,
          hsnCode: String(data.hsnCode || '').trim() || null,
          trackLots: true, allowLoose: Boolean(data.allowLoose),
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
      await tx.productAlias.create({
        data: { id: ulid(), productId: product.id, type: 'internal_code', value: internalCode,
          normalizedValue: internalCode, status: 'active', isPrimary: true, metadata: {}, updatedAt: new Date() },
      });
      await tx.auditEvent.create({
        data: {
          id: ulid(),
          actorUserId: actorUserId || 'system',
          action: 'product.create',
          entityType: 'Product',
          entityId: product.id,
          summary: `Created product ${product.sku}`,
          metadata: { sku: product.sku, name: product.name, sellPrice: product.sellPrice, floorPrice: product.floorPrice, costPrice: product.costPrice, mrp: product.mrp, mrpRateBasis: product.mrpRateBasis },
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
    if (data.costPrice !== undefined) update.costPrice = this.numberAtLeastZero(data.costPrice, 'Default purchase cost');
    if (data.mrp !== undefined) {
      if (data.mrp === null || data.mrp === ('' as any)) {
        update.mrp = null;
        update.mrpRateBasis = null;
        update.mrpSource = null;
        update.mrpVerifiedAt = null;
        update.mrpVerifiedById = null;
      } else {
        const mrp = Number(data.mrp);
        if (!Number.isFinite(mrp) || mrp <= 0) throw new BadRequestException('Verified MRP must be greater than zero');
        update.mrp = mrp;
        update.mrpRateBasis = this.normalizeMrpBasis(data.mrpRateBasis || current.mrpRateBasis || this.basisForUom(data.salesUom || current.salesUom));
        update.mrpSource = this.normalizeMrpSource(data.mrpSource || current.mrpSource || 'MANUAL');
        update.mrpVerifiedAt = new Date();
        update.mrpVerifiedById = actorUserId || 'system';
      }
    } else if (data.mrpRateBasis !== undefined || data.mrpSource !== undefined) {
      if (current.mrp === null || current.mrp === undefined) throw new BadRequestException('Enter verified MRP before changing its basis or source');
      if (data.mrpRateBasis !== undefined) update.mrpRateBasis = this.normalizeMrpBasis(data.mrpRateBasis);
      if (data.mrpSource !== undefined) update.mrpSource = this.normalizeMrpSource(data.mrpSource);
      update.mrpVerifiedAt = new Date();
      update.mrpVerifiedById = actorUserId || 'system';
    }
    const effectiveSellPrice = update.sellPrice ?? Number(current.sellPrice || 0);
    const effectiveFloorPrice = update.floorPrice ?? Number(current.floorPrice || 0);
    if (effectiveSellPrice > 0 && effectiveFloorPrice > effectiveSellPrice) {
      throw new BadRequestException('Floor price cannot exceed the sell price');
    }
    if (data.media !== undefined) update.media = await this.normalizeMedia(data.media);
    if (update.category) update.categoryId = (await this.ensureCategory(update.category))?.id || null;
    if (update.brand) update.brandId = (await this.ensureBrand(update.brand))?.id || null;
    if (update.finish) update.finishId = (await this.ensureFinish(update.finish))?.id || null;
    if (data.internalCode !== undefined) {
      const internalCode = this.normalizeInternalCode(data.internalCode);
      const duplicate = await this.prisma.product.findFirst({ where: { internalCode, id: { not: id } } });
      if (duplicate) throw new BadRequestException('This internal product code is already assigned');
      await this.assertCodeAvailable(internalCode, id);
      update.internalCode = internalCode;
    }
    for (const key of ['materialId', 'tileSizeId']) if ((data as any)[key] !== undefined) update[key] = (data as any)[key] || null;
    for (const key of ['baseUom', 'purchaseUom', 'salesUom']) {
      if ((data as any)[key] !== undefined) update[key] = String((data as any)[key]).trim().toUpperCase();
    }
    if (data.piecesPerPack !== undefined) update.piecesPerPack = Math.max(1, Math.trunc(Number(data.piecesPerPack || 1)));
    if (data.coveragePerPack !== undefined) update.coveragePerPack = this.numberAtLeastZero(data.coveragePerPack, 'Coverage per pack');
    if (data.hsnCode !== undefined) update.hsnCode = String(data.hsnCode || '').trim() || null;
    if (data.allowLoose !== undefined) update.allowLoose = Boolean(data.allowLoose);
    const updatedAt = new Date();
    update.updatedAt = updatedAt;
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.product.updateMany({
        where: expectedUpdatedAt ? { id, updatedAt: expectedUpdatedAt } : { id },
        data: update,
      });
      if (result.count !== 1) throw new BadRequestException('This product was changed by another user. Refresh it before saving your changes.');
      const product = await tx.product.findUniqueOrThrow({ where: { id } });
      if (data.internalCode !== undefined && product.internalCode) {
        await tx.productAlias.updateMany({ where: { productId: product.id, type: 'internal_code', status: 'active' }, data: { isPrimary: false, updatedAt: new Date() } });
        await tx.productAlias.upsert({
          where: { type_normalizedValue: { type: 'internal_code', normalizedValue: product.internalCode } },
          update: { productId: product.id, value: product.internalCode, status: 'active', isPrimary: true, updatedAt: new Date() },
          create: { id: ulid(), productId: product.id, type: 'internal_code', value: product.internalCode,
            normalizedValue: product.internalCode, status: 'active', isPrimary: true, metadata: {}, updatedAt: new Date() },
        });
      }
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

  async getMasters() {
    const [categories, brands, finishes, materials, tileSizes, uoms, taxCodes] = await Promise.all([
      this.prisma.productCategory.findMany({ where: { status: 'active' }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      this.prisma.productBrand.findMany({ where: { status: 'active' }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      this.prisma.productFinish.findMany({ where: { status: 'active' }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      this.prisma.productMaterial.findMany({ where: { status: 'active' }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      this.prisma.tileSize.findMany({ where: { status: 'active' }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      this.prisma.unitOfMeasure.findMany({ where: { status: 'active' }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] }),
      this.prisma.taxCode.findMany({ where: { status: 'active' }, orderBy: [{ sortOrder: 'asc' }, { rate: 'asc' }] }),
    ]);
    return { categories, brands, finishes, materials, tileSizes, uoms, taxCodes };
  }

  async displaySamples(args?: { productId?: string; locationId?: string; status?: string; take?: number }) {
    const where: any = {};
    if (args?.productId) where.productId = args.productId;
    if (args?.locationId) where.locationId = args.locationId;
    if (args?.status && args.status !== 'all') where.status = args.status;
    return this.prisma.displaySample.findMany({ where, include: { product: true }, orderBy: { createdAt: 'desc' }, take: Math.min(300, args?.take || 100) });
  }

  async tileDesignStats() {
    const tileWhere = { status: 'active', category: { equals: 'Tiles', mode: 'insensitive' as const } };
    const [products, displaySamples] = await Promise.all([
      this.prisma.product.findMany({ where: tileWhere, select: { internalCode: true, media: true } }),
      this.prisma.displaySample.count({ where: { status: 'active', product: tileWhere } }),
    ]);
    const hasImage = (media: any) => Boolean(media?.primaryUrl || media?.url || media?.imageUrl || (Array.isArray(media?.images) && media.images.length));
    return {
      designs: products.length,
      displaySamples,
      missingImages: products.filter((product) => !hasImage(product.media)).length,
      missingInternalCodes: products.filter((product) => !String(product.internalCode || '').trim()).length,
    };
  }

  async productAliases(productId: string) {
    await this.findById(productId);
    return this.prisma.productAlias.findMany({
      where: { productId }, orderBy: [{ status: 'asc' }, { isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async saveProductAlias(input: any, actorUserId: string) {
    const product = await this.findById(String(input.productId || ''));
    const type = String(input.type || 'legacy_code').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_');
    const value = String(input.value || '').trim();
    const normalizedValue = this.normalizeInternalCode(value);
    if (!value) throw new BadRequestException('Alias value is required');
    await this.assertCodeAvailable(normalizedValue, product.id);
    return this.prisma.$transaction(async (tx: any) => {
      if (input.isPrimary) await tx.productAlias.updateMany({ where: { productId: product.id, type, status: 'active' }, data: { isPrimary: false, updatedAt: new Date() } });
      const alias = await tx.productAlias.upsert({
        where: { type_normalizedValue: { type, normalizedValue } },
        update: { productId: product.id, value, status: 'active', isPrimary: Boolean(input.isPrimary), updatedAt: new Date() },
        create: { id: ulid(), productId: product.id, type, value, normalizedValue, status: 'active', isPrimary: Boolean(input.isPrimary), metadata: { source: 'manual' }, updatedAt: new Date() },
      });
      await tx.auditEvent.create({ data: { id: ulid(), actorUserId, action: 'product.alias.save', entityType: 'ProductAlias', entityId: alias.id, summary: `Saved alias ${value} for ${product.sku}`, metadata: { productId: product.id, type, normalizedValue } } });
      return alias;
    });
  }

  async archiveProductAlias(id: string, reason: string, actorUserId: string) {
    const cleanReason = String(reason || '').trim();
    if (!cleanReason) throw new BadRequestException('An archive reason is required');
    return this.prisma.$transaction(async (tx: any) => {
      const alias = await tx.productAlias.findUnique({ where: { id }, include: { product: true } });
      if (!alias) throw new NotFoundException('Product alias not found');
      if (alias.type === 'internal_code' && alias.isPrimary) throw new BadRequestException('The primary display code must be changed from Product Master, not archived');
      const updated = await tx.productAlias.update({ where: { id }, data: { status: 'archived', isPrimary: false, metadata: { ...(alias.metadata || {}), archiveReason: cleanReason }, updatedAt: new Date() } });
      await tx.auditEvent.create({ data: { id: ulid(), actorUserId, action: 'product.alias.archive', entityType: 'ProductAlias', entityId: id, summary: `Archived alias ${alias.value} for ${alias.product.sku}`, metadata: { reason: cleanReason } } });
      return updated;
    });
  }

  async createDisplaySample(input: any, actorUserId: string) {
    const product = await this.findById(String(input.productId || ''));
    const internalCode = this.normalizeInternalCode(input.internalCode || product.internalCode || product.sku);
    if (await this.prisma.displaySample.findUnique({ where: { internalCode } })) throw new BadRequestException('This display code is already registered');
    await this.assertCodeAvailable(internalCode, product.id);
    return this.prisma.$transaction(async (tx: any) => {
      const sampleNumber = await nextDocumentNumber(tx, 'display_sample', 'DS', new Date(), {
        existingNumbers: async (prefixForYear) => (await tx.displaySample.findMany({ where: { sampleNumber: { startsWith: prefixForYear } }, select: { sampleNumber: true } })).map((row: any) => row.sampleNumber),
      });
      const sample = await tx.displaySample.create({ data: {
        id: ulid(), sampleNumber, productId: product.id, internalCode, locationId: input.locationId || null,
        displayZone: input.displayZone || null, displayPosition: input.displayPosition || null,
        imageUrl: input.imageUrl || (product.media as any)?.primaryUrl || null, status: 'active', sellable: false,
        installedAt: input.installedAt ? new Date(input.installedAt) : new Date(), metadata: input.metadata || {}, updatedAt: new Date(),
      } });
      await tx.productAlias.upsert({
        where: { type_normalizedValue: { type: 'showroom_code', normalizedValue: internalCode } },
        update: { productId: product.id, value: internalCode, status: 'active', updatedAt: new Date() },
        create: { id: ulid(), productId: product.id, type: 'showroom_code', value: internalCode, normalizedValue: internalCode, status: 'active', isPrimary: false, metadata: { displaySampleId: sample.id }, updatedAt: new Date() },
      });
      await tx.auditEvent.create({ data: { id: ulid(), actorUserId, action: 'display_sample.create', entityType: 'DisplaySample', entityId: sample.id,
        summary: `Registered display ${internalCode}`, metadata: { productId: product.id, sampleNumber } } });
      return tx.displaySample.findUnique({ where: { id: sample.id }, include: { product: true } });
    });
  }

  async updateDisplaySample(id: string, input: any, actorUserId: string) {
    const existing = await this.prisma.displaySample.findUnique({ where: { id }, include: { product: true } });
    if (!existing) throw new NotFoundException('Display sample not found');
    const internalCode = input.internalCode === undefined ? existing.internalCode : this.normalizeInternalCode(input.internalCode);
    if (await this.prisma.displaySample.findFirst({ where: { internalCode, id: { not: id } } })) throw new BadRequestException('This display code is already registered');
    await this.assertCodeAvailable(internalCode, existing.productId, id);
    const status = String(input.status ?? existing.status).trim().toLowerCase();
    if (!['active', 'removed', 'maintenance'].includes(status)) throw new BadRequestException('Display status must be active, maintenance, or removed');
    return this.prisma.$transaction(async (tx: any) => {
      const sample = await tx.displaySample.update({
        where: { id },
        data: {
          internalCode,
          locationId: input.locationId === undefined ? existing.locationId : input.locationId || null,
          displayZone: input.displayZone === undefined ? existing.displayZone : input.displayZone || null,
          displayPosition: input.displayPosition === undefined ? existing.displayPosition : input.displayPosition || null,
          imageUrl: input.imageUrl === undefined ? existing.imageUrl : input.imageUrl || null,
          status,
          removedAt: status === 'removed' ? new Date() : null,
          metadata: input.metadata === undefined ? existing.metadata : { ...(existing.metadata as any), ...(input.metadata || {}) },
          updatedAt: new Date(),
        },
        include: { product: true },
      });
      await tx.productAlias.upsert({
        where: { type_normalizedValue: { type: 'showroom_code', normalizedValue: internalCode } },
        update: { productId: existing.productId, value: internalCode, status: 'active', updatedAt: new Date() },
        create: { id: ulid(), productId: existing.productId, type: 'showroom_code', value: internalCode, normalizedValue: internalCode, status: 'active', isPrimary: false, metadata: { displaySampleId: id }, updatedAt: new Date() },
      });
      await tx.auditEvent.create({ data: {
        id: ulid(), actorUserId, action: 'display_sample.update', entityType: 'DisplaySample', entityId: id,
        summary: `Updated display ${internalCode}`, metadata: { status, locationId: sample.locationId },
      } });
      return sample;
    });
  }

  private async assertCodeAvailable(normalizedCode: string, productId: string, displaySampleId?: string) {
    const [product, alias, display] = await Promise.all([
      this.prisma.product.findFirst({ where: { id: { not: productId }, OR: [{ sku: normalizedCode }, { internalCode: normalizedCode }] }, select: { sku: true } }),
      this.prisma.productAlias.findFirst({ where: { productId: { not: productId }, normalizedValue: normalizedCode, status: 'active' }, include: { product: { select: { sku: true } } } }),
      this.prisma.displaySample.findFirst({ where: { id: displaySampleId ? { not: displaySampleId } : undefined, productId: { not: productId }, internalCode: normalizedCode, status: { not: 'removed' } }, include: { product: { select: { sku: true } } } }),
    ]);
    const owner = product?.sku || alias?.product?.sku || display?.product?.sku;
    if (owner) throw new BadRequestException(`Code ${normalizedCode} is already assigned to ${owner}`);
  }

  private async ensureCategory(name: string) {
    const clean = String(name || '').trim();
    if (!clean) return;
    return this.prisma.productCategory.upsert({
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

  private async normalizeMedia(media: any) {
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
    const galleryInput = entries.map((entry: any) => {
      const url = typeof entry === 'string' ? entry : entry?.url;
      if (!this.isSafeMediaUrl(url)) throw new BadRequestException('Product images must use an approved uploaded image URL');
      return typeof entry === 'string' ? { url } : { url, alt: String(entry.alt || '').slice(0, 180) };
    });
    const persisted = await Promise.all(galleryInput.map((entry: any) => this.storedImages.persistRemoteImage(entry.url)));
    const gallery = galleryInput.map((entry: any, index: number) => ({ ...entry, url: persisted[index] }));
    const urls = new Set<string>();
    for (const image of gallery) {
      if (urls.has(image.url)) throw new BadRequestException('Product image URLs must be unique');
      urls.add(image.url);
    }
    const primaryInput = candidate.primaryUrl || candidate.primaryImage || galleryInput[0]?.url || null;
    const primaryIndex = primaryInput ? galleryInput.findIndex((entry: any) => entry.url === primaryInput) : -1;
    if (primaryInput && primaryIndex < 0) throw new BadRequestException('The primary product image must be part of the gallery');
    return { gallery, primaryUrl: primaryIndex >= 0 ? gallery[primaryIndex].url : gallery[0]?.url || null };
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
      costPrice: product.costPrice,
      mrp: product.mrp,
      mrpRateBasis: product.mrpRateBasis,
      mrpSource: product.mrpSource,
      mrpVerifiedAt: product.mrpVerifiedAt,
      mrpVerifiedById: product.mrpVerifiedById,
      taxClass: product.taxClass,
      status: product.status,
      media: product.media,
    };
  }

  private async ensureBrand(name: string) {
    const clean = String(name || '').trim();
    if (!clean) return;
    return this.prisma.productBrand.upsert({
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
    return this.prisma.productFinish.upsert({
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

  private basisForUom(value: unknown) {
    const uom = String(value || 'PC').trim().toUpperCase();
    if (['SQFT', 'SQM', 'M2'].includes(uom)) return 'AREA';
    if (uom === 'PC') return 'PIECE';
    return 'PACK';
  }

  private normalizeMrpBasis(value: unknown) {
    const basis = String(value || '').trim().toUpperCase();
    if (!['PACK', 'PIECE', 'AREA'].includes(basis)) {
      throw new BadRequestException('MRP basis must be PACK, PIECE, or AREA');
    }
    return basis;
  }

  private normalizeMrpSource(value: unknown) {
    const source = String(value || '').trim().toUpperCase();
    if (!['PACKAGE', 'BRAND_LIST', 'MANUAL'].includes(source)) {
      throw new BadRequestException('MRP source must be PACKAGE, BRAND_LIST, or MANUAL');
    }
    return source;
  }

  private normalizeInternalCode(value: string) {
    const code = String(value || '').trim().toUpperCase().replace(/\s+/g, '-');
    if (!code) throw new BadRequestException('Internal product code is required');
    if (!/^[A-Z0-9][A-Z0-9._/-]{1,63}$/.test(code)) throw new BadRequestException('Internal product code contains unsupported characters');
    return code;
  }
}
