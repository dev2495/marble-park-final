import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ulid } from 'ulid';
import * as fs from 'fs';
import * as path from 'path';

type ImportMode = 'preview' | 'apply';

type NormalizedProductRow = {
  sku: string;
  name: string;
  category: string;
  brand: string;
  finish: string;
  dimensions: string;
  unit: string;
  sellPrice: number;
  floorPrice: number;
  description: string;
  range: string;
  imageUrl: string;
};

@Injectable()
export class ImportsService {
  constructor(private prisma: PrismaService) {}

  async previewExcelImport(filePath: string, uploadedBy = 'system'): Promise<any> {
    this.assertExcelFile(filePath);
    const allRows = await this.readExcelRows(filePath, 'preview');
    const plan = await this.buildImportPlan(allRows);
    await this.audit(uploadedBy, 'excel_import.preview', 'Product', 'excel-preview', `Excel import preview: ${plan.ready} ready, ${plan.failed} failed`, { filePath, ...this.auditPlan(plan) });
    return {
      source: 'excel-preview',
      status: plan.failed ? 'needs_correction' : 'ready_to_apply',
      applyMode: 'all_or_nothing',
      message: plan.failed
        ? 'Fix failed rows before applying. Nothing has been written to Product Master.'
        : 'Preview is clean. Apply to write Product Master, masters and inventory balances in one transaction.',
      ...this.publicPlan(plan),
    };
  }

  async processExcelImport(filePath: string, uploadedBy = 'system'): Promise<any> {
    this.assertExcelFile(filePath);
    const allRows = await this.readExcelRows(filePath, 'apply');
    const plan = await this.buildImportPlan(allRows);

    if (plan.failed) {
      await this.audit(uploadedBy, 'excel_import.blocked', 'Product', 'excel-apply-blocked', `Excel import blocked: ${plan.failed} invalid row(s)`, { filePath, ...this.auditPlan(plan) });
      return {
        source: 'excel-apply',
        status: 'blocked_by_validation',
        message: 'Import was not applied. Fix failed rows and run preview again.',
        ...this.publicPlan(plan),
        applied: 0,
        created: 0,
        updated: 0,
        products: [],
      };
    }

    const appliedProducts = await this.prisma.$transaction(async (tx) => {
      const rows: any[] = [];
      for (const row of plan.rows) {
        const product = await this.applyProductRowTx(tx, row.normalized, uploadedBy);
        rows.push({ id: product.id, sku: product.sku, action: row.action });
      }
      return rows;
    }, { timeout: 30000 });

    const created = plan.rows.filter((row) => row.action === 'created').length;
    const updated = plan.rows.filter((row) => row.action === 'updated').length;
    await this.audit(uploadedBy, 'excel_import.apply', 'Product', 'excel-transaction-import', `Excel import applied: ${created} created, ${updated} updated, 0 failed`, { filePath, total: plan.total, created, updated, failed: 0 });

    return {
      source: 'excel-apply',
      status: 'applied',
      total: plan.total,
      applied: appliedProducts.length,
      created,
      updated,
      failed: 0,
      failures: [],
      masterGaps: plan.masterGaps,
      products: appliedProducts.slice(0, 120),
      message: 'Product Master, dropdown masters and inventory balances were updated in one transaction.',
    };
  }

  private assertExcelFile(filePath: string) {
    if (!/\.xlsx$/i.test(filePath || '')) {
      throw new BadRequestException('Only .xlsx catalogue imports are supported. PDF extraction has been removed because vendor catalogues are not reliable enough for automated SKU creation.');
    }
  }

