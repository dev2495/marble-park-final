import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ulid } from 'ulid';
import { nextDocumentNumber } from '../common/sequence';
import { StoredImageService } from '../assets/stored-image.service';
import { applyLotStockPostingTx } from '../common/lot-stock-posting';

export interface CreateProductInput {
  sku: string;
  name: string;
  category: string;
  brand?: string;
  finish?: string;
  dimensions?: string;
  unit?: string;
  defaultMrpInclusive?: number;
  defaultNrpInclusive?: number;
  floorPriceInclusive?: number;
  priceRateBasis?: string;
  priceUom?: string;
  mrpSource?: string;
  pricingEffectiveFrom?: string;
  taxClass?: string;
  description?: string;
  status?: string;
  media?: any;
  internalCode?: string;
  materialId?: string;
  tileSizeId?: string;
  tileDesignId?: string;
  baseUom?: string;
  purchaseUom?: string;
  salesUom?: string;
  piecesPerPack?: number;
  coveragePerPack?: number;
  hsnCode?: string;
  allowLoose?: boolean;
  supplierAlias?: string;
}

export interface UpdateProductInput {
  name?: string;
  category?: string;
  brand?: string;
  finish?: string;
  dimensions?: string;
  unit?: string;
  defaultMrpInclusive?: number;
  defaultNrpInclusive?: number;
  floorPriceInclusive?: number;
  priceRateBasis?: string;
  priceUom?: string;
  mrpSource?: string;
  mrpChangeReason?: string;
  pricingEffectiveFrom?: string;
  taxClass?: string;
  description?: string;
  status?: string;
  media?: any;
  expectedUpdatedAt?: string;
  internalCode?: string;
  materialId?: string;
  tileSizeId?: string;
  tileDesignId?: string;
  baseUom?: string;
  purchaseUom?: string;
  salesUom?: string;
  piecesPerPack?: number;
  coveragePerPack?: number;
  hsnCode?: string;
  allowLoose?: boolean;
  supplierAlias?: string;
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

