ALTER TABLE "PurchaseOrderLine"
  ADD COLUMN "enteredUnitCost" DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "rateUom" TEXT NOT NULL DEFAULT 'PC',
  ADD COLUMN "rateUomFactor" DECIMAL(18,6) NOT NULL DEFAULT 1,
  ADD COLUMN "netUnitCost" DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "costStatus" TEXT NOT NULL DEFAULT 'complete';

UPDATE "PurchaseOrderLine"
SET
  "enteredUnitCost" = "unitCost",
  "rateUom" = COALESCE(NULLIF("unit", ''), 'PC'),
  "rateUomFactor" = 1,
  "netUnitCost" = ROUND(("unitCost" * (1 - ("discountPercent" / 100)))::numeric, 4),
  "costStatus" = CASE WHEN "unitCost" > 0 THEN 'complete' ELSE 'missing' END;

CREATE INDEX "PurchaseOrderLine_costStatus_createdAt_idx"
  ON "PurchaseOrderLine"("costStatus", "createdAt" DESC);
