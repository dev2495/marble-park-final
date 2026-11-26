import { chemicalUnit } from '../common/chemical-unit';
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { ulid } from 'ulid';
import { PrismaService } from '../prisma/prisma.service';
import { customersByMobileKey, mobileKey } from '../common/phone';
import { CustomersService } from '../customers/customers.service';
import { ProductsService } from '../products/products.service';
import { SystemService } from '../system/system.service';

// Quick add saves the minimum a record needs to be used today and flags it.
// The flag lives in existing JSON columns (tags / metadata / sourceRefs), so
// nothing about how the record behaves elsewhere changes.
export const FOLLOW_UP_TAG = 'follow-up';
export type FollowUpEntity = 'Customer' | 'Product' | 'Architect' | 'Vendor' | 'ProductBrand' | 'ProductCategory' | 'ProductFinish' | 'TileSize';
const METADATA_TABLES: Record<string, { table: string; delegate: string; label: string }> = {
  Architect: { table: 'Architect', delegate: 'architect', label: 'Architect' },
  Vendor: { table: 'Vendor', delegate: 'vendor', label: 'Vendor' },
  ProductBrand: { table: 'ProductBrand', delegate: 'productBrand', label: 'Brand' },
  ProductCategory: { table: 'ProductCategory', delegate: 'productCategory', label: 'Category' },
  ProductFinish: { table: 'ProductFinish', delegate: 'productFinish', label: 'Finish' },
  TileSize: { table: 'TileSize', delegate: 'tileSize', label: 'Tile size' },
};
// Fields the follow-up desk may fill for each master.
const MASTER_FIELDS: Record<string, string[]> = {
  Architect: ['firmName', 'phone', 'email', 'city', 'address', 'registrationNo'],
  Vendor: ['contactPerson', 'phone', 'email', 'gstNo', 'address', 'city', 'state'],
  ProductBrand: ['code', 'description', 'logoUrl'],
  ProductCategory: ['code', 'description'],
  ProductFinish: ['code', 'description'],
  TileSize: ['code', 'uom', 'widthMm', 'heightMm', 'thicknessMm', 'pcsPerBox'],
};
const QUICK_MASTER_KINDS: Record<string, FollowUpEntity> = {
  brand: 'ProductBrand', category: 'ProductCategory', finish: 'ProductFinish', vendor: 'Vendor', tileSize: 'TileSize', architect: 'Architect',
};

function mobileDigits(value: unknown) {
  return mobileKey(value) || String(value || '').replace(/\D/g, '');
}
function asTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; } }
  return [];
}
function asObject(value: unknown): Record<string, any> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>;
  if (typeof value === 'string') { try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' ? parsed : {}; } catch { return {}; } }
  return {};
}

