import { BadRequestException } from '@nestjs/common';

export const DEFAULT_TAX_RATE = 18;

export type CommercialTotals = {
  subtotal: number;
  lineDiscountAmount: number;
  quoteDiscountAmount: number;
  taxableValue: number;
  taxAmount: number;
  grandTotal: number;
};

function money(value: unknown) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) throw new BadRequestException('Commercial values must be valid numbers');
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function percent(value: unknown, fallback = 0, label = 'Discount') {
  if (value === undefined || value === null || value === '') return fallback;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 100) {
    throw new BadRequestException(`${label} must be between 0 and 100`);
  }
  return money(amount);
}

function hasRate(value: any) {
  return value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value));
}

export function finalUnitRate(line: any) {
  const listPrice = money(line.listPrice ?? line.price ?? line.sellPrice ?? 0);
  if (listPrice < 0) throw new BadRequestException('List price must be zero or greater');
  const discountPercent = percent(line.discountPercent ?? line.discount, 0, 'Line discount');
  const specialRaw = hasRate(line.specialRate) ? line.specialRate : hasRate(line.specialPrice) ? line.specialPrice : undefined;
  const unitRate = specialRaw === undefined
    ? money(listPrice * (1 - discountPercent / 100))
    : money(specialRaw);
  if (unitRate < 0) throw new BadRequestException('Negotiated rate must be zero or greater');
  return { listPrice, discountPercent, unitRate };
}

function commercialQuantity(line: any, inventoryQuantity: number) {
  const basis = String(line.rateBasis || 'PACK').trim().toUpperCase();
  if (!['PACK', 'PIECE', 'AREA'].includes(basis)) throw new BadRequestException('Rate basis must be PACK, PIECE, or AREA');
  const piecesPerPack = Math.max(1, Math.trunc(Number(line.piecesPerPack || line.pcsPerBox || 1)));
  const coveragePerPack = Number(line.coveragePerPack || 0);
  if (basis === 'AREA' && (!Number.isFinite(coveragePerPack) || coveragePerPack <= 0)) {
    throw new BadRequestException(`${line.sku || line.name || 'Area-priced item'} needs positive coverage per pack in Product Master`);
  }
  const pricingQuantity = basis === 'PIECE'
    ? inventoryQuantity * piecesPerPack
    : basis === 'AREA' ? money(inventoryQuantity * coveragePerPack) : inventoryQuantity;
  return { basis, piecesPerPack, coveragePerPack, pricingQuantity };
}

export function priceQuoteLines(lines: any[], quoteDiscountPercent: unknown = 0) {
  const normalizedQuoteDiscount = percent(quoteDiscountPercent, 0, 'Quote discount');
  let totals: CommercialTotals = {
    subtotal: 0,
    lineDiscountAmount: 0,
    quoteDiscountAmount: 0,
    taxableValue: 0,
    taxAmount: 0,
    grandTotal: 0,
  };
  let requiresApproval = false;

  const pricedLines = (Array.isArray(lines) ? lines : []).map((line) => {
    const quantity = Math.trunc(Number(line.qty ?? line.quantity ?? 0));
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new BadRequestException('Each commercial line needs a positive whole-number quantity');
    }
    const { basis, piecesPerPack, coveragePerPack, pricingQuantity } = commercialQuantity(line, quantity);
    const { listPrice, discountPercent, unitRate } = finalUnitRate(line);
    const taxRate = percent(line.taxRate, DEFAULT_TAX_RATE, 'Tax rate');
    const listAmount = money(pricingQuantity * listPrice);
    const lineSubtotal = money(pricingQuantity * unitRate);
    const lineDiscountAmount = money(Math.max(0, listAmount - lineSubtotal));
    const quoteDiscountAmount = money(lineSubtotal * normalizedQuoteDiscount / 100);
    const taxableValue = money(lineSubtotal - quoteDiscountAmount);
    const taxAmount = money(taxableValue * taxRate / 100);
    const grossLineTotal = money(taxableValue + taxAmount);
    const floorPrice = money(line.floorPrice ?? 0);
    const belowFloor = floorPrice > 0 && unitRate < floorPrice;
    requiresApproval ||= belowFloor;

    totals = {
      subtotal: money(totals.subtotal + lineSubtotal),
      lineDiscountAmount: money(totals.lineDiscountAmount + lineDiscountAmount),
      quoteDiscountAmount: money(totals.quoteDiscountAmount + quoteDiscountAmount),
      taxableValue: money(totals.taxableValue + taxableValue),
      taxAmount: money(totals.taxAmount + taxAmount),
      grandTotal: money(totals.grandTotal + grossLineTotal),
    };

    return {
      ...line,
      qty: quantity,
      quantity,
      inventoryQuantity: quantity,
      pricingQuantity,
      rateBasis: basis,
      piecesPerPack,
      coveragePerPack,
      price: listPrice,
      sellPrice: listPrice,
      listPrice,
      discountPercent,
      specialRate: unitRate === listPrice && discountPercent === 0 ? null : unitRate,
      unitRate,
      taxRate,
      listAmount,
      lineDiscountAmount,
      quoteDiscountPercent: normalizedQuoteDiscount,
      quoteDiscountAmount,
      taxableValue,
      taxAmount,
      grossLineTotal,
      total: grossLineTotal,
      floorPrice,
      belowFloor,
    };
  });

  return { lines: pricedLines, totals, requiresApproval, quoteDiscountPercent: normalizedQuoteDiscount };
}

export function commercialTotalsFromLines(lines: any[]) {
  return (Array.isArray(lines) ? lines : []).reduce<CommercialTotals>((totals, line) => {
    const gross = money(line.grossLineTotal ?? line.total ?? line.lineTotal ?? 0);
    const taxable = money(line.taxableValue ?? gross);
    const tax = money(line.taxAmount ?? 0);
    const unitRate = money(line.unitRate ?? line.specialRate ?? line.price ?? line.sellPrice ?? 0);
    const quantity = Math.trunc(Number(line.qty ?? line.quantity ?? 0));
    const pricingQuantity = Number(line.pricingQuantity ?? commercialQuantity(line, Math.max(0, quantity)).pricingQuantity);
    const subtotal = money(unitRate * Math.max(0, pricingQuantity));
    return {
      subtotal: money(totals.subtotal + subtotal),
      lineDiscountAmount: money(totals.lineDiscountAmount + money(line.lineDiscountAmount ?? 0)),
      quoteDiscountAmount: money(totals.quoteDiscountAmount + money(line.quoteDiscountAmount ?? 0)),
      taxableValue: money(totals.taxableValue + taxable),
      taxAmount: money(totals.taxAmount + tax),
      grandTotal: money(totals.grandTotal + gross),
    };
  }, { subtotal: 0, lineDiscountAmount: 0, quoteDiscountAmount: 0, taxableValue: 0, taxAmount: 0, grandTotal: 0 });
}
