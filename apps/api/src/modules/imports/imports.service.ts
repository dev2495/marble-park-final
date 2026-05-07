import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ulid } from 'ulid';

@Injectable()
export class ImportsService {
  constructor(private prisma: PrismaService, private notifications: NotificationsService) {}

  async processExcelImport(filePath: string, uploadedBy = 'system'): Promise<any> {
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new Error('Excel workbook has no sheets');
    }

    const headers: string[] = [];
    worksheet.getRow(1).eachCell((cell: any, colNumber: number) => {
      headers[colNumber] = String(cell.value || '').trim();
    });

    const rows: any[] = [];
    worksheet.eachRow((row: any, rowNumber: number) => {
      if (rowNumber === 1) return;
      const data: any = {};
      row.eachCell((cell: any, colNumber: number) => {
        const header = headers[colNumber] || `Column ${colNumber}`;
        data[header] = typeof cell.value === 'object' && cell.value?.text ? cell.value.text : cell.value;
      });
      if (Object.values(data).some((value) => value !== undefined && value !== null && value !== '')) {
        rows.push(data);
      }
    });

    return this.stageRows(rows, filePath, uploadedBy, 'excel');
  }

  async processPdfImport(filePath: string, uploadedBy = 'system'): Promise<any> {
    let PDFParse;
    try {
      PDFParse = require('pdf-parse').PDFParse;
    } catch (e) {
      console.warn("pdf-parse not found, AI fallback requires text extraction layer.");
      throw new Error("PDF processing requires pdf-parse to be available");
    }

    const fs = require('fs');
    const dataBuffer = fs.readFileSync(filePath);
    const parser = new PDFParse({ data: dataBuffer });
    const pdfData = await parser.getText();
    await parser.destroy();
    
    const heuristicRows = this.extractPdfProductRows(pdfData.text, filePath);
    if (heuristicRows.length > 0) {
      return this.stageRows(heuristicRows, filePath, uploadedBy, 'pdf-heuristic', true);
    }

    // AI fallback is intentionally second. Most price catalogues have a repeatable
    // SKU/description/MRP structure, and deterministic extraction avoids stale or partial AI output.
    try {
      const { OpenAI } = require('openai');
      if (!process.env.OPENAI_API_KEY) throw new Error('NO_API_KEY');
      
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const completion = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          { role: "system", content: "Extract a product catalog array from the text. Return ONLY valid JSON array with keys: SKU, name, category, brand, mrp." },
          { role: "user", content: pdfData.text.substring(0, 8000) }
        ]
      });

      const structuredItems = JSON.parse(completion.choices[0].message?.content || "[]");
      return this.stageRows(structuredItems, filePath, uploadedBy, 'pdf-ai', true);
    } catch (apiError) {
       return { source: "PDF-Extraction-Failed", totalFound: 0, textLength: pdfData.text.length };
    }
  }

  private extractPdfProductRows(text: string, filePath: string): any[] {
    const normalizedText = text.replace(/\u0000/g, ' ').replace(/[ \t]+/g, ' ');
    const lines = normalizedText.split('\n').map((line) => line.trim()).filter(Boolean);
    const items: any[] = [];
    const seen = new Set<string>();
    const brand = this.detectBrandFromPdf(filePath, normalizedText);
    let currentCategory = this.guessPdfCategory(filePath, '', 'Catalogue Products');

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const headingCategory = this.guessPdfCategory(filePath, line);
      if (headingCategory) currentCategory = headingCategory;
      if (!this.isLikelyCatalogueSku(line)) continue;

      const sku = line.replace(/\s+/g, '').replace(/-$/, '').toUpperCase();
      if (seen.has(sku)) continue;
      const window = lines.slice(index + 1, Math.min(index + 8, lines.length));
      const mrpLineIndex = window.findIndex((candidate) => /MRP/i.test(candidate) && this.extractPrice(candidate) > 0);
      if (mrpLineIndex === -1) continue;
      const descriptionLines = window
        .slice(0, mrpLineIndex)
        .filter((candidate) => !this.isLikelyCatalogueSku(candidate))
        .filter((candidate) => !/^(Size|Flow|MRP|Page|Note|Image|Description|Qty|Total)\b/i.test(candidate))
        .filter((candidate) => !/^-- \d+ of \d+ --$/.test(candidate));
      const price = this.extractPrice(window[mrpLineIndex]);
      const name = (descriptionLines[0] || '').replace(/[●`:-]+/g, ' ').trim();
      const range = (descriptionLines[1] || '').replace(/[●`:-]+/g, ' ').trim();
      if (sku && name && price > 0) {
        seen.add(sku);
        items.push({
          SKU: sku,
          name,
          Category: currentCategory || this.guessPdfCategory(filePath, name, 'Catalogue Products'),
          Brand: brand,
          Finish: this.guessFinish(`${name} ${range}`),
          Range: range,
          MRP: price,
          Description: [name, range].filter(Boolean).join(' - '),
        });
      }
    }

    return items;
  }

  private isLikelyCatalogueSku(line: string) {
    const value = String(line || '').trim().replace(/\s+/g, '');
    if (!/^(?=.{5,32}$)(?=.*\d)(?=.*[A-Z])[A-Z0-9][A-Z0-9-]*[A-Z0-9]$/.test(value)) return false;
    if (/^(PAGE|MRP|PRICE|TOTAL|QTY|SKU|CODE)$/i.test(value)) return false;
    return true;
  }

  private extractPrice(line: string) {
    const match = String(line || '').match(/(?:MRP|PRICE|RS\.?|₹|`)?\s*([0-9]{1,3}(?:,[0-9]{2,3})+|[0-9]{4,})(?:\.\d+)?/i);
    return match ? Number(match[1].replace(/,/g, '')) : 0;
  }

  private detectBrandFromPdf(filePath: string, text: string) {
    const source = `${filePath} ${text.slice(0, 2000)}`.toLowerCase();
    if (source.includes('american standard')) return 'American Standard';
    if (source.includes('hansgrohe')) return 'Hansgrohe';
    if (source.includes('grohe')) return 'Grohe';
    if (source.includes('hindware')) return 'Hindware';
    if (source.includes('aquant')) return 'Aquant';
    return 'Imported PDF';
  }

  private guessPdfCategory(filePath: string, line: string, fallback?: string) {
    const source = `${filePath} ${line}`.toLowerCase();
    if (/tile|tiles/.test(source)) return 'Tiles';
    if (/toilet|wc|closet|cistern|bidet|urinal/.test(source)) return 'Sanitaryware';
    if (/basin|wash basin|counter top|pedestal/.test(source)) return 'Basins';
    if (/thermostat|shower|faucet|mixer|tap|spout|diverter|bath area|kitchen area/.test(source)) return 'Faucets & Showers';
    if (/sink/.test(source)) return 'Sinks';
    if (/accessor|rack|holder|robe hook|soap|towel/.test(source)) return 'Accessories';
    if (/bathtub|bath tub/.test(source)) return 'Bathtubs';
    return fallback;
  }

  private guessFinish(text: string) {
    const value = String(text || '').toLowerCase();
    if (/\b(cp|chrome)\b/.test(value)) return 'Chrome';
    if (/\b(wh|white)\b/.test(value)) return 'White';
    if (/matte black|\bmb\b|black/.test(value)) return 'Matte Black';
    if (/gold|cool sunrise|sunrise/.test(value)) return 'Gold';
    if (/steel|stainless|ss\b/.test(value)) return 'Stainless Steel';
    return 'Standard';
  }

  async listBatches() {
    return this.prisma.importBatch.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
  }

  async listRows(importBatchId: string) {
    return this.prisma.importRow.findMany({ where: { importBatchId }, orderBy: { createdAt: 'asc' }, take: 500 });
  }

  async updateImportRow(id: string, input: any) {
    const row = await this.prisma.importRow.findUnique({ where: { id } });
    if (!row) throw new Error('Import row not found');
    const normalized = {
      ...((row.normalized as any) || {}),
      ...Object.fromEntries(
        Object.entries(input || {}).filter(([, value]) => value !== undefined && value !== null && value !== ''),
      ),
    };
    const status = this.hasRequiredImportMasters(normalized) ? 'pending' : 'needs_review';
    const updated = await this.prisma.importRow.update({
      where: { id },
      data: {
        brand: normalized.brand || row.brand || 'Unknown',
        categoryCode: normalized.category || row.categoryCode || null,
        sku: normalized.sku || row.sku || null,
        description: normalized.name || normalized.description || row.description || '',
        newMrp: Number(normalized.sellPrice || row.newMrp || 0),
        normalized,
        status,
        updatedAt: new Date(),
      },
    });
    await this.refreshBatchReviewSummary(row.importBatchId);
    return updated;
  }

  async applyImportBatch(importBatchId: string) {
    const batch = await this.prisma.importBatch.findUnique({ where: { id: importBatchId } });
    if (!batch) throw new Error('Import batch not found');
    if (batch.status !== 'approved') {
      throw new Error('Import batch needs owner approval before applying');
    }
    const rows = await this.prisma.importRow.findMany({ where: { importBatchId, status: 'pending' } });
    let applied = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        const normalized = row.normalized || row.raw;
        const product = await this.processProductRow(normalized);
        await this.prisma.importRow.update({
          where: { id: row.id },
          data: { status: 'applied', mappedProductId: product.id, updatedAt: new Date() },
        });
        applied++;
      } catch (error: any) {
        await this.prisma.importRow.update({
          where: { id: row.id },
          data: {
            status: 'failed',
            normalized: { ...(row.normalized as any || {}), error: error.message },
            updatedAt: new Date(),
          },
        });
        failed++;
      }
    }
    await this.prisma.importBatch.update({
      where: { id: importBatchId },
      data: { status: failed ? 'applied_with_errors' : 'applied', summary: { applied, failed }, updatedAt: new Date() },
    });
    return { importBatchId, applied, failed };
  }

  async submitImportBatchForApproval(importBatchId: string, actorUserId: string) {
    const reviewCount = await this.prisma.importRow.count({ where: { importBatchId, status: 'needs_review' } });
    if (reviewCount > 0) {
      throw new Error(`Fill brand, category, finish, SKU and name for ${reviewCount} import row(s) before owner approval`);
    }
    const batch = await this.prisma.importBatch.update({
      where: { id: importBatchId },
      data: {
        status: 'pending_approval',
        summary: { submittedBy: actorUserId, submittedAt: new Date().toISOString(), approvalType: 'catalogue_import' },
        updatedAt: new Date(),
      },
    });
    await this.prisma.auditEvent.create({
      data: {
        id: ulid(),
        actorUserId,
        action: 'import.submit_approval',
        entityType: 'ImportBatch',
        entityId: importBatchId,
        summary: `Submitted import batch ${importBatchId} for owner approval`,
        metadata: { rowCount: batch.rowCount, brand: batch.brand },
      },
    }).catch(() => {});
    await this.notifications.createMany([
      {
        title: 'Catalogue import needs approval',
        message: `${batch.brand || 'Import batch'} has ${batch.rowCount} row(s) ready for owner approval.`,
        type: 'approval',
        entityType: 'ImportBatch',
        entityId: importBatchId,
        href: '/dashboard/approvals',
        targetRole: 'owner',
        metadata: { rowCount: batch.rowCount, brand: batch.brand },
      },
      {
        title: 'Catalogue import needs approval',
        message: `${batch.brand || 'Import batch'} has ${batch.rowCount} row(s) ready for admin approval.`,
        type: 'approval',
        entityType: 'ImportBatch',
        entityId: importBatchId,
        href: '/dashboard/approvals',
        targetRole: 'admin',
        metadata: { rowCount: batch.rowCount, brand: batch.brand },
      },
    ]);
    return batch;
  }

  async approveImportBatch(importBatchId: string, actorUserId: string, note?: string) {
    const batch = await this.prisma.importBatch.update({
      where: { id: importBatchId },
      data: {
        status: 'approved',
        summary: { approvedBy: actorUserId, approvedAt: new Date().toISOString(), note: note || '' },
        updatedAt: new Date(),
      },
    });
    await this.prisma.auditEvent.create({
      data: {
        id: ulid(),
        actorUserId,
        action: 'import.approve',
        entityType: 'ImportBatch',
        entityId: importBatchId,
        summary: `Approved import batch ${importBatchId}`,
        metadata: { note },
      },
    }).catch(() => {});
    return batch;
  }

  private async stageRows(rows: any[], filePath: string, uploadedBy: string, kind: string, extractImages = false) {
    const sourceFile = await this.prisma.sourceFile.upsert({
      where: { path: filePath },
      update: { status: 'parsed', updatedAt: new Date(), metadata: { kind, rowCount: rows.length } },
      create: {
        id: ulid(),
        kind,
        name: require('path').basename(filePath),
        path: filePath,
        uploadedBy,
        status: 'parsed',
        metadata: { rowCount: rows.length },
        updatedAt: new Date(),
      },
    });

    const batch = await this.prisma.importBatch.create({
      data: {
        id: ulid(),
        sourceFileId: sourceFile.id,
        brand: this.detectBrand(rows),
        rowCount: rows.length,
        status: 'pending_review',
        summary: { staged: rows.length, kind },
        updatedAt: new Date(),
      },
    });

    for (const row of rows) {
      const normalized = this.normalizeProductRow(row);
      const status = this.hasRequiredImportMasters(normalized) ? 'pending' : 'needs_review';
      await this.prisma.importRow.create({
        data: {
          id: ulid(),
          sourceFileId: sourceFile.id,
          importBatchId: batch.id,
          brand: normalized.brand || 'Unknown',
          range: normalized.range || null,
          categoryCode: normalized.category || null,
          sku: normalized.sku || null,
          description: normalized.name || normalized.description || '',
          newMrp: normalized.sellPrice || 0,
          raw: row,
          normalized,
          status,
          updatedAt: new Date(),
        },
      });
    }

    const imageTasks = extractImages ? await this.stagePdfImageReviewTasks(filePath, sourceFile.id) : 0;
    await this.refreshBatchReviewSummary(batch.id, imageTasks);
    return { source: kind, importBatchId: batch.id, total: rows.length, staged: rows.length, imageTasks, status: 'pending_review' };
  }

  private async stagePdfImageReviewTasks(filePath: string, sourceFileId: string) {
    try {
      const fs = require('fs');
      const path = require('path');
      const crypto = require('crypto');
      const { PNG } = require('pngjs');
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const publicDir = process.env.CATALOGUE_IMPORT_IMAGE_DIR || path.resolve(process.cwd(), '../../apps/web/public/catalogue-images/imports');
      const publicBaseUrl = String(process.env.PUBLIC_CATALOGUE_IMAGE_BASE_URL || '').replace(/\/+$/, '');
      fs.mkdirSync(publicDir, { recursive: true });
      const bytes = new Uint8Array(fs.readFileSync(filePath));
      const pdf = await pdfjs.getDocument({ data: bytes }).promise;
      let created = 0;
      const maxPages = Math.min(pdf.numPages, 12);
      const seen = new Set<string>();
      for (let pageNumber = 1; pageNumber <= maxPages && created < 30; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const operatorList = await page.getOperatorList();
        for (let opIndex = 0; opIndex < operatorList.fnArray.length && created < 30; opIndex += 1) {
          const fn = operatorList.fnArray[opIndex];
          const args = operatorList.argsArray[opIndex];
          if (fn !== pdfjs.OPS.paintImageXObject && fn !== pdfjs.OPS.paintInlineImageXObject) continue;
          const imageId = args?.[0];
          let image: any;
          try {
            image = typeof imageId === 'string'
              ? await new Promise<any>((resolve, reject) => {
                  const timer = setTimeout(() => reject(new Error('image extract timeout')), 5000);
                  page.objs.get(imageId, (img: any) => { clearTimeout(timer); resolve(img); });
                })
              : imageId;
          } catch {
            continue;
          }
          if (!image?.data || image.width < 250 || image.height < 180) continue;
          const png = new PNG({ width: image.width, height: image.height });
          const source = image.data;
          if (image.kind === pdfjs.ImageKind.RGBA_32BPP) {
            Buffer.from(source).copy(png.data);
          } else if (image.kind === pdfjs.ImageKind.RGB_24BPP) {
            for (let i = 0, j = 0; i < source.length; i += 3, j += 4) {
              png.data[j] = source[i]; png.data[j + 1] = source[i + 1]; png.data[j + 2] = source[i + 2]; png.data[j + 3] = 255;
            }
          } else {
            continue;
          }
          const buffer = PNG.sync.write(png);
          const hash = crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 12);
          if (seen.has(hash)) continue;
          seen.add(hash);
          const fileName = `${path.basename(filePath, path.extname(filePath)).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-p${pageNumber}-${hash}.png`;
          fs.writeFileSync(path.join(publicDir, fileName), buffer);
          await this.prisma.catalogReviewTask.create({
            data: {
              id: ulid(),
              sourceFileId,
              pageNumber,
              imagePath: path.join(publicDir, fileName),
              imageUrl: `${publicBaseUrl}/catalogue-images/imports/${fileName}`,
              status: 'needs_mapping',
              confidence: 0.5,
              raw: { width: image.width, height: image.height, hash },
              updatedAt: new Date(),
            },
          });
          created += 1;
        }
      }
      await pdf.destroy();
      return created;
    } catch (error) {
      return 0;
    }
  }

  private normalizeProductRow(data: any) {
    const pick = (...keys: string[]) => keys.map((key) => data[key]).find((value) => value !== undefined && value !== null && value !== '');
    const price = pick('MRP', 'Price', 'SELL PRICE', 'Sell Price', 'mrp', 'MRP INR', 'MRP(INR)', 'List Price', 'Amount');
    return {
      sku: pick('SKU', 'sku', 'Code', 'PRODUCT CODE', 'Product Code', 'Item Code', 'Article No', 'Model No'),
      name: pick('PRODUCT DESCRIPTION', 'Description', 'Product', 'Product Name', 'Item Name', 'name'),
      category: pick('Category', 'CATEGORY', 'Product Category') || 'Uncategorized',
      brand: pick('Brand', 'BRAND', 'Make') || 'Unknown',
      finish: pick('Finish', 'FINISH', 'Color', 'Colour') || '',
      dimensions: pick('Dimensions', 'DIMENSIONS', 'Size') || '',
      sellPrice: parseFloat(String(price || 0).replace(/,/g, '')),
      description: pick('Description', 'PRODUCT DESCRIPTION', 'Long Description') || '',
      range: pick('Range', 'RANGE', 'Series', 'Collection') || '',
    };
  }

  private hasRequiredImportMasters(data: any) {
    const category = String(data.category || '').trim();
    const brand = String(data.brand || '').trim();
    const finish = String(data.finish || '').trim();
    return Boolean(
      String(data.sku || '').trim() &&
      String(data.name || data.description || '').trim() &&
      category &&
      brand &&
      finish &&
      category.toLowerCase() !== 'uncategorized' &&
      brand.toLowerCase() !== 'unknown',
    );
  }

  private async refreshBatchReviewSummary(importBatchId: string, imageTasks = 0) {
    const [needsReview, ready] = await Promise.all([
      this.prisma.importRow.count({ where: { importBatchId, status: 'needs_review' } }),
      this.prisma.importRow.count({ where: { importBatchId, status: 'pending' } }),
    ]);
    await this.prisma.importBatch.update({
      where: { id: importBatchId },
      data: {
        summary: { needsReview, ready, imageTasks },
        updatedAt: new Date(),
      },
    }).catch(() => {});
  }

  private detectBrand(rows: any[]) {
    const first = rows.find(Boolean) || {};
    return first.Brand || first.BRAND || first.brand || 'Mixed';
  }

  private async processProductRow(data: any): Promise<any> {
    const normalized = this.normalizeProductRow(data);
    const { sku, name, category, brand, finish, dimensions, sellPrice } = normalized;

    if (!sku || !name) {
      throw new Error('SKU and Name are required');
    }

    const existing = await this.prisma.product.findUnique({ where: { sku } });

    if (existing) {
      return this.prisma.product.update({
        where: { sku },
        data: { sellPrice },
      });
    } else {
      await this.ensureProductMasters(category, brand, finish);
      return this.prisma.product.create({
        data: {
          id: ulid(),
          sku,
          name,
          category,
          brand,
          finish,
          dimensions,
          sellPrice,
          unit: 'PC',
          status: 'active',
          tags: {},
          media: {},
          sourceRefs: {},
          floorPrice: sellPrice * 0.9,
          taxClass: 'STANDARD',
          description: data['Description'] || data['PRODUCT DESCRIPTION'] || '',
          updatedAt: new Date(),
        } as any,
      });
    }
  }

  private async ensureProductMasters(category: string, brand: string, finish: string) {
    const now = new Date();
    const code = (value: string) => String(value || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32);
    if (category) {
      await this.prisma.productCategory.upsert({
        where: { name: category },
        update: { status: 'active', updatedAt: now },
        create: { id: ulid(), name: category, code: code(category), description: 'Created from approved import', status: 'active', sortOrder: 100, metadata: { source: 'import-approval' }, updatedAt: now },
      });
    }
    if (brand) {
      await this.prisma.productBrand.upsert({
        where: { name: brand },
        update: { status: 'active', updatedAt: now },
        create: { id: ulid(), name: brand, code: code(brand), description: 'Created from approved import', status: 'active', sortOrder: 100, metadata: { source: 'import-approval' }, updatedAt: now },
      });
    }
    if (finish) {
      await this.prisma.productFinish.upsert({
        where: { name: finish },
        update: { status: 'active', updatedAt: now },
        create: { id: ulid(), name: finish, code: code(finish), description: 'Created from approved import', status: 'active', sortOrder: 100, metadata: { source: 'import-approval' }, updatedAt: now },
      });
    }
  }
}
