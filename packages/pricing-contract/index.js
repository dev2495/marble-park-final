'use strict';

const PRICING_VERSION = 'unified_retail_v1';
const NRP_MODES = Object.freeze({ PERCENT_OFF_MRP: 'PERCENT_OFF_MRP', FIXED_NRP: 'FIXED_NRP' });
const SPECIAL_MODES = Object.freeze({ NONE: 'NONE', PERCENT_OFF_NRP: 'PERCENT_OFF_NRP', FIXED_SPECIAL_RATE: 'FIXED_SPECIAL_RATE' });
const QUOTE_DISCOUNT_MODES = Object.freeze({ PERCENT: 'PERCENT', FIXED_AMOUNT: 'FIXED_AMOUNT' });

class PricingContractError extends Error {
  constructor(code, field, message, remediation) {
    super(message);
    this.name = 'PricingContractError';
    this.code = code;
    this.field = field;
    this.remediation = remediation;
  }
}

function decimalParts(value, scale) {
  const raw = String(value ?? '').trim();
  if (!raw || !/^-?\d+(?:\.\d+)?$/.test(raw)) return null;
  const negative = raw.startsWith('-');
  const clean = negative ? raw.slice(1) : raw;
  const [whole, fraction = ''] = clean.split('.');
  const padded = `${fraction}${'0'.repeat(scale + 1)}`;
  let result = BigInt(whole || '0') * (10n ** BigInt(scale)) + BigInt(padded.slice(0, scale) || '0');
  if (Number(padded[scale] || 0) >= 5) result += 1n;
  return negative ? -result : result;
}

function moneyPaise(value, field = 'amount', allowZero = true) {
  const amount = decimalParts(value, 2);
  if (amount === null || amount < 0n || (!allowZero && amount === 0n)) {
    throw new PricingContractError('PRICE_INVALID', field, `${field} must be ${allowZero ? 'zero or greater' : 'greater than zero'}.`, `Enter a valid tax-inclusive rupee amount for ${field}.`);
  }
  return amount;
}

function percentMicros(value, field) {
  const amount = decimalParts(value ?? 0, 6);
  if (amount === null || amount < 0n || amount > 100000000n) {
    throw new PricingContractError('PERCENT_INVALID', field, `${field} must be between 0 and 100.`, `Enter ${field} as a percentage from 0 to 100.`);
  }
  return amount;
}

function roundDivide(numerator, denominator) {
  if (denominator <= 0n) throw new PricingContractError('CALCULATION_INVALID', 'pricing', 'Pricing denominator must be positive.', 'Review the pricing basis and tax rate.');
  return (numerator + denominator / 2n) / denominator;
}

function applyPercent(basePaise, percentValue, field) {
  const micros = percentMicros(percentValue, field);
  return roundDivide(basePaise * micros, 100000000n);
}

function toMoney(paise) {
  return Number(paise) / 100;
}

function normalizeBasis(value) {
  const basis = String(value || '').trim().toUpperCase();
  const normalized = basis === 'PACK' ? 'BOX' : basis === 'PC' ? 'PIECE' : basis;
  if (!['BOX', 'PIECE', 'AREA'].includes(normalized)) {
    throw new PricingContractError('PRICE_BASIS_INVALID', 'priceRateBasis', 'Price basis must be BOX, PIECE or AREA.', 'Select the governed basis used by the MRP and NRP.');
  }
  return normalized;
}