  async findByIds(ids: string[]) {
    const uniqueIds = Array.from(new Set((ids || []).map((id) => String(id || '').trim()).filter(Boolean)));
    if (!uniqueIds.length) return [];
    if (uniqueIds.length > 250) throw new BadRequestException('Select at most 250 Product Master items');
    const products = await this.prisma.product.findMany({ where: { id: { in: uniqueIds }, status: 'active' } });
    const byId = new Map(products.map((product: any) => [product.id, product]));
    return uniqueIds.map((id) => byId.get(id)).filter(Boolean);
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
    const tileDefaults = category.toLowerCase() === 'tiles';
    const chemicalDefaults = category.toLowerCase() === 'chemicals';
    const defaults = this.validateSellingDefaults({
      ...data,
      ...(tileDefaults ? { priceRateBasis: 'AREA', priceUom: 'SQFT' } : {}),
      ...(chemicalDefaults ? { priceRateBasis: 'BOX', priceUom: 'KG' } : {}),
    }, chemicalDefaults ? 'KG' : data.salesUom || data.unit, true);
    if (!sku) throw new BadRequestException('SKU is required');
    if (!name) throw new BadRequestException('Product name is required');
    if (!category) throw new BadRequestException('Category is required');
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
    const supplierAlias = String(data.supplierAlias || '').trim();
    const normalizedSupplierAlias = supplierAlias ? this.normalizeInternalCode(supplierAlias) : '';
    if (normalizedSupplierAlias && normalizedSupplierAlias !== internalCode) {
      await this.assertCodeAvailable(normalizedSupplierAlias, '');
    }
    const uoms = (chemicalDefaults
      ? ['KG', 'KG', 'KG']
      : [data.baseUom || (tileDefaults ? 'PC' : data.unit) || 'PC', data.purchaseUom || data.unit || (tileDefaults ? 'BOX' : 'PC'), data.salesUom || data.unit || (tileDefaults ? 'BOX' : 'PC')])
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
          unit: chemicalDefaults ? 'KG' : String(data.unit || uoms[1]).trim().toUpperCase() || uoms[1],
          tags: [],
          sellPrice: 0,
          floorPrice: 0,
          costPrice: 0,
          mrp: defaults.defaultMrpInclusive,
          mrpRateBasis: defaults.priceRateBasis,
          defaultMrpInclusive: defaults.defaultMrpInclusive,
          defaultNrpInclusive: defaults.defaultNrpInclusive,
          floorPriceInclusive: defaults.floorPriceInclusive,
          priceRateBasis: defaults.priceRateBasis,
          priceUom: defaults.priceUom,
          mrpSource: defaults.mrpSource,
          mrpVerifiedAt: defaults.defaultMrpInclusive === null ? null : new Date(),
          mrpVerifiedById: defaults.defaultMrpInclusive === null ? null : actorUserId || 'system',
          pricingEffectiveFrom: defaults.pricingEffectiveFrom,
          pricingVersion: 'unified_retail_v1',
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
          tileDesignId: data.tileDesignId || null,
          baseUom: uoms[0], purchaseUom: uoms[1], salesUom: uoms[2],
          piecesPerPack: chemicalDefaults ? 1 : Math.max(1, Math.trunc(Number(data.piecesPerPack || 1))),
          coveragePerPack: chemicalDefaults ? 0 : coveragePerPack,
          hsnCode: String(data.hsnCode || '').trim() || null,
          trackLots: true, allowLoose: chemicalDefaults ? true : Boolean(data.allowLoose),
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
      if (normalizedSupplierAlias && normalizedSupplierAlias !== internalCode) {
        await tx.productAlias.create({
          data: {
            id: ulid(), productId: product.id, type: 'supplier_sku', value: supplierAlias,
            normalizedValue: normalizedSupplierAlias, status: 'active', isPrimary: false,
            metadata: { source: 'tile_variant' }, updatedAt: new Date(),
          },
        });
      }
      await tx.productMrpHistory.create({
        data: {
          id: ulid(),
          productId: product.id,
          previousMrpInclusive: null,
          newMrpInclusive: product.defaultMrpInclusive!,
          priceRateBasis: product.priceRateBasis || this.basisForUom(product.priceUom || product.salesUom),
          priceUom: product.priceUom || product.salesUom || product.unit || 'PC',
          source: product.mrpSource,
          reason: 'Initial MRP at SKU creation',
          changedById: actorUserId || 'system',
          effectiveFrom: product.pricingEffectiveFrom,
          metadata: { changeKind: 'initial', sku: product.sku },
        },
      });
      await tx.auditEvent.create({
        data: {
          id: ulid(),
          actorUserId: actorUserId || 'system',
          action: 'product.create',
          entityType: 'Product',
          entityId: product.id,
          summary: `Created product ${product.internalCode || product.sku} (${product.sku})`,
          metadata: { sku: product.sku, internalCode: product.internalCode, name: product.name, supplierAlias: supplierAlias || null, defaultMrpInclusive: product.defaultMrpInclusive, defaultNrpInclusive: product.defaultNrpInclusive, floorPriceInclusive: product.floorPriceInclusive, priceRateBasis: product.priceRateBasis, priceUom: product.priceUom },
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
    const currentMrp = current.defaultMrpInclusive == null ? null : Number(current.defaultMrpInclusive);
    for (const key of ['name', 'category', 'brand', 'finish', 'dimensions', 'unit', 'taxClass', 'description', 'status']) {
      if ((data as any)[key] !== undefined) update[key] = String((data as any)[key] || '').trim();
    }
    if (update.unit !== undefined) update.unit = update.unit.toUpperCase() || 'PC';
    if (update.name !== undefined && !update.name) throw new BadRequestException('Product name is required');
    if (update.category !== undefined && !update.category) throw new BadRequestException('Category is required');
    if (update.status !== undefined && !['active', 'inactive', 'archived'].includes(update.status)) {
      throw new BadRequestException('Product status must be active, inactive, or archived');
    }
    const finalCategory = String(data.category === undefined ? current.category : data.category).trim().toLowerCase();
    const isChemical = finalCategory === 'chemicals';
    if (['defaultMrpInclusive', 'defaultNrpInclusive', 'floorPriceInclusive', 'priceRateBasis', 'priceUom', 'mrpSource', 'pricingEffectiveFrom'].some((key) => (data as any)[key] !== undefined)) {
      if (data.defaultMrpInclusive === null && current.defaultMrpInclusive != null) {
        throw new BadRequestException('MRP cannot be cleared after it is verified. Enter a replacement MRP or archive the SKU.');
      }
      const isTile = finalCategory === 'tiles';
      const defaults = this.validateSellingDefaults({
        defaultMrpInclusive: data.defaultMrpInclusive === undefined ? current.defaultMrpInclusive : data.defaultMrpInclusive,
        defaultNrpInclusive: data.defaultNrpInclusive === undefined ? current.defaultNrpInclusive : data.defaultNrpInclusive,
        floorPriceInclusive: data.floorPriceInclusive === undefined ? current.floorPriceInclusive : data.floorPriceInclusive,
        priceRateBasis: isTile ? 'AREA' : isChemical ? 'BOX' : data.priceRateBasis === undefined ? current.priceRateBasis : data.priceRateBasis,
        priceUom: isTile ? 'SQFT' : isChemical ? 'KG' : data.priceUom === undefined ? current.priceUom : data.priceUom,
        mrpSource: data.mrpSource === undefined ? current.mrpSource : data.mrpSource,
        pricingEffectiveFrom: data.pricingEffectiveFrom === undefined ? current.pricingEffectiveFrom : data.pricingEffectiveFrom,
      }, data.salesUom || current.salesUom);
      Object.assign(update, defaults, {
        mrp: defaults.defaultMrpInclusive,
        mrpRateBasis: defaults.priceRateBasis,
        mrpVerifiedAt: defaults.defaultMrpInclusive === null ? null : new Date(),
        mrpVerifiedById: defaults.defaultMrpInclusive === null ? null : actorUserId || 'system',
        pricingVersion: 'unified_retail_v1',
      });
    }
    const nextMrp = update.defaultMrpInclusive === undefined
      ? currentMrp
      : update.defaultMrpInclusive == null ? null : Number(update.defaultMrpInclusive);
    const mrpChanged = nextMrp !== null && (currentMrp === null || Math.abs(nextMrp - currentMrp) > 0.0001);
    const mrpChangeReason = String(data.mrpChangeReason || '').trim();
    if (mrpChanged && currentMrp !== null && mrpChangeReason.length < 3) {
      throw new BadRequestException('Enter a short reason for changing an existing MRP. It will be kept in the SKU price history.');
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
    for (const key of ['materialId', 'tileSizeId', 'tileDesignId']) if ((data as any)[key] !== undefined) update[key] = (data as any)[key] || null;
    for (const key of ['baseUom', 'purchaseUom', 'salesUom']) {
      if ((data as any)[key] !== undefined) update[key] = String((data as any)[key]).trim().toUpperCase();
    }
    if (data.piecesPerPack !== undefined) update.piecesPerPack = Math.max(1, Math.trunc(Number(data.piecesPerPack || 1)));
    if (data.coveragePerPack !== undefined) update.coveragePerPack = this.numberAtLeastZero(data.coveragePerPack, 'Coverage per pack');
    if (data.hsnCode !== undefined) update.hsnCode = String(data.hsnCode || '').trim() || null;
    if (data.allowLoose !== undefined) update.allowLoose = Boolean(data.allowLoose);
    if (isChemical) {
      Object.assign(update, {
        unit: 'KG',
        baseUom: 'KG',
        purchaseUom: 'KG',
        salesUom: 'KG',
        piecesPerPack: 1,
        coveragePerPack: 0,
        allowLoose: true,
        priceRateBasis: 'BOX',
        priceUom: 'KG',
        mrpRateBasis: 'BOX',
      });
    }
    const supplierAlias = data.supplierAlias === undefined ? undefined : String(data.supplierAlias || '').trim();
    const normalizedSupplierAlias = supplierAlias ? this.normalizeInternalCode(supplierAlias) : '';
    if (normalizedSupplierAlias && normalizedSupplierAlias !== current.internalCode) {
      await this.assertCodeAvailable(normalizedSupplierAlias, id);
    }
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
      if (normalizedSupplierAlias && normalizedSupplierAlias !== product.internalCode) {
        await tx.productAlias.upsert({
          where: { type_normalizedValue: { type: 'supplier_sku', normalizedValue: normalizedSupplierAlias } },
          update: { productId: product.id, value: supplierAlias || normalizedSupplierAlias, status: 'active', isPrimary: false, updatedAt: new Date() },
          create: {
            id: ulid(), productId: product.id, type: 'supplier_sku', value: supplierAlias || normalizedSupplierAlias,
            normalizedValue: normalizedSupplierAlias, status: 'active', isPrimary: false,
            metadata: { source: 'tile_variant' }, updatedAt: new Date(),
          },
        });
      }
      if (mrpChanged && product.defaultMrpInclusive != null) {
        await tx.productMrpHistory.create({
          data: {
            id: ulid(),
            productId: product.id,
            previousMrpInclusive: current.defaultMrpInclusive,
            newMrpInclusive: product.defaultMrpInclusive,
            priceRateBasis: product.priceRateBasis || this.basisForUom(product.priceUom || product.salesUom),
            priceUom: product.priceUom || product.salesUom || product.unit || 'PC',
            source: product.mrpSource,
            reason: mrpChangeReason || 'Initial MRP verification',
            changedById: actorUserId || 'system',
            effectiveFrom: product.pricingEffectiveFrom,
            metadata: { changeKind: currentMrp === null ? 'initial_verification' : 'revision', sku: product.sku },
          },
        });
      }
      await tx.auditEvent.create({
        data: {
          id: ulid(),
          actorUserId: actorUserId || 'system',
          action: 'product.update',
          entityType: 'Product',
          entityId: id,
          summary: `Updated product ${product.internalCode || product.sku} (${product.sku})`,
          metadata: { before: this.auditProduct(current), after: this.auditProduct(product), supplierAlias: supplierAlias || null, mrpChanged, mrpChangeReason: mrpChanged ? (mrpChangeReason || 'Initial MRP verification') : null },
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

  async tileDesignsPage(args?: { search?: string; status?: string; sort?: string; skip?: number; take?: number }) {
    const where: any = {};
    if (args?.status && args.status !== 'all') where.status = args.status;
    const search = String(args?.search || '').trim();
    if (search) where.OR = [
      { designCode: { contains: search, mode: 'insensitive' } },
      { name: { contains: search, mode: 'insensitive' } },
      { brand: { contains: search, mode: 'insensitive' } },
      { collection: { contains: search, mode: 'insensitive' } },
      { surface: { contains: search, mode: 'insensitive' } },
      { colour: { contains: search, mode: 'insensitive' } },
      { variants: { some: { OR: [
        { sku: { contains: search, mode: 'insensitive' } },
        { internalCode: { contains: search, mode: 'insensitive' } },
        { aliases: { some: { normalizedValue: { contains: search.toUpperCase() }, status: 'active' } } },
      ] } } },
    ];
    const take = Math.min(100, Math.max(1, Number(args?.take || 30)));
    const skip = Math.max(0, Number(args?.skip || 0));
    const orderBy: any = args?.sort === 'code_asc' ? [{ designCode: 'asc' }, { id: 'asc' }]
      : args?.sort === 'brand_asc' ? [{ brand: 'asc' }, { name: 'asc' }, { id: 'asc' }]
      : args?.sort === 'oldest' ? [{ createdAt: 'asc' }, { id: 'asc' }]
      : [{ updatedAt: 'desc' }, { id: 'desc' }];
    const [items, total] = await Promise.all([
      (this.prisma as any).tileDesign.findMany({
        where, orderBy, skip, take,
        include: {
          variants: {
            where: { status: { not: 'archived' } },
            orderBy: [{ tileSizeMaster: { sortOrder: 'asc' } }, { sku: 'asc' }],
            include: { tileSizeMaster: true, aliases: { where: { status: 'active' }, orderBy: { createdAt: 'asc' } } },
          },
        },
      }),
      (this.prisma as any).tileDesign.count({ where }),
    ]);
    return { items, total, skip, take, hasNext: skip + items.length < total };
  }

  async tileVariantsPage(args?: { search?: string; tileDesignId?: string; tileSizeId?: string; status?: string; sort?: string; skip?: number; take?: number }) {
    const where: any = { category: { equals: 'Tiles', mode: 'insensitive' } };
    if (args?.tileDesignId) where.tileDesignId = args.tileDesignId;
    if (args?.tileSizeId) where.tileSizeId = args.tileSizeId;
    if (args?.status && args.status !== 'all') where.status = args.status;
    const search = String(args?.search || '').trim();
    if (search) where.OR = [
      { sku: { contains: search, mode: 'insensitive' } },
      { internalCode: { contains: search, mode: 'insensitive' } },
      { name: { contains: search, mode: 'insensitive' } },
      { finish: { contains: search, mode: 'insensitive' } },
      { tileDesignMaster: { is: { designCode: { contains: search, mode: 'insensitive' } } } },
      { aliases: { some: { normalizedValue: { contains: search.toUpperCase() }, status: 'active' } } },
    ];
    const take = Math.min(100, Math.max(1, Number(args?.take || 40)));
    const skip = Math.max(0, Number(args?.skip || 0));
    const orderBy: any = args?.sort === 'sku_asc' ? [{ sku: 'asc' }, { id: 'asc' }]
      : args?.sort === 'size_asc' ? [{ dimensions: 'asc' }, { sku: 'asc' }]
      : args?.sort === 'oldest' ? [{ createdAt: 'asc' }, { id: 'asc' }]
      : [{ updatedAt: 'desc' }, { id: 'desc' }];
    const [items, total] = await Promise.all([
      this.prisma.product.findMany({
        where, orderBy, skip, take,
        include: { tileDesignMaster: true, tileSizeMaster: true, aliases: { where: { status: 'active' }, orderBy: { createdAt: 'asc' } } },
      }),
      this.prisma.product.count({ where }),
    ]);
    return { items, total, skip, take, hasNext: skip + items.length < total };
  }

  async saveTileDesign(input: any, actorUserId: string) {
    const designCode = this.normalizeInternalCode(input.designCode);
    const name = String(input.name || '').trim();
    if (!designCode) throw new BadRequestException('Design code is required');
    if (!name) throw new BadRequestException('Design name is required');
    const status = String(input.status || 'active').trim().toLowerCase();
    if (!['active', 'inactive', 'archived'].includes(status)) throw new BadRequestException('Design status must be active, inactive, or archived');
    const existing = input.id ? await (this.prisma as any).tileDesign.findUnique({ where: { id: input.id } }) : null;
    if (input.id && !existing) throw new NotFoundException('Tile design not found');
    if (existing && existing.designCode !== designCode) {
      throw new BadRequestException('Design code is permanent after creation. Add a searchable variant alias for old or supplier codes.');
    }
    const duplicate = await (this.prisma as any).tileDesign.findFirst({ where: { designCode, ...(input.id ? { id: { not: input.id } } : {}) } });
    if (duplicate) throw new BadRequestException(`Design code ${designCode} is already used by ${duplicate.name}`);
    const requestedBrand = String(input.brand || '').trim();
    if (!requestedBrand) throw new BadRequestException('Select a brand from Brand Master');
    const brandMaster = await this.prisma.productBrand.findFirst({
      where: { name: { equals: requestedBrand, mode: 'insensitive' }, status: 'active' },
      select: { name: true },
    });
    if (!brandMaster) throw new BadRequestException('Choose an active brand from Brand Master');
    const media = input.media === undefined && existing ? existing.media : await this.normalizeMedia(input.media || {});
    const data: any = {
      designCode, name,
      brand: brandMaster.name,
      media,
      status,
      metadata: { ...(existing?.metadata || {}), ...(input.metadata || {}) },
      updatedAt: new Date(),
    };
    if (!existing) Object.assign(data, {
      collection: null, material: null, surface: null, style: null, colour: null, pattern: null,
      usage: [], origin: null, description: '', tags: [],
    });
    return this.prisma.$transaction(async (tx: any) => {
      const design = existing
        ? await tx.tileDesign.update({ where: { id: existing.id }, data })
        : await tx.tileDesign.create({ data: { id: ulid(), ...data } });
      await tx.auditEvent.create({ data: {
        id: ulid(), actorUserId, action: existing ? 'tile_design.update' : 'tile_design.create', entityType: 'TileDesign', entityId: design.id,
        summary: `${existing ? 'Updated' : 'Created'} tile design ${design.designCode}`, metadata: { before: existing || null, after: design },
      } });
      return design;
    });
  }

  async saveTileVariant(input: any, actorUserId: string) {
    const [design, size] = await Promise.all([
      (this.prisma as any).tileDesign.findUnique({ where: { id: String(input.tileDesignId || '') } }),
      this.prisma.tileSize.findUnique({ where: { id: String(input.tileSizeId || '') } }),
    ]);
    if (!design || design.status !== 'active') throw new BadRequestException('Select an active tile design');
    if (!size || size.status !== 'active') throw new BadRequestException('Select an active tile size');
    const existing = input.id ? await this.findById(input.id) : null;
    if (existing && String(existing.category || '').toLowerCase() !== 'tiles') throw new BadRequestException('Only tile variants can be edited here');
    if (existing && existing.tileDesignId && existing.tileDesignId !== design.id) throw new BadRequestException('A variant cannot be moved to another design; archive it and create a new warehouse SKU');
    if (existing && existing.tileSizeId && existing.tileSizeId !== size.id) throw new BadRequestException('A variant size cannot change after creation; archive it and create a new warehouse SKU');
    const requestedFinish = String(input.finish || '').trim();
    if (!requestedFinish) throw new BadRequestException('Select a finish from Finish Master');
    const finishMaster = await this.prisma.productFinish.findFirst({
      where: { name: { equals: requestedFinish, mode: 'insensitive' }, status: 'active' },
      select: { name: true },
    });
    if (!finishMaster) throw new BadRequestException('Choose an active finish from Finish Master');
    const finish = finishMaster.name;
    const piecesPerPack = Math.max(1, Math.trunc(Number(input.piecesPerPack || size.pcsPerBox || 1)));
    const coveragePerPack = Number(size.areaPerPieceSqFt || 0) > 0 ? Number(size.areaPerPieceSqFt) * piecesPerPack : Number(size.areaPerBoxSqFt || 0);
    const generatedSku = [design.designCode, size.code || size.name, finish].map((value) => String(value || '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')).filter(Boolean).join('-').slice(0, 80);
    const sku = this.normalizeSku(input.sku || generatedSku);
    const internalCode = this.normalizeInternalCode(input.internalCode || sku);
    if (!existing) {
      const duplicatePair = await this.prisma.product.findFirst({ where: { tileDesignId: design.id, tileSizeId: size.id, finish: { equals: finish, mode: 'insensitive' }, status: { not: 'archived' } } });
      if (duplicatePair) throw new BadRequestException(`Variant already exists as ${duplicatePair.sku}`);
      return this.create({
        sku,
        internalCode,
        name: `${design.name} · ${size.name}${finish ? ` · ${finish}` : ''}`,
        category: 'Tiles',
        brand: design.brand || '',
        finish,
        dimensions: size.name,
        unit: String(input.purchaseUom || size.uom || 'BOX').toUpperCase(),
        defaultMrpInclusive: input.defaultMrpInclusive,
        defaultNrpInclusive: input.defaultNrpInclusive,
        floorPriceInclusive: input.floorPriceInclusive,
        priceRateBasis: 'AREA',
        priceUom: 'SQFT',
        mrpSource: input.mrpSource,
        pricingEffectiveFrom: input.pricingEffectiveFrom,
        status: input.status || 'active',
        description: design.description || '', media: design.media || {},
        tileDesignId: design.id, tileSizeId: size.id,
        baseUom: 'PC', purchaseUom: String(input.purchaseUom || size.uom || 'BOX').toUpperCase(), salesUom: String(input.salesUom || size.uom || 'BOX').toUpperCase(),
        piecesPerPack, coveragePerPack, allowLoose: input.allowLoose === undefined ? true : Boolean(input.allowLoose), hsnCode: input.hsnCode,
        supplierAlias: input.alias,
      }, actorUserId);
    }
    return this.update(existing.id, {
      name: `${design.name} · ${size.name}${finish ? ` · ${finish}` : ''}`,
      brand: design.brand || existing.brand,
      finish,
      dimensions: size.name,
      tileDesignId: design.id,
      tileSizeId: size.id,
      purchaseUom: input.purchaseUom || existing.purchaseUom,
      salesUom: input.salesUom || existing.salesUom,
      piecesPerPack,
      coveragePerPack,
      allowLoose: input.allowLoose === undefined ? existing.allowLoose : Boolean(input.allowLoose),
      hsnCode: input.hsnCode === undefined ? existing.hsnCode || undefined : input.hsnCode,
      defaultMrpInclusive: input.defaultMrpInclusive === undefined ? existing.defaultMrpInclusive : input.defaultMrpInclusive,
      defaultNrpInclusive: input.defaultNrpInclusive === undefined ? existing.defaultNrpInclusive : input.defaultNrpInclusive,
      floorPriceInclusive: input.floorPriceInclusive === undefined ? existing.floorPriceInclusive : input.floorPriceInclusive,
      priceRateBasis: 'AREA',
      priceUom: 'SQFT',
      mrpSource: input.mrpSource === undefined ? existing.mrpSource : input.mrpSource,
      mrpChangeReason: input.mrpChangeReason,
      pricingEffectiveFrom: input.pricingEffectiveFrom === undefined ? existing.pricingEffectiveFrom : input.pricingEffectiveFrom,
      expectedUpdatedAt: input.expectedUpdatedAt,
      status: input.status || existing.status,
      supplierAlias: input.alias,
    }, actorUserId);
  }

  async displaySamples(args?: { productId?: string; locationId?: string; status?: string; take?: number }) {
    const where: any = {};
    if (args?.productId) where.productId = args.productId;
    if (args?.locationId) where.locationId = args.locationId;
    if (args?.status && args.status !== 'all') where.status = args.status;
    const rows = await this.prisma.displaySample.findMany({ where, include: { product: true }, orderBy: { createdAt: 'desc' }, take: Math.min(300, args?.take || 100) });
    const ids = rows.map((row) => row.id);
    const events = ids.length ? await (this.prisma as any).displaySampleEvent.findMany({ where: { displaySampleId: { in: ids } }, orderBy: { createdAt: 'desc' } }) : [];
    const bySample = new Map<string, any[]>();
    for (const event of events) bySample.set(event.displaySampleId, [...(bySample.get(event.displaySampleId) || []), event]);
    return rows.map((row) => ({ ...row, events: bySample.get(row.id) || [] }));
  }

  async displaySamplesPage(args?: { search?: string; locationId?: string; status?: string; sort?: string; skip?: number; take?: number }) {
    const where: any = {};
    if (args?.locationId) where.locationId = args.locationId;
    if (args?.status && args.status !== 'all') where.status = args.status;
    const search = String(args?.search || '').trim();
    if (search) where.OR = [
      { internalCode: { contains: search, mode: 'insensitive' } },
      { sampleNumber: { contains: search, mode: 'insensitive' } },
      { displayZone: { contains: search, mode: 'insensitive' } },
      { product: { is: { OR: [{ sku: { contains: search, mode: 'insensitive' } }, { name: { contains: search, mode: 'insensitive' } }, { internalCode: { contains: search, mode: 'insensitive' } }] } } },
    ];
    const take = Math.min(100, Math.max(1, Number(args?.take || 30)));
    const skip = Math.max(0, Number(args?.skip || 0));
    const orderBy: any = args?.sort === 'code_asc' ? [{ internalCode: 'asc' }, { id: 'asc' }]
      : args?.sort === 'inspection_asc' ? [{ nextInspectionAt: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }]
      : args?.sort === 'oldest' ? [{ createdAt: 'asc' }, { id: 'asc' }]
      : [{ updatedAt: 'desc' }, { id: 'desc' }];
    const [items, total] = await Promise.all([
      this.prisma.displaySample.findMany({ where, include: { product: { include: { tileDesignMaster: true, tileSizeMaster: true } } }, orderBy, skip, take }),
      this.prisma.displaySample.count({ where }),
    ]);
    const ids = items.map((item) => item.id);
    const events = ids.length ? await (this.prisma as any).displaySampleEvent.findMany({ where: { displaySampleId: { in: ids } }, orderBy: { createdAt: 'desc' } }) : [];
    const bySample = new Map<string, any[]>();
    for (const event of events) bySample.set(event.displaySampleId, [...(bySample.get(event.displaySampleId) || []), event]);
    return { items: items.map((item) => ({ ...item, events: bySample.get(item.id) || [] })), total, skip, take, hasNext: skip + items.length < total };
  }

  async tileDesignStats() {
    const tileWhere = { status: 'active', category: { equals: 'Tiles', mode: 'insensitive' as const } };
    const [designs, products, displaySamples] = await Promise.all([
      (this.prisma as any).tileDesign.findMany({ where: { status: 'active' }, select: { media: true } }),
      this.prisma.product.findMany({ where: tileWhere, select: { internalCode: true, media: true } }),
      this.prisma.displaySample.count({ where: { status: 'active', product: tileWhere } }),
    ]);
    const hasImage = (media: any) => Boolean(media?.primaryUrl || media?.url || media?.imageUrl || (Array.isArray(media?.images) && media.images.length));
    return {
      designs: designs.length,
      variants: products.length,
      displaySamples,
      missingImages: designs.filter((design: any) => !hasImage(design.media)).length,
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
    const locationId = String(input.locationId || '').trim();
    const displayZone = String(input.displayZone || '').trim();
    const displayPosition = String(input.displayPosition || '').trim() || null;
    if (!locationId || !displayZone) throw new BadRequestException('Display location and zone are required so the physical asset can be found');
    const location = await this.prisma.stockLocation.findFirst({ where: { id: locationId, status: 'active' }, select: { id: true } });
    if (!location) throw new BadRequestException('Choose an active governed stock/showroom location');
    if (await this.prisma.displaySample.findUnique({ where: { internalCode } })) throw new BadRequestException('This display code is already registered');
    await this.assertCodeAvailable(internalCode, product.id);
    const issuedQuantity = Math.max(0, Math.trunc(Number(input.issuedQuantity || 0)));
    if ((input.sourceLotId && issuedQuantity <= 0) || (!input.sourceLotId && issuedQuantity > 0)) {
      throw new BadRequestException('Choose both a source lot and issued quantity when a display consumes stock');
    }
    return this.prisma.$transaction(async (tx: any) => {
      const sampleNumber = await nextDocumentNumber(tx, 'display_sample', 'DS', new Date(), {
        existingNumbers: async (prefixForYear) => (await tx.displaySample.findMany({ where: { sampleNumber: { startsWith: prefixForYear } }, select: { sampleNumber: true } })).map((row: any) => row.sampleNumber),
      });
      const sample = await tx.displaySample.create({ data: {
        id: ulid(), sampleNumber, productId: product.id, internalCode, locationId,
        displayZone, displayPosition,
        imageUrl: input.imageUrl || (product.media as any)?.primaryUrl || null, status: 'active', sellable: false,
        sourceLotId: input.sourceLotId || null, issuedQuantity, condition: String(input.condition || 'good').trim().toLowerCase(),
        installedAt: input.installedAt ? new Date(input.installedAt) : new Date(), nextInspectionAt: input.nextInspectionAt ? new Date(input.nextInspectionAt) : null,
        metadata: input.metadata || {}, updatedAt: new Date(),
      } });
      if (input.sourceLotId && issuedQuantity > 0) {
        const lot = await tx.inventoryLot.findUnique({ where: { id: input.sourceLotId } });
        if (!lot || lot.productId !== product.id) throw new BadRequestException('Display source lot must belong to the selected product or tile variant');
        const balances = await tx.inventoryLotBalance.findMany({ where: { lotId: lot.id, available: { gt: 0 } }, orderBy: { available: 'desc' } });
        const balance = balances.find((row: any) => row.locationId === locationId);
        if (!balance) throw new BadRequestException('The selected lot has no available stock at the chosen display location');
        if (!balance || Number(balance.available || 0) < issuedQuantity) throw new BadRequestException('Selected lot does not have enough available stock for this display');
        await applyLotStockPostingTx(tx, {
          productId: product.id, lotId: lot.id, locationId: balance.locationId,
          idempotencyKey: `display-issue:${sample.id}`, type: 'display_issue', direction: 'out', quantity: issuedQuantity, onHandDelta: -issuedQuantity,
          reason: `Issued stock to display ${sample.sampleNumber}`, referenceType: 'DisplaySample', referenceId: sample.id,
          sourceDocumentNo: sample.sampleNumber, createdBy: actorUserId, requireAvailable: true,
          metadata: { displaySampleId: sample.id, displayCode: internalCode },
        });
      }
      await tx.productAlias.upsert({
        where: { type_normalizedValue: { type: 'showroom_code', normalizedValue: internalCode } },
        update: { productId: product.id, value: internalCode, status: 'active', updatedAt: new Date() },
        create: { id: ulid(), productId: product.id, type: 'showroom_code', value: internalCode, normalizedValue: internalCode, status: 'active', isPrimary: false, metadata: { displaySampleId: sample.id }, updatedAt: new Date() },
      });
      await tx.auditEvent.create({ data: { id: ulid(), actorUserId, action: 'display_sample.create', entityType: 'DisplaySample', entityId: sample.id,
        summary: `Registered display ${internalCode}`, metadata: { productId: product.id, sampleNumber, sourceLotId: input.sourceLotId || null, issuedQuantity } } });
      await tx.displaySampleEvent.create({ data: { id: ulid(), displaySampleId: sample.id, action: issuedQuantity > 0 ? 'issue_to_display' : 'register', toStatus: 'active', quantity: issuedQuantity, reason: issuedQuantity > 0 ? 'Stock issued to showroom display' : 'Non-stock display asset registered', createdBy: actorUserId, metadata: { sourceLotId: input.sourceLotId || null } } });
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
          condition: input.condition === undefined ? existing.condition : String(input.condition || 'good').trim().toLowerCase(),
          lastInspectedAt: input.lastInspectedAt === undefined ? existing.lastInspectedAt : input.lastInspectedAt ? new Date(input.lastInspectedAt) : null,
          nextInspectionAt: input.nextInspectionAt === undefined ? existing.nextInspectionAt : input.nextInspectionAt ? new Date(input.nextInspectionAt) : null,
          removalReason: input.removalReason === undefined ? existing.removalReason : String(input.removalReason || '').trim() || null,
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

  async transitionDisplaySample(id: string, input: any, actorUserId: string) {
    const existing = await this.prisma.displaySample.findUnique({ where: { id }, include: { product: true } });
    if (!existing) throw new NotFoundException('Display sample not found');
    const action = String(input.action || '').trim().toLowerCase();
    const reason = String(input.reason || '').trim();
    if (!reason) throw new BadRequestException('A reason is required for every display lifecycle action');
    if (!['inspect', 'maintenance', 'reactivate', 'remove', 'return_to_stock'].includes(action)) throw new BadRequestException('Unsupported display lifecycle action');
    if (existing.status === 'removed' && !['inspect'].includes(action)) throw new BadRequestException('Removed displays cannot be reactivated; register a new display asset');
    const returnQuantity = Math.max(0, Math.trunc(Number(input.returnQuantity || 0)));
    if (action === 'return_to_stock') {
      if (!existing.sourceLotId || Number(existing.issuedQuantity || 0) <= 0) throw new BadRequestException('This display was not issued from an inventory lot');
      if (returnQuantity !== Number(existing.issuedQuantity || 0)) throw new BadRequestException('Return the complete issued display quantity; split or partial stock returns are not allowed for one display asset');
    }
    const toStatus = action === 'maintenance' ? 'maintenance' : action === 'reactivate' ? 'active' : ['remove', 'return_to_stock'].includes(action) ? 'removed' : existing.status;
    return this.prisma.$transaction(async (tx: any) => {
      if (action === 'return_to_stock') {
        const balances = await tx.inventoryLotBalance.findMany({ where: { lotId: existing.sourceLotId }, orderBy: { updatedAt: 'desc' } });
        const balance = (existing.locationId && balances.find((row: any) => row.locationId === existing.locationId)) || balances[0];
        if (!balance) throw new BadRequestException('The original lot no longer has a valid stock location');
        await applyLotStockPostingTx(tx, {
          productId: existing.productId, lotId: String(existing.sourceLotId), locationId: balance.locationId,
          idempotencyKey: `display-return:${existing.id}`, type: 'display_return', direction: 'in', quantity: returnQuantity, onHandDelta: returnQuantity,
          reason, referenceType: 'DisplaySample', referenceId: existing.id, sourceDocumentNo: existing.sampleNumber,
          createdBy: actorUserId, metadata: { displaySampleId: existing.id, displayCode: existing.internalCode, condition: input.condition || existing.condition },
        });
      }
      const sample = await tx.displaySample.update({
        where: { id },
        data: {
          status: toStatus,
          condition: String(input.condition || existing.condition || 'good').trim().toLowerCase(),
          lastInspectedAt: action === 'inspect' ? new Date() : existing.lastInspectedAt,
          nextInspectionAt: input.nextInspectionAt ? new Date(input.nextInspectionAt) : existing.nextInspectionAt,
          removedAt: ['remove', 'return_to_stock'].includes(action) ? new Date() : existing.removedAt,
          removalReason: ['remove', 'return_to_stock'].includes(action) ? reason : existing.removalReason,
          issuedQuantity: action === 'return_to_stock' ? 0 : existing.issuedQuantity,
          updatedAt: new Date(),
        }, include: { product: true },
      });
      await tx.displaySampleEvent.create({ data: { id: ulid(), displaySampleId: id, action, fromStatus: existing.status, toStatus, quantity: action === 'return_to_stock' ? returnQuantity : 0, reason, createdBy: actorUserId, metadata: { condition: sample.condition, sourceLotId: existing.sourceLotId } } });
      await tx.auditEvent.create({ data: { id: ulid(), actorUserId, action: `display_sample.${action}`, entityType: 'DisplaySample', entityId: id, summary: `${action.replaceAll('_', ' ')} for display ${existing.internalCode}`, metadata: { reason, fromStatus: existing.status, toStatus, returnQuantity } } });
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

  async pricingReadinessPage(args?: { search?: string; status?: string; sort?: string; skip?: number; take?: number }) {
    const skip = Math.max(0, Number(args?.skip || 0));
    const take = Math.min(100, Math.max(1, Number(args?.take || 25)));
    const search = String(args?.search || '').trim();
    const missingOnly = String(args?.status || 'missing').toLowerCase() !== 'all';
    const missingMrp = { OR: [{ defaultMrpInclusive: null }, { defaultMrpInclusive: { lte: 0 } }] };
    const where: any = {
      status: { not: 'archived' },
      ...(missingOnly ? missingMrp : {}),
      ...(search ? { AND: [{ OR: [
        { sku: { contains: search, mode: 'insensitive' } },
        { internalCode: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
        { brand: { contains: search, mode: 'insensitive' } },
      ] }] } : {}),
    };
    const orderBy: any = args?.sort === 'brand'
      ? [{ brand: 'asc' }, { name: 'asc' }]
      : args?.sort === 'recent'
        ? [{ updatedAt: 'desc' }, { id: 'desc' }]
        : [{ sku: 'asc' }, { id: 'asc' }];
    const [totalActive, totalMissing, filtered, products] = await Promise.all([
      this.prisma.product.count({ where: { status: { not: 'archived' } } }),
      this.prisma.product.count({ where: { status: { not: 'archived' }, ...missingMrp } }),
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where, orderBy, skip, take,
        include: {
          brandMaster: { select: { code: true, name: true } },
          inventoryLots: {
            where: { status: 'active' },
            select: { unitCost: true, costStatus: true, balances: { select: { onHand: true } } },
          },
        },
      }),
    ]);
    const rows = products.map((product: any) => {
      let costQuantity = 0;
      let costValue = 0;
      let onHand = 0;
      let completeCostLots = 0;
      for (const lot of product.inventoryLots || []) {
        const quantity = (lot.balances || []).reduce((sum: number, balance: any) => sum + Number(balance.onHand || 0), 0);
        onHand += quantity;
        if (quantity > 0 && lot.costStatus === 'complete' && Number(lot.unitCost || 0) > 0) {
          costQuantity += quantity;
          costValue += quantity * Number(lot.unitCost);
          completeCostLots += 1;
        }
      }
      return {
        id: product.id, sku: product.sku, internalCode: product.internalCode, name: product.name,
        category: product.category, brand: product.brand, brandCode: product.brandMaster?.code || product.brand,
        dimensions: product.dimensions, finish: product.finish, media: product.media, status: product.status,
        unit: product.unit, purchaseUom: product.purchaseUom, salesUom: product.salesUom,
        defaultMrpInclusive: product.defaultMrpInclusive == null ? null : Number(product.defaultMrpInclusive),
        defaultNrpInclusive: product.defaultNrpInclusive == null ? null : Number(product.defaultNrpInclusive),
        floorPriceInclusive: product.floorPriceInclusive == null ? null : Number(product.floorPriceInclusive),
        priceRateBasis: product.priceRateBasis, priceUom: product.priceUom,
        mrpSource: product.mrpSource, pricingEffectiveFrom: product.pricingEffectiveFrom,
        updatedAt: product.updatedAt,
        cost: {
          onHand, coveredQuantity: costQuantity, completeCostLots,
          weightedUnitCost: costQuantity > 0 ? Number((costValue / costQuantity).toFixed(4)) : null,
          coveragePercent: onHand > 0 ? Number(Math.min(100, costQuantity / onHand * 100).toFixed(1)) : null,
          authority: 'INVENTORY_LOT',
        },
      };
    });
    return {
      totalActive, totalMissing, ready: Math.max(0, totalActive - totalMissing), filtered,
      skip, take, hasPreviousPage: skip > 0, hasNextPage: skip + rows.length < filtered, rows,
    };
  }

  async completePricing(input: any, actorUserId: string) {
    const id = String(input?.productId || '').trim();
    if (!id) throw new BadRequestException('Choose a Product Master SKU');
    return this.update(id, {
      defaultMrpInclusive: input.defaultMrpInclusive,
      defaultNrpInclusive: input.defaultNrpInclusive,
      floorPriceInclusive: input.floorPriceInclusive,
      priceRateBasis: input.priceRateBasis,
      priceUom: input.priceUom,
      mrpSource: input.mrpSource,
      mrpChangeReason: input.mrpChangeReason,
      pricingEffectiveFrom: input.pricingEffectiveFrom,
      expectedUpdatedAt: input.expectedUpdatedAt,
    }, actorUserId);
  }

  async mrpHistoryPage(args?: { productId?: string; search?: string; actorUserId?: string; from?: string; to?: string; skip?: number; take?: number }) {
    const where: any = {};
    if (args?.productId) where.productId = String(args.productId);
    if (args?.actorUserId) where.changedById = String(args.actorUserId);
    const search = String(args?.search || '').trim();
    if (search) {
      where.product = { is: { OR: [
        { sku: { contains: search, mode: 'insensitive' } },
        { internalCode: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
      ] } };
    }
    const createdAt: any = {};
    if (args?.from) {
      const from = new Date(args.from);
      if (!Number.isFinite(from.getTime())) throw new BadRequestException('MRP history start date is invalid');
      createdAt.gte = from;
    }
    if (args?.to) {
      const to = new Date(args.to);
      if (!Number.isFinite(to.getTime())) throw new BadRequestException('MRP history end date is invalid');
      createdAt.lte = to;
    }
    if (Object.keys(createdAt).length) where.createdAt = createdAt;
    const skip = Math.max(0, Number(args?.skip || 0));
    const take = Math.min(100, Math.max(1, Number(args?.take || 25)));
    const [items, total] = await Promise.all([
      this.prisma.productMrpHistory.findMany({
        where,
        skip,
        take,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: { product: { select: { id: true, sku: true, internalCode: true, name: true, category: true, brand: true } } },
      }),
      this.prisma.productMrpHistory.count({ where }),
    ]);
    const actorIds = Array.from(new Set(items.map((row) => row.changedById).filter(Boolean)));
    const actors = actorIds.length ? await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true, role: true } }) : [];
    const actorById = new Map(actors.map((actor) => [actor.id, actor]));
    return {
      items: items.map((row) => ({
        ...row,
        previousMrpInclusive: row.previousMrpInclusive == null ? null : Number(row.previousMrpInclusive),
        newMrpInclusive: Number(row.newMrpInclusive),
        actor: actorById.get(row.changedById) || null,
      })),
      total,
      skip,
      take,
      hasPreviousPage: skip > 0,
      hasNextPage: skip + items.length < total,
    };
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
      defaultMrpInclusive: product.defaultMrpInclusive,
      defaultNrpInclusive: product.defaultNrpInclusive,
      floorPriceInclusive: product.floorPriceInclusive,
      priceRateBasis: product.priceRateBasis,
      priceUom: product.priceUom,
      mrpSource: product.mrpSource,
      mrpVerifiedAt: product.mrpVerifiedAt,
      mrpVerifiedById: product.mrpVerifiedById,
      taxClass: product.taxClass,
      status: product.status,
      media: product.media,
    };
  }

  private validateSellingDefaults(data: any, fallbackUom?: string, requireMrp = false) {
    const parseOptional = (value: unknown, label: string) => {
      if (value === undefined || value === null || value === '') return null;
      const amount = Number(value);
      if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException(`${label} must be greater than zero when provided`);
      return Number(amount.toFixed(2));
    };
    const defaultMrpInclusive = parseOptional(data.defaultMrpInclusive, 'Default MRP');
    const defaultNrpInclusive = parseOptional(data.defaultNrpInclusive, 'Default NRP');
    const floorPriceInclusive = parseOptional(data.floorPriceInclusive, 'Floor price');
    if (requireMrp && defaultMrpInclusive === null) throw new BadRequestException('MRP is required before a new SKU can be created');
    if (defaultMrpInclusive !== null && defaultNrpInclusive !== null && defaultNrpInclusive > defaultMrpInclusive) {
      throw new BadRequestException('Default Normal Retail Price (NRP) cannot exceed Default MRP');
    }
    const normalRate = defaultNrpInclusive ?? defaultMrpInclusive;
    if (floorPriceInclusive !== null && normalRate !== null && floorPriceInclusive > normalRate) {
      throw new BadRequestException('Floor price cannot exceed the normal retail price or MRP');
    }
    const hasPrice = defaultMrpInclusive !== null || defaultNrpInclusive !== null;
    const priceRateBasis = hasPrice ? this.normalizeMrpBasis(data.priceRateBasis || this.basisForUom(data.priceUom || fallbackUom)) : null;
    const priceUom = hasPrice ? String(data.priceUom || fallbackUom || (priceRateBasis === 'PIECE' ? 'PC' : priceRateBasis === 'BOX' ? 'BOX' : '')).trim().toUpperCase() : null;
    if (hasPrice && !priceUom) throw new BadRequestException('Select the UOM used by the default MRP and NRP');
    const effective = data.pricingEffectiveFrom ? new Date(data.pricingEffectiveFrom) : hasPrice ? new Date() : null;
    if (effective && !Number.isFinite(effective.getTime())) throw new BadRequestException('Pricing effective date is invalid');
    return {
      defaultMrpInclusive,
      defaultNrpInclusive,
      floorPriceInclusive,
      priceRateBasis,
      priceUom,
      mrpSource: defaultMrpInclusive === null ? null : this.normalizeMrpSource(data.mrpSource || 'MANUAL'),
      pricingEffectiveFrom: effective,
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
    return 'BOX';
  }

  private normalizeMrpBasis(value: unknown) {
    const raw = String(value || '').trim().toUpperCase();
    const basis = raw === 'PACK' ? 'BOX' : raw;
    if (!['BOX', 'PIECE', 'AREA'].includes(basis)) {
      throw new BadRequestException('Price basis must be BOX, PIECE, or AREA');
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
