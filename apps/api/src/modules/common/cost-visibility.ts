const INVENTORY_COST_KEYS = new Set([
  'unitCost', 'effectiveUnitCost', 'skuCost', 'onHandValue', 'availableValue',
  'valueAtCost', 'costSnapshot', 'costSnapshotSource', 'costSnapshotAt',
  'capturedCost', 'margin', 'marginPercent', 'grossMargin',
  'stockValue', 'totalValue', 'varianceValue', 'inventoryValue', 'activePurchaseOrderValue',
  'openCommitment', 'commitment',
]);

const PROCUREMENT_VALUE_KEYS = new Set([
  ...INVENTORY_COST_KEYS,
  'subtotal', 'discountAmount', 'taxableValue', 'taxAmount', 'grandTotal',
  'lineGross', 'lineDiscount', 'poUnitCost',
]);

function redact(value: any, blocked: Set<string>): any {
  if (Array.isArray(value)) return value.map((item) => redact(item, blocked));
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !blocked.has(key))
      .map(([key, item]) => [key, redact(item, blocked)]),
  );
}

export function canViewCommercialCost(user: { role?: string } | null | undefined) {
  return user?.role === 'admin' || user?.role === 'owner';
}

export function inventoryCostView<T>(value: T, user: { role?: string }): T {
  return canViewCommercialCost(user) ? value : redact(value, INVENTORY_COST_KEYS);
}

export function procurementCostView<T>(value: T, user: { role?: string }): T {
  return canViewCommercialCost(user) ? value : redact(value, PROCUREMENT_VALUE_KEYS);
}

export function assertNoCostInput(value: unknown, user: { role?: string }, errorFactory: (message: string) => Error) {
  if (canViewCommercialCost(user)) return;
  const rows = typeof value === 'string' ? (() => { try { return JSON.parse(value); } catch { return []; } })() : value;
  const containsCost = Array.isArray(rows) && rows.some((row: any) => row?.unitCost !== undefined && row?.unitCost !== null && String(row.unitCost).trim() !== '');
  if (containsCost) throw errorFactory('Only an owner or administrator may enter or change purchase and lot cost.');
}
