import { BadRequestException, Injectable } from '@nestjs/common';
import { createHmac } from 'crypto';
import { ulid } from 'ulid';
import { PrismaService } from '../prisma/prisma.service';

const DESIGN_HEADERS = ['Permanent Design Code', 'Design Name', 'Brand', 'Image URL'];
const MAX_DESIGN_ROWS = 5000;

type DesignRow = {
  rowNumber: number;
  designCode: string;
  name: string;
  brand: string;
  imageUrl: string;
  errors: string[];
};

@Injectable()
export class TileDesignImportService {
  constructor(private prisma: PrismaService) {}

  async template() {
    const ExcelJS = require('exceljs');
    const brands = await this.prisma.productBrand.findMany({
      where: { status: 'active' },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { code: true, name: true, description: true },
    });
    if (!brands.length) throw new BadRequestException('Add at least one active Brand Master value before downloading the Tile Design template');

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Marble Park Retail OS';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Tile Designs');
    sheet.addRow(DESIGN_HEADERS.map((header, index) => `${header}${index < 3 ? ' *' : ' (Optional)'}`));
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = { from: 'A1', to: 'D1' };
    sheet.columns = [{ width: 28 }, { width: 42 }, { width: 30 }, { width: 58 }];
    sheet.getRow(1).height = 30;
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).alignment = { vertical: 'middle', wrapText: true };
    DESIGN_HEADERS.forEach((header, index) => {
      const cell = sheet.getCell(1, index + 1);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index < 3 ? 'FF9F2520' : 'FF52525B' } };
      cell.note = index < 3 ? `${header} is required.` : 'Optional public HTTPS image URL. Images can also be added later from the design form.';
    });
    sheet.getColumn(1).numFmt = '@';

    const lists = workbook.addWorksheet('Live Brand Master');
    lists.addRow(['Brand', 'Code', 'Description']);
    brands.forEach((brand) => lists.addRow([brand.name, brand.code || '', brand.description || '']));
    lists.views = [{ state: 'frozen', ySplit: 1 }];
    lists.autoFilter = { from: 'A1', to: `C${Math.max(2, brands.length + 1)}` };
    lists.columns = [{ width: 34 }, { width: 18 }, { width: 55 }];
    lists.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    lists.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF242424' } };
    workbook.definedNames.add(`'Live Brand Master'!$A$2:$A$${brands.length + 1}`, 'TileDesignBrands');
    for (let rowNumber = 2; rowNumber <= MAX_DESIGN_ROWS + 1; rowNumber += 1) {
      sheet.getCell(rowNumber, 3).dataValidation = {
        type: 'list', allowBlank: false, formulae: ['TileDesignBrands'], showErrorMessage: true,
        errorStyle: 'error', errorTitle: 'Choose a live Brand Master value',
        error: 'Use the dropdown. Download a fresh template after Brand Master changes.',
      };
    }

    const instructions = workbook.addWorksheet('How to use');
    instructions.views = [{ showGridLines: false }];
    instructions.mergeCells('A1:D2');
    instructions.getCell('A1').value = 'Marble Park Tile Design Registry import';
    instructions.getCell('A1').font = { size: 20, bold: true, color: { argb: 'FFFFFFFF' } };
    instructions.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF9F2520' } };
    instructions.getCell('A1').alignment = { vertical: 'middle' };
    instructions.addRow([]);
    instructions.addRow(['Step', 'Action', 'Rule']);
    [
      ['1', 'Enter designs', 'Use one row per design family. Code, name and a Brand Master value are required.'],
      ['2', 'Keep variants separate', 'Size, finish, packing, SKU and prices belong in Variant Registry—not Design Registry.'],
      ['3', 'Use the live dropdown', 'The Brand list reflects active Brand Master values when this workbook was downloaded. Download again after masters change.'],
      ['4', 'Preview first', 'The system validates every row. Nothing is written until the preview is clean and an authorised user confirms.'],
      ['5', 'Protect existing designs', 'Import creates new designs only. Existing permanent design codes are blocked and must be edited individually.'],
    ].forEach((row) => instructions.addRow(row));
    instructions.getRow(4).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    instructions.getRow(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF242424' } };
    instructions.columns = [{ width: 10 }, { width: 28 }, { width: 90 }, { width: 2 }];
    instructions.getRows(5, 5)?.forEach((row: any) => { row.height = 38; row.alignment = { vertical: 'middle', wrapText: true }; });

    const example = workbook.addWorksheet('Example - do not import');
    example.addRow(DESIGN_HEADERS);
    example.addRow(['CALACATTA-GOLD', 'Calacatta Gold', brands[0].name, 'https://example.com/catalogue/calacatta-gold.jpg']);
    example.columns = [{ width: 28 }, { width: 42 }, { width: 30 }, { width: 58 }];
    example.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    example.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF242424' } };

    const buffer = await workbook.xlsx.writeBuffer();
    return {
      filename: `marble-park-tile-designs-live-${new Date().toISOString().slice(0, 10)}.xlsx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      contentBase64: Buffer.from(buffer).toString('base64'),
      generatedAt: new Date().toISOString(),
      masterCounts: { brands: brands.length },
    };
  }

  async preview(content: Buffer, actorUserId: string) {
    const plan = await this.plan(content);
    const confirmationToken = plan.failed || !plan.total ? null : this.token(content, actorUserId, plan.rows);
    await this.audit(actorUserId, 'tile_design_import.preview', 'TileDesignImport', 'preview', `Tile design import preview: ${plan.ready} ready, ${plan.failed} failed`, { total: plan.total, ready: plan.ready, failed: plan.failed });
    return {
      source: 'tile-design-excel-preview', status: !plan.total ? 'empty' : plan.failed ? 'needs_correction' : 'ready_to_apply',
      applyMode: 'all_or_nothing', confirmationToken,
      message: !plan.total ? 'No populated Tile Designs rows were found.' : plan.failed ? 'Fix every failed row and preview again. Nothing was written.' : `Preview is clean. Confirm to create ${plan.ready} design(s).`,
      ...this.publicPlan(plan),
    };
  }

  async apply(content: Buffer, actorUserId: string, confirmationToken: string) {
    const plan = await this.plan(content);
    const expectedToken = this.token(content, actorUserId, plan.rows);
    if (!confirmationToken || confirmationToken !== expectedToken) throw new BadRequestException('This workbook changed after preview. Preview it again before applying.');
    if (!plan.total || plan.failed) throw new BadRequestException('Tile Design import cannot be applied until every populated row passes validation');

    const created = await this.prisma.$transaction(async (tx: any) => {
      const now = new Date();
      const rows = plan.rows.map((row) => ({
        id: ulid(), designCode: row.designCode, name: row.name, brand: row.brand,
        collection: null, material: null, surface: null, style: null, colour: null, pattern: null,
        usage: [], origin: null, description: '',
        media: row.imageUrl ? { primaryUrl: row.imageUrl, images: [{ url: row.imageUrl }], source: 'tile-design-excel-import' } : {},
        tags: [], status: 'active', metadata: { source: 'tile-design-excel-import', importedBy: actorUserId }, updatedAt: now,
      }));
      await tx.tileDesign.createMany({ data: rows });
      await tx.auditEvent.createMany({ data: rows.map((row) => ({
        id: ulid(), actorUserId, action: 'tile_design.import.create', entityType: 'TileDesign', entityId: row.id,
        summary: `Imported tile design ${row.designCode}`, metadata: { designCode: row.designCode, brand: row.brand },
      })) });
      return rows.map((row) => ({ id: row.id, designCode: row.designCode, name: row.name, brand: row.brand }));
    }, { timeout: 60000 });
    return { source: 'tile-design-excel-apply', status: 'applied', applied: created.length, created, message: `${created.length} tile design(s) created. Existing designs and commercial stock were not changed.` };
  }

  private async plan(content: Buffer) {
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(content);
    const sheet = workbook.getWorksheet('Tile Designs');
    if (!sheet) throw new BadRequestException('Workbook must contain a Tile Designs sheet. Download a fresh template.');
    const headers = new Map<string, number>();
    sheet.getRow(1).eachCell((cell: any, column: number) => headers.set(this.header(cell.value), column));
    const required = ['permanentdesigncode', 'designname', 'brand'];
    if (required.some((header) => !headers.has(header))) throw new BadRequestException('Tile Designs headers changed. Download a fresh template and keep its column names.');

    const raw: DesignRow[] = [];
    for (let rowNumber = 2; rowNumber <= sheet.actualRowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      const designCode = this.code(this.value(row.getCell(headers.get('permanentdesigncode')!)));
      const name = this.value(row.getCell(headers.get('designname')!));
      const brand = this.value(row.getCell(headers.get('brand')!));
      const imageUrl = headers.has('imageurl') ? this.value(row.getCell(headers.get('imageurl')!)) : '';
      if (![designCode, name, brand, imageUrl].some(Boolean)) continue;
      raw.push({ rowNumber, designCode, name, brand, imageUrl, errors: [] });
      if (raw.length > MAX_DESIGN_ROWS) throw new BadRequestException(`Tile Design imports are limited to ${MAX_DESIGN_ROWS} populated rows`);
    }

    const brands = await this.prisma.productBrand.findMany({ where: { status: 'active' }, select: { name: true } });
    const brandMap = new Map(brands.map((brand) => [brand.name.trim().toLowerCase(), brand.name]));
    const codes = raw.map((row) => row.designCode).filter(Boolean);
    const existing = codes.length ? await this.prisma.tileDesign.findMany({ where: { designCode: { in: codes } }, select: { designCode: true } }) : [];
    const existingCodes = new Set(existing.map((row) => row.designCode));
    const seen = new Set<string>();
    for (const row of raw) {
      if (!row.designCode) row.errors.push('Permanent Design Code is required');
      if (!row.name) row.errors.push('Design Name is required');
      if (!row.brand) row.errors.push('Brand is required');
      const canonicalBrand = brandMap.get(row.brand.toLowerCase());
      if (row.brand && !canonicalBrand) row.errors.push('Brand is not an active Brand Master value');
      if (canonicalBrand) row.brand = canonicalBrand;
      if (seen.has(row.designCode)) row.errors.push('Design code is duplicated in this workbook');
      if (existingCodes.has(row.designCode)) row.errors.push('Design code already exists and cannot be overwritten by import');
      if (row.imageUrl && !/^https:\/\//i.test(row.imageUrl)) row.errors.push('Image URL must be a public HTTPS URL');
      seen.add(row.designCode);
    }
    return { rows: raw, total: raw.length, ready: raw.filter((row) => !row.errors.length).length, failed: raw.filter((row) => row.errors.length).length };
  }

  private publicPlan(plan: any) {
    return { total: plan.total, ready: plan.ready, failed: plan.failed, rows: plan.rows.map((row: DesignRow) => ({ rowNumber: row.rowNumber, designCode: row.designCode, name: row.name, brand: row.brand, imageUrl: row.imageUrl, errors: row.errors })) };
  }

  private token(content: Buffer, actorUserId: string, rows: DesignRow[]) {
    const secret = process.env.IMPORT_CONFIRMATION_SECRET || process.env.SESSION_SECRET || process.env.JWT_SECRET || 'marble-park-local-import-confirmation';
    const hmac = createHmac('sha256', secret);
    hmac.update(actorUserId); hmac.update('\0'); hmac.update(content); hmac.update('\0');
    hmac.update(JSON.stringify(rows.map(({ rowNumber, designCode, name, brand, imageUrl }) => ({ rowNumber, designCode, name, brand, imageUrl }))));
    return hmac.digest('hex');
  }

  private header(value: any) { return this.value({ value }).replace(/\s*\((optional|required)\)\s*/gi, '').replace(/\s*\*\s*$/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
  private code(value: string) { return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80); }
  private value(cell: any) {
    const value = cell?.value;
    if (value === undefined || value === null) return '';
    if (typeof value === 'object') {
      if ('text' in value) return String(value.text || '').trim();
      if ('result' in value) return String(value.result || '').trim();
      if (Array.isArray(value.richText)) return value.richText.map((part: any) => part.text || '').join('').trim();
    }
    return String(value).trim();
  }

  private async audit(actorUserId: string, action: string, entityType: string, entityId: string, summary: string, metadata: any) {
    await this.prisma.auditEvent.create({ data: { id: ulid(), actorUserId, action, entityType, entityId, summary, metadata } });
  }
}
