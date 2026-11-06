import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const OPENING_SHEET = 'Opening stock';
const COUNT_SHEET = 'Stock count';
const OPENING_HEADERS = ['SKU', 'Product code', 'Name', 'Brand', 'Category', 'Size', 'Finish', 'Stock unit', 'Quantity', 'Unit cost', 'Lot / batch', 'Note'];
const COUNT_HEADERS = ['Lot ref', 'SKU', 'Product code', 'Name', 'Brand', 'Lot', 'Location', 'Stock unit', 'Book qty', 'Counted', 'Note'];
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_SHEET_PRODUCTS = 6000;
// One opening session is posted in a single transaction; keep each upload to a size that posts reliably.
export const MAX_OPENING_LINES = 500;

// Columns are found by name, so a re-saved, rearranged or exported sheet still reads.
const ALIASES: Record<string, string[]> = {
  lotRef: ['lot ref'],
  sku: ['sku', 'sku code'],
  code: ['product code', 'internal code', 'display code', 'code', 'item code'],
  quantity: ['quantity', 'qty', 'on hand', 'onhand', 'count', 'counted', 'physical', 'physical qty', 'closing stock', 'stock'],
  counted: ['counted', 'physical', 'physical qty', 'count', 'quantity', 'qty'],
  cost: ['unit cost', 'cost', 'rate', 'purchase rate', 'cost price'],
  lot: ['lot / batch', 'lot', 'batch', 'lot number'],
};

export type CountSheetFilter = { search?: string; categories?: string[]; brands?: string[]; productIds?: string[]; excludeIds?: string[] };

type Row = Record<string, string> & { row: string };

/**
 * Count sheets in Excel or CSV, for opening stock and for stock counts.
 * Nothing is written here: previews hand matched lines back to the screen,
 * which goes through its usual submit and owner posting.
 */
@Injectable()
export class OpeningStockWorkbookService {
  constructor(private prisma: PrismaService) {}

  private productWhere(filter: CountSheetFilter) {
    const where: any = { status: 'active' };
    const search = String(filter.search || '').trim();
    if (search) where.OR = [
      { sku: { contains: search, mode: 'insensitive' } },
      { internalCode: { contains: search, mode: 'insensitive' } },
      { name: { contains: search, mode: 'insensitive' } },
      { brand: { contains: search, mode: 'insensitive' } },
    ];
    const categories = (filter.categories || []).map(String).filter(Boolean);
    const brands = (filter.brands || []).map(String).filter(Boolean);
    if (categories.length) where.category = { in: categories };
    if (brands.length) where.brand = { in: brands };
    const ids = (filter.productIds || []).map(String).filter(Boolean);
    if (ids.length) where.id = { in: ids };
    const excluded = (filter.excludeIds || []).map(String).filter(Boolean);
    if (excluded.length) where.AND = [{ id: { notIn: excluded } }];
    return where;
  }

  async options() {
    const [categories, brands] = await Promise.all([
      this.prisma.product.groupBy({ by: ['category'], where: { status: 'active' }, _count: { _all: true }, orderBy: { category: 'asc' } }),
      this.prisma.product.groupBy({ by: ['brand'], where: { status: 'active' }, _count: { _all: true }, orderBy: { brand: 'asc' } }),
    ]);
    return {
      categories: categories.filter((row) => row.category).map((row) => ({ name: row.category, count: row._count._all })),
      brands: brands.filter((row) => row.brand).map((row) => ({ name: row.brand, count: row._count._all })),
    };
  }