  private async readExcelRows(filePath: string, mode: ImportMode) {
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const allRows: any[] = [];
    for (const worksheet of workbook.worksheets) {
      const headers = this.detectHeaders(worksheet);
      const embeddedImages = await this.extractWorksheetImages(workbook, worksheet, headers.headerRowNumber, mode === 'apply');
      worksheet.eachRow((row: any, rowNumber: number) => {
        if (rowNumber <= headers.headerRowNumber) return;
        const data: any = { __sheet: worksheet.name, __rowNumber: rowNumber };
        row.eachCell({ includeEmpty: true }, (cell: any, colNumber: number) => {
          const header = headers.byColumn[colNumber] || `Column ${colNumber}`;
          data[header] = this.cellValue(cell.value);
        });
        const embeddedImageUrl = embeddedImages.get(rowNumber);
        if (embeddedImageUrl) data.__embeddedImageUrl = embeddedImageUrl;
        if (Object.values(data).some((value) => value !== undefined && value !== null && String(value).trim() !== '')) {
          allRows.push(data);
        }
      });
    }
    return allRows;
  }

  private async buildImportPlan(rawRows: any[]) {
    if (!rawRows.length) {
      return { total: 0, ready: 0, failed: 0, created: 0, updated: 0, failures: [], rows: [], previewRows: [], masterGaps: { categories: [], brands: [], finishes: [] } };
    }

    const parsed = rawRows.map((raw) => {
      const normalized = this.normalizeProductRow(raw);
      const errors = this.validateNormalizedRow(normalized);
      return { raw, normalized, errors };
    });

    const skus = Array.from(new Set(parsed.map((row) => row.normalized.sku).filter(Boolean)));
    const [existingProducts, categories, brands, finishes] = await Promise.all([
      skus.length ? this.prisma.product.findMany({ where: { sku: { in: skus } }, select: { id: true, sku: true } }) : [],
      this.prisma.productCategory.findMany({ select: { name: true } }),
      this.prisma.productBrand.findMany({ select: { name: true } }),
      this.prisma.productFinish.findMany({ select: { name: true } }),
    ]);

    const existingSku = new Map(existingProducts.map((product) => [product.sku, product.id] as const));
    const categoryNames = new Set(categories.map((row) => this.key(row.name)));
    const brandNames = new Set(brands.map((row) => this.key(row.name)));
    const finishNames = new Set(finishes.map((row) => this.key(row.name)));
    const missingCategories = new Set<string>();
    const missingBrands = new Set<string>();
    const missingFinishes = new Set<string>();
    const failures: any[] = [];
    const rows: any[] = [];
    const seen = new Set<string>();

    parsed.forEach((row) => {
      const errors = [...row.errors];
      if (row.normalized.sku) {
        if (seen.has(row.normalized.sku)) errors.push('Duplicate SKU in this Excel file');
        seen.add(row.normalized.sku);
      }
      if (row.normalized.category && !categoryNames.has(this.key(row.normalized.category))) missingCategories.add(row.normalized.category);
      if (row.normalized.brand && !brandNames.has(this.key(row.normalized.brand))) missingBrands.add(row.normalized.brand);
      if (row.normalized.finish && !finishNames.has(this.key(row.normalized.finish))) missingFinishes.add(row.normalized.finish);

      const action = existingSku.has(row.normalized.sku) ? 'updated' : 'created';
      const preview = {
        sheet: row.raw.__sheet,
        rowNumber: row.raw.__rowNumber,
        sku: row.normalized.sku,
        name: row.normalized.name,
        category: row.normalized.category,
        brand: row.normalized.brand,
        finish: row.normalized.finish,
        unit: row.normalized.unit,
        sellPrice: row.normalized.sellPrice,
        floorPrice: row.normalized.floorPrice,
        imageStatus: row.normalized.imageUrl ? (row.normalized.imageUrl === '__embedded_excel_image__' ? 'embedded_image_detected' : 'image_url_ready') : 'no_image',
        action,
        errors,
      };

      if (errors.length) failures.push({ sheet: row.raw.__sheet, rowNumber: row.raw.__rowNumber, sku: row.normalized.sku || null, error: errors.join('; ') });
      rows.push({ ...preview, normalized: row.normalized });
    });

    const failed = failures.length;
    const readyRows = rows.filter((row) => !row.errors.length);
    return {
      total: rows.length,
      ready: readyRows.length,
      failed,
      created: readyRows.filter((row) => row.action === 'created').length,
      updated: readyRows.filter((row) => row.action === 'updated').length,
      failures: failures.slice(0, 80),
      rows: readyRows,
      previewRows: rows.slice(0, 250).map(({ normalized, ...row }) => row),
      masterGaps: {
        categories: Array.from(missingCategories).sort(),
        brands: Array.from(missingBrands).sort(),
        finishes: Array.from(missingFinishes).sort(),
      },
    };
  }

