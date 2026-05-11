import DataLoader = require('dataloader');
import { PrismaService } from '../prisma/prisma.service';

/**
 * Per-request DataLoaders. Created fresh on every HTTP request so that:
 *  - cache lifetime = request lifetime (no stale data leaking between calls)
 *  - resolvers that fan out reads (e.g. `quotes` → 200 × `customer`) collapse
 *    to a single batched `findMany({ where: { id: { in: [...] }}})` per type.
 *
 * NOTE: keys are `string`. Always pass the FK string (e.g. `quote.customerId`),
 * never `null`/`undefined` — null FKs return `null` synchronously below.
 */
export interface AppDataLoaders {
  customerById: DataLoader<string, any | null>;
  userById: DataLoader<string, any | null>;
  leadById: DataLoader<string, any | null>;
  productById: DataLoader<string, any | null>;
  inventoryBalanceByProductId: DataLoader<string, any | null>;
}

function makeBatchLoader<TKey extends string, TRow extends { id: string }>(
  fetcher: (ids: readonly TKey[]) => Promise<TRow[]>,
): DataLoader<TKey, TRow | null> {
  return new DataLoader<TKey, TRow | null>(async (ids) => {
    const rows = await fetcher(ids);
    const byId = new Map<string, TRow>();
    for (const row of rows) byId.set(row.id, row);
    // Preserve input order — DataLoader contract.
    return ids.map((id) => byId.get(String(id)) ?? null);
  }, {
    // Default cache=true is what we want (within a single request).
    maxBatchSize: 250,
  });
}

export function buildLoaders(prisma: PrismaService): AppDataLoaders {
  return {
    customerById: makeBatchLoader<string, any>((ids) =>
      prisma.customer.findMany({ where: { id: { in: ids as string[] } } }),
    ),
    userById: makeBatchLoader<string, any>((ids) =>
      prisma.user.findMany({
        where: { id: { in: ids as string[] } },
        select: { id: true, name: true, email: true, role: true, phone: true, active: true },
      }) as any,
    ),
    leadById: makeBatchLoader<string, any>((ids) =>
      prisma.lead.findMany({ where: { id: { in: ids as string[] } } }),
    ),
    productById: makeBatchLoader<string, any>((ids) =>
      prisma.product.findMany({ where: { id: { in: ids as string[] } } }),
    ),
    inventoryBalanceByProductId: new DataLoader<string, any | null>(async (productIds) => {
      const rows = await prisma.inventoryBalance.findMany({
        where: { productId: { in: productIds as string[] } },
      });
      const byProductId = new Map(rows.map((row: any) => [row.productId, row]));
      return productIds.map((id) => byProductId.get(id as string) ?? null);
    }),
  };
}

/**
 * Helper for resolvers: fetch (id | null | undefined) safely. Returns null
 * without bothering the loader if the FK is absent.
 */
export async function loadOrNull<T>(
  loader: DataLoader<string, T | null>,
  id: string | null | undefined,
): Promise<T | null> {
  if (!id) return null;
  return loader.load(id);
}
