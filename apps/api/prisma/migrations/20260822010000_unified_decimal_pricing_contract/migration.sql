-- Unified retail pricing contract. Existing commercial/audit records are retained.
-- Only the existing verified Product.mrp value is semantically safe to migrate.

ALTER TABLE "Product"
  ALTER COLUMN "sellPrice" SET DEFAULT 0,
  ALTER COLUMN "floorPrice" SET DEFAULT 0,
  ADD COLUMN "defaultMrpInclusive" DECIMAL(18,2),
  ADD COLUMN "defaultNrpInclusive" DECIMAL(18,2),
  ADD COLUMN "priceRateBasis" TEXT,
  ADD COLUMN "priceUom" TEXT,
  ADD COLUMN "pricingEffectiveFrom" TIMESTAMP(3),
  ADD COLUMN "pricingVersion" TEXT NOT NULL DEFAULT 'unified_retail_v1';

UPDATE "Product"
SET "defaultMrpInclusive" = ROUND("mrp"::numeric, 2),
    "priceRateBasis" = CASE WHEN "mrpRateBasis" = 'PACK' THEN 'BOX' ELSE "mrpRateBasis" END,
    "priceUom" = CASE
      WHEN "mrpRateBasis" = 'AREA' THEN COALESCE(NULLIF("salesUom", ''), 'SQFT')
      WHEN "mrpRateBasis" = 'PIECE' THEN 'PC'
      ELSE COALESCE(NULLIF("salesUom", ''), NULLIF("purchaseUom", ''), 'BOX')
    END,
    "pricingEffectiveFrom" = COALESCE("mrpVerifiedAt", "updatedAt")
WHERE "mrp" IS NOT NULL AND "mrp" > 0;

CREATE INDEX "Product_defaultMrpInclusive_idx" ON "Product"("defaultMrpInclusive");
CREATE INDEX "Product_defaultNrpInclusive_idx" ON "Product"("defaultNrpInclusive");
CREATE INDEX "Product_priceRateBasis_idx" ON "Product"("priceRateBasis");

ALTER TABLE "Quote"
  ALTER COLUMN "commercialTotal" TYPE DECIMAL(18,2) USING ROUND("commercialTotal"::numeric, 2),
  ADD COLUMN "quoteDiscountMode" TEXT NOT NULL DEFAULT 'PERCENT',
  ADD COLUMN "quoteDiscountValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "pricingVersion" TEXT NOT NULL DEFAULT 'unified_retail_v1',
  ADD COLUMN "pricingStatus" TEXT NOT NULL DEFAULT 'incomplete';

UPDATE "Quote"
SET "pricingStatus" = 'legacy_incomplete',
    "pricingVersion" = 'legacy_unverified'
WHERE jsonb_array_length(CASE WHEN jsonb_typeof("lines") = 'array' THEN "lines" ELSE '[]'::jsonb END) > 0;

ALTER TABLE "QuoteLine"
  ADD COLUMN "pricingVersion" TEXT NOT NULL DEFAULT 'unified_retail_v1',
  ADD COLUMN "priceRateBasis" TEXT,
  ADD COLUMN "mrpInclusive" DECIMAL(18,2),
  ADD COLUMN "nrpMode" TEXT,
  ADD COLUMN "nrpInput" DECIMAL(18,6),
  ADD COLUMN "nrpInclusive" DECIMAL(18,2),
  ADD COLUMN "nrpExclusive" DECIMAL(18,2),
  ADD COLUMN "specialMode" TEXT NOT NULL DEFAULT 'NONE',
  ADD COLUMN "specialInput" DECIMAL(18,6),
  ADD COLUMN "specialRateInclusive" DECIMAL(18,2),
  ADD COLUMN "specialRateExclusive" DECIMAL(18,2),
  ADD COLUMN "quoteDiscountMode" TEXT NOT NULL DEFAULT 'PERCENT',
  ADD COLUMN "quoteDiscountValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "quoteDiscountAllocatedInclusive" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "taxableValueInclusive" DECIMAL(18,2),
  ADD COLUMN "taxAmountInclusive" DECIMAL(18,2),
  ADD COLUMN "grossLineTotalInclusive" DECIMAL(18,2);