  async candidates(filter: CountSheetFilter, skip = 0, take = 50) {
    const where = this.productWhere({ ...filter, productIds: undefined, excludeIds: undefined });
    const [total, rows] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where, orderBy: [{ category: 'asc' }, { brand: 'asc' }, { name: 'asc' }, { sku: 'asc' }],
        skip: Math.max(0, skip), take: Math.min(Math.max(take, 1), 200),
        select: { id: true, sku: true, internalCode: true, name: true, brand: true, category: true, dimensions: true, finish: true },
      }),
    ]);
    return { total, rows };
  }

  private async workbookFile(workbook: any, filename: string, count: number) {
    const buffer = await workbook.xlsx.writeBuffer();
    return { filename, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', contentBase64: Buffer.from(buffer).toString('base64'), productCount: count };
  }

  private styleSheet(sheet: any, title: string, help: string, headers: string[], editable: number[]) {
    const last = String.fromCharCode(64 + headers.length);
    sheet.mergeCells(`A1:${last}1`);
    sheet.getCell('A1').value = title;
    sheet.getCell('A1').font = { size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7F2925' } };
    sheet.getRow(1).height = 30;
    sheet.mergeCells(`A2:${last}2`);
    sheet.getCell('A2').value = help;
    sheet.getCell('A2').font = { bold: true, color: { argb: 'FF5D4038' } };
    sheet.getCell('A2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF1E8' } };
    sheet.getCell('A2').alignment = { wrapText: true, vertical: 'middle' };
    sheet.getRow(2).height = 34;
    sheet.addRow(headers);
    sheet.getRow(3).eachCell((cell: any, column: number) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: editable.includes(column) ? 'FFB7791F' : 'FF24211F' } };
    });
    sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: headers.length } };
  }

  /** Opening-stock count sheet for any filtered or hand-picked set of products. */
  async openingTemplate(filter: CountSheetFilter) {
    const where = this.productWhere(filter);
    const total = await this.prisma.product.count({ where });
    if (!total) throw new BadRequestException('No active products match this selection');
    if (total > MAX_SHEET_PRODUCTS) throw new BadRequestException(`This selection has ${total.toLocaleString('en-IN')} products. Narrow it to ${MAX_SHEET_PRODUCTS.toLocaleString('en-IN')} or fewer.`);
    const products = await this.prisma.product.findMany({
      where, orderBy: [{ category: 'asc' }, { brand: 'asc' }, { name: 'asc' }, { sku: 'asc' }],
      select: { sku: true, internalCode: true, name: true, brand: true, category: true, dimensions: true, finish: true, baseUom: true },
    });
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Marble Park';
    const sheet = workbook.addWorksheet(OPENING_SHEET, { views: [{ state: 'frozen', ySplit: 3, xSplit: 3 }] });
    this.styleSheet(sheet, `Marble Park · Opening stock count · ${products.length.toLocaleString('en-IN')} products`,
      'Fill Quantity (whole number, in the stock unit) for items you physically have. Leave it blank for items you do not stock. Unit cost is optional but needed for stock value.', OPENING_HEADERS, [9, 10, 11]);
    for (const product of products) {
      const row = sheet.addRow([product.sku, product.internalCode || '', product.name, product.brand, product.category, product.dimensions, product.finish, product.baseUom || 'PC', null, null, null, null]);
      // Codes stay text so Excel never drops a leading zero.
      row.getCell(1).numFmt = '@';
      row.getCell(2).numFmt = '@';
      [9, 10, 11].forEach((column) => { row.getCell(column).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3BF' } }; });
      row.getCell(9).dataValidation = { type: 'whole', operator: 'greaterThanOrEqual', formulae: [0], allowBlank: true, showErrorMessage: true, errorTitle: 'Whole number', error: 'Enter a whole quantity, or leave it blank.' };
      row.getCell(10).numFmt = '[$₹-en-IN]#,##0.00';
    }
    [22, 24, 44, 18, 18, 18, 16, 10, 12, 14, 16, 24].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
    return this.workbookFile(workbook, `marble-park-opening-stock-${new Date().toISOString().slice(0, 10)}.xlsx`, products.length);
  }

  /** Stock-count sheet: every active lot at one location with its book quantity. */
  async countTemplate(locationId: string, search?: string) {
    const location = await this.prisma.stockLocation.findUnique({ where: { id: locationId } });
    if (!location) throw new BadRequestException('Choose a stock location');
    const term = String(search || '').trim();
    const balances = await (this.prisma as any).inventoryLotBalance.findMany({
      where: {
        locationId,
        lot: { status: 'active', ...(term ? { OR: [
          { lotNumber: { contains: term, mode: 'insensitive' } },
          { product: { OR: [{ sku: { contains: term, mode: 'insensitive' } }, { internalCode: { contains: term, mode: 'insensitive' } }, { name: { contains: term, mode: 'insensitive' } }] } },
        ] } : {}) },
      },
      include: { lot: { include: { product: { select: { sku: true, internalCode: true, name: true, brand: true, baseUom: true } } } } },
      orderBy: [{ lot: { product: { brand: 'asc' } } }, { lot: { product: { sku: 'asc' } } }, { lot: { lotNumber: 'asc' } }],
      take: MAX_SHEET_PRODUCTS,
    });
    if (!balances.length) throw new BadRequestException('There are no active lots at this location to count');
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Marble Park';
    const sheet = workbook.addWorksheet(COUNT_SHEET, { views: [{ state: 'frozen', ySplit: 3, xSplit: 4 }] });
    this.styleSheet(sheet, `Marble Park · Stock count · ${location.name} · ${balances.length.toLocaleString('en-IN')} lots`,
      'Fill Counted with what is physically there. Leave it blank for lots you did not count. Book qty is what the system holds today.', COUNT_HEADERS, [10]);
    for (const balance of balances) {
      const product = balance.lot.product;
      const row = sheet.addRow([balance.lot.id, product.sku, product.internalCode || '', product.name, product.brand, balance.lot.lotNumber, location.name, product.baseUom || 'PC', Number(balance.onHand || 0), null, null]);
      row.getCell(2).numFmt = '@';
      row.getCell(3).numFmt = '@';
      row.getCell(10).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3BF' } };
      row.getCell(10).dataValidation = { type: 'whole', operator: 'greaterThanOrEqual', formulae: [0], allowBlank: true, showErrorMessage: true, errorTitle: 'Whole number', error: 'Enter the counted quantity as a whole number, or leave it blank.' };
    }
    [10, 20, 22, 42, 18, 24, 20, 10, 10, 12, 24].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
    sheet.getColumn(1).hidden = true;
    return this.workbookFile(workbook, `marble-park-stock-count-${location.code || 'location'}-${new Date().toISOString().slice(0, 10)}.xlsx`, balances.length);
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

  private parseCsv(text: string) {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (quoted) {
        if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
        else if (char === '"') quoted = false;
        else field += char;
      } else if (char === '"') quoted = true;
      else if (char === ',') { row.push(field); field = ''; }
      else if (char === '\n' || char === '\r') {
        if (char === '\r' && text[index + 1] === '\n') index += 1;
        row.push(field); rows.push(row); row = []; field = '';
      } else field += char;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  /** Reads .xlsx or .csv into rows keyed by the canonical column names above. */
  private async readRows(filename: string, contentBase64: string, required: Array<keyof typeof ALIASES>) {
    const name = String(filename || '').toLowerCase();
    const isCsv = name.endsWith('.csv');
    if (!isCsv && !name.endsWith('.xlsx')) throw new BadRequestException('Choose an .xlsx or .csv file');
    const content = Buffer.from(String(contentBase64 || '').trim(), 'base64');
    if (!content.length || content.length > MAX_BYTES) throw new BadRequestException('The file is empty or larger than 8 MB');
    let grid: string[][] = [];
    if (isCsv) {
      grid = this.parseCsv(content.toString('utf8').replace(/^﻿/, ''));
    } else {
      if (content.subarray(0, 2).toString('ascii') !== 'PK') throw new BadRequestException('The upload is not a valid .xlsx file');
      const ExcelJS = require('exceljs');
      const workbook = new ExcelJS.Workbook();
      try { await workbook.xlsx.load(content); } catch { throw new BadRequestException('The workbook could not be read. Save it again as .xlsx and retry.'); }
      const sheet = workbook.getWorksheet(OPENING_SHEET) || workbook.getWorksheet(COUNT_SHEET) || workbook.worksheets[0];
      if (!sheet) throw new BadRequestException('The workbook has no sheets');
      sheet.eachRow({ includeEmpty: true }, (row: any, rowNumber: number) => {
        const cells: string[] = [];
        row.eachCell({ includeEmpty: true }, (cell: any, column: number) => { cells[column - 1] = this.cellText(cell); });
        grid[rowNumber - 1] = Array.from(cells, (value) => value || '');
      });
      grid = Array.from(grid, (row) => row || []);
    }
    let headerIndex = -1;
    let columns: Record<string, number> = {};
    for (let index = 0; index < Math.min(10, grid.length); index += 1) {
      const names = (grid[index] || []).map((value) => String(value || '').trim().toLowerCase());
      const found: Record<string, number> = {};
      for (const [key, aliases] of Object.entries(ALIASES)) {
        const column = aliases.map((alias) => names.indexOf(alias)).find((position) => position >= 0);
        if (column !== undefined) found[key] = column;
      }
      if (required.every((key) => key === 'sku' ? found.sku !== undefined || found.code !== undefined || found.lotRef !== undefined : found[key] !== undefined)) {
        headerIndex = index;
        columns = found;
        break;
      }
    }
    if (headerIndex < 0) throw new BadRequestException(`Could not find the header row. The sheet needs a SKU (or Product code) column and a ${required.includes('counted') ? 'Counted' : 'Quantity / On hand'} column.`);
    const rows: Row[] = [];
    for (let index = headerIndex + 1; index < grid.length; index += 1) {
      const cells = grid[index] || [];
      if (!cells.some((value) => String(value || '').trim())) continue;
      const row: Row = { row: String(index + 1) };
      for (const [key, column] of Object.entries(columns)) row[key] = String(cells[column] ?? '').trim();
      rows.push(row);
    }
    return rows;
  }

  private number(raw: string) {
    return Number(String(raw || '').replace(/[₹,\s]/g, ''));
  }

  /** Product lookup by SKU or code; numeric codes that lost a leading zero in Excel still match. */
  private async productIndex(rows: Row[]) {
    const keys = new Set<string>();
    rows.forEach((row) => [row.sku, row.code].filter(Boolean).forEach((value) => {
      const key = value.toUpperCase();
      keys.add(key);
      if (/^\d+$/.test(key)) for (let pad = 1; pad <= 3; pad += 1) keys.add(key.padStart(key.length + pad, '0'));
    }));
    const list = Array.from(keys);
    const products = list.length ? await this.prisma.product.findMany({
      where: { OR: [{ sku: { in: list, mode: 'insensitive' } }, { internalCode: { in: list, mode: 'insensitive' } }] },
      select: { id: true, sku: true, internalCode: true, name: true, status: true, baseUom: true },
    }) : [];
    const byKey = new Map<string, any>();
    products.forEach((product) => { byKey.set(product.sku.toUpperCase(), product); if (product.internalCode) byKey.set(product.internalCode.toUpperCase(), product); });
    return (row: Row) => {
      for (const value of [row.sku, row.code].filter(Boolean)) {
        const key = value.toUpperCase();
        if (byKey.has(key)) return { product: byKey.get(key), fixedZero: false };
        if (/^\d+$/.test(key)) for (let pad = 1; pad <= 3; pad += 1) {
          const padded = key.padStart(key.length + pad, '0');
          if (byKey.has(padded)) return { product: byKey.get(padded), fixedZero: true };
        }
      }
      return { product: null, fixedZero: false };
    };
  }

  async openingPreview(filename: string, contentBase64: string) {
    const rows = await this.readRows(filename, contentBase64, ['sku', 'quantity']);
    const find = await this.productIndex(rows);
    const errors: Array<{ row: number; message: string }> = [];
    const notes: Array<{ row: number; message: string }> = [];
    const lines: any[] = [];
    const seen = new Map<string, number>();
    let zeroRows = 0;
    for (const row of rows) {
      const rowNumber = Number(row.row);
      const label = row.sku || row.code || `row ${rowNumber}`;
      const rawQty = String(row.quantity || '').trim();
      if (!rawQty) continue;
      const quantity = this.number(rawQty);
      if (quantity === 0) { zeroRows += 1; continue; }
      const { product, fixedZero } = find(row);
      if (!product) { errors.push({ row: rowNumber, message: `${label}: not found in Product Master` }); continue; }
      if (product.status !== 'active') { errors.push({ row: rowNumber, message: `${label}: product is not active` }); continue; }
      if (!Number.isInteger(quantity) || quantity < 0) { errors.push({ row: rowNumber, message: `${label}: quantity must be a whole number` }); continue; }
      const cost = row.cost ? this.number(row.cost) : 0;
      if (!Number.isFinite(cost) || cost < 0) { errors.push({ row: rowNumber, message: `${label}: unit cost must be a number, zero or more` }); continue; }
      if (fixedZero) notes.push({ row: rowNumber, message: `${label} matched ${product.sku} (Excel had dropped the leading zero)` });
      const lotCode = String(row.lot || '').trim().toUpperCase().slice(0, 60);
      const key = `${product.id}:${lotCode}`;
      if (seen.has(key)) { errors.push({ row: rowNumber, message: `${label}: appears twice with the same lot (also row ${seen.get(key)})` }); continue; }
      seen.set(key, rowNumber);
      lines.push({ row: rowNumber, productId: product.id, sku: product.sku, internalCode: product.internalCode, name: product.name, stockUnit: product.baseUom, quantity, unitCost: cost, lotCode, missingName: !String(product.name || '').trim() });
    }
    return {
      lines: lines.slice(0, MAX_OPENING_LINES),
      errors: errors.slice(0, 200),
      notes: notes.slice(0, 50),
      errorCount: errors.length,
      matchedCount: lines.length,
      zeroRows,
      truncated: lines.length > MAX_OPENING_LINES,
      maxLines: MAX_OPENING_LINES,
      totalUnits: lines.reduce((sum, line) => sum + line.quantity, 0),
      missingCost: lines.filter((line) => !line.unitCost).length,
      missingName: lines.filter((line) => line.missingName).length,
    };
  }

  async countPreview(filename: string, contentBase64: string, locationId: string) {
    const rows = await this.readRows(filename, contentBase64, ['sku', 'counted']);
    const balances = await (this.prisma as any).inventoryLotBalance.findMany({
      where: { locationId, lot: { status: 'active' } },
      include: { lot: { include: { product: { select: { sku: true, internalCode: true } } } } },
    });
    const byLotId = new Map<string, any>(balances.map((balance: any) => [balance.lotId, balance]));
    const byLotNumber = new Map<string, any>(balances.map((balance: any) => [String(balance.lot.lotNumber).toUpperCase(), balance]));
    const bySku = new Map<string, any[]>();
    balances.forEach((balance: any) => [balance.lot.product.sku, balance.lot.product.internalCode].filter(Boolean).forEach((code: string) => {
      const key = code.toUpperCase();
      bySku.set(key, [...(bySku.get(key) || []), balance]);
    }));
    const counts: Array<{ lotId: string; counted: number; book: number; sku: string; lot: string }> = [];
    const errors: Array<{ row: number; message: string }> = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const rowNumber = Number(row.row);
      const raw = String(row.counted || '').trim();
      if (!raw) continue;
      const label = row.sku || row.code || row.lot || `row ${rowNumber}`;
      const counted = this.number(raw);
      if (!Number.isInteger(counted) || counted < 0) { errors.push({ row: rowNumber, message: `${label}: counted must be a whole number, zero or more` }); continue; }
      let balance = row.lotRef ? byLotId.get(row.lotRef) : undefined;
      if (!balance && row.lot) balance = byLotNumber.get(row.lot.toUpperCase());
      if (!balance) {
        const options = [row.sku, row.code].filter(Boolean).flatMap((code) => bySku.get(code.toUpperCase()) || []);
        const unique = Array.from(new Set(options));
        if (unique.length === 1) balance = unique[0];
        else if (unique.length > 1) { errors.push({ row: rowNumber, message: `${label}: has ${unique.length} lots here; fill the Lot column to say which` }); continue; }
      }
      if (!balance) { errors.push({ row: rowNumber, message: `${label}: no active lot at this location` }); continue; }
      if (seen.has(balance.lotId)) { errors.push({ row: rowNumber, message: `${label}: lot ${balance.lot.lotNumber} appears twice` }); continue; }
      seen.add(balance.lotId);
      counts.push({ lotId: balance.lotId, counted, book: Number(balance.onHand || 0), sku: balance.lot.product.sku, lot: balance.lot.lotNumber });
    }
    return {
      counts,
      errors: errors.slice(0, 200),
      errorCount: errors.length,
      matchedCount: counts.length,
      varianceCount: counts.filter((count) => count.counted !== count.book).length,
    };
  }
}
