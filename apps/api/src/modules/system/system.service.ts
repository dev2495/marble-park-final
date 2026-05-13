import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ulid } from 'ulid';
import * as bcrypt from 'bcrypt';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class SystemService {
  constructor(private prisma: PrismaService) {}

  private readonly defaultCategories = [
    'Sanitaryware',
    'Faucets',
    'Faucets & Showers',
    'Kitchen Sinks',
    'Tiles',
    'Accessories',
    'Catalogue Products',
    'Uncategorized',
  ];

  private readonly defaultBrands = [
    'Marble Park Select',
    'Aquant',
    'Hindware',
    'Grohe',
    'Hansgrohe',
    'American Standard',
  ];

  private readonly defaultFinishes = [
    'Standard',
    'Chrome',
    'White',
    'Matt',
    'Glossy',
    'Satin Steel',
    'Black',
  ];

  async getSettings() {
    let settings = await this.prisma.appSetting.findFirst({ orderBy: { updatedAt: 'desc' } });
    if (!settings) {
      const railwayUrl = process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '';
      settings = await this.prisma.appSetting.create({
        data: {
          id: 'default',
          canonicalAppUrl: process.env.PUBLIC_APP_URL || railwayUrl || '',
          quotePrefix: 'QT',
          challanPrefix: 'CH',
          approvalDiscountThreshold: 15,
          companyName: 'Marble Park',
          supportPhone: '',
          supportEmail: '',
          updatedAt: new Date(),
        },
      });
    }
    return settings;
  }

  async updateSettings(input: any, actorUserId: string) {
    const current = await this.getSettings();
    const settings = await this.prisma.appSetting.update({
      where: { id: current.id },
      data: {
        canonicalAppUrl: input.canonicalAppUrl ?? current.canonicalAppUrl,
        quotePrefix: input.quotePrefix ?? current.quotePrefix,
        challanPrefix: input.challanPrefix ?? current.challanPrefix,
        approvalDiscountThreshold: input.approvalDiscountThreshold ?? current.approvalDiscountThreshold,
        companyName: input.companyName ?? current.companyName,
        supportPhone: input.supportPhone ?? current.supportPhone,
        supportEmail: input.supportEmail ?? current.supportEmail,
        updatedAt: new Date(),
      },
    });
    await this.audit(actorUserId, 'settings.update', 'AppSetting', settings.id, 'Updated system settings', input);
    return settings;
  }

  async resetClientWorkspace(confirm: string, _actorUserId: string) {
    if (confirm !== 'RESET_CLIENT_WORKSPACE') {
      throw new Error('Invalid reset confirmation');
    }

    await this.prisma.dispatchChallan.deleteMany();
    await this.prisma.dispatchJob.deleteMany();
    await this.prisma.reservation.deleteMany();
    await this.prisma.salesOrder.deleteMany();
    await this.prisma.activity.deleteMany();
    await this.prisma.followUpTask.deleteMany();
    await this.prisma.quote.deleteMany();
    await this.prisma.leadIntent.deleteMany();
    await this.prisma.lead.deleteMany();
    await this.prisma.inventoryMovement.deleteMany();
    await this.prisma.inventoryInwardBatch.deleteMany();
    await this.prisma.inventoryBalance.deleteMany();
    await this.prisma.importRow.deleteMany();
    await this.prisma.importBatch.deleteMany();
    await this.prisma.catalogReviewTask.deleteMany();
    await this.prisma.sourceFile.deleteMany();
    await this.prisma.notification.deleteMany();
    await this.prisma.auditEvent.deleteMany();
    await this.prisma.customer.deleteMany();
    await this.prisma.vendor.deleteMany();
    await this.prisma.product.deleteMany();
    await this.prisma.productBrand.deleteMany();
    await this.prisma.productCategory.deleteMany();
    await this.prisma.productFinish.deleteMany();
    await this.prisma.passwordResetToken.deleteMany();
    await this.prisma.session.deleteMany();

    const passwordHash = await bcrypt.hash(process.env.CLIENT_RESET_ADMIN_PASSWORD || 'password123', 10);
    await this.prisma.user.deleteMany({ where: { email: { not: 'admin@marblepark.com' } } });
    const admin = await this.prisma.user.upsert({
      where: { email: 'admin@marblepark.com' },
      update: { name: 'Marble Park Admin', role: 'admin', phone: '9820098199', active: true, passwordHash },
      create: {
        id: ulid(),
        email: 'admin@marblepark.com',
        passwordHash,
        name: 'Marble Park Admin',
        role: 'admin',
        phone: '9820098199',
        active: true,
      },
    });

    const importImageDir = process.env.CATALOGUE_IMPORT_IMAGE_DIR || path.resolve(process.cwd(), '../../apps/web/public/catalogue-images/imports');
    const catalogueImageRoot = process.env.CATALOGUE_IMAGE_STORAGE_DIR || path.dirname(importImageDir);
    for (const folder of [path.join(catalogueImageRoot, 'imports'), path.join(catalogueImageRoot, 'manual')]) {
      fs.rmSync(folder, { recursive: true, force: true });
      fs.mkdirSync(folder, { recursive: true });
    }

    const counts = {
      users: await this.prisma.user.count(),
      products: await this.prisma.product.count(),
      customers: await this.prisma.customer.count(),
      leads: await this.prisma.lead.count(),
      quotes: await this.prisma.quote.count(),
      imports: await this.prisma.importBatch.count(),
      catalogueImagesPending: await this.prisma.catalogReviewTask.count(),
      inventoryBalances: await this.prisma.inventoryBalance.count(),
    };
    return { ok: true, counts };
  }

  async auditEvents(args?: { entityType?: string; entityId?: string; take?: number }) {
    const where: any = {};
    if (args?.entityType) where.entityType = args.entityType;
    if (args?.entityId) where.entityId = args.entityId;
    return this.prisma.auditEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: args?.take || 100,
    });
  }

  async reviewTasks(args?: { status?: string; take?: number }) {
    const where: any = {};
    if (args?.status) where.status = args.status;
    return this.prisma.catalogReviewTask.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: args?.take || 100,
    });
  }

  async mapReviewTask(id: string, productId: string, actorUserId: string) {
    const task = await this.prisma.catalogReviewTask.update({
      where: { id },
      data: { mappedProductId: productId, status: 'mapped', updatedAt: new Date() },
    });
    if (task.imageUrl) {
      const product = await this.prisma.product.findUnique({ where: { id: productId } });
      const media: any = product?.media || {};
      await this.prisma.product.update({
        where: { id: productId },
        data: {
          media: {
            ...media,
            primary: task.imageUrl,
            gallery: Array.from(new Set([task.imageUrl, ...((media.gallery || []) as string[])])),
            exactSkuMatch: true,
            source: 'catalogue-review',
            reviewTaskId: id,
          },
          updatedAt: new Date(),
        },
      });
    }
    await this.audit(actorUserId, 'catalogue.image.map', 'CatalogReviewTask', id, 'Mapped catalogue image to product', { productId });
    return task;
  }

  async submitReviewTaskForApproval(id: string, productId: string, actorUserId: string) {
    const task = await this.prisma.catalogReviewTask.update({
      where: { id },
      data: { mappedProductId: productId, status: 'pending_approval', updatedAt: new Date() },
    });
    await this.audit(actorUserId, 'catalogue.image.submit_approval', 'CatalogReviewTask', id, 'Submitted catalogue image mapping for owner approval', { productId });
    return task;
  }

  async approveReviewTask(id: string, actorUserId: string, note?: string) {
    const task = await this.prisma.catalogReviewTask.findUnique({ where: { id } });
    if (!task) throw new Error('Catalog review task not found');
    if (!task.mappedProductId) throw new Error('Map the catalogue image to a product before approval');
    await this.mapReviewTask(id, task.mappedProductId, actorUserId);
    const approved = await this.prisma.catalogReviewTask.update({
      where: { id },
      data: {
        status: 'approved',
        raw: { ...((task.raw as any) || {}), approvedBy: actorUserId, approvedAt: new Date().toISOString(), note: note || '' },
        updatedAt: new Date(),
      },
    });
    await this.audit(actorUserId, 'catalogue.image.approve', 'CatalogReviewTask', id, 'Approved catalogue image mapping', { productId: task.mappedProductId, note });
    return approved;
  }

  async productCategories(args?: { status?: string }) {
    await this.ensureDefaultProductCategories();
    await this.backfillProductCategories();
    const where: any = {};
    if (args?.status) where.status = args.status;
    return this.prisma.productCategory.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async productBrands(args?: { status?: string }) {
    await this.ensureDefaultProductMasterValues('brand');
    await this.backfillProductMasterValues('brand');
    const where: any = {};
    if (args?.status) where.status = args.status;
    return this.prisma.productBrand.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async productFinishes(args?: { status?: string }) {
    await this.ensureDefaultProductMasterValues('finish');
    await this.backfillProductMasterValues('finish');
    const where: any = {};
    if (args?.status) where.status = args.status;
    return this.prisma.productFinish.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async upsertProductCategory(input: any, actorUserId: string) {
    const name = String(input.name || '').trim();
    if (!name) throw new Error('Category name is required');
    const data = {
      name,
      code: input.code || this.slugCode(name),
      description: input.description || '',
      status: input.status || 'active',
      sortOrder: Number(input.sortOrder || 0),
      metadata: input.metadata || {},
      updatedAt: new Date(),
    };
    const category = input.id
      ? await this.prisma.productCategory.update({ where: { id: input.id }, data })
      : await this.prisma.productCategory.upsert({
          where: { name },
          update: data,
          create: { id: ulid(), ...data },
        });
    await this.audit(actorUserId, 'master.category.save', 'ProductCategory', category.id, `Saved inventory category ${category.name}`, data);
    return category;
  }

  async upsertProductBrand(input: any, actorUserId: string) {
    const value = await this.upsertProductMasterValue('brand', input);
    await this.audit(actorUserId, 'master.brand.save', 'ProductBrand', value.id, `Saved product brand ${value.name}`, value);
    return value;
  }

  async upsertProductFinish(input: any, actorUserId: string) {
    const value = await this.upsertProductMasterValue('finish', input);
    await this.audit(actorUserId, 'master.finish.save', 'ProductFinish', value.id, `Saved product finish ${value.name}`, value);
    return value;
  }

  async vendors(args?: { search?: string; status?: string; take?: number }) {
    const where: any = {};
    if (args?.status) where.status = args.status;
    if (args?.search) {
      where.OR = [
        { name: { contains: args.search, mode: 'insensitive' } },
        { phone: { contains: args.search, mode: 'insensitive' } },
        { email: { contains: args.search, mode: 'insensitive' } },
        { gstNo: { contains: args.search, mode: 'insensitive' } },
      ];
    }
    return this.prisma.vendor.findMany({
      where,
      orderBy: { name: 'asc' },
      take: args?.take || 100,
    });
  }

  async upsertVendor(input: any, actorUserId: string) {
    const name = String(input.name || '').trim();
    if (!name) throw new Error('Vendor name is required');
    const data = {
      name,
      phone: input.phone || '',
      email: input.email || '',
      gstNo: input.gstNo || '',
      address: input.address || '',
      city: input.city || '',
      state: input.state || '',
      contactPerson: input.contactPerson || '',
      category: input.category || '',
      status: input.status || 'active',
      notes: input.notes || '',
      metadata: input.metadata || {},
      updatedAt: new Date(),
    };
    const vendor = input.id
      ? await this.prisma.vendor.update({ where: { id: input.id }, data })
      : await this.prisma.vendor.create({ data: { id: ulid(), ...data } });
    await this.audit(actorUserId, 'master.vendor.save', 'Vendor', vendor.id, `Saved vendor ${vendor.name}`, data);
    return vendor;
  }

  async audit(actorUserId: string, action: string, entityType: string, entityId: string, summary: string, metadata: any = {}) {
    return this.prisma.auditEvent.create({
      data: {
        id: ulid(),
        actorUserId,
        action,
        entityType,
        entityId,
        summary,
        metadata,
      },
    });
  }

  private async backfillProductCategories() {
    const [existing, productCategories] = await Promise.all([
      this.prisma.productCategory.findMany({ select: { name: true } }),
      this.prisma.product.findMany({
        select: { category: true },
        distinct: ['category'],
      }),
    ]);
    const existingNames = new Set(existing.map((row) => row.name));
    for (const row of productCategories) {
      const name = String(row.category || '').trim();
      if (!name || existingNames.has(name)) continue;
      await this.prisma.productCategory.create({
        data: {
          id: ulid(),
          name,
          code: this.slugCode(name),
          description: 'Backfilled from existing product master',
          status: 'active',
          sortOrder: 100,
          metadata: { source: 'product-backfill' },
          updatedAt: new Date(),
        },
      });
      existingNames.add(name);
    }
  }

  private async ensureDefaultProductCategories() {
    const existing = await this.prisma.productCategory.findMany({ select: { name: true } });
    const existingNames = new Set(existing.map((row) => row.name.toLowerCase()));
    let sortOrder = 0;
    for (const name of this.defaultCategories) {
      sortOrder += 10;
      if (existingNames.has(name.toLowerCase())) continue;
      await this.prisma.productCategory.create({
        data: {
          id: ulid(),
          name,
          code: this.slugCode(name),
          description: 'Default operational category',
          status: 'active',
          sortOrder,
          metadata: { source: 'system-default' },
          updatedAt: new Date(),
        },
      });
      existingNames.add(name.toLowerCase());
    }
  }

  private async ensureDefaultProductMasterValues(kind: 'brand' | 'finish') {
    const delegate: any = kind === 'brand' ? this.prisma.productBrand : this.prisma.productFinish;
    const defaults = kind === 'brand' ? this.defaultBrands : this.defaultFinishes;
    const existing = await delegate.findMany({ select: { name: true } });
    const existingNames = new Set(existing.map((row: any) => String(row.name).toLowerCase()));
    let sortOrder = 0;
    for (const name of defaults) {
      sortOrder += 10;
      if (existingNames.has(name.toLowerCase())) continue;
      await delegate.create({
        data: {
          id: ulid(),
          name,
          code: this.slugCode(name),
          description: `Default operational ${kind}`,
          status: 'active',
          sortOrder,
          metadata: { source: 'system-default' },
          updatedAt: new Date(),
        },
      });
      existingNames.add(name.toLowerCase());
    }
  }

  private async backfillProductMasterValues(kind: 'brand' | 'finish') {
    const delegate: any = kind === 'brand' ? this.prisma.productBrand : this.prisma.productFinish;
    const productField = kind === 'brand' ? 'brand' : 'finish';
    const [existing, productValues] = await Promise.all([
      delegate.findMany({ select: { name: true } }),
      this.prisma.product.findMany({
        select: { [productField]: true } as any,
        distinct: [productField] as any,
      } as any),
    ]);
    const existingNames = new Set(existing.map((row: any) => row.name));
    for (const row of productValues as any[]) {
      const name = String(row[productField] || '').trim();
      if (!name || existingNames.has(name)) continue;
      await delegate.create({
        data: {
          id: ulid(),
          name,
          code: this.slugCode(name),
          description: `Backfilled from existing product ${kind}`,
          status: 'active',
          sortOrder: 100,
          metadata: { source: 'product-backfill' },
          updatedAt: new Date(),
        },
      });
      existingNames.add(name);
    }
  }

  private async upsertProductMasterValue(kind: 'brand' | 'finish', input: any) {
    const name = String(input.name || '').trim();
    if (!name) throw new Error(`${kind === 'brand' ? 'Brand' : 'Finish'} name is required`);
    const data = {
      name,
      code: input.code || this.slugCode(name),
      description: input.description || '',
      status: input.status || 'active',
      sortOrder: Number(input.sortOrder || 0),
      metadata: input.metadata || {},
      updatedAt: new Date(),
    };
    const delegate: any = kind === 'brand' ? this.prisma.productBrand : this.prisma.productFinish;
    return input.id
      ? delegate.update({ where: { id: input.id }, data })
      : delegate.upsert({
          where: { name },
          update: data,
          create: { id: ulid(), ...data },
        });
  }

  private slugCode(value: string) {
    return value
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 32);
  }
}
