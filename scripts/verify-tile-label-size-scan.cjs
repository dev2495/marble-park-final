const assert = require('node:assert/strict');
const { compactTileSize } = require('@marble-park/pricing-contract/tile-size');
const { require: tsRequire } = require('tsx/cjs/api');
const { OperationsService } = tsRequire('../apps/api/src/modules/operations/operations.service.ts', __filename);

async function main() {
  assert.equal(compactTileSize({ category: 'Tiles', tileSizeMaster: { name: '1200 x 600 mm (3 PC)' }, dimensions: 'wrong' }), '1200 x 600 mm');
  assert.equal(compactTileSize({ category: 'Tiles', dimensions: '600×600 MM · MATT' }), '600 x 600 mm');
  assert.equal(compactTileSize({ category: 'Tiles', tileSizeMaster: { widthMm: 800, heightMm: 1600 } }), '800 x 1600 mm');
  assert.equal(compactTileSize({ category: 'Sanitaryware', dimensions: '600 x 600 mm', tileSize: '600 x 600 mm' }), '');
  assert.equal(compactTileSize({ category: 'Tiles', dimensions: 'Glossy 3 PC' }), '');
  const tile = { id: 'tile', sku: 'TILE', status: 'active', category: 'Tiles', name: 'Rosso', tileDesignId: 'design', tileDesignMaster: { name: 'Rosso', designCode: 'ROSSO' }, tileSizeMaster: { name: '1200 x 600 mm (3 PC)' }, dimensions: 'old value', defaultMrpInclusive: 250, finish: 'Matt', balances: { available: 4 } };
  const sibling = { ...tile, id: 'sibling', tileSizeMaster: { name: '1200X2400 MM' }, balances: { available: 0 } };
  const unrelated = { ...tile, id: 'other', tileDesignId: 'other-design' };
  const inactive = { ...tile, id: 'inactive', status: 'inactive' };
  const label = { id: 'label', labelCode: 'LBL/2026/TEST', status: 'active', product: tile };
  let events = 0;
  const tx = {
    internalLabelInstance: { findUnique: async () => label },
    internalScanEvent: { create: async ({ data }) => { events++; return data; } },
    product: { findMany: async ({ where }) => [tile, sibling, unrelated, inactive].filter((p) => p.status === where.status && (where.id?.in ? where.id.in.includes(p.id) : where.tileDesignId ? p.tileDesignId === where.tileDesignId : p.id === where.id)) },
  };
  const service = new OperationsService({ ...tx, $transaction: (fn) => fn(tx), productBrand: { findMany: async () => [] } }, null);
  const scan = await service.scanInternalLabel('MP-LABEL:LBL/2026/TEST', {}, 'sales');
  assert.deepEqual(scan.relatedProducts.map((p) => p.id), ['tile', 'sibling']);
  assert.equal(scan.relatedSummary.designId, 'design');
  assert.equal(scan.relatedProducts[0].isScannedProduct, true);
  assert.equal(scan.relatedProducts[1].available, 0, 'Zero stock siblings remain available for intent selection');
  const selected = await service.scanInternalLabel('LBL/2026/TEST', { metadata: { selectedProductIds: ['tile', 'sibling'] } }, 'sales');
  assert.equal(selected.event.metadata.selectionCount, 2);
  const before = events;
  await assert.rejects(() => service.scanInternalLabel('LBL/2026/TEST', { metadata: { selectedProductIds: ['other'] } }, 'sales'), /same tile design/);
  assert.equal(events, before, 'Rejected cross-design selection must not create an event');
  const printed = await service.renderInternalLabelInstances([label], 1);
  assert.equal(printed[0].payload.tileSize, '1200 x 600 mm');
  assert.equal(printed[0].payload.priceUom, 'SQFT');
  console.log(JSON.stringify({ ok: true, tileOnlyDimensions: true, masterSizePrecedence: true, packTextRemoved: true, sameDesignVariants: 2, zeroStockSelectable: true, crossDesignRejected: true }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
