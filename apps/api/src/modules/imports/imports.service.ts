import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ulid } from 'ulid';
import * as fs from 'fs';
import * as path from 'path';
import { createHmac } from 'crypto';
import { StoredImageService } from '../assets/stored-image.service';

type ImportMode = 'preview' | 'apply';

type NormalizedProductRow = {
  sku: string;
  internalCode: string;
  hasInternalCode: boolean;
  designCode: string;
  hasDesignCode: boolean;
  designName: string;
  hasDesignName: boolean;
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
  defaultMrpInclusive: number;
  defaultNrpInclusive: number;
  floorPriceInclusive: number;
  priceRateBasis: string;
  priceUom: string;
  mrpSource: string;
  pricingEffectiveFrom: string;
  hasBrand: boolean;
  hasFinish: boolean;
  hasDimensions: boolean;
  hasUnit: boolean;
  hasDefaultMrpInclusive: boolean;
  hasDefaultNrpInclusive: boolean;
  hasFloorPriceInclusive: boolean;
  hasPriceRateBasis: boolean;
  hasPriceUom: boolean;
  hasMrpSource: boolean;
  hasPricingEffectiveFrom: boolean;
  hasDescription: boolean;
  description: string;
  range: string;
  imageUrl: string;
  allowLoose: boolean;
  hasBaseUom: boolean;
  hasPurchaseUom: boolean;
  hasSalesUom: boolean;
  hasPiecesPerPack: boolean;
  hasCoveragePerPack: boolean;
  hasTaxClass: boolean;
  hasAllowLoose: boolean;
};

type ProductImportReviewRow = {
  sheet: string;
  rowNumber: number;
  sku?: unknown;
  internalCode?: unknown;
  name?: unknown;
  category?: unknown;
  brand?: unknown;
  finish?: unknown;
  material?: unknown;
  dimensions?: unknown;
  baseUom?: unknown;
  purchaseUom?: unknown;
  salesUom?: unknown;
  piecesPerPack?: unknown;
  coveragePerPack?: unknown;
  defaultMrpInclusive?: unknown;
  defaultNrpInclusive?: unknown;
  floorPriceInclusive?: unknown;
  priceRateBasis?: unknown;
  priceUom?: unknown;
  mrpSource?: unknown;
  pricingEffectiveFrom?: unknown;
  taxClass?: unknown;
  hsnCode?: unknown;
  allowLoose?: unknown;
  range?: unknown;
  imageUrl?: unknown;
  description?: unknown;
  designCode?: unknown;
  designName?: unknown;
};

const PRODUCT_IMPORT_HEADERS = [
  'SKU', 'Internal Code', 'Product Name', 'Category', 'Brand', 'Finish', 'Material', 'Tile Size / Dimensions',
  'Base UOM', 'Purchase UOM', 'Sales UOM', 'Pieces Per Pack', 'Coverage Per Pack', 'Default MRP Incl GST', 'Default NRP Incl GST', 'Floor Price Incl GST',
  'Price Basis', 'Price UOM', 'MRP Source', 'Pricing Effective From', 'Tax Code', 'HSN Code', 'Allow Loose', 'Range / Series', 'Image URL', 'Product Image', 'Description',
  'Tile Design Code', 'Tile Design Name',
];
const PRODUCT_IMPORT_DISPLAY_HEADERS = PRODUCT_IMPORT_HEADERS.map((header) =>
  ['SKU', 'Internal Code', 'Product Name', 'Category', 'Brand', 'Finish', 'Default MRP Incl GST', 'Price Basis', 'Price UOM', 'MRP Source', 'Pricing Effective From', 'Tax Code'].includes(header)
    ? `${header} *`
    : `${header} (Optional)`,
);
const MAX_IMPORT_ROWS = 5000;
const MAX_EMBEDDED_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_EMBEDDED_IMAGE_TOTAL_BYTES = 20 * 1024 * 1024;

@Injectable()
export class ImportsService {
  constructor(private prisma: PrismaService, private storedImages: StoredImageService) {}

  async productImportReadiness() {
    const masters = await this.masterSnapshot();
    const checks = [
      { key: 'categories', label: 'Categories', count: masters.categories.length, required: true, route: '/dashboard/master-data/categories' },
      { key: 'brands', label: 'Brands', count: masters.brands.length, required: true, route: '/dashboard/master-data/brands' },
      { key: 'finishes', label: 'Finishes', count: masters.finishes.length, required: true, route: '/dashboard/master-data/finishes' },
      { key: 'materials', label: 'Materials', count: masters.materials.length, required: false, route: '/dashboard/master-data' },
      { key: 'tileSizes', label: 'Tile sizes', count: masters.tileSizes.length, required: false, route: '/dashboard/master-data/tiles' },
      { key: 'uoms', label: 'Units of measure', count: masters.uoms.length, required: true, route: '/dashboard/master-data' },
      { key: 'taxCodes', label: 'Tax codes', count: masters.taxCodes.length, required: true, route: '/dashboard/master-data' },
    ];
    const blockers = checks.filter((check) => check.required && check.count === 0);
    return {
      ready: blockers.length === 0,
      message: blockers.length
        ? `Complete ${blockers.map((row) => row.label).join(', ')} before downloading or importing Product Master SKUs.`
        : 'Master data is ready. Download a fresh workbook before each bulk import.',
      checks,
      blockers,
      counts: Object.fromEntries(checks.map((check) => [check.key, check.count])),
      options: {
        categories: masters.categories.map((row) => row.name),
        brands: masters.brands.map((row) => row.name),
        finishes: masters.finishes.map((row) => row.name),
        materials: masters.materials.map((row) => row.name),
        tileSizes: masters.tileSizes.map((row) => row.name),
        uoms: masters.uoms.map((row) => row.code),
        taxCodes: masters.taxCodes.map((row) => row.code),
      },
      generatedAt: new Date().toISOString(),
    };
  }

