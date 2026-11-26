// One quote-value rule for owner reports and role dashboards.
// Value is the pre-GST taxable total the pricing library stored on each line;
// GST and the commercial total are kept beside it. Replaced revisions and
// cancelled quotes are never counted.

const num = (value: unknown) => Number(value || 0) || 0;
const round2 = (value: number) => Math.round(value * 100) / 100;

export type QuoteValue = { taxable: number; gst: number; total: number; mrpValue: number; maxDisc: number };

export function quoteValue(quote: { lines?: unknown; commercialTotal?: unknown }): QuoteValue {
  const lines: any[] = Array.isArray(quote?.lines) ? (quote.lines as any[]) : [];
  let taxable = 0; let gst = 0; let mrpValue = 0; let maxDisc = 0;
  for (const line of lines) {
    const value = num(line?.taxableValue);
    taxable += value; gst += num(line?.taxAmount);
    const mrp = num(line?.mrpValueInclusive);
    if (mrp > 0) { mrpValue += mrp; maxDisc = Math.max(maxDisc, 1 - value / mrp); }
  }
  return { taxable: round2(taxable), gst: round2(gst), total: round2(num(quote?.commercialTotal) || taxable + gst), mrpValue: round2(mrpValue), maxDisc };
}

export const CONFIRMED_QUOTE_STATUSES = ['confirmed', 'won', 'ordered', 'partially_ordered', 'closed'];

export function isQuoteConfirmed(quote: { status?: string | null; confirmedAt?: unknown }) {
  return CONFIRMED_QUOTE_STATUSES.includes(String(quote?.status || '')) || Boolean(quote?.confirmedAt);
}

export function isQuoteDraft(quote: { status?: string | null }) {
  return ['draft', 'incomplete_pricing'].includes(String(quote?.status || ''));
}

export function isQuoteSent(quote: { status?: string | null }) {
  return !isQuoteDraft(quote) && !['cancelled', 'superseded'].includes(String(quote?.status || ''));
}

/** A quote that still counts: not replaced by a later revision and not cancelled. */
export function isQuoteCounted(quote: { status?: string | null; supersededByQuoteId?: string | null }) {
  return !quote?.supersededByQuoteId && !['cancelled', 'superseded'].includes(String(quote?.status || ''));
}

/** Prisma filter for quotes that still count (same rule as isQuoteCounted). */
export const COUNTED_QUOTE_WHERE = { supersededByQuoteId: null, status: { notIn: ['cancelled', 'superseded'] } };
