// One rule for stock units. Stock (lots, reservations, purchase demand, POs,
// receipts, pick lists) is counted in the product's base unit. Orders and
// quotes count in the product's selling unit. For a tile sold by the BOX and
// stocked by the PC (base unit PC, N pieces per box) one box is N pieces;
// for everything else the two units are the same and the factor is 1.

const PACK_UNITS = new Set(['BOX', 'PACK', 'CARTON']);

/** Base units in one selling unit (pieces per box for boxed tiles, else 1). */
export function stockFactor(product: any): number {
  if (!product) return 1;
  const base = String(product.baseUom || 'PC').trim().toUpperCase();
  const selling = String(product.unit || product.salesUom || product.purchaseUom || base).trim().toUpperCase();
  if (base !== 'PC' || !PACK_UNITS.has(selling)) return 1;
  return Math.max(1, Math.trunc(Number(product.piecesPerPack || 1)));
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