function priceUnit(input, options = {}) {
  const requireComplete = options.requireComplete !== false;
  const mrp = moneyPaise(input.mrpInclusive, 'mrpInclusive', !requireComplete);
  if (requireComplete && mrp <= 0n) throw new PricingContractError('MRP_REQUIRED', 'mrpInclusive', 'MRP is required before this commercial action.', 'Enter and confirm a positive tax-inclusive MRP.');
  const priceRateBasis = normalizeBasis(input.priceRateBasis || input.mrpRateBasis || input.rateBasis);
  const lineBasis = normalizeBasis(input.lineRateBasis || input.rateBasis || priceRateBasis);
  if (priceRateBasis !== lineBasis) {
    throw new PricingContractError('PRICE_BASIS_STALE', 'priceRateBasis', `Pricing was confirmed for ${priceRateBasis}, not ${lineBasis}.`, 'Confirm new MRP and NRP values for the selected basis; no conversion is guessed.');
  }
  const nrpMode = String(input.nrpMode || NRP_MODES.PERCENT_OFF_MRP).toUpperCase();
  if (!Object.values(NRP_MODES).includes(nrpMode)) throw new PricingContractError('NRP_MODE_INVALID', 'nrpMode', 'Select % off MRP or Set NRP.', 'Choose exactly one NRP mode.');
  const nrp = nrpMode === NRP_MODES.FIXED_NRP
    ? moneyPaise(input.nrpInput, 'nrpInput', !requireComplete)
    : mrp - applyPercent(mrp, input.nrpInput ?? 0, 'nrpInput');
  if (requireComplete && nrp <= 0n) throw new PricingContractError('NRP_REQUIRED', 'nrpInput', 'Normal Retail Price (NRP) must be greater than zero.', 'Enter a positive NRP or reduce the % off MRP.');
  if (nrp > mrp) throw new PricingContractError('NRP_ABOVE_MRP', 'nrpInput', 'Normal Retail Price (NRP) cannot exceed MRP.', 'Reduce NRP to MRP or below.');

  const specialMode = String(input.specialMode || SPECIAL_MODES.NONE).toUpperCase();
  if (!Object.values(SPECIAL_MODES).includes(specialMode)) throw new PricingContractError('SPECIAL_MODE_INVALID', 'specialMode', 'Select no special discount, % off NRP, or Set special rate.', 'Choose exactly one special pricing mode.');
  const specialRate = specialMode === SPECIAL_MODES.NONE
    ? nrp
    : specialMode === SPECIAL_MODES.FIXED_SPECIAL_RATE
      ? moneyPaise(input.specialInput, 'specialInput', !requireComplete)
      : nrp - applyPercent(nrp, input.specialInput ?? 0, 'specialInput');
  if (requireComplete && specialRate <= 0n) throw new PricingContractError('SPECIAL_RATE_INVALID', 'specialInput', 'Special selling price must be greater than zero.', 'Enter a positive special rate or reduce the discount.');
  if (specialRate > nrp && !options.allowSpecialAboveNrp) throw new PricingContractError('SPECIAL_ABOVE_NRP', 'specialInput', 'Special selling price cannot exceed NRP.', 'Reduce the special rate or use an authorized override with a reason.');

  const taxMicros = percentMicros(input.taxRate ?? 18, 'taxRate');
  const taxable = roundDivide(specialRate * 100000000n, 100000000n + taxMicros);
  const tax = specialRate - taxable;
  return {
    pricingVersion: PRICING_VERSION,
    priceRateBasis,
    nrpMode,
    specialMode,
    mrpPaise: mrp,
    nrpPaise: nrp,
    specialRatePaise: specialRate,
    taxablePaise: taxable,
    taxPaise: tax,
    mrpInclusive: toMoney(mrp),
    nrpInput: Number(input.nrpInput ?? 0),
    nrpInclusive: toMoney(nrp),
    nrpExclusive: toMoney(roundDivide(nrp * 100000000n, 100000000n + taxMicros)),
    specialInput: Number(input.specialInput ?? 0),
    specialRateInclusive: toMoney(specialRate),
    specialRateExclusive: toMoney(taxable),
    taxRate: Number(taxMicros) / 1000000,
  };
}

