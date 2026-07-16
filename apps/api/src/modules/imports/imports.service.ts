import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ulid } from 'ulid';
import * as fs from 'fs';
import * as path from 'path';

type ImportMode = 'preview' | 'apply';

type NormalizedProductRow = {
  sku: string;
  internalCode: string;
  hasInternalCode: boolean;
  name: string;
  category: string;
  brand: string;
  finish: string;
  material: string;
  dimensions: string;
  unit: string;
  baseUom: string;
  purchaseUom: string;
  salesUom: string;
  piecesPerPack: number;
  coveragePerPack: number;
  hsnCode: string;
  taxClass: string;
  sellPrice: number;
  floorPrice: number;
  hasBrand: boolean;
  hasFinish: boolean;
  hasDimensions: boolean;
  hasUnit: boolean;
  hasSellPrice: boolean;
  hasFloorPrice: boolean;
  hasDescription: boolean;
  description: string;
  range: string;
  imageUrl: string;
};

@Injectable()
export class ImportsService {
  constructor(private prisma: PrismaService) {}

  async productImportTemplate() {
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Product Master');
    const headers = ['SKU', 'Internal Code', 'Product Name', 'Category', 'Brand', 'Finish', 'Material', 'Size', 'Base UOM', 'Purchase UOM', 'Sales UOM', 'Pieces Per Pack', 'Coverage Per Pack', 'Sell Price', 'Floor Price', 'Tax Code', 'HSN Code', 'Image URL', 'Description'];
    sheet.addRow(headers);
    sheet.addRow(['TIL-6001200-001', 'A-1042', 'Statuario Pearl 600 x 1200', 'Tiles', 'Example Brand', 'Polished', 'Porcelain', '600 x 1200 mm', 'PC', 'BOX', 'SQFT', 2, 15.5, 125, 105, 'GST_18', '6907', 'https://example.com/tile.jpg', 'Replace this example row or delete it before import.']);
    sheet.addRow(['FAU-BASIN-001', 'F-201', 'Chrome Basin Mixer', 'Faucets', 'Example Brand', 'Chrome', 'Brass', 'Standard', 'PC', 'PC', 'PC', 1, 0, 8500, 7600, 'GST_18', '8481', 'https://example.com/faucet.jpg', 'Non-tile example.']);
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = { from: 'A1', to: 'S1' };
    sheet.columns.forEach((column: any) => { column.width = Math.min(34, Math.max(12, Number(column.header?.length || 12) + 3)); });
    const buffer = await workbook.xlsx.writeBuffer();
    return { filename: 'marble-park-product-master-template.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', contentBase64: Buffer.from(buffer).toString('base64'), headers };
  }

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
    const internalCodes = Array.from(new Set(parsed.map((row) => row.normalized.internalCode).filter(Boolean)));
    const [existingProducts, internalCodeOwners, categories, brands, finishes, uoms, taxCodes] = await Promise.all([
      skus.length ? this.prisma.product.findMany({ where: { sku: { in: skus } }, select: { id: true, sku: true, internalCode: true } }) : [],
      internalCodes.length ? this.prisma.product.findMany({ where: { internalCode: { in: internalCodes } }, select: { id: true, sku: true, internalCode: true } }) : [],
      this.prisma.productCategory.findMany({ select: { name: true } }),
      this.prisma.productBrand.findMany({ select: { name: true } }),
      this.prisma.productFinish.findMany({ select: { name: true } }),
      this.prisma.unitOfMeasure.findMany({ where: { status: 'active' }, select: { code: true } }),
      this.prisma.taxCode.findMany({ where: { status: 'active' }, select: { code: true } }),
    ]);

