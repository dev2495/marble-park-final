// How a search box query is read, shared by every group of the global search.
// Pure functions so the rules can be checked without a database.

/** Words of the query, longest first, at most 6. "ram  patel" -> ["patel", "ram"]. */
export function searchTokens(query: string) {
  return Array.from(new Set(String(query || '').trim().split(/\s+/).filter(Boolean)))
    .sort((a, b) => b.length - a.length)
    .slice(0, 6);
}

/**
 * Ways a document number may have been typed, so "QT-2026-0063", "qt 2026 63"
 * and "QT/2026/0063" all find QT/2026/0063, and "Rakesh 27 1" finds Rakesh-27-0001.
 * Returns the query itself plus separator and zero-padding variants.
 */
export function numberVariants(query: string) {
  const q = String(query || '').trim();
  if (!/\d/.test(q)) return [];
  const parts = q.split(/[\s/\\_.\-]+/).filter(Boolean);
  const padded = parts.map((part, index) => (index === parts.length - 1 && /^\d{1,3}$/.test(part) && parts.length > 1 ? part.padStart(4, '0') : part));
  const variants = new Set<string>([q]);
  for (const list of [parts, padded]) {
    variants.add(list.join('/'));
    variants.add(list.join('-'));
    variants.add(list.join(''));
  }
  return Array.from(variants).filter((value) => value.length >= 2);
}

/** Digits typed, if the query looks like (part of) a phone number. */
export function phoneDigits(query: string) {
  const q = String(query || '').trim();
  if (!/^[+\d\s()\-]+$/.test(q)) return '';
  const digits = q.replace(/\D/g, '');
  return digits.length >= 4 ? (digits.length > 10 ? digits.slice(-10) : digits) : '';
}

/**
 * Rank of a result: exact code/number first, then starts-with, then contains.
 * Compares with separators removed and case ignored.
 */
export function matchRank(query: string, values: Array<string | null | undefined>) {
  const squash = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const q = squash(query);
  const variants = new Set([q, ...numberVariants(query).map(squash)]);
  let best = 0;
  for (const raw of values) {
    if (!raw) continue;
    const value = squash(String(raw));
    if (!value) continue;
    for (const v of variants) {
      if (!v) continue;
      if (value === v) best = Math.max(best, 100);
      else if (value.startsWith(v)) best = Math.max(best, 60);
      else if (value.endsWith(v)) best = Math.max(best, 50);
      else if (value.includes(v)) best = Math.max(best, 20);
    }
  }
  return best;
}
