-- Tile stock is counted in pieces. Orders and quotes stay in boxes; stock,
-- reservations, purchase demand and purchase orders count pieces
-- (pieces per box x boxes). Before this, backorders, their demand and the
-- POs raised from it were saved in boxes while receipts counted pieces.

-- 1. Tiles still stocked by the box (no stock or orders yet) are stocked by the piece.
UPDATE "Product" p
SET "baseUom" = 'PC', "updatedAt" = now()
WHERE lower(p.category) = 'tiles'
  AND upper(coalesce(p."baseUom", '')) = 'BOX'
  AND upper(coalesce(p.unit, '')) IN ('BOX', 'PACK', 'CARTON')
  AND p."piecesPerPack" > 1
  AND NOT EXISTS (SELECT 1 FROM "InventoryLot" l WHERE l."productId" = p.id)
  AND NOT EXISTS (SELECT 1 FROM "Reservation" r WHERE r."productId" = p.id);

-- Products counted in pieces but sold by the box.
CREATE TEMP TABLE boxed_tiles AS
SELECT id, "piecesPerPack"::int AS ppp
FROM "Product"
WHERE upper(coalesce("baseUom", 'PC')) = 'PC'
  AND upper(coalesce(unit, '')) IN ('BOX', 'PACK', 'CARTON')
  AND "piecesPerPack" > 1;

-- 2. Backorders not yet holding stock: boxes to pieces (only those whose demand is still in boxes).
UPDATE "Reservation" r
SET quantity = r.quantity * b.ppp, "updatedAt" = now()
FROM boxed_tiles b
WHERE r."productId" = b.id
  AND r.status = 'backordered'
  AND NOT EXISTS (SELECT 1 FROM "LotReservation" lr WHERE lr."reservationId" = r.id)
  AND EXISTS (
    SELECT 1 FROM "PurchaseDemand" d
    WHERE d."sourceReservationId" = r.id AND upper(coalesce(d.unit, '')) <> 'PC'
  );

-- 3. Their purchase demand.
UPDATE "PurchaseDemand" d
SET quantity = d.quantity * b.ppp,
    "orderedQuantity" = d."orderedQuantity" * b.ppp,
    "receivedQuantity" = d."receivedQuantity" * b.ppp,
    unit = 'PC', "updatedAt" = now()
FROM boxed_tiles b
WHERE d."productId" = b.id
  AND upper(coalesce(d.unit, '')) <> 'PC';

-- 4. Purchase order lines raised from that demand (none received or priced yet).
UPDATE "PurchaseOrderLine" l
SET "orderedQuantity" = l."orderedQuantity" * b.ppp,
    "receivedQuantity" = l."receivedQuantity" * b.ppp,
    unit = 'PC', "updatedAt" = now()
FROM boxed_tiles b
WHERE l."productId" = b.id
  AND l."purchaseDemandId" IS NOT NULL
  AND upper(coalesce(l.unit, '')) <> 'PC'
  AND l."receivedQuantity" = 0
  AND coalesce(l."unitCost", 0) = 0;

DROP TABLE boxed_tiles;
