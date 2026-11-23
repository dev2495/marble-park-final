// Chemicals are sold either loose by weight (KG) or in sealed bags (BAG), e.g.
// tile adhesive in 20 kg bags. The MRP, stock, purchase and quote quantity
// all use the one unit the SKU is set to; there is no KG↔BAG conversion.
export const CHEMICAL_UNITS = ['KG', 'BAG'] as const;
export type ChemicalUnit = typeof CHEMICAL_UNITS[number];

export function chemicalUnit(value: unknown, fallback: ChemicalUnit = 'KG'): ChemicalUnit {
  const unit = String(value ?? '').trim().toUpperCase();
  return (CHEMICAL_UNITS as readonly string[]).includes(unit) ? (unit as ChemicalUnit) : fallback;
}
