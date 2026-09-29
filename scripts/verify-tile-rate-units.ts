import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QuotesService } from '../apps/api/src/modules/quotes/quotes.service';
import { OperationsService } from '../apps/api/src/modules/operations/operations.service';
import { ImportsService } from '../apps/api/src/modules/imports/imports.service';
import { ProductsService } from '../apps/api/src/modules/products/products.service';
import { priceQuoteLines } from '../apps/api/src/modules/common/pricing';
import { convertTileRate, tileCoveragePerPack, tilePricingChoice } from '../apps/api/src/modules/common/tile-pricing-unit';

const near = (actual: number, expected: number, tolerance = 0.0001) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be within ${tolerance} of ${expected}`);
};

const baseTile = {
  status: 'active', category: 'Tiles', brand: 'Regression', dimensions: '1000 x 1000 mm',
  unit: 'BOX', purchaseUom: 'BOX', salesUom: 'BOX', piecesPerPack: 2,
  coveragePerPack: 20, defaultMrpInclusive: 100, defaultNrpInclusive: 80,
  media: {},
};

const sqmTile = { ...baseTile, id: 'tile-sqm', sku: 'TILE-SQM', name: 'Square metre tile', priceRateBasis: 'AREA', priceUom: 'SQM' };
const pieceTile = { ...baseTile, id: 'tile-pc', sku: 'TILE-PC', name: 'Piece tile', priceRateBasis: 'PIECE', priceUom: 'PC' };

function quoteService(productRows = [sqmTile, pieceTile]) {
  const products = new Map(productRows.map((product) => [product.id, product]));
  const prisma = {
    product: {
      findMany: async ({ where }: any) => (where.id.in as string[]).map((id) => products.get(id)).filter(Boolean),
    },
  };
  return new QuotesService(prisma as any, null as any, null as any, null as any) as any;
}

test('tile conversion uses governed square feet per pack and rejects incompatible basis', () => {
  assert.deepEqual(tilePricingChoice('AREA', 'SQM'), { priceRateBasis: 'AREA', priceUom: 'SQM' });
  assert.deepEqual(tilePricingChoice('PIECE', 'PC'), { priceRateBasis: 'PIECE', priceUom: 'PC' });
  near(tileCoveragePerPack(20, 'SQM'), 1.8580608);
  near(convertTileRate(100, 'SQM', 'PC', 20, 2), 92.9, 0.001);
  near(convertTileRate(100, 'PC', 'SQM', 20, 2), 107.64, 0.001);
  assert.throws(() => tilePricingChoice('PIECE', 'SQM'), /AREA/);
  assert.throws(() => convertTileRate(100, 'SQM', 'PC', 0, 2), /coverage/i);
});

test('square metre tile quote keeps stock packs distinct from priced area', async () => {
  const [line] = await quoteService().assertQuoteLines([{
    productId: sqmTile.id, category: 'Tiles', tileCode: sqmTile.sku, tileSize: sqmTile.dimensions,
    requestedArea: 5, wastagePercent: 10, qty: 1, inventoryUom: 'BOX',
    // A stale client must not override the confirmed Product Master unit.
    rateBasis: 'PIECE', pricingUom: 'PC',
  }], 'quote creation', true);
  assert.equal(line.rateBasis, 'AREA');
  assert.equal(line.pricingUom, 'SQM');
  assert.equal(line.inventoryUom, 'BOX');
  assert.equal(line.qty, 3);
  near(line.pricingCoveragePerPack, 20 * 0.09290304);
  near(line.pricingQuantity, 3 * 20 * 0.09290304);
  const priced = priceQuoteLines([line]);
  assert.equal(priced.lines[0].pricingUom, 'SQM');
  assert.equal(priced.lines[0].quantity, 3);
  near(priced.lines[0].pricingQuantity, 5.5741824, 0.00001);
  near(priced.totals.grandTotal, 445.93, 0.02);
});

test('piece tile quote rounds requested pieces to stock packs and bills supplied pieces', async () => {
  const [line] = await quoteService().assertQuoteLines([{
    productId: pieceTile.id, category: 'Tiles', tileCode: pieceTile.sku, tileSize: pieceTile.dimensions,
    requestedPieces: 3, qty: 1, inventoryUom: 'BOX',
  }], 'quote creation', true);
  assert.equal(line.rateBasis, 'PIECE');
  assert.equal(line.pricingUom, 'PC');
  assert.equal(line.inventoryUom, 'BOX');
  assert.equal(line.qty, 2);
  assert.equal(line.pricingQuantity, 4);
  const priced = priceQuoteLines([line]);
  assert.equal(priced.lines[0].quantity, 2);
  assert.equal(priced.lines[0].pricingQuantity, 4);
  assert.equal(priced.totals.grandTotal, 320);
});

test('a historical SQFT quote keeps its saved rate after the master changes to SQM', async () => {
  const [line] = await quoteService().assertQuoteLines([{
    productId: sqmTile.id, category: 'Tiles', tileCode: sqmTile.sku, tileSize: sqmTile.dimensions,
    qty: 2, unit: 'BOX', inventoryUom: 'BOX', piecesPerPack: 2, coveragePerPack: 15.5,
    rateBasis: 'AREA', pricingUom: 'SQFT', mrpInclusive: 65,
    nrpMode: 'FIXED_NRP', nrpInput: 55,
  }], 'historical quote readback', false);
  assert.equal(line.pricingUom, 'SQFT');
  assert.equal(line.rateBasis, 'AREA');
  assert.equal(line.coveragePerPack, 15.5);
  assert.equal(line.mrpInclusive, 65);
  assert.equal(line.nrpInput, 55);
  assert.equal(line.pricingQuantity, 31);
  assert.equal(priceQuoteLines([line]).totals.grandTotal, 1705);
});

test('tiles stocked in PC bill pieces or converted SQM without rounding stock into packs', async () => {
  const stockPc = {
    ...pieceTile, id: 'tile-stock-pc', sku: 'TILE-STOCK-PC',
    unit: 'PC', purchaseUom: 'PC', salesUom: 'PC', piecesPerPack: 2, coveragePerPack: 20,
  };
  const service = quoteService([stockPc]);
  const [pieces] = await service.assertQuoteLines([{
    productId: stockPc.id, category: 'Tiles', tileCode: stockPc.sku,
    tileSize: stockPc.dimensions, requestedPieces: 3, qty: 1,
  }], 'quote creation', true);
  assert.equal(pieces.inventoryUom, 'PC');
  assert.equal(pieces.piecesPerPack, 1);
  assert.equal(pieces.coveragePerPack, 10);
  assert.equal(pieces.qty, 3);
  assert.equal(pieces.pricingQuantity, 3);

  const areaProduct = { ...stockPc, priceRateBasis: 'AREA', priceUom: 'SQM' };
  const [area] = await quoteService([areaProduct]).assertQuoteLines([{
    productId: areaProduct.id, category: 'Tiles', tileCode: areaProduct.sku,
    tileSize: areaProduct.dimensions, requestedArea: 3, qty: 1,
  }], 'quote creation', true);
  assert.equal(area.inventoryUom, 'PC');
  assert.equal(area.piecesPerPack, 1);
  assert.equal(area.coveragePerPack, 10);
  assert.equal(area.pricingUom, 'SQM');
  assert.equal(area.qty, 4);
  near(area.pricingQuantity, 4 * 10 * 0.09290304, 0.00001);
});

test('Excel import accepts PC and SQM tiles while keeping coverage stored in SQFT', () => {
  const imports = new ImportsService(null as any, null as any) as any;
  const row = {
    'SKU': 'TILE-IMPORT-1', 'Internal Code': 'TI-1', 'Product Name': 'Imported tile',
    'Category': 'Tiles', 'Brand': 'Regression', 'Finish': 'Matt',
    'Tile Design Code': 'DESIGN-1', 'Tile Design Name': 'Design one',
    'Pieces Per Pack': 2, 'Default MRP Incl GST': 100, 'Default NRP Incl GST': 80,
    'MRP Source': 'MANUAL', 'Pricing Effective From': '2026-09-28', 'Tax Code': 'GST_18',
  };
  const sqm = imports.normalizeProductRow({ ...row, 'Price Basis': 'AREA', 'Price UOM': 'SQM', 'SQM/BOX': 2 });
  near(sqm.coveragePerPack, 2 / 0.09290304);
  assert.deepEqual(imports.validateNormalizedRow(sqm), []);
  const pc = imports.normalizeProductRow({ ...row, 'Price Basis': 'PIECE', 'Price UOM': 'PC' });
  assert.equal(pc.coveragePerPack, 0);
  assert.deepEqual(imports.validateNormalizedRow(pc), []);
  const invalid = imports.normalizeProductRow({ ...row, 'Price Basis': 'AREA', 'Price UOM': 'PC' });
  assert.match(imports.validateNormalizedRow(invalid).join(' '), /PIECE/);
});

test('changing a tile rate unit requires explicit values and records a governed revision', async () => {
  let stored: any = {
    ...sqmTile, id: 'tile-switch', defaultMrpInclusive: 100, defaultNrpInclusive: 80,
    floorPriceInclusive: 70, mrpSource: 'MANUAL', pricingEffectiveFrom: new Date('2026-09-01'),
    updatedAt: new Date('2026-09-01'),
  };
  const history: any[] = [];
  const prisma = {
    product: { findUnique: async () => ({ ...stored }) },
    $transaction: async (callback: (tx: any) => Promise<any>) => callback({
      product: {
        updateMany: async ({ data }: any) => { stored = { ...stored, ...data }; return { count: 1 }; },
        findUniqueOrThrow: async () => ({ ...stored }),
      },
      productMrpHistory: { create: async ({ data }: any) => { history.push(data); return data; } },
      auditEvent: { create: async () => ({}) },
    }),
  };
  const service = new ProductsService(prisma as any, null as any);
  await assert.rejects(
    service.update(stored.id, { priceRateBasis: 'PIECE', priceUom: 'PC' }, 'test-actor'),
    /explicit MRP, NRP, and floor price/i,
  );
  const revised = {
    priceRateBasis: 'PIECE', priceUom: 'PC', defaultMrpInclusive: 100,
    defaultNrpInclusive: 80, floorPriceInclusive: 70,
  };
  await assert.rejects(service.update(stored.id, revised, 'test-actor'), /reason/i);
  await service.update(stored.id, { ...revised, mrpChangeReason: 'Approved per-piece rate' }, 'test-actor');
  assert.equal(stored.priceRateBasis, 'PIECE');
  assert.equal(stored.priceUom, 'PC');
  assert.equal(history.length, 1);
  assert.equal(history[0].metadata.changeKind, 'rate_unit_revision');
  assert.equal(history[0].metadata.previousPriceUom, 'SQM');
  assert.equal(Number(history[0].previousMrpInclusive), 100);
  assert.equal(Number(history[0].newMrpInclusive), 100);
});

test('stickers print the live master rate in the master rate unit', async () => {
  const product: any = { ...sqmTile };
  const job = { id: 'job-1', jobNumber: 'LB/2026/0001', sourceType: 'product', metadata: {} };
  const instance = {
    id: 'label-1', labelCode: 'LB/2026/0001-0001', labelJobId: job.id,
    labelJob: job, product, status: 'active', metadata: {},
    lot: null, displaySample: null,
  };
  const run = {
    id: 'run-1', labelJobId: job.id, templateCode: 'thermal_4x2', templateVersion: 4,
    selectedLabelIds: [instance.id], copies: 2, status: 'prepared',
    metadata: { labelSize: '4x2_in', orientation: 'landscape' },
  };
  const prisma = {
    internalLabelPrintRun: { findUnique: async () => run },
    internalLabelTemplate: { findUnique: async () => ({
      code: 'thermal_4x2', version: 4, definition: { orientation: 'landscape' },
      widthMm: 101.6, heightMm: 50.8, pageWidthMm: 101.6, pageHeightMm: 50.8,
    }) },
    internalLabelInstance: { findMany: async () => [instance] },
    productBrand: { findMany: async () => [] },
  };
  const service = new OperationsService(prisma as any, null as any);
  const cases = [
    { priceRateBasis: 'AREA', priceUom: 'SQM', mrp: 850, basis: 'AREA', uom: 'SQM' },
    { priceRateBasis: 'PIECE', priceUom: 'PC', mrp: 1200, basis: 'PIECE', uom: 'PC' },
    { priceRateBasis: 'AREA', priceUom: 'SQFT', mrp: 85, basis: 'AREA', uom: 'SQFT' },
    { priceRateBasis: 'AREA', priceUom: 'M2', mrp: 90, basis: 'AREA', uom: 'SQM' },
    { priceRateBasis: null, priceUom: null, mrp: 70, basis: 'AREA', uom: 'SQFT' },
  ];
  for (const row of cases) {
    Object.assign(product, { priceRateBasis: row.priceRateBasis, priceUom: row.priceUom, defaultMrpInclusive: row.mrp });
    const rendered = await service.internalLabelPrintRun(run.id);
    assert.equal(rendered.labels.length, 2);
    assert.deepEqual(rendered.labels.map((label: any) => label.copyIndex), [0, 1]);
    for (const label of rendered.labels) {
      assert.equal(label.payload.mrpInclusive, row.mrp, `${row.priceUom} master MRP must print unchanged`);
      assert.equal(label.payload.priceRateBasis, row.basis);
      assert.equal(label.payload.priceUom, row.uom, `${row.priceUom} master unit must print on the sticker`);
      assert.equal(label.qrValue, `MP-LABEL:${instance.labelCode}`);
      assert.match(label.qrDataUrl, /^data:image\/svg\+xml;base64,/);
    }
  }
});