function priceQuoteLines(lines, quoteDiscount = {}, options = {}) {
  const rows = (Array.isArray(lines) ? lines : []).map((line, index) => {
    const quantity = decimalParts(line.pricingQuantity ?? line.quantity ?? line.qty, 6);
    if (quantity === null || quantity <= 0n) throw new PricingContractError('QUANTITY_INVALID', `lines[${index}].quantity`, 'Each line needs a positive quantity.', 'Enter a positive quantity in the selected pricing basis.');
    const unit = priceUnit(line, options);
    const beforeDiscount = roundDivide(unit.specialRatePaise * quantity, 1000000n);
    const mrpValue = roundDivide(unit.mrpPaise * quantity, 1000000n);
    const nrpValue = roundDivide(unit.nrpPaise * quantity, 1000000n);
    return { line, index, quantity, unit, beforeDiscount, mrpValue, nrpValue };
  });
  const base = rows.reduce((sum, row) => sum + row.beforeDiscount, 0n);
  const mode = String(quoteDiscount.mode || quoteDiscount.type || QUOTE_DISCOUNT_MODES.PERCENT).toUpperCase();
  if (!Object.values(QUOTE_DISCOUNT_MODES).includes(mode)) throw new PricingContractError('QUOTE_DISCOUNT_MODE_INVALID', 'quoteDiscountMode', 'Quote discount must be percentage or fixed amount.', 'Choose exactly one quote discount mode.');
  const providedAllocations = rows.map((row) => moneyPaise(row.line.quoteDiscountAllocatedInclusive ?? 0, 'quoteDiscountAllocatedInclusive'));
  const preserveAllocated = options.preserveAllocatedDiscount === true;
  const totalDiscount = preserveAllocated
    ? providedAllocations.reduce((sum, value) => sum + value, 0n)
    : mode === QUOTE_DISCOUNT_MODES.FIXED_AMOUNT
    ? moneyPaise(quoteDiscount.value ?? 0, 'quoteDiscountValue')
    : applyPercent(base, quoteDiscount.value ?? 0, 'quoteDiscountValue');
  if (totalDiscount > base) throw new PricingContractError('QUOTE_DISCOUNT_EXCEEDED', 'quoteDiscountValue', 'Whole-quote discount cannot exceed the eligible quote value.', 'Reduce the whole-quote discount.');
  let allocated = 0n;
  const pricedLines = rows.map((row, index) => {
    const allocation = preserveAllocated ? providedAllocations[index] : index === rows.length - 1
      ? totalDiscount - allocated
      : base === 0n ? 0n : roundDivide(totalDiscount * row.beforeDiscount, base);
    if (allocation > row.beforeDiscount) throw new PricingContractError('QUOTE_DISCOUNT_EXCEEDED', `lines[${row.index}].quoteDiscountAllocatedInclusive`, 'Allocated quote discount cannot exceed the line value.', 'Review the source quote allocation and selected quantity.');
    allocated += allocation;
    const gross = row.beforeDiscount - allocation;
    const taxMicros = percentMicros(row.unit.taxRate, 'taxRate');
    const taxable = roundDivide(gross * 100000000n, 100000000n + taxMicros);
    const tax = gross - taxable;
    if (gross > row.mrpValue) throw new PricingContractError('PAYABLE_ABOVE_MRP', `lines[${row.index}].grossLineTotal`, 'Final payable cannot exceed MRP.', 'Review NRP, special pricing and whole-quote discount.');
    return {
      ...row.line,
      pricingVersion: PRICING_VERSION,
      priceRateBasis: row.unit.priceRateBasis,
      mrpRateBasis: row.unit.priceRateBasis,
      mrpInclusive: row.unit.mrpInclusive,
      nrpMode: row.unit.nrpMode,
      nrpInput: row.unit.nrpInput,
      nrpInclusive: row.unit.nrpInclusive,
      nrpExclusive: row.unit.nrpExclusive,
      specialMode: row.unit.specialMode,
      specialInput: row.unit.specialInput,
      specialRateInclusive: row.unit.specialRateInclusive,
      specialRateExclusive: row.unit.specialRateExclusive,
      quoteDiscountMode: mode,
      quoteDiscountValue: Number(quoteDiscount.value ?? 0),
      quoteDiscountAllocatedInclusive: toMoney(allocation),
      taxableValue: toMoney(taxable),
      taxAmount: toMoney(tax),
      grossLineTotal: toMoney(gross),
      lineTotal: toMoney(gross),
      mrpValueInclusive: toMoney(row.mrpValue),
      nrpValueInclusive: toMoney(row.nrpValue),
      specialValueInclusive: toMoney(row.beforeDiscount),
      baseDiscountFromMrpInclusive: toMoney(row.mrpValue - row.nrpValue),
      specialDiscountFromNrpInclusive: toMoney(row.nrpValue - row.beforeDiscount),
      totalSavingFromMrpInclusive: toMoney(row.mrpValue - gross),
    };
  });
  const totals = pricedLines.reduce((sum, line) => ({
    mrpValueInclusive: sum.mrpValueInclusive + line.mrpValueInclusive,
    nrpValueInclusive: sum.nrpValueInclusive + line.nrpValueInclusive,
    specialValueInclusive: sum.specialValueInclusive + line.specialValueInclusive,
    quoteDiscountInclusive: sum.quoteDiscountInclusive + line.quoteDiscountAllocatedInclusive,
    taxableValue: sum.taxableValue + line.taxableValue,
    taxAmount: sum.taxAmount + line.taxAmount,
    grandTotal: sum.grandTotal + line.grossLineTotal,
  }), { mrpValueInclusive: 0, nrpValueInclusive: 0, specialValueInclusive: 0, quoteDiscountInclusive: 0, taxableValue: 0, taxAmount: 0, grandTotal: 0 });
  for (const key of Object.keys(totals)) totals[key] = toMoney(moneyPaise(totals[key], key));
  return { lines: pricedLines, totals, quoteDiscountMode: mode, quoteDiscountValue: Number(quoteDiscount.value ?? 0) };
}

module.exports = { PRICING_VERSION, NRP_MODES, SPECIAL_MODES, QUOTE_DISCOUNT_MODES, PricingContractError, priceUnit, priceQuoteLines };
