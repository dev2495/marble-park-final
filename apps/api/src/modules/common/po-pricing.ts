import { BadRequestException } from '@nestjs/common';

export type PoPricedLine = {
  orderedQuantity: number;
  unitCost: number;
  discountPercent: number;
  taxRate: number;
  lineGross: number;
  lineDiscount: number;
  taxableValue: number;
  taxAmount: number;
  lineTotal: number;
};

export type PoCommercialTotals = {
  discountPercent: number;
  taxRate: number;
  subtotal: number;
  discountAmount: number;
  taxableValue: number;
  taxAmount: number;
  grandTotal: number;
};

function money(value: unknown) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) throw new BadRequestException('Purchase order amounts must be valid numbers');
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function percent(value: unknown, label: string, allowEmptyAsZero = true) {
  if (value === undefined || value === null || value === '') {
    if (allowEmptyAsZero) return 0;
    throw new BadRequestException(`${label} is required`);
  }
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 100) {
    throw new BadRequestException(`${label} must be between 0 and 100`);
  }
  return money(amount);
}

/** Normalize optional header GST: null/blank/0 => 0 (no GST). */
export function normalizePoTaxRate(value: unknown): number {
  if (value === undefined || value === null || value === '') return 0;
  return percent(value, 'GST %');
}

export function normalizePoDiscountPercent(value: unknown): number {
  return percent(value, 'PO discount %');
}

/**
 * Price PO lines from pre-tax unitCost.
 * discountPercent and taxRate are inherited from the PO header in v1.
 */
export function pricePoLines(
  lines: Array<{ orderedQuantity: number; unitCost: number }>,
  header: { discountPercent?: unknown; taxRate?: unknown },
): { lines: PoPricedLine[]; totals: PoCommercialTotals } {
  const discountPercent = normalizePoDiscountPercent(header.discountPercent);
  const taxRate = normalizePoTaxRate(header.taxRate);

  const priced = lines.map((line) => {
    const orderedQuantity = Math.max(0, Math.trunc(Number(line.orderedQuantity || 0)));
    const unitCost = money(line.unitCost);
    if (unitCost < 0) throw new BadRequestException('Unit cost must be zero or greater');
    const lineGross = money(orderedQuantity * unitCost);
    const lineDiscount = money(lineGross * discountPercent / 100);
    const taxableValue = money(lineGross - lineDiscount);
    const taxAmount = money(taxableValue * taxRate / 100);
    const lineTotal = money(taxableValue + taxAmount);
    return {
      orderedQuantity,
      unitCost,
      discountPercent,
      taxRate,
      lineGross,
      lineDiscount,
      taxableValue,
      taxAmount,
      lineTotal,
    };
  });

  const totals: PoCommercialTotals = {
    discountPercent,
    taxRate,
    subtotal: money(priced.reduce((sum, row) => sum + row.lineGross, 0)),
    discountAmount: money(priced.reduce((sum, row) => sum + row.lineDiscount, 0)),
    taxableValue: money(priced.reduce((sum, row) => sum + row.taxableValue, 0)),
    taxAmount: money(priced.reduce((sum, row) => sum + row.taxAmount, 0)),
    grandTotal: money(priced.reduce((sum, row) => sum + row.lineTotal, 0)),
  };

  return { lines: priced, totals };
}