UPDATE "QuoteLine" SET "pricingVersion" = 'legacy_unverified';

ALTER TABLE "SalesOrder"
  ALTER COLUMN "advanceAmount" TYPE DECIMAL(18,2) USING ROUND("advanceAmount"::numeric, 2),
  ALTER COLUMN "totalAmount" TYPE DECIMAL(18,2) USING ROUND("totalAmount"::numeric, 2),
  ADD COLUMN "quoteDiscountMode" TEXT NOT NULL DEFAULT 'PERCENT',
  ADD COLUMN "quoteDiscountValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "pricingVersion" TEXT NOT NULL DEFAULT 'unified_retail_v1';

ALTER TABLE "SalesOrderLine"
  ADD COLUMN "pricingVersion" TEXT NOT NULL DEFAULT 'unified_retail_v1',
  ADD COLUMN "priceRateBasis" TEXT,
  ADD COLUMN "mrpInclusive" DECIMAL(18,2),
  ADD COLUMN "nrpMode" TEXT,
  ADD COLUMN "nrpInput" DECIMAL(18,6),
  ADD COLUMN "nrpInclusive" DECIMAL(18,2),
  ADD COLUMN "nrpExclusive" DECIMAL(18,2),
  ADD COLUMN "specialMode" TEXT NOT NULL DEFAULT 'NONE',
  ADD COLUMN "specialInput" DECIMAL(18,6),
  ADD COLUMN "specialRateInclusive" DECIMAL(18,2),
  ADD COLUMN "specialRateExclusive" DECIMAL(18,2),
  ADD COLUMN "quoteDiscountMode" TEXT NOT NULL DEFAULT 'PERCENT',
  ADD COLUMN "quoteDiscountValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "quoteDiscountAllocatedInclusive" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "taxableValueInclusive" DECIMAL(18,2),
  ADD COLUMN "taxAmountInclusive" DECIMAL(18,2),
  ADD COLUMN "grossLineTotalInclusive" DECIMAL(18,2);

UPDATE "SalesOrderLine" SET "pricingVersion" = 'legacy_unverified';

ALTER TABLE "SalesInvoice"
  ALTER COLUMN "taxableValue" TYPE DECIMAL(18,2) USING ROUND("taxableValue"::numeric, 2),
  ALTER COLUMN "taxAmount" TYPE DECIMAL(18,2) USING ROUND("taxAmount"::numeric, 2),
  ALTER COLUMN "totalAmount" TYPE DECIMAL(18,2) USING ROUND("totalAmount"::numeric, 2),
  ALTER COLUMN "openAmount" TYPE DECIMAL(18,2) USING ROUND("openAmount"::numeric, 2);

ALTER TABLE "SalesInvoiceLine"
  ALTER COLUMN "unitPrice" TYPE DECIMAL(18,2) USING ROUND("unitPrice"::numeric, 2),
  ALTER COLUMN "taxRate" TYPE DECIMAL(8,4) USING ROUND("taxRate"::numeric, 4),
  ALTER COLUMN "taxableValue" TYPE DECIMAL(18,2) USING ROUND("taxableValue"::numeric, 2),
  ALTER COLUMN "taxAmount" TYPE DECIMAL(18,2) USING ROUND("taxAmount"::numeric, 2),
  ALTER COLUMN "grossLineTotal" TYPE DECIMAL(18,2) USING ROUND("grossLineTotal"::numeric, 2),
  ALTER COLUMN "costSnapshot" TYPE DECIMAL(18,4) USING ROUND("costSnapshot"::numeric, 4),
  ADD COLUMN "pricingVersion" TEXT NOT NULL DEFAULT 'unified_retail_v1',
  ADD COLUMN "priceRateBasis" TEXT,
  ADD COLUMN "mrpInclusive" DECIMAL(18,2),
  ADD COLUMN "nrpMode" TEXT,
  ADD COLUMN "nrpInput" DECIMAL(18,6),
  ADD COLUMN "nrpInclusive" DECIMAL(18,2),
  ADD COLUMN "specialMode" TEXT NOT NULL DEFAULT 'NONE',
  ADD COLUMN "specialInput" DECIMAL(18,6),
  ADD COLUMN "specialRateInclusive" DECIMAL(18,2),
  ADD COLUMN "quoteDiscountAllocatedInclusive" DECIMAL(18,2) NOT NULL DEFAULT 0;

