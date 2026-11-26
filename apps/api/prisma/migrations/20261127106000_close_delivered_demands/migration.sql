-- Delivery close: one-time correction. A purchase demand whose goods came in
-- ('received', or 'allocated' when the shortage was filled) and whose sales order is
-- fully delivered has no work left, so it becomes 'closed' (the code now does this
-- when the last challan is delivered). Fully delivered = the order is marked
-- 'delivered', or (older orders, saved before the order status followed delivery)
-- every order line with a quantity has all of it delivered. Cancelled orders are
-- left to the cancel flow. Nothing else changes. Safe to run again: closed rows no
-- longer match.
UPDATE "PurchaseDemand" d
SET "status" = 'closed', "updatedAt" = NOW()
FROM "SalesOrder" so
WHERE so."id" = d."sourceOrderId"
  AND d."status" IN ('received', 'allocated')
  AND so."status" <> 'cancelled'
  AND (
    so."status" = 'delivered'
    OR (
      EXISTS (SELECT 1 FROM "SalesOrderLine" l WHERE l."salesOrderId" = so."id" AND l."orderedQuantity" > 0)
      AND NOT EXISTS (
        SELECT 1 FROM "SalesOrderLine" l
        WHERE l."salesOrderId" = so."id" AND l."orderedQuantity" > 0 AND l."deliveredQuantity" < l."orderedQuantity"
      )
    )
  );