  private publicPlan(plan: any) {
    return {
      total: plan.total,
      ready: plan.ready,
      failed: plan.failed,
      created: plan.created,
      updated: plan.updated,
      failures: plan.failures,
      masterGaps: plan.masterGaps,
      previewRows: plan.previewRows,
    };
  }

  private auditPlan(plan: any) {
    return {
      total: plan.total,
      ready: plan.ready,
      failed: plan.failed,
      created: plan.created,
      updated: plan.updated,
      masterGaps: plan.masterGaps,
      failures: plan.failures?.slice?.(0, 20) || [],
    };
  }

  private validateNormalizedRow(row: NormalizedProductRow) {
    const errors: string[] = [];
    if (!row.sku) errors.push('SKU/code is required');
    if (!row.name) errors.push('Product name/description is required');
    if (!Number.isFinite(row.sellPrice) || row.sellPrice <= 0) errors.push('MRP/sell price must be greater than zero');
    if (!row.category) errors.push('Category is required');
    if (!row.brand) errors.push('Brand is required');
    if (!row.finish) errors.push('Finish is required');
    return errors;
  }

  private detectHeaders(worksheet: any) {
    let headerRowNumber = 1;
    let bestScore = -1;
    let headers: Record<number, string> = {};
    const maxRows = Math.min(10, worksheet.rowCount || 1);
    for (let rowNumber = 1; rowNumber <= maxRows; rowNumber += 1) {
      const rowHeaders: Record<number, string> = {};
      worksheet.getRow(rowNumber).eachCell({ includeEmpty: true }, (cell: any, colNumber: number) => {
        const value = String(this.cellValue(cell.value) || '').trim();
        if (value) rowHeaders[colNumber] = value;
      });
      const joined = Object.values(rowHeaders).join(' ').toLowerCase();
      const score = ['sku', 'code', 'description', 'product', 'brand', 'mrp', 'price', 'finish', 'category'].reduce(
        (sum, key) => sum + (joined.includes(key) ? 1 : 0),
        0,
      );
      if (score > bestScore) {
        bestScore = score;
        headerRowNumber = rowNumber;
        headers = rowHeaders;
      }
    }
    return { headerRowNumber, byColumn: headers };
  }

