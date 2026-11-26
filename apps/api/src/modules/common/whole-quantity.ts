import { BadRequestException } from '@nestjs/common';

// Quantities on quotes, orders and stock are stored as whole numbers (the
// database columns are whole-number columns). A typed 2.5 used to be cut to 2
// without a word; now it is refused with a message naming the unit (gaps lane).

const UNIT_WORDS: Record<string, string> = {
  PC: 'pieces', PCS: 'pieces', PIECE: 'pieces', NOS: 'pieces', NO: 'pieces', EA: 'pieces', UNIT: 'units',
  BOX: 'boxes', PACK: 'boxes', BAG: 'bags', KG: 'kg', SET: 'sets', PAIR: 'pairs', LTR: 'litres', L: 'litres',
  ROLL: 'rolls', MTR: 'metres', M: 'metres', SQFT: 'sq ft', SQM: 'sq m', M2: 'sq m',
};

/** Plain words for a unit code: "pieces", "boxes", "kg". */
export function unitWords(unit: unknown) {
  const code = String(unit || '').trim().toUpperCase();
  return UNIT_WORDS[code] || (code ? code.toLowerCase() : 'pieces');
}

/** True for a number with a fractional part (allowing float noise such as 2.0000000001). */
export function isFraction(value: unknown) {
  const raw = Number(value);
  return Number.isFinite(raw) && Math.abs(raw - Math.round(raw)) > 1e-9;
}

/**
 * Returns the quantity as a whole number, or refuses a fraction:
 * "Basin BX-12: 2.5 is not a whole number. This item is counted in whole pieces."
 * Empty, zero and negative values are returned as they are (0 for empty) so the
 * caller's own "must be positive" check and message still apply.
 */
export function wholeQuantity(value: unknown, unit: unknown, label?: string) {
  const raw = Number(value ?? 0);
  if (!Number.isFinite(raw)) return 0;
  if (isFraction(raw)) {
    throw new BadRequestException(`${label ? `${label}: ` : ''}${raw} is not a whole number. This item is counted in whole ${unitWords(unit)}, so enter a whole quantity.`);
  }
  return Math.round(raw);
}
