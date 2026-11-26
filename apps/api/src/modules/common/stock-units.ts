// One rule for stock units. Stock (lots, reservations, purchase demand, POs,
// receipts, pick lists) is counted in the product's base unit. Orders and
// quotes count in the product's selling unit. For a tile sold by the BOX and
// stocked by the PC (base unit PC, N pieces per box) one box is N pieces;
// for everything else the two units are the same and the factor is 1.

import { boxFactor, boxReading, formatBoxQuantity, formatSellingQuantity, type BoxQuantity } from '@marble-park/pricing-contract/box-quantity';

const PACK_UNITS = new Set(['BOX', 'PACK', 'CARTON']);

/** Base units in one selling unit (pieces per box for boxed tiles, else 1). Same rule as the screens and PDFs (packages/pricing-contract/box-quantity). */
export function stockFactor(product: any): number {
  return boxFactor(product);
}

/**
 * How a base quantity reads (presentation only), with "(344 pc)" beside it:
 * a tile sold by the BOX in whole boxes rounded up ("39 Box", counted with
 * toSellingQtyCeil); a tile sold by the PIECE as "38 Box + 2 pc"; else unchanged.
 */
export function boxQuantity(product: any, baseQty: unknown): BoxQuantity {
  const reading = formatBoxQuantity(baseQty, product);
  if (reading.soldBy !== 'BOX') return reading;
  const boxes = Math.max(0, toSellingQtyCeil(product, reading.pieces));
  const label = reading.label.replace(/^\d+/, String(boxes));
  return { ...reading, boxes, label, fullLabel: `${label} (${reading.piecesLabel})` };
}

/** The same for a selling-unit quantity (order lines count boxes for a box-sold tile, pieces for a piece-sold one). */
export function boxQuantityFromSelling(product: any, sellingQty: unknown): BoxQuantity {
  const reading = formatSellingQuantity(sellingQty, product);
  return reading.soldBy === 'BOX' ? boxQuantity(product, reading.pieces) : reading;
}

/** Pieces per box and how the tile is sold, for read-only API payloads (screens and PDFs read boxes from it). */
export function tileBoxReading(product: any): { piecesPerBox: number; soldBy: 'BOX' | 'PIECE' | null } {
  return boxReading(product);
}

/** Selling-unit quantity (e.g. 38 boxes) to base units (380 pieces). */
export function toBaseQty(product: any, sellingQty: unknown): number {
  return Math.max(0, Math.round(Number(sellingQty || 0) * stockFactor(product)));
}

/** Base units back to whole selling units, rounding down (15 pc at 10/box is 1 full box). */
export function toSellingQtyFloor(product: any, baseQty: unknown): number {
  return Math.floor(Math.max(0, Number(baseQty || 0)) / stockFactor(product) + 1e-9);
}

/** Base units back to selling units, rounding up (5 pc short at 10/box is 1 box short). */
export function toSellingQtyCeil(product: any, baseQty: unknown): number {
  return Math.ceil(Math.max(0, Number(baseQty || 0)) / stockFactor(product) - 1e-9);
}

/** "38 BOX (380 PC)" for a boxed tile, "5 PC" otherwise. */
export function describeBaseQty(product: any, baseQty: unknown): string {
  const factor = stockFactor(product);
  const base = Math.max(0, Number(baseQty || 0));
  const baseUnit = String(product?.baseUom || 'PC').toUpperCase();
  if (factor <= 1) return `${base} ${baseUnit}`;
  const boxes = Math.floor(base / factor);
  const loose = base - boxes * factor;
  const sellingUnit = String(product?.unit || 'BOX').toUpperCase();
  return `${boxes} ${sellingUnit}${loose ? ` + ${loose} ${baseUnit}` : ''} (${base} ${baseUnit})`;
}

const SQM_PER_SQFT_FACTOR = 0.09290304;

/**
 * Product Master MRP (GST included) for ONE stock base unit, so on-hand x this
 * is the stock value at MRP. MRP is stored per the product's price unit:
 * per piece, per box/pack, per sq ft or sq m (tiles, via coverage per pack in
 * sq ft), or per selling unit for everything else. Returns 0 when it cannot be
 * worked out (no MRP, or an area price with no coverage).
 */
export function mrpPerBaseUnit(product: any): number {
  const mrp = Number(product?.defaultMrpInclusive ?? 0) || 0;
  if (!product || mrp <= 0) return 0;
  const base = String(product.baseUom || 'PC').trim().toUpperCase();
  const priceUom = String(product.priceUom || product.salesUom || product.unit || base).trim().toUpperCase();
  // Base units in one pack: pieces per pack when stock is counted in pieces, else the pack itself.
  const basePerPack = base === 'PC' ? Math.max(1, Math.trunc(Number(product.piecesPerPack || 1))) : 1;
  if (priceUom === base) return mrp;
  if (priceUom === 'PC' || priceUom === 'PIECE') return base === 'PC' ? mrp : mrp * Math.max(1, Math.trunc(Number(product.piecesPerPack || 1)));
  if (PACK_UNITS.has(priceUom)) return mrp / basePerPack;
  if (priceUom === 'SQFT' || priceUom === 'SQM' || priceUom === 'M2') {
    const coverageSqFt = Number(product.coveragePerPack || 0);
    if (!(coverageSqFt > 0)) return 0;
    const areaPerPack = priceUom === 'SQFT' ? coverageSqFt : coverageSqFt * SQM_PER_SQFT_FACTOR;
    return (mrp * areaPerPack) / basePerPack;
  }
  // Same-unit goods (KG, LTR, SET...): stock and price share the unit.
  return mrp;
}
