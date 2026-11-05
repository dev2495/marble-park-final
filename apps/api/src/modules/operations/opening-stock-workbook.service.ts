import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const SHEET_NAME = 'Opening stock';
const HEADER_ROW = 3;
const HEADERS = ['SKU', 'Product code', 'Name', 'Brand', 'Category', 'Size', 'Finish', 'Stock unit', 'Quantity', 'Unit cost', 'Lot / batch', 'Note'];
const MAX_BYTES = 8 * 1024 * 1024;
// One opening session is posted in a single transaction; keep each upload to a size that posts reliably.
export const MAX_OPENING_LINES = 500;

/**
 * Excel template and upload preview for opening stock. Nothing is written
 * here: the preview hands matched lines back to the Opening Stock batch,
 * which goes through the usual submit and owner posting.
 */
@Injectable()
export class OpeningStockWorkbookService {
  constructor(private prisma: PrismaService) {}

  async template(category?: string) {
    const where: any = { status: 'active', ...(category ? { category } : {}) };
    const products = await this.prisma.product.findMany({
      where,
      orderBy: [{ category: 'asc' }, { brand: 'asc' }, { name: 'asc' }, { sku: 'asc' }],
      select: { sku: true, internalCode: true, name: true, brand: true, category: true, dimensions: true, finish: true, baseUom: true },
    });
    if (!products.length) throw new BadRequestException('No active products match this category');
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Marble Park';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet(SHEET_NAME, { views: [{ state: 'frozen', ySplit: HEADER_ROW, xSplit: 3 }] });
    sheet.mergeCells('A1:L1');
    sheet.getCell('A1').value = `Marble Park · Opening stock count${category ? ` · ${category}` : ''} · ${products.length.toLocaleString('en-IN')} products`;
    sheet.getCell('A1').font = { size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7F2925' } };
    sheet.getRow(1).height = 30;
    sheet.mergeCells('A2:L2');
    sheet.getCell('A2').value = 'Fill Quantity (whole number, in the stock unit) for items you physically have. Leave it blank for items you do not stock. Unit cost is optional but needed for stock value.';
    sheet.getCell('A2').font = { bold: true, color: { argb: 'FF5D4038' } };
    sheet.getCell('A2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF1E8' } };
    sheet.getCell('A2').alignment = { wrapText: true, vertical: 'middle' };
    sheet.getRow(2).height = 34;
    sheet.addRow(HEADERS);
    sheet.getRow(HEADER_ROW).eachCell((cell: any, column: number) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: column >= 9 && column <= 11 ? 'FFB7791F' : 'FF24211F' } };
      cell.alignment = { vertical: 'middle' };
    });
    for (const product of products) {
      const row = sheet.addRow([product.sku, product.internalCode || '', product.name, product.brand, product.category, product.dimensions, product.finish, product.baseUom || 'PC', null, null, null, null]);
      [9, 10, 11].forEach((column) => { row.getCell(column).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3BF' } }; });
      row.getCell(9).dataValidation = { type: 'whole', operator: 'greaterThan', formulae: [0], allowBlank: true, showErrorMessage: true, errorTitle: 'Whole number', error: 'Enter a whole quantity greater than zero, or leave it blank.' };
      row.getCell(10).numFmt = '[$₹-en-IN]#,##0.00';
    }
    const widths = [22, 24, 44, 18, 18, 18, 16, 10, 12, 14, 16, 24];
    sheet.columns.forEach((column: any, index: number) => { column.width = widths[index]; });
    sheet.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: HEADER_ROW, column: HEADERS.length } };
    const buffer = await workbook.xlsx.writeBuffer();
    return {
      filename: `marble-park-opening-stock${category ? `-${category.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : ''}.xlsx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      contentBase64: Buffer.from(buffer).toString('base64'),
      productCount: products.length,
    };
  }

  private cellText(cell: any) {
    const value = cell?.value;
    if (value == null) return '';
    if (typeof value === 'object') {
      if ('result' in value) return String(value.result ?? '').trim();
      if ('text' in value) return String(value.text ?? '').trim();
      if (Array.isArray(value.richText)) return value.richText.map((part: any) => part.text).join('').trim();
      return '';
    }
    return String(value).trim();
  }

  async preview(filename: string, contentBase64: string) {
    if (!/\.xlsx$/i.test(String(filename || ''))) throw new BadRequestException('Choose an .xlsx file. Download the template from this page if you need one.');
    const encoded = String(contentBase64 || '').trim();
    const content = Buffer.from(encoded, 'base64');
    if (!content.length || content.length > MAX_BYTES || content.subarray(0, 2).toString('ascii') !== 'PK') throw new BadRequestException('The upload is not a valid .xlsx file, or is larger than 8 MB');
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    try { await workbook.xlsx.load(content); } catch { throw new BadRequestException('The workbook could not be read. Save it again as .xlsx and retry.'); }
    const sheet = workbook.getWorksheet(SHEET_NAME) || workbook.worksheets[0];
    if (!sheet) throw new BadRequestException('The workbook has no sheets');

    // Find the header row by name, so a re-saved or rearranged sheet still works.
    let headerRow = 0;
    const columns: Record<string, number> = {};
    for (let rowNumber = 1; rowNumber <= Math.min(10, sheet.rowCount); rowNumber += 1) {
      const names = new Map<string, number>();
      sheet.getRow(rowNumber).eachCell((cell: any, column: number) => names.set(this.cellText(cell).toLowerCase(), column));
      if ((names.has('sku') || names.has('product code')) && names.has('quantity')) {
        headerRow = rowNumber;
        for (const [name, column] of names) columns[name] = column;
        break;
      }
    }
    if (!headerRow) throw new BadRequestException('Could not find the header row. The sheet needs at least "SKU" (or "Product code") and "Quantity" columns.');

    const raw: Array<{ row: number; sku: string; code: string; quantity: string; cost: string; lot: string }> = [];
    sheet.eachRow((row: any, rowNumber: number) => {
      if (rowNumber <= headerRow) return;
      const get = (name: string) => (columns[name] ? this.cellText(row.getCell(columns[name])) : '');
      const quantity = get('quantity');
      if (!quantity) return;
      raw.push({ row: rowNumber, sku: get('sku'), code: get('product code'), quantity, cost: get('unit cost'), lot: get('lot / batch') || get('lot') });
    });
    const errors: Array<{ row: number; message: string }> = [];
    const skus = Array.from(new Set(raw.map((line) => line.sku.toUpperCase()).filter(Boolean)));
    const codes = Array.from(new Set(raw.map((line) => line.code.toUpperCase()).filter(Boolean)));
    const products = await this.prisma.product.findMany({
      where: { OR: [{ sku: { in: skus, mode: 'insensitive' } }, { internalCode: { in: codes, mode: 'insensitive' } }] },
      select: { id: true, sku: true, internalCode: true, name: true, status: true, baseUom: true },
    });
    const bySku = new Map(products.map((product) => [product.sku.toUpperCase(), product]));
    const byCode = new Map(products.filter((product) => product.internalCode).map((product) => [String(product.internalCode).toUpperCase(), product]));
    const lines: any[] = [];
    const seen = new Map<string, number>();
    for (const line of raw) {
      const product = (line.sku && bySku.get(line.sku.toUpperCase())) || (line.code && byCode.get(line.code.toUpperCase()));
      const label = line.sku || line.code || `row ${line.row}`;
      if (!product) { errors.push({ row: line.row, message: `${label}: not found in Product Master` }); continue; }
      if (product.status !== 'active') { errors.push({ row: line.row, message: `${label}: product is not active` }); continue; }
      const quantity = Number(line.quantity.replace(/,/g, ''));
      if (!Number.isInteger(quantity) || quantity <= 0) { errors.push({ row: line.row, message: `${label}: quantity must be a whole number above zero` }); continue; }
      const cost = line.cost ? Number(line.cost.replace(/[₹,\s]/g, '')) : 0;
      if (!Number.isFinite(cost) || cost < 0) { errors.push({ row: line.row, message: `${label}: unit cost must be a number, zero or more` }); continue; }
      const lotCode = line.lot.trim().toUpperCase().slice(0, 60);
      const key = `${product.id}:${lotCode}`;
      if (seen.has(key)) { errors.push({ row: line.row, message: `${label}: appears twice with the same lot (also row ${seen.get(key)})` }); continue; }
      seen.set(key, line.row);
      lines.push({ row: line.row, productId: product.id, sku: product.sku, internalCode: product.internalCode, name: product.name, stockUnit: product.baseUom, quantity, unitCost: cost, lotCode });
    }
    return {
      lines: lines.slice(0, MAX_OPENING_LINES),
      errors: errors.slice(0, 200),
      errorCount: errors.length,
      matchedCount: lines.length,
      truncated: lines.length > MAX_OPENING_LINES,
      maxLines: MAX_OPENING_LINES,
      totalUnits: lines.reduce((sum, line) => sum + line.quantity, 0),
      missingCost: lines.filter((line) => !line.unitCost).length,
    };
  }
}
