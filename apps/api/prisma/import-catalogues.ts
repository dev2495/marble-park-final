// @ts-nocheck
const path = require('path');
const ExcelJS = require('exceljs');
const { PrismaClient } = require('@prisma/client');
const { ulid } = require('ulid');

const prisma = new PrismaClient();
const root = path.resolve(__dirname, '../../..');

const sources = [
  { file: 'data folder n sample/GROHE CP.xlsx', brand: 'Grohe', sheets: ['Base File ', 'Sheet1'], preferredSheets: ['Base File '] },
  { file: 'data folder n sample/Colour finished -1st June 2025xlsx (2).xlsx', brand: 'Grohe', sheets: 'all' },
  { file: 'data folder n sample/Hansgrohe India Price List  01st May 2025.xlsx', brand: 'Hansgrohe', sheets: 'all' },
  { file: "data folder n sample/Hindware Faucet MRP  Jan'26.xlsx", brand: 'Hindware', sheets: 'all' },
  { file: "data folder n sample/HW SW Jan'26 Price List.xlsx", brand: 'Hindware', sheets: 'all' },
];

const headerAliases = {
  sku: ['material', 'sku code', 'category code', 'product code', 'code', 'trim'],
  name: ['mat desc', 'material description', 'product description', 'description'],
  collection: ['design desc', 'design group', 'hindware range', 'range', 'product type'],
  mrp: ['mrp in inr', 'new mrp', 'mrp new', 'mrp'],
  hsn: ['hsn code'],
  gst: ['gst rate'],
};

function clean(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') {
    if (value.text) return clean(value.text);
    if (value.result !== undefined) return clean(value.result);
    if (value.richText) return value.richText.map((part) => part.text).join('').trim();
    return '';
  }
  return String(value).replace(/\u0000/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeHeader(value) {
  return clean(value).toLowerCase().replace(/[\n\r]+/g, ' ').replace(/\s+/g, ' ').replace(/["']/g, '').trim();
}

function normalizeSku(value, brand) {
  const sku = clean(value).replace(/\.0$/, '').replace(/\s+/g, '').toUpperCase();
  if (!sku || sku === '-' || sku === 'N/A' || sku === '#N/A') return '';
  return `${brand.toUpperCase().slice(0, 3)}-${sku}`;
}

function parseNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = clean(value).replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  return text ? Number(text[0]) : 0;
}

function findHeaderMap(worksheet) {
  for (let rowNumber = 1; rowNumber <= Math.min(worksheet.rowCount, 12); rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    const headers = [];
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      headers[columnNumber] = normalizeHeader(cell.value);
    });

    const map = {};
    for (const [field, aliases] of Object.entries(headerAliases)) {
      const column = headers.findIndex((header) => {
        if (!header) return false;
        return aliases.some((alias) => header === alias || header.includes(alias));
      });
      if (column > 0) map[field] = column;
    }

    if (map.sku && map.name && map.mrp) return { rowNumber, map };
  }
  return null;
}

function inferCategory(name, collection, sheetName) {
  const text = `${name} ${collection} ${sheetName}`.toLowerCase();
  if (/sink|drain board|drainboard|kitchen/.test(text)) return 'Kitchen Sinks';
  if (/wc|ewc|urinal|basin|pedestal|cistern|seat cover|closet|ceramic|sanitary/.test(text)) return 'Sanitaryware';
  if (/tile|porcelain|vitrified|granite|marble slab/.test(text)) return 'Tiles';
  if (/shower|thermostat|diverter|spout|mixer|faucet|tap|body jet|hand shower|headshower|bath/.test(text)) return 'Faucets & Showers';
  if (/accessor|holder|towel|soap|robe|paper|rack|grab bar/.test(text)) return 'Accessories';
  return 'Catalogue Products';
}