  async productImportTemplate() {
    const ExcelJS = require('exceljs');
    const readiness = await this.productImportReadiness();
    if (!readiness.ready) throw new BadRequestException(readiness.message);
    const { categories, brands, finishes, materials, tileSizes, uoms, taxCodes } = await this.masterSnapshot();
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Marble Park Retail OS';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('Product Master');
    sheet.addRow(PRODUCT_IMPORT_DISPLAY_HEADERS);
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).height = 32;
    sheet.getRow(1).alignment = { vertical: 'middle', wrapText: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = { from: 'A1', to: 'AC1' };
    const widths = [18, 18, 32, 20, 20, 18, 20, 24, 13, 15, 13, 15, 18, 14, 14, 14, 20, 14, 13, 18, 20, 18, 18, 38, 22, 24, 30, 20, 24];
    sheet.columns.forEach((column: any, index: number) => { column.width = widths[index] || 18; });
    sheet.getColumn(1).numFmt = '@';
    sheet.getColumn(2).numFmt = '@';
    sheet.getColumn(14).numFmt = '[$₹-en-IN]#,##0.00';
    sheet.getColumn(15).numFmt = '[$₹-en-IN]#,##0.00';
    sheet.getColumn(16).numFmt = '[$₹-en-IN]#,##0.00';
    sheet.getColumn(22).alignment = { wrapText: true };
    sheet.getColumn(24).alignment = { wrapText: true };
    PRODUCT_IMPORT_HEADERS.forEach((header, index) => {
      const required = !PRODUCT_IMPORT_DISPLAY_HEADERS[index].includes('(Optional)');
      const cell = sheet.getCell(1, index + 1);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: required ? 'FF9F2520' : 'FF52525B' } };
      cell.note = required
        ? `${header} is required for every imported SKU.`
        : `${header} is optional. Leave it blank and the system will use a safe default where needed.`;
    });

    const instructions = workbook.addWorksheet('How to use');
    instructions.views = [{ showGridLines: false }];
    instructions.mergeCells('A1:F2');
    instructions.getCell('A1').value = 'Marble Park Product Master bulk import';
    instructions.getCell('A1').font = { size: 20, bold: true, color: { argb: 'FFFFFFFF' } };
    instructions.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF9F2520' } };
    instructions.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left' };
    const instructionRows = [
      ['1', 'Use the Product Master tab', 'Enter one new saleable design/SKU per row. Do not rename the sheet or headers.'],
      ['2', 'Read the column labels', 'A red header with * is required. Every SKU needs a positive MRP and governed price basis/UOM/source/effective date. NRP and floor price are optional.'],
      ['3', 'Choose governed values', 'Dropdowns come from live master data at download time. Category, brand, finish and tax are required. Tile rows also require Tile Design Code and must use AREA / SQFT pricing.'],
      ['4', 'Add a product image', 'Optional: paste a public HTTPS image URL or use Excel Insert > Pictures > Place over cells. Keep one JPG/PNG/WebP picture inside the Product Image cell on that row. Do not use Place in Cell.'],
      ['5', 'Preview before creation', 'Upload the workbook in Excel Import Center. Nothing is written until every row passes and you explicitly confirm.'],
      ['6', 'Existing SKUs are protected', 'Bulk import creates new SKUs only. Edit existing products individually in Product Master; the SKU code itself remains locked.'],
      ['7', 'Stock starts at zero', 'This creates Product Master records, not inventory. Record opening stock or a GRN afterward to create physical lots and QR labels.'],
    ];
    instructions.addRow([]);
    instructions.addRow(['Step', 'Action', 'Rule']);
    instructionRows.forEach((row) => instructions.addRow(row));
    instructions.getRow(4).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    instructions.getRow(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF242424' } };
    instructions.columns = [{ width: 10 }, { width: 28 }, { width: 88 }, { width: 2 }, { width: 2 }, { width: 2 }];
    instructions.getRows(5, instructionRows.length)?.forEach((row: any) => { row.height = 42; row.alignment = { vertical: 'middle', wrapText: true }; });

    const lists = workbook.addWorksheet('Live Master Lists');
    lists.views = [{ state: 'frozen', ySplit: 1 }];
    const listColumns = [
      ['Categories', categories.map((row) => row.name)], ['Brands', brands.map((row) => row.name)],
      ['Finishes', finishes.map((row) => row.name)], ['Materials', materials.map((row) => row.name)],
      ['TileSizes', tileSizes.map((row) => row.name)], ['UOMs', uoms.map((row) => row.code)],
      ['TaxCodes', taxCodes.map((row) => row.code)], ['YesNo', ['No', 'Yes']],
      ['PriceBasis', ['PIECE', 'BOX', 'AREA']], ['MrpSources', ['MANUAL', 'PACKAGE', 'BRAND_LIST']],
    ] as Array<[string, string[]]>;
    listColumns.forEach(([name, values], index) => {
      const column = index + 1;
      lists.getCell(1, column).value = name.replace(/([a-z])([A-Z])/g, '$1 $2');
      values.forEach((value, valueIndex) => { lists.getCell(valueIndex + 2, column).value = value; });
      const endRow = Math.max(2, values.length + 1);
      workbook.definedNames.add(`'Live Master Lists'!$${lists.getColumn(column).letter}$2:$${lists.getColumn(column).letter}$${endRow}`, name);
      lists.getColumn(column).width = Math.min(34, Math.max(16, ...values.slice(0, 100).map((value) => value.length + 2)));
    });
    lists.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    lists.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF242424' } };
    lists.autoFilter = { from: 'A1', to: 'J1' };

    const validationByColumn: Record<number, { name: string; allowBlank: boolean }> = {
      4: { name: 'Categories', allowBlank: false }, 5: { name: 'Brands', allowBlank: false },
      6: { name: 'Finishes', allowBlank: false }, 7: { name: 'Materials', allowBlank: true },
      8: { name: 'TileSizes', allowBlank: true }, 9: { name: 'UOMs', allowBlank: true },
      10: { name: 'UOMs', allowBlank: true }, 11: { name: 'UOMs', allowBlank: true },
      17: { name: 'PriceBasis', allowBlank: false }, 18: { name: 'UOMs', allowBlank: false }, 19: { name: 'MrpSources', allowBlank: false },
      21: { name: 'TaxCodes', allowBlank: false }, 23: { name: 'YesNo', allowBlank: true },
    };
    for (let rowNumber = 2; rowNumber <= MAX_IMPORT_ROWS + 1; rowNumber += 1) {
      Object.entries(validationByColumn).forEach(([column, config]) => {
        sheet.getCell(rowNumber, Number(column)).dataValidation = {
          type: 'list', allowBlank: config.allowBlank, formulae: [config.name], showErrorMessage: true,
          errorStyle: 'error', errorTitle: 'Choose a live master value', error: 'Use the dropdown. Download a fresh template after master data changes.',
        };
      });
      sheet.getCell(rowNumber, 12).dataValidation = { type: 'whole', operator: 'greaterThanOrEqual', formulae: [1], allowBlank: true, showErrorMessage: true, error: 'When entered, pieces per pack must be at least 1.' };
      sheet.getCell(rowNumber, 14).dataValidation = { type: 'decimal', operator: 'greaterThan', formulae: [0], allowBlank: false, showErrorMessage: true, error: 'MRP is required and must be greater than zero.' };
      for (const column of [13, 15, 16]) sheet.getCell(rowNumber, column).dataValidation = { type: 'decimal', operator: 'greaterThanOrEqual', formulae: [0], allowBlank: true, showErrorMessage: true, error: 'When entered, use zero or a positive number.' };
    }

    const reference = workbook.addWorksheet('Reference details');
    reference.addRow(['Master', 'Code', 'Name', 'Details']);
    categories.forEach((row) => reference.addRow(['Category', row.code || '', row.name, '']));
    brands.forEach((row) => reference.addRow(['Brand', row.code || '', row.name, '']));
    finishes.forEach((row) => reference.addRow(['Finish', row.code || '', row.name, '']));
    materials.forEach((row) => reference.addRow(['Material', row.code || '', row.name, '']));
    tileSizes.forEach((row) => reference.addRow(['Tile size', row.code || '', row.name, `${row.pcsPerBox || 0} pc / ${row.uom || 'BOX'}`]));
    uoms.forEach((row) => reference.addRow(['UOM', row.code, row.name, row.dimension]));
    taxCodes.forEach((row) => reference.addRow(['Tax', row.code, row.name, `${row.rate}%${row.hsnCode ? ` · HSN ${row.hsnCode}` : ''}`]));
    reference.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    reference.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF242424' } };
    reference.views = [{ state: 'frozen', ySplit: 1 }];
    reference.autoFilter = { from: 'A1', to: 'D1' };
    reference.columns = [{ width: 16 }, { width: 18 }, { width: 34 }, { width: 34 }];

    sheet.getCell('A2').note = 'Required. New immutable SKU code. Existing SKU codes are blocked.';
    sheet.getCell('Z2').note = 'Optional. Use Insert > Pictures > Place over cells (not Place in Cell). Keep one JPG, PNG or WebP image with its top-left corner inside this row.';
    const buffer = await workbook.xlsx.writeBuffer();
    return {
      filename: `marble-park-product-master-live-${new Date().toISOString().slice(0, 10)}.xlsx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', contentBase64: Buffer.from(buffer).toString('base64'),
      headers: PRODUCT_IMPORT_HEADERS, generatedAt: new Date().toISOString(),
      masterCounts: readiness.counts,
      readiness,
    };
  }

  async previewExcelImport(filePath: string, uploadedBy = 'system', reviewRows: ProductImportReviewRow[] = []): Promise<any> {
    this.assertExcelFile(filePath);
    const { rows } = await this.readExcelRows(filePath, 'preview', reviewRows);
    const plan = await this.buildImportPlan(rows);
    const confirmationToken = plan.failed || !plan.total ? null : this.confirmationToken(filePath, uploadedBy, plan);
    await this.writePreviewSnapshot(filePath, uploadedBy, reviewRows, plan, confirmationToken);
    await this.audit(uploadedBy, 'excel_import.preview', 'Product', 'excel-preview', `Excel import preview: ${plan.ready} ready, ${plan.failed} failed`, { filePath, ...this.auditPlan(plan) });
    return {
      source: 'excel-preview',
      status: !plan.total ? 'empty' : plan.failed ? 'needs_correction' : 'ready_to_apply',
      applyMode: 'all_or_nothing',
      reviewMode: 'server_validated_editable',
      confirmationToken,
      message: !plan.total
        ? 'No populated Product Master rows were found. Add at least one SKU and upload the workbook again.'
        : plan.failed
          ? 'Fix failed rows before applying. Nothing has been written to Product Master.'
          : 'Preview is clean. Confirm to create these new SKUs with zero opening stock in one transaction.',
      ...this.publicPlan(plan),
    };
  }

  async processExcelImport(filePath: string, uploadedBy = 'system', confirmationToken = '', reviewRows: ProductImportReviewRow[] = []): Promise<any> {
    this.assertExcelFile(filePath);
    const snapshot = await this.readPreviewSnapshot(filePath);
    const canonicalReview = this.canonicalReviewRows(reviewRows);
    const snapshotReview = Array.isArray(snapshot?.reviewRows) ? snapshot.reviewRows : [];
    const snapshotStillMatchesFile = snapshot?.plan ? this.confirmationToken(filePath, uploadedBy, snapshot.plan) : '';
    if (!snapshot || snapshot.uploadedBy !== uploadedBy || !confirmationToken || confirmationToken !== snapshot.confirmationToken || confirmationToken !== snapshotStillMatchesFile || JSON.stringify(canonicalReview) !== JSON.stringify(snapshotReview)) {
      throw new BadRequestException('This workbook or its reviewed rows have changed since validation. Revalidate the review and confirm again.');
    }

    if (snapshot.plan.failed || !snapshot.plan.total) {
      await this.audit(uploadedBy, 'excel_import.blocked', 'Product', 'excel-apply-blocked', `Excel import blocked: ${snapshot.plan.failed} invalid row(s)`, { filePath, ...this.auditPlan(snapshot.plan) });
      return {
        source: 'excel-apply',
        status: 'blocked_by_validation',
        message: snapshot.plan.total ? 'Import was not applied. Product Master changed or the file now has invalid rows; preview it again.' : 'Import was not applied because no product rows were found.',
        ...this.publicPlan(snapshot.plan),
        applied: 0,
        created: 0,
        updated: 0,
        products: [],
      };
    }

    const applyRead = await this.readExcelRows(filePath, 'apply', reviewRows);
    const plan = await this.buildImportPlan(applyRead.rows);
    if (plan.failed) {
      this.removeFiles(applyRead.persistedFiles);
      return { source: 'excel-apply', status: 'blocked_by_validation', message: 'Import was not applied because validation changed. Preview the file again.', ...this.publicPlan(plan), applied: 0, created: 0, updated: 0, products: [] };
    }

    let appliedProducts: any[] = [];
    try {
      await this.persistExternalProductImages(plan.rows);
      appliedProducts = await this.prisma.$transaction(async (tx) => {
        const rows = plan.rows.map((row: any) => ({ id: ulid(), sku: row.normalized.sku, action: row.action, normalized: row.normalized }));
        const tileRows = rows.filter((row: any) => this.key(row.normalized.category) === 'tiles');
        const designCodes = Array.from(new Set(tileRows.map((row: any) => row.normalized.designCode)));
        const existingDesigns = designCodes.length
          ? await tx.tileDesign.findMany({ where: { designCode: { in: designCodes } }, select: { id: true, designCode: true } })
          : [];
        const designIds = new Map(existingDesigns.map((row: any) => [row.designCode, row.id]));
        for (const row of tileRows) {
          if (!designIds.has(row.normalized.designCode)) {
            const design = await tx.tileDesign.create({ data: this.tileDesignCreateData(row.normalized, uploadedBy) });
            designIds.set(design.designCode, design.id);
          }
          row.normalized.masterIds = { ...row.normalized.masterIds, tileDesignId: designIds.get(row.normalized.designCode) };
        }
        for (let offset = 0; offset < rows.length; offset += 400) {
          const batch = rows.slice(offset, offset + 400);
          await tx.product.createMany({ data: batch.map((row: any) => this.productCreateData(row.id, row.normalized, uploadedBy)) });
          await tx.productAlias.createMany({ data: batch.map((row: any) => ({ id: ulid(), productId: row.id, type: 'internal_code', value: row.normalized.internalCode, normalizedValue: row.normalized.internalCode, status: 'active', isPrimary: true, metadata: { source: 'excel-import' }, updatedAt: new Date() })) });
          await tx.inventoryBalance.createMany({ data: batch.map((row: any) => ({ id: ulid(), productId: row.id, onHand: 0, available: 0, reserved: 0, damaged: 0, hold: 0, updatedAt: new Date() })) });
        }
        return rows.map(({ id, sku, action }: any) => ({ id, sku, action }));
      }, { timeout: 60000 });
    } catch (error) {
      this.removeFiles(applyRead.persistedFiles);
      throw error;
    }

    const created = plan.rows.filter((row) => row.action === 'created').length;
    await this.audit(uploadedBy, 'excel_import.apply', 'Product', 'excel-transaction-import', `Excel import applied: ${created} created, 0 failed`, { filePath, total: plan.total, created, updated: 0, failed: 0 });
    await fs.promises.rm(this.previewSnapshotPath(filePath), { force: true });

    return {
      source: 'excel-apply',
      status: 'applied',
      total: plan.total,
      applied: appliedProducts.length,
      created,
      updated: 0,
      failed: 0,
      imageCount: plan.imageCount,
      failures: [],
      masterGaps: plan.masterGaps,
      products: appliedProducts.slice(0, 120),
      message: 'New Product Master SKUs were created with zero opening stock. Use Opening Stock or GRN to create physical inventory and labels.',
    };
  }

  private assertExcelFile(filePath: string) {
    if (!/\.xlsx$/i.test(filePath || '')) {
      throw new BadRequestException('Only .xlsx catalogue imports are supported. PDF extraction has been removed because vendor catalogues are not reliable enough for automated SKU creation.');
    }
  }

  private async persistExternalProductImages(rows: any[]) {
    const candidates = rows.filter((row: any) => /^https:\/\//i.test(String(row.normalized?.imageUrl || '')));
    const concurrency = 8;
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, candidates.length) }, async () => {
      for (;;) {
        const index = cursor++;
        if (index >= candidates.length) return;
        const row = candidates[index];
        try {
          row.normalized.imageUrl = await this.storedImages.persistRemoteImage(row.normalized.imageUrl);
        } catch (error: any) {
          throw new BadRequestException(`SKU ${row.normalized.sku}: ${error?.message || 'product image could not be stored'}`);
        }
      }
    });
    await Promise.all(workers);
  }

  private async readExcelRows(filePath: string, mode: ImportMode, reviewRows: ProductImportReviewRow[] = []) {
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const allRows: any[] = [];
    const persistedFiles: string[] = [];
    for (const worksheet of workbook.worksheets) {
      const headers = this.detectHeaders(worksheet);
      if (!this.isProductImportSheet(worksheet.name, headers)) continue;
      const embeddedImages = await this.extractWorksheetImages(workbook, worksheet, headers.headerRowNumber, mode === 'apply');
      persistedFiles.push(...embeddedImages.persistedFiles);
      worksheet.eachRow((row: any, rowNumber: number) => {
        if (rowNumber <= headers.headerRowNumber) return;
        const data: any = { __sheet: worksheet.name, __rowNumber: rowNumber };
        row.eachCell({ includeEmpty: true }, (cell: any, colNumber: number) => {
          const header = headers.byColumn[colNumber] || `Column ${colNumber}`;
          data[header] = this.cellValue(cell.value);
        });
        const embeddedImageUrl = embeddedImages.byRow.get(rowNumber);
        if (embeddedImageUrl) data.__embeddedImageUrl = embeddedImageUrl;
        const embeddedImageError = embeddedImages.errors.get(rowNumber);
        if (embeddedImageError) data.__embeddedImageError = embeddedImageError;
        const hasProductData = Object.entries(data).some(([key, value]) => !key.startsWith('__') && value !== undefined && value !== null && String(value).trim() !== '');
        if (hasProductData || embeddedImageUrl || embeddedImageError) {
          allRows.push(data);
        }
      });
    }
    if (allRows.length > MAX_IMPORT_ROWS) {
      this.removeFiles(persistedFiles);
      throw new BadRequestException(`A workbook can contain at most ${MAX_IMPORT_ROWS.toLocaleString('en-IN')} product rows.`);
    }
    return { rows: this.applyReviewRows(allRows, reviewRows), persistedFiles };
  }

  private applyReviewRows(rawRows: any[], reviewRows: ProductImportReviewRow[]) {
    const reviewed = this.canonicalReviewRows(reviewRows);
    if (!reviewed.length) return rawRows;
    const rawByIdentity = new Map(rawRows.map((row) => [`${row.__sheet}\0${row.__rowNumber}`, row]));
    const headerByField: Record<string, string> = {
      sku: 'SKU', internalCode: 'Internal Code', name: 'Product Name', category: 'Category', brand: 'Brand', finish: 'Finish',
      material: 'Material', dimensions: 'Tile Size / Dimensions', baseUom: 'Base UOM', purchaseUom: 'Purchase UOM', salesUom: 'Sales UOM',
      piecesPerPack: 'Pieces Per Pack', coveragePerPack: 'Coverage Per Pack', defaultMrpInclusive: 'Default MRP Incl GST', defaultNrpInclusive: 'Default NRP Incl GST', floorPriceInclusive: 'Floor Price Incl GST', priceRateBasis: 'Price Basis', priceUom: 'Price UOM', mrpSource: 'MRP Source', pricingEffectiveFrom: 'Pricing Effective From',
      taxClass: 'Tax Code', hsnCode: 'HSN Code', allowLoose: 'Allow Loose', range: 'Range / Series', imageUrl: 'Image URL', description: 'Description', designCode: 'Tile Design Code', designName: 'Tile Design Name',
    };
    for (const review of reviewed) {
      const row = rawByIdentity.get(`${review.sheet}\0${review.rowNumber}`);
      if (!row) throw new BadRequestException(`Reviewed row ${review.sheet} #${review.rowNumber} is not present in the uploaded Product Master sheet.`);
      for (const [field, header] of Object.entries(headerByField)) {
        if (Object.prototype.hasOwnProperty.call(review, field)) row[header] = (review as any)[field];
      }
      row.__reviewed = true;
    }
    return rawRows;
  }

  private canonicalReviewRows(value: unknown): ProductImportReviewRow[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new BadRequestException('Reviewed import rows must be an array. Reopen the workbook preview and try again.');
    if (value.length > MAX_IMPORT_ROWS) throw new BadRequestException(`A review can contain at most ${MAX_IMPORT_ROWS.toLocaleString('en-IN')} rows.`);
    const allowed = new Set([
      'sku', 'internalCode', 'name', 'category', 'brand', 'finish', 'material', 'dimensions', 'baseUom', 'purchaseUom', 'salesUom',
      'piecesPerPack', 'coveragePerPack', 'defaultMrpInclusive', 'defaultNrpInclusive', 'floorPriceInclusive', 'priceRateBasis', 'priceUom', 'mrpSource', 'pricingEffectiveFrom', 'taxClass', 'hsnCode', 'allowLoose', 'range', 'imageUrl', 'description', 'designCode', 'designName',
    ]);
    const identities = new Set<string>();
    const rows = value.map((input: any) => {
      const sheet = String(input?.sheet || '').trim();
      const rowNumber = Number(input?.rowNumber);
      if (!sheet || !Number.isInteger(rowNumber) || rowNumber < 2) throw new BadRequestException('Each reviewed row must retain its source sheet and Excel row number.');
      const identity = `${sheet}\0${rowNumber}`;
      if (identities.has(identity)) throw new BadRequestException(`${sheet} row ${rowNumber} appears more than once in the review.`);
      identities.add(identity);
      const row: any = { sheet, rowNumber };
      for (const field of allowed) {
        if (!Object.prototype.hasOwnProperty.call(input, field)) continue;
        const fieldValue = input[field];
        if (fieldValue !== null && !['string', 'number', 'boolean'].includes(typeof fieldValue)) {
          throw new BadRequestException(`${sheet} row ${rowNumber} has an unsupported ${field} value.`);
        }
        row[field] = fieldValue ?? '';
      }
      return row as ProductImportReviewRow;
    });
    return rows.sort((left, right) => left.sheet.localeCompare(right.sheet) || left.rowNumber - right.rowNumber);
  }

  private async buildImportPlan(rawRows: any[]) {
    if (!rawRows.length) {
      return { total: 0, ready: 0, failed: 0, created: 0, updated: 0, failures: [], rows: [], previewRows: [], masterGaps: { categories: [], brands: [], finishes: [], materials: [], tileSizes: [] }, imageCount: 0 };
    }

    const parsed = rawRows.map((raw) => {
      const normalized = this.normalizeProductRow(raw);
      const errors = [...this.deprecatedPricingHeaderErrors(raw), ...this.validateNormalizedRow(normalized)];
      if (raw.__embeddedImageError) errors.push(raw.__embeddedImageError);
      return { raw, normalized, errors };
    });

    const skus = Array.from(new Set(parsed.map((row) => row.normalized.sku).filter(Boolean)));
    const internalCodes = Array.from(new Set(parsed.map((row) => row.normalized.internalCode).filter(Boolean)));
    const [existingProducts, internalCodeOwners, categories, brands, finishes, materials, tileSizes, uoms, taxCodes] = await Promise.all([
      skus.length ? this.prisma.product.findMany({ where: { sku: { in: skus } }, select: { id: true, sku: true, internalCode: true } }) : [],
      internalCodes.length ? this.prisma.product.findMany({ where: { internalCode: { in: internalCodes } }, select: { id: true, sku: true, internalCode: true } }) : [],
      this.prisma.productCategory.findMany({ where: { status: 'active' }, select: { id: true, name: true } }),
      this.prisma.productBrand.findMany({ where: { status: 'active' }, select: { id: true, name: true } }),
      this.prisma.productFinish.findMany({ where: { status: 'active' }, select: { id: true, name: true } }),
      this.prisma.productMaterial.findMany({ where: { status: 'active' }, select: { id: true, name: true } }),
      this.prisma.tileSize.findMany({ where: { status: 'active' }, select: { id: true, name: true } }),
      this.prisma.unitOfMeasure.findMany({ where: { status: 'active' }, select: { code: true } }),
      this.prisma.taxCode.findMany({ where: { status: 'active' }, select: { code: true } }),
    ]);

    const existingSku = new Map(existingProducts.map((product) => [product.sku, product.id] as const));
    const existingBySku = new Map(existingProducts.map((product) => [product.sku, product] as const));
    const internalCodeOwner = new Map((internalCodeOwners as Array<{ sku: string; internalCode: string | null }>).filter((product) => product.internalCode).map((product) => [product.internalCode as string, product.sku] as const));
    const validUoms = new Set(uoms.map((row) => row.code));
    const validTaxCodes = new Set(taxCodes.map((row) => row.code));
    const categoryNames = new Map<string, string>(categories.map((row) => [this.key(row.name), row.name]));
    const brandNames = new Map<string, string>(brands.map((row) => [this.key(row.name), row.name]));
    const finishNames = new Map<string, string>(finishes.map((row) => [this.key(row.name), row.name]));
    const materialNames = new Map<string, string>(materials.map((row) => [this.key(row.name), row.name]));
    const tileSizeNames = new Map<string, string>(tileSizes.map((row) => [this.key(row.name), row.name]));
    const categoryIds = new Map(categories.map((row) => [this.key(row.name), row.id] as const));
    const brandIds = new Map(brands.map((row) => [this.key(row.name), row.id] as const));
    const finishIds = new Map(finishes.map((row) => [this.key(row.name), row.id] as const));
    const materialIds = new Map(materials.map((row) => [this.key(row.name), row.id] as const));
    const tileSizeIds = new Map(tileSizes.map((row) => [this.key(row.name), row.id] as const));
    const missingCategories = new Set<string>();
    const missingBrands = new Set<string>();
    const missingFinishes = new Set<string>();
    const missingMaterials = new Set<string>();
    const missingTileSizes = new Set<string>();
    const failures: any[] = [];
    const rows: any[] = [];
    const seen = new Set<string>();
    const seenInternalCodes = new Set<string>();
    const seenTileDesigns = new Map<string, string>();

    parsed.forEach((row) => {
      const errors = [...row.errors];
      row.normalized.category = categoryNames.get(this.key(row.normalized.category)) || row.normalized.category;
      row.normalized.brand = brandNames.get(this.key(row.normalized.brand)) || row.normalized.brand;
      row.normalized.finish = finishNames.get(this.key(row.normalized.finish)) || row.normalized.finish;
      row.normalized.material = materialNames.get(this.key(row.normalized.material)) || row.normalized.material;
      row.normalized.dimensions = tileSizeNames.get(this.key(row.normalized.dimensions)) || row.normalized.dimensions;
      (row.normalized as any).masterIds = {
        categoryId: categoryIds.get(this.key(row.normalized.category)) || null,
        brandId: brandIds.get(this.key(row.normalized.brand)) || null,
        finishId: finishIds.get(this.key(row.normalized.finish)) || null,
        materialId: materialIds.get(this.key(row.normalized.material)) || null,
        tileSizeId: this.key(row.normalized.category) === 'tiles' ? tileSizeIds.get(this.key(row.normalized.dimensions)) || null : null,
      };
      const existingProduct = existingBySku.get(row.normalized.sku);
      if (existingProduct) errors.push('SKU already exists. Edit it individually in Product Master; bulk import creates new SKUs only');
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
      if (this.key(row.normalized.category) === 'tiles' && row.normalized.designCode) {
        const fingerprint = [row.normalized.designName, row.normalized.brand, row.normalized.material, row.normalized.range].map((value) => this.key(value)).join('|');
        const prior = seenTileDesigns.get(row.normalized.designCode);
        if (prior && prior !== fingerprint) errors.push(`Tile Design Code ${row.normalized.designCode} has conflicting name, brand, material or series in this workbook`);
        seenTileDesigns.set(row.normalized.designCode, fingerprint);
      }
      for (const uom of [row.normalized.baseUom, row.normalized.purchaseUom, row.normalized.salesUom]) {
        if (!validUoms.has(uom)) errors.push(`Unknown or inactive UOM ${uom}`);
      }
      if (!validTaxCodes.has(row.normalized.taxClass)) errors.push(`Unknown or inactive tax code ${row.normalized.taxClass}`);
      if (row.normalized.category && !categoryNames.has(this.key(row.normalized.category))) {
        missingCategories.add(row.normalized.category);
        errors.push(`Unknown category ${row.normalized.category}`);
      }
      if (row.normalized.brand && !brandNames.has(this.key(row.normalized.brand))) {
        missingBrands.add(row.normalized.brand);
        errors.push(`Unknown brand ${row.normalized.brand}`);
      }
      if (row.normalized.finish && !finishNames.has(this.key(row.normalized.finish))) {
        missingFinishes.add(row.normalized.finish);
        errors.push(`Unknown finish ${row.normalized.finish}`);
      }
      if (row.normalized.material && !materialNames.has(this.key(row.normalized.material))) {
        missingMaterials.add(row.normalized.material);
        errors.push(`Unknown material ${row.normalized.material}`);
      }
      if (this.key(row.normalized.category) === 'tiles' && row.normalized.dimensions && !tileSizeNames.has(this.key(row.normalized.dimensions))) {
        missingTileSizes.add(row.normalized.dimensions);
        errors.push(`Unknown tile size ${row.normalized.dimensions}`);
      }

      const action = existingSku.has(row.normalized.sku) ? 'blocked_existing' : 'created';
      const preview = {
        sheet: row.raw.__sheet,
        rowNumber: row.raw.__rowNumber,
        sku: row.normalized.sku,
        internalCode: row.normalized.internalCode,
        designCode: row.normalized.designCode,
        designName: row.normalized.designName,
        name: row.normalized.name,
        category: row.normalized.category,
        brand: row.normalized.brand,
        finish: row.normalized.finish,
        material: row.normalized.material,
        dimensions: row.normalized.dimensions,
        unit: row.normalized.unit,
        baseUom: row.normalized.baseUom,
        purchaseUom: row.normalized.purchaseUom,
        salesUom: row.normalized.salesUom,
        piecesPerPack: row.normalized.piecesPerPack,
        coveragePerPack: row.normalized.coveragePerPack,
        defaultMrpInclusive: row.normalized.defaultMrpInclusive,
        defaultNrpInclusive: row.normalized.defaultNrpInclusive,
        floorPriceInclusive: row.normalized.floorPriceInclusive,
        priceRateBasis: row.normalized.priceRateBasis,
        priceUom: row.normalized.priceUom,
        mrpSource: row.normalized.mrpSource,
        pricingEffectiveFrom: row.normalized.pricingEffectiveFrom,
        taxClass: row.normalized.taxClass,
        hsnCode: row.normalized.hsnCode,
        allowLoose: row.normalized.allowLoose,
        range: row.normalized.range,
        imageUrl: row.normalized.imageUrl === '__embedded_excel_image__' ? '' : row.normalized.imageUrl,
        description: row.normalized.description,
        provided: {
          internalCode: row.normalized.hasInternalCode,
          baseUom: row.normalized.hasBaseUom,
          purchaseUom: row.normalized.hasPurchaseUom,
          salesUom: row.normalized.hasSalesUom,
          piecesPerPack: row.normalized.hasPiecesPerPack,
          coveragePerPack: row.normalized.hasCoveragePerPack,
          defaultMrpInclusive: row.normalized.hasDefaultMrpInclusive,
          defaultNrpInclusive: row.normalized.hasDefaultNrpInclusive,
          floorPriceInclusive: row.normalized.hasFloorPriceInclusive,
          priceRateBasis: row.normalized.hasPriceRateBasis,
          priceUom: row.normalized.hasPriceUom,
          mrpSource: row.normalized.hasMrpSource,
          pricingEffectiveFrom: row.normalized.hasPricingEffectiveFrom,
          taxClass: row.normalized.hasTaxClass,
          allowLoose: row.normalized.hasAllowLoose,
        },
        stockTreatment: 'saleable_sku_zero_stock',
        imageStatus: row.normalized.imageUrl ? (row.normalized.imageUrl === '__embedded_excel_image__' ? 'embedded_image_detected' : 'image_url_ready') : 'no_image',
        imagePreviewUrl: row.normalized.imageUrl && row.normalized.imageUrl !== '__embedded_excel_image__' ? row.normalized.imageUrl : null,
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
      imageCount: readyRows.filter((row) => row.imageStatus !== 'no_image').length,
      failures: failures.slice(0, 80),
      rows: readyRows,
      previewRows: rows.map((row) => {
        const publicRow = { ...row };
        delete publicRow.normalized;
        return publicRow;
      }),
      masterGaps: {
        categories: Array.from(missingCategories).sort(),
        brands: Array.from(missingBrands).sort(),
        finishes: Array.from(missingFinishes).sort(),
        materials: Array.from(missingMaterials).sort(),
        tileSizes: Array.from(missingTileSizes).sort(),
      },
      masterOptions: {
        categories: Array.from(categoryNames.values()).sort(),
        brands: Array.from(brandNames.values()).sort(),
        finishes: Array.from(finishNames.values()).sort(),
        materials: Array.from(materialNames.values()).sort(),
        tileSizes: Array.from(tileSizeNames.values()).sort(),
        uoms: Array.from(validUoms).sort(),
        taxCodes: Array.from(validTaxCodes).sort(),
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
      imageCount: plan.imageCount,
      failures: plan.failures,
      masterGaps: plan.masterGaps,
      masterOptions: plan.masterOptions,
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
      imageCount: plan.imageCount || 0,
    };
  }

  private validateNormalizedRow(row: NormalizedProductRow) {
    const errors: string[] = [];
    if (!row.sku) errors.push('SKU/code is required');
    if (row.sku.length > 80) errors.push('SKU/code must be 80 characters or fewer');
    if (row.sku && !/^[A-Z0-9][A-Z0-9._/-]*$/.test(row.sku)) errors.push('SKU/code may contain only letters, numbers, dot, underscore, slash and hyphen');
    if (!row.hasInternalCode || !row.internalCode) errors.push('Internal/showroom code is required and must be unique for this product');
    if (!row.name) errors.push('Product name/description is required');
    if (row.name.length > 240) errors.push('Product name must be 240 characters or fewer');
    if (!row.category) errors.push('Category is required');
    if (!row.brand) errors.push('Brand is required. Create it in Brand Master before importing');
    if (!row.finish) errors.push('Finish is required. Create it in Finish Master before importing');
    if (!row.hasTaxClass) errors.push('Tax Code is required');
    if (this.key(row.category) === 'tiles' && (!row.hasDesignCode || !row.designCode)) errors.push('Tile Design Code is required for Tiles so all size and finish variants share one governed design');
    if (this.key(row.category) === 'tiles' && (!row.hasDesignName || !row.designName)) errors.push('Tile Design Name is required for Tiles and remains independent of the size/finish variant name');
    if (!row.hasDefaultMrpInclusive || !Number.isFinite(row.defaultMrpInclusive) || row.defaultMrpInclusive <= 0) errors.push('Default MRP incl GST is required and must be greater than zero for every new SKU');
    if (row.hasDefaultNrpInclusive && (!Number.isFinite(row.defaultNrpInclusive) || row.defaultNrpInclusive <= 0)) errors.push('Default NRP incl GST must be greater than zero');
    if (row.hasDefaultMrpInclusive && row.defaultNrpInclusive > row.defaultMrpInclusive) errors.push('Default NRP cannot exceed Default MRP');
    if (row.hasFloorPriceInclusive && (!Number.isFinite(row.floorPriceInclusive) || row.floorPriceInclusive < 0)) errors.push('Floor price incl GST must be zero or greater');
    if (row.hasFloorPriceInclusive && row.floorPriceInclusive > row.defaultMrpInclusive) errors.push('Floor price cannot exceed Default MRP');
    if ((row.hasDefaultMrpInclusive || row.hasDefaultNrpInclusive) && !['BOX', 'PIECE', 'AREA'].includes(row.priceRateBasis)) errors.push('Price Basis must be BOX, PIECE, or AREA when defaults are supplied');
    if ((row.hasDefaultMrpInclusive || row.hasDefaultNrpInclusive) && !row.priceUom) errors.push('Price UOM is required when defaults are supplied');
    if (this.key(row.category) === 'tiles' && (row.priceRateBasis !== 'AREA' || row.priceUom !== 'SQFT')) errors.push('Tile MRP must use AREA basis and SQFT UOM');
    if ((row.hasDefaultMrpInclusive || row.hasDefaultNrpInclusive) && !row.mrpSource) errors.push('MRP Source is required when price defaults are supplied');
    if ((row.hasDefaultMrpInclusive || row.hasDefaultNrpInclusive) && (!row.pricingEffectiveFrom || !Number.isFinite(new Date(row.pricingEffectiveFrom).getTime()))) errors.push('Pricing Effective From must be a valid date when defaults are supplied');
    if (!Number.isInteger(row.piecesPerPack) || row.piecesPerPack <= 0) errors.push('Pieces per pack must be a positive whole number');
    if (!Number.isFinite(row.coveragePerPack) || row.coveragePerPack < 0) errors.push('Coverage per pack must be zero or greater');
    if (row.imageUrl && row.imageUrl !== '__embedded_excel_image__' && !/^(https:\/\/|\/catalogue-images\/)/i.test(row.imageUrl)) {
      errors.push('Image URL must use HTTPS or a managed /catalogue-images/ path');
    }
    return errors;
  }

  private deprecatedPricingHeaderErrors(raw: Record<string, unknown>) {
    const deprecated = new Map([
      ['sellprice', 'Sell Price'],
      ['floorprice', 'Floor Price'],
      ['defaultpurchasecost', 'Default Purchase Cost'],
      ['costprice', 'Cost Price'],
      ['listprice', 'List Price'],
    ]);
    const found = Object.keys(raw)
      .map((header) => deprecated.get(this.normalizeHeader(header)))
      .filter((header): header is string => Boolean(header));
    return found.length
      ? [`Deprecated pricing header(s): ${Array.from(new Set(found)).join(', ')}. Use Default MRP Incl GST, Default NRP Incl GST, Price Basis, Price UOM, MRP Source and Pricing Effective From.`]
      : [];
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
    return { headerRowNumber, byColumn: headers, score: bestScore };
  }

  private isProductImportSheet(sheetName: string, headers: { score: number; byColumn: Record<number, string> }) {
    if (this.normalizeHeader(sheetName) === 'productmaster') return true;
    const normalizedHeaders = new Set(Object.values(headers.byColumn).map((value) => this.normalizeHeader(value)));
    return headers.score >= 3 && normalizedHeaders.has('sku') && (normalizedHeaders.has('productname') || normalizedHeaders.has('name') || normalizedHeaders.has('description'));
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
    const defaultMrpInclusive = pick('Default MRP Incl GST');
    const defaultNrpInclusive = pick('Default NRP Incl GST');
    const floorPriceInclusive = pick('Floor Price Incl GST');
    const priceRateBasis = pick('Price Basis');
    const priceUom = pick('Price UOM');
    const mrpSource = pick('MRP Source');
    const pricingEffectiveFrom = pick('Pricing Effective From');
    const category = this.cleanText(pick('Category', 'CATEGORY', 'Product Category', 'Group', 'Type'));
    const brand = this.cleanText(pick('Brand', 'BRAND', 'Make', 'Company'));
    const finish = this.cleanText(pick('Finish', 'FINISH', 'Color', 'Colour', 'Surface', 'Shade'));
    const dimensions = this.cleanText(pick('Tile Size / Dimensions', 'Dimensions', 'DIMENSIONS', 'Size', 'SIZE', 'Tile Size'));
    const unit = pick('Unit', 'UOM', 'uom');
    const purchaseUomValue = pick('Purchase UOM', 'Purchase Unit', 'Inventory UOM', 'Stock UOM');
    const salesUomValue = pick('Sales UOM', 'Rate UOM', 'Pricing UOM', 'Price Unit');
    const baseUomValue = pick('Base UOM', 'Base Unit');
    const piecesPerPackValue = pick('Pieces Per Pack', 'Pieces/Box', 'PCS/BOX', 'Pcs Per Box', 'Pack Quantity');
    const taxClassValue = pick('Tax Code', 'Tax Class', 'GST', 'GST Rate');
    const allowLooseValue = pick('Allow Loose', 'Loose Sale', 'Allow Piece Sale');
    const defaultUom = this.key(category) === 'tiles' ? 'BOX' : 'PC';
    const purchaseUom = String(purchaseUomValue || unit || defaultUom).trim().toUpperCase();
    const salesUom = String(salesUomValue || unit || defaultUom).trim().toUpperCase();
    const baseUom = String(baseUomValue || (purchaseUom === 'BOX' ? 'PC' : purchaseUom)).trim().toUpperCase();
    const sku = this.normalizeSku(pick('SKU', 'sku', 'Code', 'PRODUCT CODE', 'Product Code', 'Item Code', 'Article No', 'Article Number', 'Model No', 'Material Code'));
    const internalCode = pick('Internal Code', 'Showroom Code', 'Display Code', 'Sales Code', 'Internal SKU');
    const designCode = pick('Tile Design Code', 'Design Code', 'Tile Family Code');
    const designName = pick('Tile Design Name', 'Design Name', 'Tile Family Name');
    const description = this.cleanText(pick('Long Description', 'Description', 'PRODUCT DESCRIPTION'));
    return {
      sku,
      internalCode: this.normalizeInternalCode(internalCode || sku),
      hasInternalCode: internalCode !== undefined,
      designCode: this.normalizeInternalCode(designCode || ''),
      hasDesignCode: designCode !== undefined,
      designName: this.cleanText(designName),
      hasDesignName: designName !== undefined,
      name: this.cleanText(pick('Product Name', 'Item Name', 'Name', 'Product', 'PRODUCT DESCRIPTION', 'Item Description', 'Description')),
      category,
      brand,
      finish,
      material: this.cleanText(pick('Material', 'Body Material', 'Composition')),
      dimensions,
      unit: purchaseUom || 'PC',
      baseUom,
      purchaseUom,
      salesUom,
      piecesPerPack: this.wholeNumber(piecesPerPackValue, 1),
      coveragePerPack: this.number(pick('Coverage Per Pack', 'Coverage/Box', 'SQFT/BOX', 'SQM/BOX', 'Box Coverage'), 0),
      hsnCode: this.cleanText(pick('HSN', 'HSN Code', 'HSN/SAC')),
      taxClass: this.normalizeTaxClass(taxClassValue),
      defaultMrpInclusive: this.money(defaultMrpInclusive),
      defaultNrpInclusive: this.money(defaultNrpInclusive),
      floorPriceInclusive: this.money(floorPriceInclusive),
      priceRateBasis: String(priceRateBasis || '').trim().toUpperCase(),
      priceUom: String(priceUom || '').trim().toUpperCase(),
      mrpSource: this.cleanText(mrpSource),
      pricingEffectiveFrom: this.cleanText(pricingEffectiveFrom),
      hasBrand: Boolean(brand),
      hasFinish: Boolean(finish),
      hasDimensions: Boolean(dimensions),
      hasUnit: unit !== undefined,
      hasDefaultMrpInclusive: defaultMrpInclusive !== undefined,
      hasDefaultNrpInclusive: defaultNrpInclusive !== undefined,
      hasFloorPriceInclusive: floorPriceInclusive !== undefined,
      hasPriceRateBasis: priceRateBasis !== undefined,
      hasPriceUom: priceUom !== undefined,
      hasMrpSource: mrpSource !== undefined,
      hasPricingEffectiveFrom: pricingEffectiveFrom !== undefined,
      hasDescription: Boolean(description),
      description,
      range: this.cleanText(pick('Range / Series', 'Range', 'RANGE', 'Series', 'Collection')) || '',
      imageUrl: this.cleanText(pick('__embeddedImageUrl', 'Image', 'Image URL', 'Photo', 'Photo URL', 'Media', 'Picture URL')) || '',
      allowLoose: this.booleanValue(allowLooseValue),
      hasBaseUom: baseUomValue !== undefined,
      hasPurchaseUom: purchaseUomValue !== undefined,
      hasSalesUom: salesUomValue !== undefined,
      hasPiecesPerPack: piecesPerPackValue !== undefined,
      hasCoveragePerPack: pick('Coverage Per Pack', 'Coverage/Box', 'SQFT/BOX', 'SQM/BOX', 'Box Coverage') !== undefined,
      hasTaxClass: taxClassValue !== undefined,
      hasAllowLoose: allowLooseValue !== undefined,
    };
  }

  private async applyProductRowTx(tx: any, normalized: NormalizedProductRow, uploadedBy: string): Promise<any> {
    const { sku, name, category, brand, finish, dimensions } = normalized;
    const masters = await this.ensureProductMastersTx(tx, normalized);
    const media = normalized.imageUrl && normalized.imageUrl !== '__embedded_excel_image__'
      ? { primaryUrl: normalized.imageUrl, gallery: [{ url: normalized.imageUrl }], source: 'excel-import', exactSkuMatch: true }
      : undefined;
    const existing = await tx.product.findUnique({ where: { sku } });
    if (existing) {
      throw new BadRequestException(`SKU ${sku} already exists. Bulk import creates new SKUs only.`);
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
        tileDesignId: masters.tileDesign?.id || null,
        unit: normalized.purchaseUom,
        baseUom: normalized.baseUom,
        purchaseUom: normalized.purchaseUom,
        salesUom: normalized.salesUom,
        piecesPerPack: normalized.piecesPerPack,
        coveragePerPack: normalized.coveragePerPack,
        hsnCode: normalized.hsnCode || null,
        trackLots: true,
        allowLoose: normalized.allowLoose,
        tags: [],
        sellPrice: 0,
        floorPrice: 0,
        costPrice: 0,
        defaultMrpInclusive: normalized.hasDefaultMrpInclusive ? normalized.defaultMrpInclusive : null,
        defaultNrpInclusive: normalized.hasDefaultNrpInclusive ? normalized.defaultNrpInclusive : null,
        floorPriceInclusive: normalized.hasFloorPriceInclusive ? normalized.floorPriceInclusive : null,
        mrp: normalized.defaultMrpInclusive,
        mrpRateBasis: normalized.priceRateBasis,
        mrpVerifiedAt: new Date(),
        mrpVerifiedById: uploadedBy,
        priceRateBasis: normalized.hasPriceRateBasis ? normalized.priceRateBasis : null,
        priceUom: normalized.hasPriceUom ? normalized.priceUom : null,
        mrpSource: normalized.hasMrpSource ? normalized.mrpSource : null,
        pricingEffectiveFrom: normalized.hasPricingEffectiveFrom ? new Date(normalized.pricingEffectiveFrom) : null,
        pricingVersion: 'unified_retail_v1',
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
    const { category, brand, finish, material, dimensions } = normalized;
    const [categoryRow, brandRow, finishRow, materialRow, tileSizeRow, tileDesignRow] = await Promise.all([
      tx.productCategory.findFirst({ where: { name: category, status: 'active' } }),
      brand ? tx.productBrand.findFirst({ where: { name: brand, status: 'active' } }) : null,
      finish ? tx.productFinish.findFirst({ where: { name: finish, status: 'active' } }) : null,
      material ? tx.productMaterial.findFirst({ where: { name: material, status: 'active' } }) : null,
      this.key(category) === 'tiles' && dimensions ? tx.tileSize.findFirst({ where: { name: dimensions, status: 'active' } }) : null,
      this.key(category) === 'tiles' && normalized.designCode ? tx.tileDesign.findUnique({ where: { designCode: normalized.designCode } }) : null,
    ]);
    if (!categoryRow || (brand && !brandRow) || (finish && !finishRow) || (material && !materialRow) || (this.key(category) === 'tiles' && dimensions && !tileSizeRow)) {
      throw new BadRequestException('A selected master value changed after preview. Download a fresh template and preview again.');
    }
    return { category: categoryRow, brand: brandRow, finish: finishRow, material: materialRow, tileSize: tileSizeRow, tileDesign: tileDesignRow };
  }

  private normalizeHeader(value: string) {
    return String(value || '')
      .replace(/\s*\((optional|required)\)\s*/gi, '')
      .replace(/\s*\*\s*$/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
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

  private booleanValue(value: any) {
    return ['yes', 'y', 'true', '1'].includes(String(value ?? '').trim().toLowerCase());
  }

  private key(value: string) {
    return String(value || '').trim().toLowerCase();
  }

  private confirmationToken(filePath: string, uploadedBy: string, plan: any) {
    const secret = process.env.IMPORT_CONFIRMATION_SECRET || process.env.SESSION_SECRET || process.env.JWT_SECRET || 'marble-park-local-import-confirmation';
    const hmac = createHmac('sha256', secret);
    hmac.update(uploadedBy);
    hmac.update('\0');
    hmac.update(fs.readFileSync(filePath));
    hmac.update('\0');
    // Sign the effective server-normalized values, not the browser's transport
    // representation. Blank optional cells and their materialized defaults are
    // semantically identical and must produce the same confirmation token.
    hmac.update(JSON.stringify((plan.rows || []).map((row: any) => ({
      sheet: row.sheet,
      rowNumber: row.rowNumber,
      normalized: row.normalized,
    }))));
    return hmac.digest('hex');
  }

  private previewSnapshotPath(filePath: string) {
    return `${filePath}.preview.json`;
  }

  private async writePreviewSnapshot(filePath: string, uploadedBy: string, reviewRows: ProductImportReviewRow[], plan: any, confirmationToken: string | null) {
    const snapshot = { uploadedBy, reviewRows: this.canonicalReviewRows(reviewRows), confirmationToken, plan };
    await fs.promises.writeFile(this.previewSnapshotPath(filePath), JSON.stringify(snapshot), { mode: 0o600 });
  }

  private async readPreviewSnapshot(filePath: string): Promise<any | null> {
    try {
      return JSON.parse(await fs.promises.readFile(this.previewSnapshotPath(filePath), 'utf8'));
    } catch {
      return null;
    }
  }

  private productCreateData(id: string, normalized: NormalizedProductRow & { masterIds?: any }, uploadedBy: string) {
    const media = normalized.imageUrl && normalized.imageUrl !== '__embedded_excel_image__'
      ? { primaryUrl: normalized.imageUrl, gallery: [{ url: normalized.imageUrl }], source: 'excel-import', exactSkuMatch: true }
      : {};
    return {
      id,
      sku: normalized.sku,
      name: normalized.designName,
      category: normalized.category,
      brand: normalized.brand,
      finish: normalized.finish,
      dimensions: normalized.dimensions,
      internalCode: normalized.internalCode,
      categoryId: normalized.masterIds?.categoryId || null,
      brandId: normalized.masterIds?.brandId || null,
      finishId: normalized.masterIds?.finishId || null,
      materialId: normalized.masterIds?.materialId || null,
      tileSizeId: normalized.masterIds?.tileSizeId || null,
      tileDesignId: normalized.masterIds?.tileDesignId || null,
      unit: normalized.purchaseUom,
      baseUom: normalized.baseUom,
      purchaseUom: normalized.purchaseUom,
      salesUom: normalized.salesUom,
      piecesPerPack: normalized.piecesPerPack,
      coveragePerPack: normalized.coveragePerPack,
      hsnCode: normalized.hsnCode || null,
      trackLots: true,
      allowLoose: normalized.allowLoose,
      tags: [],
      sellPrice: 0,
      floorPrice: 0,
      costPrice: 0,
      defaultMrpInclusive: normalized.hasDefaultMrpInclusive ? normalized.defaultMrpInclusive : null,
      defaultNrpInclusive: normalized.hasDefaultNrpInclusive ? normalized.defaultNrpInclusive : null,
      floorPriceInclusive: normalized.hasFloorPriceInclusive ? normalized.floorPriceInclusive : null,
      mrp: normalized.defaultMrpInclusive,
      mrpRateBasis: normalized.priceRateBasis,
      mrpVerifiedAt: new Date(),
      mrpVerifiedById: uploadedBy,
      priceRateBasis: normalized.hasPriceRateBasis ? normalized.priceRateBasis : null,
      priceUom: normalized.hasPriceUom ? normalized.priceUom : null,
      mrpSource: normalized.hasMrpSource ? normalized.mrpSource : null,
      pricingEffectiveFrom: normalized.hasPricingEffectiveFrom ? new Date(normalized.pricingEffectiveFrom) : null,
      pricingVersion: 'unified_retail_v1',
      taxClass: normalized.taxClass,
      status: 'active',
      media,
      sourceRefs: { createdFrom: 'excel-import', uploadedBy, range: normalized.range },
      description: normalized.description,
      updatedAt: new Date(),
    } as any;
  }

  private tileDesignCreateData(normalized: NormalizedProductRow, uploadedBy: string) {
    const media = normalized.imageUrl && normalized.imageUrl !== '__embedded_excel_image__'
      ? { primaryUrl: normalized.imageUrl, images: [{ url: normalized.imageUrl }], source: 'excel-import' }
      : {};
    return {
      id: ulid(),
      designCode: normalized.designCode,
      name: normalized.name,
      brand: normalized.brand || '',
      collection: normalized.range || null,
      material: normalized.material || null,
      surface: normalized.finish || null,
      description: normalized.description || '',
      media,
      tags: [],
      usage: [],
      status: 'active',
      metadata: { createdFrom: 'excel-import', uploadedBy },
      updatedAt: new Date(),
    };
  }

  private async masterSnapshot() {
    const [categories, brands, finishes, materials, tileSizes, uoms, taxCodes] = await Promise.all([
      this.prisma.productCategory.findMany({ where: { status: 'active' }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { name: true, code: true } }),
      this.prisma.productBrand.findMany({ where: { status: 'active' }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { name: true, code: true } }),
      this.prisma.productFinish.findMany({ where: { status: 'active' }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { name: true, code: true } }),
      this.prisma.productMaterial.findMany({ where: { status: 'active' }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { name: true, code: true } }),
      this.prisma.tileSize.findMany({ where: { status: 'active' }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { name: true, code: true, uom: true, pcsPerBox: true } }),
      this.prisma.unitOfMeasure.findMany({ where: { status: 'active' }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }], select: { code: true, name: true, dimension: true } }),
      this.prisma.taxCode.findMany({ where: { status: 'active' }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }], select: { code: true, name: true, rate: true, hsnCode: true } }),
    ]);
    return { categories, brands, finishes, materials, tileSizes, uoms, taxCodes };
  }

  private removeFiles(files: string[]) {
    for (const file of files) fs.rmSync(file, { force: true });
  }

  private async extractWorksheetImages(workbook: any, worksheet: any, headerRowNumber: number, persist: boolean) {
    const byRow = new Map<number, string>();
    const errors = new Map<number, string>();
    const persistedFiles: string[] = [];
    const images = typeof worksheet.getImages === 'function' ? worksheet.getImages() : [];
    if (!images?.length) return { byRow, errors, persistedFiles };

    const root = process.env.CATALOGUE_IMAGE_STORAGE_DIR || path.resolve(process.cwd(), '../../apps/web/public/catalogue-images');
    const directory = path.join(root, 'manual');
    if (persist) fs.mkdirSync(directory, { recursive: true });

    let totalBytes = 0;
    for (const image of images) {
      const topRow = Number(image.range?.tl?.nativeRow ?? image.range?.tl?.row ?? headerRowNumber) + 1;
      const rowNumber = Math.max(headerRowNumber + 1, topRow);
      const workbookImage = typeof workbook.getImage === 'function' ? workbook.getImage(image.imageId) : null;
      const buffer = workbookImage?.buffer;
      if (!buffer) {
        errors.set(rowNumber, 'Embedded product image could not be read');
        continue;
      }
      totalBytes += buffer.length;
      const declaredExtension = String(workbookImage.extension || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
      const isPng = buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      const isJpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
      const isWebp = buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
      const extension = isPng ? 'png' : isJpeg ? 'jpg' : isWebp ? 'webp' : '';
      if (!extension || !['png', 'jpg', 'jpeg', 'webp'].includes(declaredExtension || extension)) {
        errors.set(rowNumber, 'Embedded product image must be a valid JPG, PNG or WebP file');
        continue;
      }
      if (buffer.length > MAX_EMBEDDED_IMAGE_BYTES) {
        errors.set(rowNumber, 'Embedded product image exceeds 5 MB');
        continue;
      }
      if (totalBytes > MAX_EMBEDDED_IMAGE_TOTAL_BYTES) {
        errors.set(rowNumber, 'Workbook embedded images exceed the 20 MB total limit');
        continue;
      }
      if (!persist) {
        byRow.set(rowNumber, '__embedded_excel_image__');
        continue;
      }
      const fileName = `${ulid()}.${extension}`;
      const filePath = path.join(directory, fileName);
      fs.writeFileSync(filePath, buffer, { mode: 0o640 });
      persistedFiles.push(filePath);
      byRow.set(rowNumber, `/catalogue-images/manual/${fileName}`);
    }

    return { byRow, errors, persistedFiles };
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
