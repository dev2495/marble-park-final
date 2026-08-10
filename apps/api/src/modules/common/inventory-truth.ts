import { Prisma } from '@prisma/client';

export type InventoryTruth = {
  productId: string;
  onHand: number;
  available: number;
  reserved: number;
  damaged: number;
  hold: number;
  onHandValue: number;
  availableValue: number;
  missingCostQuantity: number;
};

export async function inventoryTruthByProduct(client: any, productIds: string[], locationId?: string | null) {
  const ids = Array.from(new Set(productIds.filter(Boolean)));
  if (!ids.length) return new Map<string, InventoryTruth>();
  const rows = await client.$queryRaw(Prisma.sql`
    SELECT lot."productId",
      COALESCE(SUM(lb."onHand"), 0)::double precision AS "onHand",
      COALESCE(SUM(lb."available"), 0)::double precision AS "available",
      COALESCE(SUM(lb."reserved"), 0)::double precision AS "reserved",
      COALESCE(SUM(lb."damaged"), 0)::double precision AS "damaged",
      COALESCE(SUM(lb."hold"), 0)::double precision AS "hold",
      COALESCE(SUM(lb."onHand" * lot."unitCost"), 0)::double precision AS "onHandValue",
      COALESCE(SUM(lb."available" * lot."unitCost"), 0)::double precision AS "availableValue",
      COALESCE(SUM(CASE WHEN lot."unitCost" <= 0 THEN lb."onHand" ELSE 0 END), 0)::double precision AS "missingCostQuantity"
    FROM "InventoryLotBalance" lb
    INNER JOIN "InventoryLot" lot ON lot."id" = lb."lotId" AND lot."status" = 'active'
    WHERE lot."productId" IN (${Prisma.join(ids)})
      AND (${locationId || null}::text IS NULL OR lb."locationId" = ${locationId || null})
    GROUP BY lot."productId"
  `);
  const result = new Map<string, InventoryTruth>();
  for (const row of rows as any[]) {
    result.set(row.productId, {
      productId: row.productId,
      onHand: Number(row.onHand || 0), available: Number(row.available || 0), reserved: Number(row.reserved || 0),
      damaged: Number(row.damaged || 0), hold: Number(row.hold || 0), onHandValue: Number(row.onHandValue || 0),
      availableValue: Number(row.availableValue || 0), missingCostQuantity: Number(row.missingCostQuantity || 0),
    });
  }
  return result;
}

export function zeroInventoryTruth(productId: string): InventoryTruth {
  return { productId, onHand: 0, available: 0, reserved: 0, damaged: 0, hold: 0, onHandValue: 0, availableValue: 0, missingCostQuantity: 0 };
}