    const existingSku = new Map(existingProducts.map((product) => [product.sku, product.id] as const));
    const existingBySku = new Map(existingProducts.map((product) => [product.sku, product] as const));
    const internalCodeOwner = new Map((internalCodeOwners as Array<{ sku: string; internalCode: string | null }>).filter((product) => product.internalCode).map((product) => [product.internalCode as string, product.sku] as const));
    const validUoms = new Set(uoms.map((row) => row.code));
    const validTaxCodes = new Set(taxCodes.map((row) => row.code));
    const categoryNames = new Set(categories.map((row) => this.key(row.name)));
    const brandNames = new Set(brands.map((row) => this.key(row.name)));
    const finishNames = new Set(finishes.map((row) => this.key(row.name)));
    const missingCategories = new Set<string>();
    const missingBrands = new Set<string>();
    const missingFinishes = new Set<string>();
    const failures: any[] = [];
    const rows: any[] = [];
    const seen = new Set<string>();
    const seenInternalCodes = new Set<string>();

    parsed.forEach((row) => {
      const errors = [...row.errors];
      const existingProduct = existingBySku.get(row.normalized.sku);
      if (!row.normalized.hasInternalCode && existingProduct?.internalCode) row.normalized.internalCode = existingProduct.internalCode;
      if (row.normalized.sku) {
        if (seen.has(row.normalized.sku)) errors.push('Duplicate SKU in this Excel file');
        seen.add(row.normalized.sku);
      }
      if (row.normalized.internalCode) {
        if (seenInternalCodes.has(row.normalized.internalCode)) errors.push('Duplicate internal/showroom code in this Excel file');
        seenInternalCodes.add(row.normalized.internalCode);
        const ownerSku = internalCodeOwner.get(row.normalized.internalCode);
        if (ownerSku && ownerSku !== row.normalized.sku) errors.push(`Internal/showroom code is already assigned to ${ownerSku}`);
      }
      for (const uom of [row.normalized.baseUom, row.normalized.purchaseUom, row.normalized.salesUom]) {
        if (!validUoms.has(uom)) errors.push(`Unknown or inactive UOM ${uom}`);
      }
      if (!validTaxCodes.has(row.normalized.taxClass)) errors.push(`Unknown or inactive tax code ${row.normalized.taxClass}`);
      if (row.normalized.category && !categoryNames.has(this.key(row.normalized.category))) missingCategories.add(row.normalized.category);
      if (row.normalized.brand && !brandNames.has(this.key(row.normalized.brand))) missingBrands.add(row.normalized.brand);
      if (row.normalized.finish && !finishNames.has(this.key(row.normalized.finish))) missingFinishes.add(row.normalized.finish);

      const action = existingSku.has(row.normalized.sku) ? 'updated' : 'created';
      const preview = {
        sheet: row.raw.__sheet,
        rowNumber: row.raw.__rowNumber,
        sku: row.normalized.sku,
        internalCode: row.normalized.internalCode,
        name: row.normalized.name,
        category: row.normalized.category,
        brand: row.normalized.brand,
        finish: row.normalized.finish,
        unit: row.normalized.unit,
        purchaseUom: row.normalized.purchaseUom,
        salesUom: row.normalized.salesUom,
        piecesPerPack: row.normalized.piecesPerPack,
        coveragePerPack: row.normalized.coveragePerPack,
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
    if (!row.internalCode) errors.push('Internal/showroom code is required');
    if (!row.name) errors.push('Product name/description is required');
    if (!row.category) errors.push('Category is required');
    if (row.hasSellPrice && (!Number.isFinite(row.sellPrice) || row.sellPrice < 0)) errors.push('MRP/sell price must be zero or greater');
    if (row.hasFloorPrice && (!Number.isFinite(row.floorPrice) || row.floorPrice < 0)) errors.push('Floor/dealer price must be zero or greater');
    if (row.sellPrice > 0 && row.floorPrice > row.sellPrice) errors.push('Floor price cannot exceed sell price');
    if (!Number.isInteger(row.piecesPerPack) || row.piecesPerPack <= 0) errors.push('Pieces per pack must be a positive whole number');
    if (!Number.isFinite(row.coveragePerPack) || row.coveragePerPack < 0) errors.push('Coverage per pack must be zero or greater');
    if (['SQFT', 'SQM', 'M2'].includes(row.salesUom) && row.coveragePerPack <= 0) errors.push('Area-priced rows require positive coverage per pack');
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
    const brand = this.cleanText(pick('Brand', 'BRAND', 'Make', 'Company'));
    const finish = this.cleanText(pick('Finish', 'FINISH', 'Color', 'Colour', 'Surface', 'Shade'));
    const dimensions = this.cleanText(pick('Dimensions', 'DIMENSIONS', 'Size', 'SIZE', 'Tile Size'));
    const unit = pick('Unit', 'UOM', 'uom');
    const purchaseUom = String(pick('Purchase UOM', 'Purchase Unit', 'Inventory UOM', 'Stock UOM') || unit || 'PC').trim().toUpperCase();
    const salesUom = String(pick('Sales UOM', 'Rate UOM', 'Pricing UOM', 'Price Unit') || unit || 'PC').trim().toUpperCase();
    const baseUom = String(pick('Base UOM', 'Base Unit') || (purchaseUom === 'BOX' ? 'PC' : purchaseUom)).trim().toUpperCase();
    const sku = this.normalizeSku(pick('SKU', 'sku', 'Code', 'PRODUCT CODE', 'Product Code', 'Item Code', 'Article No', 'Article Number', 'Model No', 'Material Code'));
    const internalCode = pick('Internal Code', 'Showroom Code', 'Display Code', 'Sales Code', 'Internal SKU');
    const description = this.cleanText(pick('Long Description', 'Description', 'PRODUCT DESCRIPTION'));
    return {
      sku,
      internalCode: this.normalizeInternalCode(internalCode || sku),
      hasInternalCode: internalCode !== undefined,
      name: this.cleanText(pick('Product Name', 'Item Name', 'Name', 'Product', 'PRODUCT DESCRIPTION', 'Item Description', 'Description')),
      category: this.cleanText(pick('Category', 'CATEGORY', 'Product Category', 'Group', 'Type')),
      brand,
      finish,
      material: this.cleanText(pick('Material', 'Body Material', 'Composition')),
      dimensions,
      unit: purchaseUom || 'PC',
      baseUom,
      purchaseUom,
      salesUom,
      piecesPerPack: this.wholeNumber(pick('Pieces Per Pack', 'Pieces/Box', 'PCS/BOX', 'Pcs Per Box', 'Pack Quantity'), 1),
      coveragePerPack: this.number(pick('Coverage Per Pack', 'Coverage/Box', 'SQFT/BOX', 'SQM/BOX', 'Box Coverage'), 0),
      hsnCode: this.cleanText(pick('HSN', 'HSN Code', 'HSN/SAC')),
      taxClass: this.normalizeTaxClass(pick('Tax Code', 'Tax Class', 'GST', 'GST Rate')),
      sellPrice: this.money(price),
      floorPrice: this.money(floorPrice),
      hasBrand: Boolean(brand),
      hasFinish: Boolean(finish),
      hasDimensions: Boolean(dimensions),
      hasUnit: unit !== undefined,
      hasSellPrice: price !== undefined,
      hasFloorPrice: floorPrice !== undefined,
      hasDescription: Boolean(description),
      description,
      range: this.cleanText(pick('Range', 'RANGE', 'Series', 'Collection')) || '',
      imageUrl: this.cleanText(pick('__embeddedImageUrl', 'Image', 'Image URL', 'Photo', 'Photo URL', 'Media', 'Picture URL')) || '',
    };
  }

  private async applyProductRowTx(tx: any, normalized: NormalizedProductRow, uploadedBy: string): Promise<any> {
    const { sku, name, category, brand, finish, dimensions, unit, sellPrice } = normalized;
    const masters = await this.ensureProductMastersTx(tx, normalized);
    const media = normalized.imageUrl && normalized.imageUrl !== '__embedded_excel_image__'
      ? { primary: normalized.imageUrl, gallery: [normalized.imageUrl], source: 'excel-import', exactSkuMatch: true }
      : undefined;
    const existing = await tx.product.findUnique({ where: { sku } });
    if (existing) {
      const existingMedia: any = existing.media || {};
      const mergedMedia = media
        ? { ...existingMedia, ...media, gallery: Array.from(new Set([...(existingMedia.gallery || []), ...(media.gallery || [])])) }
        : existingMedia;
      const updateData: any = {
          name,
          category,
          categoryId: masters.category?.id || null,
          brandId: masters.brand?.id || null,
          finishId: masters.finish?.id || null,
          materialId: masters.material?.id || null,
          tileSizeId: masters.tileSize?.id || null,
          unit: normalized.purchaseUom,
          baseUom: normalized.baseUom,
          purchaseUom: normalized.purchaseUom,
          salesUom: normalized.salesUom,
          piecesPerPack: normalized.piecesPerPack,
          coveragePerPack: normalized.coveragePerPack,
          hsnCode: normalized.hsnCode || null,
          taxClass: normalized.taxClass,
          trackLots: true,
          media: mergedMedia,
          sourceRefs: { ...((existing.sourceRefs as any) || {}), lastExcelImportBy: uploadedBy, lastExcelImportAt: new Date().toISOString(), range: normalized.range },
          status: 'active',
          updatedAt: new Date(),
      };
      if (normalized.hasInternalCode || !existing.internalCode) updateData.internalCode = normalized.internalCode;
      if (normalized.hasBrand) updateData.brand = brand;
      if (normalized.hasFinish) updateData.finish = finish;
      if (normalized.hasDimensions) updateData.dimensions = dimensions;
      if (normalized.hasUnit) updateData.unit = unit;
      if (normalized.hasSellPrice) updateData.sellPrice = sellPrice;
      if (normalized.hasFloorPrice) updateData.floorPrice = normalized.floorPrice;
      if (normalized.hasDescription) updateData.description = normalized.description;
      const product = await tx.product.update({ where: { sku }, data: updateData });
      await this.ensureInternalAliasTx(tx, product.id, product.internalCode || normalized.internalCode);
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
        internalCode: normalized.internalCode,
        categoryId: masters.category?.id || null,
        brandId: masters.brand?.id || null,
        finishId: masters.finish?.id || null,
        materialId: masters.material?.id || null,
        tileSizeId: masters.tileSize?.id || null,
        unit: normalized.purchaseUom,
        baseUom: normalized.baseUom,
        purchaseUom: normalized.purchaseUom,
        salesUom: normalized.salesUom,
        piecesPerPack: normalized.piecesPerPack,
        coveragePerPack: normalized.coveragePerPack,
        hsnCode: normalized.hsnCode || null,
        trackLots: true,
        allowLoose: false,
        tags: [],
        sellPrice,
        floorPrice: normalized.floorPrice,
        taxClass: normalized.taxClass,
        status: 'active',
        media: media || {},
        sourceRefs: { createdFrom: 'excel-import', uploadedBy, range: normalized.range },
        description: normalized.description,
        updatedAt: new Date(),
      } as any,
    });
    await this.ensureInternalAliasTx(tx, product.id, normalized.internalCode);
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

  private async ensureInternalAliasTx(tx: any, productId: string, internalCode: string) {
    await tx.productAlias.upsert({
      where: { type_normalizedValue: { type: 'internal_code', normalizedValue: internalCode } },
      update: { productId, value: internalCode, status: 'active', isPrimary: true, updatedAt: new Date() },
      create: { id: ulid(), productId, type: 'internal_code', value: internalCode, normalizedValue: internalCode, status: 'active', isPrimary: true, metadata: { source: 'excel-import' }, updatedAt: new Date() },
    });
  }

  private async ensureProductMastersTx(tx: any, normalized: NormalizedProductRow) {
    const { category, brand, finish, material, dimensions, purchaseUom, piecesPerPack } = normalized;
    const now = new Date();
    const code = (value: string) => String(value || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32) || 'MASTER';
    let categoryRow: any = null;
    let brandRow: any = null;
    let finishRow: any = null;
    let materialRow: any = null;
    let tileSizeRow: any = null;
    if (category) {
      categoryRow = await tx.productCategory.upsert({
        where: { name: category },
        update: { status: 'active', updatedAt: now },
        create: { id: ulid(), name: category, code: code(category), description: 'Created from Excel import', status: 'active', sortOrder: 100, metadata: { source: 'excel-import' }, updatedAt: now },
      });
    }
    if (brand) {
      brandRow = await tx.productBrand.upsert({
        where: { name: brand },
        update: { status: 'active', updatedAt: now },
        create: { id: ulid(), name: brand, code: code(brand), description: 'Created from Excel import', status: 'active', sortOrder: 100, metadata: { source: 'excel-import' }, updatedAt: now },
      });
    }
    if (finish) {
      finishRow = await tx.productFinish.upsert({
        where: { name: finish },
        update: { status: 'active', updatedAt: now },
        create: { id: ulid(), name: finish, code: code(finish), description: 'Created from Excel import', status: 'active', sortOrder: 100, metadata: { source: 'excel-import' }, updatedAt: now },
      });
    }
    if (material) {
      materialRow = await tx.productMaterial.upsert({
        where: { name: material },
        update: { status: 'active', updatedAt: now },
        create: { id: ulid(), name: material, code: code(material), description: 'Created from Excel import', status: 'active', sortOrder: 100, metadata: { source: 'excel-import' }, updatedAt: now },
      });
    }
    if (category.toLowerCase() === 'tiles' && dimensions) {
      tileSizeRow = await tx.tileSize.upsert({
        where: { name: dimensions },
        update: { status: 'active', uom: purchaseUom, pcsPerBox: piecesPerPack, updatedAt: now },
        create: { id: ulid(), name: dimensions, code: code(dimensions), uom: purchaseUom, pcsPerBox: piecesPerPack, description: 'Created from Excel import', status: 'active', sortOrder: 100, metadata: { source: 'excel-import' }, updatedAt: now },
      });
    }
    return { category: categoryRow, brand: brandRow, finish: finishRow, material: materialRow, tileSize: tileSizeRow };
  }

  private normalizeHeader(value: string) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  private normalizeSku(value: any) {
    return String(value || '').trim().replace(/\s+/g, '').toUpperCase();
  }

  private normalizeInternalCode(value: any) {
    return String(value || '').trim().toUpperCase().replace(/\s+/g, '-').replace(/[^A-Z0-9._/-]+/g, '').slice(0, 80);
  }

  private wholeNumber(value: any, fallback: number) {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number(String(value).replace(/[^0-9.-]+/g, ''));
    return Number.isFinite(parsed) ? Math.trunc(parsed) : Number.NaN;
  }

  private number(value: any, fallback: number) {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number(String(value).replace(/[^0-9.-]+/g, ''));
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }

  private normalizeTaxClass(value: any) {
    const raw = String(value ?? '').trim().toUpperCase();
    if (!raw) return 'GST_18';
    if (/^GST_\d+(\.\d+)?$/.test(raw)) return raw;
    const rate = Number(raw.replace(/[^0-9.]+/g, ''));
    return Number.isFinite(rate) ? `GST_${rate}` : raw;
  }

  private cleanText(value: any) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  private money(value: any) {
    if (value === undefined || value === null || value === '') return 0;
    const cleaned = String(value).replace(/[^0-9.-]+/g, '');
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
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
