import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as nodemailer from 'nodemailer';
import * as fs from 'fs';
import * as path from 'path';
import { createHash, randomBytes } from 'crypto';
import { ulid } from 'ulid';
import { AuditService } from '../audit/audit.service';

export interface SendEmailInput {
  to: string;
  subject: string;
  body: string;
  quoteId?: string;
  attachments?: { filename: string; path: string }[];
}

const ONE_GIB = 1024 * 1024 * 1024;
const DEFAULT_VAULT_LIMIT = 50 * ONE_GIB;
const SAFE_TEXT_TYPES = new Set(['.txt', '.csv']);
const OFFICE_TYPES: Record<string, string> = {
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
const MEDIA_TYPES: Record<string, { contentType: string; mediaKind: string }> = {
  '.pdf': { contentType: 'application/pdf', mediaKind: 'pdf' },
  '.jpg': { contentType: 'image/jpeg', mediaKind: 'image' },
  '.jpeg': { contentType: 'image/jpeg', mediaKind: 'image' },
  '.png': { contentType: 'image/png', mediaKind: 'image' },
  '.webp': { contentType: 'image/webp', mediaKind: 'image' },
  '.gif': { contentType: 'image/gif', mediaKind: 'image' },
  '.mp4': { contentType: 'video/mp4', mediaKind: 'video' },
  '.webm': { contentType: 'video/webm', mediaKind: 'video' },
  '.mov': { contentType: 'video/quicktime', mediaKind: 'video' },
  '.mp3': { contentType: 'audio/mpeg', mediaKind: 'audio' },
  '.m4a': { contentType: 'audio/mp4', mediaKind: 'audio' },
  '.wav': { contentType: 'audio/wav', mediaKind: 'audio' },
  '.txt': { contentType: 'text/plain; charset=utf-8', mediaKind: 'document' },
  '.csv': { contentType: 'text/csv; charset=utf-8', mediaKind: 'document' },
  ...Object.fromEntries(Object.entries(OFFICE_TYPES).map(([extension, contentType]) => [extension, { contentType, mediaKind: 'document' }])),
};

function cleanText(value: unknown, max: number) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

function titleFromFilename(filename: string) {
  return cleanText(path.basename(filename, path.extname(filename)).replace(/[_-]+/g, ' '), 180) || 'Untitled file';
}

function publicAsset(asset: any, uploaderById: Map<string, any> = new Map()) {
  return {
    ...asset,
    uploader: uploaderById.get(asset.uploadedBy) || null,
    createdAt: asset.createdAt?.toISOString?.() || asset.createdAt,
    updatedAt: asset.updatedAt?.toISOString?.() || asset.updatedAt,
    archivedAt: asset.archivedAt?.toISOString?.() || asset.archivedAt,
    shares: (asset.shares || []).map((share: any) => ({
      ...share,
      createdAt: share.createdAt?.toISOString?.() || share.createdAt,
      expiresAt: share.expiresAt?.toISOString?.() || share.expiresAt,
      revokedAt: share.revokedAt?.toISOString?.() || share.revokedAt,
      lastViewedAt: share.lastViewedAt?.toISOString?.() || share.lastViewedAt,
    })),
  };
}

@Injectable()
export class DocumentsService {
  private transporter: nodemailer.Transporter;

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'localhost',
      port: parseInt(process.env.SMTP_PORT || '1025'),
      secure: false,
      auth: process.env.SMTP_USER ? {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      } : undefined,
    });
    void this.recoverTransientVaultFiles();
  }

  private async recoverTransientVaultFiles() {
    const incoming = this.vaultTemporaryRoot();
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const name of fs.readdirSync(incoming)) {
      const filePath = path.join(incoming, name);
      try { if (fs.statSync(filePath).mtimeMs < cutoff) fs.rmSync(filePath, { force: true }); } catch { /* Another request may own the file. */ }
    }
    const trashRoot = path.join(this.vaultRoot(), '.trash');
    if (!fs.existsSync(trashRoot)) return;
    for (const name of fs.readdirSync(trashRoot)) {
      const match = name.match(/^([0-9A-HJKMNP-TV-Z]{26})-(.+)$/);
      if (!match) continue;
      const [, assetId, storageKey] = match;
      const quarantined = path.join(trashRoot, name);
      const asset = await this.prisma.vaultAsset.findUnique({ where: { id: assetId }, select: { storageKey: true } }).catch(() => null);
      if (!asset) {
        fs.rmSync(quarantined, { force: true });
      } else if (asset.storageKey === storageKey) {
        const source = path.join(this.vaultRoot(), storageKey);
        if (!fs.existsSync(source)) fs.renameSync(quarantined, source);
        else fs.rmSync(quarantined, { force: true });
      }
    }
  }

  vaultRoot() {
    const root = process.env.DOCUMENT_VAULT_STORAGE_DIR
      || path.join(process.env.CATALOGUE_IMAGE_STORAGE_DIR || path.resolve(process.cwd(), '../../apps/web/public/catalogue-images'), 'document-vault');
    fs.mkdirSync(root, { recursive: true });
    return root;
  }

  vaultTemporaryRoot() {
    const root = path.join(this.vaultRoot(), '.incoming');
    fs.mkdirSync(root, { recursive: true });
    return root;
  }

  maxFileBytes() {
    const configured = Number(process.env.DOCUMENT_VAULT_MAX_FILE_BYTES || ONE_GIB);
    return Number.isFinite(configured) && configured > 0 ? Math.min(configured, 2_000_000_000) : ONE_GIB;
  }

  private maxTotalBytes() {
    const configured = Number(process.env.DOCUMENT_VAULT_MAX_TOTAL_BYTES || DEFAULT_VAULT_LIMIT);
    return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_VAULT_LIMIT;
  }

  private async fingerprint(filePath: string) {
    return new Promise<string>((resolve, reject) => {
      const hash = createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('error', reject);
      stream.on('end', () => resolve(hash.digest('hex')));
    });
  }

  private inspectUpload(filePath: string, originalName: string) {
    const extension = path.extname(originalName || '').toLowerCase();
    const media = MEDIA_TYPES[extension];
    if (!media) {
      throw new BadRequestException('Unsupported file type. Upload PDF, Word, Excel, PowerPoint, TXT, CSV, JPG, PNG, WebP, GIF, MP4, WebM, MOV, MP3, M4A or WAV.');
    }
    const descriptor = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(16);
    const bytesRead = fs.readSync(descriptor, header, 0, header.length, 0);
    fs.closeSync(descriptor);
    const bytes = header.subarray(0, bytesRead);
    const ascii = bytes.toString('ascii');
    const isZip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
    const valid = extension === '.pdf' ? ascii.startsWith('%PDF-')
      : ['.jpg', '.jpeg'].includes(extension) ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : extension === '.png' ? bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      : extension === '.webp' ? ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP'
      : extension === '.gif' ? ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a')
      : ['.mp4', '.mov', '.m4a'].includes(extension) ? ascii.slice(4, 8) === 'ftyp'
      : extension === '.webm' ? bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
      : extension === '.wav' ? ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WAVE'
      : extension === '.mp3' ? ascii.startsWith('ID3') || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
      : ['.docx', '.xlsx', '.pptx'].includes(extension) ? isZip
      : ['.doc', '.xls', '.ppt'].includes(extension) ? bytes.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
      : SAFE_TEXT_TYPES.has(extension) ? !bytes.includes(0)
      : false;
    if (!valid) throw new BadRequestException(`The contents do not match the ${extension.slice(1).toUpperCase()} file type.`);
    return { extension, ...media };
  }

  async registerUpload(input: {
    temporaryPath: string;
    originalName: string;
    sizeBytes: number;
    title?: string;
    description?: string;
    category?: string;
    uploadedBy: string;
  }) {
    if (!input.sizeBytes || input.sizeBytes > this.maxFileBytes()) {
      throw new BadRequestException(`Files must be between 1 byte and ${Math.floor(this.maxFileBytes() / ONE_GIB)} GB.`);
    }
    const type = this.inspectUpload(input.temporaryPath, input.originalName);
    const aggregate = await this.prisma.vaultAsset.aggregate({ _sum: { sizeBytes: true } });
    if (Number(aggregate._sum.sizeBytes || 0) + input.sizeBytes > this.maxTotalBytes()) {
      throw new BadRequestException('The document vault storage limit has been reached. Archive cleanup or storage expansion is required.');
    }
    const id = ulid();
    const storageKey = `${id}${type.extension}`;
    const finalPath = path.join(this.vaultRoot(), storageKey);
    const checksum = await this.fingerprint(input.temporaryPath);
    fs.renameSync(input.temporaryPath, finalPath);
    try {
      const asset = await this.prisma.vaultAsset.create({
        data: {
          id,
          title: cleanText(input.title, 180) || titleFromFilename(input.originalName),
          description: cleanText(input.description, 1200),
          category: cleanText(input.category, 80) || 'General',
          originalName: cleanText(path.basename(input.originalName), 240),
          storageKey,
          contentType: type.contentType,
          extension: type.extension,
          sizeBytes: input.sizeBytes,
          checksum,
          mediaKind: type.mediaKind,
          uploadedBy: input.uploadedBy,
          updatedAt: new Date(),
        },
      });
      await this.audit.record({ actorUserId: input.uploadedBy, action: 'vault.upload', entityType: 'VaultAsset', entityId: id, summary: `Uploaded ${asset.originalName}`, metadata: { sizeBytes: asset.sizeBytes, contentType: asset.contentType, checksum } });
      return publicAsset(asset);
    } catch (error) {
      fs.rmSync(finalPath, { force: true });
      throw error;
    }
  }

  async listVaultAssets(filters: { search?: string; category?: string; mediaKind?: string; status?: string; take?: number }) {
    const status = filters.status === 'archived' ? 'archived' : 'active';
    const search = cleanText(filters.search, 120);
    const where: any = {
      status,
      ...(filters.category && filters.category !== 'all' ? { category: filters.category } : {}),
      ...(filters.mediaKind && filters.mediaKind !== 'all' ? { mediaKind: filters.mediaKind } : {}),
      ...(search ? { OR: [
        { title: { contains: search, mode: 'insensitive' } },
        { originalName: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { category: { contains: search, mode: 'insensitive' } },
      ] } : {}),
    };
    const assets = await this.prisma.vaultAsset.findMany({
      where,
      include: { shares: { orderBy: { createdAt: 'desc' }, take: 12 } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(Number(filters.take) || 200, 1), 500),
    });
    const uploaderIds = Array.from(new Set(assets.map((asset) => asset.uploadedBy)));
    const uploaders = uploaderIds.length ? await this.prisma.user.findMany({ where: { id: { in: uploaderIds } }, select: { id: true, name: true, email: true } }) : [];
    const uploaderById = new Map(uploaders.map((user) => [user.id, user]));
    return assets.map((asset) => publicAsset(asset, uploaderById));
  }

  async vaultSummary() {
    const [active, archived, byKind, byCategory] = await Promise.all([
      this.prisma.vaultAsset.aggregate({ where: { status: 'active' }, _count: true, _sum: { sizeBytes: true } }),
      this.prisma.vaultAsset.aggregate({ where: { status: 'archived' }, _count: true, _sum: { sizeBytes: true } }),
      this.prisma.vaultAsset.groupBy({ by: ['mediaKind'], where: { status: 'active' }, _count: true, _sum: { sizeBytes: true } }),
      this.prisma.vaultAsset.groupBy({ by: ['category'], where: { status: 'active' }, _count: true, orderBy: { category: 'asc' } }),
    ]);
    return {
      activeCount: active._count,
      archivedCount: archived._count,
      usedBytes: Number(active._sum.sizeBytes || 0) + Number(archived._sum.sizeBytes || 0),
      limitBytes: this.maxTotalBytes(),
      maxFileBytes: this.maxFileBytes(),
      byKind,
      categories: byCategory.map((row) => ({ name: row.category, count: row._count })),
    };
  }

  async updateVaultAsset(assetId: string, input: any, actorUserId: string) {
    const current = await this.prisma.vaultAsset.findUnique({ where: { id: assetId } });
    if (!current) throw new NotFoundException('Vault file not found');
    const asset = await this.prisma.vaultAsset.update({
      where: { id: assetId },
      data: {
        ...(input.title !== undefined ? { title: cleanText(input.title, 180) || current.title } : {}),
        ...(input.description !== undefined ? { description: cleanText(input.description, 1200) } : {}),
        ...(input.category !== undefined ? { category: cleanText(input.category, 80) || 'General' } : {}),
      },
      include: { shares: { orderBy: { createdAt: 'desc' }, take: 12 } },
    });
    await this.audit.record({ actorUserId, action: 'vault.update', entityType: 'VaultAsset', entityId: assetId, summary: `Updated ${asset.title}` });
    return publicAsset(asset);
  }

  async setVaultAssetArchived(assetId: string, archived: boolean, actorUserId: string) {
    const current = await this.prisma.vaultAsset.findUnique({ where: { id: assetId } });
    if (!current) throw new NotFoundException('Vault file not found');
    const asset = await this.prisma.$transaction(async (tx) => {
      if (archived) await tx.vaultShare.updateMany({ where: { assetId, revokedAt: null }, data: { revokedAt: new Date() } });
      return tx.vaultAsset.update({ where: { id: assetId }, data: { status: archived ? 'archived' : 'active', archivedAt: archived ? new Date() : null }, include: { shares: { orderBy: { createdAt: 'desc' }, take: 12 } } });
    });
    await this.audit.record({ actorUserId, action: archived ? 'vault.archive' : 'vault.restore', entityType: 'VaultAsset', entityId: assetId, summary: `${archived ? 'Archived' : 'Restored'} ${asset.title}` });
    return publicAsset(asset);
  }

  async purgeVaultAsset(assetId: string, actorUserId: string) {
    const asset = await this.prisma.vaultAsset.findUnique({ where: { id: assetId } });
    if (!asset) throw new NotFoundException('Vault file not found');
    if (asset.status !== 'archived') throw new BadRequestException('Archive the file before deleting it permanently');
    const source = path.join(this.vaultRoot(), asset.storageKey);
    const trashRoot = path.join(this.vaultRoot(), '.trash');
    const quarantined = path.join(trashRoot, `${asset.id}-${asset.storageKey}`);
    fs.mkdirSync(trashRoot, { recursive: true });
    if (fs.existsSync(source)) fs.renameSync(source, quarantined);
    try {
      await this.prisma.vaultAsset.delete({ where: { id: assetId } });
    } catch (error) {
      if (fs.existsSync(quarantined)) fs.renameSync(quarantined, source);
      throw error;
    }
    fs.rmSync(quarantined, { force: true });
    await this.audit.record({ actorUserId, action: 'vault.delete', entityType: 'VaultAsset', entityId: assetId, summary: `Permanently deleted ${asset.title}`, metadata: { originalName: asset.originalName, sizeBytes: asset.sizeBytes, checksum: asset.checksum } });
    return { id: assetId, purged: true, reclaimedBytes: asset.sizeBytes };
  }

  async createVaultShare(assetId: string, input: any, actorUserId: string) {
    const asset = await this.prisma.vaultAsset.findUnique({ where: { id: assetId } });
    if (!asset || asset.status !== 'active') throw new NotFoundException('Active vault file not found');
    const activeShares = await this.prisma.vaultShare.count({ where: { assetId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
    if (activeShares >= 30) throw new BadRequestException('This file already has 30 active share links. Revoke an old link first.');
    let expiresAt: Date | null = null;
    if (input?.expiresAt) {
      expiresAt = new Date(input.expiresAt);
      if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date()) throw new BadRequestException('Share expiry must be in the future');
      if (expiresAt > new Date(Date.now() + 366 * 24 * 60 * 60 * 1000)) throw new BadRequestException('Share expiry cannot exceed one year');
    }
    const share = await this.prisma.vaultShare.create({
      data: { id: ulid(), token: randomBytes(32).toString('base64url'), assetId, createdBy: actorUserId, allowDownload: input?.allowDownload !== false, expiresAt },
    });
    await this.audit.record({ actorUserId, action: 'vault.share.create', entityType: 'VaultAsset', entityId: assetId, summary: `Created public link for ${asset.title}`, metadata: { shareId: share.id, expiresAt, allowDownload: share.allowDownload } });
    return publicAsset({ ...share, asset: undefined });
  }

  async revokeVaultShare(shareId: string, actorUserId: string) {
    const share = await this.prisma.vaultShare.findUnique({ where: { id: shareId }, include: { asset: true } });
    if (!share) throw new NotFoundException('Share link not found');
    const updated = await this.prisma.vaultShare.update({ where: { id: shareId }, data: { revokedAt: share.revokedAt || new Date() } });
    await this.audit.record({ actorUserId, action: 'vault.share.revoke', entityType: 'VaultAsset', entityId: share.assetId, summary: `Revoked public link for ${share.asset.title}`, metadata: { shareId } });
    return publicAsset(updated);
  }

  async vaultAssetForContent(assetId: string) {
    const asset = await this.prisma.vaultAsset.findUnique({ where: { id: assetId } });
    if (!asset || asset.status !== 'active') throw new NotFoundException('Vault file not found');
    const filePath = path.join(this.vaultRoot(), asset.storageKey);
    if (!fs.existsSync(filePath)) throw new NotFoundException('Stored file is missing');
    return { asset, filePath };
  }

  async resolvePublicShare(token: string, countView = false) {
    const share = await this.prisma.vaultShare.findUnique({ where: { token }, include: { asset: true } });
    if (!share || share.revokedAt || (share.expiresAt && share.expiresAt <= new Date()) || share.asset.status !== 'active') {
      throw new NotFoundException('This share link is invalid, expired or revoked');
    }
    if (countView) {
      await this.prisma.vaultShare.update({ where: { id: share.id }, data: { viewCount: { increment: 1 }, lastViewedAt: new Date() } });
    }
    const filePath = path.join(this.vaultRoot(), share.asset.storageKey);
    if (!fs.existsSync(filePath)) throw new NotFoundException('Shared file is missing');
    return { share, asset: share.asset, filePath };
  }

  async generateQuotePdf(quoteId: string): Promise<any> {
    const quote = await this.prisma.quote.findUnique({
      where: { id: quoteId },
      include: { customer: true },
    });

    if (!quote) throw new Error('Quote not found');

    return {
      id: quoteId,
      url: `/api/pdf/quote/${quoteId}`,
      contentType: 'application/pdf',
      success: true,
    };
  }

  async sendQuoteEmail(input: SendEmailInput) {
    const { quoteId, ...emailData } = input;
    
    const info = await this.transporter.sendMail({
      from: process.env.SMTP_FROM || 'noreply@marblepark.in',
      ...emailData,
    });

    if (quoteId) {
      await this.prisma.quote.update({
        where: { id: quoteId },
        data: { sentAt: new Date(), status: 'sent' },
      });
    }

    return { messageId: info.messageId, success: true };
  }

  private buildQuoteHtml(quote: any, lines: any[]): string {
    const lineItems = lines.map((line, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${line.sku || ''}</td>
        <td>${line.description || ''}</td>
        <td style="text-align:center">${line.quantity || 0}</td>
        <td style="text-align:right">₹${(line.rate || 0).toLocaleString('en-IN')}</td>
        <td style="text-align:right">₹${((line.quantity || 0) * (line.rate || 0)).toLocaleString('en-IN')}</td>
      </tr>
    `).join('');

    const subtotal = lines.reduce((sum, line) => sum + ((line.quantity || 0) * (line.rate || 0)), 0);
    const discount = (quote.discountPercent || 0) / 100 * subtotal;
    const taxable = subtotal - discount;
    const tax = taxable * 0.18;
    const total = taxable + tax;

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 12px; color: #333; }
    .header { background: linear-gradient(135deg, #1a365d 0%, #2d4a7c 100%); color: white; padding: 30px; }
    .header h1 { font-size: 28px; margin-bottom: 5px; }
    .header p { opacity: 0.9; font-size: 11px; }
    .content { padding: 30px; }
    .info-grid { display: table; width: 100%; margin-bottom: 20px; }
    .info-grid > div { display: table-row; }
    .info-grid label { display: table-cell; font-weight: 600; color: #666; padding: 5px 10px 5px 0; width: 120px; }
    .info-grid span { display: table-cell; padding: 5px 0; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    th { background: #f8f9fa; padding: 12px 8px; text-align: left; font-weight: 600; border-bottom: 2px solid #1a365d; }
    td { padding: 10px 8px; border-bottom: 1px solid #eee; }
    .totals { margin-left: auto; width: 300px; }
    .totals td { padding: 6px 0; }
    .totals .label { color: #666; }
    .totals .value { text-align: right; }
    .totals tr.total { font-size: 16px; font-weight: 700; color: #1a365d; }
    .footer { background: #f8f9fa; padding: 20px 30px; font-size: 10px; color: #666; }
  </style>
</head>
<body>
  <div class="header">
    <h1>MARBLE PARK</h1>
    <p>Premium Bath Solutions | GSTIN: Configure in settings | Ph: Configure in settings</p>
  </div>
  <div class="content">
    <h2 style="margin-bottom: 20px; color: #1a365d; border-bottom: 2px solid #1a365d; padding-bottom: 10px;">
      QUOTATION
    </h2>
    <div class="info-grid">
      <div><label>Quote No:</label><span>${quote.quoteNumber}</span></div>
      <div><label>Date:</label><span>${new Date(quote.createdAt).toLocaleDateString('en-IN')}</span></div>
      <div><label>Valid Until:</label><span>${new Date(quote.validUntil).toLocaleDateString('en-IN')}</span></div>
      <div><label>Project:</label><span>${quote.projectName || '-'}</span></div>
      <div><label>Customer:</label><span>${quote.customer.name}</span></div>
      <div><label>Company:</label><span>${quote.customer.companyName || '-'}</span></div>
    </div>
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>SKU</th>
          <th>Description</th>
          <th style="text-align:center">Qty</th>
          <th style="text-align:right">Rate</th>
          <th style="text-align:right">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${lineItems || '<tr><td colspan="6" style="text-align:center;color:#999;">No items</td></tr>'}
      </tbody>
    </table>
    <table class="totals">
      <tr><td class="label">Subtotal</td><td class="value">₹${subtotal.toLocaleString('en-IN')}</td></tr>
      ${discount > 0 ? `<tr><td class="label">Discount (${quote.discountPercent}%)</td><td class="value">-₹${discount.toLocaleString('en-IN')}</td></tr>` : ''}
      <tr><td class="label">CGST (9%)</td><td class="value">₹${(tax/2).toLocaleString('en-IN')}</td></tr>
      <tr><td class="label">SGST (9%)</td><td class="value">₹${(tax/2).toLocaleString('en-IN')}</td></tr>
      <tr class="total"><td>TOTAL</td><td>₹${total.toLocaleString('en-IN')}</td></tr>
    </table>
    ${quote.notes ? `<div style="margin-top:20px;padding:15px;background:#f8f9fa;border-left:3px solid #1a365d;"><strong>Notes:</strong><br>${quote.notes}</div>` : ''}
  </div>
  <div class="footer">
    <p>This is a computer-generated document. No signature required.</p>
    <p>Marble Park | Configure address, GST and email in system settings</p>
  </div>
</body>
</html>`;
  }
}