function inferFinish(sheetName, name) {
  const text = `${sheetName} ${name}`.toLowerCase();
  if (/matt black|matte black|phantom black/.test(text)) return 'Matt Black';
  if (/chrome| cp\b|cp /.test(text)) return 'Chrome';
  if (/brushed hard graphite|graphite/.test(text)) return 'Brushed Hard Graphite';
  if (/cool sunrise/.test(text)) return text.includes('brushed') || text.includes('matt') ? 'Brushed Cool Sunrise' : 'Cool Sunrise Gloss';
  if (/warm sunset/.test(text)) return text.includes('brushed') || text.includes('matt') ? 'Brushed Warm Sunset' : 'Warm Sunset Gloss';
  if (/super steel/.test(text)) return 'Super Steel';
  if (/moon white|matte white|matt white/.test(text)) return 'Moon White';
  if (/gold|brass/.test(text)) return 'Gold';
  if (/white/.test(text)) return 'White';
  return 'Standard';
}

function firstImage(category) {
  if (category === 'Sanitaryware') return '/catalogue-art/sanitaryware.svg';
  if (category === 'Kitchen Sinks') return '/catalogue-art/sink.svg';
  if (category === 'Tiles') return '/catalogue-art/tile.svg';
  if (category === 'Accessories') return '/catalogue-art/accessory.svg';
  return '/catalogue-art/faucet.svg';
}

async function importWorkbook(source) {
  const filePath = path.join(root, source.file);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheetNames = source.sheets === 'all'
    ? workbook.worksheets.map((worksheet) => worksheet.name)
    : source.preferredSheets || source.sheets;

  let seen = 0;
  let upserted = 0;
  let skipped = 0;
  const failures = [];

  for (const sheetName of sheetNames) {
    const worksheet = workbook.getWorksheet(sheetName);
    if (!worksheet) continue;
    const header = findHeaderMap(worksheet);
    if (!header) {
      failures.push(`${sheetName}: header not found`);
      continue;
    }

    for (let rowNumber = header.rowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber++) {
      const row = worksheet.getRow(rowNumber);
      const sku = normalizeSku(row.getCell(header.map.sku).value, source.brand);
      const name = clean(row.getCell(header.map.name).value);
      const collection = clean(header.map.collection ? row.getCell(header.map.collection).value : '');
      const sellPrice = parseNumber(row.getCell(header.map.mrp).value);
      if (!sku || !name || sellPrice <= 0) {
        skipped++;
        continue;
      }

      seen++;
      const category = inferCategory(name, collection, worksheet.name);
      const finish = inferFinish(worksheet.name, name);
      const hsn = clean(header.map.hsn ? row.getCell(header.map.hsn).value : '');
      const gst = parseNumber(header.map.gst ? row.getCell(header.map.gst).value : 0.18) || 0.18;

      const product = await prisma.product.upsert({
        where: { sku },
        create: {
          id: ulid(),
          sku,
          name,
          category,
          brand: source.brand,
          finish,
          dimensions: '',
          unit: 'PC',
          tags: { collection, hsn, importKind: 'catalogue' },
          sellPrice,
          floorPrice: Math.round(sellPrice * 0.88),
          taxClass: `GST_${Math.round(gst * 100)}`,
          status: 'active',
          media: { primary: firstImage(category), source: 'generated-category-art' },
          sourceRefs: { file: source.file, sheet: worksheet.name, row: rowNumber },
          description: collection ? `${collection} · ${name}` : name,
          updatedAt: new Date(),
        },
        update: {
          name,
          category,
          brand: source.brand,
          finish,
          sellPrice,
          floorPrice: Math.round(sellPrice * 0.88),
          taxClass: `GST_${Math.round(gst * 100)}`,
          media: { primary: firstImage(category), source: 'generated-category-art' },
          sourceRefs: { file: source.file, sheet: worksheet.name, row: rowNumber },
          tags: { collection, hsn, importKind: 'catalogue' },
          description: collection ? `${collection} · ${name}` : name,
          updatedAt: new Date(),
        },
      });

      await prisma.inventoryBalance.upsert({
        where: { productId: product.id },
        create: {
          id: ulid(),
          productId: product.id,
          onHand: 0,
          reserved: 0,
          available: 0,
          damaged: 0,
          hold: 0,
          updatedAt: new Date(),
        },
        update: { updatedAt: new Date() },
      });
      upserted++;
    }
  }

  return { file: source.file, seen, upserted, skipped, failures };
}

async function main() {
  const results = [];
  for (const source of sources) {
    results.push(await importWorkbook(source));
  }
  const count = await prisma.product.count();
  console.log(JSON.stringify({ totalProducts: count, results }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());

export {};
