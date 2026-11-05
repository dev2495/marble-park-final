import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { ulid } from 'ulid';
import { PrismaService } from '../prisma/prisma.service';
import { brandedLabelQrDataUrl } from '../common/branded-label-qr';
import { parseLabelCode } from '../common/label-code';

// Crockford base32: no I, L, O or U, so tokens read back unambiguously.
const TOKEN_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const PRODUCT_TOKEN_LENGTH = 14;
const SHARE_TOKEN_LENGTH = 24;
export const VISIT_TOKEN_LENGTH = 24;
// A check-in collects scans for one showroom visit, not for days afterwards.
const VISIT_SCAN_WINDOW_MS = 12 * 60 * 60 * 1000;
const PRICE_MODES = ['hidden', 'mrp', 'nrp'] as const;
const MAX_SHARE_PRODUCTS = 60;
const SIMILAR_LIMIT = 12;

export type PublicPriceMode = typeof PRICE_MODES[number];

export function publicToken(length: number) {
  const bytes = randomBytes(length);
  let token = '';
  for (let index = 0; index < length; index += 1) token += TOKEN_ALPHABET[bytes[index] & 31];
  return token;
}

export function cleanToken(raw: unknown, length: number) {
  const token = String(raw || '').trim().toUpperCase();
  return token.length === length && [...token].every((char) => TOKEN_ALPHABET.includes(char)) ? token : '';
}

export function normalizePriceMode(value: unknown): PublicPriceMode {
  const mode = String(value || '').trim().toLowerCase();
  return (PRICE_MODES as readonly string[]).includes(mode) ? mode as PublicPriceMode : 'mrp';
}

function mediaUrls(media: any): string[] {
  if (!media || typeof media !== 'object') return [];
  const entries = Array.isArray(media.gallery) ? media.gallery : Array.isArray(media.images) ? media.images : [];
  const urls = [media.primaryUrl || media.primaryImage || media.url || media.imageUrl || '', ...entries.map((entry: any) => (typeof entry === 'string' ? entry : entry?.url || ''))]
    .map((url: any) => String(url || '').trim())
    .filter(Boolean);
  return urls.filter((url: string, index: number) => urls.indexOf(url) === index).slice(0, 12);
}

function sellingUnit(product: any) {
  const basis = String(product?.priceRateBasis || '').toUpperCase();
  const uom = String(product?.priceUom || product?.salesUom || product?.unit || 'PC').toUpperCase();
  return basis === 'PIECE' ? 'PC' : uom;
}

function money(value: any) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number * 100) / 100 : null;
}

// Mobile numbers in India are 10 digits starting 6-9; landlines are skipped for WhatsApp.
function whatsappNumber(supportPhone: string) {
  const candidates = String(supportPhone || '').split(/[·,/|;]+/).map((part) => part.replace(/\D/g, ''));
  const mobile = candidates.map((digits) => digits.replace(/^(91|0)(?=\d{10}$)/, '')).find((digits) => /^[6-9]\d{9}$/.test(digits));
  return mobile ? `91${mobile}` : '';
}

const productInclude = { tileDesignMaster: true } as const;

@Injectable()
export class PublicCatalogueService {
  constructor(private prisma: PrismaService) {}

  private async settings() {
    const settings: any = await this.prisma.appSetting.findFirst({ orderBy: { updatedAt: 'desc' } });
    return {
      enabled: settings?.publicCatalogueEnabled !== false,
      priceMode: normalizePriceMode(settings?.publicPriceMode),
      baseUrl: String(settings?.canonicalAppUrl || process.env.PUBLIC_APP_URL || '').trim().replace(/\/+$/, ''),
      showroom: {
        companyName: settings?.companyName || 'Marble Park',
        logoUrl: settings?.logoUrl === '/brand/marble-park-logo.jpg' ? '/brand/marble-park-logo.png' : settings?.logoUrl || '/brand/marble-park-logo.png',
        address: settings?.companyAddress || '',
        phone: settings?.supportPhone || '',
        whatsapp: whatsappNumber(settings?.supportPhone || ''),
        email: settings?.supportEmail || '',
        website: settings?.website || '',
        tagline: settings?.documentTagline || '',
      },
    };
  }

