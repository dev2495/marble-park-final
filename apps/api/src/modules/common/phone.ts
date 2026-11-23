// One rule for customer phone numbers everywhere: the phone is the customer's
// identity, compared on its last 10 digits so "+91 98250 12345", "098250-12345"
// and "9825012345" are the same person. Names may repeat; numbers may not.

/** The last 10 digits of a phone, or '' when it has fewer than 10 digits. */
export function mobileKey(input: unknown): string {
  const digits = String(input ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

/** A 10-digit Indian mobile starting 6-9, or ''. */
export function indianMobile(input: unknown): string {
  const key = mobileKey(input);
  return /^[6-9]\d{9}$/.test(key) ? key : '';
}

/** What gets saved: the clean 10 digits, or the trimmed text for short numbers such as landlines. */
export function mobileForStorage(input: unknown): string {
  return mobileKey(input) || String(input ?? '').replace(/\s+/g, ' ').trim().slice(0, 32);
}

/** "••2345" — enough to tell two people with the same name apart. */
export function maskedMobile(input: unknown): string {
  const digits = String(input ?? '').replace(/\D/g, '');
  return digits.length >= 4 ? `••${digits.slice(-4)}` : '';
}

/**
 * SQL for the same key as mobileKey(); it matches the expression index
 * "Customer_mobile_key_idx", so keep the two identical.
 */
export const CUSTOMER_MOBILE_KEY_SQL = `right(regexp_replace("mobile", '[^0-9]', '', 'g'), 10)`;

/** Customers whose saved phone has this key, however it was typed when saved. */
export async function customersByMobileKey(prisma: any, input: unknown, options: { excludeId?: string | null; take?: number } = {}) {
  const key = mobileKey(input);
  if (!key) return [];
  const rows: Array<{ id: string }> = await prisma.$queryRawUnsafe(
    `SELECT "id" FROM "Customer" WHERE ${CUSTOMER_MOBILE_KEY_SQL} = $1 ORDER BY "createdAt" ASC LIMIT ${Math.min(Math.max(Number(options.take) || 10, 1), 50)}`,
    key,
  );
  const ids = rows.map((row) => row.id).filter((id) => id !== options.excludeId);
  if (!ids.length) return [];
  const customers = await prisma.customer.findMany({ where: { id: { in: ids } } });
  return ids.map((id) => customers.find((row: any) => row.id === id)).filter(Boolean);
}
