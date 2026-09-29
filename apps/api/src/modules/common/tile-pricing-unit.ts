import { BadRequestException } from '@nestjs/common';

// Product.coveragePerPack is governed and stored as square feet per stock pack.
export const SQM_PER_SQFT = 0.09290304;

export type TilePriceUom = 'PC' | 'SQFT' | 'SQM';
export type TilePriceBasis = 'PIECE' | 'AREA';

export function tilePricingChoice(
  basis: unknown,
  uom: unknown,
  fallbackBasis?: unknown,
  fallbackUom?: unknown,
): { priceRateBasis: TilePriceBasis; priceUom: TilePriceUom } {
  const suppliedBasis = String(basis || '').trim().toUpperCase();
  const suppliedUom = String(uom || '').trim().toUpperCase();
  const previousBasis = String(fallbackBasis || '').trim().toUpperCase();
  const previousUom = String(fallbackUom || '').trim().toUpperCase();
  const rawBasis = suppliedBasis || (suppliedUom ? '' : previousBasis);
  const rawUom = suppliedUom
    || (suppliedBasis === 'PIECE' ? 'PC' : suppliedBasis === 'AREA' && previousUom !== 'PC' ? previousUom || 'SQFT' : suppliedBasis === 'AREA' ? 'SQFT' : '')
    || previousUom
    || (rawBasis === 'PIECE' ? 'PC' : 'SQFT');
  if (!['PC', 'SQFT', 'SQM'].includes(rawUom)) {
    throw new BadRequestException('Tile price UOM must be PC, SQFT, or SQM');
  }
  const expectedBasis: TilePriceBasis = rawUom === 'PC' ? 'PIECE' : 'AREA';
  if (rawBasis && rawBasis !== expectedBasis) {
    throw new BadRequestException(`Tile ${rawUom} pricing requires ${expectedBasis} price basis`);
  }
  return { priceRateBasis: expectedBasis, priceUom: rawUom as TilePriceUom };
}

export function tileCoveragePerPack(coveragePerPackSqFt: unknown, areaUom: string): number {
  const coverage = Number(coveragePerPackSqFt);
  if (!Number.isFinite(coverage) || coverage <= 0) {
    throw new BadRequestException('Area-priced tile needs positive governed SQFT coverage per pack');
  }
  const unit = String(areaUom || '').trim().toUpperCase();
  if (unit === 'SQFT') return coverage;
  if (unit === 'SQM' || unit === 'M2') return coverage * SQM_PER_SQFT;
  throw new BadRequestException('Tile area price UOM must be SQFT or SQM');
}

export function convertTileRate(
  amount: number,
  fromUom: string,
  toUom: string,
  coveragePerPackSqFt: number,
  piecesPerPack: number,
): number {
  const rate = Number(amount);
  if (!Number.isFinite(rate) || rate <= 0) throw new BadRequestException('Tile rate must be greater than zero');
  const source = String(fromUom || '').trim().toUpperCase();
  const target = String(toUom || '').trim().toUpperCase();
  if (![source, target].every((unit) => ['PC', 'SQFT', 'SQM'].includes(unit))) {
    throw new BadRequestException('Tile rate UOM must be PC, SQFT, or SQM');
  }
  if (source === target) return Number(rate.toFixed(2));
  const pieces = Number(piecesPerPack);
  if (!Number.isInteger(pieces) || pieces <= 0) {
    throw new BadRequestException('Tile rate conversion needs positive governed pieces per pack');
  }
  const unitsPerPack = (unit: string) => unit === 'PC' ? pieces : tileCoveragePerPack(coveragePerPackSqFt, unit);
  const converted = rate * unitsPerPack(source) / unitsPerPack(target);
  if (!Number.isFinite(converted) || converted <= 0) throw new BadRequestException('Tile rate conversion is invalid');
  return Number(converted.toFixed(2));
}