@Injectable()
export class FollowUpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomersService,
    private readonly products: ProductsService,
    private readonly system: SystemService,
  ) {}

  private async flag(actorUserId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: actorUserId }, select: { name: true } }).catch(() => null);
    return { flaggedAt: new Date().toISOString(), flaggedById: actorUserId, flaggedByName: user?.name || '' };
  }

  async quickAddCustomer(input: { name: string; mobile: string; city?: string }, actorUserId: string) {
    const name = String(input.name || '').trim();
    const digits = mobileDigits(input.mobile);
    if (name.length < 2) throw new BadRequestException('Enter the customer name.');
    if (digits.length !== 10) throw new BadRequestException('Enter a 10-digit mobile number.');
    // Phone is the customer's identity: a known number reuses that customer.
    const [match] = await customersByMobileKey(this.prisma, digits, { take: 1 });
    if (match) return { existing: true, customer: { ...match, phone: match.mobile } };
    const created = await this.customers.create({ name, phone: digits, city: input.city || '', forceCreate: true } as any);
    const flag = await this.flag(actorUserId);
    const updated = await this.prisma.customer.update({
      where: { id: created.id },
      data: { tags: Array.from(new Set([...asTags(created.tags), FOLLOW_UP_TAG])), notes: [created.notes, `Quick-added by ${flag.flaggedByName || 'staff'} on ${flag.flaggedAt.slice(0, 10)}.`].filter(Boolean).join('\n'), updatedAt: new Date() },
    });
    await this.audit(actorUserId, 'customer.quick_add', 'Customer', updated.id, `Quick-added customer ${updated.name}`, { mobile: digits });
    return { existing: false, customer: { ...updated, phone: updated.mobile } };
  }

  async quickAddProduct(input: { name: string; category: string; brand?: string; mrp: number; unit?: string; finish?: string; mediaUrl?: string }, actorUserId: string) {
    const name = String(input.name || '').trim();
    const category = String(input.category || '').trim();
    const mrp = Number(input.mrp);
    if (name.length < 2) throw new BadRequestException('Enter the item name.');
    if (!category) throw new BadRequestException('Choose a category.');
    if (category.toLowerCase() === 'tiles') throw new BadRequestException('Tiles need size and box coverage. Add them from Tile Master.');
    if (!Number.isFinite(mrp) || mrp <= 0) throw new BadRequestException('Enter the MRP. A line cannot be priced without it.');
    const chemical = category.toLowerCase() === 'chemicals';
    const unit = chemical ? chemicalUnit(input.unit) : String(input.unit || 'PC').trim().toUpperCase();
    const sku = `QA-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 36).toString(36).toUpperCase()}`;
    const product = await this.products.create({
      sku,
      internalCode: sku,
      name,
      category,
      brand: String(input.brand || '').trim(),
      finish: String(input.finish || '').trim(),
      unit,
      baseUom: unit,
      purchaseUom: unit,
      salesUom: unit,
      defaultMrpInclusive: mrp,
      priceRateBasis: unit === 'PC' ? 'PIECE' : 'BOX',
      priceUom: unit,
      mrpSource: 'MANUAL',
      status: 'active',
      media: input.mediaUrl ? { primaryUrl: input.mediaUrl, gallery: [input.mediaUrl] } : undefined,
    } as any, actorUserId);
    const flag = await this.flag(actorUserId);
    await this.prisma.product.update({
      where: { id: product.id },
      data: { tags: Array.from(new Set([...asTags((product as any).tags), FOLLOW_UP_TAG])), sourceRefs: { ...asObject((product as any).sourceRefs), followUp: flag }, updatedAt: new Date() } as any,
    });
    await this.audit(actorUserId, 'product.quick_add', 'Product', product.id, `Quick-added SKU ${sku} ${name}`, { mrp, category });
    return this.prisma.product.findUnique({ where: { id: product.id } });
  }

  async quickAddMaster(kindInput: string, input: { name: string; phone?: string; code?: string }, actorUserId: string) {
    const entity = QUICK_MASTER_KINDS[String(kindInput || '')];
    if (!entity) throw new BadRequestException('Unknown master type.');
    const name = String(input.name || '').trim();
    if (!name) throw new BadRequestException('Enter a name.');
    let saved: any;
    if (entity === 'Architect') saved = await this.system.upsertArchitect({ name, phone: input.phone || '' }, actorUserId);
    if (entity === 'Vendor') saved = await this.system.upsertVendor({ name, phone: input.phone || '' }, actorUserId);
    if (entity === 'ProductBrand') saved = await this.system.upsertProductBrand({ name }, actorUserId);
    if (entity === 'ProductCategory') saved = await this.system.upsertProductCategory({ name }, actorUserId);
    if (entity === 'ProductFinish') saved = await this.system.upsertProductFinish({ name }, actorUserId);
    if (entity === 'TileSize') {
      const code = String(input.code || name).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || `SIZE-${Date.now().toString(36).toUpperCase()}`;
      const dims = name.match(/(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)/i);
      saved = await this.system.upsertTileSize({ name, code, ...(dims ? { widthMm: Number(dims[1]), heightMm: Number(dims[2]) } : {}) }, actorUserId);
    }
    const row = saved?.result || saved;
    if (!row?.id) throw new BadRequestException('The record could not be saved.');
    await this.setFlag(entity, row.id, true, actorUserId);
    return { entityType: entity, id: row.id, name: row.name };
  }

  async setFlag(entityType: string, id: string, flagged: boolean, actorUserId: string) {
    const flag = flagged ? await this.flag(actorUserId) : null;
    if (entityType === 'Customer' || entityType === 'Product') {
      const delegate: any = entityType === 'Customer' ? this.prisma.customer : this.prisma.product;
      const row = await delegate.findUnique({ where: { id } });
      if (!row) throw new BadRequestException('Record not found.');
      const tags = asTags(row.tags).filter((tag) => tag !== FOLLOW_UP_TAG);
      const data: any = { tags: flagged ? [...tags, FOLLOW_UP_TAG] : tags, updatedAt: new Date() };
      if (entityType === 'Product') {
        const refs = asObject(row.sourceRefs);
        if (flag) refs.followUp = flag; else delete refs.followUp;
        data.sourceRefs = refs;
      }
      await delegate.update({ where: { id }, data });
    } else {
      const config = METADATA_TABLES[entityType];
      if (!config) throw new BadRequestException('Unknown record type.');
      const delegate: any = (this.prisma as any)[config.delegate];
      const row = await delegate.findUnique({ where: { id } });
      if (!row) throw new BadRequestException('Record not found.');
      const metadata = asObject(row.metadata);
      if (flag) metadata.followUp = flag; else delete metadata.followUp;
      await delegate.update({ where: { id }, data: { metadata, updatedAt: new Date() } });
    }
    if (!flagged) await this.audit(actorUserId, 'follow_up.complete', entityType, id, `Follow-up completed for ${entityType}`, {});
    return true;
  }

  // Saves the details filled in on the Follow-up page through the same master
  // services, then optionally clears the flag.
  async completeRecord(entityType: string, id: string, rawValues: any, markComplete: boolean, actor: { id: string; canPrice: boolean }) {
    const values = asObject(rawValues);
    const text = (key: string) => (values[key] === undefined ? undefined : String(values[key] ?? '').trim());
    if (entityType === 'Customer') {
      const data: any = { updatedAt: new Date() };
      for (const key of ['name', 'email', 'city', 'state', 'siteAddress', 'gstNo']) if (text(key) !== undefined) data[key] = text(key);
      if (text('mobile') !== undefined) {
        const digits = mobileDigits(text('mobile'));
        if (digits.length !== 10) throw new BadRequestException('Enter a 10-digit mobile number.');
        const [clash] = await customersByMobileKey(this.prisma, digits, { excludeId: id, take: 1 });
        if (clash) throw new ConflictException(`This mobile already belongs to ${clash.name}${clash.city ? ` (${clash.city})` : ''}. Check the number.`);
        data.mobile = digits;
      }
      if (data.name !== undefined && data.name.length < 2) throw new BadRequestException('Enter the customer name.');
      // Same duplicate rule as the Customers screen: a GSTIN or email that belongs to someone else is refused.
      if (data.gstNo || data.email) {
        const blocking = (await this.customers.findDuplicateCandidates({ excludeId: id, gstNo: data.gstNo || null, email: data.email || null } as any)).find((row: any) => row.blocking && row.matchedOn.some((m: string) => m === 'gstNo' || m === 'email'));
        if (blocking) throw new ConflictException(`This ${blocking.matchedOn.includes('gstNo') ? 'GSTIN' : 'email'} already belongs to ${blocking.name}${blocking.city ? ` (${blocking.city})` : ''}. Check it.`);
      }
      // Same phone lock as the Customers screen (gaps lane): a same-moment save of this number elsewhere waits, then is refused.
      const lockKey = data.mobile ? mobileKey(data.mobile) : '';
      await this.prisma.$transaction(async (tx) => {
        if (lockKey) {
          await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `customer-mobile:${lockKey}`);
          const [clash] = await customersByMobileKey(tx, lockKey, { excludeId: id, take: 10 });
          if (clash) throw new ConflictException(`This mobile already belongs to ${clash.name}${clash.city ? ` (${clash.city})` : ''}. Check the number.`);
        }
        await tx.customer.update({ where: { id }, data });
      });
    } else if (entityType === 'Product') {
      const input: any = {};
      for (const key of ['name', 'brand', 'finish', 'hsnCode', 'description']) if (text(key) !== undefined) input[key] = text(key);
      if (values.photoUrl) {
        const current = await this.prisma.product.findUnique({ where: { id } });
        const media = asObject(current?.media);
        input.media = JSON.stringify({ ...media, primaryUrl: values.photoUrl, gallery: Array.from(new Set([values.photoUrl, ...(Array.isArray(media.gallery) ? media.gallery.map((item: any) => (typeof item === 'string' ? item : item?.url)).filter(Boolean) : [])])) });
      }
      if (values.floorPriceInclusive !== undefined && values.floorPriceInclusive !== '') {
        if (!actor.canPrice) throw new BadRequestException('Only users with MRP Control Desk rights can set a floor price.');
        input.floorPriceInclusive = Number(values.floorPriceInclusive);
        input.mrpChangeReason = 'Completed from Follow-up queue';
      }
      if (Object.keys(input).length) await this.products.update(id, input, actor.id);
    } else {
      const config = METADATA_TABLES[entityType];
      if (!config) throw new BadRequestException('Unknown record type.');
      const existing: any = await (this.prisma as any)[config.delegate].findUnique({ where: { id } });
      if (!existing) throw new BadRequestException('Record not found.');
      const merged: any = { ...existing, id };
      if (text('name')) merged.name = text('name');
      for (const field of MASTER_FIELDS[entityType] || []) {
        if (values[field] === undefined) continue;
        if (field === 'logoUrl') { merged.metadata = { ...asObject(existing.metadata), logoUrl: text('logoUrl') }; continue; }
        merged[field] = ['widthMm', 'heightMm', 'thicknessMm', 'pcsPerBox'].includes(field) ? (values[field] === '' ? null : Number(values[field])) : text(field);
      }
      merged.metadata = { ...asObject(existing.metadata), ...asObject(merged.metadata) };
      delete merged.updatedAt;
      if (entityType === 'Architect') await this.system.upsertArchitect(merged, actor.id);
      if (entityType === 'Vendor') await this.system.upsertVendor(merged, actor.id);
      if (entityType === 'ProductBrand') await this.system.upsertProductBrand(merged, actor.id);
      if (entityType === 'ProductCategory') await this.system.upsertProductCategory(merged, actor.id);
      if (entityType === 'ProductFinish') await this.system.upsertProductFinish(merged, actor.id);
      if (entityType === 'TileSize') await this.system.upsertTileSize(merged, actor.id);
    }
    await this.setFlag(entityType, id, !markComplete, actor.id);
    return true;
  }

  async queue() {
    const items: any[] = [];
    const [customerRows, productRows] = await Promise.all([
      this.prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "Customer" WHERE tags @> '["${FOLLOW_UP_TAG}"]'::jsonb LIMIT 500`),
      this.prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "Product" WHERE tags @> '["${FOLLOW_UP_TAG}"]'::jsonb LIMIT 500`),
    ]);
    const [customers, products] = await Promise.all([
      customerRows.length ? this.prisma.customer.findMany({ where: { id: { in: customerRows.map((row) => row.id) } } }) : [],
      productRows.length ? this.prisma.product.findMany({ where: { id: { in: productRows.map((row) => row.id) } } }) : [],
    ]);
    for (const customer of customers as any[]) {
      const missing = [!customer.siteAddress && 'Site address', !customer.city && 'City', !customer.gstNo && 'GSTIN'].filter(Boolean);
      items.push({ entityType: 'Customer', label: 'Customer', id: customer.id, name: customer.name, detail: customer.mobile, missing, flaggedAt: customer.updatedAt, href: '/dashboard/customers',
        values: { name: customer.name, mobile: customer.mobile, email: customer.email || '', city: customer.city || '', state: customer.state || '', siteAddress: customer.siteAddress || '', gstNo: customer.gstNo || '' } });
    }
    for (const product of products as any[]) {
      const media = asObject(product.media);
      const flag = asObject(asObject(product.sourceRefs).followUp);
      const missing = [!product.hsnCode && 'HSN', !(media.primaryUrl || media.primary || (Array.isArray(media.gallery) && media.gallery.length)) && 'Photo', !product.brand && 'Brand', product.floorPriceInclusive == null && 'Floor price'].filter(Boolean);
      items.push({ entityType: 'Product', label: 'SKU', id: product.id, name: product.name, detail: product.sku, missing, flaggedAt: flag.flaggedAt || product.updatedAt, flaggedByName: flag.flaggedByName || '', href: `/dashboard/master-data/products?search=${encodeURIComponent(product.sku)}`,
        values: { name: product.name, brand: product.brand || '', finish: product.finish || '', hsnCode: product.hsnCode || '', description: product.description || '', floorPriceInclusive: product.floorPriceInclusive == null ? '' : Number(product.floorPriceInclusive), defaultMrpInclusive: product.defaultMrpInclusive == null ? '' : Number(product.defaultMrpInclusive), photoUrl: media.primaryUrl || media.primary || (Array.isArray(media.gallery) ? (typeof media.gallery[0] === 'string' ? media.gallery[0] : media.gallery[0]?.url) : '') || '', category: product.category, unit: product.unit } });
    }
    for (const [entityType, config] of Object.entries(METADATA_TABLES)) {
      const rows = await this.prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "${config.table}" WHERE metadata ? 'followUp' LIMIT 500`);
      for (const row of rows) {
        const flag = asObject(asObject(row.metadata).followUp);
        const missing: string[] = [];
        if (entityType === 'Architect') { if (!row.firmName) missing.push('Firm'); if (!row.phone) missing.push('Mobile'); if (!row.city) missing.push('City'); }
        if (entityType === 'Vendor') { if (!row.phone) missing.push('Phone'); if (!row.gstNo) missing.push('GSTIN'); if (!row.address) missing.push('Address'); }
        if (entityType === 'ProductBrand' && !asObject(row.metadata).logoUrl) missing.push('Logo');
        if (entityType === 'TileSize') { if (!row.pcsPerBox) missing.push('Pieces per box'); if (!row.widthMm || !row.heightMm) missing.push('Size in mm'); }
        const hrefs: Record<string, string> = { Architect: '/dashboard/master-data/architects', Vendor: '/dashboard/master-data/vendors', ProductBrand: '/dashboard/master-data/brands', ProductCategory: '/dashboard/master-data/categories', ProductFinish: '/dashboard/master-data/finishes', TileSize: '/dashboard/master-data/tile-sizes' };
        const fields = MASTER_FIELDS[entityType] || [];
        const values: Record<string, any> = { name: row.name };
        for (const field of fields) values[field] = field === 'logoUrl' ? asObject(row.metadata).logoUrl || '' : row[field] ?? '';
        items.push({ entityType, label: config.label, id: row.id, name: row.name, detail: row.code || row.firmName || '', missing: missing.length ? missing : ['Review details'], flaggedAt: flag.flaggedAt || row.updatedAt, flaggedByName: flag.flaggedByName || '', href: hrefs[entityType], values });
      }
    }
    return items.sort((a, b) => new Date(b.flaggedAt).getTime() - new Date(a.flaggedAt).getTime());
  }

  private async audit(actorUserId: string, action: string, entityType: string, entityId: string, summary: string, metadata: any) {
    await this.prisma.auditEvent.create({ data: { id: ulid(), actorUserId, action, entityType, entityId, summary, metadata } }).catch(() => null);
  }
}