  private disabled(showroom: any) {
    return { enabled: false, showroom };
  }

  private publicUrl(baseUrl: string, path: string) {
    return baseUrl ? `${baseUrl}${path}` : path;
  }

  /** Gives each product a public token the first time it is shown to a customer. */
  private async ensureProductTokens(products: any[]) {
    for (const product of products) {
      if (product.publicToken) continue;
      for (let attempt = 0; attempt < 3 && !product.publicToken; attempt += 1) {
        const token = publicToken(PRODUCT_TOKEN_LENGTH);
        try {
          await this.prisma.product.updateMany({ where: { id: product.id, publicToken: null }, data: { publicToken: token } as any });
          const fresh: any = await this.prisma.product.findUnique({ where: { id: product.id }, select: { publicToken: true } as any });
          product.publicToken = fresh?.publicToken || null;
        } catch (error: any) {
          if (error?.code !== 'P2002') throw error;
        }
      }
    }
    return products;
  }

  /** Only fields a customer may see. Cost, floor, stock, lots and internal ids never leave here. */
  private customerProduct(product: any, priceMode: PublicPriceMode, detail = false) {
    const design = product.tileDesignMaster;
    const isTile = String(product.category || '').trim().toLowerCase() === 'tiles';
    const mrp = money(product.defaultMrpInclusive);
    const nrp = money(product.defaultNrpInclusive);
    const price = priceMode === 'hidden' || (!mrp && !nrp)
      ? null
      : priceMode === 'nrp' && nrp
        ? { amount: nrp, mrp: mrp && mrp > nrp ? mrp : null, label: 'Showroom price', unit: sellingUnit(product) }
        : mrp ? { amount: mrp, mrp: null, label: 'MRP', unit: sellingUnit(product) } : null;
    const photos = mediaUrls(product.media).length ? mediaUrls(product.media) : mediaUrls(design?.media);
    const base = {
      token: product.publicToken,
      name: String(product.name || '').trim() || [product.brand, product.internalCode || product.sku].filter(Boolean).join(' '),
      brand: product.brand || '',
      category: product.category || '',
      finish: product.finish || '',
      size: product.dimensions || '',
      code: product.internalCode || product.sku || '',
      thumbnail: String(product.media?.thumbnailUrl || design?.media?.thumbnailUrl || '') || photos[0] || '',
      price,
      isTile,
      ...(product.relation ? { relation: product.relation } : {}),
    };
    if (!detail) return base;
    const gst = String(product.taxClass || '').replace(/^GST_/i, '');
    return {
      ...base,
      photos,
      description: String(product.description || design?.description || '').trim(),
      design: isTile && design ? {
        name: design.name || '',
        collection: design.collection || '',
        material: design.material || '',
        surface: design.surface || '',
        colour: design.colour || '',
        pattern: design.pattern || '',
        usage: Array.isArray(design.usage) ? design.usage.map(String).filter(Boolean) : [],
        origin: design.origin || '',
      } : null,
      specs: [
        ['Code', base.code],
        ['Brand', base.brand],
        ['Category', base.category],
        ['Finish', base.finish],
        ['Size', base.size],
        ['Sold per', sellingUnit(product)],
        ['Pieces per box', Number(product.piecesPerPack || 0) > 1 ? String(product.piecesPerPack) : ''],
        ['Coverage per box', Number(product.coveragePerPack || 0) > 0 ? `${Number(product.coveragePerPack).toFixed(2)} sq ft` : ''],
        ['GST', /^\d+(\.\d+)?$/.test(gst) ? `${gst}%` : ''],
      ].filter(([, value]) => Boolean(String(value || '').trim())),
    };
  }