  private cellValue(value: any) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') {
      if (value.hyperlink) return value.hyperlink;
      if (value.text !== undefined) return value.text;
      if (value.result !== undefined) return value.result;
      if (value.richText) return value.richText.map((part: any) => part.text || '').join('');
    }
    return value;
  }

  private normalizeProductRow(data: any): NormalizedProductRow {
    const pick = (...keys: string[]) => {
      for (const key of keys) {
        if (data[key] !== undefined && data[key] !== null && String(data[key]).trim() !== '') return data[key];
        const matchedKey = Object.keys(data).find((candidate) => this.normalizeHeader(candidate) === this.normalizeHeader(key));
        if (matchedKey && data[matchedKey] !== undefined && data[matchedKey] !== null && String(data[matchedKey]).trim() !== '') return data[matchedKey];
      }
      return undefined;
    };
    const price = pick('MRP', 'Price', 'SELL PRICE', 'Sell Price', 'Selling Price', 'MRP INR', 'MRP(INR)', 'List Price', 'Amount', 'Rate');
    const floorPrice = pick('Floor Price', 'FLOOR PRICE', 'Dealer Price', 'Net Price', 'Special Rate');
    return {
      sku: this.normalizeSku(pick('SKU', 'sku', 'Code', 'PRODUCT CODE', 'Product Code', 'Item Code', 'Article No', 'Article Number', 'Model No', 'Material Code')),
      name: this.cleanText(pick('PRODUCT DESCRIPTION', 'Description', 'Product', 'Product Name', 'Item Name', 'Name', 'Item Description')),
      category: this.cleanText(pick('Category', 'CATEGORY', 'Product Category', 'Group', 'Type')) || 'Uncategorized',
      brand: this.cleanText(pick('Brand', 'BRAND', 'Make', 'Company')) || 'Unknown',
      finish: this.cleanText(pick('Finish', 'FINISH', 'Color', 'Colour', 'Surface', 'Shade')) || 'Standard',
      dimensions: this.cleanText(pick('Dimensions', 'DIMENSIONS', 'Size', 'SIZE', 'Tile Size')) || '',
      unit: String(pick('Unit', 'UOM', 'uom') || 'PC').trim().toUpperCase() || 'PC',
      sellPrice: this.money(price),
      floorPrice: this.money(floorPrice),
      description: this.cleanText(pick('Long Description', 'Description', 'PRODUCT DESCRIPTION')) || '',
      range: this.cleanText(pick('Range', 'RANGE', 'Series', 'Collection')) || '',
      imageUrl: this.cleanText(pick('__embeddedImageUrl', 'Image', 'Image URL', 'Photo', 'Photo URL', 'Media', 'Picture URL')) || '',
    };
  }

  private async applyProductRowTx(tx: any, normalized: NormalizedProductRow, uploadedBy: string): Promise<any> {
    const { sku, name, category, brand, finish, dimensions, unit, sellPrice } = normalized;
    await this.ensureProductMastersTx(tx, category, brand, finish);
    const media = normalized.imageUrl && normalized.imageUrl !== '__embedded_excel_image__'
      ? { primary: normalized.imageUrl, gallery: [normalized.imageUrl], source: 'excel-import', exactSkuMatch: true }
      : undefined;
    const existing = await tx.product.findUnique({ where: { sku } });
    if (existing) {
      const existingMedia: any = existing.media || {};
      const mergedMedia = media
        ? { ...existingMedia, ...media, gallery: Array.from(new Set([...(existingMedia.gallery || []), ...(media.gallery || [])])) }
        : existingMedia;
      const product = await tx.product.update({
        where: { sku },
        data: {
          name,
          category,
          brand,
          finish,
          dimensions,
          unit,
          sellPrice,
          floorPrice: normalized.floorPrice || Number(existing.floorPrice || sellPrice * 0.88),
          description: normalized.description || existing.description || '',
          media: mergedMedia,
          sourceRefs: { ...((existing.sourceRefs as any) || {}), lastExcelImportBy: uploadedBy, lastExcelImportAt: new Date().toISOString(), range: normalized.range },
          status: 'active',
          updatedAt: new Date(),
        } as any,
      });
      await this.ensureInventoryBalanceTx(tx, product.id);
      return product;
    }

    const product = await tx.product.create({
      data: {
        id: ulid(),
        sku,
        name,
        category,
        brand,
        finish,
        dimensions,
        unit,
        tags: [],
        sellPrice,
        floorPrice: normalized.floorPrice || sellPrice * 0.88,
        taxClass: 'GST_18',
        status: 'active',
        media: media || {},
        sourceRefs: { createdFrom: 'excel-import', uploadedBy, range: normalized.range },
        description: normalized.description,
        updatedAt: new Date(),
      } as any,
    });
    await this.ensureInventoryBalanceTx(tx, product.id);
    return product;
  }

  private async ensureInventoryBalanceTx(tx: any, productId: string) {
    await tx.inventoryBalance.upsert({
      where: { productId },
      update: { updatedAt: new Date() },
      create: {
        id: ulid(),
        productId,
        onHand: 0,
        available: 0,
        reserved: 0,
        damaged: 0,
        hold: 0,
        updatedAt: new Date(),
      },
    });
  }

  private async ensureProductMastersTx(tx: any, category: string, brand: string, finish: string) {
    const now = new Date();
    const code = (value: string) => String(value || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32) || 'MASTER';
    if (category) {
      await tx.productCategory.upsert({
        where: { name: category },
        update: { status: 'active', updatedAt: now },
        create: { id: ulid(), name: category, code: code(category), description: 'Created from Excel import', status: 'active', sortOrder: 100, metadata: { source: 'excel-import' }, updatedAt: now },
      });
    }
    if (brand) {
      await tx.productBrand.upsert({
        where: { name: brand },
        update: { status: 'active', updatedAt: now },
        create: { id: ulid(), name: brand, code: code(brand), description: 'Created from Excel import', status: 'active', sortOrder: 100, metadata: { source: 'excel-import' }, updatedAt: now },
      });
    }
    if (finish) {
      await tx.productFinish.upsert({
        where: { name: finish },
        update: { status: 'active', updatedAt: now },
        create: { id: ulid(), name: finish, code: code(finish), description: 'Created from Excel import', status: 'active', sortOrder: 100, metadata: { source: 'excel-import' }, updatedAt: now },
      });
    }
  }

  private normalizeHeader(value: string) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  private normalizeSku(value: any) {
    return String(value || '').trim().replace(/\s+/g, '').toUpperCase();
  }

  private cleanText(value: any) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  private money(value: any) {
    if (value === undefined || value === null || value === '') return 0;
    const cleaned = String(value).replace(/[^0-9.-]+/g, '');
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private key(value: string) {
    return String(value || '').trim().toLowerCase();
  }

  private async extractWorksheetImages(workbook: any, worksheet: any, headerRowNumber: number, persist: boolean) {
    const byRow = new Map<number, string>();
    const images = typeof worksheet.getImages === 'function' ? worksheet.getImages() : [];
    if (!images?.length) return byRow;

    const root = process.env.CATALOGUE_IMAGE_STORAGE_DIR || path.resolve(process.cwd(), '../../apps/web/public/catalogue-images');
    const directory = path.join(root, 'manual');
    if (persist) fs.mkdirSync(directory, { recursive: true });
    const publicBase = String(process.env.PUBLIC_CATALOGUE_IMAGE_BASE_URL || '').replace(/\/+$/, '');

    for (const image of images) {
      const topRow = Number(image.range?.tl?.nativeRow ?? image.range?.tl?.row ?? headerRowNumber) + 1;
      const rowNumber = Math.max(headerRowNumber + 1, topRow);
      if (!persist) {
        byRow.set(rowNumber, '__embedded_excel_image__');
        continue;
      }
      const workbookImage = typeof workbook.getImage === 'function' ? workbook.getImage(image.imageId) : null;
      const buffer = workbookImage?.buffer;
      if (!buffer) continue;
      const extension = String(workbookImage.extension || 'png').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png';
      const fileName = `${ulid()}.${extension}`;
      fs.writeFileSync(path.join(directory, fileName), buffer);
      byRow.set(rowNumber, `${publicBase}/catalogue-images/manual/${fileName}`);
    }

    return byRow;
  }

  private async audit(actorUserId: string, action: string, entityType: string, entityId: string, summary: string, metadata: any) {
    await this.prisma.auditEvent.create({
      data: {
        id: ulid(),
        actorUserId,
        action,
        entityType,
        entityId,
        summary,
        metadata,
      },
    }).catch(() => null);
  }
}
