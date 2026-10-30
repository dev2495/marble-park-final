-- Older Excel imports saved a verified MRP without its price basis / price UOM.
-- Quotes compare the line basis with the Product Master basis, so those SKUs
-- could never be quoted even though their MRP existed. Derive the missing
-- basis from the SKU's own selling unit. Tiles and chemicals have dedicated
-- rate rules and are never touched; SKUs that already have a basis are kept.
WITH derived AS (
  SELECT
    "id",
    UPPER(COALESCE(NULLIF(TRIM("priceUom"), ''), NULLIF(TRIM("salesUom"), ''), NULLIF(TRIM("purchaseUom"), ''), NULLIF(TRIM("unit"), ''), 'PC')) AS uom
  FROM "Product"
  WHERE "defaultMrpInclusive" > 0
    AND ("priceRateBasis" IS NULL OR TRIM("priceRateBasis") = '')
    AND LOWER(TRIM("category")) NOT IN ('tiles', 'chemicals')
)
UPDATE "Product" AS p
SET
  "priceRateBasis" = CASE WHEN d.uom IN ('SQFT', 'SQM', 'M2') THEN 'AREA' WHEN d.uom = 'PC' THEN 'PIECE' ELSE 'BOX' END,
  "mrpRateBasis" = CASE WHEN d.uom IN ('SQFT', 'SQM', 'M2') THEN 'AREA' WHEN d.uom = 'PC' THEN 'PIECE' ELSE 'BOX' END,
  "priceUom" = d.uom,
  "updatedAt" = NOW()
FROM derived AS d
WHERE p."id" = d."id";