  /** Same design first, then same brand in the category, then the rest of the category. */
  private async similarProducts(product: any) {
    const picked: any[] = [];
    const seen = new Set<string>([product.id]);
    const add = (rows: any[], relation: 'design' | 'brand' | 'category') => rows.forEach((row) => {
      if (seen.has(row.id) || picked.length >= SIMILAR_LIMIT) return;
      seen.add(row.id);
      picked.push({ ...row, relation });
    });
    const order = [{ name: 'asc' as const }, { id: 'asc' as const }];
    if (product.tileDesignId) {
      add(await this.prisma.product.findMany({ where: { tileDesignId: product.tileDesignId, status: 'active', id: { not: product.id } }, include: productInclude, orderBy: [{ dimensions: 'asc' }, { finish: 'asc' }], take: SIMILAR_LIMIT }), 'design');
    }
    if (picked.length < SIMILAR_LIMIT && product.brand) {
      add(await this.prisma.product.findMany({ where: { category: product.category, brand: product.brand, status: 'active', id: { notIn: [...seen] } }, include: productInclude, orderBy: order, take: SIMILAR_LIMIT }), 'brand');
    }
    if (picked.length < SIMILAR_LIMIT && product.category) {
      add(await this.prisma.product.findMany({ where: { category: product.category, status: 'active', id: { notIn: [...seen] } }, include: productInclude, orderBy: order, take: SIMILAR_LIMIT }), 'category');
    }
    return this.ensureProductTokens(picked);
  }

  private async bumpStat(productId: string, field: 'views' | 'qrScans') {
    const now = new Date();
    await (this.prisma as any).productPublicStat.upsert({
      where: { productId },
      create: { productId, views: field === 'views' ? 1 : 0, qrScans: field === 'qrScans' ? 1 : 0, lastViewedAt: now, updatedAt: now },
      update: { [field]: { increment: 1 }, lastViewedAt: now, updatedAt: now },
    }).catch(() => null);
  }

  async publicProduct(tokenInput: string) {
    const config = await this.settings();
    if (!config.enabled) return this.disabled(config.showroom);
    const token = cleanToken(tokenInput, PRODUCT_TOKEN_LENGTH);
    const product: any = token ? await this.prisma.product.findUnique({ where: { publicToken: token } as any, include: productInclude }) : null;
    if (!product || product.status !== 'active') return { enabled: true, showroom: config.showroom, product: null, similar: [] };
    const similar = await this.similarProducts(product);
    await this.bumpStat(product.id, 'views');
    return {
      enabled: true,
      showroom: config.showroom,
      url: this.publicUrl(config.baseUrl, `/p/${product.publicToken}`),
      product: this.customerProduct(product, config.priceMode, true),
      similar: similar.map((row) => this.customerProduct(row, config.priceMode)),
    };
  }