ALTER TABLE "PurchaseOrder"
  ALTER COLUMN "discountPercent" TYPE DECIMAL(8,4) USING ROUND("discountPercent"::numeric, 4),
  ALTER COLUMN "taxRate" TYPE DECIMAL(8,4) USING ROUND("taxRate"::numeric, 4),
  ALTER COLUMN "subtotal" TYPE DECIMAL(18,2) USING ROUND("subtotal"::numeric, 2),
  ALTER COLUMN "discountAmount" TYPE DECIMAL(18,2) USING ROUND("discountAmount"::numeric, 2),
  ALTER COLUMN "taxableValue" TYPE DECIMAL(18,2) USING ROUND("taxableValue"::numeric, 2),
  ALTER COLUMN "taxAmount" TYPE DECIMAL(18,2) USING ROUND("taxAmount"::numeric, 2),
  ALTER COLUMN "grandTotal" TYPE DECIMAL(18,2) USING ROUND("grandTotal"::numeric, 2);

ALTER TABLE "PurchaseOrderLine"
  ALTER COLUMN "unitCost" TYPE DECIMAL(18,4) USING ROUND("unitCost"::numeric, 4),
  ALTER COLUMN "discountPercent" TYPE DECIMAL(8,4) USING ROUND("discountPercent"::numeric, 4),
  ALTER COLUMN "taxRate" TYPE DECIMAL(8,4) USING ROUND("taxRate"::numeric, 4),
  ALTER COLUMN "taxableValue" TYPE DECIMAL(18,2) USING ROUND("taxableValue"::numeric, 2),
  ALTER COLUMN "taxAmount" TYPE DECIMAL(18,2) USING ROUND("taxAmount"::numeric, 2),
  ALTER COLUMN "lineTotal" TYPE DECIMAL(18,2) USING ROUND("lineTotal"::numeric, 2);

ALTER TABLE "GoodsReceiptLine"
  ALTER COLUMN "unitCost" TYPE DECIMAL(18,4) USING ROUND("unitCost"::numeric, 4),
  ADD COLUMN "landedUnitCost" DECIMAL(18,4),
  ADD COLUMN "costStatus" TEXT NOT NULL DEFAULT 'complete';

ALTER TABLE "InventoryLot"
  ALTER COLUMN "unitCost" TYPE DECIMAL(18,4) USING ROUND("unitCost"::numeric, 4),
  ADD COLUMN "costStatus" TEXT NOT NULL DEFAULT 'complete';
UPDATE "InventoryLot" SET "costStatus" = CASE WHEN "unitCost" > 0 THEN 'complete' ELSE 'incomplete' END;

ALTER TABLE "InventoryLotLedgerEntry"
  ALTER COLUMN "unitCost" TYPE DECIMAL(18,4) USING ROUND("unitCost"::numeric, 4);

ALTER TABLE "OpeningStockLine"
  ALTER COLUMN "unitCost" TYPE DECIMAL(18,4) USING ROUND("unitCost"::numeric, 4),
  ADD COLUMN "costStatus" TEXT NOT NULL DEFAULT 'incomplete';
UPDATE "OpeningStockLine" SET "costStatus" = CASE WHEN "unitCost" > 0 THEN 'complete' ELSE 'incomplete' END;

ALTER TABLE "ReturnOrder" ALTER COLUMN "refundAmount" TYPE DECIMAL(18,2) USING ROUND("refundAmount"::numeric, 2);
ALTER TABLE "CreditNote"
  ALTER COLUMN "amount" TYPE DECIMAL(18,2) USING ROUND("amount"::numeric, 2),
  ALTER COLUMN "unappliedAmount" TYPE DECIMAL(18,2) USING ROUND("unappliedAmount"::numeric, 2);
