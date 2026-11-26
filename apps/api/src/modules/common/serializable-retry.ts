import { ConflictException } from '@nestjs/common';

// Same rule order creation uses inline (quotes.service: 3 attempts, retry on
// P2034 "could not serialize" and P2002 number/key clash), as one helper for
// money posting. Two cashiers at the same second: the second one is retried
// instead of seeing a raw database error. Each attempt runs a fresh transaction,
// and idempotency keys inside make a retried double click return the first result.
export function isRetryableTransactionError(error: any): boolean {
  if (!error) return false;
  if (error.code === 'P2034' || error.code === 'P2002') return true;
  const text = String(error.message || '');
  return /could not serialize|40001|deadlock detected|40P01/i.test(text);
}

export async function withSerializableRetry<T>(work: () => Promise<T>, attempts = 3): Promise<T> {
  let last: any;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await work();
    } catch (error: any) {
      last = error;
      if (!isRetryableTransactionError(error) || attempt === attempts - 1) break;
      await new Promise((resolve) => setTimeout(resolve, 40 + Math.floor(Math.random() * 80) * (attempt + 1)));
    }
  }
  if (isRetryableTransactionError(last)) {
    throw new ConflictException('Someone else saved a payment for this account at the same moment. Please try again.');
  }
  throw last;
}