  /** The showroom scan page: a printed sticker code in, the product's public token out. */
  async publicLabelLookup(rawInput: string, visitToken?: string) {
    const config = await this.settings();
    if (!config.enabled) return { enabled: false, found: false, message: 'Product pages are switched off right now. Please ask our showroom team.' };
    const raw = String(rawInput || '').trim().slice(0, 500);
    if (!raw) return { enabled: true, found: false, message: 'Point the camera at the QR code on a product sticker.' };
    // A customer may also scan a product link shown on a staff screen.
    const linked = raw.match(/\/p\/([0-9A-Za-z]{14})(?:[/?#]|$)/);
    if (linked) {
      const token = cleanToken(linked[1], PRODUCT_TOKEN_LENGTH);
      const product: any = token ? await this.prisma.product.findUnique({ where: { publicToken: token } as any, select: { id: true, status: true, publicToken: true } as any }) : null;
      if (product?.status === 'active') {
        await this.recordVisitScan(visitToken, product.id);
        return { enabled: true, found: true, token: product.publicToken };
      }
    }
    const code = parseLabelCode(raw);
    const instance: any = code ? await this.prisma.internalLabelInstance.findUnique({
      where: { labelCode: code },
      include: { product: { include: productInclude }, displaySample: { include: { product: { include: productInclude } } } },
    }) : null;
    const product = instance?.status === 'active' ? instance.product || instance.displaySample?.product : null;
    if (!product) return { enabled: true, found: false, message: 'We could not match this code to a product. Try another sticker or ask our showroom team.' };
    if (product.status !== 'active') return { enabled: true, found: false, message: 'This product is no longer in our range. Ask our team for similar designs.' };
    await this.ensureProductTokens([product]);
    await this.bumpStat(product.id, 'qrScans');
    await this.recordVisitScan(visitToken, product.id);
    return { enabled: true, found: true, token: product.publicToken };
  }

  /** Adds the product to a checked-in walk-in's list. A missing or stale visit is ignored. */
  private async recordVisitScan(visitTokenInput: string | undefined, productId: string) {
    const token = cleanToken(visitTokenInput, VISIT_TOKEN_LENGTH);
    if (!token) return;
    const visit: any = await (this.prisma as any).showroomVisit.findUnique({ where: { token }, select: { id: true, createdAt: true } });
    if (!visit || Date.now() - new Date(visit.createdAt).getTime() > VISIT_SCAN_WINDOW_MS) return;
    const now = new Date();
    await (this.prisma as any).showroomVisitScan.upsert({
      where: { visitId_productId: { visitId: visit.id, productId } },
      create: { id: ulid(), visitId: visit.id, productId, updatedAt: now },
      update: { scanCount: { increment: 1 }, updatedAt: now },
    }).catch(() => null);
    await (this.prisma as any).showroomVisit.update({ where: { id: visit.id }, data: { lastSeenAt: now, updatedAt: now } }).catch(() => null);
  }

  async publicShare(tokenInput: string) {
    const config = await this.settings();
    if (!config.enabled) return this.disabled(config.showroom);
    const token = cleanToken(tokenInput, SHARE_TOKEN_LENGTH);
    const share: any = token ? await (this.prisma as any).catalogueShare.findUnique({ where: { token } }) : null;
    const now = new Date();
    if (!share) return { enabled: true, showroom: config.showroom, share: null, status: 'not_found', products: [] };
    if (share.revokedAt || share.expiresAt <= now) return { enabled: true, showroom: config.showroom, share: null, status: 'expired', products: [] };
    const ids = Array.isArray(share.productIds) ? share.productIds.map(String) : [];
    const rows = await this.prisma.product.findMany({ where: { id: { in: ids }, status: 'active' }, include: productInclude });
    const byId = new Map(rows.map((row: any) => [row.id, row]));
    const ordered = ids.map((id: string) => byId.get(id)).filter(Boolean);
    await this.ensureProductTokens(ordered);
    const creator: any = await this.prisma.user.findUnique({ where: { id: share.createdBy }, select: { name: true } });
    await (this.prisma as any).catalogueShare.update({ where: { id: share.id }, data: { viewCount: { increment: 1 }, lastViewedAt: now } }).catch(() => null);
    return {
      enabled: true,
      showroom: config.showroom,
      status: 'active',
      share: { title: share.title, note: share.note, expiresAt: share.expiresAt, sharedBy: creator?.name || '' },
      products: ordered.map((row: any) => this.customerProduct(row, config.priceMode)),
    };
  }

  async publicShowroom() {
    const config = await this.settings();
    return { enabled: config.enabled, showroom: config.showroom };
  }

  // ---- Staff side ----

  async productCustomerLink(productId: string) {
    const config = await this.settings();
    const product: any = await this.prisma.product.findUnique({ where: { id: productId }, select: { id: true, status: true, publicToken: true, publicStat: true } as any });
    if (!product) throw new NotFoundException('Product not found');
    if (product.status !== 'active') throw new BadRequestException('Only active products can be shared with customers');
    await this.ensureProductTokens([product]);
    const url = this.publicUrl(config.baseUrl, `/p/${product.publicToken}`);
    return {
      enabled: config.enabled,
      url,
      qrDataUrl: config.baseUrl ? await brandedLabelQrDataUrl(url) : null,
      views: product.publicStat?.views || 0,
      qrScans: product.publicStat?.qrScans || 0,
      lastViewedAt: product.publicStat?.lastViewedAt || null,
    };
  }

  async showroomPoster() {
    const config = await this.settings();
    const url = this.publicUrl(config.baseUrl, '/scan');
    return { enabled: config.enabled, url, qrDataUrl: config.baseUrl ? await brandedLabelQrDataUrl(url) : null, showroom: config.showroom };
  }

  async createShare(input: { productIds?: string[]; title?: string; note?: string; expiresInDays?: number }, actorUserId: string) {
    const ids = Array.from(new Set((input.productIds || []).map((id) => String(id || '').trim()).filter(Boolean)));
    if (!ids.length) throw new BadRequestException('Pick at least one product to share');
    if (ids.length > MAX_SHARE_PRODUCTS) throw new BadRequestException(`A share link can hold up to ${MAX_SHARE_PRODUCTS} products`);
    const active = await this.prisma.product.findMany({ where: { id: { in: ids }, status: 'active' }, select: { id: true } });
    if (active.length !== ids.length) throw new BadRequestException('One or more picked products are no longer active');
    const days = Math.min(Math.max(Math.trunc(Number(input.expiresInDays || 30)), 1), 180);
    const title = String(input.title || '').trim().slice(0, 120) || 'Products picked for you';
    const note = String(input.note || '').trim().slice(0, 600);
    const now = new Date();
    const share = await (this.prisma as any).catalogueShare.create({
      data: {
        id: ulid(), token: publicToken(SHARE_TOKEN_LENGTH), title, note, productIds: ids, createdBy: actorUserId,
        expiresAt: new Date(now.getTime() + days * 24 * 60 * 60 * 1000), updatedAt: now,
      },
    });
    await this.audit(actorUserId, 'catalogue.share.create', share.id, `Shared ${ids.length} product${ids.length === 1 ? '' : 's'} with a customer link`, { productCount: ids.length, expiresInDays: days });
    return this.shareRow(share, await this.settings());
  }

  private shareRow(share: any, config: { baseUrl: string }, creatorName = '') {
    const now = new Date();
    return {
      id: share.id,
      title: share.title,
      note: share.note,
      productCount: Array.isArray(share.productIds) ? share.productIds.length : 0,
      url: this.publicUrl(config.baseUrl, `/s/${share.token}`),
      expiresAt: share.expiresAt,
      revokedAt: share.revokedAt,
      status: share.revokedAt ? 'revoked' : share.expiresAt <= now ? 'expired' : 'active',
      viewCount: share.viewCount,
      lastViewedAt: share.lastViewedAt,
      createdAt: share.createdAt,
      createdBy: share.createdBy,
      createdByName: creatorName,
    };
  }

  async listShares(actorUserId: string, seeAll: boolean) {
    const config = await this.settings();
    const shares = await (this.prisma as any).catalogueShare.findMany({
      where: seeAll ? {} : { createdBy: actorUserId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const users = await this.prisma.user.findMany({ where: { id: { in: Array.from(new Set(shares.map((row: any) => row.createdBy))) as string[] } }, select: { id: true, name: true } });
    const names = new Map(users.map((user) => [user.id, user.name]));
    return shares.map((share: any) => this.shareRow(share, config, names.get(share.createdBy) || ''));
  }

  async revokeShare(id: string, actorUserId: string, canManageAll: boolean) {
    const share = await (this.prisma as any).catalogueShare.findUnique({ where: { id } });
    if (!share) throw new NotFoundException('Share link not found');
    if (share.createdBy !== actorUserId && !canManageAll) throw new ForbiddenException('Only the person who created this link or a manager can stop it');
    const updated = share.revokedAt ? share : await (this.prisma as any).catalogueShare.update({ where: { id }, data: { revokedAt: new Date(), updatedAt: new Date() } });
    if (!share.revokedAt) await this.audit(actorUserId, 'catalogue.share.revoke', id, 'Stopped a customer share link', {});
    return this.shareRow(updated, await this.settings());
  }

  private async audit(actorUserId: string, action: string, entityId: string, summary: string, metadata: Record<string, unknown>) {
    await this.prisma.auditEvent.create({ data: { id: ulid(), actorUserId, action, entityType: 'CatalogueShare', entityId, summary, metadata: metadata as any } }).catch(() => null);
  }
}
