// Product.coveragePerPack is stored in square feet for inventory geometry.
// A tile's commercial rate may use a different unit without changing that geometry.
export const SQM_PER_SQFT = 0.09290304;

export type TilePriceUom = 'SQFT' | 'SQM' | 'PC';

export function tilePriceUom(value: unknown): TilePriceUom {
  const unit = String(value || 'SQFT').toUpperCase();
  return unit === 'SQM' || unit === 'M2' ? 'SQM' : unit === 'PC' ? 'PC' : 'SQFT';
}

export function tilePriceBasis(value: unknown): 'AREA' | 'PIECE' {
  return tilePriceUom(value) === 'PC' ? 'PIECE' : 'AREA';
}

export function tilePricingCoverage(coverageSqFt: unknown, unit: unknown): number {
  const coverage = Number(coverageSqFt || 0);
  return tilePriceUom(unit) === 'SQM' ? coverage * SQM_PER_SQFT : coverage;
}

export function tileStockUnitGeometry(product: { purchaseUom?: unknown; unit?: unknown; piecesPerPack?: unknown; coveragePerPack?: unknown }) {
  const boxPieces = Math.max(1, Math.trunc(Number(product.piecesPerPack || 1)));
  const pieceStock = String(product.purchaseUom || product.unit || 'BOX').toUpperCase() === 'PC';
  return {
    piecesPerUnit: pieceStock ? 1 : boxPieces,
    coveragePerUnitSqFt: pieceStock ? Number(product.coveragePerPack || 0) / boxPieces : Number(product.coveragePerPack || 0),
  };
}

export function tilePricingQuantity(line: { qty?: unknown; quantity?: unknown; coveragePerPack?: unknown; piecesPerPack?: unknown; pcsPerBox?: unknown; pricingUom?: unknown; priceUom?: unknown; pricingCoveragePerPack?: unknown }): number {
  const qty = Number(line.qty ?? line.quantity ?? 0);
  const unit = tilePriceUom(line.pricingUom || line.priceUom);
  if (unit === 'PC') return qty * Number(line.piecesPerPack || line.pcsPerBox || 1);
  const converted = tilePricingCoverage(line.coveragePerPack, unit);
  const coverage = Number(line.pricingCoveragePerPack || converted);
  return qty * coverage;
}
