/**
 * One definition of stock health, shared by the dashboard, inventory and reports.
 * A product nobody has ever stocked is "catalogue only": it is not low and not out.
 */
export type StockStatus = 'Ran out' | 'Running low' | 'Catalogue only' | 'Healthy';

const STORED_DEFAULT = 5;

export function categoryThreshold(category: unknown) {
  const name = String(category || '').trim().toLowerCase();
  if (name === 'tiles') return 10;
  if (name.includes('sanitary')) return 2;
  if (name.includes('faucet')) return 3;
  if (name.includes('shower') || name.includes('sink')) return 2;
  return 5;
}

/** A threshold someone changed wins; the untouched default of 5 gives way to the category default. */
export function stockThreshold(category: unknown, lowStockThreshold: unknown, reorderPoint?: unknown) {
  const low = Number(lowStockThreshold ?? STORED_DEFAULT);
  const base = low === STORED_DEFAULT ? categoryThreshold(category) : low;
  return Math.max(base, Number(reorderPoint || 0));
}

export function stockStatus(input: { everStocked: boolean; onHand: number; available: number; threshold: number }): StockStatus {
  if (!input.everStocked) return 'Catalogue only';
  if (input.onHand <= 0) return 'Ran out';
  if (input.threshold > 0 && input.available <= input.threshold) return 'Running low';
  return 'Healthy';
}
